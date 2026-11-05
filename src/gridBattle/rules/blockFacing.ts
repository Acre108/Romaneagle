import type { Direction, GameState } from "../model/types";

/** Blocks face where their formation faces; turning a formation in contact costs its activation. */
export function blockFacing(state: GameState, blockId: string): Direction {
  const block = state.blocks[blockId];
  const formation = block?.formationId ? state.formations[block.formationId] : undefined;
  return formation?.facing ?? "north";
}
