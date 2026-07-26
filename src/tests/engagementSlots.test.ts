import { describe, expect, it } from "vitest";
import { createPrototypeScenario } from "../scenario/PrototypeScenario";
import {
  calculateEngagementSlotPosition,
  createEngagementSlotUsage,
  engagementSlotCapacity,
  hasOpenEngagementSlot,
  selectEngagementSlot,
} from "../units/EngagementSlots";

function combatants() {
  const units = createPrototypeScenario();
  const infantry = units.find((unit) => unit.id === "S-WOLF");
  const cavalry = units.find((unit) => unit.id === "R-CAV");
  const target = units.find((unit) => unit.id === "R-I");
  if (!infantry || !cavalry || !target) {
    throw new Error("Scenario units missing");
  }
  target.position = { x: 600, y: 600 };
  target.facing = 0;
  return { infantry, cavalry, target };
}

describe("engagement slot layout", () => {
  it("places each arc outside the corresponding formation face", () => {
    const { infantry, target } = combatants();
    const front = calculateEngagementSlotPosition(
      infantry,
      target,
      "front",
      0,
      1,
    );
    const left = calculateEngagementSlotPosition(
      infantry,
      target,
      "left",
      0,
      1,
    );
    const rear = calculateEngagementSlotPosition(
      infantry,
      target,
      "rear",
      0,
      1,
    );

    expect(front.y).toBeLessThan(target.position.y);
    expect(left.x).toBeLessThan(target.position.x);
    expect(rear.y).toBeGreaterThan(target.position.y);
  });

  it("selects another face when the nearest frontage is full", () => {
    const { infantry, target } = combatants();
    infantry.position = { x: 600, y: 400 };
    const usage = createEngagementSlotUsage();
    usage.front = engagementSlotCapacity(infantry, target, "front");

    const slot = selectEngagementSlot(infantry, target, usage);

    expect(slot?.arc).not.toBe("front");
    expect(hasOpenEngagementSlot(infantry, target, usage)).toBe(true);
  });

  it("steers cavalry toward an available flank", () => {
    const { cavalry, target } = combatants();
    cavalry.position = { x: 380, y: 600 };

    const slot = selectEngagementSlot(
      cavalry,
      target,
      createEngagementSlotUsage(),
    );

    expect(slot?.arc).toBe("left");
  });

  it("keeps a reachable engagement face when a small distance change favours another", () => {
    const { infantry, target } = combatants();
    infantry.position = { x: 420, y: 580 };
    const usage = createEngagementSlotUsage();

    expect(selectEngagementSlot(infantry, target, usage)?.arc).toBe("left");
    expect(selectEngagementSlot(infantry, target, usage, "front")?.arc).toBe(
      "front",
    );
  });

  it("does not route a frontal attacker straight through a formation to its rear", () => {
    const { infantry, target } = combatants();
    infantry.position = { x: 600, y: 350 };
    const usage = createEngagementSlotUsage();
    usage.front = engagementSlotCapacity(infantry, target, "front");
    usage.left = engagementSlotCapacity(infantry, target, "left");
    usage.right = engagementSlotCapacity(infantry, target, "right");

    expect(selectEngagementSlot(infantry, target, usage)).toBeUndefined();
    expect(hasOpenEngagementSlot(infantry, target, usage)).toBe(false);
  });
});
