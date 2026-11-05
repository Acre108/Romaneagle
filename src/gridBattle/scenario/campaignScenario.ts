import { TEST_SCENARIO_MISSION_ID, TEST_UNIT_OPTIONS } from "../../scenario/TestScenario";
import type { GameState } from "../model/types";
import { applyTestRomanDeployment } from "./campaignRomanDeployment";
import { createBlackwaterFordScenario } from "./blackwaterFordScenario";
import { createHadriansWallScenario } from "./hadriansWallScenario";
import { createPrototypeGridScenario } from "./prototypeScenario";
import { createVindolandaScenario } from "./vindolandaScenario";

export type GridBattleScenarioFactory = () => GameState;

export function scenarioFactoryForMission(
  missionId: string,
  selectedRomanFormationIds: readonly string[] = [],
): GridBattleScenarioFactory {
  if (missionId === "roman-1-hadrians-wall") {
    return () => createHadriansWallScenario(selectedRomanFormationIds);
  }
  if (missionId === "roman-2-blackwater-ford") {
    return () => createBlackwaterFordScenario(selectedRomanFormationIds);
  }
  if (missionId === "roman-3-raven-at-vindolanda") {
    return () => createVindolandaScenario(selectedRomanFormationIds);
  }
  const selected = missionId === TEST_SCENARIO_MISSION_ID
    ? TEST_UNIT_OPTIONS.filter((option) => selectedRomanFormationIds.includes(option.id))
    : [];
  if (selected.length > 0) {
    return () => {
      const state = createPrototypeGridScenario();
      applyTestRomanDeployment(state, selected);
      return state;
    };
  }
  return createPrototypeGridScenario;
}
