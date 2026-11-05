import { getRangedWeaponProfile } from "../../units/RangedWeapons";
import type { BattlefieldMap } from "./battlefieldMap";
import type { Direction, FactionId, Formation, FormationMode, GameState, GridPosition, TroopBlock, UnitProfile } from "./types";
import { modelCapacity } from "./unitStats";

export function createBattleState(battlefield: BattlefieldMap): GameState {
  return {
    battlefield,
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
}

/**
 * A copy to try orders on without touching the real battle. The map is shared, not copied:
 * nothing in a battle edits the map (a test plays a whole battle to check), and it is the largest part of the state.
 */
export function cloneForSimulation(state: GameState): GameState {
  const { battlefield, ...rest } = state;
  return { ...structuredClone(rest), battlefield };
}

export function rectangularPositions(x: number, y: number, width: number, depth: number): GridPosition[] {
  return Array.from({ length: width * depth }, (_, index) => ({
    x: x + index % width,
    y: y + Math.floor(index / width),
  }));
}

interface NewFormation {
  id: string;
  factionId: FactionId;
  name: string;
  facing: Direction;
  formationMode: FormationMode;
  unit: UnitProfile;
  cohesion: number;
  maxCohesion?: number;
}

/** A fresh formation with no blocks yet, ready to activate, carrying its full ammunition if it has a ranged weapon. */
export function createFormation(spec: NewFormation): Formation {
  return {
    id: spec.id,
    factionId: spec.factionId,
    name: spec.name,
    blockIds: [],
    facing: spec.facing,
    formationMode: spec.formationMode,
    unit: spec.unit,
    cohesion: spec.cohesion,
    maxCohesion: spec.maxCohesion ?? 10,
    initialModelCount: 0,
    casualtyMoraleStage: 0,
    movementRemaining: spec.unit.movement,
    hasActivated: false,
    leaderCharacterId: null,
    status: "formed",
    ...(spec.unit.rangedWeaponId ? { ammunition: getRangedWeaponProfile(spec.unit.rangedWeaponId).maximumAmmunition } : {}),
  };
}

export function createTroopBlock(id: string, formation: Formation, position: GridPosition, models: number, capacity: number): TroopBlock {
  return {
    id,
    factionId: formation.factionId,
    formationId: formation.id,
    position: { ...position },
    models,
    modelCapacity: capacity,
    wounds: 0,
    wavering: false,
    characterId: null,
    hasRetreatedThisRound: false,
    isContested: false,
    chargeDistance: 0,
    chargeMomentum: 0,
  };
}

/**
 * Adds a formation to the battle on these squares. Blocks fill up in order,
 * so a strength that does not divide evenly leaves the last block short.
 */
export function deployFormation(
  state: GameState,
  formation: Formation,
  positions: readonly GridPosition[],
  strength?: number,
): void {
  const capacity = modelCapacity(formation);
  const total = strength ?? capacity * positions.length;
  formation.blockIds = positions.map((position, index) => {
    const id = `${formation.id}-b${index + 1}`;
    state.blocks[id] = createTroopBlock(id, formation, position, Math.min(capacity, total - index * capacity), capacity);
    return id;
  });
  formation.initialModelCount = total;
  state.formations[formation.id] = formation;
}
