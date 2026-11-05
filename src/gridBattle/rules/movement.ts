import { blocksAt, inBounds, positionKey } from "../model/occupancy";
import { terrainAt, terrainBlocksVoluntaryMovement, terrainBlocksVoluntaryRelocation, terrainMovementCost } from "../model/terrain";
import type {
  Character,
  Direction,
  Formation,
  FormationRelocationPlan,
  GameState,
  GridPosition,
  PlannedBlockRelocation,
  TroopBlock,
} from "../model/types";
import { emitEvent } from "../events/events";
import {
  addPosition,
  directionBetween,
  directionVector,
  oppositeDirection,
} from "./direction";
import { provisionalFormationFamily, recalculateFormationConnectivity } from "./splitting";
import { clearFormationEngagementFacings } from "./blockFacing";
import { applyTerrainOverflow, planTerrainOverflow } from "./terrainOverflow";
import { clearFormationBrace } from "./brace";

export interface RuleResult {
  ok: boolean;
  reason?: string;
}

export interface MovementPlanResult extends RuleResult {
  plan?: FormationRelocationPlan;
}

export function formationBlocks(state: GameState, formation: Formation): TroopBlock[] {
  return formation.blockIds.map((id) => state.blocks[id]).filter((block): block is TroopBlock => block !== undefined);
}

export function movementCost(state: GameState, formation: Formation, direction: Direction): number {
  const blocks = formationBlocks(state, formation);
  const terrainCost = Math.max(0, ...blocks.map((block) => {
    const destination = addPosition(block.position, directionVector(direction));
    return terrainMovementCost(terrainAt(state, destination));
  }));
  const formationSurcharge = formation.unit.unitType === "heavy_infantry"
    && formation.formationMode === "closed"
    && direction !== formation.facing
    && direction !== oppositeDirection(formation.facing)
    ? 1
    : formation.unit.unitType === "heavy_infantry"
      && formation.formationMode === "closed"
      && direction === oppositeDirection(formation.facing)
      ? 1
      : 0;
  return terrainCost + formationSurcharge;
}

function formationMovementSurcharge(formation: Formation, direction: Direction): number {
  return formation.unit.unitType === "heavy_infantry"
    && formation.formationMode === "closed"
    && (direction !== formation.facing || direction === oppositeDirection(formation.facing))
    ? 1
    : 0;
}

function relocationMovementCost(
  state: GameState,
  formation: Formation,
  direction: Direction,
  relocations: readonly PlannedBlockRelocation[],
): number {
  const terrainCost = Math.max(0, ...relocations
    .filter((relocation) => relocation.formationId === formation.id)
    .map((relocation) => terrainMovementCost(terrainAt(state, relocation.destination))));
  return terrainCost + formationMovementSurcharge(formation, direction);
}

function terrainOverflowForPlan(state: GameState, relocations: readonly PlannedBlockRelocation[]) {
  return planTerrainOverflow(state, relocations.map((relocation) => ({
    block: state.blocks[relocation.blockId]!,
    origin: relocation.origin,
    destination: relocation.destination,
  })));
}

function advanceCoordinate(position: GridPosition, direction: Direction): number {
  const vector = directionVector(direction);
  return position.x * vector.x + position.y * vector.y;
}

function lateralCoordinate(position: GridPosition, direction: Direction): number {
  return direction === "north" || direction === "south" ? position.x : position.y;
}

function positionFromCoordinates(advance: number, lateral: number, direction: Direction): GridPosition {
  switch (direction) {
    case "north": return { x: lateral, y: -advance };
    case "south": return { x: lateral, y: advance };
    case "east": return { x: advance, y: lateral };
    case "west": return { x: -advance, y: lateral };
  }
}

function contiguousRuns(values: readonly number[]): number[][] {
  const runs: number[][] = [];
  for (const value of values) {
    const current = runs.at(-1);
    if (!current || value !== current[current.length - 1]! + 1) runs.push([value]);
    else current.push(value);
  }
  return runs;
}

function planReorderedFormation(
  state: GameState,
  formation: Formation,
  direction: Direction,
  distance: number,
  ownIds: ReadonlySet<string>,
  anchor?: { blockId: string; destination: GridPosition },
): PlannedBlockRelocation[] | null {
  const blocks = formationBlocks(state, formation);
  if (blocks.length === 0) return null;
  const front = Math.max(...blocks.map((block) => advanceCoordinate(block.position, direction)));
  const frontDestination = front + distance;
  const lateralValues = blocks.map((block) => lateralCoordinate(block.position, direction));
  const minLateral = Math.min(...lateralValues);
  const maxLateral = Math.max(...lateralValues);
  const centreLateral = lateralValues.reduce((sum, value) => sum + value, 0) / lateralValues.length;
  const validEntryLaterals: number[] = [];
  for (let lateral = minLateral; lateral <= maxLateral; lateral += 1) {
    let previous = positionFromCoordinates(front, lateral, direction);
    let legal = true;
    for (let step = 1; step <= distance; step += 1) {
      const destination = positionFromCoordinates(front + step, lateral, direction);
      if (!inBounds(state, destination)
        || terrainBlocksVoluntaryRelocation(state, previous, destination)
        || blocksAt(state, destination).some((occupant) => !ownIds.has(occupant.id))) {
        legal = false;
        break;
      }
      previous = destination;
    }
    if (legal) validEntryLaterals.push(lateral);
  }
  const anchorLateral = anchor ? lateralCoordinate(anchor.destination, direction) : undefined;
  const entryRun = contiguousRuns(validEntryLaterals)
    .filter((run) => anchorLateral === undefined || run.includes(anchorLateral))
    .sort((a, b) => b.length - a.length
      || Math.abs(a.reduce((sum, value) => sum + value, 0) / a.length - centreLateral)
        - Math.abs(b.reduce((sum, value) => sum + value, 0) / b.length - centreLateral)
      || a[0]! - b[0]!)[0];
  if (!entryRun || entryRun.length === 0) return null;

  const externalOccupancy = new Set(Object.values(state.blocks)
    .filter((block) => !ownIds.has(block.id))
    .map((block) => positionKey(block.position)));
  const targets: GridPosition[] = [];
  const maximumDepth = state.battlefield.width + state.battlefield.height;
  for (let depth = 0; depth < maximumDepth && targets.length < blocks.length; depth += 1) {
    const advance = frontDestination - depth;
    for (const lateral of entryRun) {
      const position = positionFromCoordinates(advance, lateral, direction);
      if (!inBounds(state, position) || externalOccupancy.has(positionKey(position))) continue;
      if (terrainBlocksVoluntaryMovement(terrainAt(state, position) ?? "impassable")) continue;
      targets.push(position);
      if (targets.length === blocks.length) break;
    }
  }
  if (targets.length !== blocks.length) return null;
  if (anchor && !targets.some((target) => positionKey(target) === positionKey(anchor.destination))) return null;

  const targetCentre = entryRun.reduce((sum, value) => sum + value, 0) / entryRun.length;
  const sortedBlocks = [...blocks].sort((a, b) => advanceCoordinate(b.position, direction) - advanceCoordinate(a.position, direction)
    || Math.abs(lateralCoordinate(a.position, direction) - targetCentre) - Math.abs(lateralCoordinate(b.position, direction) - targetCentre)
    || lateralCoordinate(a.position, direction) - lateralCoordinate(b.position, direction)
    || a.id.localeCompare(b.id));
  const sortedTargets = [...targets].sort((a, b) => advanceCoordinate(b, direction) - advanceCoordinate(a, direction)
    || Math.abs(lateralCoordinate(a, direction) - targetCentre) - Math.abs(lateralCoordinate(b, direction) - targetCentre)
    || lateralCoordinate(a, direction) - lateralCoordinate(b, direction));
  const assignments = new Map<string, GridPosition>();
  if (anchor) {
    assignments.set(anchor.blockId, anchor.destination);
    sortedTargets.splice(sortedTargets.findIndex((target) => positionKey(target) === positionKey(anchor.destination)), 1);
  }
  const remainingBlocks = sortedBlocks.filter((block) => !assignments.has(block.id));
  remainingBlocks.forEach((block, index) => assignments.set(block.id, sortedTargets[index]!));
  const relocations = blocks.map((block) => ({
    blockId: block.id,
    formationId: formation.id,
    origin: { ...block.position },
    destination: { ...assignments.get(block.id)! },
  }));
  return terrainOverflowForPlan(state, relocations) ? relocations : null;
}

function basicMovementLegality(state: GameState, family: readonly Formation[]): RuleResult {
  if (family.some((candidate) => candidate.hasActivated)) return { ok: false, reason: "Formation has already activated." };
  if (family.some((candidate) => formationBlocks(state, candidate).some((block) => block.isContested))) {
    return { ok: false, reason: "Contested blocks cannot move." };
  }
  return { ok: true };
}

export function planFormationAdvance(
  state: GameState,
  formationId: string,
  direction: Direction,
  distance: number,
  options: { spendMovement?: boolean; anchor?: { blockId: string; destination: GridPosition } } = {},
): MovementPlanResult {
  const formation = state.formations[formationId];
  if (!formation) return { ok: false, reason: "Formation no longer exists." };
  if (distance < 1 || !Number.isInteger(distance)) return { ok: false, reason: "Movement distance must be a positive whole number." };
  const family = options.spendMovement === false ? [formation] : provisionalFormationFamily(state, formationId);
  const basic = basicMovementLegality(state, family);
  if (!basic.ok) return basic;
  const allBlocks = family.flatMap((candidate) => formationBlocks(state, candidate));
  const ownIds = new Set(allBlocks.map((block) => block.id));
  const vector = directionVector(direction);
  let rigidLegal = true;
  for (let step = 1; step <= distance && rigidLegal; step += 1) {
    for (const block of allBlocks) {
      const origin = addPosition(block.position, vector, step - 1);
      const destination = addPosition(block.position, vector, step);
      if (!inBounds(state, destination)
        || terrainBlocksVoluntaryRelocation(state, origin, destination)
        || blocksAt(state, destination).some((occupant) => !ownIds.has(occupant.id))) {
        rigidLegal = false;
        break;
      }
    }
  }
  let relocations: PlannedBlockRelocation[] | null = rigidLegal ? allBlocks.map((block) => ({
    blockId: block.id,
    formationId: block.formationId!,
    origin: { ...block.position },
    destination: addPosition(block.position, vector, distance),
  })) : null;
  let overflow = relocations ? terrainOverflowForPlan(state, relocations) : null;
  const anchorFitsRigid = !options.anchor || relocations?.some((relocation) => relocation.blockId === options.anchor!.blockId
    && positionKey(relocation.destination) === positionKey(options.anchor!.destination));
  if (!overflow || !anchorFitsRigid) relocations = null;
  let reordered = Boolean(relocations && overflow && overflow.length > 0);
  if (!relocations) {
    if (family.length !== 1) return { ok: false, reason: "The linked formation bodies cannot fit through that route." };
    relocations = planReorderedFormation(state, formation, direction, distance, ownIds, options.anchor);
    if (!relocations) return { ok: false, reason: "The formation cannot reorder into a connected footprint through that route." };
    overflow = terrainOverflowForPlan(state, relocations);
    reordered = true;
  }
  const movementCosts = Object.fromEntries(family.map((candidate) => [
    candidate.id,
    relocationMovementCost(state, candidate, direction, relocations!),
  ]));
  if (options.spendMovement !== false && family.some((candidate) => candidate.movementRemaining < movementCosts[candidate.id]!)) {
    return { ok: false, reason: `Requires ${Math.max(...Object.values(movementCosts))} movement.` };
  }
  return {
    ok: true,
    plan: {
      formationIds: family.map((candidate) => candidate.id),
      direction,
      distance,
      reordered,
      movementCosts,
      relocations,
    },
  };
}

export function planFormationMove(state: GameState, formationId: string, direction: Direction): MovementPlanResult {
  return planFormationAdvance(state, formationId, direction, 1, { spendMovement: true });
}

export function canTranslateFormation(
  state: GameState,
  formationId: string,
  direction: Direction,
): RuleResult {
  const result = planFormationMove(state, formationId, direction);
  return { ok: result.ok, reason: result.reason };
}

export function translateFormation(
  state: GameState,
  formationId: string,
  direction: Direction,
  confirmed = false,
): RuleResult {
  const planned = planFormationMove(state, formationId, direction);
  if (!planned.ok || !planned.plan) return planned;
  if (planned.plan.reordered && !confirmed) return { ok: false, reason: "This formation-changing move must be previewed and confirmed." };
  const formation = state.formations[formationId]!;
  const family = planned.plan.formationIds.map((id) => state.formations[id]!).filter((candidate) => candidate !== undefined);
  for (const candidate of family) clearFormationEngagementFacings(state, candidate.id);
  const overflow = terrainOverflowForPlan(state, planned.plan.relocations) ?? [];
  for (const candidate of family) {
    clearFormationBrace(state, candidate.id);
    candidate.movementRemaining -= planned.plan.movementCosts[candidate.id] ?? 0;
  }
  for (const relocation of planned.plan.relocations) state.blocks[relocation.blockId]!.position = { ...relocation.destination };
  applyTerrainOverflow(state, overflow);
  const familyDescription = family.length > 1 ? ` in ${family.length} bodies` : "";
  emitEvent(state, "formation_moved", `${formation.name} ${planned.plan.reordered ? "reordered" : "moved"} ${direction}${familyDescription}.`, {
    blockIds: family.flatMap((candidate) => candidate.blockIds), formationIds: family.map((candidate) => candidate.id),
  });
  for (const candidate of family) if (state.formations[candidate.id]) recalculateFormationConnectivity(state, candidate.id);
  return { ok: true };
}

export function rotationPivot(state: GameState, formation: Formation): GridPosition {
  if (formation.leaderCharacterId) {
    const leader = state.characters[formation.leaderCharacterId];
    const host = leader ? state.blocks[leader.hostBlockId] : undefined;
    if (host && formation.blockIds.includes(host.id)) return { ...host.position };
  }
  const blocks = formationBlocks(state, formation);
  const centre = blocks.reduce((total, block) => ({
    x: total.x + block.position.x / blocks.length,
    y: total.y + block.position.y / blocks.length,
  }), { x: 0, y: 0 });
  return [...blocks]
    .sort((a, b) => {
      const distanceA = (a.position.x - centre.x) ** 2 + (a.position.y - centre.y) ** 2;
      const distanceB = (b.position.x - centre.x) ** 2 + (b.position.y - centre.y) ** 2;
      return distanceA - distanceB || a.position.y - b.position.y || a.position.x - b.position.x;
    })[0]!.position;
}

function frontMiddleBlocks(state: GameState, formation: Formation) {
  const blocks = formationBlocks(state, formation);
  if (blocks.length === 0) return [];
  const frontCoordinate = formation.facing === "north"
    ? Math.min(...blocks.map((block) => block.position.y))
    : formation.facing === "south"
      ? Math.max(...blocks.map((block) => block.position.y))
      : formation.facing === "east"
        ? Math.max(...blocks.map((block) => block.position.x))
        : Math.min(...blocks.map((block) => block.position.x));
  const front = blocks.filter((block) => formation.facing === "north" || formation.facing === "south"
    ? block.position.y === frontCoordinate
    : block.position.x === frontCoordinate);
  const lateral = (block: (typeof blocks)[number]) => formation.facing === "north" || formation.facing === "south"
    ? block.position.x
    : block.position.y;
  const centre = front.reduce((sum, block) => sum + lateral(block), 0) / front.length;
  return [...front].sort((a, b) => Math.abs(lateral(a) - centre) - Math.abs(lateral(b) - centre)
    || lateral(a) - lateral(b) || a.id.localeCompare(b.id));
}

function moveCharactersToFormationFront(state: GameState, formation: Formation): void {
  const characters = formationBlocks(state, formation)
    .map((block) => block.characterId ? state.characters[block.characterId] : undefined)
    .filter((character): character is Character => character !== undefined && character.status !== "defeated")
    .sort((a, b) => Number(b.id === formation.leaderCharacterId) - Number(a.id === formation.leaderCharacterId)
      || a.id.localeCompare(b.id));
  if (characters.length === 0) return;
  const front = frontMiddleBlocks(state, formation);
  const remaining = formationBlocks(state, formation).filter((block) => !front.includes(block));
  const targets = [...front, ...remaining];
  const origins = new Map(characters.map((character) => [character.id, character.hostBlockId]));
  for (const block of formationBlocks(state, formation)) {
    if (block.characterId && characters.some((character) => character.id === block.characterId)) block.characterId = null;
  }
  characters.forEach((character, index) => {
    const target = targets[index];
    if (!target) return;
    target.characterId = character.id;
    character.hostBlockId = target.id;
    const originId = origins.get(character.id);
    if (originId !== target.id) {
      emitEvent(state, "character_transferred", `${character.name} moved to the new centre of the front rank.`, {
        blockIds: originId ? [originId, target.id] : [target.id], formationIds: [formation.id], position: { ...target.position },
      });
    }
  });
}

export function finishFormationMove(
  state: GameState,
  formationId: string,
  facing: Direction,
): RuleResult {
  const formation = state.formations[formationId];
  if (!formation) return { ok: false, reason: "Formation no longer exists." };
  if (formation.hasActivated) return { ok: false, reason: "Formation has already activated." };
  const previousFacing = formation.facing;
  clearFormationEngagementFacings(state, formation.id);
  formation.facing = facing;
  moveCharactersToFormationFront(state, formation);
  if (previousFacing !== facing) {
    emitEvent(state, "formation_rotated", `${formation.name} finished its move facing ${facing}.`, {
      blockIds: [...formation.blockIds], formationIds: [formation.id], position: rotationPivot(state, formation),
    });
  }
  return { ok: true };
}

export function legalMoveDirections(state: GameState, formationId: string): Direction[] {
  return (["north", "east", "south", "west"] as const)
    .filter((direction) => canTranslateFormation(state, formationId, direction).ok);
}

export function moveDirectionFromCell(
  formation: Formation,
  state: GameState,
  target: GridPosition,
): Direction | null {
  const blocks = formationBlocks(state, formation);
  const minX = Math.min(...blocks.map((block) => block.position.x));
  const maxX = Math.max(...blocks.map((block) => block.position.x));
  const minY = Math.min(...blocks.map((block) => block.position.y));
  const maxY = Math.max(...blocks.map((block) => block.position.y));
  if (target.y === minY - 1 && target.x >= minX && target.x <= maxX) return "north";
  if (target.x === maxX + 1 && target.y >= minY && target.y <= maxY) return "east";
  if (target.y === maxY + 1 && target.x >= minX && target.x <= maxX) return "south";
  if (target.x === minX - 1 && target.y >= minY && target.y <= maxY) return "west";
  const pivot = rotationPivot(state, formation);
  return directionBetween(pivot, target);
}
