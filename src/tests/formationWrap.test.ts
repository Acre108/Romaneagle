import { describe, expect, it } from "vitest";
import { createPrototypeScenario } from "../scenario/PrototypeScenario";
import {
  calculateCohesiveFormationWrapAdvance,
  calculateFormationWrapOffset,
  calculateFormationWrapAdvance,
  isBroadFormationWrappingTortoise,
  MAX_FORMATION_WRAP,
} from "../units/FormationWrap";
import { applyFormation } from "../units/formation";

describe("formation frontage wrapping", () => {
  it("leaves an already parallel contact line straight", () => {
    const units = createPrototypeScenario();
    const roman = units[0];
    const saxon = units[5];
    if (!roman || !saxon) throw new Error("Scenario units missing");
    roman.position = { x: 400, y: 400 };
    roman.facing = Math.PI;
    saxon.position = { x: 400, y: 432.5 };
    saxon.facing = 0;

    expect(calculateFormationWrapAdvance(roman, saxon, -80)).toBeCloseTo(0);
    expect(calculateFormationWrapAdvance(roman, saxon, 80)).toBeCloseTo(0);
  });

  it("advances the open wing farther when frontages meet obliquely", () => {
    const units = createPrototypeScenario();
    const roman = units[0];
    const saxon = units[5];
    if (!roman || !saxon) throw new Error("Scenario units missing");
    roman.position = { x: 400, y: 400 };
    roman.facing = Math.PI;
    saxon.position = { x: 400, y: 480 };
    saxon.facing = 0.5;

    const firstWing = calculateFormationWrapAdvance(roman, saxon, -80);
    const secondWing = calculateFormationWrapAdvance(roman, saxon, 80);
    expect(Math.max(firstWing, secondWing)).toBeGreaterThan(Math.min(firstWing, secondWing) + 20);
    expect(Math.max(firstWing, secondWing)).toBeLessThanOrEqual(MAX_FORMATION_WRAP);
  });

  it("pulls an unsupported outer file into a trailing position", () => {
    const units = createPrototypeScenario();
    const roman = units[0];
    const saxon = units[5];
    if (!roman || !saxon) throw new Error("Scenario units missing");
    roman.position = { x: 400, y: 400 };
    roman.facing = Math.PI;
    saxon.position = { x: 450, y: 480 };
    saxon.facing = 0.5;

    const direct = calculateFormationWrapAdvance(roman, saxon, 92);
    const cohesive = calculateCohesiveFormationWrapAdvance(roman, saxon, 92);
    expect(cohesive).toBeGreaterThanOrEqual(direct);
    expect(cohesive).toBeGreaterThan(0);
  });

  it("bends a broad line's outer files around a compact tortoise", () => {
    const units = createPrototypeScenario();
    const tortoise = units[0];
    const saxon = units[5];
    if (!tortoise || !saxon) throw new Error("Scenario units missing");
    applyFormation(tortoise, "tortoise");
    tortoise.position = { x: 400, y: 400 };
    tortoise.facing = Math.PI;
    saxon.position = { x: 400, y: 470 };
    saxon.facing = 0;

    const rightWing = calculateFormationWrapOffset(saxon, tortoise, 90);
    const leftWing = calculateFormationWrapOffset(saxon, tortoise, -90);

    expect(isBroadFormationWrappingTortoise(saxon, tortoise)).toBe(true);
    expect(rightWing.advance).toBeGreaterThan(20);
    expect(leftWing.advance).toBeGreaterThan(20);
    expect(rightWing.lateral).toBeLessThan(0);
    expect(leftWing.lateral).toBeGreaterThan(0);
  });
});
