import { clamp, type Vec2 } from "../core/math";
import type { Unit, UnitTerrain } from "./types";
import type { Battlefield, Decoration } from "../world/Battlefield";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../world/Battlefield";

export const FORMATION_MAP_MARGIN = 7;
export const FORMATION_STREAM_CLEARANCE = 35;
export const SAXON_FORMATION_FLOW_CLEARANCE = 14;
export const TERRAIN_COVERAGE_THRESHOLD = 0.2;
const TREE_PADDING = 8;
const ROCK_PADDING = 6;
const CONSTRAINT_PASSES = 2;

export interface FormationTerrainCoverage {
  deepWater: number;
  shallowWater: number;
  woods: number;
  rough: number;
  road: number;
}

export function calculateFormationTerrainCoverage(
  unit: Unit,
  centreX: number,
  centreY: number,
  battlefield: Battlefield,
  output: FormationTerrainCoverage,
  pointScratch: Vec2,
): FormationTerrainCoverage {
  output.deepWater = 0;
  output.shallowWater = 0;
  output.woods = 0;
  output.rough = 0;
  output.road = 0;
  const count = Math.max(1, unit.soldierCount);
  const cos = Math.cos(unit.facing);
  const sin = Math.sin(unit.facing);
  for (let index = 0; index < unit.soldierCount; index += 1) {
    const soldier = unit.soldiers[index];
    if (!soldier) continue;
    const localX = unit.crossingPhase ? soldier.targetX : soldier.baseX;
    const localY = unit.crossingPhase ? soldier.targetY : soldier.baseY;
    pointScratch.x = centreX + localX * cos - localY * sin;
    pointScratch.y = centreY + localX * sin + localY * cos;
    if (battlefield.isDeepWater(pointScratch)) output.deepWater += 1;
    else if (battlefield.isShallowWater(pointScratch)) output.shallowWater += 1;
    if (battlefield.isInWoods(pointScratch)) output.woods += 1;
    if (battlefield.isRough(pointScratch)) output.rough += 1;
    if (battlefield.isOnRoad(pointScratch)) output.road += 1;
  }
  output.deepWater /= count;
  output.shallowWater /= count;
  output.woods /= count;
  output.rough /= count;
  output.road /= count;
  return output;
}

export function classifyFormationTerrain(coverage: FormationTerrainCoverage): UnitTerrain {
  if (coverage.deepWater > TERRAIN_COVERAGE_THRESHOLD) return "deep water";
  if (coverage.shallowWater > TERRAIN_COVERAGE_THRESHOLD) return "shallow water";
  if (coverage.woods > TERRAIN_COVERAGE_THRESHOLD) return "woods";
  if (coverage.rough > TERRAIN_COVERAGE_THRESHOLD) return "rough";
  if (coverage.road > TERRAIN_COVERAGE_THRESHOLD) return "road";
  return "open";
}

function pushOutsideCircle(
  point: Vec2,
  obstacle: Decoration,
  clearance: number,
  fallbackDirection: number,
): void {
  const dx = point.x - obstacle.x;
  const dy = point.y - obstacle.y;
  const distanceSquared = dx * dx + dy * dy;
  if (distanceSquared >= clearance * clearance) return;
  if (distanceSquared < 0.0001) {
    point.x = obstacle.x + Math.cos(fallbackDirection) * clearance;
    point.y = obstacle.y + Math.sin(fallbackDirection) * clearance;
    return;
  }
  const scale = clearance / Math.sqrt(distanceSquared);
  point.x = obstacle.x + dx * scale;
  point.y = obstacle.y + dy * scale;
}

/**
 * Constrains one subordinate formation slot in world space. This is visual
 * formation deformation only; it does not give soldiers tactical movement.
 */
export function constrainFormationWorldPoint(
  worldX: number,
  worldY: number,
  battlefield: Battlefield,
  output: Vec2,
  flowClearance = 0,
  preferredStreamSide?: -1 | 1,
): Vec2 {
  output.x = clamp(worldX, FORMATION_MAP_MARGIN, WORLD_WIDTH - FORMATION_MAP_MARGIN);
  output.y = clamp(worldY, FORMATION_MAP_MARGIN, WORLD_HEIGHT - FORMATION_MAP_MARGIN);

  for (let pass = 0; pass < CONSTRAINT_PASSES; pass += 1) {
    if (battlefield.isDeepWater(output)) {
      const streamY = battlefield.streamY(output.x);
      const streamOffset = output.y - streamY;
      output.y = streamY +
        (preferredStreamSide ?? (streamOffset < 0 ? -1 : 1)) *
          (FORMATION_STREAM_CLEARANCE + flowClearance);
    }
    for (let index = 0; index < battlefield.trees.length; index += 1) {
      const tree = battlefield.trees[index];
      if (tree) {
        pushOutsideCircle(
          output,
          tree,
          tree.size + TREE_PADDING + flowClearance,
          index * 1.73,
        );
      }
    }
    for (let index = 0; index < battlefield.rocks.length; index += 1) {
      const rock = battlefield.rocks[index];
      if (rock) {
        pushOutsideCircle(
          output,
          rock,
          rock.size + ROCK_PADDING + flowClearance,
          index * 2.11,
        );
      }
    }
    output.x = clamp(output.x, FORMATION_MAP_MARGIN, WORLD_WIDTH - FORMATION_MAP_MARGIN);
    output.y = clamp(output.y, FORMATION_MAP_MARGIN, WORLD_HEIGHT - FORMATION_MAP_MARGIN);
  }
  return output;
}
