import type { Direction, GridPosition } from "../model/types";

export const CARDINAL_DIRECTIONS: readonly Direction[] = ["north", "east", "south", "west"];

export function directionVector(direction: Direction): GridPosition {
  switch (direction) {
    case "north": return { x: 0, y: -1 };
    case "east": return { x: 1, y: 0 };
    case "south": return { x: 0, y: 1 };
    case "west": return { x: -1, y: 0 };
  }
}

export function oppositeDirection(direction: Direction): Direction {
  return CARDINAL_DIRECTIONS[(CARDINAL_DIRECTIONS.indexOf(direction) + 2) % 4]!;
}

export function rotateDirection(direction: Direction, turn: "left" | "right"): Direction {
  const delta = turn === "right" ? 1 : 3;
  return CARDINAL_DIRECTIONS[(CARDINAL_DIRECTIONS.indexOf(direction) + delta) % 4]!;
}

export function addPosition(position: GridPosition, vector: GridPosition, distance = 1): GridPosition {
  return { x: position.x + vector.x * distance, y: position.y + vector.y * distance };
}

export function isCardinalStep(from: GridPosition, to: GridPosition): boolean {
  return manhattanDistance(from, to) === 1;
}

export function directionBetween(from: GridPosition, to: GridPosition): Direction | null {
  if (!isCardinalStep(from, to)) return null;
  if (to.y < from.y) return "north";
  if (to.x > from.x) return "east";
  if (to.y > from.y) return "south";
  return "west";
}

export function orthogonalNeighbours(position: GridPosition): GridPosition[] {
  return CARDINAL_DIRECTIONS.map((direction) => addPosition(position, directionVector(direction)));
}

export function manhattanDistance(a: GridPosition, b: GridPosition): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function facingContactModifier(defenderFacing: Direction, incomingDirection: Direction): number {
  if (incomingDirection === defenderFacing) return 0;
  if (incomingDirection === oppositeDirection(defenderFacing)) return -4;
  return -2;
}

export function formationEdgeType(
  facing: Direction,
  edge: Direction,
): "front" | "side" | "rear" {
  if (edge === facing) return "front";
  if (edge === oppositeDirection(facing)) return "rear";
  return "side";
}
