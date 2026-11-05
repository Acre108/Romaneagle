import { describe, expect, it } from "vitest";
import { readableLabelScale } from "../gridBattle/rendering/labelScale";
import { FACING_ARROWS, formationPlates } from "../gridBattle/rules/formationPlates";
import { directionToDiamondEdge } from "../gridBattle/rendering/isometric/IsoProjection";
import { createOpenFieldScenario } from "../gridBattle/scenario/openFieldScenario";

describe("labels that stay readable when zoomed out", () => {
  it("enlarges a label just enough to reach the minimum size on screen", () => {
    expect(readableLabelScale(10, 11, 0.38)).toBeCloseTo(11 / 3.8);
    expect(readableLabelScale(10, 11, 0.38) * 10 * 0.38).toBeCloseTo(11);
  });

  it("never shrinks a label that is already big enough", () => {
    expect(readableLabelScale(10, 11, 1.75)).toBe(1);
    expect(readableLabelScale(18, 12, 1)).toBe(1);
  });

  it("falls back to the drawn size before the canvas has a size", () => {
    expect(readableLabelScale(10, 11, 0)).toBe(1);
    expect(readableLabelScale(10, 11, Number.NaN)).toBe(1);
  });
});

describe("formation plates show facing and whether a formation can still act", () => {
  it("points each arrow at the diamond edge the formation faces on screen", () => {
    const screenEdge = { "↗": "upperRight", "↘": "lowerRight", "↙": "lowerLeft", "↖": "upperLeft" } as const;
    for (const direction of ["north", "east", "south", "west"] as const) {
      expect(screenEdge[FACING_ARROWS[direction] as keyof typeof screenEdge]).toBe(directionToDiamondEdge(direction));
    }
  });

  it("gives every plate its formation's facing", () => {
    const state = createOpenFieldScenario();
    const plates = formationPlates(state);
    expect(plates.find((plate) => plate.key === "great-warband")).toMatchObject({ facing: "south", arrow: "↙" });
    for (const plate of plates) expect(plate.arrow).toBe(FACING_ARROWS[plate.facing]);
  });

  it("marks formations ready, spent once they act, and routing apart from both", () => {
    const state = createOpenFieldScenario();
    expect(formationPlates(state).every((plate) => plate.activation === "ready")).toBe(true);
    state.formations["great-warband"]!.hasActivated = true;
    state.formations["loose-warband"]!.status = "routed";
    const plates = formationPlates(state);
    expect(plates.find((plate) => plate.key === "great-warband")?.activation).toBe("spent");
    expect(plates.find((plate) => plate.key === "loose-warband")?.activation).toBe("routing");
    expect(plates.find((plate) => plate.key === "left-warband")?.activation).toBe("ready");
  });

  it("counts a split formation as spent once any of its groups has acted", () => {
    const state = createOpenFieldScenario();
    const parent = state.formations["great-warband"]!;
    state.formations["great-warband-fragment-1"] = {
      ...parent,
      id: "great-warband-fragment-1",
      blockIds: [parent.blockIds[0]!],
      hasActivated: true,
      provisionalFamilyId: "great-warband",
    };
    parent.blockIds = parent.blockIds.slice(1);
    expect(formationPlates(state).find((plate) => plate.key === "great-warband")?.activation).toBe("spent");
  });
});
