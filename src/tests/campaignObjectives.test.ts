import { describe, expect, it } from "vitest";
import { objectiveDefinitionForMission } from "../gridBattle/rules/campaignObjectives";
import { scenarioFactoryForMission } from "../gridBattle/scenario/campaignScenario";

function route(state: ReturnType<ReturnType<typeof scenarioFactoryForMission>>, ids: readonly string[]): void {
  for (const id of ids) state.formations[id]!.status = "routed";
}

describe("campaign mission objectives", () => {
  it("wins Mission One when the assault breaks and loses when an effective Pict reaches the Wall", () => {
    const romans = ["R-I", "R-II", "R-CAV"];
    const objective = objectiveDefinitionForMission("roman-1-hadrians-wall", romans);
    const victoryState = scenarioFactoryForMission("roman-1-hadrians-wall", romans)();

    expect(objective.evaluate(victoryState).outcome).toBe("ongoing");
    route(victoryState, ["great-warband", "loose-warband", "saxon-cavalry"]);
    expect(objective.evaluate(victoryState)).toMatchObject({
      outcome: "romanVictory",
      progress: [
        { id: "wall-line", value: "Secure" },
        { id: "pict-assault", value: "3 / 3", state: "complete" },
      ],
    });

    const defeatState = scenarioFactoryForMission("roman-1-hadrians-wall", romans)();
    defeatState.blocks[defeatState.formations["loose-warband"]!.blockIds[0]!]!.position.y = 11;
    const defeat = objective.evaluate(defeatState);
    expect(defeat.outcome).toBe("saxonVictory");
    expect(defeat.progress[0]).toMatchObject({ id: "wall-line", value: "Breached", state: "failed" });
  });

  it("wins Mission Two from the bridgehead state rather than surviving model totals", () => {
    const romans = ["R-II", "R-III", "R-CAV", "R-ARCH"];
    const objective = objectiveDefinitionForMission("roman-2-blackwater-ford", romans);
    const state = scenarioFactoryForMission("roman-2-blackwater-ford", romans)();

    const initial = objective.evaluate(state);
    expect(initial.outcome).toBe("ongoing");
    expect(initial.progress[0]).toMatchObject({ id: "bridgehead", value: "Holding" });
    route(state, ["loose-warband"]);
    expect(objective.evaluate(state)).toMatchObject({
      outcome: "romanVictory",
      progress: [
        { id: "bridgehead", value: "Broken", state: "complete" },
        { id: "southern-bank", value: "0", state: "complete" },
        { id: "stanegate-road", value: "Secure" },
      ],
    });
  });

  it("loses Mission Two if an effective Saxon formation reaches the Stanegate road", () => {
    const romans = ["R-II", "R-III", "R-CAV"];
    const state = scenarioFactoryForMission("roman-2-blackwater-ford", romans)();
    const looseBlock = state.blocks[state.formations["loose-warband"]!.blockIds[0]!]!;
    looseBlock.position.y = 12;

    expect(objectiveDefinitionForMission("roman-2-blackwater-ford", romans).evaluate(state)).toMatchObject({
      outcome: "saxonVictory",
      progress: [
        { id: "bridgehead", value: "Holding" },
        { id: "southern-bank" },
        { id: "stanegate-road", value: "Overrun", state: "failed" },
      ],
    });
  });

  it("wins Mission Three when the Raven guard breaks even if its supporting formations remain", () => {
    const romans = ["R-I", "R-III", "R-IV", "R-CAV", "R-ARCH"];
    const state = scenarioFactoryForMission("roman-3-raven-at-vindolanda", romans)();
    route(state, ["great-warband"]);

    expect(objectiveDefinitionForMission("roman-3-raven-at-vindolanda", romans).evaluate(state)).toMatchObject({
      outcome: "romanVictory",
      progress: [
        { id: "raven-guard", value: "Broken", state: "complete" },
        { id: "raven-host", value: "2", state: "complete" },
      ],
    });
  });

  it("loses when every selected Roman formation is routed and ignores allied wall archers", () => {
    const romans = ["R-I", "R-II", "R-CAV"];
    const state = scenarioFactoryForMission("roman-1-hadrians-wall", romans)();
    route(state, romans);

    expect(state.formations["wall-archers"]?.status).toBe("formed");
    expect(objectiveDefinitionForMission("roman-1-hadrians-wall", romans).evaluate(state).outcome)
      .toBe("saxonVictory");
  });

  it("keeps the sandbox battle ongoing even though its roster ids differ from grid ids", () => {
    const state = scenarioFactoryForMission("test-field-trials", ["test-field-century"])();
    const evaluation = objectiveDefinitionForMission("test-field-trials", ["test-field-century"]).evaluate(state);

    expect(evaluation.outcome).toBe("ongoing");
    expect(evaluation.progress[0]).toMatchObject({ value: "0 / 5", state: "pending" });
  });
});
