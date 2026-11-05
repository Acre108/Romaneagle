import {
  ROMAN_ARCHETYPE_IDS,
  ROMAN_UNIT_ARCHETYPES,
  SUPPORT_ARCHETYPE_IDS,
  type UnitArchetypeId,
} from "../units/UnitArchetypes";

export interface TestUnitOption {
  id: string;
  archetypeId: UnitArchetypeId;
  name: string;
  strength: number;
}

export interface TestOppositionOption {
  id: string;
  archetypeId: UnitArchetypeId;
  name: string;
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

export const TEST_SAXON_SPECS: readonly TestOppositionOption[] = [
  {
    id: "T-S-WOLF", name: "Wolf Hearthguard",
    archetypeId: SUPPORT_ARCHETYPE_IDS.saxonInfantry,
  },
  {
    id: "T-S-RAVEN", name: "Raven Shields",
    archetypeId: SUPPORT_ARCHETYPE_IDS.saxonInfantry,
  },
  {
    id: "T-S-BOAR", name: "Boar Spears",
    archetypeId: SUPPORT_ARCHETYPE_IDS.saxonInfantry,
  },
  {
    id: "T-S-ASH", name: "Ashwood Shields",
    archetypeId: SUPPORT_ARCHETYPE_IDS.saxonInfantry,
  },
  {
    id: "T-S-SKIRM", name: "Sea-wolf Skirmishers",
    archetypeId: SUPPORT_ARCHETYPE_IDS.saxonSkirmishers,
  },
  {
    id: "T-S-ARCH", name: "Yew Bow Levy",
    archetypeId: SUPPORT_ARCHETYPE_IDS.saxonArchers,
  },
  {
    id: "T-S-STD", name: "Raven Standard",
    archetypeId: SUPPORT_ARCHETYPE_IDS.saxonStandard,
  },
] as const;
