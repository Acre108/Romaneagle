import { describe, expect, it } from "vitest";
import { spreadPlates, type PlateRect } from "../gridBattle/rendering/plateLayout";

const plate = (x: number, y: number, width = 100, height = 20): PlateRect => ({ x, y, width, height });

function anyOverlap(rects: readonly PlateRect[]): boolean {
  return rects.some((a, i) => rects.some((b, j) => i < j
    && Math.abs(a.x - b.x) < (a.width + b.width) / 2
    && Math.abs(a.y - b.y) < (a.height + b.height) / 2));
}

describe("formation plate layout", () => {
  it("leaves plates that do not touch where they are", () => {
    expect(spreadPlates([plate(0, 0), plate(500, 0), plate(0, 100)])).toEqual([0, 0, 100]);
  });

  it("keeps the nearest plate in place and moves the one behind it up", () => {
    const [behind, near] = spreadPlates([plate(0, 90), plate(10, 100)]);
    expect(near).toBe(100);
    expect(behind).toBeLessThan(80);
  });

  it("always finishes, even with sizes that round badly", () => {
    const awkward = Array.from({ length: 40 }, (_, index) =>
      plate(index * 0.1, 100 + index * 0.1, 137.3 + index * 0.07, 24.700000000000003 + index * 0.013));
    const ys = spreadPlates(awkward);
    expect(anyOverlap(awkward.map((rect, index) => ({ ...rect, y: ys[index]! })))).toBe(false);
  });

  it("clears a whole pile of plates and gives the same answer every time", () => {
    const pile = Array.from({ length: 12 }, (_, index) => plate(index * 15, 100 + (index % 3) * 4));
    const ys = spreadPlates(pile);
    expect(anyOverlap(pile.map((rect, index) => ({ ...rect, y: ys[index]! })))).toBe(false);
    expect(spreadPlates(pile)).toEqual(ys);
  });
});
