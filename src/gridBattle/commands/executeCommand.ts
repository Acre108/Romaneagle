import { eventsSince } from "../events/events";
import { blocksAt } from "../model/occupancy";
import type { BattleAction, Direction, GameState, GridPosition } from "../model/types";
import { chargePreview, clearOrphanedContestedFlags, createContestedCell, damageBlock, pressurePreview, resolveCharge, resolveContestedMelees, resolveDuels, resolvePressure, retreatBlock } from "../rules/combat";
import { forceSplit, legalReformDestinations, mergeCandidates, mergeFormations, reformBlock, transferCharacter } from "../rules/formationActions";
import { canTranslateFormation, finishFormationMove, translateFormation } from "../rules/movement";
import { canFallBack, engagedContacts, fallBackFormation, formationIsEngaged, resolveEngagedOrder } from "../rules/engagement";
import { oppositeDirection } from "../rules/direction";
import { provisionalFormationFamily, recalculateAllConnectivity } from "../rules/splitting";
import { formationFamilyIsRouted, resolveRoutingFormationActivation } from "../rules/routing";
import { canSelectFormation, endFormationActivation, holdFormation } from "../rules/turnSystem";
import { braceFormation, canBraceFormation } from "../rules/brace";
import { rangedActionReason, resolveRangedVolley } from "../rules/rangedCombat";
import { evaluateMapTriggers } from "../rules/triggers";

export type GameCommand =
  | { type: "select_cell"; position: GridPosition }
  | { type: "choose_action"; action: BattleAction }
  | { type: "move"; direction: Direction }
  | { type: "finish_move"; facing: Direction }
  | { type: "attack"; attackerId: string; defenderId: string; followUp?: boolean }
  | { type: "shoot"; defenderId: string }
  | { type: "charge"; attackerId: string; defenderId: string }
  | { type: "reform"; blockId: string; destination: GridPosition }
  | { type: "transfer_character"; characterId: string; targetBlockId: string }
  | { type: "merge"; otherFormationId: string }
  | { type: "brace" }
  | { type: "hold" }
  | { type: "fall_back" }
  | { type: "battle" }
  | { type: "press" }
  | { type: "end_activation" }
  | { type: "debug_damage" }
  | { type: "debug_retreat" }
  | { type: "debug_route" }
  | { type: "debug_split" }
  | { type: "debug_contested" }
  | { type: "debug_resolve" }
  | { type: "debug_restore" };

export interface CommandResult {
  accepted: boolean;
  reason?: string;
}

export interface CommandExecutionOptions {
  confirmed?: boolean;
}

function selectedFormation(state: GameState) {
  return state.selectedFormationId ? state.formations[state.selectedFormationId] : undefined;
}

function routedOrderReason(): CommandResult {
  return { accepted: false, reason: "Morale has broken; this unit is routing automatically." };
}

function selectCell(state: GameState, position: GridPosition): CommandResult {
  const occupants = blocksAt(state, position);
  const friendly = occupants.find((block) => block.factionId === state.activeFactionId && block.formationId);
  if (!friendly?.formationId || !canSelectFormation(state, friendly.formationId)) {
    return { accepted: false, reason: friendly ? "That formation has already activated." : `Select a ${state.activeFactionId} formation.` };
  }
  if (state.selectedFormationId === friendly.formationId) state.selectedBlockId = friendly.id;
  else {
    state.selectedFormationId = friendly.formationId;
    state.selectedBlockId = null;
  }
  state.currentAction = null;
  state.phase = "choosing_action";
  return { accepted: true };
}

export function executeCommand(
  state: GameState,
  command: GameCommand,
  options: CommandExecutionOptions = {},
): CommandResult {
  const firstNewEventId = state.nextEventId;
  const result = executeCommandCore(state, command, options);
  if (result.accepted) {
    clearOrphanedContestedFlags(state);
    evaluateMapTriggers(state, eventsSince(state.eventLog, firstNewEventId));
  }
  return result;
}

function executeCommandCore(
  state: GameState,
  command: GameCommand,
  options: CommandExecutionOptions = {},
): CommandResult {
  const formation = selectedFormation(state);
  switch (command.type) {
    case "select_cell": return selectCell(state, command.position);
    case "choose_action": {
      if (!formation) return { accepted: false, reason: "Select an active formation first." };
      const legality = commandLegality(state, command.action);
      if (!legality.accepted) return legality;
      state.currentAction = command.action;
      state.phase = "choosing_action";
      return { accepted: true };
    }
    case "move": {
      if (!formation) return { accepted: false, reason: "Select a formation first." };
      if (formationFamilyIsRouted(state, formation.id) && command.direction !== oppositeDirection(formation.facing)) {
        return { accepted: false, reason: "Morale has broken; movement must be directly away from the enemy." };
      }
      const result = translateFormation(state, formation.id, command.direction, options.confirmed ?? false);
      return { accepted: result.ok, reason: result.reason };
    }
    case "finish_move": {
      if (!formation) return { accepted: false, reason: "Select a formation first." };
      if (formationFamilyIsRouted(state, formation.id)) return routedOrderReason();
      if (state.currentAction !== "move") return { accepted: false, reason: "Choose Move before setting the final facing." };
      const result = finishFormationMove(state, formation.id, command.facing);
      if (!result.ok) return { accepted: false, reason: result.reason };
      endFormationActivation(state, formation.id);
      return { accepted: true };
    }
    case "attack": {
      if (!formation || !formation.blockIds.includes(command.attackerId)) return { accepted: false, reason: "Select the attacking formation." };
      if (formationFamilyIsRouted(state, formation.id)) return routedOrderReason();
      if (!options.confirmed) return { accepted: false, reason: "Combat orders must be previewed and confirmed." };
      const result = resolvePressure(state, command.attackerId, command.defenderId, { followUp: command.followUp });
      if (!result.ok) return { accepted: false, reason: "Attack must use a front block against the square directly ahead." };
      endFormationActivation(state, formation.id);
      return { accepted: true };
    }
    case "shoot": {
      if (!formation) return { accepted: false, reason: "Select the shooting formation." };
      if (formationFamilyIsRouted(state, formation.id)) return routedOrderReason();
      if (!options.confirmed) return { accepted: false, reason: "Ranged orders must be previewed and confirmed." };
      const result = resolveRangedVolley(state, formation.id, command.defenderId);
      if (!result.ok) return { accepted: false, reason: result.reason };
      endFormationActivation(state, formation.id);
      return { accepted: true };
    }
    case "charge": {
      if (!formation || !formation.blockIds.includes(command.attackerId)) return { accepted: false, reason: "Select the charging formation." };
      if (formationFamilyIsRouted(state, formation.id)) return routedOrderReason();
      if (!options.confirmed) return { accepted: false, reason: "Combat orders must be previewed and confirmed." };
      if (!resolveCharge(state, command.attackerId, command.defenderId)) return { accepted: false, reason: "The target is not in a legal forward charge lane." };
      endFormationActivation(state, formation.id);
      return { accepted: true };
    }
    case "reform": {
      if (formation && formationFamilyIsRouted(state, formation.id)) return routedOrderReason();
      if (!formation || !legalReformDestinations(state, command.blockId).some((position) => position.x === command.destination.x && position.y === command.destination.y)) {
        return { accepted: false, reason: "That reform destination is illegal." };
      }
      reformBlock(state, command.blockId, command.destination);
      endFormationActivation(state, formation.id);
      return { accepted: true };
    }
    case "transfer_character": {
      if (formation && formationFamilyIsRouted(state, formation.id)) return routedOrderReason();
      if (!formation || !transferCharacter(state, command.characterId, command.targetBlockId)) {
        return { accepted: false, reason: "Characters transfer only to adjacent empty host blocks in their formation." };
      }
      endFormationActivation(state, formation.id);
      return { accepted: true };
    }
    case "merge": {
      if (!formation) return { accepted: false, reason: "Select a formation first." };
      if (formationFamilyIsRouted(state, formation.id)) return routedOrderReason();
      const mergedId = mergeFormations(state, formation.id, command.otherFormationId);
      if (!mergedId) return { accepted: false, reason: "Only connected, unactivated formations with the same facing may merge." };
      state.selectedFormationId = mergedId;
      endFormationActivation(state, mergedId);
      return { accepted: true };
    }
    case "brace": {
      if (!formation) return { accepted: false, reason: "Select a formation first." };
      if (formationFamilyIsRouted(state, formation.id)) return routedOrderReason();
      const result = braceFormation(state, formation.id);
      if (!result.ok) return { accepted: false, reason: result.reason };
      endFormationActivation(state, formation.id);
      return { accepted: true };
    }
    case "hold": {
      if (formation && formationFamilyIsRouted(state, formation.id)) return routedOrderReason();
      if (!formation || !holdFormation(state, formation.id)) return { accepted: false, reason: "Select an unactivated formation." };
      return { accepted: true };
    }
    case "fall_back": {
      if (!formation) return { accepted: false, reason: "Select an engaged formation first." };
      const result = fallBackFormation(state, formation.id, options.confirmed ?? false);
      if (!result.ok) return { accepted: false, reason: result.reason };
      endFormationActivation(state, formation.id);
      return { accepted: true };
    }
    case "battle":
    case "press": {
      if (formation && formationFamilyIsRouted(state, formation.id)) return routedOrderReason();
      if (!options.confirmed) return { accepted: false, reason: "Combat orders must be previewed and confirmed." };
      if (!formation || resolveEngagedOrder(state, formation.id, command.type) === 0) {
        return { accepted: false, reason: "No engaged block can fight an adjacent enemy." };
      }
      endFormationActivation(state, formation.id);
      return { accepted: true };
    }
    case "end_activation": {
      if (!formation) return { accepted: false, reason: "Select a formation first." };
      if (state.currentAction === "move" && !formationFamilyIsRouted(state, formation.id)) {
        const result = finishFormationMove(state, formation.id, formation.facing);
        if (!result.ok) return { accepted: false, reason: result.reason };
      }
      endFormationActivation(state, formation.id);
      return { accepted: true };
    }
    case "debug_damage": {
      if (!state.selectedBlockId) return { accepted: false, reason: "Select an individual block first." };
      damageBlock(state, state.selectedBlockId, 1, "debug command");
      return { accepted: true };
    }
    case "debug_retreat": {
      if (!state.selectedBlockId) return { accepted: false, reason: "Select an individual block first." };
      retreatBlock(state, state.selectedBlockId);
      return { accepted: true };
    }
    case "debug_route": {
      if (!formation) return { accepted: false, reason: "Select a formation first." };
      for (const familyFormation of provisionalFormationFamily(state, formation.id)) {
        familyFormation.cohesion = 0;
        familyFormation.status = "routed";
        familyFormation.hasActivated = false;
        familyFormation.routingActivations = undefined;
      }
      resolveRoutingFormationActivation(state, formation.id);
      state.selectedFormationId = null;
      state.selectedBlockId = null;
      state.currentAction = null;
      return { accepted: true };
    }
    case "debug_split": {
      if (!formation || !forceSplit(state, formation.id)) return { accepted: false, reason: "Select a formation with at least three blocks." };
      return { accepted: true };
    }
    case "debug_contested": {
      if (!state.selectedBlockId) return { accepted: false, reason: "Select an individual block first." };
      const defender = state.blocks[state.selectedBlockId];
      if (!defender) return { accepted: false, reason: "Selected block no longer exists." };
      const attacker = Object.values(state.blocks)
        .filter((block) => block.factionId !== defender.factionId && !block.isContested)
        .sort((a, b) => Math.abs(a.position.x - defender.position.x) + Math.abs(a.position.y - defender.position.y)
          - Math.abs(b.position.x - defender.position.x) - Math.abs(b.position.y - defender.position.y))[0];
      if (!attacker || !createContestedCell(state, attacker.id, defender.id)) return { accepted: false, reason: "No enemy block can be used." };
      return { accepted: true };
    }
    case "debug_resolve": {
      resolveContestedMelees(state);
      resolveDuels(state);
      return { accepted: true };
    }
    case "debug_restore": {
      if (!formation) return { accepted: false, reason: "Select a formation first." };
      formation.cohesion = formation.maxCohesion;
      formation.status = formation.provisionalFamilyId ? "fragment" : "formed";
      formation.routingActivations = undefined;
      formation.routingStalledActivations = undefined;
      for (const blockId of formation.blockIds) if (state.blocks[blockId]) state.blocks[blockId]!.disorder = 0;
      recalculateAllConnectivity(state);
      return { accepted: true };
    }
  }
}

export function commandLegality(state: GameState, action: BattleAction): CommandResult {
  const formation = selectedFormation(state);
  if (!formation) return { accepted: false, reason: "Select a formation first." };
  if (formation.hasActivated) return { accepted: false, reason: "Formation has already activated." };
  const blocks = formation.blockIds.map((id) => state.blocks[id]).filter((block) => block !== undefined);
  const engaged = formationIsEngaged(state, formation.id);
  const routed = formationFamilyIsRouted(state, formation.id);
  const engagedAction = action === "fall_back" || action === "battle" || action === "press";
  if (routed && engaged && action !== "fall_back") return routedOrderReason();
  if (routed && !engaged && action !== "move") return routedOrderReason();
  if (engaged && !engagedAction) return { accepted: false, reason: "Engaged formations must Fall back, Battle, or Press." };
  if (!engaged && engagedAction) return { accepted: false, reason: "That order is only available while engaged." };
  if (action === "fall_back") {
    const legality = canFallBack(state, formation.id);
    return { accepted: legality.ok, reason: legality.reason };
  }
  if ((action === "battle" || action === "press") && engagedContacts(state, formation.id).length === 0) {
    return { accepted: false, reason: "No block can fight an adjacent enemy." };
  }
  if (action === "move") {
    const directions = routed
      ? [oppositeDirection(formation.facing)]
      : (["north", "east", "south", "west"] as const);
    const legal = directions.some((direction) => canTranslateFormation(state, formation.id, direction).ok);
    return legal ? { accepted: true } : { accepted: false, reason: "No legal adjacent translation." };
  }
  if (action === "brace") {
    const legality = canBraceFormation(state, formation.id);
    return { accepted: legality.ok, reason: legality.reason };
  }
  const enemies = Object.values(state.blocks).filter((block) => block.factionId !== formation.factionId);
  if (action === "charge") {
    if (!blocks.some((block) => enemies.some((enemy) => chargePreview(state, block.id, enemy.id)))) {
      return { accepted: false, reason: "No enemy is within a legal forward charge lane." };
    }
  }
  if (action === "shoot") {
    const reason = rangedActionReason(state, formation.id);
    if (reason) return { accepted: false, reason };
  }
  if (action === "reform") {
    if (!state.selectedBlockId) return { accepted: false, reason: "Select an individual block first." };
    const selected = state.blocks[state.selectedBlockId];
    const characterTransfer = selected?.characterId && blocks.some((block) =>
      block.id !== selected.id && !block.characterId && !block.isContested
      && Math.abs(block.position.x - selected.position.x) + Math.abs(block.position.y - selected.position.y) === 1,
    );
    if (legalReformDestinations(state, state.selectedBlockId).length === 0 && !characterTransfer) {
      return { accepted: false, reason: "The selected block has no legal reform or character-transfer destination." };
    }
  }
  if (action === "attack" && !blocks.some((block) => enemies.some((enemy) => pressurePreview(state, block.id, enemy.id)))) {
    return { accepted: false, reason: "No front block is touching an enemy directly ahead." };
  }
  if (action === "merge" && mergeCandidates(state, formation.id).length === 0) {
    return { accepted: false, reason: "No connected compatible formation can merge." };
  }
  return { accepted: true };
}
