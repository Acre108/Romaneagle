import { describe, expect, it } from "vitest";
import {
  calculateFormationTerrainCoverage,
  classifyFormationTerrain,
  constrainFormationWorldPoint,
  FORMATION_MAP_MARGIN,
  FORMATION_STREAM_CLEARANCE,
  SAXON_FORMATION_FLOW_CLEARANCE,
  type FormationTerrainCoverage,
} from "../units/FormationTerrain";
import { createPrototypeScenario } from "../scenario/PrototypeScenario";
import { Simulation } from "../systems/Simulation";
import {
  Battlefield,
  BRIDGE_CENTRE_X,
  BRIDGE_HALF_LENGTH,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../world/Battlefield";

function emptyBattlefield(): Battlefield {
  const battlefield = new Battlefield(402);
  battlefield.trees.length = 0;
  battlefield.rocks.length = 0;
  return battlefield;
}

describe("formation terrain deformation", () => {
  it("keeps formation occupants inside the battlefield", () => {
    const battlefield = emptyBattlefield();
    const output = { x: 0, y: 0 };

    constrainFormationWorldPoint(-20, WORLD_HEIGHT + 20, battlefield, output);

    expect(output.x).toBe(FORMATION_MAP_MARGIN);
    expect(output.y).toBe(WORLD_HEIGHT - FORMATION_MAP_MARGIN);
    expect(output.x).toBeLessThan(WORLD_WIDTH);
  });

  it("pushes slots out of deep water but permits shallow water and the bridge", () => {
    const battlefield = emptyBattlefield();
    const output = { x: 0, y: 0 };
    const deepX = 800;
    const deepY = battlefield.streamY(deepX);

    constrainFormationWorldPoint(deepX, deepY, battlefield, output);
    expect(Math.abs(output.y - battlefield.streamY(output.x))).toBeGreaterThanOrEqual(
      FORMATION_STREAM_CLEARANCE,
    );

    const shallowX = 450;
    const shallowY = battlefield.streamY(shallowX);
    constrainFormationWorldPoint(shallowX, shallowY, battlefield, output);
    expect(output).toEqual({ x: shallowX, y: shallowY });

    const crossingX = 1190;
    const crossingY = battlefield.streamY(crossingX);
    constrainFormationWorldPoint(crossingX, crossingY, battlefield, output);
    expect(output).toEqual({ x: crossingX, y: crossingY });
  });

  it("matches the bridge's visible deck to its passable terrain footprint", () => {
    const battlefield = emptyBattlefield();
    const bridgeY = battlefield.streamY(BRIDGE_CENTRE_X);

    expect(battlefield.isDeepWaterAt(
      BRIDGE_CENTRE_X - BRIDGE_HALF_LENGTH,
      bridgeY,
    )).toBe(false);
    expect(battlefield.isDeepWaterAt(
      BRIDGE_CENTRE_X + BRIDGE_HALF_LENGTH,
      bridgeY,
    )).toBe(false);
    expect(battlefield.isDeepWaterAt(
      BRIDGE_CENTRE_X + BRIDGE_HALF_LENGTH + 1,
      battlefield.streamY(BRIDGE_CENTRE_X + BRIDGE_HALF_LENGTH + 1),
    )).toBe(true);
  });

  it("uses a strict greater-than-twenty-percent formation coverage threshold", () => {
    const battlefield = emptyBattlefield();
    battlefield.rough.length = 0;
    battlefield.rough.push({ x: 100, y: 100, radius: 50, tone: 0 });
    const unit = createPrototypeScenario()[0];
    if (!unit) throw new Error("Scenario unit missing");
    unit.soldierCount = 10;
    const coverage: FormationTerrainCoverage = {
      deepWater: 0,
      shallowWater: 0,
      woods: 0,
      rough: 0,
      road: 0,
    };
    const point = { x: 0, y: 0 };
    for (let index = 0; index < unit.soldierCount; index += 1) {
      const soldier = unit.soldiers[index];
      if (!soldier) continue;
      soldier.baseX = index < 2 ? 0 : 200;
      soldier.baseY = 0;
    }

    calculateFormationTerrainCoverage(unit, 100, 100, battlefield, coverage, point);
    expect(coverage.rough).toBe(0.2);
    expect(classifyFormationTerrain(coverage)).toBe("open");

    const thirdSoldier = unit.soldiers[2];
    if (!thirdSoldier) throw new Error("Third soldier missing");
    thirdSoldier.baseX = 0;
    calculateFormationTerrainCoverage(unit, 100, 100, battlefield, coverage, point);
    expect(coverage.rough).toBe(0.3);
    expect(classifyFormationTerrain(coverage)).toBe("rough");
  });

  it("samples spine-deformed slots during a committed crossing", () => {
    const battlefield = emptyBattlefield();
    const unit = createPrototypeScenario()[5];
    if (!unit) throw new Error("Scenario unit missing");
    const streamX = 800;
    const streamY = battlefield.streamY(streamX);
    unit.position = { x: streamX, y: streamY };
    unit.facing = 0;
    unit.soldierCount = 10;
    for (let index = 0; index < unit.soldierCount; index += 1) {
      const soldier = unit.soldiers[index];
      if (!soldier) continue;
      soldier.baseX = 0;
      soldier.baseY = 0;
      soldier.targetX = 0;
      soldier.targetY = 80;
    }
    const coverage: FormationTerrainCoverage = {
      deepWater: 0,
      shallowWater: 0,
      woods: 0,
      rough: 0,
      road: 0,
    };
    const point = { x: 0, y: 0 };

    calculateFormationTerrainCoverage(
      unit,
      unit.position.x,
      unit.position.y,
      battlefield,
      coverage,
      point,
    );
    expect(coverage.deepWater).toBe(1);

    unit.crossingPhase = "crossing";
    calculateFormationTerrainCoverage(
      unit,
      unit.position.x,
      unit.position.y,
      battlefield,
      coverage,
      point,
    );
    expect(coverage.deepWater).toBe(0);
  });

  it("blocks a formation at deep water while allowing it through a shallow ford", () => {
    const battlefield = emptyBattlefield();
    battlefield.rough.length = 0;
    const deepUnit = createPrototypeScenario()[0];
    const shallowUnit = createPrototypeScenario()[0];
    if (!deepUnit || !shallowUnit) throw new Error("Scenario units missing");
    const deepX = 800;
    const shallowX = 450;
    const deepStreamY = battlefield.streamY(deepX);
    const shallowStreamY = battlefield.streamY(shallowX);
    deepUnit.position = { x: deepX, y: deepStreamY - 90 };
    deepUnit.facing = Math.PI;
    deepUnit.order = { type: "move", destination: { x: deepX, y: deepStreamY + 130 } };
    shallowUnit.position = { x: shallowX, y: shallowStreamY - 90 };
    shallowUnit.facing = Math.PI;
    shallowUnit.order = { type: "move", destination: { x: shallowX, y: shallowStreamY + 130 } };
    const deepSimulation = new Simulation([deepUnit], battlefield);
    const shallowSimulation = new Simulation([shallowUnit], battlefield);

    for (let step = 0; step < 900; step += 1) {
      deepSimulation.update(1 / 60);
      shallowSimulation.update(1 / 60);
    }

    expect(deepUnit.position.y).toBeLessThan(deepStreamY);
    expect(shallowUnit.position.y).toBeGreaterThan(shallowStreamY);
    expect(shallowUnit.terrain).not.toBe("deep water");
  });

  it("curves slots around tree and rock footprints", () => {
    const battlefield = emptyBattlefield();
    battlefield.trees.push({ x: 300, y: 300, size: 20, rotation: 0 });
    battlefield.rocks.push({ x: 500, y: 500, size: 12, rotation: 0 });
    const output = { x: 0, y: 0 };

    constrainFormationWorldPoint(300, 300, battlefield, output);
    expect(Math.hypot(output.x - 300, output.y - 300)).toBeGreaterThanOrEqual(28);

    constrainFormationWorldPoint(500, 500, battlefield, output);
    expect(Math.hypot(output.x - 500, output.y - 500)).toBeGreaterThanOrEqual(18);
  });

  it("gives loose Saxon slots more room to flow around obstacles", () => {
    const battlefield = emptyBattlefield();
    battlefield.trees.push({ x: 300, y: 300, size: 20, rotation: 0 });
    const disciplined = { x: 0, y: 0 };
    const loose = { x: 0, y: 0 };

    constrainFormationWorldPoint(300, 300, battlefield, disciplined);
    constrainFormationWorldPoint(
      300,
      300,
      battlefield,
      loose,
      SAXON_FORMATION_FLOW_CLEARANCE,
    );

    expect(Math.hypot(loose.x - 300, loose.y - 300)).toBeGreaterThan(
      Math.hypot(disciplined.x - 300, disciplined.y - 300),
    );
  });

  it("keeps routed slots on one committed side of deep water", () => {
    const battlefield = emptyBattlefield();
    const streamX = 800;
    const streamY = battlefield.streamY(streamX);
    const upperSlot = { x: 0, y: 0 };
    const lowerSlot = { x: 0, y: 0 };

    constrainFormationWorldPoint(
      streamX,
      streamY - 4,
      battlefield,
      upperSlot,
      0,
      -1,
    );
    constrainFormationWorldPoint(
      streamX,
      streamY + 4,
      battlefield,
      lowerSlot,
      0,
      -1,
    );

    expect(upperSlot.y).toBeLessThan(streamY);
    expect(lowerSlot.y).toBeLessThan(streamY);
  });
});
