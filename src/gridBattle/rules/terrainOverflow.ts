import { emitEvent } from "../events/events";
import { inBounds, positionKey } from "../model/occupancy";
import {
  terrainBlockCapacityAt,
  terrainBlocksVoluntaryRelocation,
} from "../model/terrain";
import type { GameState, GridPosition, TroopBlock } from "../model/types";
import { orthogonalNeighbours } from "./direction";

export interface BlockRelocation {
  block: TroopBlock;
  origin: GridPosition;
  destination: GridPosition;
}

export interface TerrainOverflow {
  sourceBlockId: string;
  models: number;
  position: GridPosition;
}

export function planTerrainOverflow(
  state: GameState,
  relocations: readonly BlockRelocation[],
): TerrainOverflow[] | null {
  const movingIds = new Set(relocations.map(({ block }) => block.id));
  const occupied = new Set(
    Object.values(state.blocks)
      .filter((block) => !movingIds.has(block.id))
      .map((block) => positionKey(block.position)),
  );
  for (const { destination } of relocations) {
    if (inBounds(state, destination)) occupied.add(positionKey(destination));
  }
  const overflow: TerrainOverflow[] = [];
  for (const relocation of relocations) {
    if (!inBounds(state, relocation.destination)) continue;
    if (terrainBlocksVoluntaryRelocation(state, relocation.origin, relocation.destination)) return null;
    const capacity = terrainBlockCapacityAt(state, relocation.destination, relocation.block.modelCapacity);
    if (capacity === 0 && relocation.block.models > 0) return null;
    const excess = Math.max(0, relocation.block.models - capacity);
    if (excess === 0) continue;
    const seen = new Set<string>();
    const candidates = [
      relocation.origin,
      ...orthogonalNeighbours(relocation.origin),
      ...orthogonalNeighbours(relocation.destination),
    ].filter((position) => {
      const key = positionKey(position);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const position = candidates.find((candidate) => {
      if (!inBounds(state, candidate) || occupied.has(positionKey(candidate))) return false;
      return !terrainBlocksVoluntaryRelocation(state, relocation.destination, candidate)
        && terrainBlockCapacityAt(state, candidate, relocation.block.modelCapacity) >= excess;
    });
    if (!position) return null;
    occupied.add(positionKey(position));
    overflow.push({ sourceBlockId: relocation.block.id, models: excess, position: { ...position } });
  }
  return overflow;
}

function nextTerrainOverflowId(state: GameState, sourceBlockId: string): string {
  let suffix = 1;
  while (state.blocks[`${sourceBlockId}-overflow-${suffix}`]) suffix += 1;
  return `${sourceBlockId}-overflow-${suffix}`;
}

export function applyTerrainOverflow(state: GameState, overflow: readonly TerrainOverflow[]): string[] {
  const createdIds: string[] = [];
  for (const item of overflow) {
    const source = state.blocks[item.sourceBlockId];
    const formation = source?.formationId ? state.formations[source.formationId] : undefined;
    if (!source || !formation) continue;
    source.models -= item.models;
    const id = nextTerrainOverflowId(state, source.id);
    state.blocks[id] = {
      ...source,
      id,
      position: { ...item.position },
      models: item.models,
      wounds: 0,
      characterId: null,
      isContested: false,
      chargeDistance: 0,
      chargeMomentum: 0,
    };
    formation.blockIds.push(id);
    createdIds.push(id);
    emitEvent(state, "terrain_overflow", `${item.models} models from ${source.id} formed ${id} because they could not fit in the terrain.`, {
      blockIds: [source.id, id],
      formationIds: [formation.id],
      position: { ...item.position },
    });
  }
  return createdIds;
}
