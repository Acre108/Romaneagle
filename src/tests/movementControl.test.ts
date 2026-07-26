import { describe, expect, it } from "vitest";
import { createPrototypeScenario } from "../scenario/PrototypeScenario";
import { Simulation } from "../systems/Simulation";
import { assignFormationMoveOrder } from "../units/FormationPathfinding";
import { Battlefield } from "../world/Battlefield";

describe("formation movement control", () => {
  it("keeps the commanded endpoint fixed while pivoting into the final facing", () => {
    const unit = createPrototypeScenario()[0];
    if (!unit) throw new Error("Scenario unit missing");
    const battlefield = new Battlefield(402);
    const simulation = new Simulation([unit], battlefield);
    const goal = { ...unit.position };

    assignFormationMoveOrder(unit, goal, Math.PI / 2, battlefield);
    for (let step = 0; step < 300 && unit.order.type !== "hold"; step += 1) {
      expect(unit.order.finalDestination).toEqual(goal);
      simulation.update(0.05);
    }

    expect(unit.order.type).toBe("hold");
    expect(unit.position.x).toBeCloseTo(goal.x);
    expect(unit.position.y).toBeCloseTo(goal.y);
    expect(unit.facing).toBeCloseTo(Math.PI / 2, 1);
  });

  it("gives a Roman formation a passable route across deep water", () => {
    const unit = createPrototypeScenario()[0];
    if (!unit) throw new Error("Scenario unit missing");
    const battlefield = new Battlefield(402);
    const streamY = battlefield.streamY(800);
    unit.position = { x: 800, y: streamY - 180 };
    const goal = { x: 800, y: streamY + 240 };

    expect(assignFormationMoveOrder(unit, goal, Math.PI, battlefield)).toBe(true);
    expect(unit.order.route?.length).toBeGreaterThan(1);
    let previous = unit.position;
    for (const waypoint of unit.order.route ?? []) {
      expect(battlefield.segmentBlocked(previous, waypoint)).toBe(false);
      previous = waypoint;
    }
  });
});
