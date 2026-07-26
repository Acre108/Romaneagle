import { describe, expect, it } from "vitest";
import { SeededRandom } from "../core/math";
import { createPrototypeScenario } from "../scenario/PrototypeScenario";
import { formationHalfDepth } from "../units/FormationContact";
import {
  BROKEN_AFTER_ROUTING_SECONDS,
  ARCHER_VOLLEY_INTERVAL,
  CHARGE_DURATION,
  COMBAT_STRIKE_INTERVAL,
  CROWDED_FRIENDLY_MAX_FORMATION_PENETRATION,
  calculateSafeAIDestination,
  calculateSafeRoutDestination,
  calculateStandardAuraCoverage,
  estimateCasualties,
  estimateCombatMoraleLoss,
  estimateRangedCasualties,
  ENEMY_MAX_FORMATION_PENETRATION,
  fallenSoldierVisualIndex,
  estimateRoutedCasualties,
  FRIENDLY_MAX_FORMATION_PENETRATION,
  ROUT_ESCAPE_PROGRESS_DISTANCE,
  ROUT_MORALE_THRESHOLD,
  ROUT_WATER_FAILURE_SECONDS,
  Simulation,
  STANDARD_AURA_COVERAGE,
} from "../systems/Simulation";
import {
  ABOUT_FACE_DURATION,
  applyFormation,
  beginAboutFace,
  completeAboutFace,
} from "../units/formation";
import { calculateFormationContact } from "../units/FormationContact";
import {
  ATTACK_COMMAND_FLASH_SECONDS,
  attackTargetPaddingForZoom,
  isPointWithinAttackTarget,
  issueAttackOrder,
} from "../units/orders";
import {
  Battlefield,
  STREAM_HALF_WIDTH,
  WATER_CROSSINGS,
} from "../world/Battlefield";

describe("repeatable battlefield", () => {
  it("generates a deterministic random sequence", () => {
    const first = new SeededRandom(402);
    const second = new SeededRandom(402);
    expect([first.next(), first.next(), first.next()]).toEqual([second.next(), second.next(), second.next()]);
  });

  it("generates repeatable terrain decorations", () => {
    const first = new Battlefield(402);
    const second = new Battlefield(402);
    expect(first.rough).toEqual(second.rough);
    expect(first.trees).toEqual(second.trees);
    expect(first.rocks).toEqual(second.rocks);
    expect(first.grass).toEqual(second.grass);
    expect(first.flowers).toEqual(second.flowers);
  });

  it("detects deep-water routes while leaving fords and the bridge passable", () => {
    const battlefield = new Battlefield(402);
    const deepY = battlefield.streamY(800);
    const fordY = battlefield.streamY(450);
    const bridgeY = battlefield.streamY(1190);

    expect(battlefield.segmentCrossesDeepWater(
      { x: 800, y: deepY - 90 },
      { x: 800, y: deepY + 90 },
    )).toBe(true);
    expect(battlefield.segmentCrossesDeepWater(
      { x: 450, y: fordY - 90 },
      { x: 450, y: fordY + 90 },
    )).toBe(false);
    expect(battlefield.segmentCrossesDeepWater(
      { x: 1190, y: bridgeY - 90 },
      { x: 1190, y: bridgeY + 90 },
    )).toBe(false);
  });
});

describe("AI path recovery", () => {
  it("routes grouped Saxons immediately through map-derived crossings", () => {
    const units = createPrototypeScenario();
    const battlefield = new Battlefield(402);
    const simulation = new Simulation(units, battlefield);
    const grouped = units.filter((unit) => unit.movementGroup !== undefined);

    simulation.update(0.01);

    expect(grouped).toHaveLength(6);
    const usedCrossings = new Set<number>();
    for (const unit of grouped) {
      expect(unit.order.type).toBe("move");
      expect(unit.order.route).toBeDefined();
      expect(unit.crossingLaneCommitted).toBe(true);
      if (unit.pathCrossingX !== undefined) {
        usedCrossings.add(Math.round(unit.pathCrossingX / 50) * 50);
      }
      let previous = unit.position;
      for (const waypoint of unit.order.route ?? []) {
        expect(battlefield.segmentBlocked(previous, waypoint)).toBe(false);
        previous = waypoint;
      }
    }

    expect(usedCrossings.size).toBeGreaterThan(1);
  });

  it("keeps a Saxon formation formed until it reaches its crossing approach", () => {
    const units = createPrototypeScenario();
    const boar = units.find((unit) => unit.id === "S-BOAR");
    const target = units.find((unit) => unit.id === "R-III");
    if (!boar || !target) throw new Error("Scenario units missing");
    const simulation = new Simulation([boar, target], new Battlefield(402));

    simulation.update(0.01);

    expect(boar.formation).toBe("line");
    expect(boar.crossingPhase).toBe("approach");
    expect(boar.formationChangeTimer).toBe(0);
    expect(boar.order.type).toBe("move");
  });

  it("moves S-BOAR through its committed ford without changing formation", () => {
    const units = createPrototypeScenario();
    const boar = units.find((unit) => unit.id === "S-BOAR");
    const target = units.find((unit) => unit.id === "R-III");
    if (!boar || !target) throw new Error("Scenario units missing");
    const battlefield = new Battlefield(402);
    const crossing = WATER_CROSSINGS[2];
    if (!crossing) throw new Error("Right-hand ford missing");
    const crossingY = battlefield.streamY(crossing.x);
    boar.position = { x: crossing.x, y: crossingY - 190 };
    boar.pathCrossingX = crossing.x;
    target.position = { x: crossing.x - 160, y: crossingY + 360 };
    target.movementSpeed = 0;
    target.formationChangeTimer = 1000;
    const simulation = new Simulation([boar, target], battlefield);

    simulation.update(0.05);
    expect(boar.formation).toBe("line");
    expect(boar.crossingPhase).toBe("approach");
    expect(boar.formationChangeTimer).toBe(0);

    let clearedCrossing = false;
    let enteredCrossing = false;
    let reachedFarBank = false;
    for (let step = 1; step < 800; step += 1) {
      simulation.update(0.05);
      expect(boar.formation).toBe("line");
      expect(boar.formationChangeTimer).toBe(0);
      if (boar.crossingPhase === "crossing") enteredCrossing = true;
      if (boar.crossingPhase === "clearing") reachedFarBank = true;
      if (
        boar.position.y > crossingY + STREAM_HALF_WIDTH &&
        boar.crossingPhase === undefined
      ) {
        clearedCrossing = true;
        break;
      }
    }

    expect(enteredCrossing).toBe(true);
    expect(reachedFarBank).toBe(true);
    expect(clearedCrossing).toBe(true);
    expect(boar.pathingState).toBe("direct");
    expect(
      Math.abs(boar.position.y - battlefield.streamY(boar.position.x)),
    ).toBeGreaterThan(STREAM_HALF_WIDTH);
  });

  it("moves a wide Saxon archer line across the bridge while formed", () => {
    const units = createPrototypeScenario();
    const archer = units.find((unit) => unit.id === "S-ARCH");
    const target = units.find((unit) => unit.id === "R-III");
    if (!archer || !target) throw new Error("Scenario units missing");
    const battlefield = new Battlefield(402);
    const bridge = WATER_CROSSINGS[1];
    if (!bridge) throw new Error("Bridge crossing missing");
    const crossingY = battlefield.streamY(bridge.x);
    archer.position = { x: bridge.x, y: crossingY - 190 };
    archer.pathCrossingX = bridge.x;
    archer.ammunition = 0;
    target.position = { x: bridge.x, y: crossingY + 380 };
    target.movementSpeed = 0;
    target.formationChangeTimer = 1000;
    const simulation = new Simulation([archer, target], battlefield);

    let clearedCrossing = false;
    for (let step = 0; step < 1000; step += 1) {
      simulation.update(0.05);
      expect(archer.formation).toBe("line");
      if (
        archer.position.y > crossingY + STREAM_HALF_WIDTH &&
        archer.crossingPhase === undefined
      ) {
        clearedCrossing = true;
        break;
      }
    }

    expect(clearedCrossing).toBe(true);
    expect(archer.pathingState).toBe("direct");
  });

  it("keeps S-BOAR committed to the ford until its formed frontage clears the river", () => {
    const units = createPrototypeScenario();
    const boar = units.find((unit) => unit.id === "S-BOAR");
    if (!boar) throw new Error("S-BOAR missing");
    const battlefield = new Battlefield(402);
    const crossing = WATER_CROSSINGS[2];
    if (!crossing) throw new Error("Right-hand ford missing");
    const crossingY = battlefield.streamY(crossing.x);
    const target = { x: crossing.x - 160, y: crossingY + 360 };
    boar.position = { x: crossing.x - 12, y: crossingY - 150 };
    boar.pathCrossingX = crossing.x;

    const destination = calculateSafeAIDestination(
      boar,
      target,
      battlefield,
      undefined,
      boar.pathCrossingX,
    );

    expect(destination.x).toBe(crossing.x);
    expect(destination).not.toEqual(target);
  });

  it("does not use the Mob transit posture for an unobstructed same-bank advance", () => {
    const units = createPrototypeScenario();
    const saxon = units.find((unit) => unit.id === "S-WOLF");
    const target = units.find((unit) => unit.id === "R-I");
    if (!saxon || !target) throw new Error("Scenario units missing");
    const battlefield = new Battlefield(402);
    saxon.position = { x: 500, y: 300 };
    target.position = { x: 700, y: 300 };
    target.movementSpeed = 0;
    target.formationChangeTimer = 100;
    const simulation = new Simulation([saxon, target], battlefield);

    simulation.update(0.05);

    expect(saxon.formation).toBe("line");
    expect(saxon.formationChangeTimer).toBe(0);
  });

  it("routes an enemy formation toward a safe crossing instead of deep water", () => {
    const unit = createPrototypeScenario()[5];
    if (!unit) throw new Error("Scenario unit missing");
    const battlefield = new Battlefield(402);
    const streamY = battlefield.streamY(800);
    unit.position = { x: 800, y: streamY - 150 };
    const target = { x: 800, y: streamY + 150 };

    const destination = calculateSafeAIDestination(unit, target, battlefield);

    expect(destination).not.toEqual(target);
    expect(battlefield.segmentCrossesDeepWater(unit.position, destination)).toBe(false);
    expect(destination.x).not.toBeCloseTo(800);
  });

  it("distributes nearby enemy formations across crossings and keeps each route committed", () => {
    const units = createPrototypeScenario();
    const raven = units[6];
    const boar = units[7];
    if (!raven || !boar) throw new Error("Scenario units missing");
    const battlefield = new Battlefield(402);
    const ravenTarget = { x: 1030, y: 1190 };
    const boarTarget = { x: 1370, y: 1190 };
    const crossingLoads = new Uint8Array(3);

    const ravenDestination = calculateSafeAIDestination(
      raven,
      ravenTarget,
      battlefield,
      crossingLoads,
    );
    const ravenCrossingIndex = ravenDestination.x === 450
      ? 0 : ravenDestination.x === 1190 ? 1 : 2;
    crossingLoads[ravenCrossingIndex] += 1;
    const boarDestination = calculateSafeAIDestination(
      boar,
      boarTarget,
      battlefield,
      crossingLoads,
    );

    expect(boarDestination.x).not.toBe(ravenDestination.x);
    const committedDestination = calculateSafeAIDestination(
      raven,
      ravenTarget,
      battlefield,
      new Uint8Array([9, 9, 9]),
      ravenDestination.x,
    );
    expect(committedDestination.x).toBe(ravenDestination.x);
  });

  it("gives routed formations a reachable same-bank waypoint when deep water blocks escape", () => {
    const unit = createPrototypeScenario()[0];
    if (!unit) throw new Error("Scenario unit missing");
    const battlefield = new Battlefield(402);
    const streamY = battlefield.streamY(800);
    unit.position = { x: 800, y: streamY - 90 };
    const target = { x: 800, y: streamY + 260 };

    const destination = calculateSafeRoutDestination(unit, target, battlefield);

    expect(destination).not.toEqual(target);
    expect(battlefield.segmentCrossesDeepWater(unit.position, destination)).toBe(false);
    expect(destination.x).not.toBeCloseTo(unit.position.x);
  });

  it("reorganises and falls back after three seconds without progress", () => {
    const unit = createPrototypeScenario()[5];
    if (!unit) throw new Error("Scenario unit missing");
    const battlefield = new Battlefield(402);
    const streamY = battlefield.streamY(800);
    unit.position = { x: 800, y: streamY - 105 };
    unit.facing = Math.PI;
    unit.order = {
      type: "move",
      destination: { x: 800, y: streamY + 130 },
    };
    const simulation = new Simulation([unit], battlefield);

    for (let step = 0; step < 200 && unit.pathingState === "direct"; step += 1) {
      simulation.update(0.05);
    }

    expect(unit.pathingState).toBe("reorganising");
    expect(unit.order.type).toBe("hold");
    expect(unit.fallbackDestination).toBeDefined();
    expect(unit.formationChangeTimer).toBeGreaterThan(0);

    simulation.update(2.1);

    expect(unit.pathingState).toBe("fallback");
    expect(unit.order.type).toBe("move");
  });

  it("allows an embedded formation to retreat toward its bank but not advance deeper", () => {
    const unit = createPrototypeScenario()[5];
    if (!unit) throw new Error("Scenario unit missing");
    const battlefield = new Battlefield(402);
    const streamY = battlefield.streamY(800);
    unit.position = { x: 800, y: streamY - 4 };
    unit.facing = 0;
    unit.order = {
      type: "move",
      destination: { x: 800, y: streamY - 180 },
    };
    const simulation = new Simulation([unit], battlefield);

    simulation.update(0.5);

    expect(unit.position.y).toBeLessThan(streamY - 4);
  });
});

describe("battle standards", () => {
  it("creates one standard unit and standard entity for each army", () => {
    const units = createPrototypeScenario();
    const simulation = new Simulation(units, new Battlefield(402));

    expect(units.filter((unit) => unit.type === "standard")).toHaveLength(2);
    expect(simulation.standards.map((standard) => standard.faction).sort()).toEqual([
      "roman",
      "saxon",
    ]);
  });

  it("moves the Saxon standard behind the centre of its active army", () => {
    const units = createPrototypeScenario();
    const roman = units[0];
    const saxon = units[5];
    const standardUnit = units.find((unit) => unit.id === "S-STD");
    if (!roman || !saxon || !standardUnit) throw new Error("Scenario units missing");
    const simulation = new Simulation(
      [roman, saxon, standardUnit],
      new Battlefield(402),
    );
    const initialDistance = Math.hypot(
      standardUnit.position.x - saxon.position.x,
      standardUnit.position.y - saxon.position.y,
    );

    simulation.update(0.01);

    expect(standardUnit.order.type).toBe("move");
    const destination = standardUnit.order.destination;
    if (!destination) throw new Error("Standard destination missing");
    expect(Math.hypot(
      destination.x - saxon.position.x,
      destination.y - saxon.position.y,
    )).toBeLessThan(initialDistance);
  });

  it("ends the battle without treating an isolated standard as a fighting unit", () => {
    const units = createPrototypeScenario();
    const roman = units[0];
    const saxonStandard = units.find((unit) => unit.id === "S-STD");
    if (!roman || !saxonStandard) throw new Error("Scenario units missing");
    const simulation = new Simulation([roman, saxonStandard], new Battlefield(402));

    simulation.update(0.01);

    expect(simulation.stats.outcome).toBe("romanVictory");
    expect(saxonStandard.state).toBe("escaped");
    expect(simulation.standards[0]?.status).toBe("dropped");
  });

  it("boosts morale only when at least half a formation is inside a friendly aura", () => {
    const units = createPrototypeScenario();
    const cohort = units[0];
    const standardUnit = units.find((unit) => unit.id === "R-STD");
    if (!cohort || !standardUnit) throw new Error("Scenario units missing");
    cohort.position = { x: 500, y: 500 };
    standardUnit.position = { x: 500, y: 500 };
    cohort.morale = 50;
    const simulation = new Simulation([cohort, standardUnit], new Battlefield(402));

    expect(calculateStandardAuraCoverage(cohort, standardUnit.position))
      .toBeGreaterThanOrEqual(STANDARD_AURA_COVERAGE);
    simulation.update(1);

    expect(cohort.standardMoraleBoost).toBe(true);
    expect(cohort.morale).toBeGreaterThan(50);

    cohort.position = { x: 900, y: 500 };
    cohort.morale = 50;
    simulation.update(1);

    expect(cohort.standardMoraleBoost).toBe(false);
    expect(cohort.morale).toBe(50);
  });

  it("drops a wiped-out standard for enemy infantry to capture and carry", () => {
    const units = createPrototypeScenario();
    const standardUnit = units.find((unit) => unit.id === "R-STD");
    const captor = units.find((unit) => unit.id === "S-WOLF");
    if (!standardUnit || !captor) throw new Error("Scenario units missing");
    standardUnit.position = { x: 600, y: 600 };
    standardUnit.soldierCount = 0;
    captor.position = { x: 600, y: 600 };
    captor.type = "cavalry";
    const simulation = new Simulation([standardUnit, captor], new Battlefield(402));
    const standard = simulation.standards[0];
    if (!standard) throw new Error("Standard missing");

    simulation.update(0.01);
    expect(standard.status).toBe("dropped");

    captor.type = "infantry";
    simulation.update(0.01);
    expect(standard.status).toBe("captured");
    expect(standard.bearerUnitId).toBe(captor.id);

    captor.position = { x: 680, y: 640 };
    simulation.update(0.01);
    expect(standard.position).toEqual(captor.position);

    captor.soldierCount = 0;
    simulation.update(0.01);
    expect(standard.status).toBe("dropped");
    expect(standard.bearerUnitId).toBeUndefined();
  });
});

describe("abstract combat", () => {
  it("accepts attack clicks throughout a padded formation footprint", () => {
    const target = createPrototypeScenario().find((unit) => unit.id === "S-RAVEN");
    if (!target) throw new Error("Scenario target missing");
    const cos = Math.cos(target.facing);
    const sin = Math.sin(target.facing);
    const localX = target.formationWidth * 0.5 + 60;
    const localY = target.formationDepth * 0.5 + 60;
    const paddedCorner = {
      x: target.position.x + localX * cos - localY * sin,
      y: target.position.y + localX * sin + localY * cos,
    };

    expect(isPointWithinAttackTarget(target, paddedCorner)).toBe(true);
    expect(isPointWithinAttackTarget(target, {
      x: target.position.x + (target.formationWidth + 100) * cos,
      y: target.position.y + (target.formationWidth + 100) * sin,
    })).toBe(false);
    expect(attackTargetPaddingForZoom(0.56)).toBeGreaterThan(
      attackTargetPaddingForZoom(2.3),
    );
  });

  it("keeps an explicit attack order while following and engaging a moving target", () => {
    const units = createPrototypeScenario();
    const attacker = units[0];
    const target = units[5];
    if (!attacker || !target) throw new Error("Scenario units missing");
    const battlefield = new Battlefield(402);
    battlefield.rough.length = 0;
    battlefield.trees.length = 0;
    attacker.position = { x: 400, y: 600 };
    attacker.facing = 0;
    target.position = { x: 400, y: 300 };
    target.order = { type: "hold" };
    target.formationChangeTimer = 100;
    const simulation = new Simulation([attacker, target], battlefield);

    expect(issueAttackOrder(attacker, target)).toBe(true);
    expect(target.attackCommandFlashTimer).toBe(ATTACK_COMMAND_FLASH_SECONDS);
    simulation.update(0.5);

    expect(attacker.position.y).toBeLessThan(600);
    expect(attacker.order).toEqual({ type: "attack", targetUnitId: target.id });
    expect(target.attackCommandFlashTimer).toBeCloseTo(
      ATTACK_COMMAND_FLASH_SECONDS - 0.5,
    );

    const previousFacing = attacker.facing;
    target.position = { x: 700, y: attacker.position.y };
    simulation.update(0.5);
    expect(attacker.facing).toBeGreaterThan(previousFacing);
    expect(attacker.order.targetUnitId).toBe(target.id);

    target.state = "escaped";
    simulation.update(0.01);
    expect(attacker.order.type).toBe("hold");
  });

  it("preserves a player-assigned engagement face while following a target", () => {
    const units = createPrototypeScenario();
    const attacker = units.find((unit) => unit.id === "R-I");
    const target = units.find((unit) => unit.id === "S-WOLF");
    if (!attacker || !target) throw new Error("Scenario units missing");

    expect(issueAttackOrder(attacker, target, {
      arc: "left",
      index: 0,
    })).toBe(true);

    expect(attacker.order).toEqual({
      type: "attack",
      targetUnitId: target.id,
      engagementArc: "left",
      engagementSlotIndex: 0,
    });
  });

  it("preserves an explicit attack target after melee contact", () => {
    const units = createPrototypeScenario();
    const attacker = units[0];
    const target = units[5];
    if (!attacker || !target) throw new Error("Scenario units missing");
    attacker.position = { x: 400, y: 400 };
    attacker.facing = Math.PI;
    target.position = { x: 400, y: 432 };
    target.facing = 0;
    target.formationChangeTimer = 100;
    const simulation = new Simulation([attacker, target], new Battlefield(402));

    issueAttackOrder(attacker, target);
    simulation.update(0.001);

    expect(attacker.inCombat).toBe(true);
    expect(attacker.order).toEqual({ type: "attack", targetUnitId: target.id });
  });

  it("keeps archers at range when they receive an attack order", () => {
    const units = createPrototypeScenario();
    const archer = units.find((unit) => unit.id === "R-ARCH");
    const target = units.find((unit) => unit.id === "S-ASH");
    if (!archer || !target) throw new Error("Scenario units missing");
    const battlefield = new Battlefield(402);
    battlefield.rough.length = 0;
    battlefield.trees.length = 0;
    archer.position = { x: 400, y: 250 };
    target.position = { x: 400, y: 600 };
    target.movementSpeed = 0;
    target.formationChangeTimer = 100;
    const simulation = new Simulation([archer, target], battlefield);
    issueAttackOrder(archer, target);

    const initialPosition = { ...archer.position };
    for (let step = 0; step < 40 && archer.ammunition === 12; step += 1) {
      simulation.update(0.1);
    }

    expect(archer.ammunition).toBeLessThan(12);
    expect(archer.order).toEqual({ type: "attack", targetUnitId: target.id });
    expect(Math.hypot(
      archer.position.x - initialPosition.x,
      archer.position.y - initialPosition.y,
    )).toBeLessThan(40);
    expect(Math.hypot(
      archer.position.x - target.position.x,
      archer.position.y - target.position.y,
    )).toBeGreaterThan(300);
    expect(archer.inCombat).toBe(true);
  });

  it("spreads Saxon formations across uncrowded targets", () => {
    const units = createPrototypeScenario();
    const wolf = units.find((unit) => unit.id === "S-WOLF");
    const raven = units.find((unit) => unit.id === "S-RAVEN");
    const prima = units.find((unit) => unit.id === "R-I");
    const secunda = units.find((unit) => unit.id === "R-II");
    if (!wolf || !raven || !prima || !secunda) {
      throw new Error("Scenario units missing");
    }
    wolf.position = { x: 500, y: 300 };
    raven.position = { x: 520, y: 300 };
    prima.position = { x: 500, y: 500 };
    secunda.position = { x: 700, y: 500 };
    const simulation = new Simulation(
      [wolf, raven, prima, secunda],
      new Battlefield(402),
    );

    simulation.update(0.01);

    expect(new Set([wolf.aiTargetId, raven.aiTargetId]).size).toBe(2);
  });

  it("reserves different engagement faces when Saxons share one target", () => {
    const units = createPrototypeScenario();
    const wolf = units.find((unit) => unit.id === "S-WOLF");
    const raven = units.find((unit) => unit.id === "S-RAVEN");
    const boar = units.find((unit) => unit.id === "S-BOAR");
    const target = units.find((unit) => unit.id === "R-I");
    if (!wolf || !raven || !boar || !target) {
      throw new Error("Scenario units missing");
    }
    target.position = { x: 900, y: 1100 };
    target.formationWidth = 150;
    target.formationDepth = 54;
    wolf.position = { x: 860, y: 900 };
    raven.position = { x: 900, y: 900 };
    boar.position = { x: 940, y: 900 };
    const simulation = new Simulation(
      [wolf, raven, boar, target],
      new Battlefield(402),
    );

    simulation.update(0.01);

    expect(wolf.aiTargetId).toBe(target.id);
    expect(raven.aiTargetId).toBe(target.id);
    expect(boar.aiTargetId).toBe(target.id);
    expect(new Set([
      wolf.aiEngagementArc,
      raven.aiEngagementArc,
      boar.aiEngagementArc,
    ]).size).toBe(3);
  });

  it("sidesteps a contact that produces no combat progress", () => {
    const units = createPrototypeScenario();
    const saxon = units.find((unit) => unit.id === "S-WOLF");
    const roman = units.find((unit) => unit.id === "R-I");
    if (!saxon || !roman) throw new Error("Scenario units missing");
    saxon.position = { x: 400, y: 432 };
    saxon.facing = 0;
    saxon.movementSpeed = 0;
    saxon.combatTimer = 100;
    roman.position = { x: 400, y: 400 };
    roman.facing = Math.PI;
    roman.movementSpeed = 0;
    roman.combatTimer = 100;
    saxon.aiTargetId = roman.id;
    const simulation = new Simulation([saxon, roman], new Battlefield(402));

    simulation.update(3.1);

    expect(saxon.order.type).toBe("move");
    expect(saxon.order.destination?.x).not.toBeCloseTo(roman.position.x);
    expect(saxon.engagementStallTimer).toBe(0);
    expect(saxon.engagementRecoveryTimer).toBe(4);
  });

  it("makes rear attacks more dangerous than frontal attacks", () => {
    const [attacker, defender] = createPrototypeScenario();
    if (!attacker || !defender) throw new Error("Scenario units missing");
    expect(estimateCasualties(attacker, defender, "rear")).toBeGreaterThan(
      estimateCasualties(attacker, defender, "front"),
    );
  });

  it("reduces frontal casualties for shieldwalls", () => {
    const units = createPrototypeScenario();
    const attacker = units[5];
    const defender = units[0];
    if (!attacker || !defender) throw new Error("Scenario units missing");
    const lineLoss = estimateCasualties(attacker, defender, "front");
    applyFormation(defender, "shieldwall");
    const shieldwallLoss = estimateCasualties(attacker, defender, "front");
    expect(shieldwallLoss).toBeLessThanOrEqual(lineLoss);
  });

  it("lets frontal shields stop most arrows and makes tortoise stronger still", () => {
    const units = createPrototypeScenario();
    const archer = units.find((unit) => unit.id === "S-ARCH");
    const infantry = units.find((unit) => unit.id === "R-I");
    const unshielded = units.find((unit) => unit.id === "R-ARCH");
    if (!archer || !infantry || !unshielded) {
      throw new Error("Scenario ranged units missing");
    }

    const unshieldedLoss = estimateRangedCasualties(
      archer,
      unshielded,
      "front",
    );
    const shieldedLoss = estimateRangedCasualties(archer, infantry, "front");
    const flankLoss = estimateRangedCasualties(archer, infantry, "flank");
    applyFormation(infantry, "tortoise");
    const tortoiseLoss = estimateRangedCasualties(archer, infantry, "front");

    expect(shieldedLoss).toBeLessThan(unshieldedLoss);
    expect(shieldedLoss).toBeLessThan(flankLoss);
    expect(tortoiseLoss).toBeLessThan(shieldedLoss);
  });

  it("fires deterministic ranged volleys without closing to melee", () => {
    const units = createPrototypeScenario();
    const archer = units.find((unit) => unit.id === "R-ARCH");
    const target = units.find((unit) => unit.id === "S-ARCH");
    if (!archer || !target) throw new Error("Scenario ranged units missing");
    archer.position = { x: 500, y: 500 };
    archer.rangedTimer = 0;
    target.position = { x: 500, y: 800 };
    target.formationChangeTimer = 100;
    const startPosition = { ...archer.position };
    const initialStrength = target.soldierCount;
    const initialAmmunition = archer.ammunition;
    const simulation = new Simulation([archer, target], new Battlefield(402));

    issueAttackOrder(archer, target);
    simulation.update(0.05);

    expect(target.soldierCount).toBeLessThan(initialStrength);
    expect(archer.ammunition).toBe(initialAmmunition - 1);
    expect(Math.hypot(
      archer.position.x - startPosition.x,
      archer.position.y - startPosition.y,
    )).toBeLessThan(1);
    expect(simulation.effects.some((effect) =>
      effect.ranged && effect.sourceX !== undefined
    )).toBe(true);
  });

  it("does not bank reload time while no ranged target is available", () => {
    const units = createPrototypeScenario();
    const archer = units.find((unit) => unit.id === "R-ARCH");
    const target = units.find((unit) => unit.id === "S-ARCH");
    if (!archer || !target) throw new Error("Scenario ranged units missing");
    archer.position = { x: 500, y: 500 };
    archer.rangedTimer = 0;
    target.position = { x: 500, y: 1100 };
    target.formationChangeTimer = 100;
    const simulation = new Simulation([archer, target], new Battlefield(402));

    issueAttackOrder(archer, target);
    simulation.update(10);
    expect(archer.ammunition).toBe(archer.maximumAmmunition);
    expect(archer.rangedTimer).toBe(0);

    target.position = { x: 500, y: 800 };
    simulation.update(0.01);
    const ammunitionAfterFirstVolley = archer.ammunition;
    simulation.update(0.01);

    expect(ammunitionAfterFirstVolley).toBe(archer.maximumAmmunition - 1);
    expect(archer.ammunition).toBe(ammunitionAfterFirstVolley);
    expect(archer.rangedTimer).toBeCloseTo(ARCHER_VOLLEY_INTERVAL - 0.01);
  });

  it("does not fire ranged volleys while the archer formation is in melee contact", () => {
    const units = createPrototypeScenario();
    const archer = units.find((unit) => unit.id === "R-ARCH");
    const target = units.find((unit) => unit.id === "S-ARCH");
    if (!archer || !target) throw new Error("Scenario ranged units missing");
    archer.position = { x: 500, y: 500 };
    archer.rangedTimer = 0;
    archer.combatTimer = 100;
    target.position = { x: 500, y: 520 };
    target.combatTimer = 100;
    target.formationChangeTimer = 100;
    const simulation = new Simulation([archer, target], new Battlefield(402));

    issueAttackOrder(archer, target);
    simulation.update(0.05);

    expect(archer.ammunition).toBe(archer.maximumAmmunition);
    expect(simulation.effects.some((effect) => effect.ranged)).toBe(false);
  });

  it("spaces repeated melee strikes at the slower combat cadence", () => {
    const units = createPrototypeScenario();
    const attacker = units[0];
    const defender = units[5];
    if (!attacker || !defender) throw new Error("Scenario units missing");
    attacker.position = { x: 500, y: 500 };
    defender.position = { x: 500, y: 530 };
    attacker.combatTimer = 0;
    defender.combatTimer = 100;
    attacker.formationChangeTimer = 100;
    defender.formationChangeTimer = 100;
    const simulation = new Simulation([attacker, defender], new Battlefield(402));

    simulation.update(0.01);
    const strengthAfterFirstStrike = defender.soldierCount;
    simulation.update(COMBAT_STRIKE_INTERVAL - 0.02);
    expect(defender.soldierCount).toBe(strengthAfterFirstStrike);
    simulation.update(0.03);
    expect(defender.soldierCount).toBeLessThan(strengthAfterFirstStrike);
  });

  it("stops ranged fire while retaining an attack after ammunition is exhausted", () => {
    const units = createPrototypeScenario();
    const archer = units.find((unit) => unit.id === "R-ARCH");
    const target = units.find((unit) => unit.id === "S-ARCH");
    if (!archer || !target) throw new Error("Scenario ranged units missing");
    archer.position = { x: 500, y: 500 };
    archer.ammunition = 0;
    target.position = { x: 500, y: 800 };
    target.formationChangeTimer = 100;
    const initialStrength = target.soldierCount;
    const simulation = new Simulation([archer, target], new Battlefield(402));

    issueAttackOrder(archer, target);
    simulation.update(0.05);

    expect(archer.ammunition).toBe(0);
    expect(target.soldierCount).toBe(initialStrength);
    expect(archer.order).toEqual({ type: "attack", targetUnitId: target.id });
    expect(simulation.effects.some((effect) => effect.ranged)).toBe(false);
  });

  it("protects a tortoise from side attacks but not attacks from behind", () => {
    const units = createPrototypeScenario();
    const attacker = units[5];
    const defender = units[0];
    if (!attacker || !defender) throw new Error("Scenario units missing");
    applyFormation(defender, "tortoise");
    const frontAttack = estimateCasualties(attacker, defender, "front");
    const sideAttack = estimateCasualties(attacker, defender, "flank");
    const rearAttack = estimateCasualties(attacker, defender, "rear");

    expect(sideAttack).toBeLessThanOrEqual(frontAttack);
    expect(rearAttack).toBeGreaterThan(sideAttack);
  });

  it("marks a tortoise flanked only when contact comes from behind", () => {
    const sideUnits = createPrototypeScenario();
    const sideTortoise = sideUnits[0];
    const sideAttacker = sideUnits[5];
    if (!sideTortoise || !sideAttacker) throw new Error("Scenario units missing");
    applyFormation(sideTortoise, "tortoise");
    sideTortoise.formationChangeTimer = 0;
    sideTortoise.position = { x: 400, y: 400 };
    sideTortoise.facing = 0;
    sideAttacker.position = { x: 452, y: 400 };
    sideAttacker.facing = -Math.PI / 2;
    sideAttacker.formationChangeTimer = 100;
    new Simulation([sideTortoise, sideAttacker], new Battlefield(402))
      .update(0.01);
    expect(sideTortoise.vulnerableTimer).toBe(0);

    const rearUnits = createPrototypeScenario();
    const rearTortoise = rearUnits[0];
    const rearAttacker = rearUnits[5];
    if (!rearTortoise || !rearAttacker) throw new Error("Scenario units missing");
    applyFormation(rearTortoise, "tortoise");
    rearTortoise.formationChangeTimer = 0;
    rearTortoise.position = { x: 400, y: 400 };
    rearTortoise.facing = 0;
    rearAttacker.position = { x: 400, y: 437 };
    rearAttacker.facing = 0;
    rearAttacker.formationChangeTimer = 100;
    new Simulation([rearTortoise, rearAttacker], new Battlefield(402))
      .update(0.01);
    expect(rearTortoise.vulnerableTimer).toBeGreaterThan(0);
  });

  it("spreads tortoise casualties beneath its occupied slots", () => {
    const tortoise = createPrototypeScenario()[0];
    if (!tortoise) throw new Error("Scenario unit missing");
    applyFormation(tortoise, "tortoise");

    expect(fallenSoldierVisualIndex(tortoise, 45, 0, 1)).not.toBe(45);
    const indices = new Set<number>();
    for (let offset = 0; offset < 20; offset += 1) {
      indices.add(fallenSoldierVisualIndex(tortoise, 40, offset, 20));
    }
    expect(indices.size).toBe(20);
  });

  it("doubles casualties for the three-second charge damage window", () => {
    const units = createPrototypeScenario();
    const attacker = units[0];
    const defender = units[5];
    if (!attacker || !defender) throw new Error("Scenario units missing");
    const normalLoss = estimateCasualties(attacker, defender, "front");
    attacker.chargeBonusTimer = CHARGE_DURATION;

    expect(estimateCasualties(attacker, defender, "front")).toBe(normalLoss * 2);
  });

  it("applies extra damage to vulnerable formations and reduced damage to prepared ones", () => {
    const units = createPrototypeScenario();
    const attacker = units[0];
    const defender = units[5];
    if (!attacker || !defender) throw new Error("Scenario units missing");

    defender.tacticalState = "standard";
    const standardLoss = estimateCasualties(attacker, defender, "rear");
    defender.tacticalState = "vulnerable";
    const vulnerableLoss = estimateCasualties(attacker, defender, "rear");
    defender.tacticalState = "prepared";
    const preparedLoss = estimateCasualties(attacker, defender, "rear");

    expect(vulnerableLoss).toBeGreaterThan(standardLoss);
    expect(preparedLoss).toBeLessThan(standardLoss);
  });

  it("lets a weakened attack fail against a prepared shieldwall", () => {
    const units = createPrototypeScenario();
    const attacker = units[5];
    const defender = units[0];
    if (!attacker || !defender) throw new Error("Scenario units missing");
    attacker.soldierCount = 20;
    attacker.cohesion = 25;
    applyFormation(defender, "shieldwall");
    defender.tacticalState = "prepared";

    expect(estimateCasualties(attacker, defender, "front")).toBe(0);
  });

  it("makes cavalry more effective on a flank than against formed infantry frontally", () => {
    const units = createPrototypeScenario();
    const cavalry = units[4];
    const infantry = units[5];
    if (!cavalry || !infantry) throw new Error("Scenario units missing");
    infantry.tacticalState = "standard";

    expect(estimateCasualties(cavalry, infantry, "flank")).toBeGreaterThan(
      estimateCasualties(cavalry, infantry, "front"),
    );
  });

  it("slows morale loss for formations that are winning and in a better tactical state", () => {
    const defender = createPrototypeScenario()[0];
    if (!defender) throw new Error("Scenario unit missing");
    defender.recentDamageDealt = 8;
    defender.recentDamageTaken = 2;
    defender.tacticalState = "prepared";
    const winningPreparedLoss = estimateCombatMoraleLoss(defender, 3, "front");

    defender.recentDamageDealt = 2;
    defender.recentDamageTaken = 8;
    const losingPreparedLoss = estimateCombatMoraleLoss(defender, 3, "front");

    defender.recentDamageDealt = 8;
    defender.recentDamageTaken = 2;
    defender.tacticalState = "vulnerable";
    const winningVulnerableLoss = estimateCombatMoraleLoss(defender, 3, "front");

    expect(winningPreparedLoss).toBeLessThan(losingPreparedLoss);
    expect(winningPreparedLoss).toBeLessThan(winningVulnerableLoss);
    expect(losingPreparedLoss).toBeLessThan(3);
  });

  it("starts charging near an enemy and commits the bonus on contact", () => {
    const units = createPrototypeScenario();
    const attacker = units[0];
    const defender = units[5];
    if (!attacker || !defender) throw new Error("Scenario units missing");
    attacker.position = { x: 400, y: 400 };
    attacker.facing = Math.PI;
    attacker.order = { type: "move", destination: { x: 400, y: 500 } };
    attacker.combatTimer = 100;
    defender.position = { x: 400, y: 480 };
    defender.facing = 0;
    defender.order = { type: "hold" };
    defender.combatTimer = 100;
    const simulation = new Simulation([attacker, defender], new Battlefield(402));

    simulation.update(0.1);
    expect(attacker.chargeTargetId).toBe(defender.id);
    expect(attacker.chargeBonusTimer).toBe(0);

    defender.position.y = attacker.position.y + 32.5;
    simulation.update(0.01);
    expect(attacker.chargeTargetId).toBeUndefined();
    expect(attacker.chargeBonusTimer).toBe(CHARGE_DURATION);
  });

  it("lets a moving formation pass slowly through a friendly formation without pushing it", () => {
    const units = createPrototypeScenario();
    const front = units[0];
    const rear = units[1];
    if (!front || !rear) throw new Error("Scenario units missing");
    front.position = { x: 400, y: 400 };
    front.facing = 0;
    front.order = { type: "hold" };
    rear.position = { x: 400, y: 450 };
    rear.facing = 0;
    rear.order = { type: "move", destination: { x: 400, y: 250 } };
    const simulation = new Simulation([front, rear], new Battlefield(402));

    simulation.update(1);

    expect(front.position).toEqual({ x: 400, y: 400 });
    expect(rear.position.y).toBeLessThan(450);
    expect(rear.tacticalState).toBe("vulnerable");

    for (let step = 0; step < 14; step += 1) simulation.update(0.5);

    expect(front.position).toEqual({ x: 400, y: 400 });
    expect(rear.position.y).toBeLessThan(front.position.y);
  });

  it("lets non-combat Saxon formations flow fully through each other", () => {
    const units = createPrototypeScenario();
    const holding = units[5];
    const moving = units[6];
    if (!holding || !moving) throw new Error("Scenario units missing");
    holding.position = { x: 400, y: 400 };
    holding.facing = 0;
    holding.order = { type: "hold" };
    moving.position = { x: 400, y: 400 };
    moving.facing = 0;
    moving.order = { type: "move", destination: { x: 400, y: 250 } };
    const simulation = new Simulation([holding, moving], new Battlefield(402));

    simulation.update(0.01);
    expect(calculateFormationContact(holding, moving).separation).toBeLessThan(
      -FRIENDLY_MAX_FORMATION_PENETRATION,
    );

    for (let step = 0; step < 50; step += 1) simulation.update(0.05);

    expect(holding.position).toEqual({ x: 400, y: 400 });
    expect(moving.position.y).toBeLessThan(holding.position.y);
    expect(moving.tacticalState).toBe("vulnerable");
  });

  it("keeps friendly Saxon interpenetration blocked during enemy contact", () => {
    const units = createPrototypeScenario();
    const first = units[5];
    const second = units[6];
    const enemy = units[0];
    if (!first || !second || !enemy) throw new Error("Scenario units missing");
    first.position = { x: 400, y: 400 };
    second.position = { x: 400, y: 400 };
    enemy.position = {
      x: 400,
      y: 400 + formationHalfDepth(first) + formationHalfDepth(enemy),
    };
    first.facing = 0;
    second.facing = 0;
    enemy.facing = Math.PI;
    first.order = { type: "hold" };
    second.order = { type: "move", destination: { x: 400, y: 250 } };
    enemy.order = { type: "hold" };
    const simulation = new Simulation([first, second, enemy], new Battlefield(402));

    for (let step = 0; step < 4; step += 1) simulation.update(0.01);

    expect(calculateFormationContact(first, second).separation).toBeGreaterThanOrEqual(
      -FRIENDLY_MAX_FORMATION_PENETRATION - 0.001,
    );
  });

  it("limits deep friendly overlap when formations cross at different angles", () => {
    const units = createPrototypeScenario();
    const first = units[0];
    const second = units[1];
    if (!first || !second) throw new Error("Scenario units missing");
    first.position = { x: 400, y: 400 };
    first.facing = 0;
    first.order = { type: "hold" };
    second.position = { x: 400, y: 400 };
    second.facing = Math.PI / 2;
    second.order = { type: "hold" };
    const simulation = new Simulation([first, second], new Battlefield(402));

    simulation.update(0.01);

    expect(calculateFormationContact(first, second).separation).toBeGreaterThanOrEqual(
      -FRIENDLY_MAX_FORMATION_PENETRATION - 0.001,
    );
  });

  it("prevents several friendly formations from piling into one footprint", () => {
    const units = createPrototypeScenario();
    const first = units[0];
    const second = units[1];
    const third = units[2];
    if (!first || !second || !third) throw new Error("Scenario units missing");
    first.position = { x: 400, y: 400 };
    second.position = { x: 400, y: 400 };
    third.position = { x: 400, y: 400 };
    first.facing = 0;
    second.facing = Math.PI / 2;
    third.facing = Math.PI;
    first.order = { type: "hold" };
    second.order = { type: "hold" };
    third.order = { type: "hold" };
    const simulation = new Simulation([first, second, third], new Battlefield(402));

    for (let step = 0; step < 4; step += 1) simulation.update(0.01);

    const firstSecond = calculateFormationContact(first, second).separation;
    const firstThird = calculateFormationContact(first, third).separation;
    const secondThird = calculateFormationContact(second, third).separation;
    expect(Math.min(firstSecond, firstThird, secondThird)).toBeGreaterThanOrEqual(
      -CROWDED_FRIENDLY_MAX_FORMATION_PENETRATION - 0.001,
    );
  });

  it("prevents formed enemies from continuing to drive through one another", () => {
    const units = createPrototypeScenario();
    const attacker = units[0];
    const defender = units[5];
    if (!attacker || !defender) throw new Error("Scenario units missing");
    attacker.position = { x: 400, y: 500 };
    attacker.facing = 0;
    attacker.order = { type: "move", destination: { x: 400, y: 300 } };
    attacker.combatTimer = 100;
    defender.position = { x: 400, y: 400 };
    defender.facing = Math.PI;
    defender.order = { type: "hold" };
    defender.movementSpeed = 0;
    defender.combatTimer = 100;
    const simulation = new Simulation([attacker, defender], new Battlefield(402));

    for (let step = 0; step < 180; step += 1) simulation.update(1 / 60);

    expect(calculateFormationContact(attacker, defender).separation).toBeGreaterThanOrEqual(
      -ENEMY_MAX_FORMATION_PENETRATION - 0.001,
    );
  });

  it("turns a flanked formation toward its attacker while it remains vulnerable", () => {
    const units = createPrototypeScenario();
    const defender = units[0];
    const attacker = units[5];
    if (!defender || !attacker) throw new Error("Scenario units missing");
    const battlefield = new Battlefield(402);
    battlefield.rough.length = 0;
    defender.position = { x: 400, y: 400 };
    defender.facing = 0;
    defender.order = { type: "hold" };
    defender.combatTimer = 100;
    attacker.position = { x: 498, y: 400 };
    attacker.facing = Math.PI * 1.5;
    attacker.order = { type: "hold" };
    attacker.combatTimer = 100;
    const simulation = new Simulation([defender, attacker], battlefield);

    simulation.update(0.01);
    expect(defender.tacticalState).toBe("vulnerable");
    expect(defender.reorientationTargetId).toBe(attacker.id);

    const initialFacing = defender.facing;
    simulation.update(0.5);
    expect(defender.facing).toBeGreaterThan(initialFacing);
  });

  it("does not improve a formation's tactical state during combat", () => {
    const units = createPrototypeScenario();
    const defender = units[0];
    const attacker = units[5];
    if (!defender || !attacker) throw new Error("Scenario units missing");
    const battlefield = new Battlefield(402);
    battlefield.rough.length = 0;
    defender.position = { x: 400, y: 400 };
    defender.facing = 0;
    defender.order = { type: "hold" };
    defender.tacticalState = "vulnerable";
    defender.stationaryTimer = 6;
    defender.combatTimer = 100;
    attacker.position = { x: 400, y: 432 };
    attacker.facing = Math.PI;
    attacker.order = { type: "hold" };
    attacker.combatTimer = 100;
    const simulation = new Simulation([defender, attacker], battlefield);

    simulation.update(0.01);

    expect(defender.inCombat).toBe(true);
    expect(defender.tacticalState).toBe("vulnerable");
  });

  it("keeps a prepared formation prepared through frontal combat", () => {
    const units = createPrototypeScenario();
    const defender = units[0];
    const attacker = units[5];
    if (!defender || !attacker) throw new Error("Scenario units missing");
    const battlefield = new Battlefield(402);
    battlefield.rough.length = 0;
    battlefield.trees.length = 0;
    defender.position = { x: 400, y: 400 };
    defender.facing = 0;
    defender.order = { type: "hold" };
    defender.tacticalState = "prepared";
    defender.stationaryTimer = 6;
    defender.combatTimer = 100;
    attacker.position = {
      x: 400,
      y: 400 - formationHalfDepth(defender) - formationHalfDepth(attacker) + 1,
    };
    attacker.facing = Math.PI;
    attacker.order = { type: "hold" };
    attacker.combatTimer = 100;
    const simulation = new Simulation([defender, attacker], battlefield);

    simulation.update(0.01);

    expect(defender.inCombat).toBe(true);
    expect(defender.tacticalState).toBe("prepared");
  });

  it("leaves a rear formation disengaged when the frontage is occupied", () => {
    const units = createPrototypeScenario();
    const front = units[0];
    const rear = units[1];
    const enemy = units[5];
    if (!front || !rear || !enemy) throw new Error("Scenario units missing");
    front.position = { x: 400, y: 400 };
    front.facing = Math.PI;
    front.order = { type: "hold" };
    rear.position = { x: 400, y: 360 };
    rear.facing = Math.PI;
    rear.order = { type: "hold" };
    enemy.position = { x: 400, y: 432.5 };
    enemy.facing = 0;
    enemy.order = { type: "hold" };
    front.combatTimer = 100;
    rear.combatTimer = 100;
    enemy.combatTimer = 100;
    const simulation = new Simulation([front, rear, enemy], new Battlefield(402));

    simulation.update(0.001);

    expect(front.engagedTargetId).toBe(enemy.id);
    expect(enemy.engagedTargetId).toBe(front.id);
    expect(rear.engagedTargetId).toBeUndefined();
  });

  it("damages but does not instantly destroy a routed formation caught by an enemy", () => {
    const units = createPrototypeScenario();
    const routed = units[0];
    const attacker = units[5];
    if (!routed || !attacker) throw new Error("Scenario units missing");
    routed.position = { x: 500, y: 500 };
    routed.state = "routing";
    routed.order = { type: "move" };
    attacker.position = { x: 500, y: 500 };
    attacker.order = { type: "hold" };
    const simulation = new Simulation([routed, attacker], new Battlefield(402));

    for (let step = 0; step < 4; step += 1) simulation.update(0.2);

    expect(routed.soldierCount).toBeLessThan(routed.maximumSoldiers);
    expect(routed.soldierCount).toBeGreaterThan(0);
    expect(routed.state).toBe("routing");
    expect(simulation.bodies).toHaveLength(routed.maximumSoldiers - routed.soldierCount);
  });

  it("applies a fifty-percent rout damage penalty, with cavalry still more dangerous", () => {
    const units = createPrototypeScenario();
    const attacker = units[0];
    const defender = units[5];
    if (!attacker || !defender) throw new Error("Scenario units missing");
    const normalLosses = estimateCasualties(attacker, defender, "front");
    const routedLosses = estimateRoutedCasualties(attacker, defender, "front");
    attacker.type = "cavalry";
    const cavalryLosses = estimateRoutedCasualties(attacker, defender, "front");

    expect(routedLosses).toBe(Math.ceil(normalLosses * 1.5));
    expect(cavalryLosses).toBeGreaterThan(routedLosses);
  });

  it("does not apply overrun losses while routed troops have a clear escape path", () => {
    const units = createPrototypeScenario();
    const routed = units[0];
    const enemy = units[5];
    if (!routed || !enemy) throw new Error("Scenario units missing");
    routed.position = { x: 200, y: 500 };
    routed.state = "routing";
    enemy.position = { x: 1200, y: 500 };
    const initialStrength = routed.soldierCount;
    const simulation = new Simulation([routed, enemy], new Battlefield(402));

    simulation.update(0.5);

    expect(routed.soldierCount).toBe(initialStrength);
    expect(routed.state).toBe("routing");
    expect(routed.tacticalState).toBe("routing");
  });

  it("commits to one rout direction when threats surround the formation", () => {
    const units = createPrototypeScenario();
    const routed = units[0];
    const leftThreat = units[5];
    const rightThreat = units[6];
    if (!routed || !leftThreat || !rightThreat) {
      throw new Error("Scenario units missing");
    }
    routed.position = { x: 500, y: 500 };
    routed.state = "routing";
    routed.order = { type: "move" };
    routed.routingDirectionX = 0;
    routed.routingDirectionY = 0;
    leftThreat.position = { x: 410, y: 500 };
    rightThreat.position = { x: 590, y: 500 };
    leftThreat.movementSpeed = 0;
    rightThreat.movementSpeed = 0;
    leftThreat.formationChangeTimer = 100;
    rightThreat.formationChangeTimer = 100;
    const simulation = new Simulation(
      [routed, leftThreat, rightThreat],
      new Battlefield(402),
    );

    simulation.update(0.05);
    const initialDirectionX = routed.routingDirectionX;
    const initialDirectionY = routed.routingDirectionY;
    leftThreat.position = { x: 620, y: 500 };
    rightThreat.position = { x: 380, y: 500 };
    simulation.update(0.05);

    expect(routed.routingDirectionX).toBe(initialDirectionX);
    expect(routed.routingDirectionY).toBe(initialDirectionY);
    expect(Math.hypot(initialDirectionX, initialDirectionY)).toBeCloseTo(1);
  });

  it("cancels conflicting formation actions when a unit begins routing", () => {
    const units = createPrototypeScenario();
    const routed = units[0];
    const enemy = units[5];
    if (!routed || !enemy) throw new Error("Scenario units missing");
    routed.position = { x: 500, y: 500 };
    routed.morale = ROUT_MORALE_THRESHOLD;
    routed.formationChangeTimer = 4;
    routed.aboutFacePending = true;
    routed.chargeTargetId = enemy.id;
    routed.engagedTargetId = enemy.id;
    routed.reorientationTargetId = enemy.id;
    enemy.position = { x: 500, y: 350 };
    enemy.movementSpeed = 0;
    enemy.formationChangeTimer = 100;
    const simulation = new Simulation([routed, enemy], new Battlefield(402));

    simulation.update(0.01);

    expect(routed.state).toBe("routing");
    expect(routed.order.type).toBe("move");
    expect(routed.formationChangeTimer).toBe(0);
    expect(routed.aboutFacePending).toBe(false);
    expect(routed.chargeTargetId).toBeUndefined();
    expect(routed.engagedTargetId).toBeUndefined();
    expect(routed.reorientationTargetId).toBeUndefined();
    expect(Math.hypot(
      routed.routingDirectionX,
      routed.routingDirectionY,
    )).toBeCloseTo(1);
  });

  it("routes at higher morale and breaks after ten seconds of flight", () => {
    const routed = createPrototypeScenario()[0];
    if (!routed) throw new Error("Scenario unit missing");
    routed.morale = ROUT_MORALE_THRESHOLD;
    routed.movementSpeed = 0;
    const initialStrength = routed.soldierCount;
    const simulation = new Simulation([routed], new Battlefield(402));

    simulation.update(0.01);
    expect(routed.state).toBe("routing");
    expect(routed.routingTimer).toBe(0);

    simulation.update(BROKEN_AFTER_ROUTING_SECONDS - 0.1);
    expect(routed.state).toBe("routing");

    simulation.update(0.11);
    expect(routed.state).toBe("broken");
    expect(routed.soldierCount).toBe(0);
    expect(simulation.routEscapeVisuals).toHaveLength(initialStrength);
    expect(simulation.discardedEquipment).toHaveLength(initialStrength);
    expect(simulation.stats.romanDestroyed).toBe(1);
    expect(simulation.stats.romanRouted).toBe(0);
    expect(simulation.effects.some((effect) => effect.label === "BROKEN!")).toBe(true);
  });

  it("counts a routed formation as escaped after meaningful clear progress", () => {
    const units = createPrototypeScenario();
    const routed = units[0];
    const enemy = units[5];
    if (!routed || !enemy) throw new Error("Scenario units missing");
    routed.position = { x: 700, y: 1000 };
    routed.state = "routing";
    routed.order = { type: "move" };
    routed.morale = ROUT_MORALE_THRESHOLD;
    routed.cohesion = 80;
    enemy.position = { x: 100, y: 1000 };
    enemy.movementSpeed = 0;
    enemy.formationChangeTimer = 100;
    const simulation = new Simulation([routed, enemy], new Battlefield(402));

    for (
      let step = 0;
      step < 220 && routed.state === "routing";
      step += 1
    ) {
      simulation.update(0.05);
    }

    expect(routed.state).toBe("escaped");
    expect(routed.routingDistanceTravelled).toBe(0);
    expect(simulation.stats.romanRouted).toBe(1);
    expect(simulation.stats.romanDestroyed).toBe(0);
    expect(ROUT_ESCAPE_PROGRESS_DISTANCE).toBeGreaterThan(0);
  });

  it("breaks immediately at zero morale", () => {
    const unit = createPrototypeScenario()[0];
    if (!unit) throw new Error("Scenario unit missing");
    unit.morale = 0;
    const initialStrength = unit.soldierCount;
    const simulation = new Simulation([unit], new Battlefield(402));

    simulation.update(0.01);

    expect(unit.state).toBe("broken");
    expect(unit.soldierCount).toBe(0);
    expect(simulation.routEscapeVisuals).toHaveLength(initialStrength);
    expect(simulation.discardedEquipment).toHaveLength(initialStrength);
    expect(simulation.stats.romanDestroyed).toBe(1);
  });

  it("permanently removes routed soldiers that remain trapped beside deep water", () => {
    const units = createPrototypeScenario();
    const routed = units[0];
    const enemy = units[5];
    if (!routed || !enemy) throw new Error("Scenario units missing");
    const battlefield = new Battlefield(402);
    const streamY = battlefield.streamY(800);
    routed.position = { x: 800, y: streamY - 58 };
    routed.state = "routing";
    routed.order = { type: "move" };
    routed.movementSpeed = 0;
    enemy.position = { x: 800, y: streamY - 310 };
    enemy.order = { type: "hold" };
    enemy.movementSpeed = 0;
    const initialStrength = routed.soldierCount;
    const simulation = new Simulation([routed, enemy], battlefield);

    const initialMorale = routed.morale;
    const steps = Math.ceil((ROUT_WATER_FAILURE_SECONDS + 0.2) / 0.05);
    for (let step = 0; step < steps; step += 1) simulation.update(0.05);

    expect(routed.soldierCount).toBe(initialStrength);
    expect(routed.state).toBe("routing");
    expect(routed.morale).toBeLessThan(initialMorale);
    expect(simulation.stats.romanDestroyed).toBe(0);

    for (
      let step = 0;
      step < 220 && routed.state === "routing";
      step += 1
    ) {
      simulation.update(0.05);
    }

    expect(routed.soldierCount).toBe(0);
    expect(routed.state).toBe("broken");
    expect(simulation.routEscapeVisuals).toHaveLength(initialStrength);
    expect(simulation.discardedEquipment).toHaveLength(initialStrength);
    expect(simulation.stats.romanDestroyed).toBe(1);
    expect(simulation.stats.romanRouted).toBe(0);

    const visual = simulation.routEscapeVisuals[0];
    if (!visual) throw new Error("Escape visual missing");
    const startX = visual.x;
    const startY = visual.y;
    const directionX = visual.directionX;
    const directionY = visual.directionY;
    simulation.update(0.5);
    expect(visual.x - startX).toBeCloseTo(directionX * visual.speed * 0.5);
    expect(visual.y - startY).toBeCloseTo(directionY * visual.speed * 0.5);
    expect(visual.directionX).toBe(directionX);
    expect(visual.directionY).toBe(directionY);
  });
});

describe("tactical readiness", () => {
  it("prepares a formation after five stationary seconds on standard terrain", () => {
    const unit = createPrototypeScenario()[0];
    if (!unit) throw new Error("Scenario unit missing");
    const battlefield = new Battlefield(402);
    battlefield.rough.length = 0;
    unit.position = { x: 100, y: 100 };
    unit.order = { type: "hold" };
    const simulation = new Simulation([unit], battlefield);

    simulation.update(5.01);

    expect(unit.stationaryTimer).toBeGreaterThanOrEqual(5);
    expect(unit.tacticalState).toBe("prepared");
  });

  it("prepares shieldwalls immediately on standard terrain", () => {
    const unit = createPrototypeScenario()[0];
    if (!unit) throw new Error("Scenario unit missing");
    const battlefield = new Battlefield(402);
    battlefield.rough.length = 0;
    unit.position = { x: 100, y: 100 };
    applyFormation(unit, "shieldwall");
    const simulation = new Simulation([unit], battlefield);

    simulation.update(0.01);

    expect(unit.tacticalState).toBe("prepared");
  });

  it("makes formations vulnerable while crossing a stream", () => {
    const unit = createPrototypeScenario()[0];
    if (!unit) throw new Error("Scenario unit missing");
    const battlefield = new Battlefield(402);
    unit.position = { x: 450, y: battlefield.streamY(450) };
    const simulation = new Simulation([unit], battlefield);

    simulation.update(0.01);

    expect(unit.tacticalState).toBe("vulnerable");
  });

  it("makes formations vulnerable while moving through woods", () => {
    const unit = createPrototypeScenario()[0];
    if (!unit) throw new Error("Scenario unit missing");
    const battlefield = new Battlefield(402);
    battlefield.rough.length = 0;
    battlefield.trees.length = 0;
    battlefield.trees.push({ x: 300, y: 300, size: 18, rotation: 0 });
    unit.position = { x: 300, y: 300 };
    const simulation = new Simulation([unit], battlefield);

    simulation.update(0.01);

    expect(unit.tacticalState).toBe("vulnerable");
  });
});

describe("formation changes", () => {
  it("reverses in two seconds without moving soldiers through the formation", () => {
    const unit = createPrototypeScenario()[0];
    if (!unit) throw new Error("Scenario unit missing");
    const worldPositions = unit.soldiers.slice(0, unit.soldierCount).map((soldier) => ({
      x: unit.position.x + soldier.x * Math.cos(unit.facing) - soldier.y * Math.sin(unit.facing),
      y: unit.position.y + soldier.x * Math.sin(unit.facing) + soldier.y * Math.cos(unit.facing),
    }));
    beginAboutFace(unit);

    expect(unit.formationChangeTimer).toBe(ABOUT_FACE_DURATION);
    expect(unit.aboutFacePending).toBe(true);
    expect(unit.order.type).toBe("hold");
    completeAboutFace(unit);

    expect(unit.facing).toBeCloseTo(Math.PI);
    expect(unit.aboutFacePending).toBe(false);
    unit.soldiers.slice(0, unit.soldierCount).forEach((soldier, index) => {
      const before = worldPositions[index];
      if (!before) throw new Error("Soldier position missing");
      const worldX = unit.position.x + soldier.x * Math.cos(unit.facing) -
        soldier.y * Math.sin(unit.facing);
      const worldY = unit.position.y + soldier.x * Math.sin(unit.facing) +
        soldier.y * Math.cos(unit.facing);
      expect(worldX).toBeCloseTo(before.x);
      expect(worldY).toBeCloseTo(before.y);
    });
  });

  it("does not complete an about-face before its two-second reorganisation", () => {
    const unit = createPrototypeScenario()[0];
    if (!unit) throw new Error("Scenario unit missing");
    const battlefield = new Battlefield(402);
    battlefield.rough.length = 0;
    battlefield.trees.length = 0;
    unit.position = { x: 400, y: 400 };
    const initialFacing = unit.facing;
    beginAboutFace(unit);
    const simulation = new Simulation([unit], battlefield);

    simulation.update(ABOUT_FACE_DURATION - 0.1);
    expect(unit.facing).toBe(initialFacing);
    expect(unit.aboutFacePending).toBe(true);

    simulation.update(0.11);
    expect(unit.facing).toBeCloseTo(initialFacing + Math.PI);
    expect(unit.aboutFacePending).toBe(false);
  });

  it("halts a unit for five seconds while it changes formation", () => {
    const unit = createPrototypeScenario()[0];
    if (!unit) throw new Error("Scenario unit missing");
    const battlefield = new Battlefield(402);
    battlefield.rough.length = 0;
    battlefield.trees.length = 0;
    unit.position = { x: 400, y: 400 };
    applyFormation(unit, "column");
    const simulation = new Simulation([unit], battlefield);

    simulation.update(4.9);

    expect(unit.position).toEqual({ x: 400, y: 400 });
    expect(unit.order.type).toBe("hold");
    expect(unit.formationChangeTimer).toBeCloseTo(0.1);

    unit.order = { type: "move", destination: { x: 400, y: 300 } };
    simulation.update(0.2);
    expect(unit.position.y).toBeLessThan(400);
  });

  it("moves a mob directly toward its destination without wheeling", () => {
    const unit = createPrototypeScenario()[0];
    if (!unit) throw new Error("Scenario unit missing");
    const battlefield = new Battlefield(402);
    battlefield.rough.length = 0;
    battlefield.trees.length = 0;
    unit.position = { x: 400, y: 400 };
    unit.facing = 0;
    applyFormation(unit, "mob");
    unit.formationChangeTimer = 0;
    unit.order = { type: "move", destination: { x: 500, y: 400 } };
    const simulation = new Simulation([unit], battlefield);

    simulation.update(0.1);

    expect(unit.facing).toBeCloseTo(Math.PI / 2);
    expect(unit.position.x).toBeGreaterThan(400);
    expect(unit.position.y).toBeCloseTo(400);
    expect(unit.tacticalState).toBe("vulnerable");
  });

  it("makes mobs substantially worse at fighting than ordered lines", () => {
    const units = createPrototypeScenario();
    const attacker = units[0];
    const defender = units[5];
    if (!attacker || !defender) throw new Error("Scenario units missing");
    const lineLosses = estimateCasualties(attacker, defender, "rear");
    applyFormation(attacker, "mob");
    const mobLosses = estimateCasualties(attacker, defender, "rear");

    expect(mobLosses).toBeLessThan(lineLosses);
  });

  it("makes a tortoise substantially less effective on the attack", () => {
    const units = createPrototypeScenario();
    const attacker = units[0];
    const defender = units[5];
    if (!attacker || !defender) throw new Error("Scenario units missing");
    const lineLosses = estimateCasualties(attacker, defender, "rear");
    applyFormation(attacker, "tortoise");
    const tortoiseLosses = estimateCasualties(attacker, defender, "rear");

    expect(tortoiseLosses).toBeLessThan(lineLosses);
  });
});

describe("battlefield bodies", () => {
  it("leaves a body for every combat casualty", () => {
    const units = createPrototypeScenario();
    const attacker = units[0];
    const defender = units[5];
    if (!attacker || !defender) throw new Error("Scenario units missing");
    const battlefield = new Battlefield(402);
    battlefield.rough.length = 0;
    battlefield.trees.length = 0;
    attacker.position = { x: 400, y: 400 };
    attacker.facing = Math.PI;
    attacker.combatTimer = 0;
    defender.position = { x: 400, y: 432 };
    defender.facing = 0;
    defender.combatTimer = 100;
    const initialStrength = defender.soldierCount;
    const simulation = new Simulation([attacker, defender], battlefield);

    simulation.update(0.01);

    const losses = initialStrength - defender.soldierCount;
    expect(losses).toBeGreaterThan(0);
    expect(simulation.bodies).toHaveLength(losses);
    expect(simulation.discardedEquipment).toHaveLength(losses);
    expect(simulation.bodies.every((body) => body.faction === defender.faction)).toBe(true);
    expect(simulation.discardedEquipment.every(
      (equipment) => equipment.faction === defender.faction,
    )).toBe(true);
  });

  it("slows units and harms morale in dense friendly body terrain", () => {
    const clearUnit = createPrototypeScenario()[0];
    const bodyUnit = createPrototypeScenario()[0];
    if (!clearUnit || !bodyUnit) throw new Error("Scenario units missing");
    const clearBattlefield = new Battlefield(402);
    const bodyBattlefield = new Battlefield(402);
    clearBattlefield.rough.length = 0;
    clearBattlefield.trees.length = 0;
    bodyBattlefield.rough.length = 0;
    bodyBattlefield.trees.length = 0;
    clearUnit.position = { x: 400, y: 400 };
    bodyUnit.position = { x: 400, y: 400 };
    clearUnit.facing = 0;
    bodyUnit.facing = 0;
    clearUnit.order = { type: "move", destination: { x: 400, y: 250 } };
    bodyUnit.order = { type: "move", destination: { x: 400, y: 250 } };
    const clearSimulation = new Simulation([clearUnit], clearBattlefield);
    const bodySimulation = new Simulation([bodyUnit], bodyBattlefield);
    for (let index = 0; index < 14; index += 1) {
      const angle = index / 14 * Math.PI * 2;
      bodySimulation.bodies.push({
        x: 400 + Math.cos(angle) * 12,
        y: 400 + Math.sin(angle) * 12,
        facing: angle,
        faction: bodyUnit.faction,
        phase: index,
      });
    }

    clearSimulation.update(1);
    bodySimulation.update(1);

    expect(bodyUnit.position.y).toBeGreaterThan(clearUnit.position.y);
    expect(bodyUnit.morale).toBeLessThan(clearUnit.morale);
  });
});
