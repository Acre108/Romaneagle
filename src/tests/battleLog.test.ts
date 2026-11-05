import { describe, expect, it } from "vitest";
import { resolveEngagedOrder } from "../gridBattle/rules/engagement";
import { battleLogEntries } from "../gridBattle/rules/battleLog";
import { endFormationActivation } from "../gridBattle/rules/turnSystem";
import type { GameEvent } from "../gridBattle/model/types";
import { addFormation, blankState } from "./gridBattleTestState";

const NAMES = new Map([["R-I", "I Cohort · Prima"], ["great-warband", "Great Warband"]]);

function event(id: number, type: GameEvent["type"], message: string, extra: Partial<GameEvent> = {}): GameEvent {
  return { id, type, message, ...extra };
}

describe("the battle log", () => {
  it("sums one order into a headline, results, losses and morale", () => {
    const [entry] = battleLogEntries([
      event(1, "pressure_applied", "R-I-b1 applied 11 pressure to great-warband-b13 (3 net).", { blockIds: ["R-I-b1", "great-warband-b13"], pressureResult: "pushed" }),
      event(2, "block_damaged", "great-warband-b13 suffered 2 damage and lost 2 models (melee).", { formationIds: ["great-warband"], casualties: 2 }),
      event(3, "pressure_applied", "R-I-b2 applied 11 pressure to great-warband-b14 (3 net).", { blockIds: ["R-I-b2", "great-warband-b14"], pressureResult: "pushed" }),
      event(4, "block_damaged", "great-warband-b14 suffered 2 damage and lost 2 models (melee).", { formationIds: ["great-warband"], casualties: 2 }),
      event(5, "block_damaged", "R-I-b2 suffered 1 damage and lost 1 model (counterattack).", { formationIds: ["R-I"], casualties: 1 }),
      event(6, "morale_shock", "Great Warband lost 2 morale: pushed back.", { formationIds: ["great-warband"] }),
      event(7, "engaged_order_resolved", "I Cohort · Prima chose to press; 2 blocks fought.", { formationIds: ["R-I"] }),
      event(8, "activation_ended", "I Cohort · Prima ended its activation.", { formationIds: ["R-I"] }),
    ], NAMES);

    expect(entry).toEqual({
      headline: "I Cohort · Prima pressed.",
      details: ["Great Warband: pushed ×2.", "Lost: Great Warband 4, I Cohort · Prima 1."],
      moraleNotes: ["Great Warband lost 2 morale: pushed back."],
    });
  });

  it("never shows a raw block ID", () => {
    const entries = battleLogEntries([
      event(1, "contested_cell_created", "R-I-b3 and great-warband-b13 became intermingled."),
      event(2, "activation_ended", "I Cohort · Prima ended its activation.", { formationIds: ["R-I"] }),
    ], NAMES);
    expect(JSON.stringify(entries)).not.toMatch(/-b\d/);
    expect(entries[0]?.headline).toBe("I Cohort · Prima and Great Warband became intermingled.");
  });

  it("collapses repeated steps into one movement line with the final facing", () => {
    const [entry] = battleLogEntries([
      event(1, "formation_moved", "I Cohort · Prima moved west.", { formationIds: ["R-I"] }),
      event(2, "formation_moved", "I Cohort · Prima moved west.", { formationIds: ["R-I"] }),
      event(3, "formation_rotated", "I Cohort · Prima finished its move facing north.", { formationIds: ["R-I"] }),
      event(4, "activation_ended", "I Cohort · Prima ended its activation.", { formationIds: ["R-I"] }),
    ], NAMES);
    expect(entry?.headline).toBe("I Cohort · Prima moved 2 squares, facing north.");
  });

  it("says when a formation only held, puts the newest first, and marks rounds", () => {
    const entries = battleLogEntries([
      event(1, "activation_ended", "I Cohort · Prima ended its activation.", { formationIds: ["R-I"] }),
      event(2, "round_started", "Round 2 began. Romans have the first activation."),
    ], NAMES);
    expect(entries.map((entry) => entry.headline)).toEqual(["Round 2 began.", "I Cohort · Prima held its ground."]);
  });

  it("leads with the order, not a regroup or a rout that happened around it", () => {
    const [entry] = battleLogEntries([
      event(1, "formation_moved", "Great Warband – Main Body fled 4 squares.", { formationIds: ["great-warband"] }),
      event(2, "formation_merged", "Great Warband regrouped from 3 bodies into 1.", { formationIds: ["great-warband"] }),
      event(3, "formation_moved", "I Cohort · Prima charged 2 squares.", { formationIds: ["R-I"] }),
      event(4, "activation_ended", "I Cohort · Prima ended its activation.", { formationIds: ["R-I"] }),
    ], NAMES);
    expect(entry).toEqual({
      headline: "I Cohort · Prima charged 2 squares.",
      details: ["Great Warband regrouped from 3 bodies into 1."],
      moraleNotes: ["Great Warband fled 4 squares."],
    });
  });

  it("reads a real order without leaking internal wording", () => {
    const state = blankState(12, 12);
    addFormation(state, "R-I", [{ x: 3, y: 5 }, { x: 4, y: 5 }], "north", "roman");
    addFormation(state, "great-warband", [{ x: 3, y: 4 }, { x: 4, y: 4 }], "south", "saxon");
    resolveEngagedOrder(state, "R-I", "press");
    endFormationActivation(state, "R-I");
    const text = JSON.stringify(battleLogEntries(state.eventLog, NAMES));
    expect(text).toContain("pressed");
    expect(text).not.toMatch(/-b\d|net\)|chose to/);
  });
});
