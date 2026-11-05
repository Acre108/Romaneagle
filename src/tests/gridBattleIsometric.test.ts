import { describe, expect, it } from "vitest";
import { IsoCamera } from "../gridBattle/rendering/isometric/IsoCamera";
import { calculateIsoBoundaryDepth, calculateIsoDepth, ISO_DEPTH_PRIORITY } from "../gridBattle/rendering/isometric/IsoDepth";
import { ELEVATION_STEP_HEIGHT, ISO_METRICS } from "../gridBattle/rendering/isometric/IsoConfig";
import { pickElevatedIsoTile, pickIsoTile } from "../gridBattle/rendering/isometric/IsoPicking";
import { cornerRampDirectionAt, surfaceRampDirectionAt } from "../gridBattle/rendering/isometric/IsoTerrainSurface";
import {
  elevatedGridToIso,
  fractionalGridToIso,
  gridToIso,
  gridSurfaceToIso,
  isoSurfaceCorners,
  interpolateGridPosition,
  isoToFractionalGrid,
  pointInsideIsoDiamond,
} from "../gridBattle/rendering/isometric/IsoProjection";
import { createPrototypeGridScenario } from "../gridBattle/scenario/prototypeScenario";
import { mapTileAt, setMapTerrain } from "../gridBattle/model/battlefieldMap";

describe("grid-battle isometric presentation", () => {
  it("projects the origin to the isometric origin", () => {
    expect(gridToIso({ x: 0, y: 0 }, ISO_METRICS)).toEqual({ x: 0, y: 0 });
  });

  it("maps all four cardinal directions to the fixed screen diagonals", () => {
    expect(gridToIso({ x: 1, y: 0 }, ISO_METRICS)).toEqual({ x: 48, y: 24 });
    expect(gridToIso({ x: -1, y: 0 }, ISO_METRICS)).toEqual({ x: -48, y: -24 });
    expect(gridToIso({ x: 0, y: -1 }, ISO_METRICS)).toEqual({ x: 48, y: -24 });
    expect(gridToIso({ x: 0, y: 1 }, ISO_METRICS)).toEqual({ x: -48, y: 24 });
  });

  it("round-trips integer and fractional grid coordinates", () => {
    for (const position of [{ x: 7, y: 11 }, { x: 4.25, y: 8.75 }]) {
      const projected = fractionalGridToIso(position, ISO_METRICS);
      const inverse = isoToFractionalGrid(projected, ISO_METRICS);
      expect(inverse.x).toBeCloseTo(position.x);
      expect(inverse.y).toBeCloseTo(position.y);
    }
  });

  it("tests diamond containment", () => {
    const centre = gridToIso({ x: 3, y: 4 }, ISO_METRICS);
    expect(pointInsideIsoDiamond(centre, centre, ISO_METRICS)).toBe(true);
    expect(pointInsideIsoDiamond({ x: centre.x + 49, y: centre.y }, centre, ISO_METRICS)).toBe(false);
  });

  it("picks the same tile near each edge", () => {
    const centre = gridToIso({ x: 8, y: 6 }, ISO_METRICS);
    for (const offset of [{ x: 0, y: -23 }, { x: 47, y: 0 }, { x: 0, y: 23 }, { x: -47, y: 0 }]) {
      expect(pickIsoTile({ x: centre.x + offset.x, y: centre.y + offset.y }, 20, 14, ISO_METRICS)).toEqual({ x: 8, y: 6 });
    }
  });

  it("projects and picks raised tile tops at their visible height", () => {
    const tile = { x: 8, y: 6 };
    const centre = elevatedGridToIso(tile, 2, ISO_METRICS, ELEVATION_STEP_HEIGHT);
    expect(centre.y).toBe(gridToIso(tile, ISO_METRICS).y - ELEVATION_STEP_HEIGHT * 2);
    expect(pickElevatedIsoTile(
      centre,
      20,
      14,
      ISO_METRICS,
      ELEVATION_STEP_HEIGHT,
      (position) => position.x === tile.x && position.y === tile.y ? 2 : 0,
      () => undefined,
    )).toEqual(tile);
  });

  it("picks the frontmost visible surface when raised tiles overlap", () => {
    const raised = { x: 2, y: 1 };
    expect(pickElevatedIsoTile(
      { x: 48, y: 20 },
      4,
      4,
      ISO_METRICS,
      ELEVATION_STEP_HEIGHT,
      (position) => position.x === raised.x && position.y === raised.y ? 2 : 0,
      () => undefined,
      { minimum: 0, maximum: 2 },
    )).toEqual(raised);
  });

  it("projects and picks terrain below zero elevation", () => {
    const tile = { x: 8, y: 6 };
    const centre = elevatedGridToIso(tile, -3, ISO_METRICS, ELEVATION_STEP_HEIGHT);
    expect(centre.y).toBe(gridToIso(tile, ISO_METRICS).y + ELEVATION_STEP_HEIGHT * 3);
    expect(pickElevatedIsoTile(
      centre,
      20,
      14,
      ISO_METRICS,
      ELEVATION_STEP_HEIGHT,
      () => -3,
      () => undefined,
      { minimum: -3, maximum: -3 },
    )).toEqual(tile);
  });

  it("makes a ramp tile a continuous plane from the lower to upper edge", () => {
    const tile = { x: 6, y: 2 };
    const flatCentre = elevatedGridToIso(tile, 0, ISO_METRICS, ELEVATION_STEP_HEIGHT);
    const rampCentre = gridSurfaceToIso(tile, 0, "east", ISO_METRICS, ELEVATION_STEP_HEIGHT);
    const [top, right, bottom, left] = isoSurfaceCorners(
      tile, 0, "east", ISO_METRICS, ELEVATION_STEP_HEIGHT,
    );
    expect(rampCentre.y).toBe(flatCentre.y - ELEVATION_STEP_HEIGHT / 2);
    expect(right!.y).toBe(flatCentre.y - ELEVATION_STEP_HEIGHT);
    expect(bottom!.y).toBe(flatCentre.y + ISO_METRICS.tileHeight / 2 - ELEVATION_STEP_HEIGHT);
    expect(top!.y).toBe(flatCentre.y - ISO_METRICS.tileHeight / 2);
    expect(left!.y).toBe(flatCentre.y);
    expect(pickElevatedIsoTile(
      rampCentre,
      20,
      14,
      ISO_METRICS,
      ELEVATION_STEP_HEIGHT,
      () => 0,
      (position) => position.x === tile.x && position.y === tile.y ? "east" : undefined,
    )).toEqual(tile);
  });

  it("fills two straight-ramp joins with a corner surface", () => {
    const state = createPrototypeGridScenario();
    expect(cornerRampDirectionAt(state, { x: 6, y: 5 })).toBe("northEast");
    expect(cornerRampDirectionAt(state, { x: 7, y: 4 })).toBe("northEast");
    expect(cornerRampDirectionAt(state, { x: 6, y: 0 })).toBeUndefined();
    expect(cornerRampDirectionAt(state, { x: 12, y: 5 })).toBeUndefined();
    setMapTerrain(state.battlefield, { x: 6, y: 5 }, "road");
    expect(cornerRampDirectionAt(state, { x: 6, y: 5 })).toBe("northEast");
  });

  it("raises only the joining corner of a corner ramp tile", () => {
    const tile = { x: 6, y: 5 };
    const flatCorners = isoSurfaceCorners(tile, 0, undefined, ISO_METRICS, ELEVATION_STEP_HEIGHT);
    const corners = isoSurfaceCorners(tile, 0, "northEast", ISO_METRICS, ELEVATION_STEP_HEIGHT);
    expect(corners[1]!.y).toBe(flatCorners[1]!.y - ELEVATION_STEP_HEIGHT);
    expect(corners[0]!.y).toBe(flatCorners[0]!.y - ELEVATION_STEP_HEIGHT / 2);
    expect(corners[2]!.y).toBe(flatCorners[2]!.y - ELEVATION_STEP_HEIGHT / 2);
    expect(corners[3]).toEqual(flatCorners[3]);

    const state = createPrototypeGridScenario();
    const centre = gridSurfaceToIso(tile, 0, "northEast", ISO_METRICS, ELEVATION_STEP_HEIGHT);
    expect(pickElevatedIsoTile(
      centre,
      state.battlefield.width,
      state.battlefield.height,
      ISO_METRICS,
      ELEVATION_STEP_HEIGHT,
      (position) => mapTileAt(state.battlefield, position)?.elevation ?? 0,
      (position) => surfaceRampDirectionAt(state, position),
    )).toEqual(tile);
  });

  it("keeps picking invariant under camera pan and cursor-centred zoom", () => {
    const camera = new IsoCamera(
      { width: 1280, height: 760 },
      { minX: -700, minY: -80, maxX: 1000, maxY: 820 },
    );
    const tile = { x: 12, y: 5 };
    const world = gridToIso(tile, ISO_METRICS);
    camera.panBy(-120, 65);
    const cursor = camera.worldToScreen(world);
    camera.zoomAt(cursor, 1.5);
    expect(camera.worldToScreen(world).x).toBeCloseTo(cursor.x);
    expect(camera.worldToScreen(world).y).toBeCloseTo(cursor.y);
    const local = camera.screenToWorld(cursor);
    expect(pickIsoTile(local, 20, 14, ISO_METRICS)).toEqual(tile);
  });

  it("increases depth consistently toward the foreground", () => {
    expect(calculateIsoDepth(7, 7)).toBeGreaterThan(calculateIsoDepth(7, 6));
    expect(calculateIsoDepth(8, 6)).toBeGreaterThan(calculateIsoDepth(7, 6));
  });

  it("sorts an exposed ledge between blocks above and below it", () => {
    const upperBlock = calculateIsoDepth(7, 4, ISO_DEPTH_PRIORITY.soldier);
    const ledge = calculateIsoBoundaryDepth(7, 4, 7, 5, ISO_DEPTH_PRIORITY.blockBase);
    const lowerBlock = calculateIsoDepth(7, 5, ISO_DEPTH_PRIORITY.blockBase);
    expect(ledge).toBeGreaterThan(upperBlock);
    expect(ledge).toBeLessThan(lowerBlock);
  });

  it("keeps animated blocks on the projected path between legal grid squares", () => {
    const start = { x: 5, y: 9 };
    const end = { x: 5, y: 8 };
    const midpoint = interpolateGridPosition(start, end, 0.5);
    expect(midpoint).toEqual({ x: 5, y: 8.5 });
    expect(fractionalGridToIso(midpoint, ISO_METRICS)).toEqual({ x: -168, y: 324 });
  });
});
