import { describe, expect, it } from "vitest";
import { commandLegality, executeCommand, moveIsCommitted } from "../gridBattle/commands/executeCommand";
import { addFormation, blankState } from "./gridBattleTestState";

function movedRomanState() {
  const state = blankState(12, 10);
  addFormation(state, "first", [{ x: 1, y: 5 }], "east", "roman");
  addFormation(state, "second", [{ x: 1, y: 8 }], "east", "roman");
  addFormation(state, "saxons", [{ x: 10, y: 1 }], "west", "saxon");
  expect(executeCommand(state, { type: "select_cell", position: { x: 1, y: 5 } }).accepted).toBe(true);
  expect(executeCommand(state, { type: "choose_action", action: "move" }).accepted).toBe(true);
  expect(moveIsCommitted(state)).toBe(false);
  expect(executeCommand(state, { type: "move", direction: "east" }, { confirmed: true }).accepted).toBe(true);
  return state;
}

describe("committed moves", () => {
  it("does not let a moved formation hand over to another formation", () => {
    const state = movedRomanState();
    expect(moveIsCommitted(state)).toBe(true);
    expect(executeCommand(state, { type: "select_cell", position: { x: 1, y: 8 } }).accepted).toBe(false);
    expect(state.selectedFormationId).toBe("first");
  });

  it("does not let a moved formation take a second order", () => {
    const state = movedRomanState();
    expect(commandLegality(state, "hold").accepted).toBe(false);
    expect(executeCommand(state, { type: "choose_action", action: "shoot" }).accepted).toBe(false);
    expect(executeCommand(state, { type: "hold" }).accepted).toBe(false);
    expect(state.formations.first?.hasActivated).toBe(false);
  });

  it("still lets the formation keep moving and finish", () => {
    const state = movedRomanState();
    expect(executeCommand(state, { type: "move", direction: "east" }, { confirmed: true }).accepted).toBe(true);
    expect(executeCommand(state, { type: "finish_move", facing: "north" }).accepted).toBe(true);
    expect(state.formations.first?.hasActivated).toBe(true);
  });
});

describe("engaged orders", () => {
  function engagedState() {
    const state = blankState(8, 6);
    addFormation(state, "romans", [{ x: 3, y: 2 }], "east", "roman");
    addFormation(state, "saxons", [{ x: 4, y: 2 }], "west", "saxon");
    state.formations.romans!.cohesion = 6;
    expect(executeCommand(state, { type: "select_cell", position: { x: 3, y: 2 } }).accepted).toBe(true);
    return state;
  }

  it("refuses Hold while engaged, so it cannot recover morale in contact", () => {
    const state = engagedState();
    expect(executeCommand(state, { type: "hold" }).accepted).toBe(false);
    expect(state.formations.romans?.cohesion).toBe(6);
    expect(state.formations.romans?.hasActivated).toBe(false);
  });

  it("refuses Brace while engaged", () => {
    expect(executeCommand(engagedState(), { type: "brace" }).accepted).toBe(false);
  });

  it("still lets a free formation Hold", () => {
    const state = blankState(8, 6);
    addFormation(state, "romans", [{ x: 1, y: 2 }], "east", "roman");
    addFormation(state, "saxons", [{ x: 6, y: 2 }], "west", "saxon");
    state.formations.romans!.cohesion = 6;
    executeCommand(state, { type: "select_cell", position: { x: 1, y: 2 } });
    expect(executeCommand(state, { type: "hold" }).accepted).toBe(true);
    expect(state.formations.romans?.cohesion).toBe(7);
  });
});
