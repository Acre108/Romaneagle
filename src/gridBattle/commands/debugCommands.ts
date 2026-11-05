import type { GameState } from "../model/types";
import { createContestedCell, damageBlock, retreatBlock } from "../rules/combat";
import { resolveContestedMelees, resolveDuels } from "../rules/contestedMelee";
import { forceSplit } from "../rules/formationActions";
import { resolveRoutingFormationActivation } from "../rules/routing";
import { provisionalFormationFamily, recalculateAllConnectivity } from "../rules/splitting";
import type { CommandResult } from "./executeCommand";

/** Developer shortcuts behind the battle screen's Debug panel. They skip the rules on purpose. */
export type DebugCommand =
  | { type: "debug_damage" }
  | { type: "debug_retreat" }
  | { type: "debug_route" }
  | { type: "debug_split" }
  | { type: "debug_contested" }
  | { type: "debug_resolve" }
  | { type: "debug_restore" };

export function isDebugCommand(command: { type: string }): command is DebugCommand {
  return command.type.startsWith("debug_");
}

const NO_BLOCK: CommandResult = { accepted: false, reason: "Select an individual block first." };
const NO_FORMATION: CommandResult = { accepted: false, reason: "Select a formation first." };

export function executeDebugCommand(state: GameState, command: DebugCommand): CommandResult {
  const formation = state.selectedFormationId ? state.formations[state.selectedFormationId] : undefined;
  switch (command.type) {
    case "debug_damage":
      if (!state.selectedBlockId) return NO_BLOCK;
      damageBlock(state, state.selectedBlockId, 1, "debug command");
      return { accepted: true };
    case "debug_retreat":
      if (!state.selectedBlockId) return NO_BLOCK;
      retreatBlock(state, state.selectedBlockId);
      return { accepted: true };
    case "debug_route":
      if (!formation) return NO_FORMATION;
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
    case "debug_split":
      if (!formation || !forceSplit(state, formation.id)) return { accepted: false, reason: "Select a formation with at least three blocks." };
      return { accepted: true };
    case "debug_contested": {
      if (!state.selectedBlockId) return NO_BLOCK;
      const defender = state.blocks[state.selectedBlockId];
      if (!defender) return { accepted: false, reason: "Selected block no longer exists." };
      const attacker = Object.values(state.blocks)
        .filter((block) => block.factionId !== defender.factionId && !block.isContested)
        .sort((a, b) => Math.abs(a.position.x - defender.position.x) + Math.abs(a.position.y - defender.position.y)
          - Math.abs(b.position.x - defender.position.x) - Math.abs(b.position.y - defender.position.y))[0];
      if (!attacker || !createContestedCell(state, attacker.id, defender.id)) return { accepted: false, reason: "No enemy block can be used." };
      return { accepted: true };
    }
    case "debug_resolve":
      resolveContestedMelees(state);
      resolveDuels(state);
      return { accepted: true };
    case "debug_restore":
      if (!formation) return NO_FORMATION;
      formation.cohesion = formation.maxCohesion;
      formation.status = formation.provisionalFamilyId ? "fragment" : "formed";
      formation.routingActivations = undefined;
      formation.routingStalledActivations = undefined;
      for (const blockId of formation.blockIds) if (state.blocks[blockId]) state.blocks[blockId]!.wavering = false;
      recalculateAllConnectivity(state);
      return { accepted: true };
  }
}
