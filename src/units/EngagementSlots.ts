import { distance, type Vec2 } from "../core/math";
import {
  formationHalfDepth,
  formationHalfWidth,
} from "./FormationContact";
import type { EngagementArc, Unit } from "./types";

export interface EngagementSlotUsage {
  front: number;
  left: number;
  right: number;
  rear: number;
}

export interface EngagementSlot {
  arc: EngagementArc;
  index: number;
  capacity: number;
  position: Vec2;
}

const ARC_ORDER: readonly EngagementArc[] = [
  "front",
  "left",
  "right",
  "rear",
];
const CONTACT_GAP = 4;

export function createEngagementSlotUsage(): EngagementSlotUsage {
  return { front: 0, left: 0, right: 0, rear: 0 };
}

function faceLength(target: Unit, arc: EngagementArc): number {
  return arc === "front" || arc === "rear"
    ? formationHalfWidth(target) * 2
    : formationHalfDepth(target) * 2;
}

/**
 * Broad faces can accept two relatively narrow attackers. A formation always
 * has at least one usable slot per face, while the cap keeps the AI from
 * packing arbitrarily many units into one frontage.
 */
export function engagementSlotCapacity(
  attacker: Unit,
  target: Unit,
  arc: EngagementArc,
): number {
  const attackerFrontage = Math.max(64, formationHalfWidth(attacker) * 1.5);
  return Math.max(1, Math.min(2, Math.floor(
    (faceLength(target, arc) + 18) / attackerFrontage,
  )));
}

export function calculateEngagementSlotPosition(
  attacker: Unit,
  target: Unit,
  arc: EngagementArc,
  index: number,
  capacity = engagementSlotCapacity(attacker, target, arc),
): Vec2 {
  const sideX = Math.cos(target.facing);
  const sideY = Math.sin(target.facing);
  const forwardX = sideY;
  const forwardY = -sideX;
  const targetHalfWidth = formationHalfWidth(target);
  const targetHalfDepth = formationHalfDepth(target);
  const attackerHalfDepth = formationHalfDepth(attacker);
  const length = faceLength(target, arc);
  const offset = capacity <= 1
    ? 0
    : ((index + 0.5) / capacity - 0.5) * length * 0.7;

  if (arc === "front" || arc === "rear") {
    const direction = arc === "front" ? 1 : -1;
    const distanceFromCentre =
      targetHalfDepth + attackerHalfDepth + CONTACT_GAP;
    return {
      x: target.position.x +
        forwardX * direction * distanceFromCentre +
        sideX * offset,
      y: target.position.y +
        forwardY * direction * distanceFromCentre +
        sideY * offset,
    };
  }

  const direction = arc === "right" ? 1 : -1;
  const distanceFromCentre =
    targetHalfWidth + attackerHalfDepth + CONTACT_GAP;
  return {
    x: target.position.x +
      sideX * direction * distanceFromCentre +
      forwardX * offset,
    y: target.position.y +
      sideY * direction * distanceFromCentre +
      forwardY * offset,
  };
}

function tacticalBias(
  attacker: Unit,
  target: Unit,
  arc: EngagementArc,
): number {
  if (attacker.type === "cavalry") {
    if (arc === "front") return 170;
    if (arc === "rear") return -35;
    return 0;
  }
  if (target.inCombat) {
    if (arc === "front") return 45;
    if (arc === "rear") return 55;
    return 0;
  }
  if (arc === "front") return 0;
  if (arc === "rear") return 110;
  return attacker.type === "skirmishers" ? 20 : 55;
}

function isArcReachable(
  attacker: Unit,
  target: Unit,
  arc: EngagementArc,
): boolean {
  if (arc !== "rear") return true;
  const sideX = Math.cos(target.facing);
  const sideY = Math.sin(target.facing);
  const forwardX = sideY;
  const forwardY = -sideX;
  const dx = attacker.position.x - target.position.x;
  const dy = attacker.position.y - target.position.y;
  const forwardDistance = dx * forwardX + dy * forwardY;
  const lateralDistance = Math.abs(dx * sideX + dy * sideY);
  return forwardDistance <= 0 ||
    lateralDistance >= formationHalfWidth(target) + formationHalfDepth(attacker);
}

export function hasOpenEngagementSlot(
  attacker: Unit,
  target: Unit,
  usage: Readonly<EngagementSlotUsage>,
): boolean {
  for (const arc of ARC_ORDER) {
    if (
      isArcReachable(attacker, target, arc) &&
      usage[arc] < engagementSlotCapacity(attacker, target, arc)
    ) return true;
  }
  return false;
}

export function selectEngagementSlot(
  attacker: Unit,
  target: Unit,
  usage: Readonly<EngagementSlotUsage>,
  preferredArc?: EngagementArc,
): EngagementSlot | undefined {
  let selected: EngagementSlot | undefined;
  let selectedScore = Infinity;
  for (const arc of ARC_ORDER) {
    if (!isArcReachable(attacker, target, arc)) continue;
    const capacity = engagementSlotCapacity(attacker, target, arc);
    const index = usage[arc];
    if (index >= capacity) continue;
    const position = calculateEngagementSlotPosition(
      attacker,
      target,
      arc,
      index,
      capacity,
    );
    const score = distance(attacker.position, position) +
      tacticalBias(attacker, target, arc) -
      (arc === preferredArc ? 90 : 0);
    if (score < selectedScore) {
      selected = { arc, index, capacity, position };
      selectedScore = score;
    }
  }
  return selected;
}
