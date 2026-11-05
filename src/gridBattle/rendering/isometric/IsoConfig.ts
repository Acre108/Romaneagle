import type { IsoMetrics } from "./IsoProjection";

export const ISO_TILE_WIDTH = 96;
export const ISO_TILE_HEIGHT = 48;
export const BLOCK_PLATFORM_HEIGHT = 8;
export const ELEVATION_STEP_HEIGHT = 14;
export const MIN_CAMERA_ZOOM = 0.25;
/** Below this zoom soldiers are hard to read, so a battle opens on its armies instead of the whole map. */
export const READABLE_OPENING_ZOOM = 0.4;
export const MAX_CAMERA_ZOOM = 1.75;
export const ISO_VIEW_WIDTH = 1280;
export const ISO_VIEW_HEIGHT = 760;

export const ISO_METRICS: IsoMetrics = {
  tileWidth: ISO_TILE_WIDTH,
  tileHeight: ISO_TILE_HEIGHT,
};

export const DIAMOND_POINTS: number[] = [
  0, -ISO_TILE_HEIGHT / 2,
  ISO_TILE_WIDTH / 2, 0,
  0, ISO_TILE_HEIGHT / 2,
  -ISO_TILE_WIDTH / 2, 0,
];
