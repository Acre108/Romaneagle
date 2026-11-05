import { BALANCE } from "../model/config";
import type { GameState, OrderConfirmationPreview } from "../model/types";
import { chargeConfirmationPreview, pressurePreview, resolvePressure } from "../rules/combat";
import { aggregateCombatOutcomes, blockCombatMath } from "../rules/combatPreview";
import { oppositeDirection } from "../rules/direction";
import { engagedContacts, formationIsEngaged, resolveEngagedOrder } from "../rules/engagement";
import { planFormationMove } from "../rules/movement";
import { formationFamilyIsRouted } from "../rules/routing";
import { provisionalFormationFamily } from "../rules/splitting";
import { rangedConfirmationPreview } from "../rules/rangedCombat";
import type { GameCommand } from "./executeCommand";

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

function selectedFormation(state: GameState) {
  return state.selectedFormationId ? state.formations[state.selectedFormationId] : undefined;
}

function planMove(state: GameState, command: Extract<GameCommand, { type: "move" }>): OrderPlanResult {
  const formation = selectedFormation(state);
  if (!formation) return rejected("Select a formation first.");
  if (formationFamilyIsRouted(state, formation.id) && command.direction !== oppositeDirection(formation.facing)) {
    return rejected("Morale has broken; movement must be directly away from the enemy.");
  }
  const planned = planFormationMove(state, formation.id, command.direction);
  if (!planned.ok || !planned.plan) return rejected(planned.reason ?? "That move is not legal.");
  if (!planned.plan.reordered) return accepted(command);
  return accepted(command, {
    kind: "movement",
    title: "Confirm reorder move",
    detail: "The formation changes footprint or leaves troops behind. Every destination is marked 100%.",
    tiles: planned.plan.relocations.map((relocation) => ({
      position: { ...relocation.destination }, factionId: formation.factionId, certainty: "certain",
      chance: 100,
      blockId: relocation.blockId,
      math: ["Fixed formation relocation: this destination is occupied on every valid outcome."],
    })),
    damage: [],
  });
}

function planFallBack(state: GameState, command: Extract<GameCommand, { type: "fall_back" }>): OrderPlanResult {
  const formation = selectedFormation(state);
  if (!formation || !formationIsEngaged(state, formation.id)) return rejected("Only an engaged formation may fall back.");
  const planned = planFormationMove(state, formation.id, oppositeDirection(formation.facing));
  if (!planned.ok || !planned.plan) return rejected(planned.reason ?? "The formation cannot fall back.");
  if (!planned.plan.reordered) return accepted(command);
  return accepted(command, {
    kind: "movement",
    title: "Confirm reordered fall back",
    detail: "The formation must change footprint as it leaves contact. Every destination is marked 100%.",
    tiles: planned.plan.relocations.map((relocation) => ({
      position: { ...relocation.destination }, factionId: formation.factionId, certainty: "certain",
      chance: 100,
      blockId: relocation.blockId,
      math: ["Fixed fall-back relocation: this destination is occupied on every valid outcome."],
    })),
    damage: [],
  });
}

function planAttack(state: GameState, command: Extract<GameCommand, { type: "attack" }>): OrderPlanResult {
  const attacker = state.blocks[command.attackerId];
  const formation = selectedFormation(state);
  if (!formation || !attacker || !formation.blockIds.includes(attacker.id)) return rejected("Select the attacking formation.");
  if (formationFamilyIsRouted(state, formation.id)) return rejected("Morale has broken; this unit is routing automatically.");
  const preview = pressurePreview(state, command.attackerId, command.defenderId);
  if (!preview) return rejected("Attack must use a front block against the square directly ahead.");
  const followUp = command.followUp ?? preview.netPressure >= BALANCE.chaoticRetreatPressureThreshold;
  const plannedCommand: GameCommand = { ...command, followUp };
  const outcomes = Array.from({ length: 100 }, (_, defenceRoll) => {
    const simulated = structuredClone(state);
    resolvePressure(simulated, command.attackerId, command.defenderId, { followUp, defenceRollOverride: defenceRoll });
    return simulated;
  });
  const mathByBlock = new Map([
    [command.attackerId, blockCombatMath(preview, "attacker")],
    [command.defenderId, blockCombatMath(preview, "defender")],
  ]);
  const outcomePreview = aggregateCombatOutcomes(
    state,
    outcomes,
    new Set([command.attackerId, command.defenderId]),
    mathByBlock,
  );
  return accepted(plannedCommand, {
    kind: "combat",
    title: "Confirm attack",
    detail: followUp
      ? "Highlighted tiles show positions across all defence rolls; the attacker follows an overwhelming retreat. ! is certain; ? is possible. Hover for percentages."
      : "Highlighted tiles show blocks holding, retreating, or being removed. ! is certain; ? is possible. Hover for percentages.",
    tiles: outcomePreview.tiles,
    damage: outcomePreview.damage,
    forecast: outcomePreview.forecast,
  });
}

function planCharge(state: GameState, command: Extract<GameCommand, { type: "charge" }>): OrderPlanResult {
  const attacker = state.blocks[command.attackerId];
  const formation = selectedFormation(state);
  if (!formation || !attacker || !formation.blockIds.includes(attacker.id)) return rejected("Select the charging formation.");
  if (formationFamilyIsRouted(state, formation.id)) return rejected("Morale has broken; this unit is routing automatically.");
  const confirmation = chargeConfirmationPreview(state, command.attackerId, command.defenderId);
  return confirmation ? accepted(command, confirmation) : rejected("The target is not in a legal forward charge lane.");
}

function planShoot(state: GameState, command: Extract<GameCommand, { type: "shoot" }>): OrderPlanResult {
  const formation = selectedFormation(state);
  if (!formation) return rejected("Select the shooting formation.");
  if (formationFamilyIsRouted(state, formation.id)) return rejected("Morale has broken; this unit is routing automatically.");
  const confirmation = rangedConfirmationPreview(state, formation.id, command.defenderId);
  return confirmation
    ? accepted(command, confirmation)
    : rejected("Target must be in the formation's forward arc, range, and line of sight.");
}

function planEngagedCombat(
  state: GameState,
  command: Extract<GameCommand, { type: "battle" | "press" }>,
): OrderPlanResult {
  const formation = selectedFormation(state);
  if (!formation || !formationIsEngaged(state, formation.id)) return rejected("Select an engaged formation first.");
  if (formationFamilyIsRouted(state, formation.id)) return rejected("Morale has broken; this unit is routing automatically.");
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
  for (const contact of contacts) {
    const preview = pressurePreview(state, contact.attackerId, contact.defenderId, {
      allowAnyContact: true,
      pressureBonus: command.type === "press" ? BALANCE.pressPressureBonus : 0,
      damagePenalty: command.type === "press" ? BALANCE.pressDamagePenalty : 0,
      pushThreshold: command.type === "battle" ? BALANCE.battlePushPressureThreshold : BALANCE.pushPressureThreshold,
    });
    if (!preview) continue;
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
      ? "Highlighted tiles show combat-dependent retreats, removals, and files that may advance. ! is certain; ? is possible. Hover for percentages."
      : "Highlighted tiles show contacts, retreats, removals, refills, and gap-closing blocks. ! is certain; ? is possible. Hover for percentages.",
    tiles: outcomePreview.tiles,
    damage: outcomePreview.damage,
    forecast: outcomePreview.forecast,
  });
}

export function planOrder(state: GameState, command: GameCommand): OrderPlanResult {
  switch (command.type) {
    case "move": return planMove(state, command);
    case "fall_back": return planFallBack(state, command);
    case "attack": return planAttack(state, command);
    case "shoot": return planShoot(state, command);
    case "charge": return planCharge(state, command);
    case "battle":
    case "press": return planEngagedCombat(state, command);
    default: return accepted(command);
  }
}
