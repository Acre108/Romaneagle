import type { GameState } from "./types";

/**
 * A private copy of a battle to try an order on. Battle rules never change the map,
 * so every copy shares it, and a simulation only reads events it caused itself.
 * Copying the map and the log made up about four fifths of the cost of a full copy.
 */
export function simulationCopy(state: GameState): GameState {
  const { battlefield, eventLog: _eventLog, ...rest } = state;
  return { ...structuredClone(rest), battlefield, eventLog: [] };
}
