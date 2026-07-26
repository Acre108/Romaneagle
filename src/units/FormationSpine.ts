import { clamp } from "../core/math";
import type {
  FormationSpinePoint,
  Unit,
} from "./types";

export const FORMATION_SPINE_POINT_COUNT = 5;
export const MAX_SPINE_LATERAL_BEND = 82;
export const MAX_SPINE_DEPTH_BEND = 116;

export interface FormationSpineSample {
  x: number;
  y: number;
  normalX: number;
  normalY: number;
}

export function createFormationSpine(width: number): FormationSpinePoint[] {
  const points: FormationSpinePoint[] = [];
  const halfWidth = Math.max(4, width * 0.5 - 4);
  for (let index = 0; index < FORMATION_SPINE_POINT_COUNT; index += 1) {
    const baseX = -halfWidth +
      halfWidth * 2 * index / (FORMATION_SPINE_POINT_COUNT - 1);
    points.push({
      baseX,
      x: baseX,
      y: 0,
      targetX: baseX,
      targetY: 0,
    });
  }
  return points;
}

export function resetFormationSpine(unit: Unit): void {
  const halfWidth = Math.max(4, unit.formationWidth * 0.5 - 4);
  while (unit.formationSpine.length < FORMATION_SPINE_POINT_COUNT) {
    unit.formationSpine.push({
      baseX: 0,
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0,
    });
  }
  unit.formationSpine.length = FORMATION_SPINE_POINT_COUNT;
  for (let index = 0; index < FORMATION_SPINE_POINT_COUNT; index += 1) {
    const point = unit.formationSpine[index];
    if (!point) continue;
    const baseX = -halfWidth +
      halfWidth * 2 * index / (FORMATION_SPINE_POINT_COUNT - 1);
    point.baseX = baseX;
    point.x = baseX;
    point.y = 0;
    point.targetX = baseX;
    point.targetY = 0;
  }
}

export function sampleFormationSpine(
  spine: readonly FormationSpinePoint[],
  localX: number,
  output: FormationSpineSample,
): FormationSpineSample {
  const first = spine[0];
  const last = spine[spine.length - 1];
  if (!first || !last || spine.length < 2) {
    output.x = localX;
    output.y = 0;
    output.normalX = 0;
    output.normalY = 1;
    return output;
  }

  const clampedX = clamp(localX, first.baseX, last.baseX);
  let left = first;
  let right = spine[1] ?? last;
  for (let index = 0; index < spine.length - 1; index += 1) {
    const candidateLeft = spine[index];
    const candidateRight = spine[index + 1];
    if (!candidateLeft || !candidateRight) continue;
    left = candidateLeft;
    right = candidateRight;
    if (clampedX <= candidateRight.baseX) break;
  }
  const span = Math.max(0.001, right.baseX - left.baseX);
  const ratio = clamp((clampedX - left.baseX) / span, 0, 1);
  output.x = left.x + (right.x - left.x) * ratio;
  output.y = left.y + (right.y - left.y) * ratio;
  const tangentX = right.x - left.x;
  const tangentY = right.y - left.y;
  const tangentLength = Math.max(0.001, Math.hypot(tangentX, tangentY));
  const residual = localX - clampedX;
  output.x += tangentX / tangentLength * residual;
  output.y += tangentY / tangentLength * residual;
  output.normalX = -tangentY / tangentLength;
  output.normalY = tangentX / tangentLength;
  return output;
}
