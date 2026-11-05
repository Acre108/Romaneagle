import type { GameEvent, GridPosition } from "../model/types";

export interface CasualtyTileMarker {
  position: GridPosition;
  casualties: number;
}

export function updateCasualtyMarkers(
  bodyTiles: Map<string, CasualtyTileMarker>,
  turnSkulls: Map<string, CasualtyTileMarker>,
  events: readonly GameEvent[],
): void {
  if (events.some((event) => event.type === "activation_ended")) turnSkulls.clear();
  for (const event of events) {
    if (event.type !== "block_damaged" || !event.position || !event.casualties || event.casualties <= 0) continue;
    const key = `${event.position.x},${event.position.y}`;
    for (const markers of [bodyTiles, turnSkulls]) {
      const existing = markers.get(key);
      markers.set(key, {
        position: { ...event.position },
        casualties: (existing?.casualties ?? 0) + event.casualties,
      });
    }
  }
}
