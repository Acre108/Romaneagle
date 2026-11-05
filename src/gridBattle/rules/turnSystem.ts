import { BALANCE } from "../model/config";
import type { FactionId, Formation, GameState } from "../model/types";
import { emitEvent } from "../events/events";
import { resolveContestedMelees, resolveDuels } from "./contestedMelee";
import { refillFormationFront } from "./engagement";
import { resolveEndActivationRegrouping } from "./regrouping";
import { provisionalFormationFamily, recalculateFormationConnectivity } from "./splitting";
import { disperseRemainingRoutedFormations, formationFamilyIsRouted, resolveAutomaticRoutingActivations } from "./routing";

function eligible(state: GameState, factionId: FactionId): Formation[] {
  const eligibleFormations: Formation[] = [];
  const seen = new Set<string>();
  for (const formation of Object.values(state.formations).sort((a, b) => a.id.localeCompare(b.id))) {
    if (formation.factionId !== factionId || formation.blockIds.length === 0) continue;
    const activationId = formation.provisionalFamilyId ?? formation.id;
    if (seen.has(activationId)) continue;
    seen.add(activationId);
    const family = provisionalFormationFamily(state, formation.id);
    if (formationFamilyIsRouted(state, formation.id)) continue;
    if (family.some((candidate) => candidate.hasActivated)) continue;
    eligibleFormations.push(family.find((candidate) => candidate.id === activationId) ?? family[0]!);
  }
  return eligibleFormations;
}

export function remainingActivations(state: GameState, factionId?: FactionId): number {
  return eligible(state, factionId ?? state.activeFactionId).length;
}

export function canSelectFormation(state: GameState, formationId: string): boolean {
  const formation = state.formations[formationId];
  return Boolean(formation && formation.factionId === state.activeFactionId
    && !formationFamilyIsRouted(state, formationId)
    && !provisionalFormationFamily(state, formationId).some((candidate) => candidate.hasActivated));
}

/** Wavering lasts through a formation's next activation. Blocks that just pressed forward, or are still cut off, stay wavering. */
function steadyFormationFamily(state: GameState, formationId: string): void {
  for (const formation of provisionalFormationFamily(state, formationId)) {
    for (const blockId of formation.blockIds) {
      const block = state.blocks[blockId];
      if (!block) continue;
      block.wavering = Boolean(block.overextended);
      delete block.overextended;
    }
    recalculateFormationConnectivity(state, formation.id);
  }
}

function refillFactionFronts(state: GameState, factionId: FactionId): void {
  const formationIds = Object.values(state.formations)
    .filter((formation) => formation.factionId === factionId && formation.blockIds.length > 0)
    .map((formation) => formation.id)
    .sort((a, b) => a.localeCompare(b));
  for (const formationId of formationIds) refillFormationFront(state, formationId);
}

function beginRound(state: GameState): void {
  state.round += 1;
  state.activeFactionId = "roman";
  for (const formation of Object.values(state.formations)) {
    formation.hasActivated = false;
    formation.movementRemaining = formation.unit.movement;
  }
  for (const block of Object.values(state.blocks)) {
    block.hasRetreatedThisRound = false;
    block.chargeDistance = 0;
    block.chargeMomentum = 0;
  }
  for (const character of Object.values(state.characters)) character.temporaryMeleeBonus = 0;
  emitEvent(state, "round_started", `Round ${state.round} began. Romans have the first activation.`);
}

function prepareFactionActivation(state: GameState, factionId: FactionId): boolean {
  state.activeFactionId = factionId;
  resolveAutomaticRoutingActivations(state, factionId);
  if (eligible(state, factionId).length === 0) return false;
  refillFactionFronts(state, factionId);
  return true;
}

function resolveRound(state: GameState): void {
  state.phase = "resolving_melees";
  resolveContestedMelees(state);
  resolveDuels(state);
  for (let routingRound = 0; routingRound < BALANCE.routedAutomaticRoundLimit; routingRound += 1) {
    beginRound(state);
    if (prepareFactionActivation(state, "roman") || prepareFactionActivation(state, "saxon")) {
      state.phase = "selecting";
      return;
    }
    if (Object.keys(state.formations).length === 0) {
      state.phase = "selecting";
      return;
    }
  }
  disperseRemainingRoutedFormations(state);
  state.phase = "selecting";
}

export function endFormationActivation(state: GameState, formationId?: string, heldMoraleRecovered?: number): void {
  const formation = formationId ? state.formations[formationId] : undefined;
  if (formation) {
    formation.hasActivated = true;
    formation.movementRemaining = 0;
    emitEvent(state, "activation_ended", `${formation.name} ended its activation.`, {
      formationIds: [formation.id],
      detail: {
        kind: "activation_ended",
        factionId: formation.factionId,
        ...(heldMoraleRecovered === undefined ? {} : { moraleRecovered: heldMoraleRecovered }),
      },
    });
    steadyFormationFamily(state, formation.id);
    resolveEndActivationRegrouping(state, formation.id);
  }
  state.selectedFormationId = null;
  state.selectedBlockId = null;
  state.currentAction = null;
  state.phase = "selecting";
  const currentFaction = state.activeFactionId;
  const otherFaction: FactionId = currentFaction === "roman" ? "saxon" : "roman";
  if (prepareFactionActivation(state, otherFaction)) return;
  if (prepareFactionActivation(state, currentFaction)) return;
  resolveRound(state);
}

export function holdFormation(state: GameState, formationId: string): boolean {
  const formation = state.formations[formationId];
  if (!formation || formation.hasActivated
    || formationFamilyIsRouted(state, formationId)) return false;
  const before = formation.cohesion;
  formation.cohesion = Math.min(formation.maxCohesion, formation.cohesion + 1);
  endFormationActivation(state, formation.id, formation.cohesion - before);
  return true;
}
