import { describe, expect, it } from "vitest";
import { TEST_SCENARIO_MISSION } from "../campaign/missions/TestScenarioMission";
import { planAiActivation } from "../gridBattle/ai/formationAi";
import { executeCommand } from "../gridBattle/commands/executeCommand";
import { blocksAt, inBounds } from "../gridBattle/model/occupancy";
import { formationIsEngaged } from "../gridBattle/rules/engagement";
import { connectedComponents } from "../gridBattle/rules/splitting";
import { scenarioFactoryForMission } from "../gridBattle/scenario/campaignScenario";
import { createPrototypeGridScenario } from "../gridBattle/scenario/prototypeScenario";
import { DEFAULT_TEST_UNIT_IDS, TEST_SAXON_SPECS, TEST_UNIT_OPTIONS } from "../scenario/TestScenario";

function deploy(ids: readonly string[]) {
  return scenarioFactoryForMission(TEST_SCENARIO_MISSION.id, ids)();
}

function romanFormationIds(state: ReturnType<typeof deploy>): string[] {
  return Object.values(state.formations)
    .filter((formation) => formation.factionId === "roman")
    .map((formation) => formation.id)
    .sort();
}

function expectLegalDeployment(state: ReturnType<typeof deploy>, ids: readonly string[]): void {
  expect(romanFormationIds(state)).toEqual([...ids].sort());
  for (const block of Object.values(state.blocks)) {
    expect(inBounds(state, block.position)).toBe(true);
    expect(blocksAt(state, block.position)).toHaveLength(1);
  }
  for (const id of ids) {
    const option = TEST_UNIT_OPTIONS.find((candidate) => candidate.id === id)!;
    const formation = state.formations[id]!;
    expect(formation.name).toBe(option.name);
    expect(formation.blockIds.reduce((total, blockId) => total + state.blocks[blockId]!.models, 0)).toBe(option.strength);
    expect(connectedComponents(state, id)).toHaveLength(1);
    expect(formationIsEngaged(state, id)).toBe(false);
  }
}

describe("test scenario deployment", () => {
  it.each(TEST_UNIT_OPTIONS.map((option) => [option.name, option.id] as const))("deploys %s on its own", (_name, id) => {
    expectLegalDeployment(deploy([id]), [id]);
  });

  it("deploys the default force", () => {
    expectLegalDeployment(deploy(DEFAULT_TEST_UNIT_IDS), DEFAULT_TEST_UNIT_IDS);
  });

  it("deploys every eight-formation selection, the most the sandbox allows", () => {
    const ids = TEST_UNIT_OPTIONS.map((option) => option.id);
    const choose = (start: number, picked: string[]): void => {
      if (picked.length === TEST_SCENARIO_MISSION.deployment.maximum) {
        expectLegalDeployment(deploy(picked), picked);
        return;
      }
      for (let index = start; index < ids.length; index += 1) choose(index + 1, [...picked, ids[index]!]);
    };
    choose(0, []);
  }, 60_000);

  it("is deterministic and playable", () => {
    const first = deploy(DEFAULT_TEST_UNIT_IDS);
    expect(deploy(DEFAULT_TEST_UNIT_IDS)).toEqual(first);
    first.activeFactionId = "saxon";
    const plan = planAiActivation(first, "saxon");
    expect(plan).not.toBeNull();
    for (const step of plan!.steps) {
      expect(executeCommand(first, step.command, { confirmed: step.confirmed }).accepted).toBe(true);
    }
  });

  it("lists exactly the Saxon formations that take the field", () => {
    const saxonIds = Object.values(createPrototypeGridScenario().formations)
      .filter((formation) => formation.factionId === "saxon")
      .map((formation) => formation.id)
      .sort();
    expect(TEST_SAXON_SPECS.map((spec) => spec.id).sort()).toEqual(saxonIds);
    const fielded = Object.values(deploy(DEFAULT_TEST_UNIT_IDS).formations)
      .filter((formation) => formation.factionId === "saxon")
      .map((formation) => formation.id)
      .sort();
    expect(fielded).toEqual(saxonIds);
  });
});
