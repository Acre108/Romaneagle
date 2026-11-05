import { describe, expect, it } from "vitest";
import {
  ROMAN_ARCHETYPE_IDS,
  ROMAN_UNIT_ARCHETYPES,
  UNIT_ARCHETYPES,
  getUnitArchetype,
} from "../units/UnitArchetypes";
import {
  formatProfileHandling,
  formatProfileRanged,
} from "../units/UnitPresentation";

describe("unit archetype catalog", () => {
  it("defines the complete Roman faction roster with unique IDs", () => {
    expect(ROMAN_UNIT_ARCHETYPES).toHaveLength(11);
    expect(new Set(ROMAN_UNIT_ARCHETYPES.map((profile) => profile.id)).size).toBe(11);
    expect(ROMAN_UNIT_ARCHETYPES.map((profile) => profile.name)).toEqual([
      "Garrison Century",
      "Field Century",
      "Auxiliary Cohort Detachment",
      "Veteran Vexillation",
      "Sagittarii",
      "Equites Exploratores",
      "Armoured Equites",
      "Ballistarii Detachment",
      "Plumbatarii",
      "Lanciarii",
      "Milites Christi",
    ]);
    expect(ROMAN_UNIT_ARCHETYPES.map((profile) => profile.defaultStrength)).toEqual([
      80,
      80,
      100,
      60,
      80,
      40,
      40,
      30,
      80,
      60,
      80,
    ]);
  });

  it("has unique IDs across Roman and support profiles", () => {
    expect(new Set(UNIT_ARCHETYPES.map((profile) => profile.id)).size)
      .toBe(UNIT_ARCHETYPES.length);
  });

  it("gives every archetype what the grid battle and its cards read", () => {
    for (const profile of UNIT_ARCHETYPES) {
      expect(profile.startingMorale).toBeGreaterThan(0);
      expect(profile.defaultStrength).toBeGreaterThan(0);
      expect(profile.battlefieldRole).toBeTruthy();
      expect(profile.tacticalIdentity).toBeTruthy();
    }
  });

  it("keeps shields and armour classes where the battle reads them", () => {
    const field = getUnitArchetype(ROMAN_ARCHETYPE_IDS.fieldCentury);
    const sagittarii = getUnitArchetype(ROMAN_ARCHETYPE_IDS.sagittarii);

    expect(field.armourClass).toBe("heavy");
    expect(field.hasShield).toBe(true);
    expect(sagittarii.armourClass).not.toBe("heavy");
  });

  it("derives card and HUD copy from the archetype profile", () => {
    const lanciarii = getUnitArchetype(ROMAN_ARCHETYPE_IDS.lanciarii);
    const ballistarii = getUnitArchetype(ROMAN_ARCHETYPE_IDS.ballistariiDetachment);

    expect(formatProfileHandling(lanciarii)).toBe("Heavy armour · Movement 2");
    expect(formatProfileHandling(ballistarii)).toBe("Light armour · Movement 3");
    expect(formatProfileRanged(lanciarii)).toBeNull();
    expect(formatProfileRanged(getUnitArchetype(ROMAN_ARCHETYPE_IDS.sagittarii))).toBe("Composite bows · 12 volleys");
    expect(formatProfileRanged(ballistarii)).toContain("salvos");
  });

  it("defines valid weapon profiles for current and planned ranged units", () => {
    const rangedRomans = [
      ROMAN_ARCHETYPE_IDS.auxiliaryCohortDetachment,
      ROMAN_ARCHETYPE_IDS.sagittarii,
      ROMAN_ARCHETYPE_IDS.equitesExploratores,
      ROMAN_ARCHETYPE_IDS.ballistariiDetachment,
      ROMAN_ARCHETYPE_IDS.plumbatarii,
    ].map((id) => getUnitArchetype(id).rangedWeapon);

    expect(rangedRomans.map((weapon) => weapon?.id)).toEqual([
      "javelins",
      "composite-bow",
      "javelins",
      "light-ballistae",
      "plumbatae",
    ]);
    for (const weapon of UNIT_ARCHETYPES.flatMap((profile) =>
      profile.rangedWeapon ? [profile.rangedWeapon] : [])) {
      expect(weapon.maximumAmmunition).toBeGreaterThan(0);
      expect(weapon.minimumRange).toBeGreaterThanOrEqual(0);
      expect(weapon.maximumRange).toBeGreaterThanOrEqual(weapon.minimumRange);
      expect(weapon.armourPenetration).toBeGreaterThanOrEqual(0);
      expect(weapon.armourPenetration).toBeLessThanOrEqual(1);
      expect(weapon.shieldPenetration).toBeGreaterThanOrEqual(0);
      expect(weapon.shieldPenetration).toBeLessThanOrEqual(1);
    }
  });
});
