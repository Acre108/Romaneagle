import { emitEvent } from "../events/events";
import { blocksAt } from "../model/occupancy";
import type { Formation, GameState, GridPosition, TroopBlock } from "../model/types";
import { clearFormationBrace } from "./brace";
import { addPosition, directionBetween, directionVector, oppositeDirection } from "./direction";
import { recalculateFormationConnectivity } from "./splitting";
import { blockIsWavering } from "./wavering";
import { applyTerrainOverflow, planTerrainOverflow } from "./terrainOverflow";

export interface FileAdvanceOptions {
  reason?: "combat" | "charge";
  stopAtWavering?: boolean;
}

export function advanceCombatFile(
  state: GameState,
  formation: Formation,
  leadBlockId: string,
  leadOrigin: GridPosition,
  destination: GridPosition,
  options: FileAdvanceOptions = {},
): string[] {
  const lead = state.blocks[leadBlockId];
  const advanceDirection = directionBetween(leadOrigin, destination);
  if (!lead || !advanceDirection) return [];
  const rearward = directionVector(oppositeDirection(advanceDirection));
  const followers: TroopBlock[] = [];
  let cursor = leadOrigin;
  while (true) {
    cursor = addPosition(cursor, rearward);
    const follower = blocksAt(state, cursor)
      .find((block) => block.formationId === formation.id && !block.isContested);
    if (!follower) break;
    followers.push(follower);
  }

  const moved = [lead];
  for (const follower of followers) {
    if ((options.stopAtWavering ?? true) && blockIsWavering(state, follower.id)) break;
    moved.push(follower);
  }
  const relocations = moved.map((block, index) => ({
    block,
    origin: { ...block.position },
    destination: index === 0 ? { ...destination } : { ...moved[index - 1]!.position },
  }));
  const overflow = planTerrainOverflow(state, relocations);
  if (!overflow) return [];
  clearFormationBrace(state, formation.id);
  for (const relocation of relocations) relocation.block.position = { ...relocation.destination };
  const overflowIds = applyTerrainOverflow(state, overflow);
  const reason = options.reason === "charge" ? "the charge" : "combat";
  emitEvent(state, "formation_moved", `${formation.name} advanced after ${reason}; ${moved.length - 1} rear block${moved.length === 2 ? "" : "s"} followed the lead block.`, {
    blockIds: [...moved.map((block) => block.id), ...overflowIds],
    formationIds: [formation.id],
    position: { ...destination },
  });
  recalculateFormationConnectivity(state, formation.id);
  return [...moved.map((block) => block.id), ...overflowIds];
}
