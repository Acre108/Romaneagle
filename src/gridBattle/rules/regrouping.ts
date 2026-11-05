import { BALANCE } from "../model/config";
import { blocksAt, inBounds } from "../model/occupancy";
import { terrainAt, terrainBlocksVoluntaryMovement } from "../model/terrain";
import type { Direction, Formation, GameState, TroopBlock } from "../model/types";
import { emitEvent } from "../events/events";
import { addPosition, directionVector } from "./direction";
import { connectedComponents, provisionalFormationFamily } from "./splitting";
import { applyTerrainOverflow, planTerrainOverflow } from "./terrainOverflow";
import { clearFormationBrace } from "./brace";

const REGROUP_DIRECTIONS: readonly Direction[] = ["north", "east", "south", "west"];

function formationBlocks(state: GameState, formation: Formation): TroopBlock[] {
  return formation.blockIds.map((id) => state.blocks[id]).filter((block) => block !== undefined);
}

function formationsInFamily(state: GameState, familyId: string): Formation[] {
  return Object.values(state.formations)
    .filter((formation) => formation.provisionalFamilyId === familyId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function formationsTouch(state: GameState, first: Formation, second: Formation): boolean {
  return formationBlocks(state, first).some((firstBlock) => formationBlocks(state, second).some((secondBlock) =>
    !firstBlock.isContested && !secondBlock.isContested
      && Math.abs(firstBlock.position.x - secondBlock.position.x)
        + Math.abs(firstBlock.position.y - secondBlock.position.y) === 1));
}

function familyName(formation: Formation): string {
  return formation.name.replace(/ – (Main Body|Fragment [A-Z]+)$/, "");
}

function familyMainBody(formations: Formation[]): Formation {
  return [...formations].sort((a, b) => b.blockIds.length - a.blockIds.length
    || Number(Boolean(b.leaderCharacterId)) - Number(Boolean(a.leaderCharacterId))
    || a.id.localeCompare(b.id))[0]!;
}

function normalizeFamilyNames(state: GameState, familyId: string): void {
  const formations = formationsInFamily(state, familyId);
  if (formations.length === 0) return;
  const originalName = familyName(formations[0]!);
  const main = familyMainBody(formations);
  main.name = `${originalName} – Main Body`;
  let labelCode = 65;
  for (const formation of formations) {
    if (formation.id === main.id) continue;
    formation.name = `${originalName} – Fragment ${String.fromCharCode(labelCode++)}`;
  }
}

function mergeKeeper(state: GameState, first: Formation, second: Formation): Formation {
  if (first.blockIds.length !== second.blockIds.length) {
    return first.blockIds.length > second.blockIds.length ? first : second;
  }
  const firstHasLeader = first.leaderCharacterId
    ? first.blockIds.includes(state.characters[first.leaderCharacterId]?.hostBlockId ?? "") : false;
  const secondHasLeader = second.leaderCharacterId
    ? second.blockIds.includes(state.characters[second.leaderCharacterId]?.hostBlockId ?? "") : false;
  if (firstHasLeader !== secondHasLeader) return firstHasLeader ? first : second;
  return first.id.localeCompare(second.id) <= 0 ? first : second;
}

function mergeTouchingPair(state: GameState, first: Formation, second: Formation): Formation {
  const familyId = first.provisionalFamilyId!;
  const keeper = mergeKeeper(state, first, second);
  const absorbed = keeper.id === first.id ? second : first;
  const originalName = familyName(keeper);
  keeper.blockIds.push(...absorbed.blockIds);
  keeper.cohesion = Math.min(keeper.cohesion, absorbed.cohesion);
  keeper.initialModelCount = Math.max(keeper.initialModelCount, absorbed.initialModelCount);
  keeper.casualtyMoraleStage = Math.max(keeper.casualtyMoraleStage, absorbed.casualtyMoraleStage);
  keeper.lastFlankShockRound = Math.max(keeper.lastFlankShockRound ?? 0, absorbed.lastFlankShockRound ?? 0) || undefined;
  keeper.lastOutnumberedShockRound = Math.max(
    keeper.lastOutnumberedShockRound ?? 0,
    absorbed.lastOutnumberedShockRound ?? 0,
  ) || undefined;
  keeper.failedRegroupActivations = Math.max(
    keeper.failedRegroupActivations ?? 0,
    absorbed.failedRegroupActivations ?? 0,
  );
  keeper.hasActivated ||= absorbed.hasActivated;
  keeper.movementRemaining = Math.min(keeper.movementRemaining, absorbed.movementRemaining);
  keeper.leaderCharacterId ||= absorbed.leaderCharacterId;
  for (const blockId of absorbed.blockIds) state.blocks[blockId]!.formationId = keeper.id;
  delete state.formations[absorbed.id];
  const siblingsRemain = formationsInFamily(state, familyId).length > 1;
  if (!siblingsRemain) {
    keeper.provisionalFamilyId = null;
    keeper.failedRegroupActivations = undefined;
  }
  keeper.name = siblingsRemain ? keeper.name : originalName;
  keeper.status = keeper.cohesion <= 0 ? "routed" : keeper.cohesion <= 3 ? "disordered"
    : connectedComponents(state, keeper.id).length === 1 && !siblingsRemain ? "formed" : "fragment";
  return keeper;
}

export function automaticallyMergeTouchingOriginalUnits(state: GameState, emitSummary = true): string[] {
  const mergedIds: string[] = [];
  const startingCounts = new Map<string, number>();
  const absorbedIds = new Map<string, string[]>();
  const lastKeeperIds = new Map<string, string>();
  let merged = true;
  while (merged) {
    merged = false;
    const formations = Object.values(state.formations).sort((a, b) => a.id.localeCompare(b.id));
    for (let firstIndex = 0; firstIndex < formations.length && !merged; firstIndex += 1) {
      const first = formations[firstIndex]!;
      if (!first.provisionalFamilyId) continue;
      for (let secondIndex = firstIndex + 1; secondIndex < formations.length; secondIndex += 1) {
        const second = formations[secondIndex]!;
        if (first.provisionalFamilyId !== second.provisionalFamilyId
          || first.factionId !== second.factionId || !formationsTouch(state, first, second)) continue;
        const familyId = first.provisionalFamilyId;
        startingCounts.set(familyId, startingCounts.get(familyId) ?? formationsInFamily(state, familyId).length);
        const keeper = mergeTouchingPair(state, first, second);
        mergedIds.push(keeper.id);
        lastKeeperIds.set(familyId, keeper.id);
        const absorbed = keeper.id === first.id ? second : first;
        const ids = absorbedIds.get(familyId) ?? [];
        ids.push(absorbed.id);
        absorbedIds.set(familyId, ids);
        normalizeFamilyNames(state, familyId);
        merged = true;
        break;
      }
    }
  }
  if (emitSummary) {
    for (const [familyId, before] of startingCounts) {
      const family = formationsInFamily(state, familyId);
      const keeper = state.formations[lastKeeperIds.get(familyId) ?? ""];
      const survivors = family.length > 0 ? family : keeper ? [keeper] : [];
      if (survivors.length === 0) continue;
      const originalName = familyName(survivors[0]!);
      emitEvent(state, "formation_merged", `${originalName} regrouped from ${before} bodies into ${survivors.length}.`, {
        blockIds: survivors.flatMap((formation) => formation.blockIds),
        formationIds: [...survivors.map((formation) => formation.id), ...(absorbedIds.get(familyId) ?? [])],
      });
    }
  }
  return mergedIds;
}

function distanceToFamily(state: GameState, formation: Formation, siblings: Formation[], direction?: Direction): number {
  const vector = direction ? directionVector(direction) : { x: 0, y: 0 };
  let distance = Number.POSITIVE_INFINITY;
  for (const block of formationBlocks(state, formation)) {
    const moved = addPosition(block.position, vector);
    for (const sibling of siblings) {
      for (const target of formationBlocks(state, sibling)) {
        distance = Math.min(distance,
          Math.abs(moved.x - target.position.x) + Math.abs(moved.y - target.position.y));
      }
    }
  }
  return distance;
}

function canRegroupStep(state: GameState, formation: Formation, direction: Direction): boolean {
  const blocks = formationBlocks(state, formation);
  if (blocks.some((block) => block.isContested)) return false;
  const ownIds = new Set(formation.blockIds);
  const vector = directionVector(direction);
  const relocations = blocks.map((block) => ({
    block,
    origin: { ...block.position },
    destination: addPosition(block.position, vector),
  }));
  if (!relocations.every(({ destination }) => {
    if (!inBounds(state, destination)) return false;
    const terrain = terrainAt(state, destination)!;
    return !terrainBlocksVoluntaryMovement(terrain)
      && blocksAt(state, destination).every((occupant) => ownIds.has(occupant.id));
  })) return false;
  return planTerrainOverflow(state, relocations) !== null;
}

export function moveFragmentTowardOriginalUnit(state: GameState, formationId: string, emitMovement = true): boolean {
  const formation = state.formations[formationId];
  if (!formation?.provisionalFamilyId) return false;
  const family = provisionalFormationFamily(state, formation.id);
  if (familyMainBody(family).id === formation.id) return false;
  const siblings = family.filter((candidate) => candidate.id !== formation.id);
  if (siblings.length === 0) return false;
  const currentDistance = distanceToFamily(state, formation, siblings);
  const direction = REGROUP_DIRECTIONS
    .filter((candidate) => canRegroupStep(state, formation, candidate))
    .map((candidate) => ({ direction: candidate, distance: distanceToFamily(state, formation, siblings, candidate) }))
    .filter((candidate) => candidate.distance < currentDistance)
    .sort((a, b) => a.distance - b.distance
      || REGROUP_DIRECTIONS.indexOf(a.direction) - REGROUP_DIRECTIONS.indexOf(b.direction))[0]?.direction;
  if (!direction) return false;
  const vector = directionVector(direction);
  const relocations = formationBlocks(state, formation).map((block) => ({
    block,
    origin: { ...block.position },
    destination: addPosition(block.position, vector),
  }));
  const overflow = planTerrainOverflow(state, relocations) ?? [];
  clearFormationBrace(state, formation.id);
  for (const relocation of relocations) relocation.block.position = { ...relocation.destination };
  applyTerrainOverflow(state, overflow);
  if (emitMovement) {
    emitEvent(state, "formation_moved", `${familyName(formation)} moved a separated body ${direction} to regroup.`, {
      blockIds: [...formation.blockIds], formationIds: [formation.id],
    });
  }
  return true;
}

function confirmIndependentSplit(state: GameState, familyId: string): void {
  const formations = formationsInFamily(state, familyId);
  if (formations.length <= 1) return;
  for (const formation of formations) {
    formation.provisionalFamilyId = null;
    formation.failedRegroupActivations = undefined;
    formation.hasActivated = true;
    formation.movementRemaining = 0;
    formation.status = formation.cohesion <= 0 ? "routed" : formation.cohesion <= 3 ? "disordered" : "fragment";
    for (const block of formationBlocks(state, formation)) {
      block.disorder = Math.max(BALANCE.waveringDisorderThreshold, block.disorder);
    }
  }
  emitEvent(state, "formation_split_confirmed", `${familyName(formations[0]!)} could not regroup after ${BALANCE.fragmentRegroupGraceActivations} shared activations; ${formations.length} substantial bodies are now independent.`, {
    blockIds: formations.flatMap((formation) => formation.blockIds),
    formationIds: formations.map((formation) => formation.id),
  });
}

function clearResolvedSingleGroup(state: GameState, familyId: string): boolean {
  const formations = formationsInFamily(state, familyId);
  if (formations.length !== 1) return formations.length === 0;
  const formation = formations[0]!;
  formation.provisionalFamilyId = null;
  formation.failedRegroupActivations = undefined;
  formation.name = familyName(formation);
  formation.status = formation.cohesion <= 0 ? "routed" : formation.cohesion <= 3 ? "disordered"
    : connectedComponents(state, formation.id).length === 1 ? "formed" : "fragment";
  return true;
}

export function resolveEndActivationRegrouping(state: GameState, activatedFormationId: string): void {
  const activated = state.formations[activatedFormationId];
  const familyId = activated?.provisionalFamilyId;
  if (!familyId) {
    automaticallyMergeTouchingOriginalUnits(state);
    return;
  }
  const startingFamily = formationsInFamily(state, familyId);
  const startingCount = startingFamily.length;
  const originalName = familyName(startingFamily[0] ?? activated!);
  for (const formation of startingFamily) {
    formation.hasActivated = true;
    formation.movementRemaining = 0;
  }
  const mergedIds = automaticallyMergeTouchingOriginalUnits(state, false);
  const movedBlockIds: string[] = [];
  const regroupingFamily = formationsInFamily(state, familyId);
  const main = regroupingFamily.length > 0 ? familyMainBody(regroupingFamily) : undefined;
  for (const fragment of regroupingFamily) {
    if (fragment.id === main?.id) continue;
    if (moveFragmentTowardOriginalUnit(state, fragment.id, false)) movedBlockIds.push(...fragment.blockIds);
  }
  mergedIds.push(...automaticallyMergeTouchingOriginalUnits(state, false));
  if (clearResolvedSingleGroup(state, familyId)) {
    const survivorId = mergedIds.filter((id) => state.formations[id]).at(-1) ?? activatedFormationId;
    const survivor = state.formations[survivorId];
    if (startingCount > 1 && survivor) {
      emitEvent(state, "formation_merged", `${originalName} regrouped from ${startingCount} bodies into 1.`, {
        blockIds: [...survivor.blockIds], formationIds: [survivor.id],
      });
    }
    return;
  }
  const remaining = formationsInFamily(state, familyId);
  normalizeFamilyNames(state, familyId);
  const failedAttempts = Math.max(0, ...remaining.map((formation) => formation.failedRegroupActivations ?? 0)) + 1;
  for (const formation of remaining) formation.failedRegroupActivations = failedAttempts;
  const hasStragglers = remaining.some((formation) => formation.blockIds.length <= BALANCE.stragglerBlockThreshold);
  if (hasStragglers || failedAttempts < BALANCE.fragmentRegroupGraceActivations) {
    const reason = hasStragglers
      ? "small straggler groups remain attached to the shared activation"
      : `regroup attempt ${failedAttempts}/${BALANCE.fragmentRegroupGraceActivations}`;
    emitEvent(state, "formation_moved", `${originalName} remains in ${remaining.length} bodies; ${reason}.`, {
      blockIds: movedBlockIds,
      formationIds: remaining.map((formation) => formation.id),
    });
    return;
  }
  confirmIndependentSplit(state, familyId);
}
