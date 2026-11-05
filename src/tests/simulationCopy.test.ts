import { describe, expect, it } from "vitest";
import { planAiActivation } from "../gridBattle/ai/formationAi";
import { executeCommand } from "../gridBattle/commands/executeCommand";
import { planOrder } from "../gridBattle/commands/planOrder";
import { simulationCopy } from "../gridBattle/model/simulationCopy";
import type { GameState } from "../gridBattle/model/types";
import { scenarioFactoryForMission } from "../gridBattle/scenario/campaignScenario";
import { createOpenFieldScenario } from "../gridBattle/scenario/openFieldScenario";

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function fightRounds(state: GameState, rounds: number): void {
  for (let activation = 0; activation < 200 && state.round <= rounds; activation += 1) {
    const plan = planAiActivation(state);
    if (!plan) return;
    for (const step of plan.steps) {
      if (!executeCommand(state, step.command, { confirmed: step.confirmed }).accepted) break;
    }
  }
}

describe("simulation copies", () => {
  it("keep the original battle untouched", () => {
    const state = createOpenFieldScenario();
    const copy = simulationCopy(state);
    const block = Object.keys(copy.blocks)[0]!;
    copy.blocks[block]!.models = 0;
    copy.round = 99;
    expect(state.blocks[block]!.models).toBeGreaterThan(0);
    expect(state.round).toBe(1);
    expect(copy.battlefield).toBe(state.battlefield);
    expect(copy.eventLog).toEqual([]);
  });

  // Every copy shares the map, so a rule that wrote to it would leak out of a simulation.
  it.each(["test-field-trials", "roman-1-hadrians-wall", "roman-2-blackwater-ford", "roman-3-raven-at-vindolanda"])(
    "can share the map because no rule writes to it in %s",
    (missionId) => {
      const state = scenarioFactoryForMission(missionId)();
      deepFreeze(state.battlefield);
      fightRounds(state, 6);
      expect(state.round).toBeGreaterThan(1);
    },
    30_000,
  );

  it("leave the computer's planning and the player's previews free of side effects", () => {
    const state = createOpenFieldScenario();
    fightRounds(state, 3);
    const before = JSON.stringify(state);
    const plan = planAiActivation(state);
    planOrder(state, { type: "battle" });
    expect(plan).not.toBeNull();
    expect(JSON.stringify(state)).toBe(before);
  });
});
