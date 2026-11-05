import { describe, expect, it } from "vitest";
import { MISSION_BY_ID } from "../campaign/CampaignCatalog";
import { planAiActivation } from "../gridBattle/ai/formationAi";
import { executeCommand } from "../gridBattle/commands/executeCommand";
import { emitEvent, eventsSince } from "../gridBattle/events/events";
import { blocksAt } from "../gridBattle/model/occupancy";
import type { GameState } from "../gridBattle/model/types";
import { objectiveDefinitionForMission } from "../gridBattle/rules/campaignObjectives";
import { createContestedCell } from "../gridBattle/rules/combat";
import { formationIsEngaged } from "../gridBattle/rules/engagement";
import { scenarioFactoryForMission } from "../gridBattle/scenario/campaignScenario";
import { addFormation, blankState } from "./gridBattleTestState";

function orphanedContestedBlocks(state: GameState): string[] {
  return Object.values(state.blocks)
    .filter((block) => block.isContested
      && !blocksAt(state, block.position).some((occupant) => occupant.factionId !== block.factionId))
    .map((block) => block.id);
}

describe("event delivery", () => {
  it("still reports new events once the capped log is full", () => {
    const state = blankState();
    for (let index = 0; index < 120; index += 1) emitEvent(state, "round_started", `old ${index}`);
    const firstNewEventId = state.nextEventId;

    emitEvent(state, "round_started", "new 1");
    emitEvent(state, "round_started", "new 2");

    expect(state.eventLog).toHaveLength(120);
    expect(eventsSince(state.eventLog, firstNewEventId).map((event) => event.message)).toEqual(["new 1", "new 2"]);
  });
});

describe("contested cell cleanup", () => {
  it("frees a block when its contested partner is forced out of the cell", () => {
    const state = blankState(8, 8);
    addFormation(state, "romans", [{ x: 3, y: 2 }], "south", "roman");
    addFormation(state, "saxons", [{ x: 3, y: 3 }], "north", "saxon");
    expect(createContestedCell(state, "romans-b1", "saxons-b1")).toBe(true);

    state.activeFactionId = "saxon";
    expect(executeCommand(state, { type: "select_cell", position: { x: 3, y: 3 } }).accepted).toBe(true);
    expect(executeCommand(state, { type: "select_cell", position: { x: 3, y: 3 } }).accepted).toBe(true);
    expect(executeCommand(state, { type: "debug_retreat" }).accepted).toBe(true);

    expect(state.blocks["saxons-b1"]?.position).not.toEqual({ x: 3, y: 3 });
    expect(orphanedContestedBlocks(state)).toEqual([]);
  });

  it("keeps both blocks contested while they still share the cell", () => {
    const state = blankState(8, 8);
    addFormation(state, "romans", [{ x: 3, y: 2 }], "south", "roman");
    addFormation(state, "saxons", [{ x: 3, y: 3 }], "north", "saxon");
    createContestedCell(state, "romans-b1", "saxons-b1");

    expect(executeCommand(state, { type: "select_cell", position: { x: 3, y: 3 } }).accepted).toBe(true);

    expect(state.blocks["romans-b1"]?.isContested).toBe(true);
    expect(state.blocks["saxons-b1"]?.isContested).toBe(true);
    expect(formationIsEngaged(state, "romans")).toBe(true);
  });
});

describe("computer opponent", () => {
  const missions = [...MISSION_BY_ID.values()].filter((mission) => mission.campaignId !== "test");

  it.each(missions.map((mission) => [mission.id, mission] as const))(
    "%s always has a legal plan against a passive player",
    (_id, mission) => {
      const formationIds = mission.deployment.defaultFormationIds;
      const state = scenarioFactoryForMission(mission.id, formationIds)();
      const objective = objectiveDefinitionForMission(mission.id, formationIds);

      for (let step = 0; step < 300 && state.round < 25; step += 1) {
        if (objective.evaluate(state).outcome !== "ongoing") break;
        if (state.activeFactionId === "roman") {
          const roman = Object.values(state.formations)
            .filter((formation) => formation.factionId === "roman" && !formation.hasActivated && formation.blockIds.length > 0)
            .sort((left, right) => left.id.localeCompare(right.id))[0];
          const position = roman ? state.blocks[roman.blockIds[0]!]?.position : undefined;
          if (position && executeCommand(state, { type: "select_cell", position }).accepted
            && executeCommand(state, { type: "end_activation" }).accepted) continue;
        }
        const plan = planAiActivation(state, state.activeFactionId);
        expect(plan, `no plan in round ${state.round}`).not.toBeNull();
        for (const planned of plan!.steps) {
          expect(executeCommand(state, planned.command, { confirmed: planned.confirmed })).toEqual({ accepted: true });
        }
        expect(orphanedContestedBlocks(state)).toEqual([]);
      }
    },
    120_000,
  );
});
