import {
  addMapTerrainObject,
  setMapEdgeFeature,
  type BattlefieldMap,
  type GroundTerrainType,
  type GroundTextureId,
  type TerrainTile,
} from "../model/battlefieldMap";
import { rectangularPositions } from "../model/battleStateFactory";
import type { GameState } from "../model/types";
import { createMissionMap, createMissionScenario } from "./missionScenario";

const WALL_ROW = 11;
const GATE_COLUMNS = new Set([9, 10]);

function isWestMoor(x: number, y: number): boolean {
  return y >= 2 && y <= 8 && x <= 5 && x + y >= 5;
}

function isEastWood(x: number, y: number): boolean {
  return x >= 15 && y >= 4 && y <= 9 && x + y <= 27;
}

function tileTerrain(x: number, y: number): GroundTerrainType {
  if (y === WALL_ROW && !GATE_COLUMNS.has(x)) return "fortress_wall";
  if (x === 9 || x === 10) return "road";
  if (isEastWood(x, y)) return "forest";
  if (isWestMoor(x, y)) return "rough";
  return "clear";
}

function groundTexture(terrain: GroundTerrainType, x: number, y: number): GroundTextureId | undefined {
  if (terrain === "clear") {
    if (y <= 4) return "upland_grass";
    if (y >= WALL_ROW) return "dry_grass";
    return x >= 12 ? "pasture" : "grass";
  }
  if (terrain === "rough") return (x + y) % 3 === 0 ? "scree" : "heather_moor";
  return undefined;
}

function tileAt(x: number, y: number): TerrainTile {
  const terrain = tileTerrain(x, y);
  const texture = groundTexture(terrain, x, y);
  const ramp = (x === 3 || x === 16) && y === WALL_ROW - 1 ? "south"
    : (x === 3 || x === 16) && y === WALL_ROW + 1 ? "north"
    : undefined;
  return {
    terrain,
    elevation: ramp ? 1 : 0,
    ...(texture ? { groundTexture: texture } : {}),
    ...(ramp ? { ramp } : {}),
  };
}

/** Mission One battlefield: open northern approaches backed by the Wall and its milecastle gate. */
export function createHadriansWallBattlefieldMap(): BattlefieldMap {
  const map = createMissionMap(tileAt, [
    { id: "milecastle-west-tower", origin: { x: 7, y: 12 }, width: 2, depth: 2 },
    { id: "milecastle-east-tower", origin: { x: 11, y: 12 }, width: 2, depth: 2 },
  ]);

  for (let y = 3; y <= 9; y += 1) {
    setMapEdgeFeature(map, { x: 8, y }, "east", "open_short");
    setMapEdgeFeature(map, { x: 10, y }, "east", "open_short");
  }

  for (const [x, y, object] of [
    [15, 5, "tree_small"], [16, 5, "tree_large"], [18, 5, "tree_small"],
    [15, 7, "tree_large"], [17, 7, "tree_small"], [18, 8, "tree_large"],
    [19, 6, "rock_small"], [4, 5, "rock_small"], [1, 7, "rock_large"],
  ] as const) {
    addMapTerrainObject(map, { x, y }, object);
  }

  return map;
}

export function createHadriansWallScenario(selectedRomanFormationIds: readonly string[] = []): GameState {
  return createMissionScenario({
    missionId: "roman-1-hadrians-wall",
    map: createHadriansWallBattlefieldMap(),
    placements: {
      "legio-i": rectangularPositions(5, 7, 3, 3),
      "lanciarii": rectangularPositions(12, 7, 3, 3),
      "exploratores": rectangularPositions(2, WALL_ROW, 5, 1),
      "great-warband": rectangularPositions(5, 1, 5, 3),
      "loose-warband": rectangularPositions(12, 1, 4, 3),
      "saxon-cavalry": [
        { x: 2, y: 4 }, { x: 2, y: 5 }, { x: 2, y: 6 },
      ],
    },
    renamedFormations: { "saxon-cavalry": "Pict Horsemen" },
    selectedRomanFormationIds,
  });
}
