import { getUnitArchetype, type UnitArchetypeProfile } from "../../units/UnitArchetypes";
import { getRangedWeaponProfile } from "../../units/RangedWeapons";
import { parseBattlefieldMap, serializeBattlefieldMap, type BattlefieldMap } from "../model/battlefieldMap";
import { BALANCE } from "../model/config";
import { modelCapacity } from "../model/unitStats";
import type {
  EquipmentAbility,
  Formation,
  FormationMode,
  GameState,
  UnitProfile,
  UnitType,
} from "../model/types";

function gridUnitType(archetype: UnitArchetypeProfile): UnitType {
  if (archetype.type === "archers" || archetype.type === "skirmishers") return "light_infantry";
  if (archetype.type === "cavalry") {
    return archetype.unitClass === "heavy cavalry" ? "heavy_cavalry" : "light_cavalry";
  }
  if (archetype.type === "infantry") {
    return archetype.unitClass === "heavy infantry" ? "heavy_infantry" : "medium_infantry";
  }
  throw new Error(`${archetype.name} is not a valid custom-map combat unit.`);
}

function formationMode(archetype: UnitArchetypeProfile): FormationMode {
  return archetype.defaultFormation.spacing === "close" ? "closed" : "open";
}

function unitProfile(archetype: UnitArchetypeProfile): UnitProfile {
  const unitType = gridUnitType(archetype);
  const equipment: EquipmentAbility[] = [];
  if (archetype.equipmentVisual.shield !== "none") equipment.push("shield_front");
  const rangedWeaponId = archetype.rangedWeapon?.id;
  return {
    unitType,
    modelSize: unitType === "light_cavalry" || unitType === "heavy_cavalry" ? 3 : 2,
    attack: unitType === "light_infantry" ? 2 : 3,
    armour: archetype.gameplay.armour.class === "heavy" ? 1 : 0,
    defence: 0,
    hitPointsPerModel: 1,
    movement: BALANCE.movement[unitType],
    equipment,
    ...(rangedWeaponId ? { rangedWeaponId } : {}),
  };
}

export function createCustomMapScenario(source: BattlefieldMap): GameState {
  const battlefield = parseBattlefieldMap(serializeBattlefieldMap(source));
  const state: GameState = {
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

  for (const deployment of battlefield.deployments) {
    const archetype = getUnitArchetype(deployment.archetypeId);
    const profile = unitProfile(archetype);
    const mode = formationMode(archetype);
    const cohesion = Math.max(1, Math.min(10, Math.round(archetype.gameplay.morale.startingMorale / 10)));
    const formation: Formation = {
      id: deployment.id,
      factionId: deployment.factionId,
      name: deployment.name,
      blockIds: [],
      facing: deployment.facing,
      formationMode: mode,
      unit: profile,
      cohesion,
      maxCohesion: 10,
      initialModelCount: 0,
      casualtyMoraleStage: 0,
      movementRemaining: BALANCE.movement[profile.unitType],
      hasActivated: false,
      leaderCharacterId: null,
      status: "formed",
      ...(profile.rangedWeaponId
        ? { ammunition: getRangedWeaponProfile(profile.rangedWeaponId).maximumAmmunition }
        : {}),
    };
    state.formations[formation.id] = formation;
    const capacity = modelCapacity(formation);
    formation.blockIds = deployment.positions.map((position, index) => {
      const id = `${formation.id}-b${index + 1}`;
      state.blocks[id] = {
        id,
        factionId: formation.factionId,
        formationId: formation.id,
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
    formation.initialModelCount = capacity * formation.blockIds.length;
  }
  return state;
}
