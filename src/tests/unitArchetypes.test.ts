import { describe, expect, it } from "vitest";
import {
  ROMAN_ARCHETYPE_IDS,
  ROMAN_UNIT_ARCHETYPES,
  UNIT_ARCHETYPES,
  getUnitArchetype,
} from "../units/UnitArchetypes";
import {
  formatProfileEquipment,
  formatProfileHandling,
  formatProfileSpeciality,
} from "../units/UnitPresentation";

describe("unit archetype catalog", () => {
  it("[key] defines the complete Roman faction roster with unique IDs", () => {
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

  it("[key] provides complete gameplay handling for every archetype", () => {
    for (const profile of UNIT_ARCHETYPES) {
      expect(profile.tags.length).toBeGreaterThan(0);
      expect(profile.gameplay.melee.attack).toBeGreaterThan(0);
      expect(profile.gameplay.melee.defence).toBeGreaterThan(0);
      expect(profile.gameplay.armour.meleeCasualtyMultiplier).toBeGreaterThan(0);
      expect(profile.gameplay.movement.speed).toBeGreaterThan(0);
      expect(profile.gameplay.movement.acceleration).toBeGreaterThan(0);
      expect(profile.gameplay.morale.startingMorale).toBeGreaterThan(0);
      expect(profile.gameplay.morale.routThreshold).toBeGreaterThan(0);
      expect(profile.gameplay.terrain.movement.open).toBe(1);
      expect(profile.gameplay.terrain.movement.rough).toBeGreaterThan(0);
      expect(profile.equipmentVisual.primary).toBeTruthy();
      expect(profile.equipmentVisual.shield).toBeTruthy();
      expect(profile.typicalEquipment.length).toBeGreaterThan(0);
    }
  });

  it("[key] encodes Roman tactical identities as profile differences", () => {
    const field = getUnitArchetype(ROMAN_ARCHETYPE_IDS.fieldCentury).gameplay;
    const auxiliary = getUnitArchetype(
      ROMAN_ARCHETYPE_IDS.auxiliaryCohortDetachment,
    ).gameplay;
    const veteran = getUnitArchetype(
      ROMAN_ARCHETYPE_IDS.veteranVexillation,
    ).gameplay;
    const sagittarii = getUnitArchetype(ROMAN_ARCHETYPE_IDS.sagittarii).gameplay;
    const exploratores = getUnitArchetype(
      ROMAN_ARCHETYPE_IDS.equitesExploratores,
    ).gameplay;
    const equites = getUnitArchetype(ROMAN_ARCHETYPE_IDS.armouredEquites).gameplay;
    const lanciarii = getUnitArchetype(ROMAN_ARCHETYPE_IDS.lanciarii).gameplay;
    const milites = getUnitArchetype(ROMAN_ARCHETYPE_IDS.militesChristi);

    expect(field.armour.meleeCasualtyMultiplier)
      .toBeLessThan(sagittarii.armour.meleeCasualtyMultiplier);
    expect(auxiliary.terrain.movement.rough)
      .toBeGreaterThan(field.terrain.movement.rough);
    expect(veteran.morale.combatLossMultiplier)
      .toBeLessThan(field.morale.combatLossMultiplier);
    expect(equites.melee.chargeImpact)
      .toBeGreaterThan(exploratores.melee.chargeImpact);
    expect(lanciarii.damageBonuses).toContainEqual({
      targetTag: "cavalry",
      channel: "melee",
      multiplier: 1.65,
    });
    expect(lanciarii.melee.chargeResistance).toBeLessThan(1);
    expect(milites.tags).toContain("sacred");
    expect(milites.guardAura?.targetTag).toBe("artillery");
  });

  it("[key] derives card and HUD copy from the archetype profile", () => {
    const lanciarii = getUnitArchetype(ROMAN_ARCHETYPE_IDS.lanciarii);
    const ballistarii = getUnitArchetype(ROMAN_ARCHETYPE_IDS.ballistariiDetachment);

    expect(formatProfileHandling(lanciarii)).toBe("Heavy armour · Medium speed");
    expect(formatProfileEquipment(lanciarii)).toBe(
      "Long Spears · Spathae · Large Shields",
    );
    expect(formatProfileSpeciality(lanciarii)).toBe("+65% melee vs cavalry");
    expect(formatProfileSpeciality(ballistarii)).toBe("Deploy in Battery to fire");
  });

  it("[key] defines valid weapon profiles for current and planned ranged units", () => {
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
    expect(rangedRomans[3]?.requiredFormation).toBe("battery");
    expect(rangedRomans[4]?.chargeDisruptionSeconds).toBe(3);
    for (const weapon of UNIT_ARCHETYPES.flatMap((profile) =>
      profile.rangedWeapon ? [profile.rangedWeapon] : [])) {
      expect(weapon.maximumAmmunition).toBeGreaterThan(0);
      expect(weapon.minimumRange).toBeGreaterThanOrEqual(0);
      expect(weapon.preferredRange).toBeGreaterThanOrEqual(weapon.minimumRange);
      expect(weapon.maximumRange).toBeGreaterThanOrEqual(weapon.preferredRange);
      expect(weapon.volleyInterval).toBeGreaterThan(0);
      expect(weapon.armourPenetration).toBeGreaterThanOrEqual(0);
      expect(weapon.armourPenetration).toBeLessThanOrEqual(1);
      expect(weapon.shieldPenetration).toBeGreaterThanOrEqual(0);
      expect(weapon.shieldPenetration).toBeLessThanOrEqual(1);
    }
  });

  it("[key] exposes only the contextual formation modes supported by an archetype", () => {
    const auxiliary = getUnitArchetype(
      ROMAN_ARCHETYPE_IDS.auxiliaryCohortDetachment,
    );
    const armouredEquites = getUnitArchetype(ROMAN_ARCHETYPE_IDS.armouredEquites);
    const fieldCentury = getUnitArchetype(ROMAN_ARCHETYPE_IDS.fieldCentury);

    expect(auxiliary.formationModes?.map((mode) => mode.id)).toEqual([
      "close-order",
      "loose-order",
    ]);
    expect(auxiliary.formationModes?.map((mode) => mode.formation.spacing)).toEqual([
      "close",
      "loose",
    ]);
    expect(armouredEquites.formationModes?.map((mode) => mode.id)).toEqual([
      "line",
      "wedge",
    ]);
    expect(fieldCentury.formationModes).toBeUndefined();
  });

});
