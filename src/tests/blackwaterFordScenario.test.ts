import { describe, expect, it } from "vitest";
import { mapTileAt } from "../gridBattle/model/battlefieldMap";
import { terrainBlocksVoluntaryMovement } from "../gridBattle/model/terrain";
import { scenarioFactoryForMission } from "../gridBattle/scenario/campaignScenario";
import {
  createBlackwaterFordBattlefieldMap,
  createBlackwaterFordScenario,
} from "../gridBattle/scenario/blackwaterFordScenario";
import { createPrototypeGridScenario } from "../gridBattle/scenario/prototypeScenario";

describe("Blackwater Ford mission battlefield", () => {
  it("authors a broad river, three-file ford, horse crossing, banks, and woodland", () => {
    const map = createBlackwaterFordBattlefieldMap();

    expect(map).toMatchObject({ width: 20, height: 14 });
    expect(map.tiles).toHaveLength(280);
    expect(map.tiles.filter((tile) => tile.terrain === "river_deep")).toHaveLength(30);
    expect(map.tiles.filter((tile) => tile.terrain === "river_shallow")).toHaveLength(10);
    for (const y of [6, 7]) {
      for (const x of [8, 9, 10]) expect(mapTileAt(map, { x, y })?.terrain).toBe("river_shallow");
      for (const x of [16, 17]) expect(mapTileAt(map, { x, y })?.terrain).toBe("river_shallow");
      expect(mapTileAt(map, { x: 7, y })?.terrain).toBe("river_deep");
      expect(mapTileAt(map, { x: 11, y })?.terrain).toBe("river_deep");
    }
    expect(mapTileAt(map, { x: 9, y: 6 })?.ramp).toBe("north");
    expect(mapTileAt(map, { x: 9, y: 5 })?.elevation).toBe(1);
    expect(map.tiles.filter((tile) => tile.terrain === "forest").length).toBeGreaterThan(15);
  });

  it("starts with a Saxon bridgehead on the Roman bank and legal army placements", () => {
    const state = createBlackwaterFordScenario();
    const occupied = new Set<string>();

    for (const block of Object.values(state.blocks)) {
      const tile = mapTileAt(state.battlefield, block.position);
      expect(tile, block.id).toBeDefined();
      expect(terrainBlocksVoluntaryMovement(tile!.terrain), block.id).toBe(false);
      const key = `${block.position.x},${block.position.y}`;
      expect(occupied.has(key), block.id).toBe(false);
      occupied.add(key);
    }

    expect(state.formations["loose-warband"]?.blockIds.every((id) =>
      state.blocks[id]!.position.y > 7)).toBe(true);
    expect(state.formations["great-warband"]?.blockIds.every((id) =>
      state.blocks[id]!.position.y < 6)).toBe(true);
    expect(state.formations["saxon-cavalry"]?.blockIds.every((id) =>
      state.blocks[id]!.position.x === 17)).toBe(true);
  });

  it("routes Mission Two to the ford while preserving the prototype as the test mission", () => {
    const first = scenarioFactoryForMission("roman-2-blackwater-ford")();
    const reset = scenarioFactoryForMission("roman-2-blackwater-ford")();
    const testMission = scenarioFactoryForMission("test-field-trials")();

    expect(JSON.stringify(first)).toBe(JSON.stringify(reset));
    expect(mapTileAt(first.battlefield, { x: 0, y: 6 })?.terrain).toBe("river_deep");
    expect(JSON.stringify(testMission)).toBe(JSON.stringify(createPrototypeGridScenario()));
    expect(testMission.battlefield.triggers.some((trigger) => trigger.id === "eastern-road-ambush")).toBe(true);
  });
});
