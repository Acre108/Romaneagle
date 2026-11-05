import { BALANCE } from "../model/config";
import type { GameState, TroopBlock } from "../model/types";
import { manhattanDistance } from "./direction";

function commandMoraleBonus(state: GameState, block: TroopBlock): number {
  return Object.values(state.characters).some((character) => {
    if (character.role !== "commander" || character.factionId !== block.factionId || character.status === "defeated") return false;
    const host = state.blocks[character.hostBlockId];
    return host && manhattanDistance(host.position, block.position) <= character.commandRadius;
  }) ? 1 : 0;
}

/** A breaking formation's blocks push with less force. A commander in range holds a block one morale point longer. */
export function blockIsBreaking(state: GameState, blockId: string): boolean {
  const block = state.blocks[blockId];
  if (!block) return false;
  const formation = block.formationId ? state.formations[block.formationId] : undefined;
  return (formation?.cohesion ?? 0) + commandMoraleBonus(state, block) <= BALANCE.breakingMoraleThreshold;
}

/**
 * A wavering block is easier to shove and will not advance or brace. It wavers after
 * being shoved or cut off, while intermingled with the enemy, and while breaking. It can
 * still push back on its own order, so a matched fight does not end with the first shove.
 */
export function blockIsWavering(state: GameState, blockId: string): boolean {
  const block = state.blocks[blockId];
  if (!block) return false;
  return block.wavering || block.isContested || blockIsBreaking(state, blockId);
}
