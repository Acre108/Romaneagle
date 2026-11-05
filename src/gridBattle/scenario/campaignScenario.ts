import { DEFAULT_TEST_UNIT_IDS, TEST_SCENARIO_MISSION_ID, TEST_UNIT_OPTIONS } from "../../scenario/TestScenario";
import type { GameState } from "../model/types";
import { applyTestRomanDeployment } from "./campaignRomanDeployment";
import { createBlackwaterFordScenario } from "./blackwaterFordScenario";
import { createHadriansWallScenario } from "./hadriansWallScenario";
import { OPEN_FIELD_ROMAN_FRONT_ROW, createOpenFieldScenario } from "./openFieldScenario";
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
  if (missionId === TEST_SCENARIO_MISSION_ID) {
    const selected = TEST_UNIT_OPTIONS.filter((option) => selectedRomanFormationIds.includes(option.id));
    const romans = selected.length > 0
      ? selected
      : TEST_UNIT_OPTIONS.filter((option) => DEFAULT_TEST_UNIT_IDS.includes(option.id));
    return () => {
      const state = createOpenFieldScenario();
      applyTestRomanDeployment(state, romans, OPEN_FIELD_ROMAN_FRONT_ROW);
      return state;
    };
  }
  return createPrototypeGridScenario;
}
