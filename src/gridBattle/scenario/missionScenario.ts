import {
  BATTLEFIELD_MAP_SCHEMA_VERSION,
  createBattlefieldMap,
  type BattlefieldMap,
  type BuildingDefinition,
  type TerrainTile,
} from "../model/battlefieldMap";
import { createBattleState } from "../model/battleStateFactory";
import { GRID_COLUMNS, GRID_ROWS } from "../model/config";
import type { GameState, GridPosition } from "../model/types";
import { applyCampaignRomanDeployment } from "./campaignRomanDeployment";
import { addPrototypeForces } from "./prototypeScenario";

/** A full-size battlefield whose ground comes from a function of each square. */
export function createMissionMap(tileAt: (x: number, y: number) => TerrainTile, buildings: readonly BuildingDefinition[]): BattlefieldMap {
  return createBattlefieldMap({
    schemaVersion: BATTLEFIELD_MAP_SCHEMA_VERSION,
    width: GRID_COLUMNS,
    height: GRID_ROWS,
    tiles: Array.from({ length: GRID_COLUMNS * GRID_ROWS }, (_, index) => tileAt(index % GRID_COLUMNS, Math.floor(index / GRID_COLUMNS))),
    buildings: [...buildings],
  });
}

interface MissionSetup {
  missionId: string;
  map: BattlefieldMap;
  /** Where each formation of the standard force starts. */
  placements: Readonly<Record<string, readonly GridPosition[]>>;
  renamedFormations?: Readonly<Record<string, string>>;
  selectedRomanFormationIds: readonly string[];
}

/** Sets the standard force on a mission's map, then swaps in the Romans chosen at the war council, if any. */
export function createMissionScenario(setup: MissionSetup): GameState {
  const state = createBattleState(setup.map);
  addPrototypeForces(state);
  for (const [formationId, positions] of Object.entries(setup.placements)) {
    const formation = state.formations[formationId];
    if (!formation || formation.blockIds.length !== positions.length) {
      throw new Error(`The ${setup.missionId} placement does not match formation ${formationId}.`);
    }
    formation.blockIds.forEach((blockId, index) => {
      state.blocks[blockId]!.position = { ...positions[index]! };
    });
  }
  for (const [formationId, name] of Object.entries(setup.renamedFormations ?? {})) state.formations[formationId]!.name = name;
  if (setup.selectedRomanFormationIds.length > 0) {
    applyCampaignRomanDeployment(state, setup.missionId, setup.selectedRomanFormationIds);
  }
  return state;
}
