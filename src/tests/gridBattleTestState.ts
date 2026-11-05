import type { Character, Direction, Formation, GameState, GridPosition, TroopBlock } from "../gridBattle/model/types";
import { createBlankBattlefieldMap } from "../gridBattle/model/battlefieldMap";

export function blankState(width = 8, height = 8): GameState {
  return {
    battlefield: createBlankBattlefieldMap(width, height),
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

export function addFormation(
  state: GameState,
  id: string,
  positions: GridPosition[],
  facing: Direction,
  factionId: "roman" | "saxon" = "roman",
): Formation {
  const formation: Formation = {
    id,
    factionId,
    name: id,
    blockIds: [],
    facing,
    formationMode: "closed",
    unit: {
      unitType: "light_infantry",
      modelSize: 2,
      attack: 3,
      armour: factionId === "roman" ? 1 : 0,
      defence: 0,
      hitPointsPerModel: 1,
      movement: 4,
      equipment: ["shield_front"],
    },
    cohesion: 8,
    maxCohesion: 10,
    initialModelCount: positions.length * 9,
    casualtyMoraleStage: 0,
    movementRemaining: 4,
    hasActivated: false,
    leaderCharacterId: null,
    status: "formed",
  };
  state.formations[id] = formation;
  positions.forEach((position, index) => {
    const blockId = `${id}-b${index + 1}`;
    const block: TroopBlock = {
      id: blockId,
      factionId,
      formationId: id,
      position: { ...position },
      models: 9,
      modelCapacity: 9,
      wounds: 0,
      disorder: 0,
      characterId: null,
      hasRetreatedThisRound: false,
      isContested: false,
      chargeDistance: 0,
      chargeMomentum: 0,
    };
    state.blocks[blockId] = block;
    formation.blockIds.push(blockId);
  });
  return formation;
}

export function attachCharacter(
  state: GameState,
  id: string,
  hostBlockId: string,
  factionId: "roman" | "saxon",
  role: "commander" | "centurion" | "champion",
  overrides: Partial<Character> = {},
): Character {
  const character: Character = {
    id,
    factionId,
    name: id,
    role,
    hostBlockId,
    pressureBonus: role === "centurion" || role === "champion" ? 2 : 0,
    resistanceBonus: role === "commander" ? 1 : 0,
    meleeBonus: role === "champion" ? 2 : 0,
    commandRadius: role === "commander" ? 2 : 0,
    prowess: 3,
    wounds: 0,
    maxWounds: 3,
    status: "active",
    tiedDuelRounds: 0,
    temporaryMeleeBonus: 0,
    ...overrides,
  };
  state.characters[id] = character;
  state.blocks[hostBlockId]!.characterId = id;
  return character;
}
