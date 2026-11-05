import { BALANCE } from "../model/config";
import { friendlyBlockAt } from "../model/occupancy";
import type { Formation, GameState } from "../model/types";
import { emitEvent } from "../events/events";
import { orthogonalNeighbours } from "./direction";
import { originalFormationId, provisionalFormationFamily, familyDisplayName } from "./splitting";
import { formationModelCount } from "../model/unitStats";

function shockFormation(formation: Formation, loss: number): void {
  formation.cohesion = Math.max(0, formation.cohesion - loss);
  if (formation.cohesion === 0) formation.status = "routed";
  else if (formation.cohesion <= BALANCE.breakingMoraleThreshold) formation.status = "breaking";
}

/** Every morale loss inside `resolve` counts as one order, so frontage cannot multiply it. */
export function withMoraleOrder<T>(state: GameState, resolve: () => T): T {
  state.moraleOrder = { lost: {}, pushed: {} };
  try {
    return resolve();
  } finally {
    delete state.moraleOrder;
  }
}

function formationModels(state: GameState, formation: Formation): number {
  return formationModelCount(state, formation);
}

function moraleFamily(state: GameState, formationId: string): Formation[] {
  return provisionalFormationFamily(state, formationId).filter((formation) => state.formations[formation.id]);
}

function familyModels(state: GameState, formationId: string): number {
  return moraleFamily(state, formationId).reduce((total, formation) => total + formationModels(state, formation), 0);
}

/** Applies a morale loss within the order's allowance and returns what was actually lost. */
function shockMoraleFamily(state: GameState, formationId: string, loss: number): number {
  const key = originalFormationId(formationId);
  const lostThisOrder = state.moraleOrder?.lost[key] ?? 0;
  const actualLoss = state.moraleOrder ? Math.min(loss, BALANCE.moraleLossPerOrder - lostThisOrder) : loss;
  if (actualLoss <= 0) return 0;
  if (state.moraleOrder) state.moraleOrder.lost[key] = lostThisOrder + actualLoss;
  applyMoraleLoss(state, formationId, actualLoss);
  return actualLoss;
}

export function applyMoraleLoss(state: GameState, formationId: string, loss: number): void {
  const family = moraleFamily(state, formationId);
  const alreadyRouted = family.some((formation) => formation.status === "routed");
  for (const formation of family) shockFormation(formation, loss);
  if (!alreadyRouted && family.some((formation) => formation.status === "routed")) shakeFormationsBeside(state, family);
}

/** A rout is contagious: each steady neighbouring formation loses morale once when the line beside it breaks. */
function shakeFormationsBeside(state: GameState, routed: readonly Formation[]): void {
  const routedIds = new Set(routed.map((formation) => formation.id));
  const neighbours = new Set<string>();
  for (const formation of routed) {
    for (const blockId of formation.blockIds) {
      const block = state.blocks[blockId];
      if (!block) continue;
      for (const position of orthogonalNeighbours(block.position)) {
        const friend = friendlyBlockAt(state, position, block.factionId);
        if (friend?.formationId && !routedIds.has(friend.formationId)) neighbours.add(originalFormationId(friend.formationId));
      }
    }
  }
  const name = (routed[0] ? familyDisplayName(routed[0].name) : "A neighbouring formation");
  for (const originalId of [...neighbours].sort()) {
    const member = Object.values(state.formations).find((formation) => originalFormationId(formation.id) === originalId);
    if (!member || member.status === "routed") continue;
    const lost = shockMoraleFamily(state, member.id, BALANCE.neighbourRoutMoraleLoss);
    if (lost <= 0) continue;
    emitEvent(state, "morale_shock", `${member.name} lost ${lost} morale as ${name} broke beside it.`, {
      blockIds: [...member.blockIds],
      formationIds: [member.id],
    });
  }
}

/** Being shoved costs morale once per order, however many files were pushed. */
export function shockPushedFormation(state: GameState, formationId: string): void {
  const key = originalFormationId(formationId);
  if (state.moraleOrder?.pushed[key]) return;
  if (state.moraleOrder) state.moraleOrder.pushed[key] = true;
  const lost = shockMoraleFamily(state, formationId, BALANCE.pushedMoraleLoss);
  if (lost <= 0) return;
  const family = moraleFamily(state, formationId);
  emitEvent(state, "morale_shock", `${family[0]?.name ?? "The formation"} lost ${lost} morale: pushed back.`, {
    blockIds: family.flatMap((formation) => formation.blockIds),
    formationIds: family.map((formation) => formation.id),
  });
}

export function applyCasualtyThresholds(state: GameState, formationId: string | null): void {
  if (!formationId || !state.formations[formationId]) return;
  const family = moraleFamily(state, formationId);
  if (family.length === 0) return;
  const initialModels = Math.max(...family.map((formation) => formation.initialModelCount));
  const currentModels = family.reduce((total, formation) => total + formationModels(state, formation), 0);
  const previousStage = Math.max(...family.map((formation) => formation.casualtyMoraleStage));
  const remainingRatio = initialModels > 0 ? currentModels / initialModels : 0;
  if (remainingRatio <= BALANCE.casualtyRoutRemainingRatio && !family.some((formation) => formation.status === "routed")) {
    const name = familyDisplayName(family[0]!.name);
    applyMoraleLoss(state, formationId, Math.max(...family.map((formation) => formation.cohesion)));
    emitEvent(state, "morale_shock", `${name} fell to ${Math.round(BALANCE.casualtyRoutRemainingRatio * 100)}% of its models and broke.`, {
      blockIds: family.flatMap((formation) => formation.blockIds),
      formationIds: family.map((formation) => formation.id),
    });
    return;
  }
  let nextStage = previousStage;
  let moraleLoss = 0;
  for (let index = previousStage; index < BALANCE.casualtyMoraleThresholds.length; index += 1) {
    const threshold = BALANCE.casualtyMoraleThresholds[index]!;
    if (remainingRatio > threshold.remainingRatio) break;
    nextStage = index + 1;
    moraleLoss += threshold.moraleLoss;
  }
  if (nextStage === previousStage) return;
  for (const formation of family) formation.casualtyMoraleStage = nextStage;
  const lost = shockMoraleFamily(state, formationId, moraleLoss);
  if (lost <= 0) return;
  const crossed = BALANCE.casualtyMoraleThresholds[nextStage - 1]!;
  const name = familyDisplayName(family[0]!.name);
  emitEvent(state, "morale_shock", `${name} fell to ${Math.round(crossed.remainingRatio * 100)}% of its models and lost ${lost} morale.`, {
    blockIds: family.flatMap((formation) => formation.blockIds),
    formationIds: family.map((formation) => formation.id),
  });
}

export function applyTacticalMoraleShock(
  state: GameState,
  formationId: string,
  enemyFormationIds: readonly string[],
  worstContactEdge: "front" | "side" | "rear",
): void {
  const formation = state.formations[formationId];
  if (!formation) return;
  const family = moraleFamily(state, formationId);
  if (family.length === 0) return;
  let moraleLoss = 0;
  const reasons: string[] = [];
  if (worstContactEdge !== "front" && family.every((candidate) => candidate.lastFlankShockRound !== state.round)) {
    moraleLoss += worstContactEdge === "rear" ? BALANCE.rearFlankMoraleLoss : BALANCE.sideFlankMoraleLoss;
    reasons.push(worstContactEdge === "rear" ? "attacked from the rear" : "flanked");
    for (const candidate of family) candidate.lastFlankShockRound = state.round;
  }
  const enemyFamilies = new Map<string, string>();
  for (const enemyFormationId of enemyFormationIds) {
    const enemy = state.formations[enemyFormationId];
    if (enemy) enemyFamilies.set(enemy.provisionalFamilyId ?? enemy.id, enemy.id);
  }
  const enemyModels = [...enemyFamilies.values()].reduce((total, id) => total + familyModels(state, id), 0);
  const ownModels = familyModels(state, formationId);
  const ratio = ownModels > 0 ? enemyModels / ownModels : Number.POSITIVE_INFINITY;
  if (ratio >= BALANCE.outnumberedRatio
    && family.every((candidate) => candidate.lastOutnumberedShockRound !== state.round)) {
    moraleLoss += BALANCE.outnumberedMoraleLoss;
    reasons.push("outnumbered");
    for (const candidate of family) candidate.lastOutnumberedShockRound = state.round;
  }
  if (moraleLoss <= 0) return;
  const lost = shockMoraleFamily(state, formationId, moraleLoss);
  if (lost <= 0) return;
  emitEvent(state, "morale_shock", `${formation.name} lost ${lost} morale: ${reasons.join(" and ")}.`, {
    blockIds: family.flatMap((candidate) => candidate.blockIds),
    formationIds: family.map((candidate) => candidate.id),
  });
}

export function applyLeaderLossShock(state: GameState, formationId: string | null, characterName: string): void {
  if (!formationId || !state.formations[formationId]) return;
  const family = moraleFamily(state, formationId);
  applyMoraleLoss(state, formationId, BALANCE.leaderDeathMoraleLoss);
  emitEvent(state, "morale_shock", `${family[0]?.name ?? "The formation"} lost ${BALANCE.leaderDeathMoraleLoss} morale when ${characterName} fell.`, {
    blockIds: family.flatMap((formation) => formation.blockIds),
    formationIds: family.map((formation) => formation.id),
  });
}
