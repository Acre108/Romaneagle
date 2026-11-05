import { describe, expect, it } from "vitest";
import { TEST_SCENARIO_MISSION } from "../campaign/missions/TestScenarioMission";
import {
  DEFAULT_TEST_UNIT_IDS,
  TEST_SAXON_SPECS,
  TEST_UNIT_OPTIONS,
} from "../scenario/TestScenario";
import { ROMAN_UNIT_ARCHETYPES } from "../units/UnitArchetypes";

describe("test scenario", () => {
  it("[key] exposes every Roman archetype and preselects the six specialist trials", () => {
    expect(TEST_UNIT_OPTIONS).toHaveLength(ROMAN_UNIT_ARCHETYPES.length);
    expect(new Set(TEST_UNIT_OPTIONS.map((option) => option.archetypeId))).toEqual(
      new Set(ROMAN_UNIT_ARCHETYPES.map((profile) => profile.id)),
    );
    expect(DEFAULT_TEST_UNIT_IDS).toHaveLength(6);
    expect(TEST_SCENARIO_MISSION.deployment.minimum).toBe(1);
    expect(TEST_SCENARIO_MISSION.deployment.maximum).toBe(8);
  });

  it("[key] describes a fixed Saxon opposition", () => {
    expect(TEST_SAXON_SPECS).toHaveLength(3);
    expect(new Set(TEST_SAXON_SPECS.map((unit) => unit.id)).size).toBe(3);
  });

  it("keeps the sandbox outside campaign progression metadata", () => {
    expect(TEST_SCENARIO_MISSION.campaignId).toBe("test");
    expect(TEST_SCENARIO_MISSION.battle.enemyLabel).toBe("Saxons");
    expect(TEST_SCENARIO_MISSION.battlefield.features).toEqual([]);
  });
});
