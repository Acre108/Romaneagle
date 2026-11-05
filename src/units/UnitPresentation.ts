import { BALANCE } from "../gridBattle/model/config";
import { gridUnitType } from "../gridBattle/scenario/archetypeUnits";
import type { UnitArchetypeProfile } from "./UnitArchetypes";

function titleCase(value: string): string {
  return value.replace(/(^|[ -])\w/g, (letter) => letter.toUpperCase());
}

export function formatProfileClassification(profile: UnitArchetypeProfile): string {
  return `${profile.battlefieldRole} · ${titleCase(profile.unitClass)}`;
}

export function formatProfileHandling(profile: UnitArchetypeProfile): string {
  return `${titleCase(profile.armourClass)} armour · Movement ${BALANCE.movement[gridUnitType(profile)]}`;
}

/** Only weapons that fire in battle belong on a card. Other catalogue equipment has no grid-battle effect yet. */
export function formatProfileRanged(profile: UnitArchetypeProfile): string | null {
  const weapon = profile.rangedWeapon;
  return weapon ? `${weapon.label} · ${weapon.maximumAmmunition} ${weapon.ammunitionLabel}` : null;
}
