import { friendlyBlockAt, occupancyAt, positionKey } from "../model/occupancy";
import type { Character, GameState, TroopBlock } from "../model/types";
import { emitEvent } from "../events/events";
import { orthogonalNeighbours } from "./direction";
import { recalculateAllConnectivity } from "./splitting";
import { meleeDamagePreview, damageBlock, waveringPenalty, hostCharacter } from "./combat";
import { withMoraleOrder, applyLeaderLossShock } from "./morale";

function modelCountModifier(models: number, capacity: number): number {
  const ratio = capacity > 0 ? models / capacity : 0;
  if (ratio >= 1) return 2;
  if (ratio >= 2 / 3) return 1;
  if (ratio >= 1 / 3) return 0;
  return -1;
}

function adjacentMeleeSupport(state: GameState, block: TroopBlock): number {
  return Math.min(2, orthogonalNeighbours(block.position).filter((position) => {
    const friendly = friendlyBlockAt(state, position, block.factionId);
    return friendly && !friendly.isContested;
  }).length);
}

export function meleeScore(state: GameState, blockId: string): number {
  const block = state.blocks[blockId];
  const formation = block?.formationId ? state.formations[block.formationId] : undefined;
  if (!block || !formation) return 0;
  const character = hostCharacter(state, block);
  return formation.unit.attack + modelCountModifier(block.models, block.modelCapacity) + (character?.meleeBonus ?? 0)
    + (character?.temporaryMeleeBonus ?? 0) + adjacentMeleeSupport(state, block) - waveringPenalty(state, block.id);
}

export function resolveContestedMelees(state: GameState): void {
  const cells = new Map<string, [string, string]>();
  for (const block of Object.values(state.blocks)) {
    if (!block.isContested) continue;
    const occupancy = occupancyAt(state, block.position);
    if (occupancy.romanBlockId && occupancy.saxonBlockId) cells.set(positionKey(block.position), [occupancy.romanBlockId, occupancy.saxonBlockId]);
  }
  const damage = new Map<string, number>();
  for (const [romanId, saxonId] of cells.values()) {
    const romanInflicted = meleeDamagePreview(state, romanId, saxonId)?.expectedDamage ?? 0;
    const saxonInflicted = meleeDamagePreview(state, saxonId, romanId)?.expectedDamage ?? 0;
    if (romanInflicted > 0) damage.set(saxonId, romanInflicted);
    if (saxonInflicted > 0) damage.set(romanId, saxonInflicted);
    emitEvent(state, "contested_melee_resolved", `Contested melee: ${romanId} inflicted ${romanInflicted}, ${saxonId} inflicted ${saxonInflicted}.`, {
      blockIds: [romanId, saxonId], position: state.blocks[romanId] ? { ...state.blocks[romanId]!.position } : undefined,
    });
  }
  withMoraleOrder(state, () => {
    for (const [blockId, amount] of damage) damageBlock(state, blockId, amount, "contested melee");
  });
  for (const [romanId, saxonId] of cells.values()) {
    const roman = state.blocks[romanId];
    const saxon = state.blocks[saxonId];
    if (roman && !saxon) { roman.isContested = false; roman.wavering = true; }
    if (saxon && !roman) { saxon.isContested = false; saxon.wavering = true; }
  }
  recalculateAllConnectivity(state);
}

function defeatCharacter(state: GameState, character: Character, opponent?: Character): void {
  character.status = "defeated";
  const host = state.blocks[character.hostBlockId];
  if (host?.formationId) applyLeaderLossShock(state, host.formationId, character.name);
  if (host) {
    for (const position of orthogonalNeighbours(host.position)) {
      const friendly = friendlyBlockAt(state, position, character.factionId);
      if (friendly) friendly.wavering = true;
    }
  }
  if (opponent) opponent.temporaryMeleeBonus = 1;
  emitEvent(state, "duel_resolved", `${character.name} was defeated in the duel.`, {
    blockIds: host ? [host.id] : [], formationIds: host?.formationId ? [host.formationId] : [],
  });
}

export function resolveDuels(state: GameState): void {
  const handled = new Set<string>();
  for (const block of Object.values(state.blocks)) {
    if (!block.isContested || !block.characterId) continue;
    const occupancy = occupancyAt(state, block.position);
    const otherId = block.factionId === "roman" ? occupancy.saxonBlockId : occupancy.romanBlockId;
    const otherBlock = otherId ? state.blocks[otherId] : undefined;
    if (!otherBlock?.characterId) continue;
    const key = [block.characterId, otherBlock.characterId].sort().join(":");
    if (handled.has(key)) continue;
    handled.add(key);
    const first = state.characters[block.characterId]!;
    const second = state.characters[otherBlock.characterId]!;
    if (first.status === "defeated" || second.status === "defeated") continue;
    const firstScore = first.prowess + modelCountModifier(block.models, block.modelCapacity) + (first.role === "champion" ? 1 : 0);
    const secondScore = second.prowess + modelCountModifier(otherBlock.models, otherBlock.modelCapacity) + (second.role === "champion" ? 1 : 0);
    const difference = Math.abs(firstScore - secondScore);
    if (difference === 0) {
      first.tiedDuelRounds += 1;
      second.tiedDuelRounds += 1;
      if (first.tiedDuelRounds % 2 === 0) { first.wounds += 1; second.wounds += 1; }
    } else {
      const loser = firstScore < secondScore ? first : second;
      loser.wounds += difference >= 3 ? 2 : 1;
    }
    emitEvent(state, "duel_resolved", `${first.name} (${firstScore}) duelled ${second.name} (${secondScore}).`, {
      blockIds: [block.id, otherBlock.id], position: { ...block.position },
    });
    const firstDefeated = first.wounds >= first.maxWounds;
    const secondDefeated = second.wounds >= second.maxWounds;
    if (firstDefeated) defeatCharacter(state, first, second);
    if (secondDefeated) defeatCharacter(state, second, first);
    if (firstDefeated !== secondDefeated) {
      const survivor = firstDefeated ? second : first;
      survivor.status = survivor.wounds > 0 ? "wounded" : "active";
    }
  }
}
