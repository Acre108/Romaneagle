import { emitEvent } from "../events/events";
import { blocksAt, enemyBlockAt, inBounds, positionKey } from "../model/occupancy";
import { terrainAt, terrainBlocksVoluntaryMovement } from "../model/terrain";
import type { Direction, Formation, GameState, GridPosition, TroopBlock } from "../model/types";
import { BALANCE } from "../model/config";
import { addPosition, directionBetween, directionVector, formationEdgeType, manhattanDistance, oppositeDirection, orthogonalNeighbours, rotateDirection } from "./direction";
import { applyTacticalMoraleShock, damageBlock, meleeDamagePreview, pressurePreview, resolvePressure } from "./combat";
import { canTranslateFormation, formationBlocks, translateFormation, type RuleResult } from "./movement";
import { originalFormationId, provisionalFormationFamily, recalculateFormationConnectivity } from "./splitting";
import { effectiveBlockFacing, faceFormationTowardNearestEnemies } from "./blockFacing";
import { applyTerrainOverflow, planTerrainOverflow } from "./terrainOverflow";
import { clearFormationBrace } from "./brace";
import { advanceCombatFile } from "./fileAdvance";

export interface EngagedContact {
  attackerId: string;
  defenderId: string;
}

function adjacentEnemy(state: GameState, block: TroopBlock): boolean {
  return block.isContested || orthogonalNeighbours(block.position)
    .some((position) => Boolean(enemyBlockAt(state, position, block.factionId)));
}

export function formationIsEngaged(state: GameState, formationId: string): boolean {
  const formation = state.formations[formationId];
  return Boolean(formation && formationBlocks(state, formation).some((block) => adjacentEnemy(state, block)));
}

export function blockIsWavering(state: GameState, blockId: string): boolean {
  const block = state.blocks[blockId];
  const formation = block?.formationId ? state.formations[block.formationId] : undefined;
  return Boolean(block && (block.disorder >= BALANCE.waveringDisorderThreshold
    || (formation?.cohesion ?? 0) <= BALANCE.breakingMoraleThreshold));
}

function contactDirections(facing: Direction): Direction[] {
  return [
    facing,
    rotateDirection(facing, "left"),
    rotateDirection(facing, "right"),
    oppositeDirection(facing),
  ];
}

export function engagedContacts(state: GameState, formationId: string): EngagedContact[] {
  const formation = state.formations[formationId];
  if (!formation) return [];
  const contacts: EngagedContact[] = [];
  const attackers = [...formationBlocks(state, formation)].sort((a, b) => a.id.localeCompare(b.id));
  const claimedDefenders = new Set<string>();
  const candidates = new Map<string, string[]>();
  for (const attacker of attackers) {
    if (attacker.isContested) {
      const defender = blocksAt(state, attacker.position).find((block) => block.factionId !== attacker.factionId);
      if (defender) {
        contacts.push({ attackerId: attacker.id, defenderId: defender.id });
        claimedDefenders.add(defender.id);
      }
      continue;
    }
    const defenderIds: string[] = [];
    for (const direction of contactDirections(effectiveBlockFacing(state, attacker.id))) {
      const defender = enemyBlockAt(state, addPosition(attacker.position, directionVector(direction)), attacker.factionId);
      if (defender && !claimedDefenders.has(defender.id)) defenderIds.push(defender.id);
    }
    if (defenderIds.length > 0) candidates.set(attacker.id, defenderIds);
  }

  const defenderAssignments = new Map<string, string>();
  const assign = (attackerId: string, visited: Set<string>): boolean => {
    for (const defenderId of candidates.get(attackerId) ?? []) {
      if (visited.has(defenderId)) continue;
      visited.add(defenderId);
      const currentAttackerId = defenderAssignments.get(defenderId);
      if (!currentAttackerId || assign(currentAttackerId, visited)) {
        defenderAssignments.set(defenderId, attackerId);
        return true;
      }
    }
    return false;
  };
  for (const attacker of attackers) if (candidates.has(attacker.id)) assign(attacker.id, new Set<string>());
  const uniquelyAssignedAttackers = new Set(defenderAssignments.values());
  contacts.push(...[...defenderAssignments.entries()]
    .map(([defenderId, attackerId]) => ({ attackerId, defenderId }))
    .sort((a, b) => a.attackerId.localeCompare(b.attackerId)));
  for (const attacker of attackers) {
    if (uniquelyAssignedAttackers.has(attacker.id)) continue;
    const defenderId = candidates.get(attacker.id)?.[0];
    if (defenderId) contacts.push({ attackerId: attacker.id, defenderId });
  }
  contacts.sort((a, b) => a.attackerId.localeCompare(b.attackerId));
  return contacts;
}

function positionComponentCount(positions: readonly GridPosition[]): number {
  const remaining = new Set(positions.map(positionKey));
  let components = 0;
  while (remaining.size > 0) {
    components += 1;
    const start = remaining.values().next().value as string;
    const queue = [start];
    remaining.delete(start);
    while (queue.length > 0) {
      const [x, y] = queue.pop()!.split(",").map(Number) as [number, number];
      for (const neighbour of orthogonalNeighbours({ x, y })) {
        const key = positionKey(neighbour);
        if (!remaining.delete(key)) continue;
        queue.push(key);
      }
    }
  }
  return components;
}

function preservesConnectivity(
  state: GameState,
  formation: Formation,
  movingBlock: TroopBlock,
  destination: GridPosition,
): boolean {
  const before = formationBlocks(state, formation).map((block) => block.position);
  const after = formationBlocks(state, formation).map((block) => block.id === movingBlock.id ? destination : block.position);
  return positionComponentCount(after) <= positionComponentCount(before);
}

function forwardRank(position: GridPosition, facing: Direction): number {
  const forward = directionVector(facing);
  return position.x * forward.x + position.y * forward.y;
}

function canDressBattleLine(
  state: GameState,
  formation: Formation,
  attacker: TroopBlock,
  attackerOrigin: GridPosition,
  destination: GridPosition,
  startingFrontRank: number,
): boolean {
  const advanceDirection = directionBetween(attackerOrigin, destination);
  const terrain = terrainAt(state, destination);
  return advanceDirection === formation.facing
    && forwardRank(destination, formation.facing) <= startingFrontRank
    && !attacker.isContested
    && !blockIsWavering(state, attacker.id)
    && terrain !== undefined
    && !terrainBlocksVoluntaryMovement(terrain);
}

interface ReinforcementResult {
  reinforcedIds: string[];
  emptiedIds: string[];
  transferredSoldiers: number;
}

function enemyDistance(position: GridPosition, enemies: readonly TroopBlock[]): number {
  return Math.min(...enemies.map((enemy) => manhattanDistance(position, enemy.position)));
}

function flankContactPriority(state: GameState, position: GridPosition, factionId: TroopBlock["factionId"]): number {
  let priority = 0;
  for (const neighbour of orthogonalNeighbours(position)) {
    const enemy = enemyBlockAt(state, neighbour, factionId);
    const enemyFormation = enemy?.formationId ? state.formations[enemy.formationId] : undefined;
    const incomingDirection = enemy ? directionBetween(enemy.position, position) : null;
    if (!enemy || !enemyFormation || !incomingDirection) continue;
    const edge = formationEdgeType(effectiveBlockFacing(state, enemy.id), incomingDirection);
    priority = Math.max(priority, edge === "rear" ? 3 : edge === "side" ? 2 : 1);
  }
  return priority;
}

function transferCharacterWithBlock(state: GameState, donor: TroopBlock, formation: Formation, enemies: readonly TroopBlock[]): boolean {
  if (!donor.characterId) return true;
  const character = state.characters[donor.characterId];
  const host = formationBlocks(state, formation)
    .filter((candidate) => candidate.id !== donor.id && !candidate.characterId && !candidate.isContested)
    .sort((a, b) => enemyDistance(a.position, enemies) - enemyDistance(b.position, enemies)
      || a.id.localeCompare(b.id))[0];
  if (!character || !host) return false;
  host.characterId = character.id;
  character.hostBlockId = host.id;
  donor.characterId = null;
  emitEvent(state, "character_transferred", `${character.name} moved forward with the reinforcing soldiers.`, {
    blockIds: [donor.id, host.id], formationIds: [formation.id], position: { ...host.position },
  });
  return true;
}

function reinforceFrontFromRear(
  state: GameState,
  formation: Formation,
  enemies: readonly TroopBlock[],
): ReinforcementResult {
  const reinforcedIds = new Set<string>();
  const emptiedIds: string[] = [];
  let transferredSoldiers = 0;
  const targets = formationBlocks(state, formation)
    .filter((block) => !block.isContested && block.models < block.modelCapacity)
    .sort((a, b) => enemyDistance(a.position, enemies) - enemyDistance(b.position, enemies)
      || a.id.localeCompare(b.id));

  for (const target of targets) {
    let needed = target.modelCapacity - target.models;
    const targetDistance = enemyDistance(target.position, enemies);
    const donors = formationBlocks(state, formation)
      .filter((donor) => donor.id !== target.id && !donor.isContested && !blockIsWavering(state, donor.id))
      .filter((donor) => enemyDistance(donor.position, enemies) > targetDistance)
      .sort((a, b) => enemyDistance(b.position, enemies) - enemyDistance(a.position, enemies)
        || b.id.localeCompare(a.id));
    for (const donor of donors) {
      if (needed <= 0 || !state.blocks[donor.id]) break;
      let transferred = Math.min(needed, donor.models);
      if (transferred === donor.models && donor.characterId
        && !transferCharacterWithBlock(state, donor, formation, enemies)) {
        transferred = Math.min(needed, Math.max(0, donor.models - 1));
      }
      if (transferred <= 0) continue;
      target.models += transferred;
      donor.models -= transferred;
      needed -= transferred;
      transferredSoldiers += transferred;
      reinforcedIds.add(target.id);
      if (donor.models > 0) continue;
      target.wounds += donor.wounds;
      donor.wounds = 0;
      while (target.wounds >= formation.unit.hitPointsPerModel && target.models > 0) {
        target.wounds -= formation.unit.hitPointsPerModel;
        target.models -= 1;
      }
      formation.blockIds = formation.blockIds.filter((id) => id !== donor.id);
      delete state.blocks[donor.id];
      emptiedIds.push(donor.id);
    }
  }
  return { reinforcedIds: [...reinforcedIds], emptiedIds, transferredSoldiers };
}

export function refillFormationFront(state: GameState, formationId: string): string[] {
  const formation = state.formations[formationId];
  if (!formation) return [];
  const enemies = Object.values(state.blocks).filter((block) => block.factionId !== formation.factionId);
  if (enemies.length === 0) return [];
  const reinforcement = reinforceFrontFromRear(state, formation, enemies);
  if (reinforcement.transferredSoldiers <= 0) return [];
  emitEvent(
    state,
    "engagement_closed",
    `${formation.name} refilled its forward blocks: ${reinforcement.transferredSoldiers} soldier${reinforcement.transferredSoldiers === 1 ? "" : "s"} flowed forward${reinforcement.emptiedIds.length > 0 ? ` and emptied ${reinforcement.emptiedIds.length} rear block${reinforcement.emptiedIds.length === 1 ? "" : "s"}` : ""}.`,
    {
      blockIds: [...reinforcement.reinforcedIds, ...reinforcement.emptiedIds],
      formationIds: [formation.id],
    },
  );
  recalculateFormationConnectivity(state, formation.id);
  return reinforcement.emptiedIds;
}

function consolidateTowardEnemy(
  state: GameState,
  formationId: string,
  requireEngaged: boolean,
  movementExclusions: ReadonlySet<string> = new Set<string>(),
  footprint?: { minX: number; maxX: number; minY: number; maxY: number },
): string[] {
  const formation = state.formations[formationId];
  if (!formation || (requireEngaged && !formationIsEngaged(state, formationId))) return [];
  const enemyBlocks = Object.values(state.blocks).filter((block) => block.factionId !== formation.factionId);
  if (enemyBlocks.length === 0) return [];
  const movedIds: string[] = [];
  const overflowIds: string[] = [];
  for (const block of [...formationBlocks(state, formation)].sort((a, b) =>
    enemyDistance(a.position, enemyBlocks) - enemyDistance(b.position, enemyBlocks)
      || a.id.localeCompare(b.id))) {
    if (movementExclusions.has(block.id) || block.isContested
      || adjacentEnemy(state, block) || blockIsWavering(state, block.id)) continue;
    const currentDistance = enemyDistance(block.position, enemyBlocks);
    const candidates = orthogonalNeighbours(block.position)
      .filter((position) => {
        if (!inBounds(state, position)) return false;
        if (footprint && (position.x < footprint.minX || position.x > footprint.maxX
          || position.y < footprint.minY || position.y > footprint.maxY)) return false;
        const terrain = terrainAt(state, position)!;
        return !terrainBlocksVoluntaryMovement(terrain);
      })
      .filter((position) => blocksAt(state, position).length === 0)
      .filter((position) => planTerrainOverflow(state, [{
        block,
        origin: block.position,
        destination: position,
      }]) !== null)
      .filter((position) => enemyDistance(position, enemyBlocks) < currentDistance)
      .filter((position) => preservesConnectivity(state, formation, block, position))
      .sort((a, b) => {
        const flankA = flankContactPriority(state, a, block.factionId);
        const flankB = flankContactPriority(state, b, block.factionId);
        const adjacentA = orthogonalNeighbours(a).filter((position) => Boolean(enemyBlockAt(state, position, block.factionId))).length;
        const adjacentB = orthogonalNeighbours(b).filter((position) => Boolean(enemyBlockAt(state, position, block.factionId))).length;
        const distanceA = enemyDistance(a, enemyBlocks);
        const distanceB = enemyDistance(b, enemyBlocks);
        return flankB - flankA || adjacentB - adjacentA || distanceA - distanceB || a.y - b.y || a.x - b.x;
      });
    const destination = candidates[0];
    if (!destination) continue;
    const overflow = planTerrainOverflow(state, [{
      block,
      origin: { ...block.position },
      destination,
    }]) ?? [];
    clearFormationBrace(state, formation.id);
    block.position = { ...destination };
    overflowIds.push(...applyTerrainOverflow(state, overflow));
    movedIds.push(block.id);
  }
  if (movedIds.length > 0) {
    const movementDescription = footprint
      ? `closed ${movedIds.length} internal formation gap${movedIds.length === 1 ? "" : "s"}`
      : `advanced ${movedIds.length} steady block${movedIds.length === 1 ? "" : "s"} toward enemy contact`;
    emitEvent(state, "engagement_closed", `${formation.name} ${movementDescription}.`, {
      blockIds: [...movedIds, ...overflowIds],
      formationIds: [formation.id],
    });
    recalculateFormationConnectivity(state, formation.id);
  }
  return movedIds;
}

export function closeEngagementGaps(state: GameState, formationId: string): string[] {
  return consolidateTowardEnemy(state, formationId, true);
}

export function canFallBack(state: GameState, formationId: string): RuleResult {
  const formation = state.formations[formationId];
  if (!formation || !formationIsEngaged(state, formationId)) return { ok: false, reason: "Only an engaged formation may fall back." };
  return canTranslateFormation(state, formationId, oppositeDirection(formation.facing));
}

export function fallBackFormation(state: GameState, formationId: string, confirmed = false): RuleResult {
  const legality = canFallBack(state, formationId);
  if (!legality.ok) return legality;
  const formation = state.formations[formationId]!;
  const result = translateFormation(state, formationId, oppositeDirection(formation.facing), confirmed);
  if (result.ok) {
    emitEvent(state, "engaged_order_resolved", `${formation.name} fell back one square in good order.`, {
      blockIds: [...formation.blockIds], formationIds: [formation.id],
    });
  }
  return result;
}

export function resolveEngagedOrder(
  state: GameState,
  formationId: string,
  order: "battle" | "press",
  previewOptions: { defenceRollOverride?: number } = {},
): number {
  const formation = state.formations[formationId];
  if (!formation || !formationIsEngaged(state, formationId)) return 0;
  const participants = provisionalFormationFamily(state, formationId)
    .filter((candidate) => formationIsEngaged(state, candidate.id));
  const startingFootprints = new Map(participants.map((participant) => {
    const blocks = formationBlocks(state, participant);
    return [participant.id, {
      minX: Math.min(...blocks.map((block) => block.position.x)),
      maxX: Math.max(...blocks.map((block) => block.position.x)),
      minY: Math.min(...blocks.map((block) => block.position.y)),
      maxY: Math.max(...blocks.map((block) => block.position.y)),
    }] as const;
  }));
  const startingFrontRanks = new Map(participants.map((participant) => [
    participant.id,
    Math.max(...formationBlocks(state, participant).map((block) => forwardRank(block.position, participant.facing))),
  ] as const));
  for (const participant of participants) faceFormationTowardNearestEnemies(state, participant.id);
  const contacts = participants.flatMap((candidate) => engagedContacts(state, candidate.id));
  const movementExclusions = new Set<string>();
  const counteredDefenders = new Set<string>();
  const tacticalShocks = new Map<string, {
    formationId: string;
    enemyFormationIds: Set<string>;
    worstContactEdge: "front" | "side" | "rear";
  }>();
  const registerTacticalContact = (
    target: TroopBlock,
    enemy: TroopBlock,
    contactEdge: "front" | "side" | "rear",
  ): void => {
    if (!target.formationId || !enemy.formationId) return;
    const targetFormation = state.formations[target.formationId];
    if (!targetFormation) return;
    const key = targetFormation.provisionalFamilyId ?? targetFormation.id;
    const existing = tacticalShocks.get(key) ?? {
      formationId: targetFormation.id,
      enemyFormationIds: new Set<string>(),
      worstContactEdge: "front" as const,
    };
    existing.enemyFormationIds.add(enemy.formationId);
    const priority = { front: 0, side: 1, rear: 2 } as const;
    if (priority[contactEdge] > priority[existing.worstContactEdge]) existing.worstContactEdge = contactEdge;
    tacticalShocks.set(key, existing);
  };
  const moraleBaselines = new Map<string, number>();
  for (const candidate of Object.values(state.formations)) {
    const originalId = originalFormationId(candidate.id);
    moraleBaselines.set(originalId, Math.max(moraleBaselines.get(originalId) ?? 0, candidate.cohesion));
  }
  for (const contact of contacts) {
    const attacker = state.blocks[contact.attackerId];
    const defender = state.blocks[contact.defenderId];
    if (!attacker || !defender) continue;
    const defenderIncoming = directionBetween(defender.position, attacker.position);
    const attackerIncoming = directionBetween(attacker.position, defender.position);
    const defenderFormation = defender.formationId ? state.formations[defender.formationId] : undefined;
    const attackerFormation = attacker.formationId ? state.formations[attacker.formationId] : undefined;
    if (defenderIncoming && defenderFormation) registerTacticalContact(
      defender,
      attacker,
      formationEdgeType(defenderFormation.facing, defenderIncoming),
    );
    if (attackerIncoming && attackerFormation) registerTacticalContact(
      attacker,
      defender,
      formationEdgeType(attackerFormation.facing, attackerIncoming),
    );
  }
  for (const shock of tacticalShocks.values()) {
    applyTacticalMoraleShock(
      state,
      shock.formationId,
      [...shock.enemyFormationIds],
      shock.worstContactEdge,
    );
  }
  let resolved = 0;
  let counterattacks = 0;
  const resolveContact = (contact: EngagedContact): boolean => {
    const attacker = state.blocks[contact.attackerId];
    const defender = state.blocks[contact.defenderId];
    if (!attacker || !defender) return false;
    const attackerOrigin = { ...attacker.position };
    const defenderOrigin = { ...defender.position };
    const defenderFormation = defender.formationId ? state.formations[defender.formationId] : undefined;
    const counter = !attacker.isContested && !defender.isContested && !counteredDefenders.has(defender.id)
      ? meleeDamagePreview(state, defender.id, attacker.id, previewOptions.defenceRollOverride)
      : null;
    const options = {
      allowAnyContact: true,
      pressureBonus: order === "press" ? BALANCE.pressPressureBonus : 0,
      damagePenalty: order === "press" ? BALANCE.pressDamagePenalty : 0,
      followUp: false,
      retreatRequiresMoraleLoss: order === "battle",
      retreatMoraleBaseline: defenderFormation
        ? moraleBaselines.get(originalFormationId(defenderFormation.id))
        : undefined,
      defenceRollOverride: previewOptions.defenceRollOverride,
    };
    if (!pressurePreview(state, contact.attackerId, contact.defenderId, options)) return false;
    const result = resolvePressure(state, contact.attackerId, contact.defenderId, options);
    if (!result.ok) return false;
    resolved += 1;
    if (counter) {
      counteredDefenders.add(defender.id);
      counterattacks += 1;
      emitEvent(
        state,
        "counterattack_resolved",
        `${defender.id} counterattacked ${attacker.id} for ${counter.expectedCasualties} ${counter.expectedCasualties === 1 ? "casualty" : "casualties"}.`,
        {
          blockIds: [defender.id, attacker.id],
          formationIds: [defender.formationId, attacker.formationId].filter((id): id is string => Boolean(id)),
          position: attackerOrigin,
          casualties: counter.expectedCasualties,
        },
      );
      damageBlock(state, attacker.id, counter.expectedCasualties, "counterattack");
    }
    const survivingAttacker = state.blocks[contact.attackerId];
    if (result.vacated && survivingAttacker) {
      const attackerFormation = attacker.formationId ? state.formations[attacker.formationId] : undefined;
      const dressesBattleLine = order === "battle" && attackerFormation
        ? canDressBattleLine(
          state,
          attackerFormation,
          survivingAttacker,
          attackerOrigin,
          defenderOrigin,
          startingFrontRanks.get(attackerFormation.id) ?? Number.NEGATIVE_INFINITY,
        )
        : false;
      if (attackerFormation && (order === "press" || dressesBattleLine)) {
        for (const movedId of advanceCombatFile(state, attackerFormation, contact.attackerId, attackerOrigin, defenderOrigin)) {
          movementExclusions.add(movedId);
        }
      }
    }
    return true;
  };
  for (const contact of contacts) resolveContact(contact);
  if (resolved > 0) {
    const gapCloserIds = new Set<string>();
    for (const participant of participants) {
      if (state.formations[participant.id]) {
        for (const movedId of consolidateTowardEnemy(
          state,
          participant.id,
          false,
          movementExclusions,
          order === "battle" ? startingFootprints.get(participant.id) : undefined,
        )) gapCloserIds.add(movedId);
      }
    }
    for (const participant of participants) {
      if (state.formations[participant.id] && formationIsEngaged(state, participant.id)) {
        faceFormationTowardNearestEnemies(state, participant.id);
      }
    }
    if (order === "battle" && gapCloserIds.size > 0) {
      const closingContacts = participants
        .filter((participant) => state.formations[participant.id])
        .flatMap((participant) => engagedContacts(state, participant.id))
        .filter((contact) => gapCloserIds.has(contact.attackerId));
      for (const contact of closingContacts) resolveContact(contact);
    }
    for (const participant of participants) {
      if (state.formations[participant.id]) refillFormationFront(state, participant.id);
    }
    for (const participant of participants) {
      if (state.formations[participant.id] && formationIsEngaged(state, participant.id)) {
        faceFormationTowardNearestEnemies(state, participant.id);
      }
    }
    const groupDescription = participants.length > 1 ? ` across ${participants.length} provisional groups` : "";
    emitEvent(state, "engaged_order_resolved", `${formation.name} chose to ${order}; ${resolved} block${resolved === 1 ? "" : "s"} fought and ${counterattacks} defender${counterattacks === 1 ? "" : "s"} counterattacked${groupDescription}.`, {
      blockIds: participants.flatMap((candidate) => candidate.blockIds),
      formationIds: participants.map((candidate) => candidate.id),
    });
  }
  return resolved;
}
