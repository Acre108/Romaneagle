import { angleDelta, clamp, distance, type Vec2 } from "../core/math";
import {
  calculateFormationContact,
  formationHalfDepth,
} from "../units/FormationContact";
import {
  calculateEngagementSlotPosition,
  createEngagementSlotUsage,
  hasOpenEngagementSlot,
  selectEngagementSlot,
  type EngagementSlotUsage,
} from "../units/EngagementSlots";
import {
  calculateFormationTerrainCoverage,
  classifyFormationTerrain,
  constrainFormationWorldPoint,
  type FormationTerrainCoverage,
  FORMATION_MAP_MARGIN,
  SAXON_FORMATION_FLOW_CLEARANCE,
  TERRAIN_COVERAGE_THRESHOLD,
} from "../units/FormationTerrain";
import { formationWheelRate, wheelFormation } from "../units/FormationWheel";
import {
  calculateFormationWrapOffset,
} from "../units/FormationWrap";
import {
  FORMATION_SPINE_POINT_COUNT,
  MAX_SPINE_DEPTH_BEND,
  MAX_SPINE_LATERAL_BEND,
  sampleFormationSpine,
  type FormationSpineSample,
} from "../units/FormationSpine";
import {
  completeAboutFace,
  formationRadius,
} from "../units/formation";
import {
  isUnitInactive,
  ROUTING_DECISION_SECONDS,
  type Faction,
  type MovementGroup,
  type TacticalState,
  type Unit,
} from "../units/types";
import type { Battlefield } from "../world/Battlefield";
import {
  STREAM_HALF_WIDTH,
  WATER_CROSSINGS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../world/Battlefield";

export interface BattleEffect {
  x: number;
  y: number;
  life: number;
  amount?: number;
  charge?: boolean;
  label?: string;
  ranged?: boolean;
  sourceX?: number;
  sourceY?: number;
}

export interface FallenBody {
  x: number;
  y: number;
  facing: number;
  faction: Faction;
  phase: number;
}

export interface RoutEscapeVisual {
  x: number;
  y: number;
  directionX: number;
  directionY: number;
  speed: number;
  phase: number;
  faction: Faction;
}

export interface DiscardedEquipment {
  x: number;
  y: number;
  rotation: number;
  faction: Faction;
  kind: "shield" | "weapon";
}

export type BattleStandardStatus = "unit" | "dropped" | "captured" | "escaped";

export interface BattleStandard {
  id: string;
  faction: Faction;
  position: Vec2;
  status: BattleStandardStatus;
  bearerUnitId?: string;
}

export interface BattleStats {
  romanRouted: number;
  saxonRouted: number;
  romanDestroyed: number;
  saxonDestroyed: number;
  outcome: "ongoing" | "romanVictory" | "saxonVictory" | "mutualDestruction";
}

export const CHARGE_DURATION = 3;
export const COMBAT_STRIKE_INTERVAL = 1.5;
export const ARCHER_RANGE = 430;
export const ARCHER_PREFERRED_RANGE = 370;
export const ARCHER_VOLLEY_INTERVAL = 2.8;
export const STANDARD_AURA_RADIUS = 230;
export const STANDARD_AURA_COVERAGE = 0.5;
export const STANDARD_MORALE_RECOVERY_PER_SECOND = 0.65;
export const STANDARD_PICKUP_RADIUS = 24;
export const ROUT_MORALE_THRESHOLD = 35;
export const BROKEN_AFTER_ROUTING_SECONDS = ROUTING_DECISION_SECONDS;
export const MORALE_LOSS_MULTIPLIER = 0.72;
export const ROUT_ESCAPE_PROGRESS_DISTANCE = 220;
export const ENEMY_MAX_FORMATION_PENETRATION = 2;
export const FRIENDLY_MAX_FORMATION_PENETRATION = 30;
export const CROWDED_FRIENDLY_MAX_FORMATION_PENETRATION = 12;
const CHARGE_APPROACH_RANGE = 105;
const CHARGE_CONTACT_PADDING = 6;
const CHARGE_SPEED_MULTIPLIER = 1.32;
const ROUT_DAMAGE_INTERVAL = 0.8;
const BODY_TERRAIN_RADIUS = 85;
const BODY_TERRAIN_THRESHOLD = 12;
const FRIENDLY_BODY_MORALE_THRESHOLD = 6;
const COMBAT_MEMORY_SECONDS = 6;
const STUCK_RECOVERY_SECONDS = 3;
const PATH_RECOVERY_PAUSE_SECONDS = 2;
const PATH_FALLBACK_SECONDS = 4;
const PATH_FALLBACK_DISTANCE = 72;
const ENGAGEMENT_STALL_SECONDS = 3;
export const ROUT_WATER_FAILURE_SECONDS = 3;
const SAXON_CROSSING_READY_DISTANCE = 54;
const SAXON_CROSSING_MAX_WAIT_SECONDS = 24;
const SAXON_TARGET_STICKINESS = 165;

const SAXON_GROUP_CROSSING_INDEX: Readonly<Record<MovementGroup, number>> = {
  left: 0,
  centre: 1,
  right: 2,
};

export function saxonGroupCrossingX(
  unit: Pick<Unit, "faction" | "movementGroup">,
): number | undefined {
  if (unit.faction !== "saxon" || !unit.movementGroup) return undefined;
  return WATER_CROSSINGS[SAXON_GROUP_CROSSING_INDEX[unit.movementGroup]]?.x;
}

const nearestEnemy = (unit: Unit, units: Unit[]): Unit | undefined => {
  let nearest: Unit | undefined;
  let nearestDistance = Infinity;
  for (const candidate of units) {
    if (candidate.faction === unit.faction || isUnitInactive(candidate)) continue;
    const d = distance(unit.position, candidate.position);
    if (d < nearestDistance) {
      nearestDistance = d;
      nearest = candidate;
    }
  }
  return nearest;
};

export function calculateSafeAIDestination(
  unit: Unit,
  target: Vec2,
  battlefield: Battlefield,
  crossingLoads?: ArrayLike<number>,
  committedCrossingX?: number,
): Vec2 {
  const currentBank = unit.position.y >= battlefield.streamY(unit.position.x) ? 1 : -1;
  const targetBank = target.y >= battlefield.streamY(target.x) ? 1 : -1;
  const clearance = STREAM_HALF_WIDTH +
    formationRadius(unit) + 18;
  if (committedCrossingX !== undefined && currentBank === targetBank) {
    const riverClearance = Math.abs(
      unit.position.y - battlefield.streamY(unit.position.x),
    );
    if (riverClearance < clearance - 1) {
      return {
        x: committedCrossingX,
        y: battlefield.streamY(committedCrossingX) + targetBank * clearance,
      };
    }
    return { ...target };
  }
  if (
    committedCrossingX === undefined &&
    !battlefield.segmentCrossesDeepWater(unit.position, target)
  ) return { ...target };
  if (currentBank === targetBank) return { ...target };

  let bestX = 0;
  let bestY = 0;
  let bestExitX = 0;
  let bestExitY = 0;
  let bestCost = Infinity;
  for (let crossingIndex = 0; crossingIndex < WATER_CROSSINGS.length; crossingIndex += 1) {
    const crossing = WATER_CROSSINGS[crossingIndex];
    if (!crossing) continue;
    if (committedCrossingX !== undefined && crossing.x !== committedCrossingX) continue;
    const crossingY = battlefield.streamY(crossing.x);
    const approachX = crossing.x + (
      committedCrossingX === crossing.x && unit.crossingLaneCommitted
        ? unit.crossingLaneOffset
        : 0
    );
    const approachY = crossingY + currentBank * clearance;
    const exitX = approachX;
    const exitY = battlefield.streamY(exitX) - currentBank * clearance;
    if (
      battlefield.segmentCrossesDeepWater(unit.position, { x: approachX, y: approachY }) ||
      battlefield.segmentCrossesDeepWater({ x: approachX, y: approachY }, { x: exitX, y: exitY }) ||
      battlefield.segmentCrossesDeepWater({ x: exitX, y: exitY }, target)
    ) continue;
    const cost = Math.hypot(approachX - unit.position.x, approachY - unit.position.y) +
      Math.hypot(target.x - exitX, target.y - exitY) +
      (crossingLoads?.[crossingIndex] ?? 0) * 900;
    if (cost < bestCost) {
      bestCost = cost;
      bestX = approachX;
      bestY = approachY;
      bestExitX = exitX;
      bestExitY = exitY;
    }
  }

  if (!Number.isFinite(bestCost)) return { ...target };
  const lateralDistance = Math.abs(bestX - unit.position.x);
  const bankDistance = currentBank *
    (unit.position.y - battlefield.streamY(bestX));
  const enteredCrossingLane = lateralDistance <= 24 &&
    bankDistance <= clearance + 8;
  return enteredCrossingLane
    ? { x: bestExitX, y: bestExitY }
    : { x: bestX, y: bestY };
}

export function calculateSafeRoutDestination(
  unit: Unit,
  target: Vec2,
  battlefield: Battlefield,
  committedCrossingX?: number,
): Vec2 {
  if (!battlefield.segmentCrossesDeepWater(unit.position, target)) return { ...target };
  let destination = calculateSafeAIDestination(
    unit,
    target,
    battlefield,
    undefined,
    committedCrossingX,
  );
  if (
    committedCrossingX !== undefined &&
    destination.x === target.x &&
    destination.y === target.y
  ) {
    destination = calculateSafeAIDestination(unit, target, battlefield);
  }
  if (!battlefield.segmentCrossesDeepWater(unit.position, destination)) return destination;

  const bank = unit.position.y >= battlefield.streamY(unit.position.x) ? 1 : -1;
  const clearance = STREAM_HALF_WIDTH + formationRadius(unit) + 22;
  let bestX = target.x;
  let bestY = target.y;
  let bestCost = Infinity;
  for (const crossing of WATER_CROSSINGS) {
    const candidateX = crossing.x;
    const candidateY = battlefield.streamY(candidateX) + bank * clearance;
    const candidate = { x: candidateX, y: candidateY };
    if (battlefield.segmentCrossesDeepWater(unit.position, candidate)) continue;
    const cost = Math.hypot(candidateX - unit.position.x, candidateY - unit.position.y);
    if (cost < bestCost) {
      bestCost = cost;
      bestX = candidateX;
      bestY = candidateY;
    }
  }
  return { x: bestX, y: bestY };
}

function damageArc(defender: Unit, attacker: Unit): "front" | "flank" | "rear" {
  const bearing = Math.atan2(attacker.position.y - defender.position.y, attacker.position.x - defender.position.x);
  const relative = Math.abs(angleDelta(defender.facing - Math.PI / 2, bearing));
  if (relative < Math.PI * 0.42) return "front";
  if (relative > Math.PI * 0.72) return "rear";
  return "flank";
}

function tacticalStateRank(state: TacticalState): number {
  if (state === "routing") return -1;
  if (state === "vulnerable") return 0;
  if (state === "standard") return 1;
  return 2;
}

export function calculateStandardAuraCoverage(
  unit: Unit,
  standardPosition: Vec2,
  radius = STANDARD_AURA_RADIUS,
): number {
  if (unit.soldierCount <= 0) return 0;
  const radiusSquared = radius * radius;
  const cos = Math.cos(unit.facing);
  const sin = Math.sin(unit.facing);
  let covered = 0;
  for (let index = 0; index < unit.soldierCount; index += 1) {
    const soldier = unit.soldiers[index];
    if (!soldier) continue;
    const worldX = unit.position.x + soldier.baseX * cos - soldier.baseY * sin;
    const worldY = unit.position.y + soldier.baseX * sin + soldier.baseY * cos;
    const dx = worldX - standardPosition.x;
    const dy = worldY - standardPosition.y;
    if (dx * dx + dy * dy <= radiusSquared) covered += 1;
  }
  return covered / unit.soldierCount;
}

export function estimateCasualties(attacker: Unit, defender: Unit, arc: "front" | "flank" | "rear"): number {
  let attack = attacker.soldierCount / Math.max(1, attacker.maximumSoldiers);
  attack *= 0.45 + attacker.cohesion / 100 * 0.75;
  if (attacker.formation === "column") attack *= 0.62;
  if (attacker.formation === "mob") attack *= 0.5;
  if (attacker.formation === "tortoise") attack *= 0.62;
  if (attacker.type === "archers") attack *= 0.32;
  if (arc === "flank") attack *= 1.65;
  if (arc === "rear") attack *= 2.55;
  if (defender.formation === "tortoise" && arc === "flank") attack *= 0.42;
  if (
    attacker.type === "cavalry" &&
    defender.type !== "cavalry" &&
    defender.formation !== "mob"
  ) {
    attack *= arc === "front" ? 0.68 : 1.25;
  }
  if (defender.formation === "shieldwall" && arc === "front") attack *= 0.78;
  if (defender.formation === "tortoise" && arc === "front") attack *= 0.68;
  if (attacker.type === "cavalry" && defender.formation === "shieldwall" && arc === "front") attack *= 0.45;
  if (attacker.type === "cavalry" && defender.formation === "tortoise" && arc === "front") attack *= 0.4;
  if (defender.tacticalState === "vulnerable") attack *= 1.25;
  if (defender.tacticalState === "prepared") attack *= 0.72;
  const casualties = clamp(Math.round(attack), 0, 6);
  return attacker.chargeBonusTimer > 0 ? casualties * 2 : casualties;
}

export function estimateRangedCasualties(
  attacker: Unit,
  defender: Unit,
  arc: "front" | "flank" | "rear",
): number {
  let attack = 3.2 *
    (attacker.soldierCount / Math.max(1, attacker.maximumSoldiers)) *
    (0.55 + attacker.cohesion / 100 * 0.65);
  if (attacker.formation === "column") attack *= 0.76;
  if (attacker.formation === "mob") attack *= 0.58;
  if (attacker.terrain === "woods") attack *= 0.72;

  const carriesShields = defender.type === "infantry" ||
    defender.type === "standard";
  if (defender.formation === "tortoise") {
    attack *= arc === "front" ? 0.06 : arc === "flank" ? 0.28 : 0.45;
  } else if (defender.formation === "shieldwall" && arc === "front") {
    attack *= 0.18;
  } else if (carriesShields && arc === "front") {
    attack *= 0.3;
  }
  if (defender.tacticalState === "prepared") attack *= 0.82;
  if (defender.tacticalState === "vulnerable") attack *= 1.15;
  return clamp(Math.round(attack), 0, 5);
}

export function estimateRoutedCasualties(
  attacker: Unit,
  defender: Unit,
  arc: "front" | "flank" | "rear",
): number {
  const routedLosses = Math.max(1, Math.ceil(estimateCasualties(attacker, defender, arc) * 1.5));
  return attacker.type === "cavalry" ? Math.ceil(routedLosses * 1.25) : routedLosses;
}

export function estimateCombatMoraleLoss(
  defender: Unit,
  casualties: number,
  arc: "front" | "flank" | "rear",
): number {
  const shock = arc === "rear" ? 3.5 : arc === "flank" ? 1.5 : 0;
  const baseLoss = casualties + shock;
  const readiness = defender.tacticalState === "prepared"
    ? 0.72
    : defender.tacticalState === "standard" ? 0.88
      : defender.tacticalState === "vulnerable" ? 1.05 : 1;
  const totalDamage = Math.max(1, defender.recentDamageDealt + defender.recentDamageTaken);
  const winningMargin = clamp(
    (defender.recentDamageDealt - defender.recentDamageTaken) / totalDamage,
    0,
    1,
  );
  return baseLoss * readiness * (1 - winningMargin * 0.38) *
    MORALE_LOSS_MULTIPLIER;
}

export function fallenSoldierVisualIndex(
  unit: Unit,
  firstDeadIndex: number,
  casualtyOffset: number,
  casualties: number,
): number {
  if (unit.formation !== "tortoise") return firstDeadIndex + casualtyOffset;
  const originalCount = Math.max(1, firstDeadIndex + casualties);
  return (firstDeadIndex * 17 + casualtyOffset * 31) % originalCount;
}

export class Simulation {
  readonly effects: BattleEffect[] = [];
  readonly bodies: FallenBody[] = [];
  readonly routEscapeVisuals: RoutEscapeVisual[] = [];
  readonly discardedEquipment: DiscardedEquipment[] = [];
  readonly standards: BattleStandard[];
  readonly stats: BattleStats = {
    romanRouted: 0,
    saxonRouted: 0,
    romanDestroyed: 0,
    saxonDestroyed: 0,
    outcome: "ongoing",
  };
  private readonly contactScratch = { separation: 0, normalX: 0, normalY: 0 };
  private readonly bodyCountScratch = { total: 0, friendly: 0 };
  private readonly terrainPointScratch = { x: 0, y: 0 };
  private readonly spineOffsetXScratch =
    new Float64Array(FORMATION_SPINE_POINT_COUNT);
  private readonly spineOffsetYScratch =
    new Float64Array(FORMATION_SPINE_POINT_COUNT);
  private readonly spineSampleScratch: FormationSpineSample = {
    x: 0,
    y: 0,
    normalX: 0,
    normalY: 1,
  };
  private readonly terrainCoverageScratch: FormationTerrainCoverage = {
    deepWater: 0,
    shallowWater: 0,
    woods: 0,
    rough: 0,
    road: 0,
  };
  private aiTimer = 0;
  private saxonCrossingWaveReleased = false;
  private saxonCrossingWaveWait = 0;

  constructor(readonly units: Unit[], readonly battlefield: Battlefield) {
    this.standards = units
      .filter((unit) => unit.type === "standard")
      .map((unit) => ({
        id: `${unit.id}-standard`,
        faction: unit.faction,
        position: { ...unit.position },
        status: "unit",
        bearerUnitId: unit.id,
      }));
  }

  update(dt: number): void {
    this.aiTimer -= dt;
    if (this.aiTimer <= 0) {
      this.aiTimer = 2;
      this.updateAI();
    }
    for (const unit of this.units) {
      unit.engagedTargetId = undefined;
      unit.inCombat = false;
      unit.combatProgressThisFrame = false;
      unit.passingFriendly = this.overlapsFriendly(unit);
    }
    for (const unit of this.units) this.updateUnit(unit, dt);
    this.resolveRangedCombat(dt);
    this.resolveCombat(dt);
    this.updateEngagementRecovery(dt);
    this.resolveRoutOverruns(dt);
    this.updateBattleStandards();
    this.updateFormationWraps(dt);
    this.updateMorale(dt);
    this.updateTacticalStates(dt);
    this.updateBattleOutcome();
    this.updateRoutEscapeVisuals(dt);
    for (let i = this.effects.length - 1; i >= 0; i -= 1) {
      const effect = this.effects[i];
      if (!effect) continue;
      effect.life -= dt;
      effect.y -= dt * 10;
      if (effect.life <= 0) this.effects.splice(i, 1);
    }
  }

  private updateUnit(unit: Unit, dt: number): void {
    if (isUnitInactive(unit)) return;
    const previousX = unit.position.x;
    const previousY = unit.position.y;
    const previousFacing = unit.facing;
    calculateFormationTerrainCoverage(
      unit,
      unit.position.x,
      unit.position.y,
      this.battlefield,
      this.terrainCoverageScratch,
      this.terrainPointScratch,
    );
    const previousDeepWaterCoverage = this.terrainCoverageScratch.deepWater;
    const previousStreamDistance = Math.abs(
      unit.position.y - this.battlefield.streamY(unit.position.x),
    );
    unit.terrain = classifyFormationTerrain(this.terrainCoverageScratch);
    unit.chargeBonusTimer = Math.max(0, unit.chargeBonusTimer - dt);
    unit.attackCommandFlashTimer = Math.max(0, unit.attackCommandFlashTimer - dt);
    unit.engagementRecoveryTimer = Math.max(0, unit.engagementRecoveryTimer - dt);
    unit.formationChangeTimer = Math.max(0, unit.formationChangeTimer - dt);
    if (unit.aboutFacePending && unit.formationChangeTimer <= 0) {
      completeAboutFace(unit);
    }
    if (
      unit.pathingState === "reorganising" &&
      unit.formationChangeTimer <= 0 &&
      unit.fallbackDestination
    ) {
      unit.pathingState = "fallback";
      unit.order = { type: "move", destination: { ...unit.fallbackDestination } };
    }
    const combatMemory = Math.max(0, 1 - dt / COMBAT_MEMORY_SECONDS);
    unit.recentDamageDealt *= combatMemory;
    unit.recentDamageTaken *= combatMemory;
    const formationLocked = unit.formationChangeTimer > 0;
    let destination = unit.order.destination;
    let attackTarget: Unit | undefined;
    if (unit.order.type === "attack") {
      attackTarget = unit.order.targetUnitId
        ? this.findUnit(unit.order.targetUnitId)
        : undefined;
      if (
        !attackTarget ||
        attackTarget.faction === unit.faction ||
        isUnitInactive(attackTarget)
      ) {
        unit.order = { type: "hold" };
        unit.pathCrossingX = undefined;
        unit.crossingPhase = undefined;
        unit.crossingOriginBank = undefined;
        destination = undefined;
        attackTarget = undefined;
      } else {
        const rangedEngagement = unit.type === "archers" &&
          unit.ammunition > 0 &&
          distance(unit.position, attackTarget.position) <= ARCHER_PREFERRED_RANGE;
        const contact = calculateFormationContact(unit, attackTarget, this.contactScratch);
        if (rangedEngagement || contact.separation <= CHARGE_CONTACT_PADDING) {
          destination = undefined;
          unit.reorientationTargetId = attackTarget.id;
        } else {
          const attackDestination = unit.order.engagementArc
            ? calculateEngagementSlotPosition(
                unit,
                attackTarget,
                unit.order.engagementArc,
                unit.order.engagementSlotIndex ?? 0,
              )
            : attackTarget.position;
          destination = calculateSafeAIDestination(
            unit,
            attackDestination,
            this.battlefield,
            undefined,
            unit.pathCrossingX,
          );
          const crossingRequired = this.battlefield.segmentCrossesDeepWater(
            unit.position,
            attackDestination,
          ) || (
            unit.pathCrossingX !== undefined &&
            Math.abs(destination.x - unit.pathCrossingX) < 1
          );
          if (crossingRequired) {
            for (const crossing of WATER_CROSSINGS) {
              if (Math.abs(destination.x - crossing.x) < 1) {
                unit.pathCrossingX = crossing.x;
                break;
              }
            }
          } else {
            unit.pathCrossingX = undefined;
            unit.crossingPhase = undefined;
            unit.crossingOriginBank = undefined;
          }
        }
      }
    }
    if (unit.state === "routing") {
      this.ensureRoutingDirection(unit);
      if (
        unit.order.type !== "move" &&
        unit.order.type !== "rally"
      ) {
        unit.order = { type: "move" };
      }
      const routTarget = {
        x: unit.position.x + unit.routingDirectionX * 350,
        y: unit.position.y + unit.routingDirectionY * 350,
      };
      destination = calculateSafeRoutDestination(
        unit,
        routTarget,
        this.battlefield,
        unit.pathCrossingX,
      );
      const routingCrossingRequired = this.battlefield.segmentCrossesDeepWater(
        unit.position,
        routTarget,
      ) || (
        unit.pathCrossingX !== undefined &&
        Math.abs(destination.x - unit.pathCrossingX) < 1
      );
      if (routingCrossingRequired) {
        for (const crossing of WATER_CROSSINGS) {
          if (Math.abs(destination.x - crossing.x) < 1) {
            unit.pathCrossingX = crossing.x;
            break;
          }
        }
      } else {
        unit.pathCrossingX = undefined;
        unit.crossingLaneCommitted = false;
        unit.crossingPhase = undefined;
        unit.crossingOriginBank = undefined;
      }
    }

    let moving = false;
    if (!formationLocked && destination && unit.order.type !== "hold") {
      const dx = destination.x - unit.position.x;
      const dy = destination.y - unit.position.y;
      const remaining = Math.hypot(dx, dy);
      if (remaining > 8) {
        moving = true;
        const desiredFacing = Math.atan2(dy, dx) + Math.PI / 2;
        const turn = angleDelta(unit.facing, desiredFacing);

        let modifier = unit.terrain === "shallow water"
          ? 0.48
          : unit.terrain === "woods" ? 0.62
            : unit.terrain === "rough" ? 0.68 : 1;
        if (this.hasDifficultBodyTerrain(unit.position)) modifier *= 0.62;
        if (unit.formation === "column" && unit.terrain === "road") modifier *= 1.32;
        modifier *= 0.58 + unit.cohesion / 100 * 0.42;
        if (unit.formation === "shieldwall") modifier *= 0.68;
        if (unit.formation === "tortoise") modifier *= 0.48;
        if (unit.state === "routing") modifier *= 1.18;
        if (unit.passingFriendly) {
          const flowingThroughSaxons = unit.faction === "saxon" &&
            !this.hasEnemyContact(unit);
          modifier *= flowingThroughSaxons ? 0.82 : 0.32;
        }
        if (
          unit.formation !== "mob" &&
          unit.formation !== "tortoise" &&
          unit.state !== "routing" &&
          unit.type !== "standard" &&
          unit.type !== "archers"
        ) {
          this.updateChargeApproach(unit);
        }
        if (unit.chargeTargetId) modifier *= CHARGE_SPEED_MULTIPLIER;
        const movingWithoutFormation = unit.formation === "mob" ||
          unit.state === "routing";
        const steering = movingWithoutFormation ? 1 : Math.max(0.2, Math.cos(turn));
        const desiredSpeed = unit.movementSpeed * modifier * steering;
        unit.velocity += clamp(desiredSpeed - unit.velocity, -65 * dt, 42 * dt);
        let turnAmount = turn;
        if (movingWithoutFormation) {
          unit.facing = desiredFacing;
        } else {
          const turnRate = formationWheelRate(unit, unit.movementSpeed * modifier);
          turnAmount = clamp(turn, -turnRate * dt, turnRate * dt);
          wheelFormation(unit, turnAmount);
          if (Math.abs(turn) > 0.55 && unit.velocity > 10) {
            unit.cohesion -= Math.abs(turnAmount) * dt * 12;
          }
        }
        const travel = Math.min(remaining, unit.velocity * dt);
        const forward = unit.facing - Math.PI / 2;
        unit.position.x += Math.cos(forward) * travel;
        unit.position.y += Math.sin(forward) * travel;
        unit.stamina = Math.max(10, unit.stamina - dt * (unit.type === "cavalry" ? 1.6 : 0.65));
        if (unit.terrain === "rough" || unit.terrain === "shallow water") unit.cohesion -= dt * 2.4;
      } else if (unit.order.type === "attack") {
        unit.velocity = Math.max(0, unit.velocity - 70 * dt);
      } else {
        unit.position.x = destination.x;
        unit.position.y = destination.y;
        unit.velocity = Math.max(0, unit.velocity - 70 * dt);
        if (unit.order.facing !== undefined) {
          const turn = angleDelta(unit.facing, unit.order.facing);
          if (unit.formation === "mob") {
            unit.facing = unit.order.facing;
          } else {
            const turnRate = formationWheelRate(unit, unit.movementSpeed);
            wheelFormation(unit, clamp(turn, -turnRate * dt, turnRate * dt));
          }
          destination.x = unit.position.x;
          destination.y = unit.position.y;
          if (Math.abs(turn) < 0.03) unit.order = { type: "hold" };
        } else {
          unit.order = { type: "hold" };
        }
      }
    } else {
      unit.velocity = Math.max(0, unit.velocity - 70 * dt);
      unit.stamina = Math.min(100, unit.stamina + dt * 1.6);
      if (
        !formationLocked &&
        (unit.order.type === "fight" || unit.order.type === "attack")
      ) {
        moving = this.reorientInCombat(unit, dt);
      }
    }
    this.resolveFormationPenetration(unit);

    calculateFormationTerrainCoverage(
      unit,
      unit.position.x,
      unit.position.y,
      this.battlefield,
      this.terrainCoverageScratch,
      this.terrainPointScratch,
    );
    const nextStreamDistance = Math.abs(
      unit.position.y - this.battlefield.streamY(unit.position.x),
    );
    const escapingDeepWater = previousDeepWaterCoverage > TERRAIN_COVERAGE_THRESHOLD &&
      nextStreamDistance > previousStreamDistance + 0.001;
    if (
      this.terrainCoverageScratch.deepWater > TERRAIN_COVERAGE_THRESHOLD &&
      !escapingDeepWater
    ) {
      unit.position.x = previousX;
      unit.position.y = previousY;
      unit.velocity = 0;
      calculateFormationTerrainCoverage(
        unit,
        unit.position.x,
        unit.position.y,
        this.battlefield,
        this.terrainCoverageScratch,
        this.terrainPointScratch,
      );
    }
    unit.terrain = classifyFormationTerrain(this.terrainCoverageScratch);

    let mapMarginX = 6;
    let mapMarginY = 6;
    if (unit.state !== "routing" && (moving || unit.velocity > 1)) {
      const cos = Math.abs(Math.cos(unit.facing));
      const sin = Math.abs(Math.sin(unit.facing));
      mapMarginX = Math.min(
        WORLD_WIDTH * 0.5,
        FORMATION_MAP_MARGIN + unit.formationWidth * 0.5 * cos + unit.formationDepth * 0.5 * sin,
      );
      mapMarginY = Math.min(
        WORLD_HEIGHT * 0.5,
        FORMATION_MAP_MARGIN + unit.formationWidth * 0.5 * sin + unit.formationDepth * 0.5 * cos,
      );
    }
    unit.position.x = clamp(unit.position.x, mapMarginX, WORLD_WIDTH - mapMarginX);
    unit.position.y = clamp(unit.position.y, mapMarginY, WORLD_HEIGHT - mapMarginY);
    if (unit.state === "routing" && (
      unit.position.x < 12 || unit.position.y < 12 ||
      unit.position.x > WORLD_WIDTH - 12 || unit.position.y > WORLD_HEIGHT - 12
    )) {
      this.escapeRoutedUnit(unit);
    }

    unit.reforming = Math.max(0, unit.reforming - dt / 4);
    const interpolation = Math.min(1, dt * (unit.reforming > 0 ? 1.35 : 4));
    const disorder = (100 - unit.cohesion) / 100 * (unit.state === "routing" ? 14 : 7);
    for (let i = 0; i < unit.soldierCount; i += 1) {
      const soldier = unit.soldiers[i];
      if (!soldier) continue;
      const jitterX = Math.sin(soldier.phase * 2.1 + unit.position.x * 0.008) * disorder;
      const jitterY = Math.cos(soldier.phase * 1.7 + unit.position.y * 0.009) * disorder;
      soldier.x += (soldier.targetX + jitterX - soldier.x) * interpolation;
      soldier.y += (soldier.targetY + jitterY - soldier.y) * interpolation;
    }

    if (!moving && unit.reforming <= 0 && unit.order.type !== "fight") {
      unit.cohesion = Math.min(100, unit.cohesion + dt * 1.8);
    }
    const displacement = Math.hypot(unit.position.x - previousX, unit.position.y - previousY);
    if (unit.state === "routing") {
      unit.routingDistanceTravelled += displacement;
    }
    const rotation = Math.abs(angleDelta(previousFacing, unit.facing));
    if (
      displacement < 0.05 &&
      rotation < 0.001 &&
      unit.velocity < 1 &&
      !moving
    ) {
      unit.stationaryTimer += dt;
    } else {
      unit.stationaryTimer = 0;
    }
    this.updatePathingRecovery(unit, dt, displacement);
    this.updateRoutRiverFailure(unit, dt, displacement);
    unit.cohesion = clamp(unit.cohesion, 0, 100);
  }

  private updateRoutRiverFailure(unit: Unit, dt: number, displacement: number): void {
    if (unit.state !== "routing") {
      unit.routWaterStuckTimer = 0;
      return;
    }
    const riverDistance = Math.abs(
      unit.position.y - this.battlefield.streamY(unit.position.x),
    );
    const nearRiver = riverDistance <
      STREAM_HALF_WIDTH + formationRadius(unit) + 28;
    if (nearRiver && displacement < 0.08 && unit.velocity < 2) {
      unit.routWaterStuckTimer += dt;
    } else {
      unit.routWaterStuckTimer = 0;
    }
    if (unit.routWaterStuckTimer >= ROUT_WATER_FAILURE_SECONDS) {
      unit.morale = Math.max(0, unit.morale - dt * 4);
      unit.routingTimer += dt * 0.5;
    }
  }

  private scatterBrokenSurvivors(unit: Unit): void {
    const threat = nearestEnemy(unit, this.units);
    let directionX = Math.cos(unit.facing - Math.PI / 2);
    let directionY = Math.sin(unit.facing - Math.PI / 2);
    if (threat) {
      directionX = unit.position.x - threat.position.x;
      directionY = unit.position.y - threat.position.y;
    }
    const directionLength = Math.max(1, Math.hypot(directionX, directionY));
    directionX /= directionLength;
    directionY /= directionLength;
    const cos = Math.cos(unit.facing);
    const sin = Math.sin(unit.facing);
    for (let index = 0; index < unit.soldierCount; index += 1) {
      const soldier = unit.soldiers[index];
      if (!soldier) continue;
      const worldX = unit.position.x + soldier.x * cos - soldier.y * sin;
      const worldY = unit.position.y + soldier.x * sin + soldier.y * cos;
      const spread = Math.sin(soldier.phase * 1.91) * 0.09;
      const spreadCos = Math.cos(spread);
      const spreadSin = Math.sin(spread);
      this.routEscapeVisuals.push({
        x: worldX,
        y: worldY,
        directionX: directionX * spreadCos - directionY * spreadSin,
        directionY: directionX * spreadSin + directionY * spreadCos,
        speed: 31 + (Math.sin(soldier.phase * 2.37) + 1) * 3,
        phase: soldier.phase,
        faction: unit.faction,
      });
      this.discardedEquipment.push({
        x: worldX,
        y: worldY,
        rotation: soldier.phase,
        faction: unit.faction,
        kind: index % 2 === 0 ? "shield" : "weapon",
      });
    }
  }

  private updateRoutEscapeVisuals(dt: number): void {
    for (let index = this.routEscapeVisuals.length - 1; index >= 0; index -= 1) {
      const visual = this.routEscapeVisuals[index];
      if (!visual) continue;
      visual.x += visual.directionX * visual.speed * dt;
      visual.y += visual.directionY * visual.speed * dt;
      if (
        visual.x < -12 ||
        visual.y < -12 ||
        visual.x > WORLD_WIDTH + 12 ||
        visual.y > WORLD_HEIGHT + 12
      ) {
        this.routEscapeVisuals.splice(index, 1);
      }
    }
  }

  private updatePathingRecovery(unit: Unit, dt: number, displacement: number): void {
    if (unit.pathingState === "fallback") {
      if (unit.order.type === "move" && unit.order.destination) {
        unit.stuckTimer += dt;
        if (
          displacement < 0.05 && unit.velocity < 1 &&
          unit.stuckTimer >= STUCK_RECOVERY_SECONDS ||
          unit.stuckTimer >= PATH_FALLBACK_SECONDS
        ) {
          unit.pathingState = "direct";
          unit.fallbackDestination = undefined;
          unit.stuckTimer = 0;
          unit.order = { type: "hold" };
          this.aiTimer = 0;
        }
        return;
      }
      if (unit.order.type !== "move" || !unit.order.destination) {
        unit.pathingState = "direct";
        unit.fallbackDestination = undefined;
        unit.stuckTimer = 0;
        this.aiTimer = 0;
      }
      return;
    }
    if (
      unit.faction !== "saxon" ||
      unit.pathingState !== "direct" ||
      unit.state === "routing" ||
      unit.order.type !== "move" ||
      !unit.order.destination ||
      Math.hypot(
        unit.order.destination.x - unit.position.x,
        unit.order.destination.y - unit.position.y,
      ) <= 12
    ) {
      unit.stuckTimer = 0;
      return;
    }

    if (displacement < 0.05 && unit.velocity < 1) {
      unit.stuckTimer += dt;
    } else {
      unit.stuckTimer = 0;
    }
    if (unit.stuckTimer < STUCK_RECOVERY_SECONDS) return;

    const destination = unit.order.destination;
    let awayX = unit.position.x - destination.x;
    let awayY = unit.position.y - destination.y;
    const awayLength = Math.hypot(awayX, awayY);
    if (awayLength < 1) {
      awayX = -Math.cos(unit.facing - Math.PI / 2);
      awayY = -Math.sin(unit.facing - Math.PI / 2);
    } else {
      awayX /= awayLength;
      awayY /= awayLength;
    }
    const side = unit.id.charCodeAt(unit.id.length - 1) % 2 === 0 ? 1 : -1;
    const margin = Math.min(formationRadius(unit) + 12, 140);
    const riverOffset = unit.position.y - this.battlefield.streamY(unit.position.x);
    const nearRiver = Math.abs(riverOffset) <
      STREAM_HALF_WIDTH + formationRadius(unit) + PATH_FALLBACK_DISTANCE;
    const fallbackX = nearRiver
      ? unit.position.x + side * 34
      : unit.position.x + awayX * PATH_FALLBACK_DISTANCE - awayY * side * 34;
    const fallbackY = nearRiver
      ? this.battlefield.streamY(unit.position.x) +
        (riverOffset >= 0 ? 1 : -1) * (STREAM_HALF_WIDTH + formationRadius(unit) + 46)
      : unit.position.y + awayY * PATH_FALLBACK_DISTANCE + awayX * side * 34;
    const candidate = {
      x: clamp(fallbackX, margin, WORLD_WIDTH - margin),
      y: clamp(fallbackY, margin, WORLD_HEIGHT - margin),
    };
    if (this.battlefield.segmentCrossesDeepWater(unit.position, candidate)) {
      candidate.x = unit.position.x;
    }
    unit.fallbackDestination = candidate;
    unit.pathingState = "reorganising";
    unit.pathCrossingX = undefined;
    unit.crossingPhase = undefined;
    unit.crossingOriginBank = undefined;
    unit.formationChangeTimer = PATH_RECOVERY_PAUSE_SECONDS;
    unit.reforming = Math.max(unit.reforming, 0.8);
    unit.order = { type: "hold" };
    unit.velocity = 0;
    unit.stuckTimer = 0;
    unit.cohesion = Math.max(20, unit.cohesion - 3);
  }

  private resolveCombat(dt: number): void {
    for (let i = 0; i < this.units.length; i += 1) {
      const a = this.units[i];
      if (!a || isUnitInactive(a) || a.state === "routing") continue;
      for (let j = i + 1; j < this.units.length; j += 1) {
        const b = this.units[j];
        if (!b || isUnitInactive(b) || b.state === "routing" || a.faction === b.faction) continue;
        const contact = calculateFormationContact(a, b, this.contactScratch);
        if (contact.separation > CHARGE_CONTACT_PADDING) continue;
        this.commitCharge(a, b);
        this.commitCharge(b, a);
        a.inCombat = true;
        b.inCombat = true;
        if (!a.engagedTargetId) a.engagedTargetId = b.id;
        if (!b.engagedTargetId) b.engagedTargetId = a.id;
        const arcAgainstA = damageArc(a, b);
        const arcAgainstB = damageArc(b, a);
        const aExposed = a.formation === "tortoise"
          ? arcAgainstA === "rear"
          : arcAgainstA !== "front";
        const bExposed = b.formation === "tortoise"
          ? arcAgainstB === "rear"
          : arcAgainstB !== "front";
        if (aExposed) {
          a.vulnerableTimer = Math.max(a.vulnerableTimer, 2);
          a.reorientationTargetId = b.id;
        }
        if (bExposed) {
          b.vulnerableTimer = Math.max(b.vulnerableTimer, 2);
          b.reorientationTargetId = a.id;
        }
        if (
          a.formationChangeTimer <= 0 &&
          a.engagementRecoveryTimer <= 0 &&
          a.order.type !== "attack"
        ) a.order = { type: "fight" };
        if (
          b.formationChangeTimer <= 0 &&
          b.engagementRecoveryTimer <= 0 &&
          b.order.type !== "attack"
        ) b.order = { type: "fight" };
        if (a.engagementRecoveryTimer <= 0) a.velocity *= 0.7;
        if (b.engagementRecoveryTimer <= 0) b.velocity *= 0.7;
        a.combatTimer -= dt;
        b.combatTimer -= dt;
        if (a.combatTimer <= 0) {
          a.combatTimer = COMBAT_STRIKE_INTERVAL;
          this.strike(a, b);
        }
        if (b.combatTimer <= 0) {
          b.combatTimer = COMBAT_STRIKE_INTERVAL;
          this.strike(b, a);
        }
      }
    }
  }

  private resolveRangedCombat(dt: number): void {
    for (const attacker of this.units) {
      if (
        attacker.type !== "archers" ||
        isUnitInactive(attacker) ||
        attacker.state === "routing" ||
        attacker.formationChangeTimer > 0 ||
        attacker.ammunition <= 0
      ) {
        continue;
      }
      let target = attacker.order.type === "attack" && attacker.order.targetUnitId
        ? this.findUnit(attacker.order.targetUnitId)
        : undefined;
      if (
        !target ||
        target.faction === attacker.faction ||
        isUnitInactive(target) ||
        target.state === "routing" ||
        distance(attacker.position, target.position) > ARCHER_RANGE
      ) {
        target = nearestEnemy(attacker, this.units);
      }
      if (
        !target ||
        target.state === "routing" ||
        distance(attacker.position, target.position) > ARCHER_RANGE ||
        attacker.velocity > 8 ||
        this.hasEnemyContact(attacker)
      ) {
        attacker.rangedTimer = Math.max(0, attacker.rangedTimer);
        continue;
      }

      attacker.inCombat = true;
      target.inCombat = true;
      attacker.engagedTargetId = target.id;
      attacker.reorientationTargetId = target.id;
      attacker.rangedTimer -= dt;
      if (attacker.rangedTimer > 0) continue;
      attacker.rangedTimer = ARCHER_VOLLEY_INTERVAL;
      attacker.ammunition -= 1;

      const arc = damageArc(target, attacker);
      const casualties = Math.min(
        target.soldierCount,
        estimateRangedCasualties(attacker, target, arc),
      );
      if (casualties > 0) {
        const firstDeadIndex = target.soldierCount - casualties;
        target.soldierCount -= casualties;
        attacker.recentDamageDealt += casualties;
        target.recentDamageTaken += casualties;
        attacker.combatProgressThisFrame = true;
        target.combatProgressThisFrame = true;
        this.recordFallen(target, firstDeadIndex, casualties);
        target.morale -= estimateCombatMoraleLoss(target, casualties, arc) * 0.65;
        target.cohesion -= casualties * 0.72;
      } else {
        target.cohesion = Math.max(0, target.cohesion - 0.15);
      }
      this.effects.push({
        x: target.position.x,
        y: target.position.y,
        sourceX: attacker.position.x,
        sourceY: attacker.position.y,
        life: 1.05,
        amount: casualties,
        ranged: true,
      });
    }
  }

  private updateEngagementRecovery(dt: number): void {
    for (const unit of this.units) {
      if (
        unit.faction !== "saxon" ||
        unit.type === "standard" ||
        unit.state === "routing" ||
        isUnitInactive(unit)
      ) {
        unit.engagementStallTimer = 0;
        continue;
      }
      if (unit.engagementRecoveryTimer > 0) {
        unit.engagementStallTimer = 0;
        continue;
      }

      const stalledContact = unit.inCombat && !unit.combatProgressThisFrame;
      const stalledApproach = !unit.inCombat &&
        unit.aiTargetId !== undefined &&
        (unit.order.type === "fight" || unit.order.type === "attack") &&
        unit.velocity < 2;
      if (stalledContact || stalledApproach) {
        unit.engagementStallTimer += dt;
      } else if (unit.combatProgressThisFrame || unit.velocity >= 2) {
        unit.engagementStallTimer = 0;
      }
      if (unit.engagementStallTimer < ENGAGEMENT_STALL_SECONDS) continue;

      const target = unit.aiTargetId
        ? this.findUnit(unit.aiTargetId)
        : unit.engagedTargetId
          ? this.findUnit(unit.engagedTargetId)
          : undefined;
      unit.engagementStallTimer = 0;
      if (
        !target ||
        target.faction === unit.faction ||
        target.state === "routing" ||
        isUnitInactive(target)
      ) {
        unit.aiTargetId = undefined;
        unit.aiEngagementArc = undefined;
        unit.order = { type: "hold" };
        this.aiTimer = 0;
        continue;
      }

      const side = unit.id.charCodeAt(unit.id.length - 1) % 2 === 0 ? 1 : -1;
      const lateralDistance = Math.max(
        72,
        target.formationWidth * 0.42 + unit.formationDepth * 0.35,
      );
      const recoveryTarget = {
        x: target.position.x + Math.cos(target.facing) * side * lateralDistance,
        y: target.position.y + Math.sin(target.facing) * side * lateralDistance,
      };
      unit.order = {
        type: "move",
        destination: calculateSafeAIDestination(
          unit,
          recoveryTarget,
          this.battlefield,
          undefined,
          unit.pathCrossingX,
        ),
        facing: Math.atan2(
          target.position.y - unit.position.y,
          target.position.x - unit.position.x,
        ) + Math.PI / 2,
      };
      unit.engagedTargetId = undefined;
      unit.aiEngagementArc = undefined;
      unit.reorientationTargetId = target.id;
      unit.engagementRecoveryTimer = 4;
      this.aiTimer = Math.min(this.aiTimer, 0.4);
    }
  }

  private hasEnemyContact(unit: Unit): boolean {
    for (const enemy of this.units) {
      if (
        enemy.faction === unit.faction ||
        enemy.state === "routing" ||
        isUnitInactive(enemy)
      ) {
        continue;
      }
      if (
        calculateFormationContact(unit, enemy, this.contactScratch).separation <=
        CHARGE_CONTACT_PADDING
      ) {
        return true;
      }
    }
    return false;
  }

  private resolveRoutOverruns(dt: number): void {
    for (const routed of this.units) {
      if (routed.state !== "routing") continue;
      if (routed.soldierCount <= 0) {
        this.breakUnit(routed);
        continue;
      }
      let strongestAttacker: Unit | undefined;
      let strongestLosses = 0;
      let contactCount = 0;
      for (const enemy of this.units) {
        if (
          enemy.faction === routed.faction ||
          isUnitInactive(enemy) ||
          enemy.state === "routing"
        ) continue;
        const contact = calculateFormationContact(routed, enemy, this.contactScratch);
        if (contact.separation > CHARGE_CONTACT_PADDING) continue;
        contactCount += 1;
        const losses = estimateRoutedCasualties(enemy, routed, damageArc(routed, enemy));
        if (losses > strongestLosses) {
          strongestLosses = losses;
          strongestAttacker = enemy;
        }
      }
      if (!strongestAttacker) {
        routed.routDamageTimer = 0;
        continue;
      }

      routed.routDamageTimer -= dt;
      if (routed.routDamageTimer > 0) continue;
      routed.routDamageTimer += ROUT_DAMAGE_INTERVAL;
      const casualties = Math.min(
        routed.soldierCount,
        strongestLosses + Math.max(0, contactCount - 1),
      );
      const firstDeadIndex = routed.soldierCount - casualties;
      routed.soldierCount -= casualties;
      strongestAttacker.recentDamageDealt += casualties;
      routed.recentDamageTaken += casualties;
      this.recordFallen(routed, firstDeadIndex, casualties);
      routed.morale = Math.max(0, routed.morale - casualties * 0.35);
      routed.cohesion = 0;
      this.effects.push({
        x: (routed.position.x + strongestAttacker.position.x) * 0.5,
        y: (routed.position.y + strongestAttacker.position.y) * 0.5,
        life: 1.05,
        amount: casualties,
        charge: strongestAttacker.type === "cavalry" || strongestAttacker.chargeBonusTimer > 0,
      });
      if (routed.soldierCount <= 0) this.breakUnit(routed);
    }
  }

  private breakUnit(unit: Unit): void {
    if (isUnitInactive(unit)) return;
    this.scatterBrokenSurvivors(unit);
    unit.soldierCount = 0;
    unit.morale = 0;
    unit.cohesion = 0;
    unit.routWaterStuckTimer = 0;
    unit.routingTimer = 0;
    unit.routingDistanceTravelled = 0;
    unit.routingDirectionX = 0;
    unit.routingDirectionY = 0;
    unit.state = "broken";
    unit.selected = false;
    unit.order = { type: "hold" };
    unit.chargeTargetId = undefined;
    unit.engagedTargetId = undefined;
    this.stats[unit.faction === "roman" ? "romanDestroyed" : "saxonDestroyed"] += 1;
    this.effects.push({
      x: unit.position.x,
      y: unit.position.y,
      life: 1.5,
      label: "BROKEN!",
    });
    this.aiTimer = 0;
  }

  private escapeRoutedUnit(unit: Unit): void {
    if (isUnitInactive(unit)) return;
    unit.state = "escaped";
    unit.selected = false;
    unit.order = { type: "hold" };
    unit.chargeTargetId = undefined;
    unit.engagedTargetId = undefined;
    unit.routingTimer = 0;
    unit.routingDistanceTravelled = 0;
    unit.routingDirectionX = 0;
    unit.routingDirectionY = 0;
    this.stats[unit.faction === "roman" ? "romanRouted" : "saxonRouted"] += 1;
    this.aiTimer = 0;
  }

  private overlapsFriendly(unit: Unit): boolean {
    if (isUnitInactive(unit)) return false;
    for (const friendly of this.units) {
      if (friendly === unit || friendly.faction !== unit.faction || isUnitInactive(friendly)) continue;
      if (calculateFormationContact(unit, friendly, this.contactScratch).separation < -1) return true;
    }
    return false;
  }

  private resolveFormationPenetration(unit: Unit): void {
    let friendlyOverlapCount = 0;
    for (const friendly of this.units) {
      if (
        friendly === unit ||
        friendly.faction !== unit.faction ||
        isUnitInactive(friendly)
      ) {
        continue;
      }
      if (
        calculateFormationContact(unit, friendly, this.contactScratch).separation < 0
      ) {
        friendlyOverlapCount += 1;
      }
    }
    for (let pass = 0; pass < 2; pass += 1) {
      for (const other of this.units) {
        if (other === unit || isUnitInactive(other)) continue;
        if (
          unit.state === "routing" &&
          other.faction !== unit.faction
        ) {
          continue;
        }
        if (
          other.faction === unit.faction &&
          this.canSaxonPassFriendly(unit, other)
        ) {
          continue;
        }
        const contact = calculateFormationContact(unit, other, this.contactScratch);
        const allowedPenetration = other.faction === unit.faction
          ? friendlyOverlapCount > 1
            ? CROWDED_FRIENDLY_MAX_FORMATION_PENETRATION
            : FRIENDLY_MAX_FORMATION_PENETRATION
          : other.state === "routing"
            ? FRIENDLY_MAX_FORMATION_PENETRATION
            : ENEMY_MAX_FORMATION_PENETRATION;
        if (contact.separation >= -allowedPenetration) continue;
        const correction = -allowedPenetration - contact.separation;
        unit.position.x -= contact.normalX * correction;
        unit.position.y -= contact.normalY * correction;
        if (unit.engagementRecoveryTimer <= 0) {
          unit.velocity *= other.faction === unit.faction ? 0.55 : 0.25;
        }
      }
    }
  }

  private canSaxonPassFriendly(unit: Unit, other: Unit): boolean {
    return unit.faction === "saxon" &&
      other.faction === "saxon" &&
      !this.hasEnemyContact(unit) &&
      !this.hasEnemyContact(other);
  }

  private ensureRoutingDirection(unit: Unit): void {
    const existingLength = Math.hypot(
      unit.routingDirectionX,
      unit.routingDirectionY,
    );
    if (existingLength > 0.5) return;

    let directionX = 0;
    let directionY = 0;
    let closest: Unit | undefined;
    let closestDistance = Infinity;
    for (const enemy of this.units) {
      if (
        enemy.faction === unit.faction ||
        enemy.state === "routing" ||
        isUnitInactive(enemy)
      ) {
        continue;
      }
      const dx = unit.position.x - enemy.position.x;
      const dy = unit.position.y - enemy.position.y;
      const enemyDistance = Math.max(1, Math.hypot(dx, dy));
      if (enemyDistance < closestDistance) {
        closest = enemy;
        closestDistance = enemyDistance;
      }
      if (enemyDistance > 460) continue;
      const weight = 1 / Math.max(55, enemyDistance);
      directionX += dx / enemyDistance * weight;
      directionY += dy / enemyDistance * weight;
    }

    let directionLength = Math.hypot(directionX, directionY);
    if (directionLength < 0.0001 && closest) {
      directionX = unit.position.x - closest.position.x;
      directionY = unit.position.y - closest.position.y;
      directionLength = Math.max(1, Math.hypot(directionX, directionY));
      const side = unit.id.charCodeAt(unit.id.length - 1) % 2 === 0 ? 1 : -1;
      const normalX = -directionY / directionLength;
      const normalY = directionX / directionLength;
      directionX += normalX * directionLength * side * 0.35;
      directionY += normalY * directionLength * side * 0.35;
      directionLength = Math.max(1, Math.hypot(directionX, directionY));
    }
    if (directionLength < 0.0001) {
      directionX = -Math.cos(unit.facing - Math.PI / 2);
      directionY = -Math.sin(unit.facing - Math.PI / 2);
      directionLength = 1;
    }
    unit.routingDirectionX = directionX / directionLength;
    unit.routingDirectionY = directionY / directionLength;
  }

  private reorientInCombat(unit: Unit, dt: number): boolean {
    const target = unit.reorientationTargetId
      ? this.findUnit(unit.reorientationTargetId)
      : undefined;
    if (!target || isUnitInactive(target) || target.state === "routing") {
      unit.reorientationTargetId = undefined;
      return false;
    }
    const desiredFacing = Math.atan2(
      target.position.y - unit.position.y,
      target.position.x - unit.position.x,
    ) + Math.PI / 2;
    const turn = angleDelta(unit.facing, desiredFacing);
    if (Math.abs(turn) < 0.03) {
      unit.reorientationTargetId = undefined;
      return false;
    }
    if (unit.formation === "mob") {
      unit.facing = desiredFacing;
    } else {
      const wheelRate = formationWheelRate(unit, unit.movementSpeed * 0.35);
      wheelFormation(unit, clamp(turn, -wheelRate * dt, wheelRate * dt));
    }
    unit.cohesion = Math.max(0, unit.cohesion - Math.abs(turn) * dt * 1.2);
    return true;
  }

  private updateFormationWraps(dt: number): void {
    for (const unit of this.units) {
      const routing = unit.state === "routing";
      const looseFlow = unit.faction === "saxon" && !routing
        ? SAXON_FORMATION_FLOW_CLEARANCE
        : 0;
      const response = Math.min(
        1,
        dt * (unit.faction === "saxon" && !routing ? 3.6 : 4.5),
      );
      const routingStreamSide = routing
        ? unit.position.y >= this.battlefield.streamY(unit.position.x) ? 1 : -1
        : undefined;
      const target = unit.engagedTargetId ? this.findUnit(unit.engagedTargetId) : undefined;
      const cos = Math.cos(unit.facing);
      const sin = Math.sin(unit.facing);
      const usesElasticSpine = !routing &&
        unit.formation !== "mob" &&
        unit.formationSpine.length === FORMATION_SPINE_POINT_COUNT;
      if (usesElasticSpine) {
        this.updateElasticFormationSpine(
          unit,
          target,
          response,
          looseFlow,
          cos,
          sin,
        );
      }
      for (let index = 0; index < unit.soldierCount; index += 1) {
        const soldier = unit.soldiers[index];
        if (!soldier) continue;
        if (usesElasticSpine) {
          const sample = sampleFormationSpine(
            unit.formationSpine,
            soldier.baseX,
            this.spineSampleScratch,
          );
          const desiredLocalX = sample.x + sample.normalX * soldier.baseY;
          const desiredLocalY = sample.y + sample.normalY * soldier.baseY;
          soldier.targetX += (desiredLocalX - soldier.targetX) * response;
          soldier.targetY += (desiredLocalY - soldier.targetY) * response;
          continue;
        }
        const wrap = target && unit.formation !== "column" && unit.formation !== "mob"
          ? calculateFormationWrapOffset(unit, target, soldier.baseX)
          : { lateral: 0, advance: 0 };
        const desiredLocalX = soldier.baseX + wrap.lateral;
        const desiredLocalY = soldier.baseY - wrap.advance;
        const desiredWorldX = unit.position.x + desiredLocalX * cos - desiredLocalY * sin;
        const desiredWorldY = unit.position.y + desiredLocalX * sin + desiredLocalY * cos;
        const constrained = constrainFormationWorldPoint(
          desiredWorldX,
          desiredWorldY,
          this.battlefield,
          this.terrainPointScratch,
          looseFlow,
          routingStreamSide,
        );
        const offsetX = constrained.x - unit.position.x;
        const offsetY = constrained.y - unit.position.y;
        const constrainedLocalX = offsetX * cos + offsetY * sin;
        const constrainedLocalY = -offsetX * sin + offsetY * cos;
        soldier.targetX += (constrainedLocalX - soldier.targetX) * response;
        soldier.targetY += (constrainedLocalY - soldier.targetY) * response;
      }
    }
  }

  private updateElasticFormationSpine(
    unit: Unit,
    target: Unit | undefined,
    response: number,
    looseFlow: number,
    cos: number,
    sin: number,
  ): void {
    const elasticity = unit.formation === "tortoise"
      ? 0.7
      : unit.formation === "shieldwall"
        ? 0.78
        : unit.formation === "column"
          ? 0.82
          : unit.faction === "saxon" ? 1 : 0.9;
    const depthClearance = formationHalfDepth(unit) * 0.82 + looseFlow;
    for (let index = 0; index < FORMATION_SPINE_POINT_COUNT; index += 1) {
      const point = unit.formationSpine[index];
      if (!point) continue;
      const wrap = target && unit.formation !== "column"
        ? calculateFormationWrapOffset(unit, target, point.baseX)
        : { lateral: 0, advance: 0 };
      const desiredLocalX = point.baseX + wrap.lateral;
      const desiredLocalY = -wrap.advance;
      const desiredWorldX =
        unit.position.x + desiredLocalX * cos - desiredLocalY * sin;
      const desiredWorldY =
        unit.position.y + desiredLocalX * sin + desiredLocalY * cos;
      const constrained = constrainFormationWorldPoint(
        desiredWorldX,
        desiredWorldY,
        this.battlefield,
        this.terrainPointScratch,
        depthClearance,
      );
      const offsetX = constrained.x - unit.position.x;
      const offsetY = constrained.y - unit.position.y;
      const constrainedLocalX = offsetX * cos + offsetY * sin;
      const constrainedLocalY = -offsetX * sin + offsetY * cos;
      this.spineOffsetXScratch[index] = clamp(
        (constrainedLocalX - point.baseX) * elasticity,
        -MAX_SPINE_LATERAL_BEND,
        MAX_SPINE_LATERAL_BEND,
      );
      this.spineOffsetYScratch[index] = clamp(
        constrainedLocalY * elasticity,
        -MAX_SPINE_DEPTH_BEND,
        MAX_SPINE_DEPTH_BEND,
      );
    }

    for (let index = 0; index < FORMATION_SPINE_POINT_COUNT; index += 1) {
      const point = unit.formationSpine[index];
      if (!point) continue;
      const ownX = this.spineOffsetXScratch[index] ?? 0;
      const ownY = this.spineOffsetYScratch[index] ?? 0;
      const previousX = this.spineOffsetXScratch[Math.max(0, index - 1)] ?? ownX;
      const previousY = this.spineOffsetYScratch[Math.max(0, index - 1)] ?? ownY;
      const nextX = this.spineOffsetXScratch[
        Math.min(FORMATION_SPINE_POINT_COUNT - 1, index + 1)
      ] ?? ownX;
      const nextY = this.spineOffsetYScratch[
        Math.min(FORMATION_SPINE_POINT_COUNT - 1, index + 1)
      ] ?? ownY;
      const neighbourWeight = index === 0 ||
        index === FORMATION_SPINE_POINT_COUNT - 1 ? 0.22 : 0.3;
      const ownWeight = 1 - neighbourWeight * 2;
      point.targetX = point.baseX +
        ownX * ownWeight + (previousX + nextX) * neighbourWeight;
      point.targetY =
        ownY * ownWeight + (previousY + nextY) * neighbourWeight;
      point.x += (point.targetX - point.x) * response;
      point.y += (point.targetY - point.y) * response;
    }

    for (let index = 1; index < FORMATION_SPINE_POINT_COUNT; index += 1) {
      const previous = unit.formationSpine[index - 1];
      const point = unit.formationSpine[index];
      if (!previous || !point) continue;
      point.x = Math.max(previous.x + 6, point.x);
      point.y = clamp(point.y, previous.y - 72, previous.y + 72);
    }
  }

  private findUnit(id: string): Unit | undefined {
    for (const unit of this.units) {
      if (unit.id === id) return unit;
    }
    return undefined;
  }

  private strike(attacker: Unit, defender: Unit): void {
    if (defender.soldierCount <= 0) return;
    const arc = damageArc(defender, attacker);
    const charged = attacker.chargeBonusTimer > 0;
    const casualties = Math.min(defender.soldierCount, estimateCasualties(attacker, defender, arc));
    if (casualties <= 0) {
      attacker.cohesion = Math.max(0, attacker.cohesion - 0.2);
      return;
    }
    const firstDeadIndex = defender.soldierCount - casualties;
    defender.soldierCount -= casualties;
    attacker.recentDamageDealt += casualties;
    defender.recentDamageTaken += casualties;
    attacker.combatProgressThisFrame = true;
    defender.combatProgressThisFrame = true;
    this.recordFallen(defender, firstDeadIndex, casualties);
    defender.morale -= estimateCombatMoraleLoss(defender, casualties, arc);
    defender.cohesion -= casualties * 1.05 + (arc === "rear" ? 4 : arc === "flank" ? 2 : 0);
    attacker.cohesion -= 0.8;
    this.effects.push({
      x: (attacker.position.x + defender.position.x) / 2,
      y: (attacker.position.y + defender.position.y) / 2,
      life: 1.05,
      amount: casualties,
      charge: charged,
    });
  }

  private updateChargeApproach(unit: Unit): void {
    if (unit.chargeTargetId) {
      const target = this.findUnit(unit.chargeTargetId);
      if (
        !target ||
        isUnitInactive(target) ||
        target.state === "routing" ||
        calculateFormationContact(unit, target, this.contactScratch).separation > CHARGE_APPROACH_RANGE * 1.5
      ) {
        unit.chargeTargetId = undefined;
      }
      return;
    }
    if (
      !unit.chargeReady ||
      unit.order.type !== "move" ||
      unit.state === "routing" ||
      unit.formation === "mob"
    ) return;

    const forward = unit.facing - Math.PI / 2;
    const forwardX = Math.cos(forward);
    const forwardY = Math.sin(forward);
    let target: Unit | undefined;
    let targetGap = CHARGE_APPROACH_RANGE;
    for (const candidate of this.units) {
      if (candidate.faction === unit.faction || isUnitInactive(candidate) || candidate.state === "routing") continue;
      const contact = calculateFormationContact(unit, candidate, this.contactScratch);
      if (contact.separation < -CHARGE_CONTACT_PADDING || contact.separation > targetGap) continue;
      const dx = candidate.position.x - unit.position.x;
      const dy = candidate.position.y - unit.position.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      if ((dx * forwardX + dy * forwardY) / length < 0.55) continue;
      target = candidate;
      targetGap = contact.separation;
    }
    if (target) {
      unit.chargeReady = false;
      unit.chargeTargetId = target.id;
    }
  }

  private commitCharge(attacker: Unit, defender: Unit): void {
    if (attacker.chargeTargetId !== defender.id) return;
    attacker.chargeTargetId = undefined;
    attacker.chargeBonusTimer = CHARGE_DURATION;
  }

  private updateTacticalStates(dt: number): void {
    for (const unit of this.units) {
      if (isUnitInactive(unit)) continue;
      unit.vulnerableTimer = Math.max(0, unit.vulnerableTimer - dt);
      unit.passingFriendly = this.overlapsFriendly(unit);

      let nextState: TacticalState;
      if (unit.state === "routing") {
        nextState = "routing";
      } else if (
        unit.passingFriendly ||
        unit.pathingState !== "direct" ||
        unit.vulnerableTimer > 0 ||
        unit.formation === "mob" ||
        unit.terrain === "woods" ||
        unit.terrain === "rough" ||
        unit.terrain === "shallow water" ||
        unit.terrain === "deep water"
      ) {
        nextState = "vulnerable";
      } else if (
        unit.formation === "shieldwall" ||
        unit.formation === "tortoise" ||
        unit.stationaryTimer >= 5 ||
        (unit.tacticalState === "prepared" && unit.stationaryTimer > 0)
      ) {
        nextState = "prepared";
      } else {
        nextState = "standard";
      }

      if (
        unit.inCombat &&
        tacticalStateRank(nextState) > tacticalStateRank(unit.tacticalState)
      ) {
        continue;
      }
      unit.tacticalState = nextState;
    }
  }

  private updateBattleStandards(): void {
    for (const standard of this.standards) {
      if (standard.status === "escaped") continue;
      const bearer = standard.bearerUnitId
        ? this.findUnit(standard.bearerUnitId)
        : undefined;
      if (standard.status === "unit" || standard.status === "captured") {
        if (!bearer || bearer.soldierCount <= 0) {
          if (bearer) {
            standard.position.x = bearer.position.x;
            standard.position.y = bearer.position.y;
          }
          standard.status = "dropped";
          standard.bearerUnitId = undefined;
        } else if (bearer.state === "escaped") {
          standard.status = "escaped";
          standard.bearerUnitId = undefined;
          continue;
        } else {
          standard.position.x = bearer.position.x;
          standard.position.y = bearer.position.y;
        }
      }
      if (standard.status !== "dropped") continue;
      for (const unit of this.units) {
        if (
          unit.faction === standard.faction ||
          unit.type !== "infantry" ||
          isUnitInactive(unit) ||
          unit.state === "routing" ||
          unit.soldierCount <= 0 ||
          !this.unitTouchesStandard(unit, standard.position)
        ) continue;
        standard.status = "captured";
        standard.bearerUnitId = unit.id;
        standard.position.x = unit.position.x;
        standard.position.y = unit.position.y;
        break;
      }
    }
  }

  private updateBattleOutcome(): void {
    if (this.stats.outcome !== "ongoing") return;
    let romansRemain = false;
    let saxonsRemain = false;
    for (const unit of this.units) {
      if (isUnitInactive(unit) || unit.type === "standard" || unit.soldierCount <= 0) {
        continue;
      }
      if (unit.faction === "roman") romansRemain = true;
      else saxonsRemain = true;
    }
    if (romansRemain && saxonsRemain) return;

    this.stats.outcome = romansRemain
      ? "romanVictory"
      : saxonsRemain ? "saxonVictory" : "mutualDestruction";
    if (!romansRemain) this.withdrawStandards("roman");
    if (!saxonsRemain) this.withdrawStandards("saxon");
  }

  private withdrawStandards(faction: Faction): void {
    for (const standard of this.standards) {
      if (standard.faction !== faction || standard.status !== "unit") continue;
      const bearer = standard.bearerUnitId
        ? this.findUnit(standard.bearerUnitId)
        : undefined;
      if (bearer) {
        standard.position.x = bearer.position.x;
        standard.position.y = bearer.position.y;
      }
      standard.status = "dropped";
      standard.bearerUnitId = undefined;
    }
    for (const unit of this.units) {
      if (unit.faction !== faction || unit.type !== "standard" || isUnitInactive(unit)) {
        continue;
      }
      unit.state = "escaped";
      unit.selected = false;
      unit.order = { type: "hold" };
      unit.velocity = 0;
    }
  }

  private unitTouchesStandard(unit: Unit, position: Vec2): boolean {
    const radiusSquared = STANDARD_PICKUP_RADIUS * STANDARD_PICKUP_RADIUS;
    const cos = Math.cos(unit.facing);
    const sin = Math.sin(unit.facing);
    for (let index = 0; index < unit.soldierCount; index += 1) {
      const soldier = unit.soldiers[index];
      if (!soldier) continue;
      const worldX = unit.position.x + soldier.baseX * cos - soldier.baseY * sin;
      const worldY = unit.position.y + soldier.baseX * sin + soldier.baseY * cos;
      const dx = worldX - position.x;
      const dy = worldY - position.y;
      if (dx * dx + dy * dy <= radiusSquared) return true;
    }
    return false;
  }

  private updateMorale(dt: number): void {
    for (const unit of this.units) {
      if (isUnitInactive(unit)) continue;
      unit.standardMoraleBoost = false;
      if (unit.soldierCount <= 0) unit.morale = 0;
      const ambientLossMultiplier = unit.state === "routing"
        ? MORALE_LOSS_MULTIPLIER * 0.5
        : MORALE_LOSS_MULTIPLIER;
      const threat = nearestEnemy(unit, this.units);
      if (threat && distance(unit.position, threat.position) < 220 && threat.soldierCount > unit.soldierCount * 1.6) {
        unit.morale -= dt * 1.2 * ambientLossMultiplier;
      }
      const friendlyRouting = this.units.some((other) =>
        other !== unit && other.faction === unit.faction && other.state === "routing" &&
        distance(unit.position, other.position) < 210);
      if (friendlyRouting) unit.morale -= dt * 0.7 * ambientLossMultiplier;
      const bodyCounts = this.countBodiesNear(unit.position, unit.faction);
      if (
        bodyCounts.total >= BODY_TERRAIN_THRESHOLD &&
        bodyCounts.friendly >= FRIENDLY_BODY_MORALE_THRESHOLD
      ) {
        unit.morale -= dt * Math.min(2.2, 0.6 + bodyCounts.friendly * 0.06) *
          ambientLossMultiplier;
      }
      if (unit.state !== "routing") {
        for (const standard of this.standards) {
          if (
            standard.status !== "unit" ||
            standard.faction !== unit.faction ||
            calculateStandardAuraCoverage(unit, standard.position) < STANDARD_AURA_COVERAGE
          ) continue;
          unit.standardMoraleBoost = true;
          unit.morale += dt * STANDARD_MORALE_RECOVERY_PER_SECOND;
          break;
        }
      }
      unit.morale = clamp(unit.morale, 0, 100);
      if (unit.state === "routing") {
        unit.routingTimer += dt;
      } else {
        unit.routingTimer = 0;
      }
      if (
        unit.morale <= 0 ||
        (unit.state === "routing" &&
          unit.routingTimer >= BROKEN_AFTER_ROUTING_SECONDS)
      ) {
        if (unit.morale <= 0) {
          this.breakUnit(unit);
        } else {
          const threat = nearestEnemy(unit, this.units);
          const escapedCleanly = unit.routingDistanceTravelled >=
              ROUT_ESCAPE_PROGRESS_DISTANCE &&
            unit.routWaterStuckTimer < ROUT_WATER_FAILURE_SECONDS &&
            (!threat || distance(unit.position, threat.position) > 180);
          if (escapedCleanly) this.escapeRoutedUnit(unit);
          else this.breakUnit(unit);
        }
        continue;
      }
      if (unit.morale <= ROUT_MORALE_THRESHOLD && unit.state !== "routing") {
        unit.state = "routing";
        unit.routingTimer = 0;
        unit.routingDistanceTravelled = 0;
        unit.routingDirectionX = 0;
        unit.routingDirectionY = 0;
        this.ensureRoutingDirection(unit);
        unit.pathingState = "direct";
        unit.stuckTimer = 0;
        unit.fallbackDestination = undefined;
        unit.pathCrossingX = undefined;
        unit.crossingLaneCommitted = false;
        unit.crossingPhase = undefined;
        unit.crossingOriginBank = undefined;
        unit.aiTargetId = undefined;
        unit.aiEngagementArc = undefined;
        unit.engagementStallTimer = 0;
        unit.engagementRecoveryTimer = 0;
        unit.order = { type: "move" };
        unit.formationChangeTimer = 0;
        unit.aboutFacePending = false;
        unit.chargeTargetId = undefined;
        unit.engagedTargetId = undefined;
        unit.reorientationTargetId = undefined;
        unit.velocity = Math.max(0, unit.velocity);
        unit.cohesion = Math.min(unit.cohesion, 24);
      } else if (unit.morale < 48 && unit.state === "steady") {
        unit.state = "shaken";
      } else if (unit.morale >= 55 && unit.state === "shaken") {
        unit.state = "steady";
      }
      if (unit.order.type === "rally" && unit.state === "routing") {
        const nearest = nearestEnemy(unit, this.units);
        if (!nearest || distance(unit.position, nearest.position) > 310) {
          unit.morale = Math.min(58, unit.morale + dt * 7);
          if (unit.morale >= 46) {
            unit.state = "shaken";
            unit.routingTimer = 0;
            unit.routingDistanceTravelled = 0;
            unit.routingDirectionX = 0;
            unit.routingDirectionY = 0;
            unit.order = { type: "hold" };
          }
        }
      }
    }
  }

  private selectSaxonTarget(
    unit: Unit,
    targetLoads: ReadonlyMap<string, number>,
    slotUsage: ReadonlyMap<string, EngagementSlotUsage>,
  ): Unit | undefined {
    let hasFightingTarget = false;
    for (const candidate of this.units) {
      if (
        candidate.faction !== unit.faction &&
        candidate.type !== "standard" &&
        !isUnitInactive(candidate)
      ) {
        hasFightingTarget = true;
        break;
      }
    }

    let best: Unit | undefined;
    let bestScore = Infinity;
    for (const candidate of this.units) {
      if (
        candidate.faction === unit.faction ||
        isUnitInactive(candidate) ||
        (hasFightingTarget && candidate.type === "standard")
      ) continue;
      const usage = slotUsage.get(candidate.id);
      const needsMeleeSlot = unit.type !== "archers" || unit.ammunition <= 0;
      if (
        needsMeleeSlot &&
        usage &&
        !hasOpenEngagementSlot(unit, candidate, usage)
      ) continue;
      const d = distance(unit.position, candidate.position);
      let score = d + (targetLoads.get(candidate.id) ?? 0) * 185;
      if (candidate.id === unit.aiTargetId) score -= SAXON_TARGET_STICKINESS;
      if (candidate.inCombat) score += 55;
      if (unit.type === "cavalry") {
        if (candidate.state === "routing") score -= 420;
        if (candidate.type === "archers" || candidate.type === "skirmishers") score -= 85;
        const arc = damageArc(candidate, unit);
        if (arc === "rear") score -= 120;
        else if (arc === "flank") score -= 75;
      } else if (candidate.state === "routing") {
        score += 95;
      }
      if (unit.type === "archers") {
        score += Math.abs(d - ARCHER_PREFERRED_RANGE) * 0.18;
      }
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  }

  private updateAI(): void {
    const crossingLoads = new Uint8Array(WATER_CROSSINGS.length);
    const targetLoads = new Map<string, number>();
    const slotUsage = new Map<string, EngagementSlotUsage>();
    const usageFor = (targetId: string): EngagementSlotUsage => {
      let usage = slotUsage.get(targetId);
      if (!usage) {
        usage = createEngagementSlotUsage();
        slotUsage.set(targetId, usage);
      }
      return usage;
    };
    const crossingWaveReleased = this.updateSaxonCrossingWave();
    for (const unit of this.units) {
      if (
        unit.faction !== "saxon" ||
        unit.type === "standard" ||
        unit.state === "routing" ||
        isUnitInactive(unit) ||
        !unit.aiTargetId ||
        !unit.aiEngagementArc
      ) continue;
      const target = this.findUnit(unit.aiTargetId);
      if (!target || isUnitInactive(target) || target.state === "routing") continue;
      usageFor(target.id)[unit.aiEngagementArc] += 1;
    }
    for (const unit of this.units) {
      if (unit.faction !== "saxon" || isUnitInactive(unit)) continue;
      if (
        unit.formationChangeTimer > 0 ||
        unit.pathingState !== "direct" ||
        unit.engagementRecoveryTimer > 0
      ) continue;
      if (unit.type === "standard") {
        this.updateSaxonStandardOrder(unit);
        continue;
      }
      if (!crossingWaveReleased && this.stageSaxonCrossing(unit)) continue;
      const previousTargetId = unit.aiTargetId;
      const previousEngagementArc = unit.aiEngagementArc;
      if (unit.aiTargetId && unit.aiEngagementArc) {
        const previousUsage = slotUsage.get(unit.aiTargetId);
        if (previousUsage) {
          previousUsage[unit.aiEngagementArc] = Math.max(
            0,
            previousUsage[unit.aiEngagementArc] - 1,
          );
        }
      }
      const target = this.selectSaxonTarget(unit, targetLoads, slotUsage);
      if (!target) {
        unit.aiTargetId = undefined;
        unit.aiEngagementArc = undefined;
        continue;
      }
      const targetLoad = targetLoads.get(target.id) ?? 0;
      targetLoads.set(target.id, targetLoad + 1);
      unit.aiTargetId = target.id;
      const d = distance(unit.position, target.position);
      if (unit.state === "routing") {
        unit.aiTargetId = undefined;
        unit.aiEngagementArc = undefined;
        if (d > 330) unit.order = { type: "rally" };
        continue;
      }
      if (unit.state === "shaken" && unit.morale < 34) {
        unit.aiTargetId = undefined;
        unit.aiEngagementArc = undefined;
        unit.order = { type: "hold" };
        continue;
      }
      if (
        unit.type === "archers" &&
        unit.ammunition > 0 &&
        d <= ARCHER_PREFERRED_RANGE
      ) {
        unit.aiEngagementArc = undefined;
        unit.order = { type: "attack", targetUnitId: target.id };
        unit.reorientationTargetId = target.id;
        continue;
      }
      let targetPosition: Vec2;
      if (unit.type === "archers" && unit.ammunition > 0) {
        unit.aiEngagementArc = undefined;
        targetPosition = { ...target.position };
      } else {
        const usage = usageFor(target.id);
        const slot = selectEngagementSlot(
          unit,
          target,
          usage,
          previousTargetId === target.id ? previousEngagementArc : undefined,
        );
        if (!slot) {
          unit.aiEngagementArc = undefined;
          unit.order = { type: "hold" };
          continue;
        }
        usage[slot.arc] += 1;
        unit.aiEngagementArc = slot.arc;
        targetPosition = slot.position;
      }
      const crossesDeepWater = this.battlefield.segmentCrossesDeepWater(unit.position, targetPosition);
      let safeDestination = calculateSafeAIDestination(
        unit,
        targetPosition,
        this.battlefield,
        crossingLoads,
        unit.pathCrossingX,
      );
      const crossingRequired = crossesDeepWater || (
        unit.pathCrossingX !== undefined &&
        Math.abs(safeDestination.x - unit.pathCrossingX) < 1
      );
      const crossingWaypoint = WATER_CROSSINGS.find((crossing) =>
        Math.abs(safeDestination.x - crossing.x) < 1
      );
      const crossingX = crossingWaypoint?.x ?? unit.pathCrossingX;
      if (crossingRequired && crossingX !== undefined) {
        const currentBank = unit.position.y >=
            this.battlefield.streamY(unit.position.x)
          ? 1
          : -1;
        if (unit.crossingPhase === undefined) {
          unit.crossingPhase = "approach";
          unit.crossingOriginBank = currentBank;
        }
        unit.pathCrossingX = crossingX;
        for (let index = 0; index < WATER_CROSSINGS.length; index += 1) {
          const crossing = WATER_CROSSINGS[index];
          if (crossing && Math.abs(crossingX - crossing.x) < 1) {
            crossingLoads[index] = (crossingLoads[index] ?? 0) + 1;
            break;
          }
        }

        const originBank = unit.crossingOriginBank ?? currentBank;
        const crossingClearance =
          STREAM_HALF_WIDTH + formationRadius(unit) + 18;
        const crossingLaneX = crossingX + unit.crossingLaneOffset;
        const approach = {
          x: crossingLaneX,
          y: this.battlefield.streamY(crossingLaneX) +
            originBank * crossingClearance,
        };
        const riverClearance = Math.abs(
          unit.position.y - this.battlefield.streamY(unit.position.x),
        );
        if (
          currentBank !== originBank
        ) {
          unit.crossingPhase = "clearing";
        } else if (
          Math.abs(unit.position.x - crossingX) <= 30 &&
          riverClearance <= crossingClearance + 8
        ) {
          unit.crossingPhase = "crossing";
        } else {
          unit.crossingPhase = "approach";
        }
        if (unit.crossingPhase === "approach") safeDestination = approach;
      } else {
        unit.pathCrossingX = undefined;
        unit.crossingLaneCommitted = false;
        unit.crossingPhase = undefined;
        unit.crossingOriginBank = undefined;
      }
      const targetBank = targetPosition.y >= this.battlefield.streamY(targetPosition.x) ? 1 : -1;
      unit.order = {
        type: "move",
        destination: safeDestination,
        facing: crossingRequired
          ? targetBank > 0 ? Math.PI : 0
          : Math.atan2(
            target.position.y - unit.position.y,
            target.position.x - unit.position.x,
          ) + Math.PI / 2,
      };
    }
  }

  private updateSaxonCrossingWave(): boolean {
    if (this.saxonCrossingWaveReleased) return true;
    let eligible = 0;
    for (const unit of this.units) {
      const crossingX = saxonGroupCrossingX(unit);
      if (
        crossingX === undefined ||
        unit.type === "standard" ||
        unit.state === "routing" ||
        isUnitInactive(unit)
      ) continue;
      eligible += 1;
    }
    // Small test/skirmish scenarios should retain ordinary independent AI.
    if (eligible < 4) {
      this.saxonCrossingWaveReleased = true;
      return true;
    }

    this.saxonCrossingWaveWait += 2;
    let ready = 0;
    for (const unit of this.units) {
      const crossingX = saxonGroupCrossingX(unit);
      if (
        crossingX === undefined ||
        unit.type === "standard" ||
        unit.state === "routing" ||
        isUnitInactive(unit)
      ) continue;
      const currentBank = unit.position.y >=
          this.battlefield.streamY(unit.position.x)
        ? 1
        : -1;
      const originBank = unit.crossingOriginBank ?? currentBank;
      unit.crossingOriginBank = originBank;
      unit.pathCrossingX = crossingX;
      unit.crossingLaneCommitted = true;
      unit.crossingPhase = "approach";
      const laneX = crossingX + unit.crossingLaneOffset;
      const clearance = STREAM_HALF_WIDTH + formationRadius(unit) + 18;
      const approachY =
        this.battlefield.streamY(laneX) + originBank * clearance;
      if (
        unit.inCombat ||
        currentBank !== originBank ||
        Math.hypot(
          unit.position.x - laneX,
          unit.position.y - approachY,
        ) <= SAXON_CROSSING_READY_DISTANCE
      ) {
        ready += 1;
      }
    }
    if (
      eligible === 0 ||
      ready === eligible ||
      this.saxonCrossingWaveWait >= SAXON_CROSSING_MAX_WAIT_SECONDS
    ) {
      this.saxonCrossingWaveReleased = true;
    }
    return this.saxonCrossingWaveReleased;
  }

  private stageSaxonCrossing(unit: Unit): boolean {
    const crossingX = saxonGroupCrossingX(unit);
    if (crossingX === undefined || unit.state === "routing") return false;
    const originBank = unit.crossingOriginBank ?? (
      unit.position.y >= this.battlefield.streamY(unit.position.x) ? 1 : -1
    );
    unit.crossingOriginBank = originBank;
    unit.pathCrossingX = crossingX;
    unit.crossingLaneCommitted = true;
    unit.crossingPhase = "approach";
    unit.aiTargetId = undefined;
    unit.aiEngagementArc = undefined;
    const laneX = crossingX + unit.crossingLaneOffset;
    const approachY = this.battlefield.streamY(laneX) +
      originBank * (STREAM_HALF_WIDTH + formationRadius(unit) + 18);
    const approach = { x: laneX, y: approachY };
    if (distance(unit.position, approach) <= SAXON_CROSSING_READY_DISTANCE) {
      unit.order = { type: "hold" };
    } else {
      unit.order = {
        type: "move",
        destination: approach,
        facing: originBank < 0 ? Math.PI : 0,
      };
    }
    return true;
  }

  private updateSaxonStandardOrder(unit: Unit): void {
    unit.chargeTargetId = undefined;
    unit.aiTargetId = undefined;
    unit.aiEngagementArc = undefined;
    let count = 0;
    let centreX = 0;
    let centreY = 0;
    for (const friendly of this.units) {
      if (
        friendly.faction !== "saxon" ||
        friendly.type === "standard" ||
        friendly.state === "routing" ||
        isUnitInactive(friendly)
      ) {
        continue;
      }
      centreX += friendly.position.x;
      centreY += friendly.position.y;
      count += 1;
    }
    if (count === 0) {
      unit.order = { type: "hold" };
      return;
    }
    centreX /= count;
    centreY /= count;
    const threat = nearestEnemy(unit, this.units);
    if (threat) {
      const awayX = centreX - threat.position.x;
      const awayY = centreY - threat.position.y;
      const awayLength = Math.max(1, Math.hypot(awayX, awayY));
      const safetyOffset = distance(unit.position, threat.position) < 240
        ? 180
        : 145;
      centreX += awayX / awayLength * safetyOffset;
      centreY += awayY / awayLength * safetyOffset;
    }
    const target = {
      x: clamp(centreX, 150, WORLD_WIDTH - 150),
      y: clamp(centreY, 150, WORLD_HEIGHT - 150),
    };
    if (distance(unit.position, target) < 55) {
      unit.order = { type: "hold" };
      return;
    }
    const destination = calculateSafeAIDestination(
      unit,
      target,
      this.battlefield,
      undefined,
      unit.pathCrossingX,
    );
    unit.order = {
      type: "move",
      destination,
      facing: Math.atan2(
        centreY - unit.position.y,
        centreX - unit.position.x,
      ) + Math.PI / 2,
    };
  }

  private recordFallen(unit: Unit, firstDeadIndex: number, casualties: number): void {
    const cos = Math.cos(unit.facing);
    const sin = Math.sin(unit.facing);
    for (let offset = 0; offset < casualties; offset += 1) {
      const soldier = unit.soldiers[fallenSoldierVisualIndex(
        unit,
        firstDeadIndex,
        offset,
        casualties,
      )];
      if (!soldier) continue;
      const jitterX = Math.sin(soldier.phase * 2.7) * 2.5;
      const jitterY = Math.cos(soldier.phase * 3.1) * 2.5;
      const localX = soldier.x + jitterX;
      const localY = soldier.y + jitterY;
      const worldX = unit.position.x + localX * cos - localY * sin;
      const worldY = unit.position.y + localX * sin + localY * cos;
      this.bodies.push({
        x: worldX,
        y: worldY,
        facing: unit.facing + Math.sin(soldier.phase) * 0.45,
        faction: unit.faction,
        phase: soldier.phase,
      });
      this.discardedEquipment.push({
        x: worldX + Math.cos(soldier.phase) * 3,
        y: worldY + Math.sin(soldier.phase) * 3,
        rotation: soldier.phase,
        faction: unit.faction,
        kind: (firstDeadIndex + offset) % 2 === 0 ? "shield" : "weapon",
      });
    }
  }

  private countBodiesNear(position: Vec2, faction: Faction): { total: number; friendly: number } {
    this.bodyCountScratch.total = 0;
    this.bodyCountScratch.friendly = 0;
    const radiusSquared = BODY_TERRAIN_RADIUS * BODY_TERRAIN_RADIUS;
    for (const body of this.bodies) {
      const dx = body.x - position.x;
      const dy = body.y - position.y;
      if (dx * dx + dy * dy > radiusSquared) continue;
      this.bodyCountScratch.total += 1;
      if (body.faction === faction) this.bodyCountScratch.friendly += 1;
    }
    return this.bodyCountScratch;
  }

  private hasDifficultBodyTerrain(position: Vec2): boolean {
    let nearby = 0;
    const radiusSquared = BODY_TERRAIN_RADIUS * BODY_TERRAIN_RADIUS;
    for (const body of this.bodies) {
      const dx = body.x - position.x;
      const dy = body.y - position.y;
      if (dx * dx + dy * dy > radiusSquared) continue;
      nearby += 1;
      if (nearby >= BODY_TERRAIN_THRESHOLD) return true;
    }
    return false;
  }
}
