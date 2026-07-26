import type { Vec2 } from "../core/math";

export type Faction = "roman" | "saxon";
export type UnitType =
  | "infantry"
  | "cavalry"
  | "skirmishers"
  | "archers"
  | "standard";
export type FormationType =
  | "line"
  | "column"
  | "shieldwall"
  | "tortoise"
  | "mob";
export type UniqueAbilityType = "tortoise" | "shieldwall";
export type UnitState = "steady" | "shaken" | "routing" | "broken" | "escaped";
export type TacticalState = "routing" | "vulnerable" | "standard" | "prepared";
export type UnitTerrain = "open" | "road" | "rough" | "woods" | "shallow water" | "deep water";
export type OrderType = "hold" | "move" | "attack" | "rally" | "fight";
export type PathingState = "direct" | "reorganising" | "fallback" | "blocked";
export type CrossingPhase = "approach" | "crossing" | "clearing";
export type EngagementArc = "front" | "left" | "right" | "rear";
export type MovementGroup = "left" | "centre" | "right";
export const ROUTING_DECISION_SECONDS = 10;

export interface Order {
  type: OrderType;
  destination?: Vec2;
  finalDestination?: Vec2;
  route?: Vec2[];
  routeIndex?: number;
  aligning?: boolean;
  facing?: number;
  targetUnitId?: string;
  engagementArc?: EngagementArc;
  engagementSlotIndex?: number;
}

export interface SoldierVisual {
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  targetX: number;
  targetY: number;
  phase: number;
}

export interface FormationSpinePoint {
  baseX: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
}

export interface Unit {
  id: string;
  name: string;
  faction: Faction;
  type: UnitType;
  position: Vec2;
  facing: number;
  formation: FormationType;
  crossingPhase?: CrossingPhase;
  crossingOriginBank?: -1 | 1;
  movementGroup?: MovementGroup;
  crossingLaneOffset: number;
  crossingLaneCommitted: boolean;
  uniqueAbility?: UniqueAbilityType;
  formationWidth: number;
  formationDepth: number;
  soldierCount: number;
  maximumSoldiers: number;
  movementSpeed: number;
  turnSpeed: number;
  morale: number;
  cohesion: number;
  stamina: number;
  order: Order;
  state: UnitState;
  soldiers: SoldierVisual[];
  formationSpine: FormationSpinePoint[];
  velocity: number;
  selected: boolean;
  reforming: number;
  combatTimer: number;
  rangedTimer: number;
  ammunition: number;
  maximumAmmunition: number;
  chargeReady: boolean;
  chargeTargetId?: string;
  chargeBonusTimer: number;
  engagedTargetId?: string;
  aiTargetId?: string;
  aiEngagementArc?: EngagementArc;
  engagementStallTimer: number;
  engagementRecoveryTimer: number;
  combatProgressThisFrame: boolean;
  routDamageTimer: number;
  tacticalState: TacticalState;
  stationaryTimer: number;
  passingFriendly: boolean;
  inCombat: boolean;
  vulnerableTimer: number;
  reorientationTargetId?: string;
  formationChangeTimer: number;
  recentDamageDealt: number;
  recentDamageTaken: number;
  terrain: UnitTerrain;
  pathingState: PathingState;
  stuckTimer: number;
  fallbackDestination?: Vec2;
  pathGoal?: Vec2;
  pathFacing?: number;
  pathCrossingX?: number;
  standardMoraleBoost: boolean;
  routWaterStuckTimer: number;
  attackCommandFlashTimer: number;
  aboutFacePending: boolean;
  routingTimer: number;
  routingDistanceTravelled: number;
  routingDirectionX: number;
  routingDirectionY: number;
}

export function isUnitInactive(unit: Pick<Unit, "state">): boolean {
  return unit.state === "escaped" || unit.state === "broken";
}

export const FACTION_STYLE = {
  roman: { primary: "#932d32", dark: "#5c1d23", detail: "#d6b45d" },
  saxon: { primary: "#52728a", dark: "#304c60", detail: "#e4dfc9" },
} as const;

export const TACTICAL_STATE_STYLE = {
  routing: { fill: "rgba(83,22,22,.9)", border: "#df554d", text: "#ffd5cf" },
  vulnerable: { fill: "rgba(81,52,18,.9)", border: "#d89a45", text: "#ffe4b0" },
  standard: { fill: "rgba(27,55,29,.9)", border: "#6f9f58", text: "#e5f3dc" },
  prepared: { fill: "rgba(24,45,70,.9)", border: "#5f91c7", text: "#e0efff" },
} as const;
