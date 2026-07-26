import { describe, expect, it } from "vitest";
import {
  calculateFormationOrderLayout,
  FORMATION_ORDER_DRAG_THRESHOLD,
} from "../units/FormationOrderLayout";

describe("formation-facing destination layout", () => {
  it("centres one unit on the dragged frontage and aligns it to the line", () => {
    const layout = calculateFormationOrderLayout(
      { x: 100, y: 200 },
      { x: 300, y: 200 },
      [{ frontageWidth: 120 }],
      Math.PI / 3,
    );

    expect(layout.dragged).toBe(true);
    expect(layout.facing).toBeCloseTo(0);
    expect(layout.placements[0]?.destination).toEqual({ x: 200, y: 200 });
    expect(layout.placements[0]?.facing).toBeCloseTo(0);
  });

  it("uses the drag direction for a vertical frontage", () => {
    const layout = calculateFormationOrderLayout(
      { x: 50, y: 40 },
      { x: 50, y: 240 },
      [{ frontageWidth: 100 }],
      0,
    );

    expect(layout.placements[0]?.destination.x).toBeCloseTo(50);
    expect(layout.placements[0]?.destination.y).toBeCloseTo(140);
    expect(layout.placements[0]?.facing).toBeCloseTo(Math.PI / 2);
  });

  it("distributes multiple units beside one another across a long frontage", () => {
    const layout = calculateFormationOrderLayout(
      { x: 0, y: 100 },
      { x: 300, y: 100 },
      [{ frontageWidth: 80 }, { frontageWidth: 80 }],
      0,
    );

    expect(layout.placements).toHaveLength(2);
    expect(layout.placements[0]?.destination).toEqual({ x: 40, y: 100 });
    expect(layout.placements[1]?.destination).toEqual({ x: 260, y: 100 });
    expect(layout.placements.every((placement) => placement.facing === layout.facing)).toBe(true);
  });

  it("keeps natural separation when the dragged frontage is too short", () => {
    const layout = calculateFormationOrderLayout(
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      [{ frontageWidth: 80 }, { frontageWidth: 80 }],
      0,
    );

    const first = layout.placements[0];
    const second = layout.placements[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect((second?.destination.x ?? 0) - (first?.destination.x ?? 0)).toBe(104);
  });

  it("preserves point movement and facing below the drag threshold", () => {
    const fallbackFacing = Math.PI * 0.75;
    const layout = calculateFormationOrderLayout(
      { x: 400, y: 500 },
      { x: 400 + FORMATION_ORDER_DRAG_THRESHOLD - 1, y: 500 },
      [{ frontageWidth: 120 }],
      fallbackFacing,
    );

    expect(layout.dragged).toBe(false);
    expect(layout.placements[0]?.destination).toEqual({ x: 400, y: 500 });
    expect(layout.placements[0]?.facing).toBeCloseTo(fallbackFacing);
  });
});
