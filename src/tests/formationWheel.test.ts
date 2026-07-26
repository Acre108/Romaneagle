import { describe, expect, it } from "vitest";
import { createPrototypeScenario } from "../scenario/PrototypeScenario";
import { formationHalfWidth } from "../units/FormationContact";
import { wheelFormation } from "../units/FormationWheel";

describe("formation wheeling", () => {
  it("keeps the inside flank fixed while the outside flank advances", () => {
    const unit = createPrototypeScenario()[0];
    if (!unit) throw new Error("Scenario unit missing");
    unit.position = { x: 400, y: 400 };
    unit.facing = 0;
    const halfWidth = formationHalfWidth(unit);
    const insideBefore = { x: unit.position.x + halfWidth, y: unit.position.y };
    const outsideBefore = { x: unit.position.x - halfWidth, y: unit.position.y };

    wheelFormation(unit, Math.PI / 6);

    const sideX = Math.cos(unit.facing);
    const sideY = Math.sin(unit.facing);
    const insideAfter = {
      x: unit.position.x + sideX * halfWidth,
      y: unit.position.y + sideY * halfWidth,
    };
    const outsideAfter = {
      x: unit.position.x - sideX * halfWidth,
      y: unit.position.y - sideY * halfWidth,
    };
    expect(insideAfter.x).toBeCloseTo(insideBefore.x);
    expect(insideAfter.y).toBeCloseTo(insideBefore.y);
    expect(outsideAfter.y).toBeLessThan(outsideBefore.y);
  });
});
