import type { Direction, GameState, GridPosition, TroopBlock } from "../model/types";
import { CARDINAL_DIRECTIONS, manhattanDistance } from "./direction";

function directionToward(from: GridPosition, target: GridPosition, fallback: Direction): Direction {
  const deltaX = target.x - from.x;
  const deltaY = target.y - from.y;
  const horizontal: Direction | null = deltaX === 0 ? null : deltaX > 0 ? "east" : "west";
  const vertical: Direction | null = deltaY === 0 ? null : deltaY > 0 ? "south" : "north";
  if (!horizontal) return vertical ?? fallback;
  if (!vertical) return horizontal;
  if (Math.abs(deltaX) > Math.abs(deltaY)) return horizontal;
  if (Math.abs(deltaY) > Math.abs(deltaX)) return vertical;
  if (fallback === horizontal || fallback === vertical) return fallback;
  return [horizontal, vertical].sort((a, b) => CARDINAL_DIRECTIONS.indexOf(a) - CARDINAL_DIRECTIONS.indexOf(b))[0]!;
}

export function effectiveBlockFacing(state: GameState, blockId: string): Direction {
  const block = state.blocks[blockId];
  const formation = block?.formationId ? state.formations[block.formationId] : undefined;
  return block?.engagementFacing ?? formation?.facing ?? "north";
}

export function faceFormationTowardNearestEnemies(state: GameState, formationId: string): string[] {
  const formation = state.formations[formationId];
  if (!formation) return [];
  const enemies = Object.values(state.blocks).filter((block) => block.factionId !== formation.factionId);
  const facedIds: string[] = [];
  for (const blockId of formation.blockIds) {
    const block = state.blocks[blockId];
    if (!block) continue;
    const target = [...enemies].sort((a, b) =>
      manhattanDistance(block.position, a.position) - manhattanDistance(block.position, b.position)
        || a.id.localeCompare(b.id))[0];
    block.engagementFacing = target ? directionToward(block.position, target.position, formation.facing) : undefined;
    if (target) facedIds.push(block.id);
  }
  return facedIds;
}

export function clearFormationEngagementFacings(state: GameState, formationId: string): void {
  const formation = state.formations[formationId];
  if (!formation) return;
  for (const blockId of formation.blockIds) {
    const block: TroopBlock | undefined = state.blocks[blockId];
    if (block) block.engagementFacing = undefined;
  }
}
