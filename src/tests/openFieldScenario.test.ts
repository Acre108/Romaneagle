import { describe, expect, it } from "vitest";
import { TEST_UNIT_OPTIONS } from "../scenario/TestScenario";
import { scenarioFactoryForMission } from "../gridBattle/scenario/campaignScenario";
import { mapTileAt } from "../gridBattle/model/battlefieldMap";
import { OPEN_FIELD_HEIGHT, OPEN_FIELD_ROMAN_FRONT_ROW, OPEN_FIELD_WIDTH } from "../gridBattle/scenario/openFieldScenario";
import type { GameState } from "../gridBattle/model/types";
import { getUnitArchetype } from "../units/UnitArchetypes";

const sandbox = (ids: readonly string[] = []): GameState => scenarioFactoryForMission("test-field-trials", ids)();

function rowsOf(state: GameState, factionId: string): number[] {
  return Object.values(state.blocks).filter((block) => block.factionId === factionId).map((block) => block.position.y);
}

function combinations<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  return items.flatMap((item, index) =>
    combinations(items.slice(index + 1), size - 1).map((rest) => [item, ...rest]));
}

describe("the open-field sandbox", () => {
  it("is open ground with no terrain to interfere", () => {
    const { battlefield } = sandbox();
    expect([battlefield.width, battlefield.height]).toEqual([OPEN_FIELD_WIDTH, OPEN_FIELD_HEIGHT]);
    for (let y = 0; y < battlefield.height; y += 1) {
      for (let x = 0; x < battlefield.width; x += 1) {
        expect(mapTileAt(battlefield, { x, y })?.terrain).toBe("clear");
      }
    }
    expect(battlefield.buildings).toEqual([]);
    expect(battlefield.triggers).toEqual([]);
  });

  it("restarts identically", () => {
    expect(JSON.stringify(sandbox())).toBe(JSON.stringify(sandbox()));
  });

  it("starts with the lines facing each other across empty ground", () => {
    const state = sandbox();
    const saxonFront = Math.max(...rowsOf(state, "saxon"));
    const romanFront = Math.min(...rowsOf(state, "roman"));
    expect(romanFront - saxonFront - 1).toBe(8);
    for (const formation of Object.values(state.formations)) {
      expect(formation.facing).toBe(formation.factionId === "roman" ? "north" : "south");
    }
  });

  it("puts ranged formations behind the infantry and cavalry on the wings", () => {
    const state = sandbox();
    const romans = Object.values(state.formations).filter((formation) => formation.factionId === "roman");
    const option = (name: string) => TEST_UNIT_OPTIONS.find((candidate) => candidate.name === name)!;
    const rows = (id: string) => state.formations[id]!.blockIds.map((blockId) => state.blocks[blockId]!.position.y);
    const columns = (id: string) => state.formations[id]!.blockIds.map((blockId) => state.blocks[blockId]!.position.x);
    expect(romans.length).toBeGreaterThan(1);
    const artillery = option("Ballistarii Detachment").id;
    const infantry = option("Lanciarii").id;
    expect(Math.min(...rows(artillery))).toBeGreaterThan(Math.max(...rows(infantry)));
    const cavalry = option("Armoured Equites").id;
    expect(Math.max(...columns(cavalry))).toBeLessThan(Math.min(...columns(infantry)));
    for (const name of ["Auxiliary Cohort Detachment", "Plumbatarii", "Lanciarii", "Milites Christi"]) {
      expect(Math.min(...rows(option(name).id))).toBe(OPEN_FIELD_ROMAN_FRONT_ROW);
    }
  });

  it("has room for every roster the sandbox allows, without overlaps", () => {
    const ids = TEST_UNIT_OPTIONS.map((option) => option.id);
    for (const roster of combinations(ids, 8)) {
      const state = sandbox(roster);
      const cells = Object.values(state.blocks).map((block) => `${block.position.x},${block.position.y}`);
      expect(new Set(cells).size).toBe(cells.length);
      for (const block of Object.values(state.blocks)) {
        expect(block.position.x).toBeGreaterThanOrEqual(0);
        expect(block.position.x).toBeLessThan(OPEN_FIELD_WIDTH);
        expect(block.position.y).toBeLessThan(OPEN_FIELD_HEIGHT);
      }
    }
  });

  it("keeps every chosen formation's soldiers", () => {
    const option = TEST_UNIT_OPTIONS.find((candidate) => getUnitArchetype(candidate.archetypeId).type === "archers")!;
    const state = sandbox([option.id]);
    const blocks = state.formations[option.id]!.blockIds.map((blockId) => state.blocks[blockId]!);
    expect(blocks.reduce((total, block) => total + block.models, 0)).toBe(option.strength);
  });
});
