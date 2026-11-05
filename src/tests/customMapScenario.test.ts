import { describe, expect, it } from "vitest";
import {
  createBlankBattlefieldMap,
  setMapDeploymentBlock,
  setMapSpawnPoint,
} from "../gridBattle/model/battlefieldMap";
import { eliminateAllEnemiesObjective } from "../gridBattle/rules/campaignObjectives";
import { createCustomMapScenario } from "../gridBattle/scenario/customMapScenario";
import { ROMAN_ARCHETYPE_IDS, SUPPORT_ARCHETYPE_IDS } from "../units/UnitArchetypes";

function customBattleState() {
  const map = createBlankBattlefieldMap(8, 6);
  setMapDeploymentBlock(map, { x: 1, y: 4 }, "roman", ROMAN_ARCHETYPE_IDS.garrisonCentury);
  setMapDeploymentBlock(map, { x: 2, y: 4 }, "roman", ROMAN_ARCHETYPE_IDS.garrisonCentury);
  setMapDeploymentBlock(map, { x: 6, y: 1 }, "saxon", SUPPORT_ARCHETYPE_IDS.saxonInfantry);
  setMapSpawnPoint(map, { x: 0, y: 5 }, "roman");
  return createCustomMapScenario(map);
}

describe("custom map battles", () => {
  it("turns each connected deployment into one formation with one troop block per painted tile", () => {
    const state = customBattleState();
    const formations = Object.values(state.formations);
    const romans = formations.filter((formation) => formation.factionId === "roman");
    const saxons = formations.filter((formation) => formation.factionId === "saxon");

    expect(formations).toHaveLength(2);
    expect(romans[0]?.blockIds).toHaveLength(2);
    expect(saxons[0]?.blockIds).toHaveLength(1);
    expect(Object.values(state.blocks)).toHaveLength(3);
    expect(state.battlefield.spawnPoints).toEqual([
      { factionId: "roman", position: { x: 0, y: 5 } },
    ]);
    expect(Object.values(state.blocks).some((block) => block.position.x === 0 && block.position.y === 5)).toBe(false);
  });

  it("ends a custom battle when every enemy formation is ineffective", () => {
    const state = customBattleState();
    const objective = eliminateAllEnemiesObjective();

    expect(objective.evaluate(state)).toMatchObject({
      outcome: "ongoing",
      progress: [{ value: "0 / 1", state: "pending" }],
    });

    const saxon = Object.values(state.formations).find((formation) => formation.factionId === "saxon")!;
    saxon.status = "routed";
    expect(objective.evaluate(state)).toMatchObject({
      outcome: "romanVictory",
      progress: [{ value: "1 / 1", state: "complete" }],
    });
  });
});
