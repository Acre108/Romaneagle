import type { CellOccupancy, FactionId, Formation, GameState, GridPosition, TroopBlock } from "./types";

export function positionKey(position: GridPosition): string {
  return `${position.x},${position.y}`;
}

export function samePosition(a: GridPosition, b: GridPosition): boolean {
  return a.x === b.x && a.y === b.y;
}

export function blockFormation(state: Pick<GameState, "formations">, block: Pick<TroopBlock, "formationId"> | undefined): Formation | undefined {
  return block?.formationId ? state.formations[block.formationId] : undefined;
}

export function inBounds(state: Pick<GameState, "battlefield">, position: GridPosition): boolean {
  return position.x >= 0 && position.y >= 0
    && position.x < state.battlefield.width && position.y < state.battlefield.height;
}

export function blocksAt(state: GameState, position: GridPosition): TroopBlock[] {
  return Object.values(state.blocks).filter((block) => samePosition(block.position, position));
}

export function occupancyAt(state: GameState, position: GridPosition): CellOccupancy {
  const occupancy: CellOccupancy = { romanBlockId: null, saxonBlockId: null };
  for (const block of blocksAt(state, position)) {
    if (block.factionId === "roman") occupancy.romanBlockId = block.id;
    else occupancy.saxonBlockId = block.id;
  }
  return occupancy;
}

export function friendlyBlockAt(
  state: GameState,
  position: GridPosition,
  factionId: FactionId,
): TroopBlock | undefined {
  return blocksAt(state, position).find((block) => block.factionId === factionId);
}

export function enemyBlockAt(
  state: GameState,
  position: GridPosition,
  factionId: FactionId,
): TroopBlock | undefined {
  return blocksAt(state, position).find((block) => block.factionId !== factionId);
}
