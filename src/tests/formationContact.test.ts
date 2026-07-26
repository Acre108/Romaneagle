import { describe, expect, it } from "vitest";
import { createPrototypeScenario } from "../scenario/PrototypeScenario";
import {
  calculateFormationContact,
  formationHalfDepth,
} from "../units/FormationContact";

function opposingFrontageDistance(
  a: Parameters<typeof formationHalfDepth>[0],
  b: Parameters<typeof formationHalfDepth>[0],
  gap: number,
): number {
  return formationHalfDepth(a) + formationHalfDepth(b) + gap;
}

describe("formation contact geometry", () => {
  it("does not treat the diagonal radius of a wide line as melee contact", () => {
    const units = createPrototypeScenario();
    const roman = units[0];
    const saxon = units[5];
    if (!roman || !saxon) throw new Error("Scenario units missing");
    roman.position = { x: 400, y: 400 };
    roman.facing = Math.PI;
    saxon.position = {
      x: 400,
      y: 400 + opposingFrontageDistance(roman, saxon, 50),
    };
    saxon.facing = 0;

    expect(calculateFormationContact(roman, saxon).separation).toBeCloseTo(50);
  });

  it("puts opposing front-rank soldier centres about one body width apart", () => {
    const units = createPrototypeScenario();
    const roman = units[0];
    const saxon = units[5];
    if (!roman || !saxon) throw new Error("Scenario units missing");
    roman.position = { x: 400, y: 400 };
    roman.facing = Math.PI;
    saxon.position = {
      x: 400,
      y: 400 + opposingFrontageDistance(roman, saxon, 6),
    };
    saxon.facing = 0;

    expect(calculateFormationContact(roman, saxon).separation).toBeCloseTo(6);
  });

  it("keeps a second rank out of contact when the first rank fills the frontage", () => {
    const units = createPrototypeScenario();
    const frontRoman = units[0];
    const rearRoman = units[1];
    const saxon = units[5];
    if (!frontRoman || !rearRoman || !saxon) throw new Error("Scenario units missing");
    frontRoman.position = { x: 400, y: 400 };
    frontRoman.facing = Math.PI;
    rearRoman.position = { x: 400, y: 360 };
    rearRoman.facing = Math.PI;
    saxon.position = {
      x: 400,
      y: 400 + opposingFrontageDistance(frontRoman, saxon, 6),
    };
    saxon.facing = 0;

    expect(calculateFormationContact(frontRoman, saxon).separation).toBeCloseTo(6);
    expect(calculateFormationContact(rearRoman, saxon).separation).toBeGreaterThan(40);
  });
});
