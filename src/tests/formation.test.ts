import { describe, expect, it } from "vitest";
import {
  createFormationLayout,
} from "../units/formation";

describe("formation layouts", () => {
  it("creates one slot per soldier", () => {
    const layout = createFormationLayout(80, "line", "infantry");
    expect(layout.slots).toHaveLength(80);
  });

  it("makes line wider than column and column deeper than line", () => {
    const line = createFormationLayout(80, "line", "infantry");
    const column = createFormationLayout(80, "column", "infantry");
    expect(line.width).toBeGreaterThan(column.width);
    expect(column.depth).toBeGreaterThan(line.depth);
  });

  it("uses looser spacing for Saxon-style formations", () => {
    const disciplined = createFormationLayout(70, "line", "infantry", false);
    const loose = createFormationLayout(70, "line", "infantry", true);
    expect(loose.width).toBeGreaterThan(disciplined.width);
    expect(loose.depth).toBeGreaterThan(disciplined.depth);
    expect(new Set(loose.slots.map((slot) => slot.y.toFixed(2))).size).toBeGreaterThan(4);
    expect(loose).toEqual(createFormationLayout(70, "line", "infantry", true));
  });

  it("lets a Saxon shieldwall tighten its otherwise loose ranks", () => {
    const looseLine = createFormationLayout(70, "line", "infantry", true);
    const shieldwall = createFormationLayout(70, "shieldwall", "infantry", true);

    expect(shieldwall.width * shieldwall.depth).toBeLessThan(
      looseLine.width * looseLine.depth,
    );
    expect(new Set(shieldwall.slots.map((slot) => slot.y.toFixed(2))).size).toBe(4);
  });

  it("creates a compact mob instead of a frontage", () => {
    const mob = createFormationLayout(80, "mob", "infantry");
    const line = createFormationLayout(80, "line", "infantry");

    expect(mob.slots).toHaveLength(80);
    expect(mob.width / mob.depth).toBeGreaterThan(0.7);
    expect(mob.width / mob.depth).toBeLessThan(1.3);
    expect(mob.width).toBeLessThan(line.width);
  });

  it("creates a dense Roman tortoise", () => {
    const tortoise = createFormationLayout(80, "tortoise", "infantry");
    const line = createFormationLayout(80, "line", "infantry");

    expect(tortoise.slots).toHaveLength(80);
    expect(tortoise.width).toBeLessThan(line.width);
  });
});
