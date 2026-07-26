import { clamp } from "../core/math";

export interface UnitLabelPlacement {
  id: string;
  desiredX: number;
  desiredTop: number;
  x: number;
  top: number;
  width: number;
  height: number;
}

const LABEL_GAP = 2;
const VIEWPORT_MARGIN = 4;
const MAX_ROWS = 3;

function overlaps(a: UnitLabelPlacement, b: UnitLabelPlacement): boolean {
  return (
    Math.abs(a.x - b.x) < (a.width + b.width) * 0.5 + LABEL_GAP &&
    a.top < b.top + b.height + LABEL_GAP &&
    a.top + a.height + LABEL_GAP > b.top
  );
}

function canPlace(
  placement: UnitLabelPlacement,
  placed: readonly UnitLabelPlacement[],
  placedCount: number,
): boolean {
  for (let index = 0; index < placedCount; index += 1) {
    const other = placed[index];
    if (other && overlaps(placement, other)) return false;
  }
  return true;
}

/**
 * Mutates the supplied label pool in stable unit order. Colliding labels first
 * step sideways, then use a shallow second row as a dense-melee fallback.
 */
export function resolveUnitLabelPlacements(
  placements: UnitLabelPlacement[],
  count: number,
  viewportWidth: number,
  viewportHeight: number,
): void {
  for (let index = 0; index < count; index += 1) {
    const placement = placements[index];
    if (!placement) continue;
    const halfWidth = placement.width * 0.5;
    placement.x = clamp(
      placement.desiredX,
      VIEWPORT_MARGIN + halfWidth,
      viewportWidth - VIEWPORT_MARGIN - halfWidth,
    );
    placement.top = clamp(
      placement.desiredTop,
      VIEWPORT_MARGIN,
      viewportHeight - VIEWPORT_MARGIN - placement.height,
    );
    if (canPlace(placement, placements, index)) continue;

    const sideBias = placement.id.charCodeAt(placement.id.length - 1) % 2 === 0 ? 1 : -1;
    const sideStep = placement.width + LABEL_GAP;
    let placed = false;
    for (let row = 0; row < MAX_ROWS && !placed; row += 1) {
      for (let directionIndex = 0; directionIndex < 2; directionIndex += 1) {
        const direction = directionIndex === 0 ? sideBias : -sideBias;
        const rowInset = row === 0 ? 1 : 0.55;
        placement.x = clamp(
          placement.desiredX + direction * sideStep * rowInset,
          VIEWPORT_MARGIN + halfWidth,
          viewportWidth - VIEWPORT_MARGIN - halfWidth,
        );
        placement.top = clamp(
          placement.desiredTop + row * (placement.height + LABEL_GAP),
          VIEWPORT_MARGIN,
          viewportHeight - VIEWPORT_MARGIN - placement.height,
        );
        if (canPlace(placement, placements, index)) {
          placed = true;
          break;
        }
      }
    }
  }
}

export function unitLabelsOverlap(a: UnitLabelPlacement, b: UnitLabelPlacement): boolean {
  return overlaps(a, b);
}
