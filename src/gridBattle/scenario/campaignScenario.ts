import type { GameState } from "../model/types";
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
  return createPrototypeGridScenario;
}
