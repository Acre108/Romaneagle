import type { Direction, GameState } from "../model/types";
import { blockFormation } from "../model/occupancy";

/** Blocks face where their formation faces; turning a formation in contact costs its activation. */
export function blockFacing(state: GameState, blockId: string): Direction {
  const block = state.blocks[blockId];
  const formation = blockFormation(state, block);
  return formation?.facing ?? "north";
}
