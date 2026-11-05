import { describe, expect, it } from "vitest";
import { executeCommand } from "../gridBattle/commands/executeCommand";
import { resolveRoutingFormationActivation } from "../gridBattle/rules/routing";
import { endFormationActivation, remainingActivations } from "../gridBattle/rules/turnSystem";
import { addMapTerrainObject, setMapTerrain } from "../gridBattle/model/battlefieldMap";
import { addFormation, attachCharacter, blankState } from "./gridBattleTestState";

function rout(formation: ReturnType<typeof addFormation>): void {
  formation.cohesion = 0;
  formation.status = "routed";
}

describe("grid battle routing", () => {
  it("removes a routed formation from player orders and moves it away automatically", () => {
    const state = blankState();
    const routed = addFormation(state, "roman", [{ x: 3, y: 3 }], "north", "roman");
    addFormation(state, "saxon", [{ x: 3, y: 2 }], "south", "saxon");
    rout(routed);

    expect(executeCommand(state, { type: "select_cell", position: { x: 3, y: 3 } }).accepted).toBe(false);
    expect(remainingActivations(state, "roman")).toBe(0);

    const result = resolveRoutingFormationActivation(state, "roman");
    expect(result).toEqual(expect.objectContaining({ movedSteps: 4, escapedBlocks: 0, rallied: false }));
    expect(state.blocks["roman-b1"]!.position).toEqual({ x: 3, y: 7 });
    expect(state.formations.roman!.facing).toBe("south");
    expect(state.formations.roman!.status).toBe("routed");
    expect(state.formations.roman!.hasActivated).toBe(true);
  });

  it("spills a routing block around trees instead of treating the route as blocked", () => {
    const state = blankState();
    const routed = addFormation(state, "roman", [{ x: 3, y: 3 }], "north", "roman");
    addFormation(state, "saxon", [{ x: 3, y: 2 }], "south", "saxon");
    state.formations.roman!.unit.movement = 1;
    addMapTerrainObject(state.battlefield, { x: 3, y: 4 }, "tree_large");
    rout(routed);

    const result = resolveRoutingFormationActivation(state, routed.id);

    expect(result.movedSteps).toBe(1);
    expect(state.blocks["roman-b1"]!).toMatchObject({ position: { x: 3, y: 4 }, models: 5 });
    expect(state.blocks["roman-b1-overflow-1"]!).toMatchObject({ position: { x: 3, y: 3 }, models: 4 });
  });

  it("rallies after two safe routing activations when a leader survives", () => {
    const state = blankState(20, 20);
    const routed = addFormation(state, "roman", [{ x: 5, y: 5 }, { x: 6, y: 5 }], "north", "roman");
    addFormation(state, "saxon", [{ x: 5, y: 1 }], "south", "saxon");
    const leader = attachCharacter(state, "leader", "roman-b1", "roman", "commander");
    routed.leaderCharacterId = leader.id;
    rout(routed);

    expect(resolveRoutingFormationActivation(state, routed.id).rallied).toBe(false);
    routed.hasActivated = false;
    const result = resolveRoutingFormationActivation(state, routed.id);

    expect(result.rallied).toBe(true);
    expect(routed.cohesion).toBe(4);
    expect(routed.status).toBe("formed");
    expect(routed.routingActivations).toBeUndefined();
  });

  it("removes a routing formation and records its final movement over the map edge", () => {
    const state = blankState();
    const routed = addFormation(state, "roman", [{ x: 3, y: 7 }], "north", "roman");
    addFormation(state, "saxon", [{ x: 3, y: 2 }], "south", "saxon");
    rout(routed);

    const result = resolveRoutingFormationActivation(state, "roman");
    const escape = state.eventLog.find((event) => event.type === "formation_escaped");

    expect(result.formationEscaped).toBe(true);
    expect(result.escapedBlocks).toBe(1);
    expect(state.formations.roman).toBeUndefined();
    expect(state.blocks["roman-b1"]).toBeUndefined();
    expect(state.departedBlocks).toContainEqual(expect.objectContaining({
      block: expect.objectContaining({ id: "roman-b1", models: 9 }),
    }));
    expect(escape?.departingBlocks).toContainEqual(expect.objectContaining({
      from: { x: 3, y: 7 },
      to: { x: 3, y: 8 },
    }));
  });

  it("resolves routed enemy movement automatically during turn alternation", () => {
    const state = blankState(20, 20);
    addFormation(state, "roman-front", [{ x: 5, y: 2 }], "north", "roman");
    addFormation(state, "roman-reserve", [{ x: 1, y: 15 }], "north", "roman");
    const routed = addFormation(state, "saxon", [{ x: 5, y: 5 }], "north", "saxon");
    rout(routed);

    endFormationActivation(state, "roman-front");

    expect(state.blocks["saxon-b1"]!.position).toEqual({ x: 5, y: 9 });
    expect(state.formations.saxon!.hasActivated).toBe(true);
    expect(state.activeFactionId).toBe("roman");
    expect(remainingActivations(state, "roman")).toBe(1);
  });

  it("never rallies a formation at a quarter of its men or fewer, and it keeps running", () => {
    const state = blankState(8, 16);
    const routed = addFormation(state, "roman", [{ x: 3, y: 2 }], "north", "roman");
    addFormation(state, "saxon", [{ x: 3, y: 0 }], "south", "saxon");
    state.formations.roman!.unit.movement = 1;
    state.formations.roman!.initialModelCount = state.blocks["roman-b1"]!.models * 4;
    rout(routed);

    for (let activation = 0; activation < 6; activation += 1) {
      expect(resolveRoutingFormationActivation(state, routed.id).rallied).toBe(false);
    }
    expect(state.formations.roman!.status).toBe("routed");
    expect(state.blocks["roman-b1"]!.position.y).toBe(8);
  });

  it("still rallies a formation just above a quarter of its men", () => {
    const state = blankState(8, 16);
    const routed = addFormation(state, "roman", [{ x: 3, y: 2 }], "north", "roman");
    addFormation(state, "saxon", [{ x: 3, y: 0 }], "south", "saxon");
    state.formations.roman!.unit.movement = 1;
    state.formations.roman!.initialModelCount = state.blocks["roman-b1"]!.models * 4 - 1;
    rout(routed);

    resolveRoutingFormationActivation(state, routed.id);
    resolveRoutingFormationActivation(state, routed.id);
    expect(resolveRoutingFormationActivation(state, routed.id).rallied).toBe(true);
  });

  it("requires three safe routing activations to rally without a leader", () => {
    const state = blankState(20, 30);
    const routed = addFormation(state, "roman", [{ x: 5, y: 5 }], "north", "roman");
    addFormation(state, "saxon", [{ x: 5, y: 1 }], "south", "saxon");
    rout(routed);

    expect(resolveRoutingFormationActivation(state, routed.id).rallied).toBe(false);
    routed.hasActivated = false;
    expect(resolveRoutingFormationActivation(state, routed.id).rallied).toBe(false);
    routed.hasActivated = false;
    expect(resolveRoutingFormationActivation(state, routed.id).rallied).toBe(true);
    expect(routed.cohesion).toBe(4);
  });

  it("moves directly away from the enemy instead of seeking a nearby side edge", () => {
    const state = blankState(8, 12);
    const routed = addFormation(state, "roman", [{ x: 7, y: 4 }], "east", "roman");
    addFormation(state, "saxon", [{ x: 7, y: 1 }], "south", "saxon");
    rout(routed);

    resolveRoutingFormationActivation(state, routed.id);

    expect(state.blocks["roman-b1"]!.position).toEqual({ x: 7, y: 8 });
    expect(routed.facing).toBe("south");
  });

  it("preserves leader ownership when the leader's fragment crosses the edge first", () => {
    const state = blankState(8, 12);
    const main = addFormation(state, "warband", [{ x: 7, y: 5 }], "west", "saxon");
    const fragment = addFormation(state, "warband-fragment-1", [{ x: 6, y: 5 }], "west", "saxon");
    addFormation(state, "roman", [{ x: 1, y: 5 }], "east", "roman");
    main.provisionalFamilyId = "warband";
    fragment.provisionalFamilyId = "warband";
    rout(main);
    rout(fragment);
    state.formations.warband!.unit.movement = 1;
    state.formations["warband-fragment-1"]!.unit.movement = 1;
    const leader = attachCharacter(state, "leader", "warband-b1", "saxon", "commander");
    main.leaderCharacterId = leader.id;

    resolveRoutingFormationActivation(state, main.id);

    expect(state.formations[main.id]).toBeUndefined();
    expect(state.characters.leader!.hostBlockId).toBe("warband-fragment-1-b1");
    expect(fragment.leaderCharacterId).toBe("leader");
    expect(state.blocks["warband-fragment-1-b1"]!.characterId).toBe("leader");
  });

  it("disperses a routed formation after two unsafe activations with no legal escape", () => {
    const state = blankState(5, 5);
    const routed = addFormation(state, "roman", [{ x: 2, y: 2 }], "north", "roman");
    addFormation(state, "saxon", [{ x: 2, y: 1 }], "south", "saxon");
    setMapTerrain(state.battlefield, { x: 1, y: 2 }, "impassable");
    setMapTerrain(state.battlefield, { x: 3, y: 2 }, "impassable");
    setMapTerrain(state.battlefield, { x: 2, y: 3 }, "impassable");
    rout(routed);

    expect(resolveRoutingFormationActivation(state, routed.id).formationEscaped).toBe(false);
    expect(routed.routingStalledActivations).toBe(1);
    routed.hasActivated = false;
    expect(resolveRoutingFormationActivation(state, routed.id).formationEscaped).toBe(true);

    expect(state.formations[routed.id]).toBeUndefined();
    expect(state.eventLog.at(-1)).toEqual(expect.objectContaining({
      type: "formation_escaped",
      message: expect.stringContaining("trapped"),
    }));
  });

  it("disperses a formation too weak to rally when it is walled in, even with no enemy near", () => {
    const state = blankState(9, 9);
    const routed = addFormation(state, "roman", [{ x: 2, y: 2 }], "north", "roman");
    addFormation(state, "saxon", [{ x: 8, y: 8 }], "north", "saxon");
    state.formations.roman!.initialModelCount = state.blocks["roman-b1"]!.models * 4;
    for (const position of [{ x: 1, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }, { x: 2, y: 1 }]) {
      setMapTerrain(state.battlefield, position, "impassable");
    }
    rout(routed);

    expect(resolveRoutingFormationActivation(state, routed.id).formationEscaped).toBe(false);
    expect(resolveRoutingFormationActivation(state, routed.id).formationEscaped).toBe(true);
    expect(state.formations[routed.id]).toBeUndefined();
  });

  it("returns to a valid phase after routing-only rounds resolve", () => {
    const state = blankState(5, 5);
    const roman = addFormation(state, "roman", [{ x: 2, y: 2 }], "north", "roman");
    const saxon = addFormation(state, "saxon", [{ x: 2, y: 1 }], "south", "saxon");
    for (const position of [{ x: 1, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 },
      { x: 1, y: 1 }, { x: 3, y: 1 }, { x: 2, y: 0 }]) {
      setMapTerrain(state.battlefield, position, "impassable");
    }
    rout(roman);
    rout(saxon);

    endFormationActivation(state);

    expect(state.phase).toBe("selecting");
    expect(Object.values(state.formations).every((formation) => formation.status !== "routed")).toBe(true);
  });
});
