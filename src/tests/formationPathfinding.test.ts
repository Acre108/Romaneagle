import { describe, expect, it } from "vitest";
import type { Vec2 } from "../core/math";
import {
  planFormationRoute,
  type FormationNavigationMap,
} from "../units/FormationPathfinding";

class ChokepointMap implements FormationNavigationMap {
  readonly width = 800;
  readonly height = 500;

  isBlocked(point: Vec2): boolean {
    return point.y >= 180 && point.y <= 220 &&
      (point.x < 420 || point.x > 500);
  }

  segmentBlocked(start: Vec2, end: Vec2): boolean {
    const steps = Math.max(1, Math.ceil(Math.hypot(
      end.x - start.x,
      end.y - start.y,
    ) / 8));
    for (let step = 0; step <= steps; step += 1) {
      const ratio = step / steps;
      if (this.isBlocked({
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
      })) {
        return true;
      }
    }
    return false;
  }
}

describe("formation pathfinding", () => {
  it("routes through a passable chokepoint without map-specific crossing data", () => {
    const map = new ChokepointMap();
    const start = { x: 180, y: 100 };
    const goal = { x: 180, y: 360 };
    const route = planFormationRoute(start, goal, map, { cellSize: 40 });

    expect(route).toBeDefined();
    expect(route?.at(-1)).toEqual(goal);
    expect(route?.some((point) => point.x >= 420 && point.x <= 500)).toBe(true);
    let previous = start;
    for (const point of route ?? []) {
      expect(map.segmentBlocked(previous, point)).toBe(false);
      previous = point;
    }
  });

  it("is deterministic and keeps clear orders direct", () => {
    const map = new ChokepointMap();
    const start = { x: 600, y: 80 };
    const goal = { x: 650, y: 130 };

    expect(planFormationRoute(start, goal, map)).toEqual([goal]);
    expect(planFormationRoute(
      { x: 180, y: 100 },
      { x: 180, y: 360 },
      map,
      { cellSize: 40 },
    )).toEqual(planFormationRoute(
      { x: 180, y: 100 },
      { x: 180, y: 360 },
      map,
      { cellSize: 40 },
    ));
  });
});
