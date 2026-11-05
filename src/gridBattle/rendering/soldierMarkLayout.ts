import {
  BLOCK_SLOT_COORDINATES,
  blockSlotIndices,
  deriveBlockSlotOccupancy,
  normalBlockSlotCapacity,
  preferredSoldierSlotOrder,
} from "../model/blockSlots";
import type { GameState, GridPosition, TroopBlock } from "../model/types";

export const BLOCK_SLOT_POINTS: readonly GridPosition[] = BLOCK_SLOT_COORDINATES.map(({ column, row }) => ({
  x: 14 + column * 12,
  y: 14 + row * 12,
}));

export function soldierMarkLayout(state: GameState, block: TroopBlock): readonly GridPosition[] {
  return preferredSoldierSlotOrder(state, block)
    .slice(0, normalBlockSlotCapacity(state, block))
    .map((index) => BLOCK_SLOT_POINTS[index]!);
}

export function visibleSoldierMarkCount(state: GameState, block: TroopBlock): number {
  return blockSlotIndices(deriveBlockSlotOccupancy(state, { ...block, characterId: null }).soldierMask).length;
}

export function visibleRegularSoldierMarkCount(state: GameState, block: TroopBlock): number {
  return blockSlotIndices(deriveBlockSlotOccupancy(state, block).soldierMask).length;
}

export type SoldierArtKind = "roman-century" | "saxon-basic" | "saxon-detailed";

function belongsToFormation(formationId: string, baseId: string): boolean {
  return formationId === baseId || formationId.startsWith(`${baseId}-fragment-`);
}

export function soldierArtKind(state: GameState, block: TroopBlock): SoldierArtKind | null {
  const formationId = block.formationId;
  if (!formationId) return null;
  const formation = state.formations[formationId];
  if (
    block.factionId === "roman"
    && formation?.unit.unitType === "heavy_infantry"
    && belongsToFormation(formationId, "legio-i")
  ) {
    return "roman-century";
  }
  if (block.factionId !== "saxon") return null;
  if (belongsToFormation(formationId, "great-warband")) return "saxon-basic";
  if (belongsToFormation(formationId, "loose-warband")) return "saxon-detailed";
  return null;
}

export function usesRomanCenturySoldierArt(state: GameState, block: TroopBlock): boolean {
  return soldierArtKind(state, block) === "roman-century";
}
