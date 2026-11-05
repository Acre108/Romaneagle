import { describe, expect, it } from "vitest";
import { mapTileAt } from "../gridBattle/model/battlefieldMap";
import { terrainBlocksVoluntaryMovement } from "../gridBattle/model/terrain";
import {
  createVindolandaBattlefieldMap,
  createVindolandaScenario,
} from "../gridBattle/scenario/vindolandaScenario";

describe("Vindolanda mission battlefield", () => {
  it("authors the fort perimeter, south gate, military-road junction, and broken flanks", () => {
    const map = createVindolandaBattlefieldMap();

    expect(map).toMatchObject({ width: 20, height: 14 });
    expect(map.tiles).toHaveLength(280);
    expect(map.tiles.filter((tile) => tile.terrain === "fortress_wall")).toHaveLength(20);
    expect(mapTileAt(map, { x: 9, y: 4 })?.terrain).toBe("road");
    expect(mapTileAt(map, { x: 10, y: 4 })?.terrain).toBe("road");
    expect(mapTileAt(map, { x: 8, y: 4 })?.terrain).toBe("fortress_wall");
    expect(mapTileAt(map, { x: 11, y: 4 })?.terrain).toBe("fortress_wall");
    expect(mapTileAt(map, { x: 9, y: 8 })?.terrain).toBe("road");
    expect(mapTileAt(map, { x: 3, y: 8 })?.terrain).toBe("road");
    expect(map.buildings.map((building) => building.id)).toEqual([
      "vindolanda-west-barracks",
      "vindolanda-east-barracks",
    ]);
    expect(map.tiles.filter((tile) => tile.terrain === "rough").length).toBeGreaterThan(30);
    expect(map.edgeFeatures).toHaveLength(10);
  });

  it("places the Raven host beneath the fort and both armies legally", () => {
    const state = createVindolandaScenario();
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

    expect(state.formations["great-warband"]?.blockIds.every((id) => {
      const position = state.blocks[id]!.position;
      return position.y >= 5 && position.y <= 7;
    })).toBe(true);
    expect(state.formations["saxon-cavalry"]?.blockIds.every((id) =>
      state.blocks[id]!.position.x === 17)).toBe(true);
    expect(state.formations["legio-i"]?.blockIds.every((id) =>
      state.blocks[id]!.position.y >= 9)).toBe(true);
  });

});
