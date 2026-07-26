import type { Vec2 } from "../core/math";

export interface DimetricProjection {
  horizontalScale: number;
  verticalScale: number;
}

export type ProjectionMode = "topDown" | "isometric";

export interface ProjectedBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export const DEFAULT_DIMETRIC_PROJECTION: DimetricProjection = {
  horizontalScale: 0.5,
  verticalScale: 0.25,
};

export function worldToScreen(
  worldX: number,
  worldY: number,
  elevation = 0,
  projection = DEFAULT_DIMETRIC_PROJECTION,
): Vec2 {
  return worldToScreenInto(worldX, worldY, elevation, { x: 0, y: 0 }, projection);
}

export function worldToScreenInto(
  worldX: number,
  worldY: number,
  elevation: number,
  output: Vec2,
  projection = DEFAULT_DIMETRIC_PROJECTION,
): Vec2 {
  output.x = (worldX - worldY) * projection.horizontalScale;
  output.y = (worldX + worldY) * projection.verticalScale - elevation;
  return output;
}

export function screenToWorld(
  screenX: number,
  screenY: number,
  elevationPlane = 0,
  projection = DEFAULT_DIMETRIC_PROJECTION,
): Vec2 {
  const difference = screenX / projection.horizontalScale;
  const sum = (screenY + elevationPlane) / projection.verticalScale;
  return {
    x: (sum + difference) * 0.5,
    y: (sum - difference) * 0.5,
  };
}

export function worldVectorToScreen(
  dx: number,
  dy: number,
  projection = DEFAULT_DIMETRIC_PROJECTION,
): Vec2 {
  return {
    x: (dx - dy) * projection.horizontalScale,
    y: (dx + dy) * projection.verticalScale,
  };
}

export function screenVectorToWorld(
  dx: number,
  dy: number,
  projection = DEFAULT_DIMETRIC_PROJECTION,
): Vec2 {
  const difference = dx / projection.horizontalScale;
  const sum = dy / projection.verticalScale;
  return {
    x: (sum + difference) * 0.5,
    y: (sum - difference) * 0.5,
  };
}

export function projectWorldBounds(
  minWorldX: number,
  minWorldY: number,
  maxWorldX: number,
  maxWorldY: number,
  projection = DEFAULT_DIMETRIC_PROJECTION,
): ProjectedBounds {
  const top = worldToScreen(minWorldX, minWorldY, 0, projection);
  const right = worldToScreen(maxWorldX, minWorldY, 0, projection);
  const bottom = worldToScreen(maxWorldX, maxWorldY, 0, projection);
  const left = worldToScreen(minWorldX, maxWorldY, 0, projection);
  const minX = Math.min(top.x, right.x, bottom.x, left.x);
  const minY = Math.min(top.y, right.y, bottom.y, left.y);
  const maxX = Math.max(top.x, right.x, bottom.x, left.x);
  const maxY = Math.max(top.y, right.y, bottom.y, left.y);
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function getProjectedDepth(
  worldX: number,
  worldY: number,
  elevation = 0,
  projection = DEFAULT_DIMETRIC_PROJECTION,
): number {
  return (worldX + worldY) * projection.verticalScale - elevation;
}
