import { describe, expect, it, vi } from "vitest";
import { planAiActivation } from "../gridBattle/ai/formationAi";
import { executeCommand } from "../gridBattle/commands/executeCommand";
import { addFormation, blankState } from "./gridBattleTestState";

vi.mock("../gridBattle/commands/planOrder", async (importOriginal) => {
  const original = await importOriginal<typeof import("../gridBattle/commands/planOrder")>();
  return {
    ...original,
    planOrder: (...args: Parameters<typeof original.planOrder>) => args[1].type === "battle" || args[1].type === "press"
      ? { ok: false, reason: "Rejected for this test." }
      : original.planOrder(...args),
  };
});

describe("formation AI fallback", () => {
  it("ends the activation instead of stalling when an engaged formation has no legal order", () => {
    const state = blankState(8, 6);
    addFormation(state, "romans", [{ x: 3, y: 2 }], "east", "roman");
    addFormation(state, "saxons", [{ x: 4, y: 2 }], "west", "saxon");
    state.activeFactionId = "saxon";

    const plan = planAiActivation(state, "saxon");

    expect(plan?.formationId).toBe("saxons");
    expect(plan?.intent).toBe("hold");
    for (const step of plan!.steps) {
      expect(executeCommand(state, step.command, { confirmed: step.confirmed })).toEqual({ accepted: true });
    }
    expect(state.formations.saxons?.hasActivated).toBe(true);
    expect(state.activeFactionId).toBe("roman");
  });
});
