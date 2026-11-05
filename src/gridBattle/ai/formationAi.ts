import type { GameCommand } from "../commands/executeCommand";
import { commandLegality, executeCommand } from "../commands/executeCommand";
import { planOrder } from "../commands/planOrder";
import { BALANCE } from "../model/config";
import { positionKey } from "../model/occupancy";
import type { Direction, FactionId, Formation, GameState, TroopBlock } from "../model/types";
import { chargePreview, pressurePreview } from "../rules/combat";
import { CARDINAL_DIRECTIONS, directionBetween, manhattanDistance } from "../rules/direction";
import { engagedContacts, formationIsEngaged } from "../rules/engagement";
import { provisionalFormationFamily } from "../rules/splitting";
import { rangedAttackPreview } from "../rules/rangedCombat";
import { formationFamilyIsRouted } from "../rules/routing";
import { canSelectFormation } from "../rules/turnSystem";

export interface AiCommandStep {
  command: GameCommand;
  confirmed: boolean;
}

export type AiIntent = "battle" | "press" | "turn" | "shoot" | "charge" | "advance" | "brace" | "hold";

export interface AiActivationPlan {
  factionId: FactionId;
  formationId: string;
  formationName: string;
  intent: AiIntent;
  summary: string;
  steps: AiCommandStep[];
}

interface FormationPlan extends AiActivationPlan {
  priority: number;
}

interface MovementNode {
  state: GameState;
  directions: Direction[];
  distance: number;
  engaged: boolean;
  wavering: number;
}

const MAX_MOVEMENT_SEARCH_STEPS = 12;

function sortedEnemyBlocks(state: GameState, factionId: FactionId): TroopBlock[] {
  return Object.values(state.blocks)
    .filter((block) => block.factionId !== factionId)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function liveFormationBlocks(state: GameState, formation: Formation): TroopBlock[] {
  return formation.blockIds
    .map((blockId) => state.blocks[blockId])
    .filter((block): block is TroopBlock => block !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function nearestEnemyDistance(state: GameState, formation: Formation): number {
  const enemies = sortedEnemyBlocks(state, formation.factionId);
  let nearest = Number.POSITIVE_INFINITY;
  for (const block of liveFormationBlocks(state, formation)) {
    for (const enemy of enemies) nearest = Math.min(nearest, manhattanDistance(block.position, enemy.position));
  }
  return nearest;
}

function waveringBlockCount(state: GameState, formation: Formation): number {
  return liveFormationBlocks(state, formation).filter((block) => block.wavering).length;
}

function selectionStep(state: GameState, formation: Formation): AiCommandStep | null {
  const block = liveFormationBlocks(state, formation)[0];
  if (!block) return null;
  const command: GameCommand = { type: "select_cell", position: { ...block.position } };
  return executeCommand(state, command).accepted ? { command, confirmed: false } : null;
}

function appendPlannedOrder(state: GameState, steps: AiCommandStep[], command: GameCommand): boolean {
  const planned = planOrder(state, command);
  if (!planned.ok || !planned.order) return false;
  const confirmed = planned.order.confirmation !== null;
  const result = executeCommand(state, planned.order.command, { confirmed });
  if (!result.accepted) return false;
  steps.push({ command: planned.order.command, confirmed });
  return true;
}

function planSignature(state: GameState, formationId: string): string {
  const family = provisionalFormationFamily(state, formationId);
  return family
    .flatMap((formation) => liveFormationBlocks(state, formation)
      .map((block) => `${block.id}:${positionKey(block.position)}`))
    .sort()
    .join("|");
}

function compareMovementNodes(left: MovementNode, right: MovementNode): number {
  return Number(right.engaged) - Number(left.engaged)
    || left.distance - right.distance
    || left.wavering - right.wavering
    || right.directions.length - left.directions.length
    || left.directions.map((direction) => CARDINAL_DIRECTIONS.indexOf(direction)).join("")
      .localeCompare(right.directions.map((direction) => CARDINAL_DIRECTIONS.indexOf(direction)).join(""));
}

function searchMovement(initialState: GameState, formationId: string): MovementNode | null {
  const initialFormation = initialState.formations[formationId];
  if (!initialFormation) return null;
  const initial: MovementNode = {
    state: initialState,
    directions: [],
    distance: nearestEnemyDistance(initialState, initialFormation),
    engaged: formationIsEngaged(initialState, formationId),
    wavering: waveringBlockCount(initialState, initialFormation),
  };
  let best = initial;
  let frontier = [initial];
  const seen = new Set([planSignature(initialState, formationId)]);

  for (let depth = 0; depth < MAX_MOVEMENT_SEARCH_STEPS && frontier.length > 0; depth += 1) {
    const next: MovementNode[] = [];
    for (const node of frontier) {
      const formation = node.state.formations[formationId];
      if (!formation || node.engaged) continue;
      for (const direction of CARDINAL_DIRECTIONS) {
        const simulated = structuredClone(node.state);
        if (!executeCommand(simulated, { type: "move", direction }, { confirmed: true }).accepted) continue;
        const movedFormation = simulated.formations[formationId];
        if (!movedFormation) continue;
        const signature = planSignature(simulated, formationId);
        if (seen.has(signature)) continue;
        seen.add(signature);
        const candidate: MovementNode = {
          state: simulated,
          directions: [...node.directions, direction],
          distance: nearestEnemyDistance(simulated, movedFormation),
          engaged: formationIsEngaged(simulated, formationId),
          wavering: waveringBlockCount(simulated, movedFormation),
        };
        next.push(candidate);
        if (compareMovementNodes(candidate, best) < 0) best = candidate;
      }
    }
    frontier = next;
  }
  return best.directions.length > 0 ? best : null;
}

function facingTowardNearestEnemy(state: GameState, formation: Formation): Direction {
  const blocks = liveFormationBlocks(state, formation);
  const enemies = sortedEnemyBlocks(state, formation.factionId);
  let closest: { block: TroopBlock; enemy: TroopBlock; distance: number } | null = null;
  for (const block of blocks) {
    for (const enemy of enemies) {
      const distance = manhattanDistance(block.position, enemy.position);
      if (!closest || distance < closest.distance
        || (distance === closest.distance && `${block.id}:${enemy.id}` < `${closest.block.id}:${closest.enemy.id}`)) {
        closest = { block, enemy, distance };
      }
    }
  }
  if (!closest) return formation.facing;
  const dx = closest.enemy.position.x - closest.block.position.x;
  const dy = closest.enemy.position.y - closest.block.position.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "east" : "west";
  if (dy !== 0) return dy > 0 ? "south" : "north";
  return dx > 0 ? "east" : dx < 0 ? "west" : formation.facing;
}

function engagedOrder(state: GameState, formation: Formation): "battle" | "press" {
  const previews = engagedContacts(state, formation.id)
    .map((contact) => pressurePreview(state, contact.attackerId, contact.defenderId, { allowAnyContact: true }))
    .filter((preview) => preview !== null);
  const canForceRetreat = previews.some((preview) =>
    preview.netPressure < BALANCE.battlePushPressureThreshold
    && preview.netPressure + BALANCE.pressPressureBonus >= BALANCE.pushPressureThreshold);
  const alreadyOverextended = previews.some((preview) => state.blocks[preview.attackerId]?.wavering);
  return formation.cohesion > BALANCE.breakingMoraleThreshold && canForceRetreat && !alreadyOverextended ? "press" : "battle";
}

/** A formation with nothing to its front spends its activation turning toward the most contacts. */
function turnTowardFlankingContacts(state: GameState, formation: Formation): Direction | null {
  const counts = new Map<Direction, number>();
  for (const contact of engagedContacts(state, formation.id)) {
    const attacker = state.blocks[contact.attackerId];
    const defender = state.blocks[contact.defenderId];
    const direction = attacker && defender ? directionBetween(attacker.position, defender.position) : null;
    if (direction) counts.set(direction, (counts.get(direction) ?? 0) + 1);
  }
  if (counts.size === 0 || counts.has(formation.facing)) return null;
  return CARDINAL_DIRECTIONS
    .filter((direction) => counts.has(direction))
    .sort((left, right) => counts.get(right)! - counts.get(left)!)[0] ?? null;
}

function planEngagedActivation(state: GameState, formation: Formation, steps: AiCommandStep[]): FormationPlan | null {
  const turn = turnTowardFlankingContacts(state, formation);
  if (turn) {
    if (!appendPlannedOrder(state, steps, { type: "turn", facing: turn })) return null;
    return {
      factionId: formation.factionId,
      formationId: formation.id,
      formationName: formation.name,
      intent: "turn",
      summary: `${formation.name} turns to face its attackers.`,
      steps,
      priority: 50_000,
    };
  }
  const action = engagedOrder(state, formation);
  const contacts = engagedContacts(state, formation.id).length;
  if (!appendPlannedOrder(state, steps, { type: action })) return null;
  return {
    factionId: formation.factionId,
    formationId: formation.id,
    formationName: formation.name,
    intent: action,
    summary: `${formation.name} ${action === "press" ? "presses" : "battles"} along ${contacts} contact${contacts === 1 ? "" : "s"}.`,
    steps,
    priority: 50_000 + contacts * 100,
  };
}

function planRangedActivation(state: GameState, formation: Formation, steps: AiCommandStep[]): FormationPlan | null {
  const target = sortedEnemyBlocks(state, formation.factionId)
    .map((enemy) => ({ enemy, preview: rangedAttackPreview(state, formation.id, enemy.id) }))
    .filter((candidate) => candidate.preview !== null)
    .sort((left, right) => right.preview!.casualties - left.preview!.casualties
      || right.preview!.damage - left.preview!.damage
      || left.enemy.id.localeCompare(right.enemy.id))[0];
  if (!target?.preview || !appendPlannedOrder(state, steps, { type: "shoot", defenderId: target.enemy.id })) return null;
  return {
    factionId: formation.factionId,
    formationId: formation.id,
    formationName: formation.name,
    intent: "shoot",
    summary: `${formation.name} shoots at ${target.enemy.formationId ? state.formations[target.enemy.formationId]?.name ?? target.enemy.id : target.enemy.id}.`,
    steps,
    priority: 40_000 + target.preview.casualties * 100 + target.preview.damage,
  };
}

function planChargeActivation(state: GameState, formation: Formation, steps: AiCommandStep[]): FormationPlan | null {
  const target = liveFormationBlocks(state, formation)
    .flatMap((attacker) => sortedEnemyBlocks(state, formation.factionId)
      .map((defender) => ({ attacker, defender, preview: chargePreview(state, attacker.id, defender.id) })))
    .filter((candidate) => candidate.preview !== null)
    .sort((left, right) => right.preview!.impactDamage - left.preview!.impactDamage
      || right.preview!.attackBonus - left.preview!.attackBonus
      || left.preview!.distance - right.preview!.distance
      || `${left.attacker.id}:${left.defender.id}`.localeCompare(`${right.attacker.id}:${right.defender.id}`))[0];
  if (!target?.preview || !appendPlannedOrder(state, steps, {
    type: "charge", attackerId: target.attacker.id, defenderId: target.defender.id,
  })) return null;
  return {
    factionId: formation.factionId,
    formationId: formation.id,
    formationName: formation.name,
    intent: "charge",
    summary: `${formation.name} charges ${target.defender.formationId ? state.formations[target.defender.formationId]?.name ?? target.defender.id : target.defender.id}.`,
    steps,
    priority: 45_000 + target.preview.impactDamage * 100 + target.preview.attackBonus * 10 - target.preview.distance,
  };
}

function planAdvanceActivation(state: GameState, formation: Formation, steps: AiCommandStep[]): FormationPlan | null {
  if (!appendPlannedOrder(state, steps, { type: "choose_action", action: "move" })) return null;
  const initialDistance = nearestEnemyDistance(state, formation);
  const movement = searchMovement(state, formation.id);
  if (!movement) return null;
  for (const direction of movement.directions) steps.push({ command: { type: "move", direction }, confirmed: true });
  const movedFormation = movement.state.formations[formation.id];
  if (!movedFormation) return null;
  // The move itself can break the formation, and a routed formation cannot choose a final facing.
  steps.push(formationFamilyIsRouted(movement.state, movedFormation.id)
    ? { command: { type: "end_activation" }, confirmed: false }
    : { command: { type: "finish_move", facing: facingTowardNearestEnemy(movement.state, movedFormation) }, confirmed: false });
  const improvement = Number.isFinite(initialDistance) ? initialDistance - movement.distance : 0;
  return {
    factionId: formation.factionId,
    formationId: formation.id,
    formationName: formation.name,
    intent: "advance",
    summary: `${formation.name} advances ${movement.directions.length} square${movement.directions.length === 1 ? "" : "s"} toward the enemy.`,
    steps,
    priority: 10_000 + improvement * 100 - movement.distance * 10,
  };
}

function planStationaryActivation(state: GameState, formation: Formation, steps: AiCommandStep[]): FormationPlan | null {
  const action: "brace" | "hold" = commandLegality(state, "brace").accepted ? "brace" : "hold";
  if (!appendPlannedOrder(state, steps, { type: action })) return null;
  return {
    factionId: formation.factionId,
    formationId: formation.id,
    formationName: formation.name,
    intent: action,
    summary: `${formation.name} ${action === "brace" ? "braces for contact" : "holds position"}.`,
    steps,
    priority: action === "brace" ? 200 : 100,
  };
}

/** Last resort: a formation with no usable order passes, so the battle can never wait on the AI forever. */
function planPassActivation(state: GameState, formation: Formation, steps: AiCommandStep[]): FormationPlan | null {
  if (!appendPlannedOrder(state, steps, { type: "end_activation" })) return null;
  return {
    factionId: formation.factionId,
    formationId: formation.id,
    formationName: formation.name,
    intent: "hold",
    summary: `${formation.name} has no usable order and stands fast.`,
    steps,
    priority: 0,
  };
}

function planFormationActivation(original: GameState, formationId: string): FormationPlan | null {
  const state = structuredClone(original);
  const formation = state.formations[formationId];
  if (!formation) return null;
  const steps: AiCommandStep[] = [];
  const select = selectionStep(state, formation);
  if (!select) return null;
  steps.push(select);

  if (formationIsEngaged(state, formation.id)) {
    return planEngagedActivation(state, formation, steps) ?? planPassActivation(state, formation, steps);
  }
  const charge = planChargeActivation(structuredClone(state), structuredClone(formation), [...steps]);
  if (charge) return charge;
  const ranged = planRangedActivation(structuredClone(state), structuredClone(formation), [...steps]);
  if (ranged) return ranged;
  return planAdvanceActivation(structuredClone(state), structuredClone(formation), [...steps])
    ?? planStationaryActivation(state, formation, steps)
    ?? planPassActivation(state, formation, steps);
}

function eligibleFormationIds(state: GameState, factionId: FactionId): string[] {
  const seen = new Set<string>();
  return Object.values(state.formations)
    .filter((formation) => formation.factionId === factionId && formation.blockIds.length > 0)
    .sort((left, right) => left.id.localeCompare(right.id))
    .filter((formation) => {
      const activationId = formation.provisionalFamilyId ?? formation.id;
      if (seen.has(activationId) || !canSelectFormation(state, formation.id)) return false;
      seen.add(activationId);
      return true;
    })
    .map((formation) => formation.id);
}

/** Plans one deterministic unit-level activation without mutating the supplied game state. */
export function planAiActivation(state: GameState, factionId: FactionId = state.activeFactionId): AiActivationPlan | null {
  if (state.activeFactionId !== factionId || sortedEnemyBlocks(state, factionId).length === 0) return null;
  const plans = eligibleFormationIds(state, factionId)
    .map((formationId) => planFormationActivation(state, formationId))
    .filter((plan): plan is FormationPlan => plan !== null)
    .sort((left, right) => right.priority - left.priority || left.formationId.localeCompare(right.formationId));
  const selected = plans[0];
  if (!selected) return null;
  return {
    factionId: selected.factionId,
    formationId: selected.formationId,
    formationName: selected.formationName,
    intent: selected.intent,
    summary: selected.summary,
    steps: selected.steps,
  };
}
