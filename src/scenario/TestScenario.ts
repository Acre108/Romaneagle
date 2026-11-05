import {
  ROMAN_ARCHETYPE_IDS,
  ROMAN_UNIT_ARCHETYPES,
  type UnitArchetypeId,
} from "../units/UnitArchetypes";

export const TEST_SCENARIO_MISSION_ID = "test-field-trials";

export interface TestUnitOption {
  id: string;
  archetypeId: UnitArchetypeId;
  name: string;
  strength: number;
}

export interface TestOppositionOption {
  id: string;
  name: string;
  role: string;
}

export const TEST_UNIT_OPTIONS: readonly TestUnitOption[] =
  ROMAN_UNIT_ARCHETYPES.map((profile, index) => ({
    id: `T-R-${index + 1}`,
    archetypeId: profile.id,
    name: profile.name,
    strength: profile.defaultStrength,
  }));

const DEFAULT_TEST_ARCHETYPE_IDS: ReadonlySet<UnitArchetypeId> = new Set([
    ROMAN_ARCHETYPE_IDS.auxiliaryCohortDetachment,
    ROMAN_ARCHETYPE_IDS.armouredEquites,
    ROMAN_ARCHETYPE_IDS.ballistariiDetachment,
    ROMAN_ARCHETYPE_IDS.plumbatarii,
    ROMAN_ARCHETYPE_IDS.lanciarii,
    ROMAN_ARCHETYPE_IDS.militesChristi,
]);

export const DEFAULT_TEST_UNIT_IDS: readonly string[] = TEST_UNIT_OPTIONS
  .filter((option) => DEFAULT_TEST_ARCHETYPE_IDS.has(option.archetypeId))
  .map((option) => option.id);

/** Mirrors the Saxon formations in the prototype scenario, which the sandbox battle uses. */
export const TEST_SAXON_SPECS: readonly TestOppositionOption[] = [
  { id: "great-warband", name: "Great Warband", role: "heavy infantry" },
  { id: "loose-warband", name: "Loose Warband", role: "light infantry" },
  { id: "saxon-cavalry", name: "Saxon Cavalry", role: "light cavalry" },
];
