import { formationHalfDepth, formationHalfWidth } from "./FormationContact";
import type { Unit } from "./types";

export const MAX_FORMATION_WRAP = 72;
const CONTACT_GAP = 6;

export interface FormationWrapOffset {
  lateral: number;
  advance: number;
}

/**
 * Calculates how far one whole formation file advances to meet an oblique
 * enemy frontage. It is a formation-level slot deformation, not soldier AI.
 */
function calculateDirectWrapAdvance(unit: Unit, enemy: Unit, localX: number): number {
  const unitSideX = Math.cos(unit.facing);
  const unitSideY = Math.sin(unit.facing);
  const unitDepthX = -unitSideY;
  const unitDepthY = unitSideX;
  const forwardX = -unitDepthX;
  const forwardY = -unitDepthY;
  const frontDepth = formationHalfDepth(unit);
  const startX = unit.position.x + unitSideX * localX - unitDepthX * frontDepth;
  const startY = unit.position.y + unitSideY * localX - unitDepthY * frontDepth;

  const enemySideX = Math.cos(enemy.facing);
  const enemySideY = Math.sin(enemy.facing);
  const enemyDepthX = -enemySideY;
  const enemyDepthY = enemySideX;
  const relativeX = startX - enemy.position.x;
  const relativeY = startY - enemy.position.y;
  const originSide = relativeX * enemySideX + relativeY * enemySideY;
  const originDepth = relativeX * enemyDepthX + relativeY * enemyDepthY;
  const directionSide = forwardX * enemySideX + forwardY * enemySideY;
  const directionDepth = forwardX * enemyDepthX + forwardY * enemyDepthY;
  let minimum = 0;
  let maximum = (MAX_FORMATION_WRAP + CONTACT_GAP) * 2;
  const halfWidth = formationHalfWidth(enemy);
  if (Math.abs(directionSide) < 0.0001) {
    if (Math.abs(originSide) > halfWidth) return -1;
  } else {
    let near = (-halfWidth - originSide) / directionSide;
    let far = (halfWidth - originSide) / directionSide;
    if (near > far) {
      const swap = near;
      near = far;
      far = swap;
    }
    minimum = Math.max(minimum, near);
    maximum = Math.min(maximum, far);
    if (minimum > maximum) return -1;
  }
  const halfDepth = formationHalfDepth(enemy);
  if (Math.abs(directionDepth) < 0.0001) {
    if (Math.abs(originDepth) > halfDepth) return -1;
  } else {
    let near = (-halfDepth - originDepth) / directionDepth;
    let far = (halfDepth - originDepth) / directionDepth;
    if (near > far) {
      const swap = near;
      near = far;
      far = swap;
    }
    minimum = Math.max(minimum, near);
    maximum = Math.min(maximum, far);
    if (minimum > maximum) return -1;
  }

  // Both engaged formations deform, so each closes half of the remaining gap.
  return Math.min(MAX_FORMATION_WRAP, Math.max(0, minimum - CONTACT_GAP) * 0.5);
}

export function calculateFormationWrapAdvance(unit: Unit, enemy: Unit, localX: number): number {
  return Math.max(0, calculateDirectWrapAdvance(unit, enemy, localX));
}

/**
 * Files with no enemy directly ahead trail behind the nearest contacted files.
 * This keeps the formation connected without letting the free wing attack.
 */
export function calculateCohesiveFormationWrapAdvance(unit: Unit, enemy: Unit, localX: number): number {
  const direct = calculateDirectWrapAdvance(unit, enemy, localX);
  if (direct >= 0) return direct;

  let trailingAdvance = 0;
  for (let offset = 16; offset <= 64; offset += 16) {
    const falloff = 1 - offset / 96;
    const left = calculateDirectWrapAdvance(unit, enemy, localX - offset);
    if (left >= 0) trailingAdvance = Math.max(trailingAdvance, left * falloff);
    const right = calculateDirectWrapAdvance(unit, enemy, localX + offset);
    if (right >= 0) trailingAdvance = Math.max(trailingAdvance, right * falloff);
  }
  return trailingAdvance;
}

export function isBroadFormationWrappingTortoise(
  unit: Unit,
  enemy: Unit,
): boolean {
  return enemy.formation === "tortoise" &&
    unit.formation !== "column" &&
    unit.formation !== "mob" &&
    unit.formationWidth > enemy.formationWidth * 1.35;
}

/**
 * A broad frontage meeting a compact tortoise bends its unsupported wings
 * around the tortoise's corners. This remains a deformation of whole files:
 * there is no independent soldier movement or targeting.
 */
export function calculateFormationWrapOffset(
  unit: Unit,
  enemy: Unit,
  localX: number,
): FormationWrapOffset {
  const normalAdvance = calculateCohesiveFormationWrapAdvance(
    unit,
    enemy,
    localX,
  );
  if (!isBroadFormationWrappingTortoise(unit, enemy)) {
    return { lateral: 0, advance: normalAdvance };
  }

  const unitSideX = Math.cos(unit.facing);
  const unitSideY = Math.sin(unit.facing);
  const relativeX = enemy.position.x - unit.position.x;
  const relativeY = enemy.position.y - unit.position.y;
  const enemyCentreSide = relativeX * unitSideX + relativeY * unitSideY;
  const facingDifference = enemy.facing - unit.facing;
  const projectedHalfWidth =
    formationHalfWidth(enemy) * Math.abs(Math.cos(facingDifference)) +
    formationHalfDepth(enemy) * Math.abs(Math.sin(facingDifference));
  const projectedHalfDepth =
    formationHalfDepth(enemy) * Math.abs(Math.cos(facingDifference)) +
    formationHalfWidth(enemy) * Math.abs(Math.sin(facingDifference));
  const sideFromEnemy = localX - enemyCentreSide;
  const overflow = Math.abs(sideFromEnemy) - projectedHalfWidth;
  if (overflow <= 0) return { lateral: 0, advance: normalAdvance };

  const direction = sideFromEnemy < 0 ? -1 : 1;
  const wrapStrength = Math.min(1, overflow / 40);
  const targetSide = enemyCentreSide + direction *
    (projectedHalfWidth + CONTACT_GAP + Math.min(10, overflow * 0.15));
  const lateral = Math.max(
    -44,
    Math.min(44, (targetSide - localX) * wrapStrength),
  );
  const encirclingAdvance = Math.min(
    MAX_FORMATION_WRAP,
    (projectedHalfDepth * 0.72 + overflow * 0.55) * wrapStrength,
  );
  return {
    lateral,
    advance: Math.max(normalAdvance, encirclingAdvance),
  };
}
