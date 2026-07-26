import { describe, expect, it } from "vitest";
import {
  resolveUnitLabelPlacements,
  unitLabelsOverlap,
  type UnitLabelPlacement,
} from "../rendering/UnitLabelLayout";

function label(id: string, x: number, top: number): UnitLabelPlacement {
  return {
    id,
    desiredX: x,
    desiredTop: top,
    x,
    top,
    width: 76,
    height: 37,
  };
}

describe("unit label layout", () => {
  it("moves colliding unit information sideways", () => {
    const labels = [label("R-I", 200, 100), label("S-WOLF", 202, 102)];

    resolveUnitLabelPlacements(labels, labels.length, 600, 400);

    expect(unitLabelsOverlap(labels[0]!, labels[1]!)).toBe(false);
    expect(labels[1]?.x).not.toBe(labels[1]?.desiredX);
    expect(Math.abs(labels[1]!.x - labels[1]!.desiredX)).toBeLessThanOrEqual(80);
  });

  it("packs a dense label group into nearby rows", () => {
    const labels = [
      label("A", 300, 150),
      label("B", 301, 151),
      label("C", 299, 149),
      label("D", 302, 150),
    ];

    resolveUnitLabelPlacements(labels, labels.length, 700, 450);

    for (let first = 0; first < labels.length; first += 1) {
      for (let second = first + 1; second < labels.length; second += 1) {
        expect(unitLabelsOverlap(labels[first]!, labels[second]!)).toBe(false);
      }
    }
    for (const placement of labels.slice(1)) {
      expect(Math.hypot(
        placement.x - placement.desiredX,
        placement.top - placement.desiredTop,
      )).toBeLessThan(100);
    }
  });

  it("keeps displaced labels inside the viewport", () => {
    const labels = [
      label("A", 30, -20),
      label("B", 31, -19),
      label("C", 32, -18),
    ];

    resolveUnitLabelPlacements(labels, labels.length, 220, 120);

    for (const placement of labels) {
      expect(placement.x - placement.width * 0.5).toBeGreaterThanOrEqual(4);
      expect(placement.x + placement.width * 0.5).toBeLessThanOrEqual(216);
      expect(placement.top).toBeGreaterThanOrEqual(4);
      expect(placement.top + placement.height).toBeLessThanOrEqual(116);
    }
  });
});
