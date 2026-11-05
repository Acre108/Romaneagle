import type { GridPosition } from "../../model/types";
import { gridSurfaceToIso, gridToIso, isoToFractionalGrid, pointInsideIsoDiamond, pointInsideIsoSurface, type IsoMetrics, type ScreenPosition, type SurfaceRampDirection } from "./IsoProjection";

export interface IsoElevationRange {
  minimum: number;
  maximum: number;
}

function candidateKey(position: GridPosition): string {
  return `${position.x},${position.y}`;
}

export function isoPickCandidates(localPoint: ScreenPosition, metrics: IsoMetrics): GridPosition[] {
  const inverse = isoToFractionalGrid(localPoint, metrics);
  const floorX = Math.floor(inverse.x);
  const ceilX = Math.ceil(inverse.x);
  const floorY = Math.floor(inverse.y);
  const ceilY = Math.ceil(inverse.y);
  const seeds: GridPosition[] = [
    { x: floorX, y: floorY }, { x: floorX, y: ceilY },
    { x: ceilX, y: floorY }, { x: ceilX, y: ceilY },
  ];
  const candidates: GridPosition[] = [];
  const seen = new Set<string>();
  for (const seed of seeds) {
    for (const offset of [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const candidate = { x: seed.x + offset[0], y: seed.y + offset[1] };
      const key = candidateKey(candidate);
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push(candidate);
      }
    }
  }
  return candidates;
}

export function pickIsoTile(
  localPoint: ScreenPosition,
  columns: number,
  rows: number,
  metrics: IsoMetrics,
): GridPosition | null {
  let best: GridPosition | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of isoPickCandidates(localPoint, metrics)) {
    if (candidate.x < 0 || candidate.y < 0 || candidate.x >= columns || candidate.y >= rows) continue;
    const centre = gridToIso(candidate, metrics);
    if (!pointInsideIsoDiamond(localPoint, centre, metrics)) continue;
    const dx = localPoint.x - centre.x;
    const dy = localPoint.y - centre.y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

export function pickElevatedIsoTile(
  localPoint: ScreenPosition,
  columns: number,
  rows: number,
  metrics: IsoMetrics,
  elevationStepHeight: number,
  elevationAt: (position: GridPosition) => number,
  rampAt: (position: GridPosition) => SurfaceRampDirection | undefined,
  elevationRange?: IsoElevationRange,
): GridPosition | null {
  let best: GridPosition | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestDepth = Number.NEGATIVE_INFINITY;
  const candidates: GridPosition[] = [];
  if (elevationRange === undefined) {
    for (let y = 0; y < rows; y += 1) for (let x = 0; x < columns; x += 1) candidates.push({ x, y });
  } else {
    const seen = new Set<string>();
    for (let elevation = elevationRange.minimum; elevation <= elevationRange.maximum; elevation += 1) {
      const adjusted = { x: localPoint.x, y: localPoint.y + elevation * elevationStepHeight };
      for (const candidate of isoPickCandidates(adjusted, metrics)) {
        const key = candidateKey(candidate);
        if (!seen.has(key)) {
          seen.add(key);
          candidates.push(candidate);
        }
      }
    }
  }
  for (const candidate of candidates) {
    if (candidate.x < 0 || candidate.y < 0 || candidate.x >= columns || candidate.y >= rows) continue;
    const elevation = elevationAt(candidate);
    const rampDirection = rampAt(candidate);
    const centre = gridSurfaceToIso(candidate, elevation, rampDirection, metrics, elevationStepHeight);
    if (!pointInsideIsoSurface(localPoint, candidate, elevation, rampDirection, metrics, elevationStepHeight)) continue;
    const dx = localPoint.x - centre.x;
    const dy = localPoint.y - centre.y;
    const distance = dx * dx + dy * dy;
    const depth = candidate.x + candidate.y;
    if (depth > bestDepth || (depth === bestDepth && distance < bestDistance)) {
      best = candidate;
      bestDistance = distance;
      bestDepth = depth;
    }
  }
  return best;
}
