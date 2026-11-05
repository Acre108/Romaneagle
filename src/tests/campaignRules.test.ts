import { describe, expect, it } from "vitest";
import {
  afterBattleLine,
  deployedStrength,
  formationCasualties,
  formationExperience,
  formationHealthLabel,
} from "../campaign/CampaignRules";
import {
  ROMAN_FORMATION_BY_ID,
  ROMAN_FORMATIONS,
} from "../scenario/Roster";
import { getUnitArchetype } from "../units/UnitArchetypes";

describe("campaign roster", () => {
  it("keeps every campaign formation consistent with its archetype", () => {
    for (const definition of ROMAN_FORMATIONS) {
      const archetype = getUnitArchetype(definition.archetypeId);
      expect(archetype.faction).toBe("roman");
      expect(definition.count).toBeGreaterThan(0);
      expect(archetype.type).not.toBe("standard");
    }
  });

  it("includes Quarta without changing the five-formation deployment cap", () => {
    expect(ROMAN_FORMATION_BY_ID.get("R-IV")?.companion.name).toBe("Junia Valeria");
    expect(ROMAN_FORMATIONS).toHaveLength(6);
    expect(ROMAN_FORMATIONS.filter((formation) => formation.defaultSelected)).toHaveLength(5);
  });

  it("calculates deployed strength from roster counts", () => {
    expect(deployedStrength(
      ROMAN_FORMATIONS,
      new Set(["R-IV", "R-CAV"]),
    )).toBe(120);
  });
});

describe("victory debrief rules", () => {
  const formation = {
    id: "R-I",
    name: "I Cohort · Prima",
    type: "infantry" as const,
    soldierCount: 20,
    maximumSoldiers: 80,
    state: "shaken" as const,
  };

  it("labels and rewards formations from their actual final strength", () => {
    expect(formationHealthLabel(formation)).toBe("Mauled");
    expect(formationCasualties(formation)).toBe(60);
    expect(formationExperience(formation)).toBe(69);
  });

  it("distinguishes routing and escaped survivors from destroyed formations", () => {
    const fullStrength = { ...formation, soldierCount: 80, state: "steady" as const };
    expect(formationHealthLabel({ ...fullStrength, state: "routing" })).toBe("Routing");
    expect(formationHealthLabel({ ...fullStrength, state: "escaped" })).toBe("Escaped");
    expect(formationExperience(fullStrength)).toBe(46);
    expect(formationExperience({ ...fullStrength, state: "routing" })).toBe(36);
    expect(formationExperience({ ...fullStrength, state: "escaped" })).toBe(31);
    expect(formationExperience({ ...fullStrength, soldierCount: 0, state: "broken" })).toBe(0);
  });

  it("uses casualty-aware companion dialogue", () => {
    const companion = ROMAN_FORMATION_BY_ID.get("R-I")!.companion;
    expect(afterBattleLine(companion, formation)).toBe(companion.bloodiedLine);
    expect(afterBattleLine(companion, {
      ...formation,
      soldierCount: 0,
      state: "broken",
    })).toBe(companion.lostLine);
    expect(afterBattleLine(companion, {
      ...formation,
      soldierCount: 80,
      state: "escaped",
    })).toBe(companion.lostLine);
  });
});
