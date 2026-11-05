import type { UnitArchetypeProfile } from "../../units/UnitArchetypes";
import { BALANCE } from "../model/config";
import type { EquipmentAbility, FormationMode, UnitProfile, UnitType } from "../model/types";
import { hitPointsPerModel } from "../model/unitStats";

/** The grid-battle unit type a catalogue archetype fights as. Its movement and base stats come from this. */
export function gridUnitType(archetype: UnitArchetypeProfile): UnitType {
  if (archetype.type === "archers" || archetype.type === "skirmishers" || archetype.type === "artillery") return "light_infantry";
  if (archetype.type === "cavalry") {
    return archetype.unitClass === "heavy cavalry" ? "heavy_cavalry" : "light_cavalry";
  }
  if (archetype.type === "infantry") {
    return archetype.unitClass === "heavy infantry" ? "heavy_infantry" : "medium_infantry";
  }
  throw new Error(`${archetype.name} cannot deploy in the grid battle.`);
}

export function archetypeUnitProfile(archetype: UnitArchetypeProfile, formationMode: FormationMode): UnitProfile {
  const unitType = gridUnitType(archetype);
  const equipment: EquipmentAbility[] = archetype.hasShield ? ["shield_front"] : [];
  const rangedWeaponId = archetype.rangedWeapon?.id;
  const modelSize = unitType === "light_cavalry" || unitType === "heavy_cavalry" ? 3 : 2;
  return {
    unitType,
    modelSize,
    attack: unitType === "light_infantry" ? 2 : 3,
    armour: archetype.armourClass === "heavy" ? 1 : 0,
    defence: 0,
    hitPointsPerModel: hitPointsPerModel(formationMode, modelSize),
    movement: BALANCE.movement[unitType],
    equipment,
    ...(rangedWeaponId ? { rangedWeaponId } : {}),
  };
}

/** Catalogue morale runs to 100; formation morale runs to 10. */
export function archetypeCohesion(archetype: UnitArchetypeProfile): number {
  return Math.max(1, Math.min(10, Math.round(archetype.startingMorale / 10)));
}
