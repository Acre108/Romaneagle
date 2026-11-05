import type { Faction, FormationSpacing, UnitType } from "./types";
import {
  COMPOSITE_BOW,
  JAVELINS,
  LEVY_BOW,
  LIGHT_BALLISTAE,
  PLUMBATAE,
  type RangedWeaponProfile,
} from "./RangedWeapons";

export const ROMAN_ARCHETYPE_IDS = {
  garrisonCentury: "roman-garrison-century",
  fieldCentury: "roman-field-century",
  auxiliaryCohortDetachment: "roman-auxiliary-cohort-detachment",
  veteranVexillation: "roman-veteran-vexillation",
  sagittarii: "roman-sagittarii",
  equitesExploratores: "roman-equites-exploratores",
  armouredEquites: "roman-armoured-equites",
  ballistariiDetachment: "roman-ballistarii-detachment",
  plumbatarii: "roman-plumbatarii",
  lanciarii: "roman-lanciarii",
  militesChristi: "roman-milites-christi",
} as const;

export const SUPPORT_ARCHETYPE_IDS = {
  romanStandard: "roman-standard",
  saxonInfantry: "saxon-infantry",
  saxonSkirmishers: "saxon-skirmishers",
  saxonArchers: "saxon-archers",
  saxonStandard: "saxon-standard",
  pictWarband: "pict-warband",
  pictJavelinmen: "pict-javelinmen",
} as const;

export type RomanUnitArchetypeId =
  typeof ROMAN_ARCHETYPE_IDS[keyof typeof ROMAN_ARCHETYPE_IDS];
export type SupportUnitArchetypeId =
  typeof SUPPORT_ARCHETYPE_IDS[keyof typeof SUPPORT_ARCHETYPE_IDS];
export type UnitArchetypeId = RomanUnitArchetypeId | SupportUnitArchetypeId;

export type UnitClass =
  | "medium infantry"
  | "heavy infantry"
  | "archers"
  | "light cavalry"
  | "heavy cavalry"
  | "field artillery"
  | "standard bearers"
  | "warband"
  | "skirmishers";
export type ArmourClass = "light" | "medium" | "heavy";
export type SpeedClass = "very slow" | "slow" | "medium" | "fast";

/** What a unit brings to the grid battle and its cards. Grid stats are derived from these in the scenario builders. */
export interface UnitArchetypeProfile {
  id: UnitArchetypeId;
  name: string;
  faction: Faction;
  type: UnitType;
  battlefieldRole: string;
  unitClass: UnitClass;
  defaultStrength: number;
  spacing: FormationSpacing;
  armourClass: ArmourClass;
  speedClass: SpeedClass;
  startingMorale: number;
  hasShield: boolean;
  rangedWeapon?: RangedWeaponProfile;
  tacticalIdentity: string;
}

export const ROMAN_UNIT_ARCHETYPES: readonly UnitArchetypeProfile[] = [
  {
    id: ROMAN_ARCHETYPE_IDS.garrisonCentury,
    name: "Garrison Century",
    faction: "roman",
    type: "infantry",
    battlefieldRole: "Core infantry",
    unitClass: "medium infantry",
    defaultStrength: 80,
    spacing: "close",
    armourClass: "medium",
    speedClass: "slow",
    startingMorale: 84,
    hasShield: true,
    tacticalIdentity: "Holds ground cheaply; dependable in forts and streets",
  },
  {
    id: ROMAN_ARCHETYPE_IDS.fieldCentury,
    name: "Field Century",
    faction: "roman",
    type: "infantry",
    battlefieldRole: "Core infantry",
    unitClass: "heavy infantry",
    defaultStrength: 80,
    spacing: "close",
    armourClass: "heavy",
    speedClass: "medium",
    startingMorale: 88,
    hasShield: true,
    tacticalIdentity: "Disciplined manoeuvre and sustained frontline fighting",
  },
  {
    id: ROMAN_ARCHETYPE_IDS.auxiliaryCohortDetachment,
    name: "Auxiliary Cohort Detachment",
    faction: "roman",
    type: "infantry",
    battlefieldRole: "Flexible infantry",
    unitClass: "medium infantry",
    defaultStrength: 100,
    spacing: "close",
    armourClass: "medium",
    speedClass: "medium",
    startingMorale: 84,
    rangedWeapon: JAVELINS,
    hasShield: true,
    tacticalIdentity: "Flexible flank unit; adapts to rough ground",
  },
  {
    id: ROMAN_ARCHETYPE_IDS.veteranVexillation,
    name: "Veteran Vexillation",
    faction: "roman",
    type: "infantry",
    battlefieldRole: "Elite infantry",
    unitClass: "heavy infantry",
    defaultStrength: 60,
    spacing: "close",
    armourClass: "heavy",
    speedClass: "medium",
    startingMorale: 96,
    hasShield: true,
    tacticalIdentity: "Small elite reserve with exceptional morale",
  },
  {
    id: ROMAN_ARCHETYPE_IDS.sagittarii,
    name: "Sagittarii",
    faction: "roman",
    type: "archers",
    battlefieldRole: "Missile infantry",
    unitClass: "archers",
    defaultStrength: 80,
    spacing: "loose",
    armourClass: "light",
    speedClass: "medium",
    startingMorale: 82,
    rangedWeapon: COMPOSITE_BOW,
    hasShield: false,
    tacticalIdentity: "Long-range harassment; vulnerable in melee",
  },
  {
    id: ROMAN_ARCHETYPE_IDS.equitesExploratores,
    name: "Equites Exploratores",
    faction: "roman",
    type: "cavalry",
    battlefieldRole: "Recon cavalry",
    unitClass: "light cavalry",
    defaultStrength: 40,
    spacing: "open",
    armourClass: "light",
    speedClass: "fast",
    startingMorale: 82,
    rangedWeapon: JAVELINS,
    hasShield: true,
    tacticalIdentity: "Scouting, screening and pursuit",
  },
  {
    id: ROMAN_ARCHETYPE_IDS.armouredEquites,
    name: "Armoured Equites",
    faction: "roman",
    type: "cavalry",
    battlefieldRole: "Shock cavalry",
    unitClass: "heavy cavalry",
    defaultStrength: 40,
    spacing: "close",
    armourClass: "heavy",
    speedClass: "fast",
    startingMorale: 88,
    hasShield: true,
    tacticalIdentity: "Decisive charge against disrupted formations",
  },
  {
    id: ROMAN_ARCHETYPE_IDS.ballistariiDetachment,
    name: "Ballistarii Detachment",
    faction: "roman",
    type: "artillery",
    battlefieldRole: "Artillery",
    unitClass: "field artillery",
    defaultStrength: 30,
    spacing: "open",
    armourClass: "light",
    speedClass: "very slow",
    startingMorale: 80,
    rangedWeapon: LIGHT_BALLISTAE,
    hasShield: false,
    tacticalIdentity: "Breaks dense formations and forces enemy advances",
  },
  {
    id: ROMAN_ARCHETYPE_IDS.plumbatarii,
    name: "Plumbatarii",
    faction: "roman",
    type: "infantry",
    battlefieldRole: "Close-range missile infantry",
    unitClass: "medium infantry",
    defaultStrength: 80,
    spacing: "close",
    armourClass: "medium",
    speedClass: "medium",
    startingMorale: 86,
    rangedWeapon: PLUMBATAE,
    hasShield: true,
    tacticalIdentity: "Unleashes a brutal short-range dart volley before contact",
  },
  {
    id: ROMAN_ARCHETYPE_IDS.lanciarii,
    name: "Lanciarii",
    faction: "roman",
    type: "infantry",
    battlefieldRole: "Anti-cavalry and monster shock infantry",
    unitClass: "heavy infantry",
    defaultStrength: 60,
    spacing: "close",
    armourClass: "heavy",
    speedClass: "medium",
    startingMorale: 90,
    hasShield: true,
    tacticalIdentity: "Holds the line, denies charges and kills large champions",
  },
  {
    id: ROMAN_ARCHETYPE_IDS.militesChristi,
    name: "Milites Christi",
    faction: "roman",
    type: "infantry",
    battlefieldRole: "Sacred infantry",
    unitClass: "medium infantry",
    defaultStrength: 80,
    spacing: "close",
    armourClass: "medium",
    speedClass: "medium",
    startingMorale: 94,
    hasShield: true,
    tacticalIdentity: "Resists fear and hostile magic; protects artillery crews",
  },
] as const;

export const SUPPORT_UNIT_ARCHETYPES: readonly UnitArchetypeProfile[] = [
  {
    id: SUPPORT_ARCHETYPE_IDS.romanStandard,
    name: "Roman battle standard",
    faction: "roman",
    type: "standard",
    battlefieldRole: "Army support",
    unitClass: "standard bearers",
    defaultStrength: 16,
    spacing: "close",
    armourClass: "medium",
    speedClass: "slow",
    startingMorale: 88,
    hasShield: true,
    tacticalIdentity: "Rallies nearby Roman formations",
  },
  {
    id: SUPPORT_ARCHETYPE_IDS.saxonInfantry,
    name: "Saxon infantry",
    faction: "saxon",
    type: "infantry",
    battlefieldRole: "Core infantry",
    unitClass: "warband",
    defaultStrength: 70,
    spacing: "loose",
    armourClass: "medium",
    speedClass: "slow",
    startingMorale: 78,
    hasShield: true,
    tacticalIdentity: "Loose aggressive infantry warband",
  },
  {
    id: SUPPORT_ARCHETYPE_IDS.saxonSkirmishers,
    name: "Saxon skirmishers",
    faction: "saxon",
    type: "skirmishers",
    battlefieldRole: "Missile screen",
    unitClass: "skirmishers",
    defaultStrength: 60,
    spacing: "loose",
    armourClass: "light",
    speedClass: "medium",
    startingMorale: 78,
    rangedWeapon: JAVELINS,
    hasShield: true,
    tacticalIdentity: "Fast loose harassment infantry",
  },
  {
    id: SUPPORT_ARCHETYPE_IDS.saxonArchers,
    name: "Saxon archers",
    faction: "saxon",
    type: "archers",
    battlefieldRole: "Missile infantry",
    unitClass: "archers",
    defaultStrength: 47,
    spacing: "loose",
    armourClass: "light",
    speedClass: "slow",
    startingMorale: 78,
    rangedWeapon: LEVY_BOW,
    hasShield: false,
    tacticalIdentity: "Loose levy bow formation",
  },
  {
    id: SUPPORT_ARCHETYPE_IDS.saxonStandard,
    name: "Saxon battle standard",
    faction: "saxon",
    type: "standard",
    battlefieldRole: "Army support",
    unitClass: "standard bearers",
    defaultStrength: 16,
    spacing: "loose",
    armourClass: "medium",
    speedClass: "slow",
    startingMorale: 78,
    hasShield: true,
    tacticalIdentity: "Rallies nearby Saxon formations",
  },
  {
    id: SUPPORT_ARCHETYPE_IDS.pictWarband,
    name: "Pict warband",
    faction: "saxon",
    type: "infantry",
    battlefieldRole: "Core infantry",
    unitClass: "warband",
    defaultStrength: 62,
    spacing: "loose",
    armourClass: "light",
    speedClass: "slow",
    startingMorale: 78,
    hasShield: true,
    tacticalIdentity: "Loose northern infantry warband",
  },
  {
    id: SUPPORT_ARCHETYPE_IDS.pictJavelinmen,
    name: "Pict javelinmen",
    faction: "saxon",
    type: "skirmishers",
    battlefieldRole: "Missile screen",
    unitClass: "skirmishers",
    defaultStrength: 46,
    spacing: "loose",
    armourClass: "light",
    speedClass: "medium",
    startingMorale: 78,
    rangedWeapon: JAVELINS,
    hasShield: true,
    tacticalIdentity: "Mobile harassment warband",
  },
] as const;

export const UNIT_ARCHETYPES: readonly UnitArchetypeProfile[] = [
  ...ROMAN_UNIT_ARCHETYPES,
  ...SUPPORT_UNIT_ARCHETYPES,
];

export const UNIT_ARCHETYPE_BY_ID = new Map<UnitArchetypeId, UnitArchetypeProfile>(
  UNIT_ARCHETYPES.map((profile) => [profile.id, profile]),
);

export function getUnitArchetype(id: UnitArchetypeId): UnitArchetypeProfile {
  const profile = UNIT_ARCHETYPE_BY_ID.get(id);
  if (!profile) throw new Error(`Unknown unit archetype ${id}`);
  return profile;
}
