import type { GameEvent, GameEventType, GameState } from "../model/types";

export function emitEvent(
  state: GameState,
  type: GameEventType,
  message: string,
  detail: Pick<GameEvent, "blockIds" | "formationIds" | "position" | "sourcePosition" | "sourcePositions" | "targetPositions" | "projectileKind" | "casualties" | "departingBlocks" | "triggerId"> = {},
): GameEvent {
  const event: GameEvent = { id: state.nextEventId++, type, message, ...detail };
  state.eventLog.push(event);
  if (state.eventLog.length > 120) state.eventLog.splice(0, state.eventLog.length - 120);
  return event;
}

/** Events are matched by id because the capped log's length stops growing once it is full. */
export function eventsSince(eventLog: readonly GameEvent[], firstEventId: number): GameEvent[] {
  return eventLog.filter((event) => event.id >= firstEventId);
}
