import { describe, expect, it } from "vitest";
import {
  BATTLEFIELD_MAP_SCHEMA_VERSION,
  MAXIMUM_MAP_ELEVATION,
  MINIMUM_MAP_ELEVATION,
  addMapTerrainObject,
  addMapBuilding,
  clearMapTerrainObjects,
  createBattlefieldMap,
  createBlankBattlefieldMap,
  edgeFeatureAt,
  mapChangesSince,
  mapElevationRange,
  mapTileAt,
  parseBattlefieldMap,
  removeMapBuilding,
  removeMapEdgeFeature,
  removeMapTerrainObject,
  resizeBattlefieldMap,
  removeMapDeploymentBlock,
  serializeBattlefieldMap,
  setMapDeploymentBlock,
  setMapElevation,
  setMapEdgeFeature,
  setMapGroundTexture,
  setMapRamp,
  setMapSpawnPoint,
  setMapTerrain,
  validateBattlefieldMap,
  type BattlefieldMapDocument,
} from "../gridBattle/model/battlefieldMap";
import {
  AUTHORABLE_GROUND_TERRAIN_TYPES,
  AUTHORABLE_TERRAIN_OBJECT_TYPES,
  TERRAIN_AUTHORING_REGISTRY,
  groundTexturesForTerrain,
} from "../gridBattle/model/terrainDefinitions";
import {
  AUTHORABLE_EDGE_FEATURE_TYPES,
  EDGE_FEATURE_AUTHORING_REGISTRY,
} from "../gridBattle/model/edgeFeatureDefinitions";
import { ROMAN_ARCHETYPE_IDS, SUPPORT_ARCHETYPE_IDS } from "../units/UnitArchetypes";

describe("battlefield map authoring", () => {
  it("serializes only validated source data and preserves atomic edits", () => {
    const map = createBlankBattlefieldMap(5, 4);
    setMapTerrain(map, { x: 2, y: 2 }, "road");
    setMapGroundTexture(map, { x: 0, y: 0 }, "pasture");
    setMapEdgeFeature(map, { x: 1, y: 1 }, "east", "open_short");
    addMapTerrainObject(map, { x: 2, y: 2 }, "tree_small");
    setMapElevation(map, { x: 2, y: 1 }, 1);
    setMapRamp(map, { x: 2, y: 2 }, "north");

    expect(mapTileAt(map, { x: 2, y: 2 })).toEqual({
      terrain: "road", elevation: 0, ramp: "north", objects: ["tree_small"],
    });
    expect(mapChangesSince(map, 0)?.flatMap((change) => change.dirtyCells)).toContain("2,2");

    const document = serializeBattlefieldMap(map);
    expect(document).not.toHaveProperty("revision");
    expect(document).not.toHaveProperty("buildingCells");
    expect(() => createBattlefieldMap(document)).not.toThrow();
    expect(parseBattlefieldMap(JSON.parse(JSON.stringify(document)))).toMatchObject({ width: 5, height: 4 });
    expect(mapTileAt(parseBattlefieldMap(document), { x: 0, y: 0 })?.groundTexture).toBe("pasture");
    expect(edgeFeatureAt(parseBattlefieldMap(document), { x: 2, y: 1 }, "west")?.type).toBe("open_short");
  });

  it("rejects malformed tiles, out-of-range elevation, and disconnected ramps", () => {
    const malformed = {
      schemaVersion: BATTLEFIELD_MAP_SCHEMA_VERSION,
      width: 2,
      height: 2,
      tiles: [{ terrain: "clear", elevation: 0 }],
      buildings: [],
    } satisfies BattlefieldMapDocument;
    expect(() => validateBattlefieldMap(malformed)).toThrow("exactly 4 tiles");

    const tooLow = serializeBattlefieldMap(createBlankBattlefieldMap(2, 2));
    tooLow.tiles[0]!.elevation = MINIMUM_MAP_ELEVATION - 1;
    expect(() => validateBattlefieldMap(tooLow)).toThrow("between -4 and 10");

    const tooHigh = serializeBattlefieldMap(createBlankBattlefieldMap(2, 2));
    tooHigh.tiles[0]!.elevation = MAXIMUM_MAP_ELEVATION + 1;
    expect(() => validateBattlefieldMap(tooHigh)).toThrow("between -4 and 10");

    const disconnected = serializeBattlefieldMap(createBlankBattlefieldMap(2, 2));
    disconnected.tiles[0]!.ramp = "east";
    expect(() => validateBattlefieldMap(disconnected)).toThrow("climb exactly one level");

    const mismatchedTexture = serializeBattlefieldMap(createBlankBattlefieldMap(2, 2));
    mismatchedTexture.tiles[0]!.groundTexture = "swamp";
    expect(() => validateBattlefieldMap(mismatchedTexture)).toThrow("does not belong to clear");
  });

  it("accepts the complete elevation range and reports its authored bounds", () => {
    const map = createBlankBattlefieldMap(2, 2);
    setMapElevation(map, { x: 0, y: 0 }, MINIMUM_MAP_ELEVATION);
    setMapElevation(map, { x: 1, y: 0 }, MINIMUM_MAP_ELEVATION + 1);
    setMapRamp(map, { x: 0, y: 0 }, "east");
    setMapElevation(map, { x: 1, y: 1 }, MAXIMUM_MAP_ELEVATION);

    expect(mapElevationRange(map)).toEqual({
      minimum: MINIMUM_MAP_ELEVATION,
      maximum: MAXIMUM_MAP_ELEVATION,
    });
    expect(mapTileAt(map, { x: 0, y: 0 })?.ramp).toBe("east");
    expect(() => setMapElevation(map, { x: 0, y: 1 }, MINIMUM_MAP_ELEVATION - 1)).toThrow("between -4 and 10");
    expect(() => setMapElevation(map, { x: 0, y: 1 }, MAXIMUM_MAP_ELEVATION + 1)).toThrow("between -4 and 10");
  });

  it("authors fortress walls as two-level-high walkable surfaces within the elevation bounds", () => {
    const map = createBlankBattlefieldMap(4, 4);
    setMapElevation(map, { x: 1, y: 1 }, 8);
    setMapTerrain(map, { x: 1, y: 1 }, "fortress_wall");

    expect(mapElevationRange(map).maximum).toBe(MAXIMUM_MAP_ELEVATION);
    expect(() => setMapElevation(map, { x: 1, y: 1 }, 9)).toThrow("between -4 and 10");
    expect(() => addMapTerrainObject(map, { x: 1, y: 1 }, "rock_small")).toThrow("cannot contain terrain objects");
    expect(() => setMapRamp(map, { x: 1, y: 1 }, "east")).toThrow("lower approach tile");

    const tooHigh = createBlankBattlefieldMap(2, 2);
    setMapElevation(tooHigh, { x: 0, y: 0 }, 9);
    expect(() => setMapTerrain(tooHigh, { x: 0, y: 0 }, "fortress_wall")).toThrow("between -4 and 10");
    expect(mapTileAt(tooHigh, { x: 0, y: 0 })?.terrain).toBe("clear");
  });

  it("exports one ordered authoring registry for ground paint and building tools", () => {
    expect(AUTHORABLE_GROUND_TERRAIN_TYPES).not.toContain("building");
    expect(AUTHORABLE_GROUND_TERRAIN_TYPES).not.toContain("tree_small");
    expect(AUTHORABLE_GROUND_TERRAIN_TYPES).toContain("forest");
    expect(AUTHORABLE_GROUND_TERRAIN_TYPES).toContain("dangerous");
    expect(AUTHORABLE_GROUND_TERRAIN_TYPES).toContain("fortress_wall");
    expect(TERRAIN_AUTHORING_REGISTRY.fortress_wall.surfaceElevationOffset).toBe(2);
    expect(TERRAIN_AUTHORING_REGISTRY.building.authoring.tool).toBe("building");
    expect(AUTHORABLE_TERRAIN_OBJECT_TYPES).toEqual([
      "tree_small", "rock_small", "tree_large", "rock_large", "pond",
    ]);
    expect(AUTHORABLE_TERRAIN_OBJECT_TYPES.every((object) => {
      const spaces = TERRAIN_AUTHORING_REGISTRY[object].spaceOccupancy;
      return Number.isInteger(spaces) && spaces >= 1 && spaces <= 4;
    })).toBe(true);
    expect(AUTHORABLE_GROUND_TERRAIN_TYPES.every((terrain) =>
      TERRAIN_AUTHORING_REGISTRY[terrain].authoring.tool === "paint")).toBe(true);
    expect(AUTHORABLE_GROUND_TERRAIN_TYPES.map((terrain) =>
      TERRAIN_AUTHORING_REGISTRY[terrain].authoring.paletteOrder)).toEqual(
      [...AUTHORABLE_GROUND_TERRAIN_TYPES]
        .map((terrain) => TERRAIN_AUTHORING_REGISTRY[terrain].authoring.paletteOrder)
        .sort((left, right) => left - right),
    );
    expect(groundTexturesForTerrain("clear").map((texture) => texture.id)).toEqual([
      "grass", "pasture", "dry_grass", "upland_grass",
    ]);
    expect(groundTexturesForTerrain("rough").map((texture) => texture.id)).toEqual([
      "rough_ground", "heather_moor", "ploughed_field", "scree", "shingle",
    ]);
    expect(groundTexturesForTerrain("dangerous").map((texture) => texture.id)).toEqual([
      "swamp", "peat_bog", "saltmarsh", "mudflat",
    ]);
    expect(AUTHORABLE_EDGE_FEATURE_TYPES).toEqual([
      "hedge_short", "hedge_tall", "stone_wall_short", "stone_wall_tall", "wooden_door",
    ]);
    expect(AUTHORABLE_EDGE_FEATURE_TYPES.map((type) =>
      EDGE_FEATURE_AUTHORING_REGISTRY[type].appearance)).toEqual([
      "hedge", "hedge", "stone_wall", "stone_wall", "door",
    ]);
    expect(Object.keys(EDGE_FEATURE_AUTHORING_REGISTRY)).toEqual(expect.arrayContaining([
      "open_short", "open_tall", "enclosed_short", "enclosed_tall",
    ]));
  });

  it("stores one feature per physical edge and edits it from either neighbouring tile", () => {
    const map = createBlankBattlefieldMap(4, 4);
    setMapEdgeFeature(map, { x: 1, y: 1 }, "east", "hedge_short");
    expect(edgeFeatureAt(map, { x: 2, y: 1 }, "west")?.type).toBe("hedge_short");

    setMapEdgeFeature(map, { x: 2, y: 1 }, "west", "wooden_door");
    expect(map.edgeFeatures).toHaveLength(1);
    expect(edgeFeatureAt(map, { x: 1, y: 1 }, "east")?.type).toBe("wooden_door");
    expect(removeMapEdgeFeature(map, { x: 1, y: 1 }, "east")).toBe(true);
    expect(map.edgeFeatures).toEqual([]);

    const duplicate = serializeBattlefieldMap(createBlankBattlefieldMap(4, 4));
    duplicate.edgeFeatures = [
      { position: { x: 1, y: 1 }, direction: "east", type: "open_short" },
      { position: { x: 2, y: 1 }, direction: "west", type: "open_tall" },
    ];
    expect(() => validateBattlefieldMap(duplicate)).toThrow("more than one feature");
  });

  it("authors texture variants without changing their open-ground rule category", () => {
    const map = createBlankBattlefieldMap(2, 2);
    setMapGroundTexture(map, { x: 0, y: 0 }, "dry_grass");
    expect(mapTileAt(map, { x: 0, y: 0 })).toMatchObject({ terrain: "clear", groundTexture: "dry_grass" });
    expect(() => setMapGroundTexture(map, { x: 0, y: 0 }, "peat_bog")).toThrow("not a texture for clear");

    setMapTerrain(map, { x: 0, y: 0 }, "dangerous");
    expect(mapTileAt(map, { x: 0, y: 0 })?.groundTexture).toBeUndefined();
    setMapGroundTexture(map, { x: 0, y: 0 }, "peat_bog");
    expect(mapTileAt(map, { x: 0, y: 0 })).toMatchObject({ terrain: "dangerous", groundTexture: "peat_bog" });
  });

  it("stacks terrain objects up to the shared nine-space tile capacity", () => {
    const map = createBlankBattlefieldMap(3, 3);
    const position = { x: 1, y: 1 };
    addMapTerrainObject(map, position, "pond");
    addMapTerrainObject(map, position, "rock_large");
    addMapTerrainObject(map, position, "tree_small");

    expect(mapTileAt(map, position)?.objects).toEqual(["pond", "rock_large", "tree_small"]);
    const roundTrip = parseBattlefieldMap(JSON.parse(JSON.stringify(serializeBattlefieldMap(map))));
    expect(mapTileAt(roundTrip, position)?.objects).toEqual(["pond", "rock_large", "tree_small"]);
    expect(() => addMapTerrainObject(map, position, "tree_small")).toThrow("only 0 remain");
    expect(removeMapTerrainObject(map, position, 1)).toBe("rock_large");
    expect(mapTileAt(map, position)?.objects).toEqual(["pond", "tree_small"]);
    clearMapTerrainObjects(map, position);
    expect(mapTileAt(map, position)?.objects).toBeUndefined();
  });

  it("derives building coverage and rejects duplicate IDs or slope placement", () => {
    const map = createBlankBattlefieldMap(8, 8);
    addMapBuilding(map, { id: "hall", origin: { x: 1, y: 1 }, width: 2, depth: 2 });
    expect(Object.keys(map.buildingCells)).toHaveLength(4);
    expect(() => addMapBuilding(map, {
      id: "hall", origin: { x: 4, y: 4 }, width: 2, depth: 2,
    })).toThrow("already in use");

    const sloped = createBlankBattlefieldMap(8, 8);
    setMapElevation(sloped, { x: 2, y: 1 }, 1);
    setMapRamp(sloped, { x: 2, y: 2 }, "north");
    expect(() => addMapBuilding(sloped, {
      id: "slope-hall", origin: { x: 2, y: 2 }, width: 2, depth: 2,
    })).toThrow("cannot occupy a ramp tile");

    expect(removeMapBuilding(map, "hall")).toBe(true);
    expect(map.buildingCells).toEqual({});
  });

  it("resizes atomically, preserves overlapping tiles, and records a topology change", () => {
    const map = createBlankBattlefieldMap(3, 3);
    setMapTerrain(map, { x: 1, y: 1 }, "rough");
    const revision = map.revision;
    resizeBattlefieldMap(map, 5, 4);

    expect(map).toMatchObject({ width: 5, height: 4 });
    expect(mapTileAt(map, { x: 1, y: 1 })?.terrain).toBe("rough");
    expect(mapChangesSince(map, revision)?.[0]).toMatchObject({ boundsChanged: true, topologyChanged: true });
  });

  it("combines connected matching unit blocks and splits disconnected formations", () => {
    const map = createBlankBattlefieldMap(8, 6);
    setMapDeploymentBlock(map, { x: 1, y: 1 }, "roman", ROMAN_ARCHETYPE_IDS.garrisonCentury);
    setMapDeploymentBlock(map, { x: 2, y: 1 }, "roman", ROMAN_ARCHETYPE_IDS.garrisonCentury);
    setMapDeploymentBlock(map, { x: 4, y: 1 }, "roman", ROMAN_ARCHETYPE_IDS.garrisonCentury);

    expect(map.deployments).toHaveLength(2);
    expect(map.deployments.map((deployment) => deployment.positions.length).sort()).toEqual([1, 2]);

    setMapDeploymentBlock(map, { x: 3, y: 1 }, "roman", ROMAN_ARCHETYPE_IDS.garrisonCentury);
    expect(map.deployments).toHaveLength(1);
    expect(map.deployments[0]?.positions).toHaveLength(4);

    removeMapDeploymentBlock(map, { x: 2, y: 1 });
    expect(map.deployments).toHaveLength(2);
    expect(map.deployments.map((deployment) => deployment.positions.length).sort()).toEqual([1, 2]);

    setMapDeploymentBlock(map, { x: 6, y: 4 }, "saxon", SUPPORT_ARCHETYPE_IDS.saxonInfantry);
    expect(map.deployments.filter((deployment) => deployment.factionId === "saxon")).toHaveLength(1);

    const exported = serializeBattlefieldMap(map);
    const imported = parseBattlefieldMap(JSON.parse(JSON.stringify(exported)));
    expect(imported.deployments).toEqual(exported.deployments);
  });

  it("stores faction campaign spawnpoints but keeps unit and terrain occupancy valid", () => {
    const map = createBlankBattlefieldMap(5, 5);
    setMapSpawnPoint(map, { x: 0, y: 0 }, "roman");
    setMapSpawnPoint(map, { x: 4, y: 4 }, "saxon");
    expect(serializeBattlefieldMap(map).spawnPoints).toEqual([
      { factionId: "roman", position: { x: 0, y: 0 } },
      { factionId: "saxon", position: { x: 4, y: 4 } },
    ]);

    setMapDeploymentBlock(map, { x: 2, y: 2 }, "roman", ROMAN_ARCHETYPE_IDS.garrisonCentury);
    expect(() => setMapTerrain(map, { x: 2, y: 2 }, "river_deep")).toThrow("deployed unit block");
    expect(() => setMapTerrain(map, { x: 0, y: 0 }, "river_deep")).toThrow("spawnpoint");
  });
});
