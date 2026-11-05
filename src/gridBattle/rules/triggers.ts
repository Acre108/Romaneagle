import { emitEvent, eventsSince } from "../events/events";
import { blocksAt, inBounds, positionKey } from "../model/occupancy";
import { terrainBlockCapacityAt } from "../model/terrain";
import type { MapTriggerDefinition, MapTriggerEffect, TriggerSpawnFormation } from "../model/triggerDefinitions";
import { createFormation, createTroopBlock } from "../model/battleStateFactory";
import type { Direction, Formation, GameEvent, GameState } from "../model/types";
import { modelCapacity } from "../model/unitStats";
import { pressurePreview, resolvePressure } from "./combat";
import { CARDINAL_DIRECTIONS, directionBetween, directionVector, manhattanDistance } from "./direction";
import { canTranslateFormation, finishFormationMove, translateFormation } from "./movement";

const RELOCATION_EVENTS = new Set<GameEvent["type"]>([
  "formation_moved",
  "block_advanced",
  "block_retreated",
  "chaotic_retreat",
  "engagement_closed",
  "terrain_overflow",
]);

function formationIdsForEvent(state: GameState, event: GameEvent): string[] {
  const ids = new Set(event.formationIds ?? []);
  for (const blockId of event.blockIds ?? []) {
    const formationId = state.blocks[blockId]?.formationId;
    if (formationId) ids.add(formationId);
  }
  return [...ids];
}

function formationOccupiesAny(state: GameState, formationId: string, keys: Set<string>): boolean {
  const formation = state.formations[formationId];
  return Boolean(formation?.blockIds.some((blockId) => {
    const block = state.blocks[blockId];
    return block !== undefined && keys.has(positionKey(block.position));
  }));
}

function conditionMatches(state: GameState, trigger: MapTriggerDefinition, events: readonly GameEvent[]): boolean {
  const condition = trigger.condition;
  if (condition.type === "round_starts") {
    return state.round === condition.round && events.some((event) => event.type === "round_started");
  }
  if (condition.type === "formation_destroyed") {
    const destroyed = !state.formations[condition.formationId]
      || state.formations[condition.formationId]!.blockIds.length === 0;
    return destroyed && events.some((event) =>
      event.type === "block_destroyed" && event.formationIds?.includes(condition.formationId));
  }
  const keys = new Set(condition.positions.map(positionKey));
  return events.some((event) => {
    if (!RELOCATION_EVENTS.has(event.type)) return false;
    return formationIdsForEvent(state, event).some((formationId) => {
      const formation = state.formations[formationId];
      return formation !== undefined
        && (!condition.factionId || formation.factionId === condition.factionId)
        && formationOccupiesAny(state, formationId, keys);
    });
  });
}

function failEffect(state: GameState, triggerId: string, message: string): false {
  emitEvent(state, "trigger_failed", message, { triggerId });
  return false;
}

function spawnFormation(state: GameState, triggerId: string, spec: TriggerSpawnFormation): boolean {
  if (state.formations[spec.id]) return failEffect(state, triggerId, `Trigger could not spawn ${spec.name}: formation id ${spec.id} already exists.`);
  const blockIds = spec.positions.map((_, index) => `${spec.id}-b${index + 1}`);
  if (blockIds.some((id) => state.blocks[id])) {
    return failEffect(state, triggerId, `Trigger could not spawn ${spec.name}: one of its block ids already exists.`);
  }
  if (new Set(spec.positions.map(positionKey)).size !== spec.positions.length) {
    return failEffect(state, triggerId, `Trigger could not spawn ${spec.name}: its footprint contains duplicate squares.`);
  }
  const formation: Formation = {
    ...createFormation({
      id: spec.id,
      factionId: spec.factionId,
      name: spec.name,
      facing: spec.facing,
      formationMode: spec.formationMode,
      unit: { ...spec.unit, equipment: [...spec.unit.equipment] },
      cohesion: spec.cohesion,
      maxCohesion: spec.maxCohesion,
    }),
    blockIds,
  };
  const capacity = modelCapacity(formation);
  const illegalPosition = spec.positions.find((position) =>
    !inBounds(state, position)
    || blocksAt(state, position).length > 0
    || terrainBlockCapacityAt(state, position, capacity) < capacity);
  if (illegalPosition) {
    return failEffect(state, triggerId, `Trigger could not spawn ${spec.name}: square ${illegalPosition.x},${illegalPosition.y} is occupied or cannot hold a full block.`);
  }
  formation.initialModelCount = capacity * spec.positions.length;
  state.formations[formation.id] = formation;
  spec.positions.forEach((position, index) => {
    const block = createTroopBlock(blockIds[index]!, formation, position, capacity, capacity);
    state.blocks[block.id] = block;
  });
  emitEvent(state, "trigger_spawned", `${formation.name} entered the battlefield.`, {
    triggerId,
    formationIds: [formation.id],
    blockIds: [...formation.blockIds],
    targetPositions: spec.positions.map((position) => ({ ...position })),
  });
  return true;
}

interface ContactPair {
  attackerId: string;
  defenderId: string;
  distance: number;
}

function nearestEnemyPair(state: GameState, formation: Formation, targetFactionId: Formation["factionId"]): ContactPair | null {
  const targets = Object.values(state.blocks)
    .filter((block) => block.factionId === targetFactionId)
    .sort((a, b) => a.id.localeCompare(b.id));
  let best: ContactPair | null = null;
  for (const attackerId of [...formation.blockIds].sort()) {
    const attacker = state.blocks[attackerId];
    if (!attacker) continue;
    for (const defender of targets) {
      const distance = manhattanDistance(attacker.position, defender.position);
      if (!best || distance < best.distance
        || (distance === best.distance && `${attacker.id}:${defender.id}` < `${best.attackerId}:${best.defenderId}`)) {
        best = { attackerId: attacker.id, defenderId: defender.id, distance };
      }
    }
  }
  return best;
}

function projectedNearestDistance(state: GameState, formation: Formation, targetFactionId: Formation["factionId"], direction: Direction): number {
  const vector = directionVector(direction);
  const targets = Object.values(state.blocks).filter((block) => block.factionId === targetFactionId);
  let nearest = Number.POSITIVE_INFINITY;
  for (const blockId of formation.blockIds) {
    const block = state.blocks[blockId];
    if (!block) continue;
    const projected = { x: block.position.x + vector.x, y: block.position.y + vector.y };
    for (const target of targets) nearest = Math.min(nearest, manhattanDistance(projected, target.position));
  }
  return nearest;
}

function activateToAttack(state: GameState, triggerId: string, formationId: string, targetFactionId: Formation["factionId"]): boolean {
  let formation = state.formations[formationId];
  if (!formation) return failEffect(state, triggerId, `Trigger could not activate missing formation ${formationId}.`);
  if (formation.factionId === targetFactionId) {
    return failEffect(state, triggerId, `Trigger could not activate ${formation.name} against its own faction.`);
  }
  formation.hasActivated = false;
  formation.movementRemaining = formation.unit.movement;
  let moved = 0;
  let attacked = false;
  for (let step = 0; step < 32; step += 1) {
    formation = state.formations[formationId];
    if (!formation) break;
    const pair = nearestEnemyPair(state, formation, targetFactionId);
    if (!pair) return failEffect(state, triggerId, `Trigger could not activate ${formation.name}: no target remains.`);
    if (pair.distance === 1) {
      const attacker = state.blocks[pair.attackerId]!;
      const defender = state.blocks[pair.defenderId]!;
      const facing = directionBetween(attacker.position, defender.position)!;
      finishFormationMove(state, formation.id, facing);
      const legalPair = [...formation.blockIds].sort().flatMap((attackerId) =>
        Object.values(state.blocks)
          .filter((candidate) => candidate.factionId === targetFactionId)
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((candidate) => ({ attackerId, defenderId: candidate.id })))
        .find((candidate) => pressurePreview(state, candidate.attackerId, candidate.defenderId) !== null);
      if (legalPair) attacked = resolvePressure(state, legalPair.attackerId, legalPair.defenderId).ok;
      break;
    }
    const direction = [...CARDINAL_DIRECTIONS]
      .filter((candidate) => canTranslateFormation(state, formation!.id, candidate).ok)
      .map((candidate) => ({ candidate, distance: projectedNearestDistance(state, formation!, targetFactionId, candidate) }))
      .filter((candidate) => candidate.distance < pair.distance)
      .sort((a, b) => a.distance - b.distance || CARDINAL_DIRECTIONS.indexOf(a.candidate) - CARDINAL_DIRECTIONS.indexOf(b.candidate))[0]?.candidate;
    if (!direction || !translateFormation(state, formation.id, direction, true).ok) break;
    moved += 1;
  }
  formation = state.formations[formationId];
  if (formation) {
    formation.hasActivated = true;
    formation.movementRemaining = 0;
  }
  emitEvent(state, "trigger_ai_activated", `${formation?.name ?? formationId} ${attacked ? "advanced and attacked" : moved > 0 ? "advanced toward its target" : "activated but could not advance"}.`, {
    triggerId,
    formationIds: formation ? [formation.id] : [formationId],
    blockIds: formation ? [...formation.blockIds] : undefined,
  });
  return true;
}

function executeEffect(state: GameState, triggerId: string, effect: MapTriggerEffect): boolean {
  if (effect.type === "character_interaction") {
    state.triggerState.interactions.push({
      triggerId,
      characterId: effect.characterId,
      speaker: effect.speaker,
      text: effect.text,
    });
    emitEvent(state, "trigger_interaction", `${effect.speaker}: ${effect.text}`, { triggerId });
    return true;
  }
  if (effect.type === "spawn_formation") return spawnFormation(state, triggerId, effect.formation);
  return activateToAttack(state, triggerId, effect.formationId, effect.targetFactionId);
}

/** Evaluates newly emitted command events. A trigger can fire at most once per evaluation pass. */
export function evaluateMapTriggers(state: GameState, sourceEvents: readonly GameEvent[]): void {
  if (sourceEvents.length === 0 || state.battlefield.triggers.length === 0) return;
  const availableEvents = [...sourceEvents];
  const firedThisEvaluation = new Set<string>();
  for (let pass = 0; pass < state.battlefield.triggers.length; pass += 1) {
    let firedInPass = false;
    for (const trigger of state.battlefield.triggers) {
      if (firedThisEvaluation.has(trigger.id)
        || (trigger.once && (state.triggerState.fireCounts[trigger.id] ?? 0) > 0)
        || !conditionMatches(state, trigger, availableEvents)) continue;
      firedThisEvaluation.add(trigger.id);
      firedInPass = true;
      state.triggerState.fireCounts[trigger.id] = (state.triggerState.fireCounts[trigger.id] ?? 0) + 1;
      const firstEffectEventId = state.nextEventId;
      emitEvent(state, "trigger_fired", `${trigger.label} triggered.`, { triggerId: trigger.id });
      for (const effect of trigger.effects) executeEffect(state, trigger.id, effect);
      availableEvents.push(...eventsSince(state.eventLog, firstEffectEventId));
    }
    if (!firedInPass) break;
  }
}
