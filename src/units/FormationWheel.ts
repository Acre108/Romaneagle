import { formationHalfWidth } from "./FormationContact";
import type { Unit } from "./types";

/**
 * Rotates a formation around its inside flank. The inside edge remains at the
 * pivot while the outside edge advances through the wheel.
 */
export function wheelFormation(unit: Unit, turnAmount: number): void {
  if (Math.abs(turnAmount) < 0.000001) return;
  const direction = turnAmount > 0 ? 1 : -1;
  const halfWidth = formationHalfWidth(unit);
  const oldSideX = Math.cos(unit.facing);
  const oldSideY = Math.sin(unit.facing);
  const pivotX = unit.position.x + oldSideX * halfWidth * direction;
  const pivotY = unit.position.y + oldSideY * halfWidth * direction;

  unit.facing += turnAmount;
  const newSideX = Math.cos(unit.facing);
  const newSideY = Math.sin(unit.facing);
  unit.position.x = pivotX - newSideX * halfWidth * direction;
  unit.position.y = pivotY - newSideY * halfWidth * direction;
}

export function formationWheelRate(unit: Unit, movementSpeed: number): number {
  return Math.min(unit.turnSpeed, movementSpeed / Math.max(10, formationHalfWidth(unit) * 2));
}
