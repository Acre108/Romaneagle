import type { FactionId, Formation, GameState, TroopBlock } from "../model/types";
import { originalFormationId } from "./splitting";

export type ObjectiveOutcome = "ongoing" | "romanVictory" | "saxonVictory" | "mutualDestruction";
export type ObjectiveProgressState = "pending" | "complete" | "failed";

export interface ObjectiveProgressItem {
  id: string;
  label: string;
  value: string;
  state: ObjectiveProgressState;
}

export interface ObjectiveEvaluation {
  outcome: ObjectiveOutcome;
  status: string;
  progress: readonly ObjectiveProgressItem[];
}

export interface MissionObjectiveDefinition {
  evaluate(state: GameState): ObjectiveEvaluation;
}

const SAXON_FORMATION_IDS = ["great-warband", "loose-warband", "saxon-cavalry"] as const;

function familyFormations(state: GameState, originalId: string): Formation[] {
  return Object.values(state.formations).filter((formation) => originalFormationId(formation.id) === originalId);
}

function familyIsEffective(state: GameState, originalId: string): boolean {
  const formations = familyFormations(state, originalId);
  return formations.some((formation) => formation.blockIds.length > 0 && formation.status !== "routed");
}

function effectiveFamilyCount(state: GameState, ids: readonly string[]): number {
  return ids.filter((id) => familyIsEffective(state, id)).length;
}

function selectedRomansCollapsed(state: GameState, selectedRomanFormationIds: readonly string[]): boolean {
  return selectedRomanFormationIds.length > 0
    && selectedRomanFormationIds.every((id) => !familyIsEffective(state, id));
}

function effectiveBlocks(state: GameState, factionId: FactionId): TroopBlock[] {
  return Object.values(state.blocks).filter((block) => {
    if (block.factionId !== factionId || block.formationId === null) return false;
    return familyIsEffective(state, originalFormationId(block.formationId));
  });
}

function outcome(romanWon: boolean, romansCollapsed: boolean): ObjectiveOutcome {
  if (romanWon && romansCollapsed) return "mutualDestruction";
  if (romanWon) return "romanVictory";
  if (romansCollapsed) return "saxonVictory";
  return "ongoing";
}

export function eliminateAllEnemiesObjective(): MissionObjectiveDefinition {
  const knownRomanIds = new Set<string>();
  const knownSaxonIds = new Set<string>();
  return {
    evaluate(state) {
      for (const formation of Object.values(state.formations)) {
        const ids = formation.factionId === "roman" ? knownRomanIds : knownSaxonIds;
        ids.add(originalFormationId(formation.id));
      }
      const romanIds = [...knownRomanIds];
      const saxonIds = [...knownSaxonIds];
      const romansEffective = effectiveFamilyCount(state, romanIds);
      const saxonsEffective = effectiveFamilyCount(state, saxonIds);
      const romansCollapsed = romansEffective === 0;
      const romanWon = saxonsEffective === 0;
      return {
        outcome: outcome(romanWon, romansCollapsed),
        status: romanWon ? "The opposing force has broken." : "Break every opposing formation.",
        progress: [{
          id: "enemy-force",
          label: "Enemy formations broken",
          value: `${saxonIds.length - saxonsEffective} / ${saxonIds.length}`,
          state: romanWon ? "complete" : "pending",
        }],
      };
    },
  };
}

function genericObjective(): MissionObjectiveDefinition {
  return eliminateAllEnemiesObjective();
}

function hadriansWallObjective(selectedRomanFormationIds: readonly string[]): MissionObjectiveDefinition {
  return {
    evaluate(state) {
      const saxonsEffective = effectiveFamilyCount(state, SAXON_FORMATION_IDS);
      const wallBreached = effectiveBlocks(state, "saxon").some((block) => block.position.y >= 11);
      const romansCollapsed = selectedRomansCollapsed(state, selectedRomanFormationIds);
      const romanWon = saxonsEffective === 0 && !wallBreached;
      const romanLost = romansCollapsed || wallBreached;
      return {
        outcome: outcome(romanWon, romanLost),
        status: wallBreached
          ? "The Picts have breached the Wall line."
          : romanWon ? "The assault has broken before the Wall." : "Hold the gate and break the assault.",
        progress: [
          {
            id: "wall-line",
            label: "Wall line",
            value: wallBreached ? "Breached" : "Secure",
            state: wallBreached ? "failed" : "pending",
          },
          {
            id: "pict-assault",
            label: "Pict formations broken",
            value: `${SAXON_FORMATION_IDS.length - saxonsEffective} / ${SAXON_FORMATION_IDS.length}`,
            state: saxonsEffective === 0 ? "complete" : "pending",
          },
        ],
      };
    },
  };
}

function blackwaterFordObjective(selectedRomanFormationIds: readonly string[]): MissionObjectiveDefinition {
  return {
    evaluate(state) {
      const bridgeheadBroken = !familyIsEffective(state, "loose-warband");
      const southernBankSaxons = effectiveBlocks(state, "saxon").filter((block) => block.position.y >= 8);
      const roadOverrun = southernBankSaxons.some((block) => block.position.y >= 12);
      const romansCollapsed = selectedRomansCollapsed(state, selectedRomanFormationIds);
      const romanWon = bridgeheadBroken && southernBankSaxons.length === 0 && !roadOverrun;
      const romanLost = romansCollapsed || roadOverrun;
      return {
        outcome: outcome(romanWon, romanLost),
        status: roadOverrun
          ? "The Saxons have reached the Stanegate road."
          : romanWon ? "The bridgehead is broken and the southern bank is clear."
            : "Break the bridgehead and clear every Saxon from the southern bank.",
        progress: [
          {
            id: "bridgehead",
            label: "Saxon bridgehead",
            value: bridgeheadBroken ? "Broken" : "Holding",
            state: bridgeheadBroken ? "complete" : "pending",
          },
          {
            id: "southern-bank",
            label: "Effective Saxon blocks on south bank",
            value: String(southernBankSaxons.length),
            state: southernBankSaxons.length === 0 ? "complete" : "pending",
          },
          {
            id: "stanegate-road",
            label: "Stanegate road",
            value: roadOverrun ? "Overrun" : "Secure",
            state: roadOverrun ? "failed" : "pending",
          },
        ],
      };
    },
  };
}

function vindolandaObjective(selectedRomanFormationIds: readonly string[]): MissionObjectiveDefinition {
  return {
    evaluate(state) {
      const ravenGuardBroken = !familyIsEffective(state, "great-warband");
      const saxonsEffective = effectiveFamilyCount(state, SAXON_FORMATION_IDS);
      const romansCollapsed = selectedRomansCollapsed(state, selectedRomanFormationIds);
      return {
        outcome: outcome(ravenGuardBroken, romansCollapsed),
        status: ravenGuardBroken
          ? "The Raven guard has broken; the host is scattering."
          : "Break the Raven guard beneath the fort.",
        progress: [
          {
            id: "raven-guard",
            label: "Raven guard",
            value: ravenGuardBroken ? "Broken" : "Holding",
            state: ravenGuardBroken ? "complete" : "pending",
          },
          {
            id: "raven-host",
            label: "Host formations still effective",
            value: String(saxonsEffective),
            state: ravenGuardBroken ? "complete" : "pending",
          },
        ],
      };
    },
  };
}

export function objectiveDefinitionForMission(
  missionId: string,
  selectedRomanFormationIds: readonly string[],
): MissionObjectiveDefinition {
  if (missionId === "roman-1-hadrians-wall") return hadriansWallObjective(selectedRomanFormationIds);
  if (missionId === "roman-2-blackwater-ford") return blackwaterFordObjective(selectedRomanFormationIds);
  if (missionId === "roman-3-raven-at-vindolanda") return vindolandaObjective(selectedRomanFormationIds);
  return genericObjective();
}
