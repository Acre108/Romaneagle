import type {
  Faction,
  FormationConfiguration,
  FormationShape,
  FormationSpacing,
  UnitTerrain,
  UniqueAbilityType,
  UnitType,
} from "./types";
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
export type FormationDoctrine =
  | "close order"
  | "loose or close order"
  | "loose order"
  | "open order"
  | "wedge or line"
  | "battery"
  | "warband"
  | "standard escort";
export type FormationModeId = "close-order" | "loose-order" | "line" | "wedge";
export type UnitTag =
  | "infantry"
  | "cavalry"
  | "artillery"
  | "ranged"
  | "standard"
  | "sacred"
  | "monster";
export type DamageChannel = "melee" | "ranged" | "charge";

export type PrimaryEquipmentVisual =
  | "spear"
  | "long-spear"
  | "lance"
  | "sword"
  | "bow"
  | "javelins"
  | "plumbatae"
  | "ballista";
export type ShieldEquipmentVisual =
  | "none"
  | "small-round"
  | "round"
  | "oval"
  | "large-oval"
  | "rectangular"
  | "mixed";
export type ArmourEquipmentVisual = "unarmoured" | "light" | "mail" | "heavy-mail";
export type HeadgearEquipmentVisual = "bare" | "cap" | "helmet" | "crested-helmet";
export type SpecialistEquipmentMarker = "none" | "darts" | "relic";

/** Static drawing instructions shared by battlefield figures and UI summaries. */
export interface EquipmentVisualProfile {
  primary: PrimaryEquipmentVisual;
  shield: ShieldEquipmentVisual;
  armour: ArmourEquipmentVisual;
  headgear: HeadgearEquipmentVisual;
  marker: SpecialistEquipmentMarker;
}

export interface TaggedDamageBonus {
  targetTag: UnitTag;
  channel: DamageChannel;
  multiplier: number;
}

export interface GuardAuraProfile {
  targetTag: UnitTag;
  radius: number;
  meleeCasualtyMultiplier: number;
  rangedCasualtyMultiplier: number;
  moraleLossMultiplier: number;
}

export interface FormationModeDefinition {
  id: FormationModeId;
  label: string;
  hotkey: "C" | "O" | "L" | "W";
  formation: FormationConfiguration;
}

export type TerrainDisruptionRule = "always" | "close-order";

export interface MeleeProfile {
  attack: number;
  defence: number;
  chargeImpact: number;
  chargeResistance: number;
  pursuit: number;
}

export interface ArmourProfile {
  class: ArmourClass;
  meleeCasualtyMultiplier: number;
  rangedCasualtyMultiplier: number;
}

export interface MovementProfile {
  class: SpeedClass;
  speed: number;
  turnSpeed: number;
  acceleration: number;
  deceleration: number;
  staminaDrain: number;
}

export interface MoraleProfile {
  startingMorale: number;
  combatLossMultiplier: number;
  ambientLossMultiplier: number;
  recoveryMultiplier: number;
  routThreshold: number;
}

export interface TerrainHandlingProfile {
  movement: Readonly<Record<UnitTerrain, number>>;
  dispersedBonus: Readonly<Partial<Record<UnitTerrain, number>>>;
  staminaDrainMultiplier: number;
  disruption: Readonly<Partial<Record<UnitTerrain, TerrainDisruptionRule>>>;
  moraleLossMultiplier: number;
}

export interface UnitGameplayProfile {
  melee: MeleeProfile;
  armour: ArmourProfile;
  movement: MovementProfile;
  morale: MoraleProfile;
  terrain: TerrainHandlingProfile;
  damageBonuses: readonly TaggedDamageBonus[];
}

export interface UnitArchetypeProfile {
  id: UnitArchetypeId;
  name: string;
  faction: Faction;
  type: UnitType;
  tags: readonly UnitTag[];
  battlefieldRole: string;
  unitClass: UnitClass;
  defaultStrength: number;
  formationDoctrine: FormationDoctrine;
  defaultFormation: FormationConfiguration;
  formationModes?: readonly FormationModeDefinition[];
  gameplay: UnitGameplayProfile;
  rangedWeapon?: RangedWeaponProfile;
  guardAura?: GuardAuraProfile;
  equipmentVisual: EquipmentVisualProfile;
  typicalEquipment: readonly string[];
  tacticalIdentity: string;
  uniqueAbility?: UniqueAbilityType;
}

interface GameplayOptions {
  armour: ArmourClass;
  speedClass: SpeedClass;
  speed: number;
  turnSpeed: number;
  morale: number;
  meleeAttack?: number;
  meleeDefence?: number;
  chargeImpact?: number;
  chargeResistance?: number;
  damageBonuses?: readonly TaggedDamageBonus[];
  pursuit?: number;
  acceleration?: number;
  deceleration?: number;
  staminaDrain?: number;
  combatMoraleLoss?: number;
  ambientMoraleLoss?: number;
  moraleRecovery?: number;
  routThreshold?: number;
  terrain?: "foot" | "rough-foot" | "cavalry" | "artillery";
  terrainStaminaDrain?: number;
  terrainMoraleLoss?: number;
}

const TERRAIN_MOVEMENT: Readonly<Record<NonNullable<GameplayOptions["terrain"]>,
Readonly<Record<UnitTerrain, number>>>> = {
  foot: {
    open: 1, road: 1, rough: 0.68, woods: 0.62, swamp: 0.52,
    "shallow water": 0.48, "deep water": 0.2,
  },
  "rough-foot": {
    open: 1, road: 1, rough: 0.82, woods: 0.74, swamp: 0.58,
    "shallow water": 0.52, "deep water": 0.2,
  },
  cavalry: {
    open: 1, road: 1.04, rough: 0.64, woods: 0.48, swamp: 0.4,
    "shallow water": 0.44, "deep water": 0.18,
  },
  artillery: {
    open: 1, road: 1.08, rough: 0.44, woods: 0.36, swamp: 0.24,
    "shallow water": 0.22, "deep water": 0.08,
  },
};

const DISPERSED_TERRAIN_BONUS: TerrainHandlingProfile["dispersedBonus"] = {
  rough: 1.26,
  woods: 1.26,
  swamp: 1.19,
  "shallow water": 1.21,
};

const FOOT_DISRUPTION: TerrainHandlingProfile["disruption"] = {
  rough: "close-order",
  woods: "close-order",
  swamp: "always",
  "shallow water": "always",
  "deep water": "always",
};

const CAVALRY_DISRUPTION: TerrainHandlingProfile["disruption"] = {
  rough: "always",
  woods: "always",
  swamp: "always",
  "shallow water": "always",
  "deep water": "always",
};

const ARMOUR_MULTIPLIERS: Readonly<Record<ArmourClass, Pick<ArmourProfile,
"meleeCasualtyMultiplier" | "rangedCasualtyMultiplier">>> = {
  light: { meleeCasualtyMultiplier: 1.12, rangedCasualtyMultiplier: 1.1 },
  medium: { meleeCasualtyMultiplier: 1, rangedCasualtyMultiplier: 1 },
  heavy: { meleeCasualtyMultiplier: 0.86, rangedCasualtyMultiplier: 0.82 },
};

function gameplay(options: GameplayOptions): UnitGameplayProfile {
  const terrainKind = options.terrain ?? "foot";
  const armour = ARMOUR_MULTIPLIERS[options.armour];
  const cavalry = terrainKind === "cavalry";
  const artillery = terrainKind === "artillery";
  return {
    melee: {
      attack: options.meleeAttack ?? 1,
      defence: options.meleeDefence ?? 1,
      chargeImpact: options.chargeImpact ?? 1,
      chargeResistance: options.chargeResistance ?? 1,
      pursuit: options.pursuit ?? (cavalry ? 1.25 : 1),
    },
    armour: { class: options.armour, ...armour },
    movement: {
      class: options.speedClass,
      speed: options.speed,
      turnSpeed: options.turnSpeed,
      acceleration: options.acceleration ?? (cavalry ? 48 : artillery ? 24 : 42),
      deceleration: options.deceleration ?? (cavalry ? 72 : 65),
      staminaDrain: options.staminaDrain ?? (cavalry ? 1.7 : artillery ? 1.15 : 0.9),
    },
    morale: {
      startingMorale: options.morale,
      combatLossMultiplier: options.combatMoraleLoss ?? 1,
      ambientLossMultiplier: options.ambientMoraleLoss ?? 1,
      recoveryMultiplier: options.moraleRecovery ?? 1,
      routThreshold: options.routThreshold ?? 35,
    },
    terrain: {
      movement: TERRAIN_MOVEMENT[terrainKind],
      dispersedBonus: DISPERSED_TERRAIN_BONUS,
      staminaDrainMultiplier: options.terrainStaminaDrain ?? (artillery ? 1.35 : cavalry ? 1.15 : 1),
      disruption: cavalry || artillery ? CAVALRY_DISRUPTION : FOOT_DISRUPTION,
      moraleLossMultiplier: options.terrainMoraleLoss ?? 1,
    },
    damageBonuses: options.damageBonuses ?? [],
  };
}

function formation(
  shape: FormationShape,
  spacing: FormationSpacing,
  files: number,
): FormationConfiguration {
  return { shape, spacing, files };
}

const AUXILIARY_FORMATION_MODES: readonly FormationModeDefinition[] = [
  {
    id: "close-order",
    label: "Close order",
    hotkey: "C",
    formation: formation("line", "close", 20),
  },
  {
    id: "loose-order",
    label: "Loose order",
    hotkey: "O",
    formation: formation("line", "loose", 14),
  },
];

const ARMOURED_EQUITES_FORMATION_MODES: readonly FormationModeDefinition[] = [
  {
    id: "line",
    label: "Line",
    hotkey: "L",
    formation: formation("line", "close", 12),
  },
  {
    id: "wedge",
    label: "Wedge",
    hotkey: "W",
    formation: formation("wedge", "close", 9),
  },
];

export const ROMAN_UNIT_ARCHETYPES: readonly UnitArchetypeProfile[] = [
  {
    id: ROMAN_ARCHETYPE_IDS.garrisonCentury,
    name: "Garrison Century",
    faction: "roman",
    type: "infantry",
    tags: ["infantry"],
    battlefieldRole: "Core infantry",
    unitClass: "medium infantry",
    defaultStrength: 80,
    formationDoctrine: "close order",
    defaultFormation: formation("line", "close", 20),
    gameplay: gameplay({
      armour: "medium", speedClass: "slow", speed: 44, turnSpeed: 1.08,
      morale: 84, meleeAttack: 0.9, meleeDefence: 1.05,
      chargeResistance: 0.95, ambientMoraleLoss: 0.9,
    }),
    equipmentVisual: {
      primary: "spear", shield: "oval", armour: "mail",
      headgear: "helmet", marker: "darts",
    },
    typicalEquipment: ["spear", "spatha", "plumbata", "oval shield"],
    tacticalIdentity: "Holds ground cheaply; dependable in forts and streets",
  },
  {
    id: ROMAN_ARCHETYPE_IDS.fieldCentury,
    name: "Field Century",
    faction: "roman",
    type: "infantry",
    tags: ["infantry"],
    battlefieldRole: "Core infantry",
    unitClass: "heavy infantry",
    defaultStrength: 80,
    formationDoctrine: "close order",
    defaultFormation: formation("line", "close", 24),
    gameplay: gameplay({
      armour: "heavy", speedClass: "medium", speed: 48, turnSpeed: 1.08,
      morale: 88, meleeAttack: 1.05, meleeDefence: 1.12,
      combatMoraleLoss: 0.9,
    }),
    equipmentVisual: {
      primary: "spear", shield: "oval", armour: "heavy-mail",
      headgear: "helmet", marker: "darts",
    },
    typicalEquipment: ["spear", "spatha", "plumbata", "oval shield"],
    tacticalIdentity: "Disciplined manoeuvre and sustained frontline fighting",
    uniqueAbility: "tortoise",
  },
  {
    id: ROMAN_ARCHETYPE_IDS.auxiliaryCohortDetachment,
    name: "Auxiliary Cohort Detachment",
    faction: "roman",
    type: "infantry",
    tags: ["infantry", "ranged"],
    battlefieldRole: "Flexible infantry",
    unitClass: "medium infantry",
    defaultStrength: 100,
    formationDoctrine: "loose or close order",
    defaultFormation: formation("line", "close", 20),
    formationModes: AUXILIARY_FORMATION_MODES,
    gameplay: gameplay({
      armour: "medium", speedClass: "medium", speed: 50, turnSpeed: 1.12,
      morale: 84, meleeAttack: 0.95, meleeDefence: 0.95,
      terrain: "rough-foot", terrainStaminaDrain: 0.9,
    }),
    rangedWeapon: JAVELINS,
    equipmentVisual: {
      primary: "javelins", shield: "round", armour: "mail",
      headgear: "helmet", marker: "none",
    },
    typicalEquipment: ["spear", "javelins", "spatha", "shield"],
    tacticalIdentity: "Flexible flank unit; adapts to rough ground",
  },
  {
    id: ROMAN_ARCHETYPE_IDS.veteranVexillation,
    name: "Veteran Vexillation",
    faction: "roman",
    type: "infantry",
    tags: ["infantry"],
    battlefieldRole: "Elite infantry",
    unitClass: "heavy infantry",
    defaultStrength: 60,
    formationDoctrine: "close order",
    defaultFormation: formation("line", "close", 20),
    gameplay: gameplay({
      armour: "heavy", speedClass: "medium", speed: 48, turnSpeed: 1.15,
      morale: 96, meleeAttack: 1.25, meleeDefence: 1.22,
      combatMoraleLoss: 0.75, ambientMoraleLoss: 0.75,
      moraleRecovery: 1.15, routThreshold: 30,
    }),
    equipmentVisual: {
      primary: "spear", shield: "large-oval", armour: "heavy-mail",
      headgear: "crested-helmet", marker: "darts",
    },
    typicalEquipment: ["spear", "spatha", "plumbata", "shield"],
    tacticalIdentity: "Small elite reserve with exceptional morale",
  },
  {
    id: ROMAN_ARCHETYPE_IDS.sagittarii,
    name: "Sagittarii",
    faction: "roman",
    type: "archers",
    tags: ["infantry", "ranged"],
    battlefieldRole: "Missile infantry",
    unitClass: "archers",
    defaultStrength: 80,
    formationDoctrine: "loose order",
    defaultFormation: formation("line", "loose", 14),
    gameplay: gameplay({
      armour: "light", speedClass: "medium", speed: 50, turnSpeed: 1.08,
      morale: 82, meleeAttack: 0.35, meleeDefence: 0.65,
      combatMoraleLoss: 1.15, terrain: "rough-foot",
    }),
    rangedWeapon: COMPOSITE_BOW,
    equipmentVisual: {
      primary: "bow", shield: "none", armour: "light",
      headgear: "cap", marker: "none",
    },
    typicalEquipment: ["composite bow", "knife"],
    tacticalIdentity: "Long-range harassment; vulnerable in melee",
  },
  {
    id: ROMAN_ARCHETYPE_IDS.equitesExploratores,
    name: "Equites Exploratores",
    faction: "roman",
    type: "cavalry",
    tags: ["cavalry", "ranged"],
    battlefieldRole: "Recon cavalry",
    unitClass: "light cavalry",
    defaultStrength: 40,
    formationDoctrine: "open order",
    defaultFormation: formation("line", "open", 10),
    gameplay: gameplay({
      armour: "light", speedClass: "fast", speed: 92, turnSpeed: 1.6,
      morale: 82, meleeAttack: 0.7, meleeDefence: 0.7,
      chargeImpact: 0.8, pursuit: 1.4, combatMoraleLoss: 1.1,
      terrain: "cavalry",
    }),
    rangedWeapon: JAVELINS,
    equipmentVisual: {
      primary: "javelins", shield: "small-round", armour: "light",
      headgear: "helmet", marker: "none",
    },
    typicalEquipment: ["javelins", "spear", "spatha", "small shield"],
    tacticalIdentity: "Scouting, screening and pursuit",
  },
  {
    id: ROMAN_ARCHETYPE_IDS.armouredEquites,
    name: "Armoured Equites",
    faction: "roman",
    type: "cavalry",
    tags: ["cavalry"],
    battlefieldRole: "Shock cavalry",
    unitClass: "heavy cavalry",
    defaultStrength: 40,
    formationDoctrine: "wedge or line",
    defaultFormation: formation("line", "close", 12),
    formationModes: ARMOURED_EQUITES_FORMATION_MODES,
    gameplay: gameplay({
      armour: "heavy", speedClass: "fast", speed: 82, turnSpeed: 1.45,
      morale: 88, meleeAttack: 1, meleeDefence: 1,
      chargeImpact: 1.35, pursuit: 1.35, terrain: "cavalry",
    }),
    equipmentVisual: {
      primary: "lance", shield: "round", armour: "heavy-mail",
      headgear: "helmet", marker: "none",
    },
    typicalEquipment: ["lance", "spatha", "shield", "mail"],
    tacticalIdentity: "Decisive charge against disrupted formations",
  },
  {
    id: ROMAN_ARCHETYPE_IDS.ballistariiDetachment,
    name: "Ballistarii Detachment",
    faction: "roman",
    type: "artillery",
    tags: ["artillery", "ranged"],
    battlefieldRole: "Artillery",
    unitClass: "field artillery",
    defaultStrength: 30,
    formationDoctrine: "battery",
    defaultFormation: formation("battery", "open", 6),
    gameplay: gameplay({
      armour: "light", speedClass: "very slow", speed: 24, turnSpeed: 0.7,
      morale: 80, meleeAttack: 0.25, meleeDefence: 0.55,
      ambientMoraleLoss: 1.15, terrain: "artillery",
    }),
    rangedWeapon: LIGHT_BALLISTAE,
    equipmentVisual: {
      primary: "ballista", shield: "none", armour: "light",
      headgear: "cap", marker: "none",
    },
    typicalEquipment: ["light ballistae", "crew sidearms"],
    tacticalIdentity: "Breaks dense formations and forces enemy advances",
  },
  {
    id: ROMAN_ARCHETYPE_IDS.plumbatarii,
    name: "Plumbatarii",
    faction: "roman",
    type: "infantry",
    tags: ["infantry", "ranged"],
    battlefieldRole: "Close-range missile infantry",
    unitClass: "medium infantry",
    defaultStrength: 80,
    formationDoctrine: "close order",
    defaultFormation: formation("line", "close", 20),
    gameplay: gameplay({
      armour: "medium", speedClass: "medium", speed: 48, turnSpeed: 1.08,
      morale: 86, meleeAttack: 0.95, meleeDefence: 1,
    }),
    rangedWeapon: PLUMBATAE,
    equipmentVisual: {
      primary: "plumbatae", shield: "oval", armour: "mail",
      headgear: "helmet", marker: "darts",
    },
    typicalEquipment: ["plumbatae", "spears", "spathae", "oval shields"],
    tacticalIdentity: "Unleashes a brutal short-range dart volley before contact",
  },
  {
    id: ROMAN_ARCHETYPE_IDS.lanciarii,
    name: "Lanciarii",
    faction: "roman",
    type: "infantry",
    tags: ["infantry"],
    battlefieldRole: "Anti-cavalry and monster shock infantry",
    unitClass: "heavy infantry",
    defaultStrength: 60,
    formationDoctrine: "close order",
    defaultFormation: formation("line", "close", 15),
    gameplay: gameplay({
      armour: "heavy", speedClass: "medium", speed: 48, turnSpeed: 1.08,
      morale: 90, meleeAttack: 1.08, meleeDefence: 1.15,
      chargeResistance: 0.55,
      damageBonuses: [{
        targetTag: "cavalry", channel: "melee", multiplier: 1.65,
      }],
    }),
    equipmentVisual: {
      primary: "long-spear", shield: "large-oval", armour: "heavy-mail",
      headgear: "helmet", marker: "none",
    },
    typicalEquipment: ["long spears", "spathae", "large shields"],
    tacticalIdentity: "Holds the line, denies charges and kills large champions",
  },
  {
    id: ROMAN_ARCHETYPE_IDS.militesChristi,
    name: "Milites Christi",
    faction: "roman",
    type: "infantry",
    tags: ["infantry", "sacred"],
    battlefieldRole: "Sacred infantry",
    unitClass: "medium infantry",
    defaultStrength: 80,
    formationDoctrine: "close order",
    defaultFormation: formation("line", "close", 20),
    gameplay: gameplay({
      armour: "medium", speedClass: "medium", speed: 48, turnSpeed: 1.08,
      morale: 94, meleeAttack: 1, meleeDefence: 1.05,
      combatMoraleLoss: 0.75, ambientMoraleLoss: 0.55,
      moraleRecovery: 1.2, routThreshold: 30,
    }),
    guardAura: {
      targetTag: "artillery",
      radius: 190,
      meleeCasualtyMultiplier: 0.62,
      rangedCasualtyMultiplier: 0.72,
      moraleLossMultiplier: 0.65,
    },
    equipmentVisual: {
      primary: "spear", shield: "oval", armour: "mail",
      headgear: "crested-helmet", marker: "relic",
    },
    typicalEquipment: ["spears", "swords", "shields", "relics"],
    tacticalIdentity: "Resists fear and hostile magic; protects artillery crews",
  },
] as const;

export const SUPPORT_UNIT_ARCHETYPES: readonly UnitArchetypeProfile[] = [
  {
    id: SUPPORT_ARCHETYPE_IDS.romanStandard,
    name: "Roman battle standard",
    faction: "roman",
    type: "standard",
    tags: ["standard"],
    battlefieldRole: "Army support",
    unitClass: "standard bearers",
    defaultStrength: 16,
    formationDoctrine: "standard escort",
    defaultFormation: formation("column", "close", 6),
    gameplay: gameplay({
      armour: "medium", speedClass: "slow", speed: 44, turnSpeed: 1.08,
      morale: 88, meleeAttack: 0.65, meleeDefence: 0.8,
      ambientMoraleLoss: 0.8, moraleRecovery: 1.15,
    }),
    equipmentVisual: {
      primary: "sword", shield: "oval", armour: "mail",
      headgear: "crested-helmet", marker: "none",
    },
    typicalEquipment: ["battle standard", "swords", "shields"],
    tacticalIdentity: "Rallies nearby Roman formations",
  },
  {
    id: SUPPORT_ARCHETYPE_IDS.saxonInfantry,
    name: "Saxon infantry",
    faction: "saxon",
    type: "infantry",
    tags: ["infantry"],
    battlefieldRole: "Core infantry",
    unitClass: "warband",
    defaultStrength: 70,
    formationDoctrine: "warband",
    defaultFormation: formation("line", "loose", 14),
    gameplay: gameplay({
      armour: "medium", speedClass: "slow", speed: 43.2, turnSpeed: 1.08,
      morale: 78, meleeAttack: 1, meleeDefence: 0.9,
      ambientMoraleLoss: 1.08,
    }),
    equipmentVisual: {
      primary: "spear", shield: "round", armour: "mail",
      headgear: "helmet", marker: "none",
    },
    typicalEquipment: ["spears", "swords", "round shields"],
    tacticalIdentity: "Loose aggressive infantry warband",
    uniqueAbility: "shieldwall",
  },
  {
    id: SUPPORT_ARCHETYPE_IDS.saxonSkirmishers,
    name: "Saxon skirmishers",
    faction: "saxon",
    type: "skirmishers",
    tags: ["infantry", "ranged"],
    battlefieldRole: "Missile screen",
    unitClass: "skirmishers",
    defaultStrength: 60,
    formationDoctrine: "loose order",
    defaultFormation: formation("line", "loose", 14),
    gameplay: gameplay({
      armour: "light", speedClass: "medium", speed: 55.8, turnSpeed: 1.08,
      morale: 78, meleeAttack: 0.65, meleeDefence: 0.7,
      combatMoraleLoss: 1.1, terrain: "rough-foot",
    }),
    rangedWeapon: JAVELINS,
    equipmentVisual: {
      primary: "javelins", shield: "small-round", armour: "light",
      headgear: "bare", marker: "none",
    },
    typicalEquipment: ["javelins", "knives", "small shields"],
    tacticalIdentity: "Fast loose harassment infantry",
  },
  {
    id: SUPPORT_ARCHETYPE_IDS.saxonArchers,
    name: "Saxon archers",
    faction: "saxon",
    type: "archers",
    tags: ["infantry", "ranged"],
    battlefieldRole: "Missile infantry",
    unitClass: "archers",
    defaultStrength: 47,
    formationDoctrine: "loose order",
    defaultFormation: formation("line", "loose", 14),
    gameplay: gameplay({
      armour: "light", speedClass: "slow", speed: 45, turnSpeed: 1.08,
      morale: 78, meleeAttack: 0.35, meleeDefence: 0.6,
      combatMoraleLoss: 1.15, terrain: "rough-foot",
    }),
    rangedWeapon: LEVY_BOW,
    equipmentVisual: {
      primary: "bow", shield: "none", armour: "light",
      headgear: "bare", marker: "none",
    },
    typicalEquipment: ["bows", "knives"],
    tacticalIdentity: "Loose levy bow formation",
  },
  {
    id: SUPPORT_ARCHETYPE_IDS.saxonStandard,
    name: "Saxon battle standard",
    faction: "saxon",
    type: "standard",
    tags: ["standard"],
    battlefieldRole: "Army support",
    unitClass: "standard bearers",
    defaultStrength: 16,
    formationDoctrine: "standard escort",
    defaultFormation: formation("column", "loose", 5),
    gameplay: gameplay({
      armour: "medium", speedClass: "slow", speed: 39.6, turnSpeed: 1.08,
      morale: 78, meleeAttack: 0.6, meleeDefence: 0.75,
      ambientMoraleLoss: 0.9, moraleRecovery: 1.1,
    }),
    equipmentVisual: {
      primary: "spear", shield: "round", armour: "mail",
      headgear: "helmet", marker: "none",
    },
    typicalEquipment: ["battle standard", "spears", "round shields"],
    tacticalIdentity: "Rallies nearby Saxon formations",
  },
  {
    id: SUPPORT_ARCHETYPE_IDS.pictWarband,
    name: "Pict warband",
    faction: "saxon",
    type: "infantry",
    tags: ["infantry"],
    battlefieldRole: "Core infantry",
    unitClass: "warband",
    defaultStrength: 62,
    formationDoctrine: "warband",
    defaultFormation: formation("line", "loose", 14),
    gameplay: gameplay({
      armour: "light", speedClass: "slow", speed: 43.2, turnSpeed: 1.08,
      morale: 78, meleeAttack: 1.05, meleeDefence: 0.82,
      combatMoraleLoss: 1.08, ambientMoraleLoss: 1.12,
      terrain: "rough-foot",
    }),
    equipmentVisual: {
      primary: "spear", shield: "mixed", armour: "unarmoured",
      headgear: "bare", marker: "none",
    },
    typicalEquipment: ["spears", "blades", "mixed shields"],
    tacticalIdentity: "Loose northern infantry warband",
    uniqueAbility: "shieldwall",
  },
  {
    id: SUPPORT_ARCHETYPE_IDS.pictJavelinmen,
    name: "Pict javelinmen",
    faction: "saxon",
    type: "skirmishers",
    tags: ["infantry", "ranged"],
    battlefieldRole: "Missile screen",
    unitClass: "skirmishers",
    defaultStrength: 46,
    formationDoctrine: "loose order",
    defaultFormation: formation("mob", "loose", 14),
    gameplay: gameplay({
      armour: "light", speedClass: "medium", speed: 55.8, turnSpeed: 1.08,
      morale: 78, meleeAttack: 0.65, meleeDefence: 0.7,
      combatMoraleLoss: 1.1, terrain: "rough-foot",
    }),
    rangedWeapon: JAVELINS,
    equipmentVisual: {
      primary: "javelins", shield: "mixed", armour: "unarmoured",
      headgear: "bare", marker: "none",
    },
    typicalEquipment: ["javelins", "knives", "mixed shields"],
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
