import { eventsSince } from "../events/events";
import { blocksAt } from "../model/occupancy";
import type { BattleAction, Direction, Formation, GameState, GridPosition } from "../model/types";
import { chargePreview, clearOrphanedContestedFlags, resolveCharge } from "../rules/combat";
import { legalReformDestinations, mergeCandidates, mergeFormations, reformBlock, transferCharacter } from "../rules/formationActions";
import { canTranslateFormation, finishFormationMove, translateFormation, turnFormation } from "../rules/movement";
import { canFallBack, engagedContacts, fallBackFormation, formationIsEngaged, resolveEngagedOrder } from "../rules/engagement";
import { oppositeDirection } from "../rules/direction";
import { provisionalFormationFamily } from "../rules/splitting";
import { formationFamilyIsRouted } from "../rules/routing";
import { canSelectFormation, endFormationActivation, holdFormation } from "../rules/turnSystem";
import { braceFormation, canBraceFormation } from "../rules/brace";
import { rangedActionReason, resolveRangedVolley } from "../rules/rangedCombat";
import { evaluateMapTriggers } from "../rules/triggers";
import { executeDebugCommand, isDebugCommand, type DebugCommand } from "./debugCommands";

type FormationCommand =
  | { type: "choose_action"; action: BattleAction }
  | { type: "move"; direction: Direction }
  | { type: "finish_move"; facing: Direction }
  | { type: "turn"; facing: Direction }
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
  | { type: "end_activation" };

export type GameCommand = { type: "select_cell"; position: GridPosition } | FormationCommand | DebugCommand;

export interface CommandResult {
  accepted: boolean;
  reason?: string;
}

export interface CommandExecutionOptions {
  confirmed?: boolean;
}

export function selectedFormation(state: GameState): Formation | undefined {
  return state.selectedFormationId ? state.formations[state.selectedFormationId] : undefined;
}

/** Once a formation has spent movement it is committed: the move can only be finished, not swapped for another order. */
export function moveIsCommitted(state: GameState): boolean {
  const formation = selectedFormation(state);
  return Boolean(formation && state.currentAction === "move" && formation.movementRemaining < formation.unit.movement);
}

const COMMITTED_MOVE_REASON = "This formation has already moved. Choose its final facing to finish.";
const ROUTED_ORDER_REASON = "Morale has broken; this unit is routing automatically.";

function refused(reason: string | undefined): CommandResult {
  return { accepted: false, reason };
}

/** What the player is told when a command needs a selected formation and none is selected. */
const NO_SELECTION_REASON: Readonly<Record<FormationCommand["type"], string>> = {
  choose_action: "Select an active formation first.",
  move: "Select a formation first.",
  finish_move: "Select a formation first.",
  turn: "Select an engaged formation first.",
  shoot: "Select the shooting formation.",
  charge: "Select the charging formation.",
  reform: "That reform destination is illegal.",
  transfer_character: "Characters transfer only to adjacent empty host blocks in their formation.",
  merge: "Select a formation first.",
  brace: "Select a formation first.",
  hold: "Select an unactivated formation.",
  fall_back: "Select an engaged formation first.",
  battle: "No engaged block can fight an adjacent enemy.",
  press: "No engaged block can fight an adjacent enemy.",
  end_activation: "Select a formation first.",
};

/** The order each command carries out. Commands not listed finish an order already under way, or choose one. */
const COMMAND_ORDER: Partial<Readonly<Record<FormationCommand["type"], BattleAction>>> = {
  turn: "turn",
  shoot: "shoot",
  charge: "charge",
  reform: "reform",
  transfer_character: "reform",
  merge: "merge",
  brace: "brace",
  hold: "hold",
  fall_back: "fall_back",
  battle: "battle",
  press: "press",
};

/** Whether this formation may give this order at all, before checking the order has a legal target. */
function orderPermission(state: GameState, formation: Formation, action: BattleAction): CommandResult {
  if (formation.hasActivated) return refused("Formation has already activated.");
  if (moveIsCommitted(state) && action !== "move") return refused(COMMITTED_MOVE_REASON);
  const engaged = formationIsEngaged(state, formation.id);
  const routed = formationFamilyIsRouted(state, formation.id);
  const engagedAction = action === "fall_back" || action === "turn" || action === "battle" || action === "press";
  if (routed && engaged && action !== "fall_back") return refused(ROUTED_ORDER_REASON);
  if (routed && !engaged && action !== "move") return refused(ROUTED_ORDER_REASON);
  if (engaged && !engagedAction) return refused("Engaged formations must Fall back, Turn, Battle, or Press.");
  if (!engaged && engagedAction) return refused("That order is only available while engaged.");
  return { accepted: true };
}

function allowedDuringCommittedMove(command: GameCommand): boolean {
  return command.type === "move" || command.type === "finish_move" || command.type === "end_activation"
    || (command.type === "choose_action" && command.action === "move")
    || isDebugCommand(command);
}

/** The single check shared by order planning and execution, so neither can accept what the other refuses. */
export function commandPermission(state: GameState, command: GameCommand): CommandResult {
  if (moveIsCommitted(state) && !allowedDuringCommittedMove(command)) return refused(COMMITTED_MOVE_REASON);
  if (isDebugCommand(command) || command.type === "select_cell") return { accepted: true };
  const formation = selectedFormation(state);
  if (!formation) return refused(NO_SELECTION_REASON[command.type]);
  const action = COMMAND_ORDER[command.type];
  return action ? orderPermission(state, formation, action) : { accepted: true };
}

/** The move rule for a routed formation: it may only move directly away. */
export function routedMoveReason(state: GameState, formation: Formation, direction: Direction): string | null {
  return formationFamilyIsRouted(state, formation.id) && direction !== oppositeDirection(formation.facing)
    ? "Morale has broken; movement must be directly away from the enemy."
    : null;
}

function selectCell(state: GameState, position: GridPosition): CommandResult {
  const occupants = blocksAt(state, position);
  const friendly = occupants.find((block) => block.factionId === state.activeFactionId && block.formationId);
  if (!friendly?.formationId || !canSelectFormation(state, friendly.formationId)) {
    return refused(friendly ? "That formation has already activated." : `Select a ${state.activeFactionId} formation.`);
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
  const result = executeCommandCore(state, command, options.confirmed ?? false);
  if (result.accepted) {
    clearOrphanedContestedFlags(state);
    evaluateMapTriggers(state, eventsSince(state.eventLog, firstNewEventId));
  }
  return result;
}

function executeCommandCore(state: GameState, command: GameCommand, confirmed: boolean): CommandResult {
  const permission = commandPermission(state, command);
  if (!permission.accepted) return permission;
  if (isDebugCommand(command)) return executeDebugCommand(state, command);
  if (command.type === "select_cell") return selectCell(state, command.position);
  return executeFormationCommand(state, selectedFormation(state)!, command, confirmed);
}

function endActivation(state: GameState, formationId: string): CommandResult {
  endFormationActivation(state, formationId);
  return { accepted: true };
}

function executeFormationCommand(state: GameState, formation: Formation, command: FormationCommand, confirmed: boolean): CommandResult {
  switch (command.type) {
    case "choose_action": {
      const legality = commandLegality(state, command.action);
      if (!legality.accepted) return legality;
      state.currentAction = command.action;
      state.phase = "choosing_action";
      return { accepted: true };
    }
    case "move": {
      const routedReason = routedMoveReason(state, formation, command.direction);
      if (routedReason) return refused(routedReason);
      const result = translateFormation(state, formation.id, command.direction, confirmed);
      return { accepted: result.ok, reason: result.reason };
    }
    case "finish_move": {
      if (formationFamilyIsRouted(state, formation.id)) return refused(ROUTED_ORDER_REASON);
      if (state.currentAction !== "move") return refused("Choose Move before setting the final facing.");
      const result = finishFormationMove(state, formation.id, command.facing);
      return result.ok ? endActivation(state, formation.id) : refused(result.reason);
    }
    case "turn":
      if (command.facing === formation.facing) return refused("The formation already faces that way.");
      for (const member of provisionalFormationFamily(state, formation.id)) turnFormation(state, member.id, command.facing);
      return endActivation(state, formation.id);
    case "shoot": {
      if (!confirmed) return refused("Ranged orders must be previewed and confirmed.");
      const result = resolveRangedVolley(state, formation.id, command.defenderId);
      return result.ok ? endActivation(state, formation.id) : refused(result.reason);
    }
    case "charge":
      if (!formation.blockIds.includes(command.attackerId)) return refused(NO_SELECTION_REASON.charge);
      if (!confirmed) return refused("Combat orders must be previewed and confirmed.");
      if (!resolveCharge(state, command.attackerId, command.defenderId)) return refused("The target is not in a legal forward charge lane.");
      return endActivation(state, formation.id);
    case "reform":
      if (!legalReformDestinations(state, command.blockId).some((position) => position.x === command.destination.x && position.y === command.destination.y)) {
        return refused(NO_SELECTION_REASON.reform);
      }
      reformBlock(state, command.blockId, command.destination);
      return endActivation(state, formation.id);
    case "transfer_character":
      if (!transferCharacter(state, command.characterId, command.targetBlockId)) return refused(NO_SELECTION_REASON.transfer_character);
      return endActivation(state, formation.id);
    case "merge": {
      const legality = commandLegality(state, "merge");
      if (!legality.accepted) return legality;
      const mergedId = mergeFormations(state, formation.id, command.otherFormationId);
      if (!mergedId) return refused("Only connected, unactivated formations with the same facing may merge.");
      state.selectedFormationId = mergedId;
      return endActivation(state, mergedId);
    }
    case "brace": {
      const legality = commandLegality(state, "brace");
      if (!legality.accepted) return legality;
      const result = braceFormation(state, formation.id);
      return result.ok ? endActivation(state, formation.id) : refused(result.reason);
    }
    case "hold":
      return holdFormation(state, formation.id) ? { accepted: true } : refused(NO_SELECTION_REASON.hold);
    case "fall_back": {
      const result = fallBackFormation(state, formation.id, confirmed);
      return result.ok ? endActivation(state, formation.id) : refused(result.reason);
    }
    case "battle":
    case "press":
      if (!confirmed) return refused("Combat orders must be previewed and confirmed.");
      if (resolveEngagedOrder(state, formation.id, command.type) === 0) return refused(NO_SELECTION_REASON[command.type]);
      return endActivation(state, formation.id);
    case "end_activation":
      if (state.currentAction === "move" && !formationFamilyIsRouted(state, formation.id)) {
        const result = finishFormationMove(state, formation.id, formation.facing);
        if (!result.ok) return refused(result.reason);
      }
      return endActivation(state, formation.id);
  }
}

export function commandLegality(state: GameState, action: BattleAction): CommandResult {
  const formation = selectedFormation(state);
  if (!formation) return refused("Select a formation first.");
  const permission = orderPermission(state, formation, action);
  if (!permission.accepted) return permission;
  const blocks = formation.blockIds.map((id) => state.blocks[id]).filter((block) => block !== undefined);
  const routed = formationFamilyIsRouted(state, formation.id);
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
  if (action === "merge" && mergeCandidates(state, formation.id).length === 0) {
    return { accepted: false, reason: "No connected compatible formation can merge." };
  }
  return { accepted: true };
}
