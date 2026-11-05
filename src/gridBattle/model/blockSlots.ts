import type { GameState, TroopBlock } from "./types";
import { isCavalry } from "./unitStats";

type CharacterBlock = Pick<TroopBlock, "formationId" | "models" | "modelCapacity" | "characterId">;
type ContestedBlock = CharacterBlock & Pick<TroopBlock, "factionId" | "id">;

export type BlockSlotIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type BlockSlotMask = number;

export interface BlockSlotCoordinate {
  column: 0 | 1 | 2;
  row: 0 | 1 | 2;
}

export interface BlockSlotOccupancy {
  soldierMask: BlockSlotMask;
  characterMask: BlockSlotMask;
  occupiedMask: BlockSlotMask;
}

export interface ContestedBlockSlotOccupancy extends BlockSlotOccupancy {
  blockId: string;
}

export const BLOCK_SLOT_COUNT = 9;
export const ALL_BLOCK_SLOTS_MASK = 0b1_1111_1111;
export const BLOCK_SLOT_COORDINATES: readonly BlockSlotCoordinate[] = [
  { column: 0, row: 0 }, { column: 1, row: 0 }, { column: 2, row: 0 },
  { column: 0, row: 1 }, { column: 1, row: 1 }, { column: 2, row: 1 },
  { column: 0, row: 2 }, { column: 1, row: 2 }, { column: 2, row: 2 },
];

const CLOSE_ORDER: readonly BlockSlotIndex[] = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const OPEN_ORDER: readonly BlockSlotIndex[] = [0, 2, 4, 6, 8, 1, 3, 5, 7];
const CAVALRY_ORDER: readonly BlockSlotIndex[] = [3, 4, 5, 0, 2, 6, 8, 1, 7];
const CHARACTER_ORDER: readonly BlockSlotIndex[] = [4, 1, 3, 5, 7, 0, 2, 6, 8];
const ROMAN_DUEL_ORDER: readonly BlockSlotIndex[] = [3, 4, 1, 7, 0, 6, 2, 8, 5];
const SAXON_DUEL_ORDER: readonly BlockSlotIndex[] = [5, 4, 1, 7, 2, 8, 0, 6, 3];

export function normalBlockSlotCapacity(state: GameState, block: CharacterBlock): number {
  const formation = block.formationId ? state.formations[block.formationId] : undefined;
  return formation ? Math.min(BLOCK_SLOT_COUNT, block.modelCapacity) : 0;
}

export function blockSlotBit(index: BlockSlotIndex): BlockSlotMask {
  return 1 << index;
}

export function blockSlotMask(indices: readonly BlockSlotIndex[]): BlockSlotMask {
  return indices.reduce<number>((mask, index) => mask | blockSlotBit(index), 0);
}

export function blockSlotIndices(mask: BlockSlotMask): BlockSlotIndex[] {
  const indices: BlockSlotIndex[] = [];
  for (let index = 0; index < BLOCK_SLOT_COUNT; index += 1) {
    const slot = index as BlockSlotIndex;
    if ((mask & blockSlotBit(slot)) !== 0) indices.push(slot);
  }
  return indices;
}

export function blockSlotCount(mask: BlockSlotMask): number {
  let count = 0;
  for (let index = 0; index < BLOCK_SLOT_COUNT; index += 1) {
    if ((mask & (1 << index)) !== 0) count += 1;
  }
  return count;
}

export function preferredSoldierSlotOrder(state: GameState, block: CharacterBlock): readonly BlockSlotIndex[] {
  const formation = block.formationId ? state.formations[block.formationId] : undefined;
  if (formation && isCavalry(formation.unit.unitType)) return CAVALRY_ORDER;
  return formation?.formationMode === "closed" ? CLOSE_ORDER : OPEN_ORDER;
}

export function visibleBlockOccupantCount(state: GameState, block: CharacterBlock): number {
  if (block.models <= 0 || block.modelCapacity <= 0) return 0;
  const fullCount = normalBlockSlotCapacity(state, block);
  return Math.min(fullCount, Math.max(1, Math.ceil(fullCount * block.models / block.modelCapacity)));
}

function fillPreferredSlots(
  order: readonly BlockSlotIndex[],
  count: number,
  unavailableMask: BlockSlotMask,
): BlockSlotMask {
  let mask = 0;
  let remaining = count;
  for (const index of order) {
    const bit = blockSlotBit(index);
    if ((unavailableMask & bit) !== 0) continue;
    mask |= bit;
    remaining -= 1;
    if (remaining <= 0) break;
  }
  return mask;
}

export function deriveBlockSlotOccupancy(
  state: GameState,
  block: CharacterBlock,
  unavailableMask: BlockSlotMask = 0,
): BlockSlotOccupancy {
  const visibleCount = visibleBlockOccupantCount(state, block);
  const characterMask = block.characterId && visibleCount > 0
    ? fillPreferredSlots(CHARACTER_ORDER, 1, unavailableMask)
    : 0;
  const soldierCount = Math.max(0, visibleCount - (characterMask === 0 ? 0 : 1));
  const soldierMask = fillPreferredSlots(
    preferredSoldierSlotOrder(state, block),
    soldierCount,
    unavailableMask | characterMask,
  );
  return {
    soldierMask,
    characterMask,
    occupiedMask: soldierMask | characterMask,
  };
}

export function deriveContestedCellSlotOccupancies(
  state: GameState,
  blocks: readonly ContestedBlock[],
  unavailableMask: BlockSlotMask = 0,
  duelActive = false,
): ContestedBlockSlotOccupancy[] {
  const orderedBlocks = [...blocks].sort((a, b) =>
    a.factionId.localeCompare(b.factionId) || a.id.localeCompare(b.id));
  let claimedMask = unavailableMask;
  const occupancies = orderedBlocks.map((block) => {
    const visibleCount = visibleBlockOccupantCount(state, block);
    const characterOrder = duelActive
      ? block.factionId === "roman" ? ROMAN_DUEL_ORDER : SAXON_DUEL_ORDER
      : CHARACTER_ORDER;
    const characterMask = block.characterId && visibleCount > 0
      ? fillPreferredSlots(characterOrder, 1, claimedMask)
      : 0;
    claimedMask |= characterMask;
    return {
      block,
      visibleSoldiers: Math.max(0, visibleCount - (characterMask === 0 ? 0 : 1)),
      blockId: block.id,
      soldierMask: 0,
      characterMask,
      occupiedMask: characterMask,
    };
  });

  let placedSoldier = true;
  while (placedSoldier) {
    placedSoldier = false;
    for (const occupancy of occupancies) {
      if (blockSlotCount(occupancy.soldierMask) >= occupancy.visibleSoldiers) continue;
      const nextMask = fillPreferredSlots(
        preferredSoldierSlotOrder(state, occupancy.block),
        1,
        claimedMask,
      );
      if (nextMask === 0) continue;
      occupancy.soldierMask |= nextMask;
      occupancy.occupiedMask |= nextMask;
      claimedMask |= nextMask;
      placedSoldier = true;
    }
  }

  return occupancies.map(({ block: _block, visibleSoldiers: _visibleSoldiers, ...occupancy }) => occupancy);
}
