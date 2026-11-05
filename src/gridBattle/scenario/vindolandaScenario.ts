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

function isFortWall(x: number, y: number): boolean {
  const northWall = y === 0 && x >= 6 && x <= 13;
  const sideWall = (x === 6 || x === 13) && y >= 1 && y <= 3;
  const gatedSouthWall = y === 4 && ((x >= 6 && x <= 8) || (x >= 11 && x <= 13));
  return northWall || sideWall || gatedSouthWall;
}

function isBrokenFlank(x: number, y: number): boolean {
  if (y === 5 && x !== 9 && x !== 10) return true;
  const westApproach = x <= 4 && y >= 6 && y <= 10 && x + y >= 7;
  const eastApproach = x >= 15 && y >= 6 && y <= 10 && x + y <= 27;
  return westApproach || eastApproach;
}

function tileTerrain(x: number, y: number): GroundTerrainType {
  if (isFortWall(x, y)) return "fortress_wall";
  if (x === 9 || x === 10 || y === 8) return "road";
  if (isBrokenFlank(x, y)) return "rough";
  return "clear";
}

function groundTexture(terrain: GroundTerrainType, x: number, y: number): GroundTextureId | undefined {
  if (terrain === "clear") {
    if (y <= 4) return "upland_grass";
    if (x >= 14) return "pasture";
    return y >= 9 ? "dry_grass" : "grass";
  }
  if (terrain === "rough") return (x + y) % 3 === 0 ? "scree" : "heather_moor";
  return undefined;
}

function tileAt(x: number, y: number): TerrainTile {
  const terrain = tileTerrain(x, y);
  const texture = groundTexture(terrain, x, y);
  const ramp = (x === 6 || x === 13) && y === 5 ? "north" : undefined;
  return {
    terrain,
    elevation: ramp ? 1 : 0,
    ...(texture ? { groundTexture: texture } : {}),
    ...(ramp ? { ramp } : {}),
  };
}

/** Mission Three battlefield: Vindolanda fort, its southern gate, and the military-road junction. */
export function createVindolandaBattlefieldMap(): BattlefieldMap {
  const map = createMissionMap(tileAt, [
    { id: "vindolanda-west-barracks", origin: { x: 7, y: 1 }, width: 2, depth: 2 },
    { id: "vindolanda-east-barracks", origin: { x: 11, y: 1 }, width: 2, depth: 2 },
  ]);

  for (let y = 5; y <= 9; y += 1) {
    setMapEdgeFeature(map, { x: 4, y }, "east", "open_short");
    setMapEdgeFeature(map, { x: 14, y }, "east", "open_short");
  }

  for (const [x, y, object] of [
    [1, 4, "rock_small"], [3, 3, "rock_large"], [0, 8, "tree_small"],
    [2, 9, "rock_large"], [4, 10, "tree_small"], [15, 9, "rock_small"],
    [17, 8, "tree_large"], [19, 7, "rock_large"], [18, 10, "tree_small"],
  ] as const) {
    addMapTerrainObject(map, { x, y }, object);
  }

  return map;
}

export function createVindolandaScenario(selectedRomanFormationIds: readonly string[] = []): GameState {
  return createMissionScenario({
    missionId: "roman-3-raven-at-vindolanda",
    map: createVindolandaBattlefieldMap(),
    placements: {
      "legio-i": rectangularPositions(5, 9, 3, 3),
      "lanciarii": rectangularPositions(11, 9, 3, 3),
      "exploratores": rectangularPositions(8, 13, 5, 1),
      "great-warband": rectangularPositions(7, 5, 5, 3),
      "loose-warband": rectangularPositions(1, 5, 4, 3),
      "saxon-cavalry": [
        { x: 17, y: 5 }, { x: 17, y: 6 }, { x: 17, y: 7 },
      ],
    },
    renamedFormations: { "saxon-cavalry": "Raven Horsemen" },
    selectedRomanFormationIds,
  });
}
