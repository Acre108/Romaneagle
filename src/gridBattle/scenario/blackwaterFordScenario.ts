import {
  addMapTerrainObject,
  type BattlefieldMap,
  type GroundTerrainType,
  type GroundTextureId,
  type TerrainTile,
} from "../model/battlefieldMap";
import { rectangularPositions } from "../model/battleStateFactory";
import type { GameState } from "../model/types";
import { createMissionMap, createMissionScenario } from "./missionScenario";

const RIVER_ROWS = new Set([6, 7]);
const MAIN_FORD_COLUMNS = new Set([8, 9, 10]);
const HORSE_CROSSING_COLUMNS = new Set([16, 17]);

function isShallowCrossing(x: number): boolean {
  return MAIN_FORD_COLUMNS.has(x) || HORSE_CROSSING_COLUMNS.has(x);
}

function isWoodland(x: number, y: number): boolean {
  const northWestWood = x <= 5 && y >= 2 && y <= 5 && x + y >= 4;
  const southEastWood = x >= 14 && y >= 9 && y <= 11 && x + y <= 29;
  return northWestWood || southEastWood;
}

function tileTerrain(x: number, y: number): GroundTerrainType {
  if (RIVER_ROWS.has(y)) return isShallowCrossing(x) ? "river_shallow" : "river_deep";
  if ((x === 9 || x === 10) || y === 12) return "road";
  if (isWoodland(x, y)) return "forest";
  if (y === 5 || y === 8) return "rough";
  return "clear";
}

function groundTexture(terrain: GroundTerrainType, x: number, y: number): GroundTextureId | undefined {
  if (terrain === "clear") return y <= 5 ? "upland_grass" : x >= 12 ? "pasture" : "grass";
  if (terrain === "rough") return (x + y) % 2 === 0 ? "shingle" : "rough_ground";
  return undefined;
}

function tileAt(x: number, y: number): TerrainTile {
  const terrain = tileTerrain(x, y);
  const texture = groundTexture(terrain, x, y);
  const ramp = y === 6 && terrain === "river_shallow" ? "north" : undefined;
  return {
    terrain,
    elevation: y <= 5 ? 1 : 0,
    ...(texture ? { groundTexture: texture } : {}),
    ...(ramp ? { ramp } : {}),
  };
}

/** Mission Two battlefield: a dangerous main ford with a narrower eastern horse crossing. */
export function createBlackwaterFordBattlefieldMap(): BattlefieldMap {
  const map = createMissionMap(tileAt, []);

  for (const [x, y, object] of [
    [1, 3, "tree_small"], [2, 4, "tree_large"], [4, 3, "tree_small"],
    [5, 5, "rock_small"], [14, 10, "tree_small"], [16, 9, "tree_large"],
    [18, 10, "tree_large"], [17, 11, "tree_small"], [15, 8, "rock_large"],
  ] as const) {
    addMapTerrainObject(map, { x, y }, object);
  }

  return map;
}

export function createBlackwaterFordScenario(selectedRomanFormationIds: readonly string[] = []): GameState {
  return createMissionScenario({
    missionId: "roman-2-blackwater-ford",
    map: createBlackwaterFordBattlefieldMap(),
    placements: {
      "legio-i": rectangularPositions(1, 9, 3, 3),
      "lanciarii": rectangularPositions(5, 9, 3, 3),
      "exploratores": rectangularPositions(1, 13, 5, 1),
      "great-warband": rectangularPositions(6, 1, 5, 3),
      "loose-warband": rectangularPositions(11, 8, 4, 3),
      "saxon-cavalry": [
        { x: 17, y: 2 }, { x: 17, y: 3 }, { x: 17, y: 4 },
      ],
    },
    selectedRomanFormationIds,
  });
}
