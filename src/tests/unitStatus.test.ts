import { describe, expect, it } from "vitest";
import { createPrototypeScenario } from "../scenario/PrototypeScenario";
import { getUnitStatusText } from "../units/UnitStatus";

describe("unit status labels", () => {
  it("shows morale when the unit has no urgent activity", () => {
    const unit = createPrototypeScenario()[0];
    if (!unit) throw new Error("Scenario unit missing");

    expect(getUnitStatusText(unit)).toBe("STEADY");

    unit.state = "shaken";
    expect(getUnitStatusText(unit)).toBe("SHAKEN");
  });

  it("prioritises reorganisation, flanking, and charging statuses", () => {
    const unit = createPrototypeScenario()[0];
    if (!unit) throw new Error("Scenario unit missing");

    unit.formationChangeTimer = 4;
    expect(getUnitStatusText(unit)).toBe("REORGANISING · STEADY");

    unit.formationChangeTimer = 0;
    unit.vulnerableTimer = 2;
    expect(getUnitStatusText(unit)).toBe("FLANKED! · STEADY");

    unit.vulnerableTimer = 0;
    unit.chargeTargetId = "S-WOLF";
    expect(getUnitStatusText(unit)).toBe("CHARGING · STEADY");
  });

  it("shows whether an engaged unit is winning or being pressed", () => {
    const unit = createPrototypeScenario()[0];
    if (!unit) throw new Error("Scenario unit missing");
    unit.inCombat = true;
    unit.recentDamageDealt = 6;
    unit.recentDamageTaken = 2;

    expect(getUnitStatusText(unit)).toBe("WINNING · STEADY");

    unit.recentDamageDealt = 2;
    unit.recentDamageTaken = 6;
    expect(getUnitStatusText(unit)).toBe("PRESSED · STEADY");
  });

  it("distinguishes closing on a target from actual engagement", () => {
    const unit = createPrototypeScenario()[5];
    if (!unit) throw new Error("Scenario unit missing");
    unit.aiTargetId = "R-I";
    unit.order = { type: "move", destination: { x: 600, y: 600 } };

    expect(getUnitStatusText(unit)).toBe("CLOSING · STEADY");

    unit.inCombat = true;
    expect(getUnitStatusText(unit)).toBe("ENGAGED · STEADY");
  });

  it("shows when a stalled unit is falling back to find a new route", () => {
    const unit = createPrototypeScenario()[5];
    if (!unit) throw new Error("Scenario unit missing");
    unit.pathingState = "fallback";

    expect(getUnitStatusText(unit)).toBe("FALLING BACK · STEADY");
  });

  it("shows when a unit is inspired by its battle standard", () => {
    const unit = createPrototypeScenario()[0];
    if (!unit) throw new Error("Scenario unit missing");
    unit.standardMoraleBoost = true;

    expect(getUnitStatusText(unit)).toBe("INSPIRED · STEADY");
  });

  it("shows the remaining routing decision time", () => {
    const unit = createPrototypeScenario()[0];
    if (!unit) throw new Error("Scenario unit missing");
    unit.state = "routing";
    unit.routingTimer = 3.2;

    expect(getUnitStatusText(unit)).toBe("ROUTING 7s");
  });

  it("shows low and exhausted archer ammunition", () => {
    const archer = createPrototypeScenario().find((unit) =>
      unit.id === "R-ARCH"
    );
    if (!archer) throw new Error("Scenario archer missing");
    archer.ammunition = 3;
    expect(getUnitStatusText(archer)).toBe("LOW AMMO · STEADY");

    archer.ammunition = 0;
    expect(getUnitStatusText(archer)).toBe("OUT OF AMMO · STEADY");
  });
});
