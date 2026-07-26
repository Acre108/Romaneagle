import { describe, expect, it } from "vitest";
import { Camera } from "../core/Camera";

describe("isometric camera", () => {
  it.each([0.4, 0.75, 1.6])("preserves world picking at zoom %s", (zoom) => {
    const camera = new Camera("isometric");
    camera.position = { x: 840, y: 620 };
    camera.zoom = zoom;
    const world = { x: 315.25, y: 1288.5 };
    const screen = camera.worldToScreen(world, 1280, 720);
    const picked = camera.screenToWorld(screen, 1280, 720);
    expect(picked.x).toBeCloseTo(world.x);
    expect(picked.y).toBeCloseTo(world.y);
  });

  it("keeps camera offsets in world coordinates", () => {
    const camera = new Camera("isometric");
    camera.position = { x: 950, y: 510 };
    const centre = camera.worldToScreen(camera.position, 1280, 720);
    expect(centre).toEqual({ x: 640, y: 360 });
  });

  it("converts rightward screen panning into the required diagonal world vector", () => {
    const camera = new Camera("isometric");
    camera.position = { x: 1200, y: 800 };
    camera.zoom = 1;
    camera.panScreen(100, 0, 600, 400);
    expect(camera.position.x).toBeCloseTo(1300);
    expect(camera.position.y).toBeCloseTo(700);
    const projectedCentre = camera.worldToScreen(camera.position, 600, 400);
    expect(projectedCentre).toEqual({ x: 300, y: 200 });
  });

  it("allows a closer tactical zoom while retaining the configured limit", () => {
    const camera = new Camera("isometric");

    camera.setZoom(10, { x: 640, y: 360 }, 1280, 720);

    expect(camera.zoom).toBe(2.3);
  });
});
