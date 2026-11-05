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
  casualtyPower: number;
  maximumCasualties: number;
  armourPenetration: number;
  shieldPenetration: number;
  projectile: RangedProjectileKind;
}

export const COMPOSITE_BOW: RangedWeaponProfile = {
  id: "composite-bow",
  label: "Composite bows",
  ammunitionLabel: "volleys",
  maximumAmmunition: 12,
  minimumRange: 0,
  maximumRange: 480,
  casualtyPower: 3.2,
  maximumCasualties: 5,
  armourPenetration: 0.05,
  shieldPenetration: 0,
  projectile: "arrows",
};

export const LEVY_BOW: RangedWeaponProfile = {
  id: "levy-bow",
  label: "Levy bows",
  ammunitionLabel: "volleys",
  maximumAmmunition: 12,
  minimumRange: 0,
  maximumRange: 430,
  casualtyPower: 2.7,
  maximumCasualties: 5,
  armourPenetration: 0,
  shieldPenetration: 0,
  projectile: "arrows",
};

export const JAVELINS: RangedWeaponProfile = {
  id: "javelins",
  label: "Javelins",
  ammunitionLabel: "volleys",
  maximumAmmunition: 4,
  minimumRange: 0,
  maximumRange: 175,
  casualtyPower: 2.6,
  maximumCasualties: 4,
  armourPenetration: 0.16,
  shieldPenetration: 0.12,
  projectile: "javelins",
};

export const PLUMBATAE: RangedWeaponProfile = {
  id: "plumbatae",
  label: "Plumbatae",
  ammunitionLabel: "volleys",
  maximumAmmunition: 2,
  minimumRange: 0,
  maximumRange: 125,
  casualtyPower: 4.3,
  maximumCasualties: 6,
  armourPenetration: 0.22,
  shieldPenetration: 0.18,
  projectile: "darts",
};

export const LIGHT_BALLISTAE: RangedWeaponProfile = {
  id: "light-ballistae",
  label: "Light ballistae",
  ammunitionLabel: "salvos",
  maximumAmmunition: 8,
  minimumRange: 90,
  maximumRange: 650,
  casualtyPower: 5.5,
  maximumCasualties: 7,
  armourPenetration: 0.7,
  shieldPenetration: 0.65,
  projectile: "bolts",
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
