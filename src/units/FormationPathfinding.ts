import type { Vec2 } from "../core/math";
import type { Unit } from "./types";

export interface FormationNavigationMap {
  readonly width: number;
  readonly height: number;
  isBlocked(position: Vec2): boolean;
  segmentBlocked(start: Vec2, end: Vec2): boolean;
  movementCost?(position: Vec2): number;
}

export interface FormationRouteOptions {
  cellSize?: number;
  finalFacing?: number;
  approachDistance?: number;
}

const DEFAULT_CELL_SIZE = 48;
const NEIGHBOURS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
] as const;

const copyPoint = (point: Vec2): Vec2 => ({ x: point.x, y: point.y });

function findConnectedNode(
  point: Vec2,
  map: FormationNavigationMap,
  columns: number,
  rows: number,
  cellSize: number,
): number | undefined {
  const centreColumn = Math.round(point.x / cellSize);
  const centreRow = Math.round(point.y / cellSize);
  let bestIndex: number | undefined;
  let bestDistance = Infinity;
  for (let radius = 0; radius <= 5; radius += 1) {
    for (let row = centreRow - radius; row <= centreRow + radius; row += 1) {
      if (row < 0 || row >= rows) continue;
      for (let column = centreColumn - radius; column <= centreColumn + radius; column += 1) {
        if (column < 0 || column >= columns) continue;
        if (
          radius > 0 &&
          column !== centreColumn - radius &&
          column !== centreColumn + radius &&
          row !== centreRow - radius &&
          row !== centreRow + radius
        ) {
          continue;
        }
        const candidate = {
          x: Math.min(map.width, column * cellSize),
          y: Math.min(map.height, row * cellSize),
        };
        if (map.isBlocked(candidate) || map.segmentBlocked(point, candidate)) continue;
        const candidateDistance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
        if (candidateDistance < bestDistance) {
          bestDistance = candidateDistance;
          bestIndex = row * columns + column;
        }
      }
    }
    if (bestIndex !== undefined) return bestIndex;
  }
  return undefined;
}

function reconstructRoute(
  parent: Int32Array,
  endIndex: number,
  columns: number,
  cellSize: number,
  map: FormationNavigationMap,
): Vec2[] {
  const reversed: Vec2[] = [];
  let index = endIndex;
  while (index >= 0) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    reversed.push({
      x: Math.min(map.width, column * cellSize),
      y: Math.min(map.height, row * cellSize),
    });
    index = parent[index] ?? -1;
  }
  reversed.reverse();
  return reversed;
}

function simplifyRoute(
  start: Vec2,
  points: readonly Vec2[],
  map: FormationNavigationMap,
): Vec2[] {
  const simplified: Vec2[] = [];
  let anchor = start;
  let cursor = 0;
  while (cursor < points.length) {
    let furthest = cursor;
    for (let candidate = points.length - 1; candidate >= cursor; candidate -= 1) {
      const point = points[candidate];
      if (point && !map.segmentBlocked(anchor, point)) {
        furthest = candidate;
        break;
      }
    }
    const point = points[furthest];
    if (!point) break;
    simplified.push(copyPoint(point));
    anchor = point;
    cursor = furthest + 1;
  }
  return simplified;
}

function findGridRoute(
  start: Vec2,
  goal: Vec2,
  map: FormationNavigationMap,
  cellSize: number,
): Vec2[] | undefined {
  if (!map.segmentBlocked(start, goal)) return [copyPoint(goal)];
  const columns = Math.floor(map.width / cellSize) + 1;
  const rows = Math.floor(map.height / cellSize) + 1;
  const nodeCount = columns * rows;
  const startIndex = findConnectedNode(start, map, columns, rows, cellSize);
  const goalIndex = findConnectedNode(goal, map, columns, rows, cellSize);
  if (startIndex === undefined || goalIndex === undefined) return undefined;

  const costs = new Float64Array(nodeCount);
  costs.fill(Infinity);
  costs[startIndex] = 0;
  const estimates = new Float64Array(nodeCount);
  estimates.fill(Infinity);
  const parents = new Int32Array(nodeCount);
  parents.fill(-1);
  const open: number[] = [startIndex];
  const closed = new Uint8Array(nodeCount);
  const goalColumn = goalIndex % columns;
  const goalRow = Math.floor(goalIndex / columns);

  while (open.length > 0) {
    let bestOpen = 0;
    for (let index = 1; index < open.length; index += 1) {
      const candidate = open[index];
      const best = open[bestOpen];
      if (
        candidate !== undefined &&
        best !== undefined &&
        estimates[candidate] < estimates[best]
      ) {
        bestOpen = index;
      }
    }
    const current = open.splice(bestOpen, 1)[0];
    if (current === undefined || closed[current]) continue;
    if (current === goalIndex) {
      const nodes = reconstructRoute(parents, current, columns, cellSize, map);
      nodes.push(copyPoint(goal));
      return simplifyRoute(start, nodes, map);
    }
    closed[current] = 1;
    const column = current % columns;
    const row = Math.floor(current / columns);
    const currentPoint = {
      x: Math.min(map.width, column * cellSize),
      y: Math.min(map.height, row * cellSize),
    };
    for (const [columnStep, rowStep] of NEIGHBOURS) {
      const nextColumn = column + columnStep;
      const nextRow = row + rowStep;
      if (
        nextColumn < 0 ||
        nextRow < 0 ||
        nextColumn >= columns ||
        nextRow >= rows
      ) {
        continue;
      }
      const nextIndex = nextRow * columns + nextColumn;
      if (closed[nextIndex]) continue;
      const nextPoint = {
        x: Math.min(map.width, nextColumn * cellSize),
        y: Math.min(map.height, nextRow * cellSize),
      };
      if (map.isBlocked(nextPoint) || map.segmentBlocked(currentPoint, nextPoint)) continue;
      const terrainCost = Math.max(0.25, map.movementCost?.(nextPoint) ?? 1);
      const stepCost = Math.hypot(columnStep, rowStep) * cellSize / terrainCost;
      const nextCost = costs[current] + stepCost;
      if (nextCost >= costs[nextIndex]) continue;
      costs[nextIndex] = nextCost;
      parents[nextIndex] = current;
      const heuristic = Math.hypot(nextColumn - goalColumn, nextRow - goalRow) * cellSize;
      estimates[nextIndex] = nextCost + heuristic;
      if (!open.includes(nextIndex)) open.push(nextIndex);
    }
  }
  return undefined;
}

/**
 * Finds a deterministic unit-level route from passability geometry. It has no
 * knowledge of rivers, bridges or map-specific crossing coordinates.
 */
export function planFormationRoute(
  start: Vec2,
  goal: Vec2,
  map: FormationNavigationMap,
  options: FormationRouteOptions = {},
): Vec2[] | undefined {
  const cellSize = Math.max(24, options.cellSize ?? DEFAULT_CELL_SIZE);
  const approachDistance = Math.max(0, options.approachDistance ?? 0);
  const finalFacing = options.finalFacing;
  if (
    finalFacing === undefined ||
    approachDistance <= 0 ||
    Math.hypot(goal.x - start.x, goal.y - start.y) <= approachDistance * 1.35
  ) {
    return findGridRoute(start, goal, map, cellSize);
  }

  const approach = {
    x: goal.x - Math.sin(finalFacing) * approachDistance,
    y: goal.y + Math.cos(finalFacing) * approachDistance,
  };
  if (
    approach.x < 0 ||
    approach.y < 0 ||
    approach.x > map.width ||
    approach.y > map.height ||
    map.isBlocked(approach) ||
    map.segmentBlocked(approach, goal)
  ) {
    return findGridRoute(start, goal, map, cellSize);
  }
  const route = findGridRoute(start, approach, map, cellSize);
  if (!route) return findGridRoute(start, goal, map, cellSize);
  route.push(copyPoint(goal));
  return route;
}

export function assignFormationMoveOrder(
  unit: Unit,
  goal: Vec2,
  facing: number,
  map: FormationNavigationMap,
): boolean {
  const finalDestination = copyPoint(goal);
  const route = planFormationRoute(unit.position, finalDestination, map, {
    finalFacing: facing,
    approachDistance: Math.min(110, Math.max(54, unit.formationWidth * 0.45)),
  });
  unit.pathingState = route ? "direct" : "blocked";
  unit.stuckTimer = 0;
  unit.fallbackDestination = undefined;
  unit.pathGoal = finalDestination;
  unit.pathFacing = facing;
  if (!route || route.length === 0) {
    unit.order = { type: "hold" };
    return false;
  }
  unit.order = {
    type: "move",
    destination: copyPoint(route[0] ?? finalDestination),
    finalDestination,
    facing,
    route,
    routeIndex: 0,
  };
  return true;
}
