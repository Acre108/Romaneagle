import { describe, expect, it } from "vitest";
import { executeCommand } from "../gridBattle/commands/executeCommand";
import { emitEvent } from "../gridBattle/events/events";
import {
  addMapTrigger,
  parseBattlefieldMap,
  serializeBattlefieldMap,
} from "../gridBattle/model/battlefieldMap";
import type { TriggerSpawnFormation } from "../gridBattle/model/triggerDefinitions";
import { evaluateMapTriggers } from "../gridBattle/rules/triggers";
import { addFormation, blankState } from "./gridBattleTestState";

const spawnedRaiders: TriggerSpawnFormation = {
  id: "spawned-raiders",
  name: "Spawned Raiders",
  factionId: "saxon",
  facing: "west",
  formationMode: "closed",
  cohesion: 8,
  maxCohesion: 10,
  unit: {
    unitType: "light_infantry",
    modelSize: 2,
    attack: 3,
    armour: 0,
    defence: 0,
    hitPointsPerModel: 1,
    movement: 4,
    equipment: [],
  },
  positions: [{ x: 6, y: 2 }],
};

describe("map triggers", () => {
  it("authors, serializes, and validates trigger definitions", () => {
    const state = blankState();
    addMapTrigger(state.battlefield, {
      id: "warning",
      label: "Ambush warning",
      once: true,
      condition: { type: "formation_enters", positions: [{ x: 2, y: 1 }], factionId: "roman" },
      effects: [{ type: "character_interaction", speaker: "Scout", text: "Movement in the trees!" }],
    });

    const document = serializeBattlefieldMap(state.battlefield);
    expect(parseBattlefieldMap(JSON.parse(JSON.stringify(document))).triggers).toEqual(state.battlefield.triggers);
    expect(() => addMapTrigger(state.battlefield, {
      ...state.battlefield.triggers[0]!,
      label: "Duplicate",
    })).toThrow("already in use");
  });

  it("fires an entry interaction after an accepted movement command and consumes a one-shot trigger", () => {
    const state = blankState();
    addFormation(state, "legion", [{ x: 1, y: 1 }], "east");
    addMapTrigger(state.battlefield, {
      id: "crossing-warning",
      label: "Crossing warning",
      once: true,
      condition: { type: "formation_enters", positions: [{ x: 2, y: 1 }], factionId: "roman" },
      effects: [{ type: "character_interaction", characterId: "guide", speaker: "Guide", text: "This road is watched." }],
    });

    expect(executeCommand(state, { type: "select_cell", position: { x: 1, y: 1 } }).accepted).toBe(true);
    expect(executeCommand(state, { type: "choose_action", action: "move" }).accepted).toBe(true);
    expect(executeCommand(state, { type: "move", direction: "east" }).accepted).toBe(true);
    expect(state.triggerState.fireCounts["crossing-warning"]).toBe(1);
    expect(state.triggerState.interactions).toEqual([{
      triggerId: "crossing-warning",
      characterId: "guide",
      speaker: "Guide",
      text: "This road is watched.",
    }]);
    expect(state.eventLog.some((event) => event.type === "trigger_interaction")).toBe(true);

    executeCommand(state, { type: "move", direction: "west" });
    executeCommand(state, { type: "move", direction: "east" });
    expect(state.triggerState.fireCounts["crossing-warning"]).toBe(1);
  });

  it("spawns a formation and gives it one deterministic attack activation", () => {
    const state = blankState();
    addFormation(state, "legion", [{ x: 2, y: 2 }], "east");
    addMapTrigger(state.battlefield, {
      id: "round-two-ambush",
      label: "Round two ambush",
      once: true,
      condition: { type: "round_starts", round: 2 },
      effects: [
        { type: "spawn_formation", formation: spawnedRaiders },
        { type: "activate_to_attack", formationId: spawnedRaiders.id, targetFactionId: "roman" },
      ],
    });
    state.round = 2;
    const source = emitEvent(state, "round_started", "Round 2 began.");

    evaluateMapTriggers(state, [source]);

    const raiders = state.formations[spawnedRaiders.id];
    expect(raiders).toBeDefined();
    expect(raiders?.hasActivated).toBe(true);
    expect(raiders?.movementRemaining).toBe(0);
    expect(state.blocks[`${spawnedRaiders.id}-b1`]?.position.x).toBeLessThan(6);
    expect(state.eventLog.some((event) => event.type === "pressure_applied")).toBe(true);
    expect(state.eventLog.some((event) => event.type === "trigger_ai_activated")).toBe(true);
  });

  it("supports repeatable entry triggers but fires each only once per evaluation", () => {
    const state = blankState();
    addFormation(state, "patrol", [{ x: 2, y: 2 }], "east");
    addMapTrigger(state.battlefield, {
      id: "repeatable-bell",
      label: "Watch bell",
      once: false,
      condition: { type: "formation_enters", positions: [{ x: 2, y: 2 }] },
      effects: [{ type: "character_interaction", speaker: "Sentry", text: "The bell sounds." }],
    });
    const moved = emitEvent(state, "formation_moved", "Patrol moved.", { formationIds: ["patrol"] });

    evaluateMapTriggers(state, [moved, moved]);
    expect(state.triggerState.fireCounts["repeatable-bell"]).toBe(1);
    const movedAgain = emitEvent(state, "formation_moved", "Patrol moved again.", { formationIds: ["patrol"] });
    evaluateMapTriggers(state, [movedAgain]);
    expect(state.triggerState.fireCounts["repeatable-bell"]).toBe(2);
  });

  it("fires a destruction trigger only after its named formation is gone", () => {
    const state = blankState();
    addFormation(state, "guard", [{ x: 2, y: 2 }], "east", "saxon");
    addMapTrigger(state.battlefield, {
      id: "guard-fallen",
      label: "Guard defeated",
      once: true,
      condition: { type: "formation_destroyed", formationId: "guard" },
      effects: [{ type: "character_interaction", speaker: "Commander", text: "The road is open." }],
    });
    delete state.blocks["guard-b1"];
    delete state.formations.guard;
    const destroyed = emitEvent(state, "block_destroyed", "Guard fell.", { formationIds: ["guard"], blockIds: ["guard-b1"] });

    evaluateMapTriggers(state, [destroyed]);

    expect(state.triggerState.fireCounts["guard-fallen"]).toBe(1);
    expect(state.triggerState.interactions[0]?.text).toBe("The road is open.");
  });

  it("reports blocked spawns without overwriting battlefield occupants", () => {
    const state = blankState();
    addFormation(state, "occupant", [{ x: 6, y: 2 }], "west");
    addMapTrigger(state.battlefield, {
      id: "blocked-spawn",
      label: "Blocked spawn",
      once: true,
      condition: { type: "round_starts", round: 2 },
      effects: [{ type: "spawn_formation", formation: spawnedRaiders }],
    });
    state.round = 2;
    const source = emitEvent(state, "round_started", "Round 2 began.");

    evaluateMapTriggers(state, [source]);

    expect(state.formations[spawnedRaiders.id]).toBeUndefined();
    expect(state.blocks["occupant-b1"]?.position).toEqual({ x: 6, y: 2 });
    expect(state.eventLog.some((event) => event.type === "trigger_failed")).toBe(true);
  });
});
