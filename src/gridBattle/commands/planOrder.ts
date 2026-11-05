import type { Formation, GameState, OrderConfirmationPreview, PressurePreview } from "../model/types";
import { chargeConfirmationPreview, pressurePreview } from "../rules/combat";
import { aggregateCombatOutcomes, blockCombatMath, contactSummaryLines } from "../rules/combatPreview";
import { oppositeDirection } from "../rules/direction";
import { engagedContacts, engagedPressureOptions, formationIsEngaged, resolveEngagedOrder } from "../rules/engagement";
import { planFormationMove } from "../rules/movement";
import { provisionalFormationFamily } from "../rules/splitting";
import { rangedConfirmationPreview } from "../rules/rangedCombat";
import { commandPermission, routedMoveReason, selectedFormation, type GameCommand } from "./executeCommand";

export interface PlannedOrder {
  command: GameCommand;
  confirmation: OrderConfirmationPreview | null;
}

export interface OrderPlanResult {
  ok: boolean;
  reason?: string;
  order?: PlannedOrder;
}

function accepted(command: GameCommand, confirmation: OrderConfirmationPreview | null = null): OrderPlanResult {
  return { ok: true, order: { command, confirmation } };
}

function rejected(reason: string): OrderPlanResult {
  return { ok: false, reason };
}

/** Moves that change a formation's footprint must show every destination first. */
function reorderConfirmation(
  formation: Formation,
  relocations: readonly { blockId: string; destination: { x: number; y: number } }[],
  title: string,
  detail: string,
  math: string,
): OrderConfirmationPreview {
  return {
    kind: "movement",
    title,
    detail,
    tiles: relocations.map((relocation) => ({
      position: { ...relocation.destination }, factionId: formation.factionId, certainty: "certain",
      chance: 100,
      blockId: relocation.blockId,
      math: [math],
    })),
    damage: [],
  };
}

function planMove(state: GameState, formation: Formation, command: Extract<GameCommand, { type: "move" }>): OrderPlanResult {
  const routedReason = routedMoveReason(state, formation, command.direction);
  if (routedReason) return rejected(routedReason);
  const planned = planFormationMove(state, formation.id, command.direction);
  if (!planned.ok || !planned.plan) return rejected(planned.reason ?? "That move is not legal.");
  if (!planned.plan.reordered) return accepted(command);
  return accepted(command, reorderConfirmation(
    formation,
    planned.plan.relocations,
    "Confirm reorder move",
    "The formation changes footprint or leaves troops behind. Every destination is marked 100%.",
    "Fixed formation relocation: this destination is occupied on every valid outcome.",
  ));
}

function planFallBack(state: GameState, formation: Formation, command: Extract<GameCommand, { type: "fall_back" }>): OrderPlanResult {
  const planned = planFormationMove(state, formation.id, oppositeDirection(formation.facing));
  if (!planned.ok || !planned.plan) return rejected(planned.reason ?? "The formation cannot fall back.");
  if (!planned.plan.reordered) return accepted(command);
  return accepted(command, reorderConfirmation(
    formation,
    planned.plan.relocations,
    "Confirm reordered fall back",
    "The formation must change footprint as it leaves contact. Every destination is marked 100%.",
    "Fixed fall-back relocation: this destination is occupied on every valid outcome.",
  ));
}

function planCharge(state: GameState, formation: Formation, command: Extract<GameCommand, { type: "charge" }>): OrderPlanResult {
  if (!formation.blockIds.includes(command.attackerId)) return rejected("Select the charging formation.");
  const confirmation = chargeConfirmationPreview(state, command.attackerId, command.defenderId);
  return confirmation ? accepted(command, confirmation) : rejected("The target is not in a legal forward charge lane.");
}

function planShoot(state: GameState, formation: Formation, command: Extract<GameCommand, { type: "shoot" }>): OrderPlanResult {
  const confirmation = rangedConfirmationPreview(state, formation.id, command.defenderId);
  return confirmation
    ? accepted(command, confirmation)
    : rejected("Target must be in the formation's forward arc, range, and line of sight.");
}

function planEngagedCombat(
  state: GameState,
  formation: Formation,
  command: Extract<GameCommand, { type: "battle" | "press" }>,
): OrderPlanResult {
  const contacts = provisionalFormationFamily(state, formation.id)
    .filter((participant) => formationIsEngaged(state, participant.id))
    .flatMap((participant) => engagedContacts(state, participant.id));
  if (contacts.length === 0) return rejected("No engaged block can fight an adjacent enemy.");
  const validation = structuredClone(state);
  if (resolveEngagedOrder(validation, formation.id, command.type) === 0) {
    return rejected("No engaged block can fight an adjacent enemy.");
  }
  const involved = new Set(contacts.flatMap((contact) => [contact.attackerId, contact.defenderId]));
  const mathByBlock = new Map<string, string[]>();
  const appendMath = (blockId: string, lines: readonly string[]): void => {
    const existing = mathByBlock.get(blockId) ?? [];
    mathByBlock.set(blockId, [...existing, ...(existing.length > 0 ? ["—"] : []), ...lines]);
  };
  const contactPreviews: PressurePreview[] = [];
  for (const contact of contacts) {
    const preview = pressurePreview(state, contact.attackerId, contact.defenderId, engagedPressureOptions(command.type));
    if (!preview) continue;
    contactPreviews.push(preview);
    appendMath(contact.attackerId, blockCombatMath(preview, "attacker"));
    appendMath(contact.defenderId, blockCombatMath(preview, "defender"));
  }
  const outcomes = Array.from({ length: 100 }, (_, defenceRoll) => {
    const simulated = structuredClone(state);
    resolveEngagedOrder(simulated, formation.id, command.type, { defenceRollOverride: defenceRoll });
    return simulated;
  });
  const outcomePreview = aggregateCombatOutcomes(state, outcomes, involved, mathByBlock);
  return accepted(command, {
    kind: "combat",
    title: `Confirm ${command.type}`,
    detail: command.type === "press"
      ? "Blocks that advance stay wavering through your next activation. Enemy blocks still counter. ! is certain; ? is possible. Hover for percentages."
      : "Highlighted tiles show contacts, retreats, removals, refills, and gap-closing blocks. ! is certain; ? is possible. Hover for percentages.",
    tiles: outcomePreview.tiles,
    damage: outcomePreview.damage,
    forecast: outcomePreview.forecast,
    contactSummary: contactSummaryLines(contactPreviews),
  });
}

export function planOrder(state: GameState, command: GameCommand): OrderPlanResult {
  const permission = commandPermission(state, command);
  if (!permission.accepted) return rejected(permission.reason ?? "That order is not legal.");
  const formation = selectedFormation(state);
  if (!formation) return accepted(command);
  switch (command.type) {
    case "move": return planMove(state, formation, command);
    case "fall_back": return planFallBack(state, formation, command);
    case "shoot": return planShoot(state, formation, command);
    case "charge": return planCharge(state, formation, command);
    case "battle":
    case "press": return planEngagedCombat(state, formation, command);
    default: return accepted(command);
  }
}
