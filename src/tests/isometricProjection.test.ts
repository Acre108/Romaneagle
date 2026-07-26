import { describe, expect, it } from "vitest";
import {
  getProjectedDepth,
  projectWorldBounds,
  screenToWorld,
  screenVectorToWorld,
  worldToScreen,
  worldVectorToScreen,
} from "../rendering/IsometricProjection";

describe("isometric projection", () => {
  it("projects world coordinates with the default 2:1 dimetric ratio", () => {
    expect(worldToScreen(100, 40)).toEqual({ x: 30, y: 35 });
    expect(worldToScreen(100, 40, 12)).toEqual({ x: 30, y: 23 });
  });

  it("approximately reverses projected coordinates on the same elevation plane", () => {
    const projected = worldToScreen(742.25, 119.75, 18);
    const world = screenToWorld(projected.x, projected.y, 18);
    expect(world.x).toBeCloseTo(742.25);
    expect(world.y).toBeCloseTo(119.75);
  });

  it("supports negative coordinates", () => {
    const projected = worldToScreen(-120, -45);
    const world = screenToWorld(projected.x, projected.y);
    expect(world.x).toBeCloseTo(-120);
    expect(world.y).toBeCloseTo(-45);
  });

  it("round-trips direction vectors", () => {
    const projected = worldVectorToScreen(45, -30);
    const world = screenVectorToWorld(projected.x, projected.y);
    expect(world.x).toBeCloseTo(45);
    expect(world.y).toBeCloseTo(-30);
  });

  it("projects the four-corner bounds of a continuous battlefield", () => {
    expect(projectWorldBounds(0, 0, 2400, 1600)).toEqual({
      minX: -800,
      minY: 0,
      maxX: 1200,
      maxY: 1000,
      width: 2000,
      height: 1000,
    });
  });

  it("uses the projected ground anchor as a stable depth key", () => {
    expect(getProjectedDepth(200, 300)).toBe(125);
    expect(getProjectedDepth(200, 300, 20)).toBe(105);
  });
});
