import { describe, expect, it } from "vitest";
import { mapTileAt } from "../gridBattle/model/battlefieldMap";
import { terrainBlocksVoluntaryMovement } from "../gridBattle/model/terrain";
import { scenarioFactoryForMission } from "../gridBattle/scenario/campaignScenario";
import {
  createHadriansWallBattlefieldMap,
  createHadriansWallScenario,
} from "../gridBattle/scenario/hadriansWallScenario";

describe("Hadrian's Wall mission battlefield", () => {
  it("authors a wall, central milecastle gate, towers, moor, and eastern wood", () => {
    const map = createHadriansWallBattlefieldMap();

    expect(map).toMatchObject({ width: 20, height: 14 });
    expect(map.tiles).toHaveLength(280);
    expect(map.tiles.filter((tile) => tile.terrain === "fortress_wall")).toHaveLength(18);
    expect(mapTileAt(map, { x: 9, y: 11 })?.terrain).toBe("road");
    expect(mapTileAt(map, { x: 10, y: 11 })?.terrain).toBe("road");
    expect(map.buildings.map((building) => building.id)).toEqual([
      "milecastle-west-tower",
      "milecastle-east-tower",
    ]);
    expect(map.tiles.filter((tile) => tile.terrain === "rough").length).toBeGreaterThan(20);
    expect(map.tiles.filter((tile) => tile.terrain === "forest").length).toBeGreaterThan(10);
    expect(map.edgeFeatures).toHaveLength(14);
  });

  it("places both armies legally on their mission-specific approaches", () => {
    const state = createHadriansWallScenario();
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

    expect(state.formations.exploratores?.blockIds.every((id) =>
      mapTileAt(state.battlefield, state.blocks[id]!.position)?.terrain === "fortress_wall")).toBe(true);
    expect(state.formations["great-warband"]?.blockIds.every((id) =>
      state.blocks[id]!.position.y < 4)).toBe(true);
  });

  it("routes only Mission One to the new scenario and remains deterministic", () => {
    const first = scenarioFactoryForMission("roman-1-hadrians-wall")();
    const reset = scenarioFactoryForMission("roman-1-hadrians-wall")();
    const missionTwo = scenarioFactoryForMission("roman-2-blackwater-ford")();

    expect(JSON.stringify(first)).toBe(JSON.stringify(reset));
    expect(mapTileAt(first.battlefield, { x: 9, y: 11 })?.terrain).toBe("road");
    expect(mapTileAt(missionTwo.battlefield, { x: 0, y: 11 })?.terrain).not.toBe("fortress_wall");
  });
});
