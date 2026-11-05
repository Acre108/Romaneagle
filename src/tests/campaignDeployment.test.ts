import { describe, expect, it } from "vitest";
import { mapTileAt } from "../gridBattle/model/battlefieldMap";
import { scenarioFactoryForMission } from "../gridBattle/scenario/campaignScenario";
import { createPrototypeGridScenario } from "../gridBattle/scenario/prototypeScenario";
import { ROMAN_FORMATION_BY_ID } from "../scenario/Roster";
import type { GameState } from "../gridBattle/model/types";
import { formationModelCount } from "../gridBattle/model/unitStats";
import { terrainBlocksVoluntaryMovement } from "../gridBattle/model/terrain";

function expectLegalDeployment(state: GameState): void {
  const occupied = new Set<string>();
  for (const block of Object.values(state.blocks)) {
    const tile = mapTileAt(state.battlefield, block.position);
    expect(tile, block.id).toBeDefined();
    expect(terrainBlocksVoluntaryMovement(tile!.terrain), block.id).toBe(false);
    expect(state.battlefield.buildingCells[`${block.position.x},${block.position.y}`], block.id).toBeUndefined();
    const key = `${block.position.x},${block.position.y}`;
    expect(occupied.has(key), block.id).toBe(false);
    occupied.add(key);
  }
}

function expectSelectedRomans(state: GameState, selectedIds: readonly string[]): void {
  for (const id of selectedIds) {
    const definition = ROMAN_FORMATION_BY_ID.get(id)!;
    const formation = state.formations[id];
    expect(formation?.name).toBe(definition.name);
    expect(formationModelCount(state, formation!)).toBe(definition.count);
    expect(formation?.initialModelCount).toBe(definition.count);
    expect(formation?.leaderCharacterId).toBe(definition.companion.id);
    expect(state.characters[definition.companion.id]?.name).toBe(definition.companion.name);
  }
}

describe("campaign battlefield deployment", () => {
  it("spawns Mission One's two chosen cohorts and cavalry, plus only its allied wall archers", () => {
    const selected = ["R-I", "R-II", "R-CAV"];
    const state = scenarioFactoryForMission("roman-1-hadrians-wall", selected)();
    const romanIds = Object.values(state.formations)
      .filter((formation) => formation.factionId === "roman")
      .map((formation) => formation.id)
      .sort();

    expect(romanIds).toEqual([...selected, "wall-archers"].sort());
    expectSelectedRomans(state, selected);
    expect(state.formations["R-CAV"]?.unit.unitType).toBe("heavy_cavalry");
    expect(state.formations["wall-archers"]?.name).toBe("Allied Wall Archers");
    expectLegalDeployment(state);
  });

  it("honours a reduced Mission Two selection without silently adding omitted cohorts", () => {
    const selected = ["R-II", "R-CAV", "R-ARCH"];
    const state = scenarioFactoryForMission("roman-2-blackwater-ford", selected)();

    expectSelectedRomans(state, selected);
    expect(state.formations["R-III"]).toBeUndefined();
    expect(state.formations["R-ARCH"]?.unit.rangedWeaponId).toBe("composite-bow");
    expect(state.formations["R-ARCH"]?.ammunition).toBe(12);
    expectLegalDeployment(state);
  });

  it("deploys all five selected Vindolanda formations with exact roster strength and commanders", () => {
    const selected = ["R-I", "R-III", "R-IV", "R-CAV", "R-ARCH"];
    const create = scenarioFactoryForMission("roman-3-raven-at-vindolanda", selected);
    const state = create();

    expectSelectedRomans(state, selected);
    expect(state.formations["R-II"]).toBeUndefined();
    expect(Object.values(state.formations).filter((formation) => formation.factionId === "roman")).toHaveLength(5);
    expect(state.characters.aelia?.hostBlockId.startsWith("R-ARCH-b")).toBe(true);
    expectLegalDeployment(state);
    expect(JSON.stringify(create())).toBe(JSON.stringify(state));
  });

  it.each([
    ["roman-1-hadrians-wall", { x: 0, y: 11 }, "fortress_wall"],
    ["roman-2-blackwater-ford", { x: 0, y: 6 }, "river_deep"],
    ["roman-3-raven-at-vindolanda", { x: 8, y: 4 }, "fortress_wall"],
  ] as const)("builds %s on its own battlefield, the same every time", (missionId, position, terrain) => {
    const first = scenarioFactoryForMission(missionId)();
    expect(mapTileAt(first.battlefield, position)?.terrain).toBe(terrain);
    expect(JSON.stringify(scenarioFactoryForMission(missionId)())).toBe(JSON.stringify(first));
  });

  it("gives the sandbox the prototype battlefield, with its ambush trigger", () => {
    const sandbox = scenarioFactoryForMission("test-field-trials")();
    expect(JSON.stringify(sandbox)).toBe(JSON.stringify(createPrototypeGridScenario()));
    expect(sandbox.battlefield.triggers.some((trigger) => trigger.id === "eastern-road-ambush")).toBe(true);
  });
});
