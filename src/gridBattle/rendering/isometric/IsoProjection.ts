import type { Direction, GridPosition } from "../../model/types";

export interface ScreenPosition {
  x: number;
  y: number;
}

export interface FractionalGridPosition {
  x: number;
  y: number;
}

export interface IsoMetrics {
  tileWidth: number;
  tileHeight: number;
}

export type DiamondEdge = "upperLeft" | "upperRight" | "lowerRight" | "lowerLeft";
export type CornerRampDirection = "northEast" | "southEast" | "southWest" | "northWest";
export type SurfaceRampDirection = Direction | CornerRampDirection;

export function fractionalGridToIso(
  position: FractionalGridPosition,
  metrics: IsoMetrics,
): ScreenPosition {
  return {
    x: (position.x - position.y) * (metrics.tileWidth / 2),
    y: (position.x + position.y) * (metrics.tileHeight / 2),
  };
}

export function gridToIso(position: GridPosition, metrics: IsoMetrics): ScreenPosition {
  return fractionalGridToIso(position, metrics);
}

export function elevatedGridToIso(
  position: GridPosition,
  elevation: number,
  metrics: IsoMetrics,
  elevationStepHeight: number,
): ScreenPosition {
  const projected = gridToIso(position, metrics);
  return { x: projected.x, y: projected.y - elevation * elevationStepHeight };
}

export interface RampSurfaceGradient {
  x: number;
  y: number;
}

export function rampSurfaceGradient(
  direction: SurfaceRampDirection,
  metrics: IsoMetrics,
  elevationStepHeight: number,
): RampSurfaceGradient {
  const horizontal = elevationStepHeight / metrics.tileWidth;
  const vertical = elevationStepHeight / metrics.tileHeight;
  switch (direction) {
    case "north": return { x: -horizontal, y: vertical };
    case "east": return { x: -horizontal, y: -vertical };
    case "south": return { x: horizontal, y: -vertical };
    case "west": return { x: horizontal, y: vertical };
    case "northEast": return { x: -horizontal, y: 0 };
    case "southEast": return { x: 0, y: -vertical };
    case "southWest": return { x: horizontal, y: 0 };
    case "northWest": return { x: 0, y: vertical };
  }
}

export function gridSurfaceToIso(
  position: GridPosition,
  elevation: number,
  rampDirection: SurfaceRampDirection | undefined,
  metrics: IsoMetrics,
  elevationStepHeight: number,
): ScreenPosition {
  const centre = elevatedGridToIso(position, elevation, metrics, elevationStepHeight);
  return rampDirection ? { x: centre.x, y: centre.y - elevationStepHeight / 2 } : centre;
}

export function surfaceLocalToIso(
  surfaceCentre: ScreenPosition,
  localPoint: ScreenPosition,
  rampDirection: SurfaceRampDirection | undefined,
  metrics: IsoMetrics,
  elevationStepHeight: number,
): ScreenPosition {
  if (!rampDirection) return { x: surfaceCentre.x + localPoint.x, y: surfaceCentre.y + localPoint.y };
  const gradient = rampSurfaceGradient(rampDirection, metrics, elevationStepHeight);
  return {
    x: surfaceCentre.x + localPoint.x,
    y: surfaceCentre.y + localPoint.y + gradient.x * localPoint.x + gradient.y * localPoint.y,
  };
}

export function isoSurfaceCorners(
  position: GridPosition,
  elevation: number,
  rampDirection: SurfaceRampDirection | undefined,
  metrics: IsoMetrics,
  elevationStepHeight: number,
  scale = 1,
): ScreenPosition[] {
  const centre = gridSurfaceToIso(position, elevation, rampDirection, metrics, elevationStepHeight);
  const corners = [
    { x: 0, y: -metrics.tileHeight / 2 * scale },
    { x: metrics.tileWidth / 2 * scale, y: 0 },
    { x: 0, y: metrics.tileHeight / 2 * scale },
    { x: -metrics.tileWidth / 2 * scale, y: 0 },
  ];
  return corners.map((point) => surfaceLocalToIso(centre, point, rampDirection, metrics, elevationStepHeight));
}

export function pointInsideIsoSurface(
  localPoint: ScreenPosition,
  position: GridPosition,
  elevation: number,
  rampDirection: SurfaceRampDirection | undefined,
  metrics: IsoMetrics,
  elevationStepHeight: number,
): boolean {
  const corners = isoSurfaceCorners(position, elevation, rampDirection, metrics, elevationStepHeight);
  let sign = 0;
  for (let index = 0; index < corners.length; index += 1) {
    const start = corners[index]!;
    const end = corners[(index + 1) % corners.length]!;
    const cross = (end.x - start.x) * (localPoint.y - start.y)
      - (end.y - start.y) * (localPoint.x - start.x);
    if (Math.abs(cross) <= Number.EPSILON) continue;
    const edgeSign = Math.sign(cross);
    if (sign !== 0 && edgeSign !== sign) return false;
    sign = edgeSign;
  }
  return true;
}

export function interpolateGridPosition(
  start: GridPosition,
  end: GridPosition,
  progress: number,
): FractionalGridPosition {
  return {
    x: start.x + (end.x - start.x) * progress,
    y: start.y + (end.y - start.y) * progress,
  };
}

export function isoToFractionalGrid(
  screen: ScreenPosition,
  metrics: IsoMetrics,
): FractionalGridPosition {
  const projectedX = screen.x / (metrics.tileWidth / 2);
  const projectedY = screen.y / (metrics.tileHeight / 2);
  return {
    x: (projectedX + projectedY) / 2,
    y: (projectedY - projectedX) / 2,
  };
}

export function pointInsideIsoDiamond(
  localPoint: ScreenPosition,
  diamondCentre: ScreenPosition,
  metrics: IsoMetrics,
): boolean {
  const dx = Math.abs(localPoint.x - diamondCentre.x);
  const dy = Math.abs(localPoint.y - diamondCentre.y);
  return dx / (metrics.tileWidth / 2) + dy / (metrics.tileHeight / 2) <= 1 + Number.EPSILON;
}

export function directionToDiamondEdge(direction: Direction): DiamondEdge {
  switch (direction) {
    case "north": return "upperRight";
    case "east": return "lowerRight";
    case "south": return "lowerLeft";
    case "west": return "upperLeft";
  }
}
