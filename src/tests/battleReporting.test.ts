import { describe, expect, it } from "vitest";
import { compileFormationBattleResults } from "../gridBattle/rules/battleReporting";
import { scenarioFactoryForMission } from "../gridBattle/scenario/campaignScenario";
import { ROMAN_FORMATION_BY_ID } from "../scenario/Roster";

const selected = ["R-I", "R-II", "R-CAV"] as const;

function baselines() {
  return selected.map((id) => {
    const formation = ROMAN_FORMATION_BY_ID.get(id)!;
    return { id, name: formation.name, maximumStrength: formation.count };
  });
}

describe("formation battle reporting", () => {
  it("reports each formation's own losses and live morale state", () => {
    const state = scenarioFactoryForMission("roman-1-hadrians-wall", selected)();
    state.blocks[state.formations["R-I"]!.blockIds[0]!]!.models -= 5;
    state.formations["R-II"]!.status = "routed";

    const results = compileFormationBattleResults(state, baselines());
    expect(results.find((result) => result.id === "R-I")).toMatchObject({
      strength: 75,
      casualties: 5,
      state: "steady",
    });
    expect(results.find((result) => result.id === "R-II")).toMatchObject({
      strength: 80,
      casualties: 0,
      state: "routing",
    });
  });

  it("counts soldiers who leave the map as escaped survivors rather than casualties", () => {
    const state = scenarioFactoryForMission("roman-1-hadrians-wall", selected)();
    const cavalry = state.formations["R-CAV"]!;
    state.departedBlocks = cavalry.blockIds.map((blockId) => {
      const block = state.blocks[blockId]!;
      delete state.blocks[blockId];
      return {
        block: { ...block, position: { ...block.position } },
        from: { ...block.position },
        to: { x: block.position.x, y: block.position.y + 1 },
      };
    });
    delete state.formations["R-CAV"];

    expect(compileFormationBattleResults(state, baselines()).find((result) => result.id === "R-CAV"))
      .toMatchObject({ strength: 40, casualties: 0, state: "escaped" });
  });

  it("reports a destroyed formation as lost with no surviving soldiers", () => {
    const state = scenarioFactoryForMission("roman-1-hadrians-wall", selected)();
    for (const blockId of state.formations["R-I"]!.blockIds) delete state.blocks[blockId];
    delete state.formations["R-I"];

    expect(compileFormationBattleResults(state, baselines()).find((result) => result.id === "R-I"))
      .toMatchObject({ strength: 0, casualties: 80, state: "broken" });
  });
});
