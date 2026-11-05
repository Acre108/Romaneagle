import { describe, expect, it } from "vitest";
import { executeCommand } from "../gridBattle/commands/executeCommand";
import { resolveCharge } from "../gridBattle/rules/charge";
import { withFormationNames } from "../gridBattle/rules/displayNames";
import { forceSplit } from "../gridBattle/rules/formationActions";
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
      event(7, "engaged_order_resolved", "I Cohort · Prima chose to press; 2 blocks fought.", { formationIds: ["R-I"], detail: { kind: "engaged_order", order: "press" } }),
      event(8, "activation_ended", "I Cohort · Prima ended its activation.", { formationIds: ["R-I"] }),
    ], NAMES);

    expect(entry).toEqual({
      headline: "I Cohort · Prima pressed.",
      details: ["Great Warband: pushed ×2.", "Lost: Great Warband 4, I Cohort · Prima 1."],
      moraleNotes: ["Great Warband lost 2 morale: pushed back."],
    });
  });

  it("collapses repeated steps into one movement line, however the messages are worded", () => {
    const [entry] = battleLogEntries([
      event(1, "formation_moved", "Reworded advance.", { formationIds: ["R-I"], detail: { kind: "step" } }),
      event(2, "formation_moved", "Reworded advance.", { formationIds: ["R-I"], detail: { kind: "step" } }),
      event(3, "formation_rotated", "Reworded finish.", { formationIds: ["R-I"], detail: { kind: "final_facing", facing: "east" } }),
      event(4, "activation_ended", "I Cohort · Prima ended its activation.", { formationIds: ["R-I"] }),
    ], NAMES);
    expect(entry?.headline).toBe("I Cohort · Prima moved 2 squares, facing east.");
  });

  it("names overflow and fragment blocks too", () => {
    expect(withFormationNames("1 models from R-I-b6 formed R-I-b6-overflow-1.", NAMES)).toBe("1 models from I Cohort · Prima formed I Cohort · Prima.");
    expect(withFormationNames("great-warband-fragment-2-b4 was destroyed.", NAMES)).toBe("Great Warband was destroyed.");
  });

  it("never shows a raw block ID", () => {
    const entries = battleLogEntries([
      event(1, "contested_cell_created", "R-I-b3 and great-warband-b13 became intermingled."),
      event(2, "activation_ended", "I Cohort · Prima ended its activation.", { formationIds: ["R-I"] }),
    ], NAMES);
    expect(JSON.stringify(entries)).not.toMatch(/-b\d/);
    expect(entries[0]?.headline).toBe("I Cohort · Prima and Great Warband became intermingled.");
  });

  it("says when a formation only waited, puts the newest first, and marks rounds", () => {
    const entries = battleLogEntries([
      event(1, "activation_ended", "I Cohort · Prima ended its activation.", { formationIds: ["R-I"], detail: { kind: "activation_ended", factionId: "roman" } }),
      event(2, "round_started", "Round 2 began. Romans have the first activation."),
    ], NAMES);
    expect(entries.map((entry) => entry.headline)).toEqual(["Round 2 began.", "Romans waited: I Cohort · Prima."]);
  });

  it("gathers a faction's waits in one round into one line, between the other side's orders", () => {
    const names = new Map([...NAMES, ["R-II", "Lanciarii"], ["R-III", "Plumbatarii"]]);
    const wait = (id: number, formationId: string) => event(id, "activation_ended", "ended.", {
      formationIds: [formationId], detail: { kind: "activation_ended", factionId: "roman" },
    });
    const entries = battleLogEntries([
      wait(1, "R-I"),
      event(2, "formation_moved", "Great Warband moved.", { formationIds: ["great-warband"], detail: { kind: "step" } }),
      event(3, "activation_ended", "ended.", { formationIds: ["great-warband"], detail: { kind: "activation_ended", factionId: "saxon" } }),
      wait(4, "R-II"),
      wait(5, "R-III"),
      event(6, "round_started", "Round 2 began."),
      wait(7, "R-I"),
    ], names);
    expect(entries.map((entry) => entry.headline)).toEqual([
      "Romans waited: I Cohort · Prima.",
      "Round 2 began.",
      "Romans waited: I Cohort · Prima, Lanciarii, Plumbatarii.",
      "Great Warband moved 1 square.",
    ]);
  });

  it("names the faction with the label it is given", () => {
    const [entry] = battleLogEntries([
      event(1, "activation_ended", "ended.", { formationIds: ["great-warband"], detail: { kind: "activation_ended", factionId: "saxon" } }),
    ], NAMES, undefined, (factionId) => (factionId === "saxon" ? "Picts" : "Romans"));
    expect(entry?.headline).toBe("Picts waited: Great Warband.");
  });

  it("tells a Hold order, which recovers morale, apart from waiting", () => {
    const state = blankState(8, 8);
    const romans = addFormation(state, "R-I", [{ x: 3, y: 5 }], "north", "roman");
    addFormation(state, "great-warband", [{ x: 3, y: 1 }], "south", "saxon");
    romans.cohesion = 6;
    executeCommand(state, { type: "select_cell", position: { x: 3, y: 5 } });
    expect(executeCommand(state, { type: "hold" }).accepted).toBe(true);
    expect(battleLogEntries(state.eventLog, NAMES)[0]?.headline).toBe("I Cohort · Prima held and recovered 1 morale.");
  });

  it("leads with the order, not a regroup or a rout that happened around it", () => {
    const [entry] = battleLogEntries([
      event(1, "formation_moved", "Great Warband – Main Body fled 4 squares.", { formationIds: ["great-warband"], detail: { kind: "flight" } }),
      event(2, "formation_merged", "Great Warband regrouped from 3 bodies into 1.", { formationIds: ["great-warband"], detail: { kind: "regrouped" } }),
      event(3, "formation_moved", "I Cohort · Prima charged 2 squares.", { formationIds: ["R-I"], detail: { kind: "charge" } }),
      event(4, "activation_ended", "I Cohort · Prima ended its activation.", { formationIds: ["R-I"] }),
    ], NAMES);
    expect(entry).toEqual({
      headline: "I Cohort · Prima charged 2 squares.",
      details: ["Great Warband regrouped from 3 bodies into 1."],
      moraleNotes: ["Great Warband fled 4 squares."],
    });
  });

  it("marks a real charge so the renderer can animate it without reading the message", () => {
    const state = blankState(8, 8);
    addFormation(state, "romans", [{ x: 3, y: 1 }], "south", "roman");
    addFormation(state, "saxons", [{ x: 3, y: 3 }], "north", "saxon");

    expect(resolveCharge(state, "romans-b1", "saxons-b1")).toBe(true);

    expect(state.eventLog.find((event) => event.type === "formation_moved")?.detail).toEqual({ kind: "charge" });
  });

  it("reports a move in several bodies as movement", () => {
    const state = blankState(14, 14);
    addFormation(state, "R-I", [{ x: 2, y: 8 }, { x: 3, y: 8 }, { x: 4, y: 8 }, { x: 5, y: 8 }], "north", "roman");
    addFormation(state, "great-warband", [{ x: 12, y: 1 }], "south", "saxon");
    executeCommand(state, { type: "select_cell", position: { x: 2, y: 8 } });
    expect(forceSplit(state, "R-I")).toBe(true);
    executeCommand(state, { type: "select_cell", position: { x: 2, y: 8 } });
    executeCommand(state, { type: "choose_action", action: "move" });
    expect(executeCommand(state, { type: "move", direction: "north" }).accepted).toBe(true);
    expect(executeCommand(state, { type: "finish_move", facing: "north" }).accepted).toBe(true);

    const headlines = battleLogEntries(state.eventLog, NAMES).map((entry) => entry.headline);
    expect(headlines).toContain("I Cohort · Prima moved 1 square.");
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
