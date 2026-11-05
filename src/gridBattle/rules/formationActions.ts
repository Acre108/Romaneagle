import { blocksAt, inBounds } from "../model/occupancy";
import { terrainAt, terrainBlocksVoluntaryMovement } from "../model/terrain";
import type { GameState, GridPosition } from "../model/types";
import { emitEvent } from "../events/events";
import { manhattanDistance, orthogonalNeighbours } from "./direction";
import { areFormationsConnected, recalculateAllConnectivity, recalculateFormationConnectivity } from "./splitting";
import { applyTerrainOverflow, planTerrainOverflow } from "./terrainOverflow";
import { clearFormationBrace } from "./brace";

function compatibleUnitProfiles(first: GameState["formations"][string], second: GameState["formations"][string]): boolean {
  return first.formationMode === second.formationMode
    && first.unit.unitType === second.unit.unitType
    && first.unit.modelSize === second.unit.modelSize
    && first.unit.attack === second.unit.attack
    && first.unit.armour === second.unit.armour
    && first.unit.defence === second.unit.defence
    && first.unit.hitPointsPerModel === second.unit.hitPointsPerModel
    && first.unit.movement === second.unit.movement
    && first.unit.rangedWeaponId === second.unit.rangedWeaponId
    && first.unit.equipment.join("|") === second.unit.equipment.join("|");
}

export function legalReformDestinations(state: GameState, blockId: string): GridPosition[] {
  const block = state.blocks[blockId];
  if (!block || block.isContested || !block.formationId) return [];
  const formation = state.formations[block.formationId];
  if (!formation || formation.hasActivated) return [];
  return orthogonalNeighbours(block.position).filter((destination) => {
    if (!inBounds(state, destination)) return false;
    const terrain = terrainAt(state, destination)!;
    if (terrainBlocksVoluntaryMovement(terrain)) return false;
    if (blocksAt(state, destination).length > 0) return false;
    if (orthogonalNeighbours(destination).some((position) => blocksAt(state, position).some((candidate) => candidate.factionId !== block.factionId))) return false;
    if (!orthogonalNeighbours(destination).some((position) => blocksAt(state, position).some((candidate) =>
      candidate.factionId === block.factionId && candidate.id !== block.id && !candidate.isContested,
    ))) return false;
    return planTerrainOverflow(state, [{ block, origin: block.position, destination }]) !== null;
  });
}

export function reformBlock(state: GameState, blockId: string, destination: GridPosition): boolean {
  const block = state.blocks[blockId];
  if (!block || !legalReformDestinations(state, blockId).some((candidate) => candidate.x === destination.x && candidate.y === destination.y)) return false;
  const formation = state.formations[block.formationId!]!;
  const overflow = planTerrainOverflow(state, [{ block, origin: { ...block.position }, destination }]) ?? [];
  clearFormationBrace(state, formation.id);
  block.engagementFacing = undefined;
  block.position = { ...destination };
  block.disorder = Math.max(0, block.disorder - 1);
  const overflowIds = applyTerrainOverflow(state, overflow);
  for (const neighbourPosition of orthogonalNeighbours(block.position)) {
    const neighbour = blocksAt(state, neighbourPosition).find((candidate) => candidate.formationId === formation.id);
    const centurion = neighbour?.characterId ? state.characters[neighbour.characterId] : undefined;
    if (centurion?.role === "centurion") block.disorder = Math.max(0, block.disorder - 1);
  }
  formation.hasActivated = true;
  formation.movementRemaining = 0;
  emitEvent(state, "formation_moved", `${block.id} reformed into a new position.`, {
    blockIds: [block.id, ...overflowIds], formationIds: [formation.id], position: { ...destination },
  });
  recalculateAllConnectivity(state);
  return true;
}

export function transferCharacter(state: GameState, characterId: string, targetBlockId: string): boolean {
  const character = state.characters[characterId];
  const source = character ? state.blocks[character.hostBlockId] : undefined;
  const target = state.blocks[targetBlockId];
  if (!character || !source || !target || target.characterId || target.isContested
    || source.formationId !== target.formationId || manhattanDistance(source.position, target.position) !== 1) return false;
  const formation = state.formations[source.formationId!];
  if (!formation || formation.hasActivated) return false;
  source.characterId = null;
  target.characterId = character.id;
  character.hostBlockId = target.id;
  formation.hasActivated = true;
  formation.movementRemaining = 0;
  emitEvent(state, "character_transferred", `${character.name} transferred to ${target.id}.`, {
    blockIds: [source.id, target.id], formationIds: [formation.id], position: { ...target.position },
  });
  return true;
}

export function mergeCandidates(state: GameState, formationId: string): string[] {
  const formation = state.formations[formationId];
  if (!formation || formation.hasActivated || formation.blockIds.some((id) => state.blocks[id]?.isContested)) return [];
  return Object.values(state.formations)
    .filter((candidate) => candidate.id !== formation.id
      && candidate.factionId === formation.factionId
      && candidate.facing === formation.facing
      && compatibleUnitProfiles(formation, candidate)
      && !candidate.hasActivated
      && !candidate.blockIds.some((id) => state.blocks[id]?.isContested)
      && areFormationsConnected(state, formation.id, candidate.id))
    .map((candidate) => candidate.id);
}

function hasCommander(state: GameState, formationId: string): boolean {
  return state.formations[formationId]?.blockIds.some((id) => {
    const characterId = state.blocks[id]?.characterId;
    return characterId ? state.characters[characterId]?.role === "commander" : false;
  }) ?? false;
}

export function mergeFormations(state: GameState, firstId: string, secondId: string): string | null {
  if (!mergeCandidates(state, firstId).includes(secondId)) return null;
  const first = state.formations[firstId]!;
  const second = state.formations[secondId]!;
  const keeper = hasCommander(state, first.id) ? first
    : hasCommander(state, second.id) ? second
      : first.blockIds.length >= second.blockIds.length ? first : second;
  const absorbed = keeper.id === first.id ? second : first;
  const sameProvisionalFamily = Boolean(keeper.provisionalFamilyId
    && keeper.provisionalFamilyId === absorbed.provisionalFamilyId);
  keeper.blockIds.push(...absorbed.blockIds);
  keeper.cohesion = Math.min(keeper.cohesion, absorbed.cohesion);
  keeper.initialModelCount = sameProvisionalFamily
    ? Math.max(keeper.initialModelCount, absorbed.initialModelCount)
    : keeper.initialModelCount + absorbed.initialModelCount;
  keeper.casualtyMoraleStage = Math.max(keeper.casualtyMoraleStage, absorbed.casualtyMoraleStage);
  if (keeper.unit.rangedWeaponId) {
    keeper.ammunition = (keeper.ammunition ?? 0) + (absorbed.ammunition ?? 0);
  }
  keeper.status = keeper.cohesion <= 0 ? "routed" : keeper.cohesion <= 3 ? "disordered" : "formed";
  keeper.isBraced = false;
  keeper.hasActivated = true;
  keeper.movementRemaining = 0;
  keeper.leaderCharacterId ||= absorbed.leaderCharacterId;
  for (const blockId of keeper.blockIds) {
    state.blocks[blockId]!.formationId = keeper.id;
    state.blocks[blockId]!.engagementFacing = undefined;
  }
  delete state.formations[absorbed.id];
  emitEvent(state, "formation_merged", `${absorbed.name} merged into ${keeper.name}.`, {
    blockIds: [...keeper.blockIds], formationIds: [keeper.id, absorbed.id],
  });
  recalculateFormationConnectivity(state, keeper.id);
  return keeper.id;
}

export function forceSplit(state: GameState, formationId: string): boolean {
  const formation = state.formations[formationId];
  if (!formation || formation.blockIds.length < 3) return false;
  const blocks = formation.blockIds.map((id) => state.blocks[id]).filter((block) => block !== undefined);
  const centreX = blocks.reduce((sum, block) => sum + block.position.x, 0) / blocks.length;
  const centreY = blocks.reduce((sum, block) => sum + block.position.y, 0) / blocks.length;
  const target = [...blocks].sort((a, b) =>
    manhattanDistance(a.position, { x: centreX, y: centreY }) - manhattanDistance(b.position, { x: centreX, y: centreY })
    || a.id.localeCompare(b.id),
  )[0]!;
  target.isContested = true;
  recalculateFormationConnectivity(state, formation.id, true);
  target.isContested = false;
  return true;
}
