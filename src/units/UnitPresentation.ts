import type { UnitArchetypeProfile } from "./UnitArchetypes";

function titleCase(value: string): string {
  return value.replace(/(^|[ -])\w/g, (letter) => letter.toUpperCase());
}

export function formatProfileClassification(profile: UnitArchetypeProfile): string {
  return `${profile.battlefieldRole} · ${titleCase(profile.unitClass)}`;
}

export function formatProfileHandling(profile: UnitArchetypeProfile): string {
  return `${titleCase(profile.gameplay.armour.class)} armour · ` +
    `${titleCase(profile.gameplay.movement.class)} speed`;
}

export function formatProfileEquipment(profile: UnitArchetypeProfile): string {
  return profile.typicalEquipment.map(titleCase).join(" · ");
}

export function formatProfileSpeciality(profile: UnitArchetypeProfile): string {
  const guard = profile.guardAura;
  if (guard) return `Guards ${guard.targetTag} within ${guard.radius}`;
  const damageBonus = profile.gameplay.damageBonuses[0];
  if (damageBonus) {
    return `+${Math.round((damageBonus.multiplier - 1) * 100)}% ` +
      `${damageBonus.channel} vs ${damageBonus.targetTag}`;
  }
  if (profile.rangedWeapon?.chargeDisruptionSeconds) return "Breaks committed charges";
  if (profile.rangedWeapon?.requiredFormation) {
    return `Deploy in ${titleCase(profile.rangedWeapon.requiredFormation)} to fire`;
  }
  if (profile.formationModes?.some((mode) => mode.id === "wedge")) {
    return "Line endurance · Wedge impact";
  }
  return profile.tacticalIdentity;
}
