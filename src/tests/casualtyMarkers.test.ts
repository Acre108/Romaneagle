import { describe, expect, it } from "vitest";
import type { GameEvent } from "../gridBattle/model/types";
import {
  updateCasualtyMarkers,
  type CasualtyTileMarker,
} from "../gridBattle/rendering/casualtyMarkers";

function event(id: number, partial: Omit<GameEvent, "id" | "message">): GameEvent {
  return { id, message: partial.type, ...partial };
}

describe("casualty markers", () => {
  it("keeps body taint but clears floating skulls after the following activation", () => {
    const bodyTiles = new Map<string, CasualtyTileMarker>();
    const turnSkulls = new Map<string, CasualtyTileMarker>();
    updateCasualtyMarkers(bodyTiles, turnSkulls, [
      event(1, {
        type: "block_damaged",
        blockIds: ["saxon-b1"],
        position: { x: 4, y: 3 },
        casualties: 2,
      }),
      event(2, { type: "activation_ended", formationIds: ["roman"] }),
    ]);
    expect(bodyTiles.get("4,3")).toEqual({
      position: { x: 4, y: 3 },
      casualties: 2,
    });
    expect(turnSkulls.get("4,3")).toEqual(bodyTiles.get("4,3"));

    updateCasualtyMarkers(
      bodyTiles,
      turnSkulls,
      [event(3, { type: "activation_ended", formationIds: ["saxon"] })],
    );
    expect(bodyTiles.get("4,3")?.casualties).toBe(2);
    expect(turnSkulls.size).toBe(0);
  });

  it("accumulates deaths by tile but ignores damage without casualties", () => {
    const bodyTiles = new Map<string, CasualtyTileMarker>();
    const turnSkulls = new Map<string, CasualtyTileMarker>();
    updateCasualtyMarkers(bodyTiles, turnSkulls, [
      event(1, {
        type: "block_damaged",
        blockIds: ["roman-b1"],
        position: { x: 2, y: 6 },
        casualties: 1,
      }),
      event(2, {
        type: "block_damaged",
        blockIds: ["roman-b1"],
        position: { x: 2, y: 6 },
        casualties: 2,
      }),
      event(3, {
        type: "block_damaged",
        blockIds: ["roman-b2"],
        position: { x: 3, y: 6 },
        casualties: 0,
      }),
    ]);
    expect(bodyTiles.get("2,6")?.casualties).toBe(3);
    expect(turnSkulls.get("2,6")?.casualties).toBe(3);
    expect(bodyTiles.has("3,6")).toBe(false);
  });
});
