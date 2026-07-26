import type { Vec2 } from "../core/math";
import {
  isUnitInactive,
  type EngagementArc,
  type Unit,
} from "./types";

export const ATTACK_COMMAND_FLASH_SECONDS = 0.9;
export const ATTACK_TARGET_PADDING = 68;
export const ATTACK_TARGET_SCREEN_PADDING = 86;

export function attackTargetPaddingForZoom(zoom: number): number {
  return Math.max(
    ATTACK_TARGET_PADDING,
    ATTACK_TARGET_SCREEN_PADDING / Math.max(0.01, zoom),
  );
}

export function isPointWithinAttackTarget(
  unit: Unit,
  point: Vec2,
  padding = ATTACK_TARGET_PADDING,
): boolean {
  const dx = point.x - unit.position.x;
  const dy = point.y - unit.position.y;
  const cos = Math.cos(unit.facing);
  const sin = Math.sin(unit.facing);
  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;
  return Math.abs(localX) <= unit.formationWidth * 0.5 + padding &&
    Math.abs(localY) <= unit.formationDepth * 0.5 + padding;
}

export function issueAttackOrder(
  unit: Unit,
  target: Unit,
  engagementSlot?: { arc: EngagementArc; index: number },
): boolean {
  if (
    unit.faction === target.faction ||
    unit.state === "routing" ||
    isUnitInactive(unit) ||
    isUnitInactive(target) ||
    unit.formationChangeTimer > 0
  ) {
    return false;
  }
  unit.pathingState = "direct";
  unit.stuckTimer = 0;
  unit.fallbackDestination = undefined;
  unit.pathCrossingX = undefined;
  unit.crossingPhase = undefined;
  unit.crossingOriginBank = undefined;
  unit.order = engagementSlot
    ? {
        type: "attack",
        targetUnitId: target.id,
        engagementArc: engagementSlot.arc,
        engagementSlotIndex: engagementSlot.index,
      }
    : { type: "attack", targetUnitId: target.id };
  target.attackCommandFlashTimer = ATTACK_COMMAND_FLASH_SECONDS;
  return true;
}
