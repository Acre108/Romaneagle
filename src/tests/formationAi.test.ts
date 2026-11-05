import { describe, expect, it } from "vitest";
import { planAiActivation, type AiActivationPlan } from "../gridBattle/ai/formationAi";
import { executeCommand } from "../gridBattle/commands/executeCommand";
import { setMapTerrain } from "../gridBattle/model/battlefieldMap";
import type { GameState } from "../gridBattle/model/types";
import { addFormation, blankState } from "./gridBattleTestState";

function giveTurnToSaxons(state: GameState): void {
  state.activeFactionId = "saxon";
}

function executePlan(state: GameState, plan: AiActivationPlan): void {
  for (const step of plan.steps) {
    expect(executeCommand(state, step.command, { confirmed: step.confirmed })).toEqual({ accepted: true });
  }
}

describe("formation AI", () => {
  it("plans without mutating state and advances a formation toward its nearest enemy", () => {
    const state = blankState(10, 6);
    addFormation(state, "romans", [{ x: 1, y: 2 }], "east", "roman");
    addFormation(state, "saxons", [{ x: 7, y: 2 }], "west", "saxon");
    giveTurnToSaxons(state);
    const before = structuredClone(state);

    const plan = planAiActivation(state, "saxon");

    expect(state).toEqual(before);
    expect(plan?.formationId).toBe("saxons");
    expect(plan?.intent).toBe("advance");
    expect(plan?.steps.filter((step) => step.command.type === "move").length).toBeGreaterThan(0);
    executePlan(state, plan!);
    expect(state.blocks["saxons-b1"]?.position.x).toBeLessThan(7);
    expect(state.formations.saxons?.hasActivated).toBe(true);
    expect(state.activeFactionId).toBe("roman");
  });

  it("searches lateral formation moves to get around blocked ground", () => {
    const state = blankState(9, 7);
    addFormation(state, "romans", [{ x: 1, y: 3 }], "east", "roman");
    addFormation(state, "saxons", [{ x: 6, y: 3 }], "west", "saxon");
    setMapTerrain(state.battlefield, { x: 5, y: 3 }, "impassable");
    giveTurnToSaxons(state);

    const plan = planAiActivation(state, "saxon");
    const moves = plan?.steps
      .map((step) => step.command)
      .filter((command) => command.type === "move");

    expect(plan?.intent).toBe("advance");
    expect(moves?.some((command) => command.direction === "north" || command.direction === "south")).toBe(true);
    executePlan(state, plan!);
    expect(state.blocks["saxons-b1"]?.position.x).toBeLessThan(6);
    expect(state.blocks["saxons-b1"]?.position).not.toEqual({ x: 5, y: 3 });
  });

  it("charges a legal target before spending the activation on movement", () => {
    const state = blankState(8, 6);
    addFormation(state, "romans", [{ x: 3, y: 2 }], "east", "roman");
    addFormation(state, "saxons", [{ x: 5, y: 2 }], "west", "saxon");
    giveTurnToSaxons(state);

    const plan = planAiActivation(state, "saxon");

    expect(plan?.intent).toBe("charge");
    expect(plan?.steps.some((step) => step.command.type === "charge")).toBe(true);
    executePlan(state, plan!);
    expect(state.eventLog.some((event) => event.type === "charge_impact")).toBe(true);
    expect(state.formations.saxons?.hasActivated).toBe(true);
  });

  it("fires a ranged volley when a target is in its forward arc", () => {
    const state = blankState(12, 12);
    addFormation(state, "romans", [{ x: 5, y: 9 }], "north", "roman");
    const archers = addFormation(state, "archers", [{ x: 5, y: 3 }], "south", "saxon");
    archers.formationMode = "open";
    archers.unit.rangedWeaponId = "composite-bow";
    archers.ammunition = 12;
    giveTurnToSaxons(state);

    const plan = planAiActivation(state, "saxon");

    expect(plan?.intent).toBe("shoot");
    executePlan(state, plan!);
    expect(archers.ammunition).toBe(11);
    expect(state.eventLog.some((event) => event.type === "ranged_volley")).toBe(true);
  });

  it("resolves an engaged activation through the normal combat command", () => {
    const state = blankState(8, 6);
    addFormation(state, "romans", [{ x: 3, y: 2 }], "east", "roman");
    addFormation(state, "saxons", [{ x: 4, y: 2 }], "west", "saxon");
    giveTurnToSaxons(state);

    const plan = planAiActivation(state, "saxon");

    expect(["battle", "press"]).toContain(plan?.intent);
    executePlan(state, plan!);
    expect(state.eventLog.some((event) => event.type === "engaged_order_resolved")).toBe(true);
    expect(state.formations.saxons?.hasActivated ?? true).toBe(true);
  });

  it("returns the same order for identical state and never plans the human faction out of turn", () => {
    const state = blankState(10, 6);
    addFormation(state, "romans", [{ x: 1, y: 2 }], "east", "roman");
    addFormation(state, "saxons", [{ x: 7, y: 2 }], "west", "saxon");
    giveTurnToSaxons(state);

    expect(planAiActivation(state, "saxon")).toEqual(planAiActivation(structuredClone(state), "saxon"));
    expect(planAiActivation(state, "roman")).toBeNull();
  });
});
