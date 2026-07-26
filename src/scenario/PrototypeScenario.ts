import { createFormationLayout, createSoldiers } from "../units/formation";
import type {
  Faction,
  FormationType,
  MovementGroup,
  Unit,
  UnitType,
} from "../units/types";
import { createFormationSpine } from "../units/FormationSpine";

interface UnitSpec {
  id: string;
  name: string;
  faction: Faction;
  type: UnitType;
  x: number;
  y: number;
  facing: number;
  count: number;
  formation: FormationType;
  movementGroup?: MovementGroup;
  crossingLaneOffset?: number;
}

function makeUnit(spec: UnitSpec, index: number): Unit {
  const loose = spec.faction === "saxon" || spec.type === "skirmishers";
  const layout = createFormationLayout(spec.count, spec.formation, spec.type, loose);
  const baseMovementSpeed = spec.type === "cavalry"
    ? 82
    : spec.type === "skirmishers" ? 62
      : spec.type === "archers" ? 50
        : spec.type === "standard" ? 44 : 48;
  return {
    ...spec,
    position: { x: spec.x, y: spec.y },
    crossingLaneOffset: spec.crossingLaneOffset ?? 0,
    crossingLaneCommitted: false,
    uniqueAbility: spec.type === "infantry"
      ? spec.faction === "roman" ? "tortoise" : "shieldwall"
      : undefined,
    formationWidth: layout.width,
    formationDepth: layout.depth,
    soldierCount: spec.count,
    maximumSoldiers: spec.count,
    movementSpeed: spec.faction === "saxon"
      ? baseMovementSpeed * 0.9
      : baseMovementSpeed,
    turnSpeed: spec.type === "cavalry" ? 1.45 : 1.08,
    morale: spec.faction === "roman" ? 88 : 78,
    cohesion: spec.faction === "roman" ? 92 : 78,
    stamina: 100,
    order: { type: "hold" },
    state: "steady",
    soldiers: createSoldiers(layout, index * 11.3),
    formationSpine: createFormationSpine(layout.width),
    velocity: 0,
    selected: false,
    reforming: 0,
    combatTimer: index * 0.11,
    rangedTimer: index * 0.17,
    ammunition: spec.type === "archers" ? 12 : 0,
    maximumAmmunition: spec.type === "archers" ? 12 : 0,
    chargeReady: true,
    chargeBonusTimer: 0,
    routDamageTimer: 0,
    engagementStallTimer: 0,
    engagementRecoveryTimer: 0,
    combatProgressThisFrame: false,
    tacticalState: "standard",
    stationaryTimer: 0,
    passingFriendly: false,
    inCombat: false,
    vulnerableTimer: 0,
    formationChangeTimer: 0,
    recentDamageDealt: 0,
    recentDamageTaken: 0,
    terrain: "open",
    pathingState: "direct",
    stuckTimer: 0,
    standardMoraleBoost: false,
    routWaterStuckTimer: 0,
    attackCommandFlashTimer: 0,
    aboutFacePending: false,
    routingTimer: 0,
    routingDistanceTravelled: 0,
    routingDirectionX: 0,
    routingDirectionY: 0,
  };
}

export function createPrototypeScenario(selectedRomanUnitIds?: readonly string[]): Unit[] {
  const specs: UnitSpec[] = [
    { id: "R-I", name: "I Cohort · Prima", faction: "roman", type: "infantry", x: 690, y: 1120, facing: 0, count: 80, formation: "line" },
    { id: "R-II", name: "II Cohort · Secunda", faction: "roman", type: "infantry", x: 1030, y: 1190, facing: 0, count: 80, formation: "line" },
    { id: "R-III", name: "III Cohort · Tertia", faction: "roman", type: "infantry", x: 1370, y: 1190, facing: 0, count: 80, formation: "line" },
    { id: "R-IV", name: "IV Cohort · Quarta", faction: "roman", type: "infantry", x: 1710, y: 1120, facing: 0, count: 80, formation: "line" },
    { id: "R-CAV", name: "Equites Honoriani", faction: "roman", type: "cavalry", x: 430, y: 1320, facing: 0, count: 50, formation: "line" },
    { id: "S-WOLF", name: "Wulfgar's Hearthguard", faction: "saxon", type: "infantry", x: 670, y: 465, facing: Math.PI, count: 70, formation: "line", movementGroup: "left" },
    { id: "S-RAVEN", name: "Raven Banner", faction: "saxon", type: "infantry", x: 1020, y: 390, facing: Math.PI, count: 70, formation: "line", movementGroup: "centre", crossingLaneOffset: -42 },
    { id: "S-BOAR", name: "Boar Spears", faction: "saxon", type: "infantry", x: 1380, y: 390, facing: Math.PI, count: 70, formation: "line", movementGroup: "centre", crossingLaneOffset: 42 },
    { id: "S-ASH", name: "Ashwood Shields", faction: "saxon", type: "infantry", x: 1730, y: 465, facing: Math.PI, count: 70, formation: "line", movementGroup: "right", crossingLaneOffset: -72 },
    { id: "S-SKIRM", name: "Sea-wolf Skirmishers", faction: "saxon", type: "skirmishers", x: 1990, y: 610, facing: Math.PI, count: 60, formation: "line", movementGroup: "right" },
    { id: "R-STD", name: "Draco Standard", faction: "roman", type: "standard", x: 1200, y: 1320, facing: 0, count: 16, formation: "column" },
    { id: "S-STD", name: "Raven Standard", faction: "saxon", type: "standard", x: 1200, y: 300, facing: Math.PI, count: 16, formation: "column" },
    { id: "R-ARCH", name: "Britannic Sagittarii", faction: "roman", type: "archers", x: 2020, y: 1260, facing: 0, count: 60, formation: "line" },
    { id: "S-ARCH", name: "Yew Bow Levy", faction: "saxon", type: "archers", x: 2070, y: 330, facing: Math.PI, count: 60, formation: "line", movementGroup: "right", crossingLaneOffset: 72 },
  ];
  const selectedRomans = selectedRomanUnitIds === undefined
    ? undefined
    : new Set([...selectedRomanUnitIds, "R-STD"]);
  return specs
    .filter((spec) => spec.faction === "saxon" || selectedRomans === undefined || selectedRomans.has(spec.id))
    .map(makeUnit);
}
