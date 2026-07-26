import { describe, expect, it } from "vitest";
import { createPrototypeScenario } from "../scenario/PrototypeScenario";
import { Simulation } from "../systems/Simulation";
import {
  createFormationSpine,
  FORMATION_SPINE_POINT_COUNT,
  sampleFormationSpine,
} from "../units/FormationSpine";
import { Battlefield } from "../world/Battlefield";

describe("elastic formation spine", () => {
  it("creates five ordered control points across the frontage", () => {
    const spine = createFormationSpine(200);

    expect(spine).toHaveLength(FORMATION_SPINE_POINT_COUNT);
    expect(spine[0]?.baseX).toBeCloseTo(-96);
    expect(spine[2]?.baseX).toBeCloseTo(0);
    expect(spine[4]?.baseX).toBeCloseTo(96);
    for (let index = 1; index < spine.length; index += 1) {
      expect(spine[index]?.baseX).toBeGreaterThan(
        spine[index - 1]?.baseX ?? Infinity,
      );
    }
  });

  it("interpolates the curve and a perpendicular row direction", () => {
    const spine = createFormationSpine(200);
    const centre = spine[2];
    if (!centre) throw new Error("Centre spine point missing");
    centre.x = 10;
    centre.y = -40;
    const sample = { x: 0, y: 0, normalX: 0, normalY: 1 };

    sampleFormationSpine(spine, 0, sample);

    expect(sample.x).toBeCloseTo(10);
    expect(sample.y).toBeCloseTo(-40);
    expect(Math.hypot(sample.normalX, sample.normalY)).toBeCloseTo(1);
    expect(Math.abs(sample.normalX)).toBeGreaterThan(0.1);
  });

  it("bends connected control points around an obstacle", () => {
    const unit = createPrototypeScenario().find((candidate) =>
      candidate.id === "R-I"
    );
    if (!unit) throw new Error("Scenario unit missing");
    const battlefield = new Battlefield(402);
    battlefield.trees.length = 0;
    battlefield.rocks.length = 0;
    battlefield.trees.push({
      x: 500,
      y: 500,
      size: 20,
      rotation: 0,
    });
    unit.position = { x: 500, y: 500 };
    unit.facing = 0;
    unit.order = { type: "hold" };
    const simulation = new Simulation([unit], battlefield);

    simulation.update(0.25);

    const centre = unit.formationSpine[2];
    const neighbour = unit.formationSpine[1];
    const edge = unit.formationSpine[0];
    if (!centre || !neighbour || !edge) {
      throw new Error("Formation spine incomplete");
    }
    const centreBend = Math.hypot(centre.x - centre.baseX, centre.y);
    const neighbourBend = Math.hypot(neighbour.x - neighbour.baseX, neighbour.y);
    const edgeBend = Math.hypot(edge.x - edge.baseX, edge.y);
    expect(centreBend).toBeGreaterThan(10);
    expect(neighbourBend).toBeGreaterThan(edgeBend);
    expect(neighbourBend).toBeLessThan(centreBend);
  });
});
