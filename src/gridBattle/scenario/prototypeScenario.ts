import { BALANCE, GRID_COLUMNS, GRID_ROWS } from "../model/config";
import {
  BATTLEFIELD_MAP_SCHEMA_VERSION,
  addMapTrigger,
  addMapTerrainObject,
  createBattlefieldMap,
  setMapEdgeFeature,
  setMapGroundTexture,
  type BattlefieldMap,
  type GroundTerrainType,
  type GroundTextureId,
} from "../model/battlefieldMap";
import { placeBuilding } from "../model/terrain";
import type {
  Character,
  Direction,
  EquipmentAbility,
  FactionId,
  Formation,
  FormationMode,
  GameState,
  GridPosition,
  UnitProfile,
  UnitType,
} from "../model/types";
import { isCavalry, modelCapacity } from "../model/unitStats";
import { getRangedWeaponProfile, type RangedWeaponId } from "../../units/RangedWeapons";

interface FormationSpec {
  id: string;
  name: string;
  factionId: FactionId;
  facing: Direction;
  unitType: UnitType;
  formationMode: FormationMode;
  cohesion: number;
  positions: GridPosition[];
  colourName: string;
  equipment?: EquipmentAbility[];
  rangedWeaponId?: RangedWeaponId;
}

function terrainMap(): GroundTerrainType[][] {
  const terrain = Array.from({ length: GRID_ROWS }, () =>
    Array.from({ length: GRID_COLUMNS }, () => "clear" as GroundTerrainType),
  );
  for (const [x, y] of [[3, 12], [4, 12], [5, 12], [6, 12], [7, 12], [8, 12]]) {
    terrain[y]![x] = "rough";
  }
  for (const [x, y] of [[14, 5], [15, 5], [14, 6], [15, 6]]) terrain[y]![x] = "dangerous";
  for (const [x, y] of [[0, 4], [0, 5], [1, 4], [18, 11], [19, 11], [19, 10]]) {
    terrain[y]![x] = "impassable";
  }
  for (const [x, y] of [[8, 6], [9, 6], [10, 6]]) terrain[y]![x] = "forest";
  for (const x of [0, 1, 5, 6, 7, 8]) terrain[8]![x] = "river_deep";
  for (const x of [2, 3, 4]) terrain[8]![x] = "river_shallow";
  for (const [x, y] of [[5, 13], [5, 12], [5, 11], [6, 11], [7, 11]]) terrain[y]![x] = "road";
  for (const x of [13, 14, 15, 16, 17]) terrain[11]![x] = "fortress_wall";
  return terrain;
}

function elevationMap(): number[][] {
  const elevation = Array.from({ length: GRID_ROWS }, () =>
    Array.from({ length: GRID_COLUMNS }, () => 0),
  );
  for (let y = 1; y <= 4; y += 1) {
    for (let x = 7; x <= 11; x += 1) elevation[y]![x] = 1;
  }
  for (let y = 2; y <= 3; y += 1) {
    for (let x = 8; x <= 10; x += 1) elevation[y]![x] = 2;
  }
  elevation[11]![12] = 1;
  return elevation;
}

function prototypeBattlefieldMap(): BattlefieldMap {
  const terrain = terrainMap();
  const elevation = elevationMap();
  const ramps: Record<string, Direction> = {
    "6,2": "east", "6,3": "east", "6,4": "east", "7,0": "south", "7,2": "east",
    "7,3": "east", "7,5": "north", "8,0": "south", "8,1": "south", "8,4": "north",
    "8,5": "north", "9,0": "south", "9,1": "south", "9,4": "north", "9,5": "north",
    "10,0": "south", "10,1": "south", "10,4": "north", "10,5": "north", "11,0": "south",
    "11,2": "west", "11,3": "west", "11,5": "north", "12,1": "west", "12,2": "west",
    "12,3": "west",
    "12,12": "north",
  };
  const map = createBattlefieldMap({
    schemaVersion: BATTLEFIELD_MAP_SCHEMA_VERSION,
    width: GRID_COLUMNS,
    height: GRID_ROWS,
    tiles: terrain.flatMap((row, y) => row.map((type, x) => ({
      terrain: type,
      elevation: elevation[y]![x]!,
      ...((ramps[`${x},${y}`]) ? { ramp: ramps[`${x},${y}`] } : {}),
    }))),
    buildings: [],
  });
  for (let y = 0; y < GRID_ROWS; y += 1) {
    for (let x = 0; x < GRID_COLUMNS; x += 1) {
      if (terrain[y]![x] !== "clear") continue;
      const texture: GroundTextureId = y <= 4
        ? "upland_grass"
        : y >= 10 ? "dry_grass" : x >= 13 ? "pasture" : "grass";
      setMapGroundTexture(map, { x, y }, texture);
    }
  }
  const roughTextures: readonly GroundTextureId[] = [
    "heather_moor", "ploughed_field", "scree", "shingle", "rough_ground",
  ];
  [3, 4, 6, 7, 8].forEach((x, index) => {
    setMapGroundTexture(map, { x, y: 12 }, roughTextures[index]!);
  });
  const dangerousTextures: readonly GroundTextureId[] = ["swamp", "peat_bog", "saltmarsh", "mudflat"];
  [[14, 5], [15, 5], [14, 6], [15, 6]].forEach(([x, y], index) => {
    setMapGroundTexture(map, { x: x!, y: y! }, dangerousTextures[index]!);
  });
  setMapEdgeFeature(map, { x: 13, y: 4 }, "south", "open_short");
  setMapEdgeFeature(map, { x: 14, y: 4 }, "south", "open_tall");
  setMapEdgeFeature(map, { x: 15, y: 4 }, "south", "enclosed_short");
  setMapEdgeFeature(map, { x: 16, y: 4 }, "south", "enclosed_tall");
  for (const [x, y] of [[8, 6], [10, 6], [8, 7], [10, 7]] as const) {
    addMapTerrainObject(map, { x, y }, "tree_small");
  }
  addMapTerrainObject(map, { x: 9, y: 7 }, "tree_large");
  addMapTerrainObject(map, { x: 9, y: 6 }, "pond");
  addMapTerrainObject(map, { x: 9, y: 6 }, "rock_large");
  addMapTerrainObject(map, { x: 9, y: 6 }, "tree_small");
  addMapTerrainObject(map, { x: 11, y: 7 }, "rock_small");
  addMapTrigger(map, {
    id: "eastern-road-ambush",
    label: "Eastern road ambush",
    once: true,
    condition: { type: "formation_enters", positions: [{ x: 5, y: 9 }], factionId: "roman" },
    effects: [
      {
        type: "character_interaction",
        speaker: "Marcellus",
        text: "Movement by the wall — form up!",
      },
      {
        type: "spawn_formation",
        formation: {
          id: "ambush-raiders",
          name: "Ambush Raiders",
          factionId: "saxon",
          facing: "west",
          formationMode: "open",
          cohesion: 7,
          maxCohesion: 10,
          unit: {
            unitType: "light_infantry",
            modelSize: 2,
            attack: 2,
            armour: 0,
            defence: 0,
            hitPointsPerModel: 1,
            movement: BALANCE.movement.light_infantry,
            equipment: [],
          },
          positions: [{ x: 15, y: 10 }, { x: 16, y: 10 }],
        },
      },
      { type: "activate_to_attack", formationId: "ambush-raiders", targetFactionId: "roman" },
    ],
  });
  return map;
}

function rectangularPositions(x: number, y: number, width: number, depth: number): GridPosition[] {
  const positions: GridPosition[] = [];
  for (let row = 0; row < depth; row += 1) {
    for (let column = 0; column < width; column += 1) positions.push({ x: x + column, y: y + row });
  }
  return positions;
}

function unitProfile(spec: FormationSpec): UnitProfile {
  const cavalry = isCavalry(spec.unitType);
  const heavyInfantry = spec.unitType === "heavy_infantry";
  return {
    unitType: spec.unitType,
    modelSize: cavalry ? 3 : 2,
    attack: cavalry ? 3 : spec.unitType === "light_infantry" ? 2 : 3,
    armour: spec.factionId === "roman" && heavyInfantry ? 1 : 0,
    defence: 0,
    hitPointsPerModel: 1,
    movement: BALANCE.movement[spec.unitType],
    equipment: spec.equipment ?? (heavyInfantry ? ["shield_front"] : []),
    rangedWeaponId: spec.rangedWeaponId,
  };
}

function addFormation(
  state: GameState,
  spec: FormationSpec,
): void {
  const formation: Formation = {
    id: spec.id,
    factionId: spec.factionId,
    name: spec.name,
    blockIds: [],
    facing: spec.facing,
    formationMode: spec.formationMode,
    unit: unitProfile(spec),
    cohesion: spec.cohesion,
    maxCohesion: 10,
    initialModelCount: 0,
    casualtyMoraleStage: 0,
    movementRemaining: BALANCE.movement[spec.unitType],
    hasActivated: false,
    leaderCharacterId: null,
    status: "formed",
    ammunition: spec.rangedWeaponId
      ? getRangedWeaponProfile(spec.rangedWeaponId).maximumAmmunition
      : undefined,
  };
  state.formations[spec.id] = formation;
  const capacity = modelCapacity(formation);
  const blockIds = spec.positions.map((position, index) => {
    const id = `${spec.id}-b${index + 1}`;
    state.blocks[id] = {
      id,
      factionId: spec.factionId,
      formationId: spec.id,
      position: { ...position },
      models: capacity,
      modelCapacity: capacity,
      wounds: 0,
      disorder: 0,
      characterId: null,
      hasRetreatedThisRound: false,
      isContested: false,
      chargeDistance: 0,
      chargeMomentum: 0,
    };
    return id;
  });
  formation.blockIds = blockIds;
  formation.initialModelCount = blockIds.length * capacity;
  void spec.colourName;
}

function attachCharacter(state: GameState, character: Character): void {
  state.characters[character.id] = character;
  const host = state.blocks[character.hostBlockId];
  if (!host) throw new Error(`Missing host block ${character.hostBlockId}`);
  host.characterId = character.id;
  if (character.role === "commander" && host.formationId) {
    state.formations[host.formationId]!.leaderCharacterId = character.id;
  }
}

export function createPrototypeGridScenario(): GameState {
  const state: GameState = {
    battlefield: prototypeBattlefieldMap(),
    round: 1,
    activeFactionId: "roman",
    blocks: {},
    formations: {},
    characters: {},
    selectedFormationId: null,
    selectedBlockId: null,
    phase: "selecting",
    currentAction: null,
    eventLog: [],
    nextEventId: 1,
    nextFragmentId: 1,
    triggerState: { fireCounts: {}, interactions: [] },
  };

  placeBuilding(state, {
    id: "roadside-hall",
    origin: { x: 8, y: 10 },
    width: 2,
    depth: 2,
  });

  addFormation(state, {
    id: "legio-i",
    name: "Legio I Augusta",
    factionId: "roman",
    facing: "north",
    unitType: "heavy_infantry",
    formationMode: "closed",
    cohesion: 10,
    positions: rectangularPositions(2, 9, 3, 3),
    colourName: "red",
  });
  addFormation(state, {
    id: "lanciarii",
    name: "Lanciarii",
    factionId: "roman",
    facing: "east",
    unitType: "heavy_infantry",
    formationMode: "closed",
    cohesion: 9,
    positions: rectangularPositions(11, 7, 3, 3),
    colourName: "dark red",
    equipment: ["shield_front", "brace_against_charge"],
  });
  addFormation(state, {
    id: "exploratores",
    name: "Sagittarii",
    factionId: "roman",
    facing: "north",
    unitType: "light_infantry",
    formationMode: "open",
    cohesion: 7,
    positions: rectangularPositions(2, 13, 5, 1),
    colourName: "light red",
    rangedWeaponId: "composite-bow",
  });
  addFormation(state, {
    id: "great-warband",
    name: "Great Warband",
    factionId: "saxon",
    facing: "south",
    unitType: "heavy_infantry",
    formationMode: "closed",
    cohesion: 8,
    positions: rectangularPositions(2, 5, 5, 3),
    colourName: "brown",
  });
  addFormation(state, {
    id: "loose-warband",
    name: "Loose Warband",
    factionId: "saxon",
    facing: "west",
    unitType: "light_infantry",
    formationMode: "open",
    cohesion: 6,
    positions: rectangularPositions(13, 1, 4, 3),
    colourName: "dark brown",
  });
  addFormation(state, {
    id: "saxon-cavalry",
    name: "Saxon Cavalry",
    factionId: "saxon",
    facing: "west",
    unitType: "light_cavalry",
    formationMode: "open",
    cohesion: 7,
    positions: [{ x: 17, y: 7 }, { x: 17, y: 8 }, { x: 17, y: 9 }],
    colourName: "umber",
  });

  attachCharacter(state, {
    id: "marcellus",
    factionId: "roman",
    name: "Marcellus",
    role: "centurion",
    hostBlockId: "legio-i-b3",
    pressureBonus: 2,
    resistanceBonus: 1,
    meleeBonus: 1,
    commandRadius: 1,
    prowess: 4,
    wounds: 0,
    maxWounds: 3,
    status: "active",
    tiedDuelRounds: 0,
    temporaryMeleeBonus: 0,
  });
  attachCharacter(state, {
    id: "aelia",
    factionId: "roman",
    name: "Aelia",
    role: "commander",
    hostBlockId: "lanciarii-b5",
    pressureBonus: 0,
    resistanceBonus: 1,
    meleeBonus: 0,
    commandRadius: 2,
    prowess: 3,
    wounds: 0,
    maxWounds: 3,
    status: "active",
    tiedDuelRounds: 0,
    temporaryMeleeBonus: 0,
  });
  attachCharacter(state, {
    id: "wulfgar",
    factionId: "saxon",
    name: "Wulfgar",
    role: "champion",
    hostBlockId: "great-warband-b13",
    pressureBonus: 2,
    resistanceBonus: 0,
    meleeBonus: 2,
    commandRadius: 0,
    prowess: 5,
    wounds: 0,
    maxWounds: 3,
    status: "active",
    tiedDuelRounds: 0,
    temporaryMeleeBonus: 0,
  });

  return state;
}
