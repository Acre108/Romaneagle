import { describe, expect, it } from "vitest";
import {
  createBlankBattlefieldMap,
  edgeFeatureAt,
  mapTileAt,
  parseBattlefieldMap,
  serializeBattlefieldMap,
} from "../gridBattle/model/battlefieldMap";
import { applyMapEditorTool, mapEditorObjectCount } from "../mapEditor/MapEditor";
import { ROMAN_ARCHETYPE_IDS, SUPPORT_ARCHETYPE_IDS } from "../units/UnitArchetypes";

describe("map editor tools", () => {
  it("paints terrain using the battlefield map model", () => {
    const map = createBlankBattlefieldMap(8, 6);

    applyMapEditorTool(map, { x: 3, y: 2 }, { kind: "terrain", terrain: "river_shallow" });

    expect(mapTileAt(map, { x: 3, y: 2 })?.terrain).toBe("river_shallow");
    expect(map.revision).toBe(1);
  });

  it("paints registered visual types for open, rough, and dangerous ground", () => {
    const map = createBlankBattlefieldMap(8, 6);
    applyMapEditorTool(map, { x: 1, y: 1 }, {
      kind: "ground-texture", terrain: "clear", texture: "pasture",
    });
    applyMapEditorTool(map, { x: 2, y: 1 }, {
      kind: "ground-texture", terrain: "rough", texture: "heather_moor",
    });
    applyMapEditorTool(map, { x: 3, y: 1 }, {
      kind: "ground-texture", terrain: "dangerous", texture: "mudflat",
    });

    expect(mapTileAt(map, { x: 1, y: 1 })).toMatchObject({ terrain: "clear", groundTexture: "pasture" });
    expect(mapTileAt(map, { x: 2, y: 1 })).toMatchObject({ terrain: "rough", groundTexture: "heather_moor" });
    expect(mapTileAt(map, { x: 3, y: 1 })).toMatchObject({ terrain: "dangerous", groundTexture: "mudflat" });
  });

  it("places stacked objects and clears them with the erase tool", () => {
    const map = createBlankBattlefieldMap(8, 6);
    const position = { x: 4, y: 3 };

    applyMapEditorTool(map, position, { kind: "object", object: "tree_small" });
    applyMapEditorTool(map, position, { kind: "object", object: "rock_large" });

    expect(mapTileAt(map, position)?.objects).toEqual(["tree_small", "rock_large"]);
    expect(mapEditorObjectCount(map)).toBe(2);

    applyMapEditorTool(map, position, { kind: "erase-objects" });
    expect(mapTileAt(map, position)?.objects).toBeUndefined();
    expect(mapEditorObjectCount(map)).toBe(0);
  });

  it("keeps the shared per-tile object capacity rules", () => {
    const map = createBlankBattlefieldMap(4, 4);
    const position = { x: 1, y: 1 };
    applyMapEditorTool(map, position, { kind: "object", object: "pond" });
    applyMapEditorTool(map, position, { kind: "object", object: "rock_large" });
    applyMapEditorTool(map, position, { kind: "object", object: "tree_small" });

    expect(() => applyMapEditorTool(
      map,
      position,
      { kind: "object", object: "tree_small" },
    )).toThrow("only 0 remain");
  });

  it("paints both factions as unit blocks and campaign-only spawnpoints", () => {
    const map = createBlankBattlefieldMap(6, 6);
    applyMapEditorTool(map, { x: 1, y: 1 }, {
      kind: "unit", factionId: "roman", archetypeId: ROMAN_ARCHETYPE_IDS.garrisonCentury,
    });
    applyMapEditorTool(map, { x: 2, y: 1 }, {
      kind: "unit", factionId: "roman", archetypeId: ROMAN_ARCHETYPE_IDS.garrisonCentury,
    });
    applyMapEditorTool(map, { x: 4, y: 4 }, {
      kind: "unit", factionId: "saxon", archetypeId: SUPPORT_ARCHETYPE_IDS.saxonInfantry,
    });
    applyMapEditorTool(map, { x: 0, y: 0 }, { kind: "spawn", factionId: "roman" });

    expect(map.deployments).toHaveLength(2);
    expect(map.deployments.find((deployment) => deployment.factionId === "roman")?.positions).toHaveLength(2);
    expect(map.spawnPoints).toEqual([{ factionId: "roman", position: { x: 0, y: 0 } }]);

    applyMapEditorTool(map, { x: 1, y: 1 }, { kind: "erase-unit" });
    applyMapEditorTool(map, { x: 0, y: 0 }, { kind: "erase-spawn" });
    expect(map.deployments.find((deployment) => deployment.factionId === "roman")?.positions).toHaveLength(1);
    expect(map.spawnPoints).toEqual([]);
  });

  it("paints and adjusts elevation, then authors directional ramps from lower tiles", () => {
    const map = createBlankBattlefieldMap(6, 6);
    applyMapEditorTool(map, { x: 2, y: 1 }, { kind: "elevation", elevation: 1 });
    applyMapEditorTool(map, { x: 2, y: 2 }, { kind: "ramp", direction: "north" });

    expect(mapTileAt(map, { x: 2, y: 1 })?.elevation).toBe(1);
    expect(mapTileAt(map, { x: 2, y: 2 })?.ramp).toBe("north");

    applyMapEditorTool(map, { x: 2, y: 1 }, { kind: "elevation-delta", delta: 1 });
    expect(mapTileAt(map, { x: 2, y: 1 })?.elevation).toBe(2);
    expect(mapTileAt(map, { x: 2, y: 2 })?.ramp).toBeUndefined();
    expect(() => applyMapEditorTool(
      map,
      { x: 2, y: 2 },
      { kind: "ramp", direction: "north" },
    )).toThrow("exactly one level");

    applyMapEditorTool(map, { x: 2, y: 1 }, { kind: "elevation-delta", delta: -1 });
    applyMapEditorTool(map, { x: 2, y: 2 }, { kind: "ramp", direction: "north" });
    applyMapEditorTool(map, { x: 2, y: 2 }, { kind: "erase-ramp" });
    expect(mapTileAt(map, { x: 2, y: 2 })?.ramp).toBeUndefined();
  });

  it("places rectangular solid buildings and removes them from any covered cell", () => {
    const map = createBlankBattlefieldMap(8, 8);
    applyMapEditorTool(map, { x: 2, y: 2 }, { kind: "building", width: 2, depth: 3 });

    expect(map.buildings).toEqual([{
      id: "building-2-2", origin: { x: 2, y: 2 }, width: 2, depth: 3,
    }]);
    expect(Object.values(map.buildingCells).filter((cell) => cell.buildingId === "building-2-2")).toHaveLength(6);
    const roundTrip = parseBattlefieldMap(JSON.parse(JSON.stringify(serializeBattlefieldMap(map))));
    expect(roundTrip.buildings).toEqual(map.buildings);
    expect(Object.keys(roundTrip.buildingCells)).toHaveLength(6);
    expect(() => applyMapEditorTool(
      map,
      { x: 5, y: 5 },
      { kind: "building", width: 1, depth: 2 },
    )).toThrow("at least four grid squares");

    applyMapEditorTool(map, { x: 3, y: 4 }, { kind: "erase-building" });
    expect(map.buildings).toEqual([]);
    expect(map.buildingCells).toEqual({});
  });

  it("authors one shared physical edge from either neighbouring tile", () => {
    const map = createBlankBattlefieldMap(8, 8);
    applyMapEditorTool(map, { x: 2, y: 2 }, { kind: "edge", type: "hedge_short" }, "east");
    expect(edgeFeatureAt(map, { x: 3, y: 2 }, "west")?.type).toBe("hedge_short");

    applyMapEditorTool(map, { x: 3, y: 2 }, { kind: "edge", type: "wooden_door" }, "west");
    expect(map.edgeFeatures).toHaveLength(1);
    expect(edgeFeatureAt(map, { x: 2, y: 2 }, "east")?.type).toBe("wooden_door");

    applyMapEditorTool(map, { x: 3, y: 2 }, { kind: "erase-edge" }, "west");
    expect(map.edgeFeatures).toEqual([]);
  });
});
