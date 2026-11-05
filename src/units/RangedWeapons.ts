import type { FormationShape } from "./types";

export type RangedWeaponId =
  | "composite-bow"
  | "levy-bow"
  | "javelins"
  | "plumbatae"
  | "light-ballistae";

export type RangedProjectileKind = "arrows" | "javelins" | "darts" | "bolts";

/**
 * One ammunition point represents a coordinated unit volley, not an individual
 * projectile. Ranged combat stays deterministic and unit-level.
 */
export interface RangedWeaponProfile {
  id: RangedWeaponId;
  label: string;
  ammunitionLabel: string;
  maximumAmmunition: number;
  minimumRange: number;
  maximumRange: number;
  preferredRange: number;
  volleyInterval: number;
  casualtyPower: number;
  maximumCasualties: number;
  moraleShockMultiplier: number;
  armourPenetration: number;
  shieldPenetration: number;
  maximumFiringSpeed: number;
  fallbackToMelee: boolean;
  requiredFormation?: FormationShape;
  chargeDisruptionSeconds?: number;
  projectile: RangedProjectileKind;
  resupplyInterval?: number;
}

export const COMPOSITE_BOW: RangedWeaponProfile = {
  id: "composite-bow",
  label: "Composite bows",
  ammunitionLabel: "volleys",
  maximumAmmunition: 12,
  minimumRange: 0,
  maximumRange: 480,
  preferredRange: 370,
  volleyInterval: 2.8,
  casualtyPower: 3.2,
  maximumCasualties: 5,
  moraleShockMultiplier: 0.65,
  armourPenetration: 0.05,
  shieldPenetration: 0,
  maximumFiringSpeed: 8,
  fallbackToMelee: true,
  projectile: "arrows",
  resupplyInterval: 6,
};

export const LEVY_BOW: RangedWeaponProfile = {
  id: "levy-bow",
  label: "Levy bows",
  ammunitionLabel: "volleys",
  maximumAmmunition: 12,
  minimumRange: 0,
  maximumRange: 430,
  preferredRange: 330,
  volleyInterval: 3.2,
  casualtyPower: 2.7,
  maximumCasualties: 5,
  moraleShockMultiplier: 0.6,
  armourPenetration: 0,
  shieldPenetration: 0,
  maximumFiringSpeed: 6,
  fallbackToMelee: true,
  projectile: "arrows",
  resupplyInterval: 7,
};

export const JAVELINS: RangedWeaponProfile = {
  id: "javelins",
  label: "Javelins",
  ammunitionLabel: "volleys",
  maximumAmmunition: 4,
  minimumRange: 0,
  maximumRange: 175,
  preferredRange: 135,
  volleyInterval: 3.8,
  casualtyPower: 2.6,
  maximumCasualties: 4,
  moraleShockMultiplier: 0.85,
  armourPenetration: 0.16,
  shieldPenetration: 0.12,
  maximumFiringSpeed: 20,
  fallbackToMelee: true,
  projectile: "javelins",
  resupplyInterval: 8,
};

export const PLUMBATAE: RangedWeaponProfile = {
  id: "plumbatae",
  label: "Plumbatae",
  ammunitionLabel: "volleys",
  maximumAmmunition: 2,
  minimumRange: 0,
  maximumRange: 125,
  preferredRange: 105,
  volleyInterval: 3.2,
  casualtyPower: 4.3,
  maximumCasualties: 6,
  moraleShockMultiplier: 1.2,
  armourPenetration: 0.22,
  shieldPenetration: 0.18,
  maximumFiringSpeed: 5,
  fallbackToMelee: true,
  chargeDisruptionSeconds: 3,
  projectile: "darts",
};

export const LIGHT_BALLISTAE: RangedWeaponProfile = {
  id: "light-ballistae",
  label: "Light ballistae",
  ammunitionLabel: "salvos",
  maximumAmmunition: 8,
  minimumRange: 90,
  maximumRange: 650,
  preferredRange: 540,
  volleyInterval: 5.2,
  casualtyPower: 5.5,
  maximumCasualties: 7,
  moraleShockMultiplier: 1.25,
  armourPenetration: 0.7,
  shieldPenetration: 0.65,
  maximumFiringSpeed: 1,
  fallbackToMelee: false,
  requiredFormation: "battery",
  projectile: "bolts",
  resupplyInterval: 10,
};

export const RANGED_WEAPONS: readonly RangedWeaponProfile[] = [
  COMPOSITE_BOW,
  LEVY_BOW,
  JAVELINS,
  PLUMBATAE,
  LIGHT_BALLISTAE,
];

export function getRangedWeaponProfile(id: RangedWeaponId): RangedWeaponProfile {
  const profile = RANGED_WEAPONS.find((candidate) => candidate.id === id);
  if (!profile) throw new Error(`Unknown ranged weapon profile: ${id}`);
  return profile;
}

export function rangedProtectionMultiplier(
  protectedMultiplier: number,
  penetration: number,
): number {
  return protectedMultiplier + (1 - protectedMultiplier) * penetration;
}
