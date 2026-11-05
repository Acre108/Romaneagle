import { emitEvent } from "../events/events";
import { BALANCE } from "../model/config";
import { blocksAt, inBounds, positionKey } from "../model/occupancy";
import { terrainAt, terrainBlocksVoluntaryMovement } from "../model/terrain";
import type { BlockDeparture, Direction, FactionId, Formation, GameState, GridPosition, TroopBlock } from "../model/types";
import { addPosition, directionVector, manhattanDistance, oppositeDirection } from "./direction";
import { provisionalFormationFamily, recalculateFormationConnectivity } from "./splitting";
import { applyTerrainOverflow, planTerrainOverflow } from "./terrainOverflow";
import { clearFormationBrace } from "./brace";

const ROUTE_DIRECTIONS: readonly Direction[] = ["north", "east", "south", "west"];

export interface RoutingResult {
  movedSteps: number;
  escapedBlocks: number;
  rallied: boolean;
  formationEscaped: boolean;
}

function familyBlocks(state: GameState, family: readonly Formation[]): TroopBlock[] {
  return family.flatMap((formation) => formation.blockIds
    .map((blockId) => state.blocks[blockId])
    .filter((block): block is TroopBlock => block !== undefined));
}

function enemyBlocks(state: GameState, factionId: FactionId): TroopBlock[] {
  return Object.values(state.blocks).filter((block) => block.factionId !== factionId);
}

function nearestEnemyDistance(blocks: readonly TroopBlock[], enemies: readonly TroopBlock[]): number {
  if (blocks.length === 0 || enemies.length === 0) return Number.POSITIVE_INFINITY;
  let distance = Number.POSITIVE_INFINITY;
  for (const block of blocks) {
    for (const enemy of enemies) distance = Math.min(distance, manhattanDistance(block.position, enemy.position));
  }
  return distance;
}

function familyCentre(blocks: readonly TroopBlock[]): GridPosition {
  const divisor = Math.max(1, blocks.length);
  return {
    x: blocks.reduce((total, block) => total + block.position.x, 0) / divisor,
    y: blocks.reduce((total, block) => total + block.position.y, 0) / divisor,
  };
}

function nearestEnemyToCentre(blocks: readonly TroopBlock[], enemies: readonly TroopBlock[]): TroopBlock | undefined {
  const centre = familyCentre(blocks);
  return [...enemies].sort((a, b) => manhattanDistance(centre, a.position) - manhattanDistance(centre, b.position)
    || a.id.localeCompare(b.id))[0];
}

interface RouteRelocation {
  block: TroopBlock;
  origin: GridPosition;
  destination: GridPosition;
}

interface RoutePlan {
  relocations: RouteRelocation[];
  /** Friendly blocks the routers pour through; each swaps to the square its router file vacates. */
  displaced: RouteRelocation[];
}

function planRouteStep(state: GameState, blocks: readonly TroopBlock[], direction: Direction): RoutePlan | null {
  const movingIds = new Set(blocks.map((block) => block.id));
  const movingAt = new Set(blocks.map((block) => positionKey(block.position)));
  const vector = directionVector(direction);
  const behind = directionVector(oppositeDirection(direction));
  const relocations: RouteRelocation[] = [];
  const displaced: RouteRelocation[] = [];
  for (const block of blocks) {
    const destination = addPosition(block.position, vector);
    relocations.push({ block, origin: { ...block.position }, destination });
    if (!inBounds(state, destination)) continue;
    if (terrainBlocksVoluntaryMovement(terrainAt(state, destination)!)) return null;
    const occupants = blocksAt(state, destination).filter((occupant) => !movingIds.has(occupant.id));
    if (occupants.length === 0) continue;
    const friend = occupants[0]!;
    if (occupants.length > 1 || friend.factionId !== block.factionId || friend.isContested
      || (friend.formationId && formationFamilyIsRouted(state, friend.formationId))) return null;
    let vacated = block.position;
    while (movingAt.has(positionKey(addPosition(vacated, behind)))) vacated = addPosition(vacated, behind);
    displaced.push({ block: friend, origin: { ...friend.position }, destination: { ...vacated } });
  }
  return planTerrainOverflow(state, [...relocations, ...displaced]) === null ? null : { relocations, displaced };
}

function routeStepIsLegal(state: GameState, blocks: readonly TroopBlock[], direction: Direction): boolean {
  return planRouteStep(state, blocks, direction) !== null;
}

function routeDirection(
  state: GameState,
  blocks: readonly TroopBlock[],
  enemies: readonly TroopBlock[],
  previousFacing: Direction,
): Direction | null {
  if (blocks.length === 0) return null;
  const centre = familyCentre(blocks);
  const nearestEnemy = nearestEnemyToCentre(blocks, enemies);
  const candidates = ROUTE_DIRECTIONS.flatMap((direction) => {
    const vector = directionVector(direction);
    const destinations = blocks.map((block) => addPosition(block.position, vector));
    if (!routeStepIsLegal(state, blocks, direction)) return [];
    const escaped = destinations.filter((destination) => !inBounds(state, destination)).length;
    const inBoundsDestinations = destinations.filter((destination) => inBounds(state, destination));
    const distance = inBoundsDestinations.length === 0 || enemies.length === 0
      ? Number.POSITIVE_INFINITY
      : Math.min(...inBoundsDestinations.flatMap((destination) =>
        enemies.map((enemy) => manhattanDistance(destination, enemy.position))));
    const awayVector = nearestEnemy
      ? { x: centre.x - nearestEnemy.position.x, y: centre.y - nearestEnemy.position.y }
      : directionVector(oppositeDirection(previousFacing));
    const awayScore = vector.x * awayVector.x + vector.y * awayVector.y;
    return [{ direction, escaped, distance, awayScore }];
  });
  return candidates.sort((a, b) => b.awayScore - a.awayScore
    || b.distance - a.distance
    || b.escaped - a.escaped
    || ROUTE_DIRECTIONS.indexOf(a.direction) - ROUTE_DIRECTIONS.indexOf(b.direction))[0]?.direction ?? null;
}

function transferOrRemoveCharacters(
  state: GameState,
  leaving: readonly TroopBlock[],
  survivors: readonly TroopBlock[],
): void {
  for (const block of leaving) {
    if (!block.characterId) continue;
    const character = state.characters[block.characterId];
    const wasFormationLeader = Object.values(state.formations)
      .some((formation) => formation.leaderCharacterId === block.characterId);
    for (const formation of Object.values(state.formations)) {
      if (formation.leaderCharacterId === block.characterId) formation.leaderCharacterId = null;
    }
    block.characterId = null;
    const newHost = survivors
      .filter((candidate) => !candidate.characterId)
      .sort((a, b) => Number(b.formationId === block.formationId) - Number(a.formationId === block.formationId)
        || a.id.localeCompare(b.id))[0];
    if (character && newHost) {
      newHost.characterId = character.id;
      character.hostBlockId = newHost.id;
      if (wasFormationLeader && newHost.formationId && state.formations[newHost.formationId]) {
        state.formations[newHost.formationId]!.leaderCharacterId = character.id;
      }
      emitEvent(state, "character_transferred", `${character.name} remained with the routing formation.`, {
        blockIds: [block.id, newHost.id],
        formationIds: [block.formationId, newHost.formationId].filter((id): id is string => Boolean(id)),
      });
    } else if (character) {
      delete state.characters[character.id];
    }
  }
}

function moveRoutingStep(
  state: GameState,
  family: Formation[],
  direction: Direction,
): { escapedBlocks: number; departures: BlockDeparture[]; shaken: TroopBlock[] } {
  const blocks = familyBlocks(state, family);
  for (const formation of family) clearFormationBrace(state, formation.id);
  const vector = directionVector(direction);
  const plan = planRouteStep(state, blocks, direction);
  const displaced = plan?.displaced ?? [];
  const overflow = plan ? planTerrainOverflow(state, [...plan.relocations, ...displaced]) ?? [] : [];
  const leaving = blocks.filter((block) => !inBounds(state, addPosition(block.position, vector)));
  const departures = leaving.map((block) => ({
    block: { ...block, position: { ...block.position } },
    from: { ...block.position },
    to: addPosition(block.position, vector),
  }));
  if (departures.length > 0) {
    state.departedBlocks ??= [];
    state.departedBlocks.push(...departures);
  }
  const leavingIds = new Set(leaving.map((block) => block.id));
  const survivors = blocks.filter((block) => !leavingIds.has(block.id));
  transferOrRemoveCharacters(state, leaving, survivors);
  for (const block of survivors) {
    block.position = addPosition(block.position, vector);
    block.isContested = false;
  }
  for (const block of leaving) {
    const formation = block.formationId ? state.formations[block.formationId] : undefined;
    if (formation) formation.blockIds = formation.blockIds.filter((blockId) => blockId !== block.id);
    delete state.blocks[block.id];
  }
  for (const { block, destination } of displaced) {
    if (block.formationId) clearFormationBrace(state, block.formationId);
    block.position = { ...destination };
    block.wavering = true;
  }
  applyTerrainOverflow(state, overflow);
  for (const formation of family) {
    formation.facing = direction;
    if (formation.blockIds.length === 0) delete state.formations[formation.id];
  }
  return { escapedBlocks: leaving.length, departures, shaken: displaced.map(({ block }) => block) };
}

function familyHasLivingLeader(state: GameState, family: readonly Formation[]): boolean {
  return familyBlocks(state, family).some((block) => {
    const character = block.characterId ? state.characters[block.characterId] : undefined;
    return Boolean(character && character.status !== "defeated");
  });
}

function rallyFamily(state: GameState, family: Formation[]): void {
  for (const formation of family) {
    formation.cohesion = Math.min(formation.maxCohesion, BALANCE.ralliedMorale);
    formation.status = formation.provisionalFamilyId ? "fragment" : "formed";
    formation.routingActivations = undefined;
    formation.routingStalledActivations = undefined;
    for (const blockId of formation.blockIds) {
      const block = state.blocks[blockId];
      if (block) block.wavering = false;
    }
  }
  emitEvent(state, "formation_rallied", `${family[0]!.name} rallied at ${BALANCE.ralliedMorale} morale.`, {
    blockIds: family.flatMap((formation) => formation.blockIds),
    formationIds: family.map((formation) => formation.id),
  });
}

function clearFamilySelection(state: GameState, formationIds: readonly string[]): void {
  if (state.selectedFormationId && formationIds.includes(state.selectedFormationId)) {
    state.selectedFormationId = null;
    state.selectedBlockId = null;
  }
}

function removeRoutingFamily(state: GameState, family: readonly Formation[], message: string): void {
  const formationIds = family.map((formation) => formation.id);
  const blockIds = family.flatMap((formation) => formation.blockIds);
  for (const blockId of blockIds) {
    const block = state.blocks[blockId];
    if (block?.characterId) delete state.characters[block.characterId];
    delete state.blocks[blockId];
  }
  for (const formationId of formationIds) delete state.formations[formationId];
  clearFamilySelection(state, formationIds);
  emitEvent(state, "formation_escaped", message, { blockIds, formationIds });
}

export function formationFamilyIsRouted(state: GameState, formationId: string): boolean {
  return provisionalFormationFamily(state, formationId).some((formation) => formation.status === "routed");
}

function reportRoutersPouringThrough(state: GameState, routedName: string, shakenIds: ReadonlySet<string>): void {
  if (shakenIds.size === 0) return;
  const formationIds = new Set<string>();
  for (const blockId of shakenIds) {
    const formationId = state.blocks[blockId]?.formationId;
    if (formationId) formationIds.add(formationId);
  }
  emitEvent(state, "formation_wavered", `${routedName} fled through friendly lines; ${shakenIds.size} block${shakenIds.size === 1 ? " is" : "s are"} wavering.`, {
    blockIds: [...shakenIds],
    formationIds: [...formationIds],
  });
  for (const formationId of formationIds) {
    if (state.formations[formationId]) recalculateFormationConnectivity(state, formationId);
  }
}

export function resolveRoutingFormationActivation(state: GameState, formationId: string): RoutingResult {
  const initialFormation = state.formations[formationId];
  if (!initialFormation) return { movedSteps: 0, escapedBlocks: 0, rallied: false, formationEscaped: true };
  let family = provisionalFormationFamily(state, formationId);
  if (!family.some((formation) => formation.status === "routed")) {
    return { movedSteps: 0, escapedBlocks: 0, rallied: false, formationEscaped: false };
  }
  for (const formation of family) {
    formation.cohesion = 0;
    formation.status = "routed";
  }
  const startingName = initialFormation.name;
  const startingFormationIds = family.map((formation) => formation.id);
  const startingBlockIds = family.flatMap((formation) => formation.blockIds);
  const firstRoutingActivation = family.every((formation) => (formation.routingActivations ?? 0) === 0);
  if (firstRoutingActivation) {
    emitEvent(state, "formation_routed", `${startingName} routed and turned away from the fight.`, {
      blockIds: startingBlockIds,
      formationIds: startingFormationIds,
    });
  }

  const movementAllowance = Math.max(...family.map((formation) => formation.unit.movement), 0);
  let escapedBlocks = 0;
  let movedSteps = 0;
  const departures: BlockDeparture[] = [];
  const shakenIds = new Set<string>();
  let heading = routeDirection(
    state,
    familyBlocks(state, family),
    enemyBlocks(state, initialFormation.factionId),
    initialFormation.facing,
  );
  for (let step = 0; step < movementAllowance; step += 1) {
    family = family.filter((formation) => state.formations[formation.id]);
    const blocks = familyBlocks(state, family);
    if (blocks.length === 0) break;
    if (!heading || !routeStepIsLegal(state, blocks, heading)) {
      heading = routeDirection(
        state,
        blocks,
        enemyBlocks(state, initialFormation.factionId),
        family[0]?.facing ?? initialFormation.facing,
      );
    }
    if (!heading) break;
    const stepResult = moveRoutingStep(state, family, heading);
    escapedBlocks += stepResult.escapedBlocks;
    departures.push(...stepResult.departures);
    for (const block of stepResult.shaken) shakenIds.add(block.id);
    movedSteps += 1;
  }

  reportRoutersPouringThrough(state, startingName, shakenIds);
  family = family.filter((formation) => state.formations[formation.id]);
  if (family.length === 0) {
    emitEvent(state, "formation_escaped", `${startingName} fled from the battlefield and was removed from play.`, {
      blockIds: startingBlockIds,
      formationIds: startingFormationIds,
      departingBlocks: departures,
    });
    clearFamilySelection(state, startingFormationIds);
    return { movedSteps, escapedBlocks, rallied: false, formationEscaped: true };
  }

  const routingActivations = Math.max(...family.map((formation) => formation.routingActivations ?? 0)) + 1;
  for (const formation of family) {
    formation.routingActivations = routingActivations;
    formation.status = "routed";
    formation.hasActivated = true;
    formation.movementRemaining = 0;
  }
  const blocks = familyBlocks(state, family);
  if (movedSteps > 0) {
    emitEvent(state, "formation_moved", `${startingName} fled ${movedSteps} square${movedSteps === 1 ? "" : "s"}${escapedBlocks > 0 ? `; ${escapedBlocks} block${escapedBlocks === 1 ? "" : "s"} left the battlefield` : ""}.`, {
      blockIds: blocks.map((block) => block.id),
      formationIds: family.map((formation) => formation.id),
      departingBlocks: departures,
    });
  }
  const hasLeader = familyHasLivingLeader(state, family);
  const rallyAfter = hasLeader
    ? BALANCE.routedRallyActivationsWithLeader
    : BALANCE.routedRallyActivationsWithoutLeader;
  const safe = nearestEnemyDistance(blocks, enemyBlocks(state, initialFormation.factionId)) >= BALANCE.routedRallyDistance;
  const rallied = safe && routingActivations >= rallyAfter;
  const stalledActivations = movedSteps === 0 && !safe
    ? Math.max(...family.map((formation) => formation.routingStalledActivations ?? 0)) + 1
    : 0;
  for (const formation of family) formation.routingStalledActivations = stalledActivations || undefined;
  if (rallied) {
    rallyFamily(state, family);
  } else if (stalledActivations >= BALANCE.routedMaximumStalledActivations) {
    removeRoutingFamily(state, family, `${startingName} was trapped while routing and dispersed.`);
    return { movedSteps, escapedBlocks, rallied: false, formationEscaped: true };
  }
  return { movedSteps, escapedBlocks, rallied, formationEscaped: false };
}

export function resolveAutomaticRoutingActivations(state: GameState, factionId: FactionId): number {
  const seen = new Set<string>();
  const routedFormationIds = Object.values(state.formations)
    .filter((formation) => formation.factionId === factionId && !formation.hasActivated)
    .filter((formation) => formationFamilyIsRouted(state, formation.id))
    .filter((formation) => {
      const key = formation.provisionalFamilyId ?? formation.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((formation) => formation.id)
    .sort((a, b) => a.localeCompare(b));
  for (const formationId of routedFormationIds) resolveRoutingFormationActivation(state, formationId);
  return routedFormationIds.length;
}

export function disperseRemainingRoutedFormations(state: GameState): number {
  const seen = new Set<string>();
  const routedFormationIds = Object.values(state.formations)
    .filter((formation) => formationFamilyIsRouted(state, formation.id))
    .filter((formation) => {
      const key = formation.provisionalFamilyId ?? formation.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((formation) => formation.id)
    .sort((a, b) => a.localeCompare(b));
  for (const formationId of routedFormationIds) {
    const family = provisionalFormationFamily(state, formationId);
    if (family.length > 0) removeRoutingFamily(state, family, `${family[0]!.name} could not escape or rally and dispersed.`);
  }
  return routedFormationIds.length;
}
