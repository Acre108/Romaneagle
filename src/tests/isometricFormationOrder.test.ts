import { describe, expect, it } from "vitest";
import { Camera } from "../core/Camera";
import { calculateFormationOrderLayout } from "../units/FormationOrderLayout";

describe("isometric formation-facing orders", () => {
  it("projects the committed world frontage back onto the dragged screen line", () => {
    const camera = new Camera("isometric");
    camera.position = { x: 1200, y: 800 };
    camera.zoom = 0.9;
    const viewportWidth = 1280;
    const viewportHeight = 720;
    const screenStart = { x: 420, y: 320 };
    const screenEnd = { x: 820, y: 430 };
    const worldStart = camera.screenToWorld(screenStart, viewportWidth, viewportHeight);
    const worldEnd = camera.screenToWorld(screenEnd, viewportWidth, viewportHeight);
    const layout = calculateFormationOrderLayout(
      worldStart,
      worldEnd,
      [{ frontageWidth: 160 }],
      0,
    );

    const projectedStart = camera.worldToScreen(worldStart, viewportWidth, viewportHeight);
    const projectedEnd = camera.worldToScreen(worldEnd, viewportWidth, viewportHeight);
    expect(projectedStart.x).toBeCloseTo(screenStart.x);
    expect(projectedStart.y).toBeCloseTo(screenStart.y);
    expect(projectedEnd.x).toBeCloseTo(screenEnd.x);
    expect(projectedEnd.y).toBeCloseTo(screenEnd.y);
    expect(layout.placements[0]?.facing).toBeCloseTo(
      Math.atan2(worldEnd.y - worldStart.y, worldEnd.x - worldStart.x),
    );
  });

  it("keeps multiple committed destinations on the inverse-projected frontage", () => {
    const camera = new Camera("isometric");
    camera.position = { x: 1200, y: 800 };
    const worldStart = camera.screenToWorld({ x: 360, y: 300 }, 1280, 720);
    const worldEnd = camera.screenToWorld({ x: 920, y: 450 }, 1280, 720);
    const layout = calculateFormationOrderLayout(
      worldStart,
      worldEnd,
      [{ frontageWidth: 160 }, { frontageWidth: 160 }, { frontageWidth: 160 }],
      0,
    );
    const lineDx = worldEnd.x - worldStart.x;
    const lineDy = worldEnd.y - worldStart.y;

    for (const placement of layout.placements) {
      const relativeX = placement.destination.x - worldStart.x;
      const relativeY = placement.destination.y - worldStart.y;
      const crossProduct = relativeX * lineDy - relativeY * lineDx;
      expect(crossProduct).toBeCloseTo(0);
      expect(placement.facing).toBeCloseTo(layout.facing);
    }
  });
});
