import type { BattleReport } from "../campaign/BattleReport";
import type { MissionDefinition } from "../campaign/CampaignTypes";
import { GridBattleController, type GridBattleConclusion } from "../gridBattle/app/GameController";
import { scenarioFactoryForMission } from "../gridBattle/scenario/campaignScenario";
import { ROMAN_FORMATION_BY_ID } from "../scenario/Roster";
import { TEST_UNIT_OPTIONS } from "../scenario/TestScenario";
import { getUnitArchetype } from "../units/UnitArchetypes";
import type { UnitType } from "../units/types";
import type { UnitState } from "../units/types";
import { objectiveDefinitionForMission } from "../gridBattle/rules/campaignObjectives";
import { eliminateAllEnemiesObjective } from "../gridBattle/rules/campaignObjectives";
import { createCustomMapScenario } from "../gridBattle/scenario/customMapScenario";
import type { BattlefieldMap } from "../gridBattle/model/battlefieldMap";

function reportDefinition(id: string): { name: string; maximum: number; type: UnitType } {
  const campaignFormation = ROMAN_FORMATION_BY_ID.get(id);
  if (campaignFormation) {
    return {
      name: campaignFormation.name,
      maximum: campaignFormation.count,
      type: getUnitArchetype(campaignFormation.archetypeId).type,
    };
  }
  const testFormation = TEST_UNIT_OPTIONS.find((option) => option.id === id);
  if (testFormation) {
    return {
      name: testFormation.name,
      maximum: testFormation.strength,
      type: getUnitArchetype(testFormation.archetypeId).type,
    };
  }
  return { name: id, maximum: 80, type: "infantry" };
}

function reportState(ratio: number): UnitState {
  if (ratio <= 0) return "broken";
  if (ratio < 0.35) return "shaken";
  return "steady";
}

export class Game {
  private controller: GridBattleController | null = null;
  private stopped = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly mission: MissionDefinition,
    private readonly selectedRomanUnitIds: readonly string[],
    private readonly onBattleEnded?: (report: BattleReport) => void,
  ) {}

  start(): void {
    this.stopped = false;
    const controller = new GridBattleController(
      this.canvas,
      (conclusion) => this.handleConclusion(conclusion),
      scenarioFactoryForMission(this.mission.id, this.selectedRomanUnitIds),
      "saxon",
      objectiveDefinitionForMission(this.mission.id, this.selectedRomanUnitIds),
      this.mission.campaignId === "test",
      this.mission.battle.enemyLabel,
    );
    this.controller = controller;
    void controller.start().catch((error: unknown) => {
      console.error("Unable to initialise the PixiJS grid battle", error);
      const help = document.getElementById("grid-action-help");
      if (help) help.textContent = "The battlefield renderer could not start. Check WebGL support and reload.";
    });
  }

  private handleConclusion(conclusion: GridBattleConclusion): void {
    if (this.stopped) return;
    const battleCopy = this.mission.battle;
    const title = conclusion.outcome === "romanVictory" ? battleCopy.victoryTitle
      : conclusion.outcome === "saxonVictory" ? battleCopy.defeatTitle : battleCopy.mutualTitle;
    const detail = conclusion.outcome === "romanVictory" ? battleCopy.victoryDetail
      : conclusion.outcome === "saxonVictory" ? battleCopy.defeatDetail : battleCopy.mutualDetail;
    const titleElement = document.getElementById("battle-result-title");
    const detailElement = document.getElementById("battle-result-detail");
    const resultElement = document.getElementById("battle-result");
    if (titleElement) titleElement.textContent = title;
    if (detailElement) detailElement.textContent = detail;
    if (resultElement) resultElement.hidden = false;

    const ratio = conclusion.romanMaximumStrength > 0
      ? conclusion.romanStrength / conclusion.romanMaximumStrength
      : 0;
    const ids = this.selectedRomanUnitIds.length > 0 ? this.selectedRomanUnitIds : ["prototype-company"];
    this.onBattleEnded?.({
      outcome: conclusion.outcome,
      formations: ids.map((id) => {
        const definition = reportDefinition(id);
        const battlefieldFormation = conclusion.romanFormations.find((formation) => formation.id === id);
        const formationRatio = battlefieldFormation && battlefieldFormation.maximumStrength > 0
          ? battlefieldFormation.strength / battlefieldFormation.maximumStrength
          : ratio;
        return {
          id,
          name: definition.name,
          type: definition.type,
          soldierCount: battlefieldFormation
            ? Math.min(definition.maximum, battlefieldFormation.strength)
            : Math.round(definition.maximum * ratio),
          maximumSoldiers: definition.maximum,
          state: battlefieldFormation?.state ?? reportState(formationRatio),
        };
      }),
    });
  }

  stop(): void {
    this.stopped = true;
    this.controller?.stop();
    this.controller = null;
  }
}

export class CustomMapGame {
  private controller: GridBattleController | null = null;
  private stopped = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly map: BattlefieldMap,
    private readonly mapName: string,
  ) {}

  start(): void {
    this.stopped = false;
    const controller = new GridBattleController(
      this.canvas,
      (conclusion) => this.handleConclusion(conclusion),
      () => createCustomMapScenario(this.map),
      "saxon",
      eliminateAllEnemiesObjective(),
      true,
    );
    this.controller = controller;
    void controller.start().catch((error: unknown) => {
      console.error("Unable to initialise the custom PixiJS grid battle", error);
      const help = document.getElementById("grid-action-help");
      if (help) help.textContent = "The custom battlefield could not start. Check the map deployments and reload.";
    });
  }

  private handleConclusion(conclusion: GridBattleConclusion): void {
    if (this.stopped) return;
    const title = conclusion.outcome === "romanVictory" ? "Custom battle won"
      : conclusion.outcome === "saxonVictory" ? "Custom battle lost" : "Mutual destruction";
    const detail = conclusion.outcome === "romanVictory"
      ? `Every enemy formation on ${this.mapName} has broken.`
      : conclusion.outcome === "saxonVictory"
        ? `The Roman force on ${this.mapName} has been defeated.`
        : `Neither force remains effective on ${this.mapName}.`;
    const titleElement = document.getElementById("battle-result-title");
    const detailElement = document.getElementById("battle-result-detail");
    const resultElement = document.getElementById("battle-result");
    const returnButton = document.getElementById("return-from-battle") as HTMLButtonElement | null;
    if (titleElement) titleElement.textContent = title;
    if (detailElement) detailElement.textContent = detail;
    if (resultElement) resultElement.hidden = false;
    if (returnButton) {
      returnButton.hidden = false;
      returnButton.querySelector("span")!.textContent = "RETURN TO MAPS";
      returnButton.querySelector("small")!.textContent = "Back to campaign selection";
    }
  }

  stop(): void {
    this.stopped = true;
    this.controller?.stop();
    this.controller = null;
  }
}
