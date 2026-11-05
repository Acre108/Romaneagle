import {
  BATTLEFIELD_MAP_SCHEMA_VERSION,
  createBattlefieldMap,
  type BattlefieldMap,
} from "../model/battlefieldMap";
import type { GameState, GridPosition } from "../model/types";
import { rectangularPositions } from "../model/battleStateFactory";
import { addFormation, createPrototypeGridScenario } from "./prototypeScenario";

export const OPEN_FIELD_WIDTH = 32;
export const OPEN_FIELD_HEIGHT = 22;
/** The row the Roman line stands on. Eight empty rows lie between it and the Saxon front. */
export const OPEN_FIELD_ROMAN_FRONT_ROW = 13;
const SAXON_TOP_ROW = 2;

/** One colour of clear ground, so nothing on it can be mistaken for terrain and both armies stand out. */
export function createOpenFieldBattlefieldMap(): BattlefieldMap {
  return createBattlefieldMap({
    schemaVersion: BATTLEFIELD_MAP_SCHEMA_VERSION,
    width: OPEN_FIELD_WIDTH,
    height: OPEN_FIELD_HEIGHT,
    tiles: Array.from({ length: OPEN_FIELD_WIDTH * OPEN_FIELD_HEIGHT }, () => ({
      terrain: "clear" as const,
      elevation: 0,
      groundTexture: "grass" as const,
    })),
    buildings: [],
  });
}

function relocate(state: GameState, formationId: string, positions: readonly GridPosition[]): void {
  state.formations[formationId]!.blockIds.forEach((blockId, index) => {
    state.blocks[blockId]!.position = { ...positions[index]! };
  });
}

/** The sandbox battle: a repeatable Saxon line across open ground, with room to flank and to flee. */
export function createOpenFieldScenario(): GameState {
  const state = createPrototypeGridScenario();
  state.battlefield = createOpenFieldBattlefieldMap();

  relocate(state, "loose-warband", rectangularPositions(5, SAXON_TOP_ROW, 4, 3));
  state.formations["loose-warband"]!.facing = "south";
  addFormation(state, {
    id: "left-warband",
    name: "Left Warband",
    factionId: "saxon",
    facing: "south",
    unitType: "medium_infantry",
    formationMode: "closed",
    cohesion: 8,
    positions: rectangularPositions(10, SAXON_TOP_ROW, 4, 3),
  });
  relocate(state, "great-warband", rectangularPositions(15, SAXON_TOP_ROW, 5, 3));
  addFormation(state, {
    id: "right-warband",
    name: "Right Warband",
    factionId: "saxon",
    facing: "south",
    unitType: "medium_infantry",
    formationMode: "closed",
    cohesion: 8,
    positions: rectangularPositions(21, SAXON_TOP_ROW, 4, 3),
  });
  relocate(state, "saxon-cavalry", rectangularPositions(26, SAXON_TOP_ROW + 2, 3, 1));
  state.formations["saxon-cavalry"]!.facing = "south";

  return state;
}
