import { rampDirectionAt, terrainElevationAt } from "../../model/terrain";
import type { Direction, GameState, GridPosition } from "../../model/types";
import type { CornerRampDirection, SurfaceRampDirection } from "./IsoProjection";

interface CornerRampCandidate {
  direction: CornerRampDirection;
  diagonalX: -1 | 1;
  diagonalY: -1 | 1;
  horizontalRamp: Direction;
  verticalRamp: Direction;
}

const CORNER_RAMP_CANDIDATES: readonly CornerRampCandidate[] = [
  { direction: "northEast", diagonalX: 1, diagonalY: -1, horizontalRamp: "east", verticalRamp: "north" },
  { direction: "southEast", diagonalX: 1, diagonalY: 1, horizontalRamp: "east", verticalRamp: "south" },
  { direction: "southWest", diagonalX: -1, diagonalY: 1, horizontalRamp: "west", verticalRamp: "south" },
  { direction: "northWest", diagonalX: -1, diagonalY: -1, horizontalRamp: "west", verticalRamp: "north" },
];

export function cornerRampDirectionAt(
  state: GameState,
  position: GridPosition,
): CornerRampDirection | undefined {
  const elevation = terrainElevationAt(state, position);
  for (const candidate of CORNER_RAMP_CANDIDATES) {
    const verticalNeighbour = { x: position.x, y: position.y + candidate.diagonalY };
    const horizontalNeighbour = { x: position.x + candidate.diagonalX, y: position.y };
    const diagonalNeighbour = {
      x: position.x + candidate.diagonalX,
      y: position.y + candidate.diagonalY,
    };
    if (terrainElevationAt(state, verticalNeighbour) !== elevation) continue;
    if (terrainElevationAt(state, horizontalNeighbour) !== elevation) continue;
    if (terrainElevationAt(state, diagonalNeighbour) !== elevation + 1) continue;
    if (rampDirectionAt(state, verticalNeighbour) !== candidate.horizontalRamp) continue;
    if (rampDirectionAt(state, horizontalNeighbour) !== candidate.verticalRamp) continue;
    return candidate.direction;
  }
  return undefined;
}

export function surfaceRampDirectionAt(
  state: GameState,
  position: GridPosition,
): SurfaceRampDirection | undefined {
  return rampDirectionAt(state, position) ?? cornerRampDirectionAt(state, position);
}
