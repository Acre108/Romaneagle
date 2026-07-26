import { describe, expect, it } from "vitest";
import {
  canUseUniqueAbility,
  getUniqueAbility,
  useUniqueAbility,
} from "../units/abilities";
import { createPrototypeScenario } from "../scenario/PrototypeScenario";

describe("unit unique abilities", () => {
  it("assigns tortoise to Roman infantry and shieldwall to Saxon infantry", () => {
    const units = createPrototypeScenario();
    const romanInfantry = units.find((unit) => unit.id === "R-I");
    const saxonInfantry = units.find((unit) => unit.id === "S-WOLF");

    expect(romanInfantry && getUniqueAbility(romanInfantry)?.id).toBe("tortoise");
    expect(saxonInfantry && getUniqueAbility(saxonInfantry)?.id).toBe("shieldwall");
  });

  it("leaves units without a configured ability ineligible", () => {
    const units = createPrototypeScenario();
    for (const id of ["R-CAV", "R-STD", "R-ARCH", "S-SKIRM", "S-STD", "S-ARCH"]) {
      const unit = units.find((candidate) => candidate.id === id);
      expect(unit && getUniqueAbility(unit)).toBeUndefined();
      expect(unit && canUseUniqueAbility(unit)).toBe(false);
    }
  });

  it("activates each faction's configured formation and starts reorganisation", () => {
    const units = createPrototypeScenario();
    const romanInfantry = units.find((unit) => unit.id === "R-I");
    const saxonInfantry = units.find((unit) => unit.id === "S-WOLF");
    if (!romanInfantry || !saxonInfantry) throw new Error("Scenario units missing");

    expect(useUniqueAbility(romanInfantry)).toBe(true);
    expect(romanInfantry.formation).toBe("tortoise");
    expect(romanInfantry.formationChangeTimer).toBe(5);
    expect(romanInfantry.order.type).toBe("hold");

    expect(useUniqueAbility(saxonInfantry)).toBe(true);
    expect(saxonInfantry.formation).toBe("shieldwall");
    expect(saxonInfantry.formationChangeTimer).toBe(5);
    expect(saxonInfantry.order.type).toBe("hold");
  });

  it("does not activate while routing, reorganising, or already active", () => {
    const routing = createPrototypeScenario()[0];
    const reorganising = createPrototypeScenario()[1];
    const alreadyActive = createPrototypeScenario()[2];
    if (!routing || !reorganising || !alreadyActive) throw new Error("Scenario units missing");

    routing.state = "routing";
    reorganising.formationChangeTimer = 2;
    alreadyActive.formation = "tortoise";

    expect(useUniqueAbility(routing)).toBe(false);
    expect(useUniqueAbility(reorganising)).toBe(false);
    expect(useUniqueAbility(alreadyActive)).toBe(false);
  });
});
