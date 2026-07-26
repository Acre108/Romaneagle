import { clamp, type Vec2 } from "../core/math";

export const FORMATION_ORDER_DRAG_THRESHOLD = 8;
export const FORMATION_ORDER_GAP = 24;

export interface FormationOrderMember {
  frontageWidth: number;
  boundaryMargin?: number;
}

export interface FormationOrderBounds {
  width: number;
  height: number;
}

export interface FormationOrderPlacement {
  destination: Vec2;
  facing: number;
}

export interface FormationOrderLayout {
  dragged: boolean;
  facing: number;
  placements: FormationOrderPlacement[];
}

/**
 * Builds destinations along a shared frontage axis.
 *
 * A drag defines the complete frontage line and its direction. The unit's
 * local x-axis follows that line, so its forward direction is perpendicular
 * to it. A short gesture remains a point order using the existing facing.
 */
export function calculateFormationOrderLayout(
  start: Vec2,
  end: Vec2,
  members: readonly FormationOrderMember[],
  fallbackFacing: number,
  bounds?: FormationOrderBounds,
): FormationOrderLayout {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dragLength = Math.hypot(dx, dy);
  const dragged = dragLength >= FORMATION_ORDER_DRAG_THRESHOLD;
  const facing = dragged ? Math.atan2(dy, dx) : fallbackFacing;
  const centre = dragged
    ? { x: (start.x + end.x) * 0.5, y: (start.y + end.y) * 0.5 }
    : start;
  const axisX = Math.cos(facing);
  const axisY = Math.sin(facing);

  let totalWidth = 0;
  for (const member of members) totalWidth += Math.max(1, member.frontageWidth);
  const gap = members.length > 1
    ? Math.max(FORMATION_ORDER_GAP, dragged ? (dragLength - totalWidth) / (members.length - 1) : 0)
    : 0;
  const totalSpan = totalWidth + gap * Math.max(0, members.length - 1);

  const placements: FormationOrderPlacement[] = [];
  let cursor = -totalSpan * 0.5;
  for (const member of members) {
    const frontageWidth = Math.max(1, member.frontageWidth);
    const offset = cursor + frontageWidth * 0.5;
    const margin = member.boundaryMargin ?? 0;
    const x = centre.x + axisX * offset;
    const y = centre.y + axisY * offset;
    placements.push({
      destination: bounds
        ? {
            x: clamp(x, margin, bounds.width - margin),
            y: clamp(y, margin, bounds.height - margin),
          }
        : { x, y },
      facing,
    });
    cursor += frontageWidth + gap;
  }

  return { dragged, facing, placements };
}
