import type { FormationType, SoldierVisual, Unit, UnitType } from "./types";
import { resetFormationSpine } from "./FormationSpine";

export const ABOUT_FACE_DURATION = 2;

export interface FormationLayout {
  slots: { x: number; y: number }[];
  width: number;
  depth: number;
}

export function createFormationLayout(
  count: number,
  formation: FormationType,
  type: UnitType,
  loose = false,
): FormationLayout {
  const looseShape = loose &&
    formation !== "shieldwall" &&
    formation !== "tortoise";
  const spacingX = formation === "tortoise"
    ? 7
    : looseShape
      ? type === "cavalry" ? 15 : 11
      : type === "cavalry" ? 12 : 8;
  const spacingY = formation === "tortoise"
    ? 8
    : looseShape
      ? type === "cavalry" ? 19 : 13
      : type === "cavalry" ? 16 : 9;
  if (formation === "mob") {
    const slots: { x: number; y: number }[] = [];
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const spacing = Math.max(spacingX, spacingY) * 0.62;
    let extentX = spacingX * 0.5;
    let extentY = spacingY * 0.5;
    for (let index = 0; index < count; index += 1) {
      const radius = Math.sqrt(index) * spacing;
      const angle = index * goldenAngle;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      slots.push({ x, y });
      extentX = Math.max(extentX, Math.abs(x) + spacingX * 0.5);
      extentY = Math.max(extentY, Math.abs(y) + spacingY * 0.5);
    }
    return { slots, width: extentX * 2, depth: extentY * 2 };
  }
  let columns: number;
  if (formation === "column") {
    columns = looseShape
      ? type === "cavalry" ? 3 : 5
      : type === "cavalry" ? 4 : 6;
  }
  else if (formation === "shieldwall") columns = Math.min(count, 20);
  else if (formation === "tortoise") columns = Math.min(count, 12);
  else {
    columns = Math.min(
      count,
      looseShape
        ? type === "cavalry" ? 10 : 20
        : type === "cavalry" ? 12 : 24,
    );
  }
  const rows = Math.ceil(count / columns);
  const slots: { x: number; y: number }[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(i / columns);
    const rowCount = Math.min(columns, count - row * columns);
    const column = i % columns;
    const stagger = formation === "shieldwall" && row % 2
      ? spacingX * 0.25
      : looseShape
        ? (row % 2 ? spacingX * 0.34 : 0) +
          Math.sin((row + 1) * 4.17) * spacingX * 0.12
        : 0;
    const irregularX = looseShape ? Math.sin((i + 1) * 2.399) * spacingX * 0.16 : 0;
    const irregularY = looseShape ? Math.cos((i + 1) * 1.731) * spacingY * 0.18 : 0;
    const x = (column - (rowCount - 1) / 2) * spacingX + stagger + irregularX;
    const y = (row - (rows - 1) / 2) * spacingY + irregularY;
    slots.push({ x, y });
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return {
    slots,
    width: count > 0 ? Math.max(spacingX, maxX - minX + spacingX) : spacingX,
    depth: count > 0 ? Math.max(spacingY, maxY - minY + spacingY) : spacingY,
  };
}

export function applyFormation(unit: Unit, formation: FormationType): void {
  const layout = createFormationLayout(
    unit.soldierCount,
    formation,
    unit.type,
    unit.faction === "saxon" || unit.type === "skirmishers",
  );
  unit.formation = formation;
  unit.crossingPhase = undefined;
  unit.crossingOriginBank = undefined;
  unit.engagementRecoveryTimer = 0;
  unit.formationWidth = layout.width;
  unit.formationDepth = layout.depth;
  resetFormationSpine(unit);
  for (let i = 0; i < unit.soldierCount; i += 1) {
    const soldier = unit.soldiers[i];
    const slot = layout.slots[i];
    if (soldier && slot) {
      soldier.baseX = slot.x;
      soldier.baseY = slot.y;
      soldier.targetX = slot.x;
      soldier.targetY = slot.y;
    }
  }
  unit.reforming = 1.25;
  unit.formationChangeTimer = 5;
  unit.stationaryTimer = 0;
  unit.order = { type: "hold" };
  unit.velocity = 0;
  unit.chargeTargetId = undefined;
  unit.aboutFacePending = false;
  unit.pathingState = "direct";
  unit.stuckTimer = 0;
  unit.fallbackDestination = undefined;
  unit.pathCrossingX = undefined;
  unit.tacticalState = formation === "mob" ? "vulnerable" : "standard";
  unit.cohesion = Math.max(20, unit.cohesion - 5);
}

export function beginAboutFace(unit: Unit): void {
  unit.aboutFacePending = true;
  unit.formationChangeTimer = ABOUT_FACE_DURATION;
  unit.stationaryTimer = 0;
  unit.order = { type: "hold" };
  unit.velocity = 0;
  unit.chargeTargetId = undefined;
  unit.pathingState = "direct";
  unit.stuckTimer = 0;
  unit.fallbackDestination = undefined;
  unit.pathCrossingX = undefined;
  unit.crossingPhase = undefined;
  unit.crossingOriginBank = undefined;
  unit.engagementRecoveryTimer = 0;
}

/**
 * Reverses the formation without wheeling. Negating local soldier coordinates
 * while adding PI to the unit facing keeps every soldier at the same world
 * position; only their facing and the formation's front change.
 */
export function completeAboutFace(unit: Unit): void {
  if (!unit.aboutFacePending) return;
  unit.facing += Math.PI;
  for (let index = 0; index < unit.soldierCount; index += 1) {
    const soldier = unit.soldiers[index];
    if (!soldier) continue;
    soldier.x = -soldier.x;
    soldier.y = -soldier.y;
    soldier.baseX = -soldier.baseX;
    soldier.baseY = -soldier.baseY;
    soldier.targetX = -soldier.targetX;
    soldier.targetY = -soldier.targetY;
  }
  resetFormationSpine(unit);
  unit.aboutFacePending = false;
  unit.stationaryTimer = 0;
}

export function createSoldiers(layout: FormationLayout, phaseOffset: number): SoldierVisual[] {
  return layout.slots.map((slot, index) => ({
    x: slot.x,
    y: slot.y,
    baseX: slot.x,
    baseY: slot.y,
    targetX: slot.x,
    targetY: slot.y,
    phase: phaseOffset + index * 0.77,
  }));
}

export function formationRadius(unit: Unit): number {
  return Math.max(22, Math.hypot(unit.formationWidth * 0.45, unit.formationDepth * 0.45));
}
