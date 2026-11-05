import { describe, expect, it } from "vitest";
import { occupancyAt } from "../gridBattle/model/occupancy";
import { attackingPressure, createContestedCell, damageBlock, defendingResistance, meleeDamagePreview, pressurePreview, rearSupport, resolvePressure, retreatBlock } from "../gridBattle/rules/combat";
import { applyTacticalMoraleShock } from "../gridBattle/rules/morale";
import { chargeConfirmationPreview, chargePreview, resolveCharge } from "../gridBattle/rules/charge";
import { resolveContestedMelees, resolveDuels } from "../gridBattle/rules/contestedMelee";
import { directionVector, formationEdgeType, isCardinalStep } from "../gridBattle/rules/direction";
import { mergeFormations, reformBlock } from "../gridBattle/rules/formationActions";
import { blockIsWavering, closeEngagementGaps, engagedContacts, fallBackFormation, formationIsEngaged, refillFormationFront, resolveEngagedOrder } from "../gridBattle/rules/engagement";
import {
  canTranslateFormation,
  finishFormationMove,
  planFormationMove,
  rotationPivot,
  translateFormation,
} from "../gridBattle/rules/movement";
import { connectedComponents, originalFormationId, recalculateFormationConnectivity } from "../gridBattle/rules/splitting";
import {
  automaticallyMergeTouchingOriginalUnits,
  moveFragmentTowardOriginalUnit,
  resolveEndActivationRegrouping,
} from "../gridBattle/rules/regrouping";
import { createPrototypeGridScenario } from "../gridBattle/scenario/prototypeScenario";
import { executeCommand } from "../gridBattle/commands/executeCommand";
import { planOrder } from "../gridBattle/commands/planOrder";
import { canSelectFormation, endFormationActivation, remainingActivations } from "../gridBattle/rules/turnSystem";
import { addMapTerrainObject, setMapEdgeFeature, setMapElevation, setMapTerrain } from "../gridBattle/model/battlefieldMap";
import {
  buildingCellAt,
  placeBuilding,
  terrainBlockCapacityAt,
  terrainElevationAt,
  terrainMovementCost,
} from "../gridBattle/model/terrain";
import {
  blockHitPoints,
  formationPressure,
  formationResistance,
  modelCapacity,
} from "../gridBattle/model/unitStats";
import { addFormation, attachCharacter, blankState } from "./gridBattleTestState";

describe("grid battle rules", () => {
  it("1. moves a formation north while preserving relative positions", () => {
    const state = blankState();
    addFormation(state, "f", [{ x: 2, y: 3 }, { x: 3, y: 3 }], "north");
    expect(translateFormation(state, "f", "north").ok).toBe(true);
    expect(state.blocks["f-b1"]!.position).toEqual({ x: 2, y: 2 });
    expect(state.blocks["f-b2"]!.position).toEqual({ x: 3, y: 2 });
  });

  it("2. rejects diagonal movement", () => {
    expect(isCardinalStep({ x: 1, y: 1 }, { x: 2, y: 2 })).toBe(false);
  });

  it("3. prevents overlap with a friendly block", () => {
    const state = blankState();
    addFormation(state, "f", [{ x: 2, y: 3 }], "north");
    addFormation(state, "friend", [{ x: 2, y: 2 }], "north");
    expect(canTranslateFormation(state, "f", "north").ok).toBe(false);
  });

  it("4. pivots facing in place without shifting any blocks", () => {
    const state = blankState();
    const formation = addFormation(state, "f", [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }], "north");
    const pivot = rotationPivot(state, formation);
    expect(pivot).toEqual({ x: 3, y: 2 });
    const positions = formation.blockIds.map((id) => ({ ...state.blocks[id]!.position }));
    expect(finishFormationMove(state, "f", "east").ok).toBe(true);
    expect(state.formations.f!.facing).toBe("east");
    expect(formation.blockIds.map((id) => state.blocks[id]!.position)).toEqual(positions);
  });

  it("5. derives front edges for every cardinal facing", () => {
    for (const facing of ["north", "east", "south", "west"] as const) {
      expect(formationEdgeType(facing, facing)).toBe("front");
    }
  });

  it("6. derives rear support relative to facing", () => {
    const state = createPrototypeGridScenario();
    expect(rearSupport(state, "legio-i-b1")).toBe(2);
  });

  it("7. applies a character pressure bonus only to the host block", () => {
    const state = createPrototypeGridScenario();
    expect(attackingPressure(state, "legio-i-b3") - attackingPressure(state, "legio-i-b2")).toBe(2);
  });

  it("7b. keeps every authored ramp connected to a surface exactly one level higher", () => {
    const state = createPrototypeGridScenario();
    const ramps = state.battlefield.tiles.flatMap((tile, index) => tile.ramp
      ? [[`${index % state.battlefield.width},${Math.floor(index / state.battlefield.width)}`, tile.ramp] as const]
      : []);
    expect(ramps).toHaveLength(27);
    for (const [key, direction] of ramps) {
      const [x, y] = key.split(",").map(Number) as [number, number];
      const vector = directionVector(direction);
      expect(terrainElevationAt(state, { x: x + vector.x, y: y + vector.y }))
        .toBe(terrainElevationAt(state, { x, y }) + 1);
    }
  });

  it("8. a pressure win retreats only the contacted block", () => {
    const state = blankState();
    addFormation(state, "attack", [{ x: 3, y: 4 }], "north");
    addFormation(state, "defend", [{ x: 3, y: 3 }, { x: 4, y: 3 }], "south", "saxon");
    state.formations.attack!.unit.unitType = "heavy_infantry";
    resolvePressure(state, "attack-b1", "defend-b1");
    expect(state.blocks["defend-b1"]!.position).not.toEqual({ x: 3, y: 3 });
    expect(state.blocks["defend-b2"]!.position).toEqual({ x: 4, y: 3 });
  });

  it("8b. plans a Press outcome without mutating state and requires confirmation", () => {
    const state = blankState();
    addFormation(state, "attack", [{ x: 3, y: 4 }], "north", "roman");
    addFormation(state, "defend", [{ x: 3, y: 3 }], "south", "saxon");
    attachCharacter(state, "pressure-test", "attack-b1", "roman", "centurion", { pressureBonus: 20 });
    state.selectedFormationId = "attack";
    const before = structuredClone(state);

    const planned = planOrder(state, { type: "press" });

    expect(state).toEqual(before);
    expect(planned).toMatchObject({
      ok: true,
      order: {
        command: { type: "press" },
        confirmation: { kind: "combat", title: "Confirm press" },
      },
    });
    expect(planned.order!.confirmation!.tiles.every((tile) => tile.certainty === "possible")).toBe(true);
    expect(executeCommand(state, planned.order!.command)).toEqual({
      accepted: false, reason: "Combat orders must be previewed and confirmed.",
    });
    expect(executeCommand(state, planned.order!.command, { confirmed: true }).accepted).toBe(true);
  });

  it("8c. previews percentile destinations and damage ranges for both combatants", () => {
    const state = blankState();
    addFormation(state, "attack", [{ x: 3, y: 4 }], "north", "roman");
    addFormation(state, "defend", [{ x: 3, y: 3 }], "south", "saxon");
    attachCharacter(state, "pressure-test", "attack-b1", "roman", "centurion", { pressureBonus: 20 });
    state.formations.attack!.unit.attack = 4;
    state.formations.defend!.unit.attack = 0;
    state.formations.defend!.unit.defence = 25;
    state.blocks["defend-b1"]!.models = 1;
    state.selectedFormationId = "attack";

    const confirmation = planOrder(state, { type: "press" }).order!.confirmation!;

    expect(confirmation.tiles).toContainEqual(expect.objectContaining({
      factionId: "saxon", chance: 25,
    }));
    expect(confirmation.tiles.every((tile) => tile.math.some((line) => line.includes("defence rolls")))).toBe(true);
    expect(confirmation.damage).toEqual(expect.arrayContaining([
      expect.objectContaining({ blockId: "attack-b1", minimumDamage: 0, maximumDamage: 0 }),
      expect.objectContaining({ blockId: "defend-b1", minimumDamage: 0, maximumDamage: 1, evadeChance: 25 }),
    ]));
    expect(confirmation.damage.find((damage) => damage.blockId === "defend-b1")?.math)
      .toContainEqual(expect.stringContaining("Pressure:"));
  });

  it("9. allows a retreating block to detach without moving neighbours", () => {
    const state = blankState();
    addFormation(state, "f", [{ x: 3, y: 3 }, { x: 4, y: 3 }], "south", "saxon");
    retreatBlock(state, "f-b1");
    expect(state.blocks["f-b1"]!.position).toEqual({ x: 3, y: 2 });
    expect(state.blocks["f-b2"]!.position).toEqual({ x: 4, y: 3 });
  });

  it("10. shifts a retreat cascade from the rearmost block", () => {
    const state = blankState();
    addFormation(state, "f", [{ x: 3, y: 3 }, { x: 3, y: 2 }, { x: 3, y: 1 }], "south", "saxon");
    expect(retreatBlock(state, "f-b1")).toBe("cascade");
    expect(state.blocks["f-b1"]!.position.y).toBe(2);
    expect(state.blocks["f-b2"]!.position.y).toBe(1);
    expect(state.blocks["f-b3"]!.position.y).toBe(0);
  });

  it("11. inflicts compression damage when a cascade is blocked", () => {
    const state = blankState();
    addFormation(state, "f", [{ x: 3, y: 2 }, { x: 3, y: 1 }, { x: 3, y: 0 }], "south", "saxon");
    expect(retreatBlock(state, "f-b1")).toBe("compressed");
    expect(state.blocks["f-b1"]!.models).toBe(8);
    expect(state.blocks["f-b1"]!.wavering).toBe(true);
  });

  it("12. removing a central block splits a formation", () => {
    const state = blankState();
    addFormation(state, "f", [{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }], "north");
    state.blocks["f-b2"]!.models = 1;
    damageBlock(state, "f-b2", 1, "test");
    expect(Object.keys(state.formations)).toHaveLength(2);
  });

  it("13. a contested block does not transmit connectivity", () => {
    const state = blankState();
    addFormation(state, "f", [{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }], "north");
    state.blocks["f-b2"]!.isContested = true;
    expect(connectedComponents(state, "f")).toHaveLength(3);
  });

  it("14. the leader component retains the original formation id", () => {
    const state = blankState();
    const formation = addFormation(state, "f", [{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }], "north");
    attachCharacter(state, "leader", "f-b1", "roman", "commander");
    formation.leaderCharacterId = "leader";
    state.blocks["f-b2"]!.models = 1;
    damageBlock(state, "f-b2", 1, "test");
    expect(state.blocks["f-b1"]!.formationId).toBe("f");
  });

  it("14b. keeps the largest component as the main body even when the commander is elsewhere", () => {
    const state = blankState();
    const formation = addFormation(state, "f", [
      { x: 1, y: 1 },
      { x: 4, y: 1 }, { x: 4, y: 2 }, { x: 4, y: 3 },
    ], "north");
    attachCharacter(state, "leader", "f-b1", "roman", "commander");
    formation.leaderCharacterId = "leader";

    recalculateFormationConnectivity(state, "f", true);

    expect(state.formations.f!.blockIds).toEqual(["f-b2", "f-b3", "f-b4"]);
    expect(state.formations.f!.name).toContain("Main Body");
    expect(state.formations.f!.leaderCharacterId).toBeNull();
    expect(state.blocks["f-b1"]!.formationId).not.toBe("f");
  });

  it("15. keeps a detached single block as a valid fragment", () => {
    const state = blankState();
    addFormation(state, "f", [{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }], "north");
    state.blocks["f-b2"]!.models = 1;
    damageBlock(state, "f-b2", 1, "test");
    expect(Object.values(state.formations).some((formation) => formation.blockIds.length === 1)).toBe(true);
  });

  it("16. merges compatible adjacent fragments", () => {
    const state = blankState();
    addFormation(state, "a", [{ x: 2, y: 2 }], "north");
    addFormation(state, "b", [{ x: 3, y: 2 }], "north");
    expect(mergeFormations(state, "a", "b")).toBe("a");
    expect(state.formations.a!.blockIds).toHaveLength(2);
  });

  it("17. calculates momentum for a valid cavalry charge", () => {
    const state = createPrototypeGridScenario();
    const preview = chargePreview(state, "saxon-cavalry-b1", "lanciarii-b3");
    expect(preview).toMatchObject({ distance: 3, momentum: 5, impactDamage: 1 });
  });

  it("18. resolves cavalry impact before normal pressure", () => {
    const state = createPrototypeGridScenario();
    resolveCharge(state, "saxon-cavalry-b1", "lanciarii-b3");
    const types = state.eventLog.map((event) => event.type);
    expect(types.indexOf("charge_impact")).toBeLessThan(types.indexOf("pressure_applied"));
  });

  it("19. reduces charge momentum after a collision", () => {
    const state = createPrototypeGridScenario();
    resolveCharge(state, "saxon-cavalry-b1", "lanciarii-b3");
    expect(state.blocks["saxon-cavalry-b1"]?.chargeMomentum).toBe(2);
    expect(state.blocks["saxon-cavalry-b2"]?.chargeMomentum).toBe(2);
    expect(state.blocks["saxon-cavalry-b3"]?.chargeMomentum).toBe(2);
    expect(state.eventLog.filter((event) => event.type === "charge_impact")).toHaveLength(3);
  });

  it("20. lets a braced spear formation damage charging cavalry", () => {
    const state = createPrototypeGridScenario();
    state.formations.lanciarii!.isBraced = true;
    resolveCharge(state, "saxon-cavalry-b1", "lanciarii-b3");
    expect(state.blocks["saxon-cavalry-b1"]?.wounds).toBeGreaterThan(0);
  });

  it("20a. does not apply the spear counter-charge ability without Brace", () => {
    const state = createPrototypeGridScenario();
    resolveCharge(state, "saxon-cavalry-b1", "lanciarii-b3");
    expect(state.blocks["saxon-cavalry-b1"]?.models).toBe(3);
  });

  it("20b. lets infantry charge two squares and gain attack pressure", () => {
    const state = blankState();
    addFormation(state, "attack", [{ x: 3, y: 5 }], "north", "roman");
    addFormation(state, "defend", [{ x: 3, y: 2 }], "south", "saxon");

    const preview = chargePreview(state, "attack-b1", "defend-b1");
    expect(preview).toMatchObject({ distance: 2, attackBonus: 2, bonusNullified: false, unitType: "light_infantry" });
    expect(resolveCharge(state, "attack-b1", "defend-b1")).toBe(true);
    expect(state.blocks["attack-b1"]!.chargeDistance).toBe(2);
    expect(state.blocks["attack-b1"]!.position.y).toBeLessThanOrEqual(3);
    expect(state.eventLog).toContainEqual(expect.objectContaining({ type: "pressure_applied" }));
  });

  it("20c. limits an infantry charge through difficult terrain to one square", () => {
    for (const terrain of ["rough", "dangerous", "forest", "river_shallow"] as const) {
      const state = blankState();
      addFormation(state, "attack", [{ x: 3, y: 5 }], "north", "roman");
      addFormation(state, "defend", [{ x: 3, y: 2 }], "south", "saxon");
      setMapTerrain(state.battlefield, { x: 3, y: 4 }, terrain);

      expect(chargePreview(state, "attack-b1", "defend-b1")).toBeNull();
      state.blocks["defend-b1"]!.position = { x: 3, y: 3 };
      expect(chargePreview(state, "attack-b1", "defend-b1")).toMatchObject({ distance: 1, attackBonus: 2 });
    }
  });

  it("20c-2. lets infantry charge past trees on open ground", () => {
    const state = blankState();
    addFormation(state, "attack", [{ x: 3, y: 5 }], "north", "roman");
    addFormation(state, "defend", [{ x: 3, y: 2 }], "south", "saxon");
    addMapTerrainObject(state.battlefield, { x: 3, y: 4 }, "tree_large");

    expect(chargePreview(state, "attack-b1", "defend-b1")).toMatchObject({ distance: 2 });
  });

  it("20d. nullifies infantry charge attack against a braced front", () => {
    const state = blankState();
    addFormation(state, "attack", [{ x: 3, y: 5 }], "north", "roman");
    const defender = addFormation(state, "defend", [{ x: 3, y: 2 }], "south", "saxon");
    defender.isBraced = true;

    expect(chargePreview(state, "attack-b1", "defend-b1")).toMatchObject({
      distance: 2, attackBonus: 0, bonusNullified: true,
    });
    defender.facing = "east";
    expect(chargePreview(state, "attack-b1", "defend-b1")).toMatchObject({
      attackBonus: 2, bonusNullified: false,
    });
  });

  it("20e. previews reordered charge destinations with certain and possible tiles", () => {
    const state = createPrototypeGridScenario();
    const preview = chargePreview(state, "great-warband-b11", "legio-i-b1");
    expect(preview).toMatchObject({ distance: 1, reordered: true });
    expect(preview?.relocations).toHaveLength(15);

    const confirmation = chargeConfirmationPreview(state, "great-warband-b11", "legio-i-b1");
    expect(confirmation?.kind).toBe("combat");
    expect(confirmation?.tiles.some((tile) => tile.certainty === "possible")).toBe(true);
    expect(confirmation?.tiles.every((tile) => tile.certainty === "possible")).toBe(true);
    state.selectedFormationId = "great-warband";
    expect(executeCommand(state, { type: "charge", attackerId: "great-warband-b11", defenderId: "legio-i-b1" })).toEqual({
      accepted: false, reason: "Combat orders must be previewed and confirmed.",
    });
  });

  it("20f. previews and resolves every contacting infantry file in a formation charge", () => {
    const state = blankState();
    addFormation(state, "attack", [
      { x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 },
      { x: 2, y: 6 }, { x: 3, y: 6 }, { x: 4, y: 6 },
    ], "north", "roman");
    addFormation(state, "defend", [
      { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 },
    ], "south", "saxon");
    for (const defenderId of state.formations.defend!.blockIds) state.blocks[defenderId]!.models = 1;

    const confirmation = chargeConfirmationPreview(state, "attack-b2", "defend-b2")!;
    const romanPossible = new Set(confirmation.tiles
      .filter((tile) => tile.factionId === "roman" && tile.certainty === "possible")
      .map((tile) => `${tile.position.x},${tile.position.y}`));
    const romanCertain = new Set(confirmation.tiles
      .filter((tile) => tile.factionId === "roman" && tile.certainty === "certain")
      .map((tile) => `${tile.position.x},${tile.position.y}`));
    expect(romanPossible).toEqual(new Set([
      "2,2", "3,2", "4,2",
      "2,3", "3,3", "4,3",
    ]));
    expect(romanCertain).toEqual(new Set());
    expect(confirmation.tiles.every((tile) => tile.chance > 0)).toBe(true);

    expect(resolveCharge(state, "attack-b2", "defend-b2")).toBe(true);
    expect(state.eventLog.filter((event) => event.type === "charge_impact")).toHaveLength(3);
    expect(state.eventLog.filter((event) => event.type === "pressure_applied")).toHaveLength(3);
    expect(state.blocks["attack-b1"]!.position).toEqual({ x: 2, y: 2 });
    expect(state.blocks["attack-b2"]!.position).toEqual({ x: 3, y: 2 });
    expect(state.blocks["attack-b3"]!.position).toEqual({ x: 4, y: 2 });
    expect(state.blocks["attack-b4"]!.position).toEqual({ x: 2, y: 3 });
    expect(state.blocks["attack-b5"]!.position).toEqual({ x: 3, y: 3 });
    expect(state.blocks["attack-b6"]!.position).toEqual({ x: 4, y: 3 });
  });

  it("20h. pulls every rear rank forward when a charging file advances", () => {
    const state = blankState();
    addFormation(state, "attack", [
      { x: 3, y: 5 }, { x: 3, y: 6 }, { x: 3, y: 7 },
    ], "north", "roman");
    addFormation(state, "defend", [{ x: 3, y: 2 }], "south", "saxon");
    state.blocks["defend-b1"]!.models = 1;

    expect(resolveCharge(state, "attack-b1", "defend-b1")).toBe(true);
    expect(state.blocks["attack-b1"]!.position).toEqual({ x: 3, y: 2 });
    expect(state.blocks["attack-b2"]!.position).toEqual({ x: 3, y: 3 });
    expect(state.blocks["attack-b3"]!.position).toEqual({ x: 3, y: 4 });
  });

  it("20i. pulls a cavalry file forward behind a breakthrough", () => {
    const state = blankState();
    const cavalry = addFormation(state, "cavalry", [
      { x: 3, y: 6 }, { x: 3, y: 7 }, { x: 3, y: 8 },
    ], "north", "saxon");
    cavalry.unit.unitType = "light_cavalry";
    cavalry.formationMode = "open";
    addFormation(state, "defend", [{ x: 3, y: 3 }], "south", "roman");
    state.blocks["defend-b1"]!.models = 1;

    expect(resolveCharge(state, "cavalry-b1", "defend-b1")).toBe(true);
    expect(state.blocks["cavalry-b1"]!.position).toEqual({ x: 3, y: 3 });
    expect(state.blocks["cavalry-b2"]!.position).toEqual({ x: 3, y: 4 });
    expect(state.blocks["cavalry-b3"]!.position).toEqual({ x: 3, y: 5 });
  });

  it("20g. snapshots bracing across every simultaneous charge contact", () => {
    const state = blankState();
    addFormation(state, "attack", [{ x: 2, y: 5 }, { x: 3, y: 5 }], "north", "roman");
    const defenders = addFormation(state, "defend", [{ x: 2, y: 2 }, { x: 3, y: 2 }], "south", "saxon");
    defenders.isBraced = true;
    for (const attackerId of state.formations.attack!.blockIds) {
      attachCharacter(state, `pressure-${attackerId}`, attackerId, "roman", "centurion", { pressureBonus: 20 });
    }

    expect(resolveCharge(state, "attack-b1", "defend-b1")).toBe(true);
    const impacts = state.eventLog.filter((event) => event.type === "charge_impact");
    expect(impacts).toHaveLength(2);
    expect(impacts.every((event) => event.message.includes("stopped by the braced front"))).toBe(true);
  });

  it("21. allows no more than one block per faction in a contested square", () => {
    const state = blankState();
    addFormation(state, "r", [{ x: 2, y: 2 }, { x: 1, y: 2 }], "east", "roman");
    addFormation(state, "s", [{ x: 3, y: 2 }], "west", "saxon");
    expect(createContestedCell(state, "r-b1", "s-b1")).toBe(true);
    expect(createContestedCell(state, "r-b2", "s-b1")).toBe(false);
    expect(occupancyAt(state, { x: 3, y: 2 })).toEqual({ romanBlockId: "r-b1", saxonBlockId: "s-b1" });
  });

  it("22. resolves contested melee damage simultaneously", () => {
    const state = blankState();
    addFormation(state, "r", [{ x: 2, y: 2 }], "east", "roman");
    addFormation(state, "s", [{ x: 3, y: 2 }], "west", "saxon");
    createContestedCell(state, "r-b1", "s-b1");
    resolveContestedMelees(state);
    expect(state.blocks["r-b1"]!.models).toBeGreaterThanOrEqual(5);
    expect(state.blocks["r-b1"]!.models).toBeLessThanOrEqual(6);
    expect(state.blocks["s-b1"]!.models).toBe(5);
  });

  it("23. gives a contested square to its surviving occupant", () => {
    const state = blankState();
    addFormation(state, "r", [{ x: 2, y: 2 }], "east", "roman");
    addFormation(state, "s", [{ x: 3, y: 2 }], "west", "saxon");
    state.formations.r!.unit.attack = 10;
    state.blocks["s-b1"]!.models = 1;
    createContestedCell(state, "r-b1", "s-b1");
    resolveContestedMelees(state);
    expect(state.blocks["s-b1"]).toBeUndefined();
    expect(state.blocks["r-b1"]!.isContested).toBe(false);
    expect(formationIsEngaged(state, "r")).toBe(false);
  });

  it("24. starts a duel when opposing characters share a contested cell", () => {
    const state = blankState();
    addFormation(state, "r", [{ x: 2, y: 2 }], "east", "roman");
    addFormation(state, "s", [{ x: 3, y: 2 }], "west", "saxon");
    attachCharacter(state, "roman-char", "r-b1", "roman", "centurion");
    attachCharacter(state, "saxon-char", "s-b1", "saxon", "champion");
    createContestedCell(state, "r-b1", "s-b1");
    expect(state.characters["roman-char"]!.status).toBe("duelling");
    expect(state.characters["saxon-char"]!.status).toBe("duelling");
  });

  it("25. applies cohesion shock when a character is defeated", () => {
    const state = blankState();
    addFormation(state, "r", [{ x: 2, y: 2 }], "east", "roman");
    addFormation(state, "s", [{ x: 3, y: 2 }], "west", "saxon");
    attachCharacter(state, "roman-char", "r-b1", "roman", "centurion", { prowess: 0, maxWounds: 1 });
    attachCharacter(state, "saxon-char", "s-b1", "saxon", "champion", { prowess: 8 });
    createContestedCell(state, "r-b1", "s-b1");
    resolveDuels(state);
    expect(state.characters["roman-char"]!.status).toBe("defeated");
    expect(state.characters["saxon-char"]!.status).toBe("active");
    expect(state.formations.r!.cohesion).toBe(5);
    const resolvedEvents = state.eventLog.filter((event) => event.type === "duel_resolved").length;
    resolveDuels(state);
    expect(state.eventLog.filter((event) => event.type === "duel_resolved")).toHaveLength(resolvedEvents);
  });

  it("26. keeps every translated block movement cardinal", () => {
    const state = blankState();
    addFormation(state, "f", [{ x: 2, y: 3 }, { x: 3, y: 3 }], "north");
    const before = Object.fromEntries(Object.values(state.blocks).map((block) => [block.id, { ...block.position }]));
    translateFormation(state, "f", "east");
    for (const block of Object.values(state.blocks)) expect(isCardinalStep(before[block.id]!, block.position)).toBe(true);
  });

  it("27. recreates the scenario exactly on reset", () => {
    const first = createPrototypeGridScenario();
    first.blocks["legio-i-b1"]!.models = 1;
    const reset = createPrototypeGridScenario();
    expect(JSON.stringify(reset)).toBe(JSON.stringify(createPrototypeGridScenario()));
  });

  it("28. retreats directly away from a flank attacker regardless of defender facing", () => {
    const state = blankState();
    addFormation(state, "attack", [{ x: 4, y: 3 }], "west");
    addFormation(state, "defend", [{ x: 3, y: 3 }], "south", "saxon");
    state.formations.attack!.unit.attack = 0;
    expect(pressurePreview(state, "attack-b1", "defend-b1")?.retreatMode).toBe("good_order");
    resolvePressure(state, "attack-b1", "defend-b1");
    expect(state.blocks["defend-b1"]!.position).toEqual({ x: 2, y: 3 });
  });

  it("29. alternates a chaotic retreat across rear-left and rear-right lanes", () => {
    const state = blankState();
    addFormation(state, "f", [{ x: 3, y: 3 }, { x: 2, y: 3 }], "north", "saxon");
    expect(retreatBlock(state, "f-b1", "west", "chaotic")).toBe("chaotic");
    expect(state.blocks["f-b1"]!.position).toEqual({ x: 2, y: 3 });
    expect(state.blocks["f-b2"]!.position).toEqual({ x: 1, y: 2 });
    expect(Object.keys(state.formations)).toHaveLength(2);
    expect(state.eventLog.some((event) => event.type === "formation_split")).toBe(true);
  });

  it("29b. pushes the contacted block orthogonally into an enemy behind it", () => {
    const state = blankState();
    addFormation(state, "pusher", [{ x: 4, y: 3 }], "west", "saxon");
    addFormation(state, "roman", [{ x: 3, y: 3 }], "east", "roman");
    addFormation(state, "rear-saxon", [{ x: 2, y: 3 }], "east", "saxon");
    attachCharacter(state, "pressure-test", "pusher-b1", "saxon", "centurion", { pressureBonus: 20 });
    state.formations.pusher!.unit.attack = 0;
    const preview = pressurePreview(state, "pusher-b1", "roman-b1");
    expect(preview?.retreatDestination).toEqual({ x: 2, y: 3 });
    expect(preview?.mayCompress).toBe(false);
    expect(resolvePressure(state, "pusher-b1", "roman-b1").vacated).toBe(true);
    expect(state.blocks["roman-b1"]!.position).toEqual({ x: 2, y: 3 });
    expect(state.blocks["rear-saxon-b1"]!.position).toEqual({ x: 2, y: 3 });
    expect(state.blocks["roman-b1"]!.isContested).toBe(true);
    expect(state.blocks["rear-saxon-b1"]!.isContested).toBe(true);
  });

  it("30. makes overwhelming pressure trigger a chaotic retreat", () => {
    const state = blankState();
    addFormation(state, "attack", [{ x: 4, y: 3 }], "west");
    addFormation(state, "defend", [{ x: 3, y: 3 }, { x: 2, y: 3 }], "east", "saxon");
    attachCharacter(state, "pressure-test", "attack-b1", "roman", "centurion", { pressureBonus: 20 });
    const preview = pressurePreview(state, "attack-b1", "defend-b1");
    expect(preview?.retreatMode).toBe("chaotic");
    expect(preview?.retreatDestinations).toHaveLength(2);
    resolvePressure(state, "attack-b1", "defend-b1");
    expect(state.eventLog.some((event) => event.type === "chaotic_retreat")).toBe(true);
  });

  it("31. inflicts visible casualties without draining morale for every damaged block", () => {
    const state = blankState();
    addFormation(state, "attack", [{ x: 3, y: 4 }], "north");
    addFormation(state, "defend", [{ x: 3, y: 3 }], "south", "saxon");
    const cohesionBefore = state.formations.defend!.cohesion;
    resolvePressure(state, "attack-b1", "defend-b1");
    expect(state.blocks["defend-b1"]!.models).toBe(7);
    expect(state.formations.defend!.cohesion).toBe(cohesionBefore);
    expect(state.eventLog).toContainEqual(expect.objectContaining({ type: "block_damaged", casualties: 2 }));
  });

  it("32. resolves Defence as a deterministic chance to evade the attack", () => {
    const state = blankState();
    addFormation(state, "attack", [{ x: 3, y: 4 }], "north", "saxon");
    addFormation(state, "defend", [{ x: 3, y: 3 }], "south", "roman");
    state.formations.defend!.unit.defence = 100;
    const evaded = meleeDamagePreview(state, "attack-b1", "defend-b1")!;
    state.formations.defend!.unit.defence = 0;
    const hit = meleeDamagePreview(state, "attack-b1", "defend-b1")!;
    expect(evaded.evaded).toBe(true);
    expect(evaded.expectedDamage).toBe(0);
    expect(hit.evaded).toBe(false);
    expect(hit.expectedDamage).toBeGreaterThan(0);
  });

  it("32a. tracks damage against HP per model before removing a model", () => {
    const state = blankState();
    const formation = addFormation(state, "tough", [{ x: 3, y: 3 }], "north");
    const block = state.blocks["tough-b1"]!;
    formation.unit.hitPointsPerModel = 2;
    formation.initialModelCount = 2;
    block.models = 2;
    block.modelCapacity = 2;

    damageBlock(state, block.id, 1, "test");
    expect(block).toMatchObject({ models: 2, wounds: 1 });
    expect(blockHitPoints(formation, block)).toBe(3);

    damageBlock(state, block.id, 1, "test");
    expect(block).toMatchObject({ models: 1, wounds: 0 });
    expect(blockHitPoints(formation, block)).toBe(2);
  });

  it("32b. derives block capacity from model size and formation mode", () => {
    const state = blankState();
    const formation = addFormation(state, "unit", [{ x: 3, y: 3 }], "north");
    formation.unit.modelSize = 3;
    formation.formationMode = "open";
    expect(modelCapacity(formation)).toBe(3);
    formation.formationMode = "closed";
    expect(modelCapacity(formation)).toBe(6);
  });

  it("32c. derives Pressure and Resistance from unit type and formation", () => {
    const state = blankState();
    const formation = addFormation(state, "unit", [{ x: 3, y: 3 }], "north");
    formation.unit.unitType = "light_infantry";
    formation.formationMode = "open";
    expect({ pressure: formationPressure(formation), resistance: formationResistance(formation) })
      .toEqual({ pressure: 2, resistance: 2 });

    formation.unit.unitType = "heavy_infantry";
    formation.formationMode = "closed";
    expect({ pressure: formationPressure(formation), resistance: formationResistance(formation) })
      .toEqual({ pressure: 6, resistance: 6 });
  });

  it("33. fields an 81-person Roman century and larger Saxon heavy formation", () => {
    const state = createPrototypeGridScenario();
    const century = state.formations["legio-i"]!;
    const warband = state.formations["great-warband"]!;
    const centuryCharacters = century.blockIds
      .map((id) => state.blocks[id]!.characterId)
      .filter((id): id is string => id !== null)
      .map((id) => state.characters[id]!.role);
    expect(century.blockIds).toHaveLength(9);
    expect(century.blockIds.reduce((total, id) => total + state.blocks[id]!.models, 0)).toBe(81);
    expect(centuryCharacters).toEqual(["centurion"]);
    expect(warband.blockIds.length).toBeGreaterThan(century.blockIds.length);
  });

  it("34. does not let an ordinary expected casualty pre-emptively trigger a chaotic retreat", () => {
    const state = blankState();
    addFormation(state, "attack", [{ x: 3, y: 4 }], "north");
    addFormation(state, "defend", [{ x: 3, y: 3 }], "south", "saxon");
    state.formations.attack!.unit.unitType = "heavy_infantry";
    state.formations.defend!.cohesion = 7;
    const preview = pressurePreview(state, "attack-b1", "defend-b1");
    expect(preview?.expectedCasualties).toBeGreaterThanOrEqual(1);
    expect(preview?.retreatMode).toBe("good_order");
  });

  it("35. makes frontal Saxon attacks cause 1-2 casualties and flank attacks 3-4", () => {
    const front = blankState();
    addFormation(front, "saxon", [{ x: 3, y: 4 }], "north", "saxon");
    addFormation(front, "roman", [{ x: 3, y: 3 }], "south", "roman");
    const frontDamage = meleeDamagePreview(front, "saxon-b1", "roman-b1")!;
    expect(frontDamage.contactEdge).toBe("front");
    expect(frontDamage.shieldArmour).toBe(1);
    expect(frontDamage.expectedCasualties).toBeGreaterThanOrEqual(1);
    expect(frontDamage.expectedCasualties).toBeLessThanOrEqual(2);

    const flank = blankState();
    addFormation(flank, "saxon", [{ x: 4, y: 3 }], "west", "saxon");
    addFormation(flank, "roman", [{ x: 3, y: 3 }], "south", "roman");
    const flankDamage = meleeDamagePreview(flank, "saxon-b1", "roman-b1")!;
    expect(flankDamage.contactEdge).toBe("side");
    expect(flankDamage.flankBonus).toBe(1);
    expect(flankDamage.shieldArmour).toBe(0);
    expect(flankDamage.expectedCasualties).toBeGreaterThanOrEqual(3);
    expect(flankDamage.expectedCasualties).toBeLessThanOrEqual(4);
  });

  it("36. derives engagement and closes a missing front-rank block on activation", () => {
    const state = blankState();
    addFormation(state, "roman", [{ x: 3, y: 3 }, { x: 5, y: 3 }, { x: 4, y: 4 }], "north", "roman");
    addFormation(state, "saxon", [{ x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 }], "south", "saxon");
    expect(formationIsEngaged(state, "roman")).toBe(true);
    expect(closeEngagementGaps(state, "roman")).toContain("roman-b3");
    expect(state.blocks["roman-b3"]!.position).toEqual({ x: 4, y: 3 });
  });

  it("37. lets an engaged formation fall back one square", () => {
    const state = blankState();
    addFormation(state, "roman", [{ x: 3, y: 3 }], "north", "roman");
    addFormation(state, "saxon", [{ x: 3, y: 2 }], "south", "saxon");
    expect(fallBackFormation(state, "roman").ok).toBe(true);
    expect(state.blocks["roman-b1"]!.position).toEqual({ x: 3, y: 4 });
    expect(formationIsEngaged(state, "roman")).toBe(false);
  });

  it("37b. plans and confirms a reordered fall back through a narrow exit", () => {
    const state = blankState();
    addFormation(state, "roman", [{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }], "north", "roman");
    addFormation(state, "saxon", [{ x: 2, y: 2 }], "south", "saxon");
    setMapTerrain(state.battlefield, { x: 2, y: 4 }, "impassable");
    setMapTerrain(state.battlefield, { x: 4, y: 4 }, "impassable");
    state.selectedFormationId = "roman";

    const planned = planOrder(state, { type: "fall_back" });
    expect(planned).toMatchObject({
      ok: true,
      order: {
        command: { type: "fall_back" },
        confirmation: { kind: "movement", title: "Confirm reordered fall back" },
      },
    });
    expect(planned.order!.confirmation!.tiles.every((tile) => tile.certainty === "certain")).toBe(true);
    expect(executeCommand(state, { type: "fall_back" }).accepted).toBe(false);
    expect(executeCommand(state, { type: "fall_back" }, { confirmed: true }).accepted).toBe(true);
    expect(new Set(state.formations.roman!.blockIds.map((id) => {
      const position = state.blocks[id]!.position;
      return `${position.x},${position.y}`;
    }))).toEqual(new Set(["3,4", "3,3", "3,2"]));
  });

  it("38. makes Battle hold its footprint while Press occupies a vacated enemy gap", () => {
    const battle = blankState();
    addFormation(battle, "roman", [{ x: 3, y: 4 }], "north", "roman");
    addFormation(battle, "saxon", [{ x: 3, y: 3 }], "south", "saxon");
    battle.blocks["saxon-b1"]!.models = 1;
    expect(resolveEngagedOrder(battle, "roman", "battle")).toBe(1);
    expect(battle.blocks["roman-b1"]!.position).toEqual({ x: 3, y: 4 });

    const press = blankState();
    addFormation(press, "roman", [{ x: 3, y: 4 }], "north", "roman");
    addFormation(press, "saxon", [{ x: 3, y: 3 }], "south", "saxon");
    press.blocks["saxon-b1"]!.models = 1;
    expect(resolveEngagedOrder(press, "roman", "press")).toBe(1);
    expect(press.blocks["roman-b1"]!.position).toEqual({ x: 3, y: 3 });
  });

  it("38a. lets a lagging Battle file dress up to the formation's existing front rank", () => {
    const state = blankState();
    state.activeFactionId = "saxon";
    addFormation(state, "saxon", [
      { x: 3, y: 4 },
      { x: 2, y: 3 }, { x: 4, y: 3 },
      { x: 2, y: 4 }, { x: 4, y: 4 },
      { x: 3, y: 5 },
    ], "north", "saxon");
    addFormation(state, "roman", [{ x: 3, y: 3 }], "south", "roman");
    state.formations.saxon!.unit.unitType = "heavy_infantry";
    state.formations.saxon!.unit.attack = 0;
    state.formations.roman!.unit.attack = 0;
    state.formations.roman!.formationMode = "open";

    expect(resolveEngagedOrder(state, "saxon", "battle")).toBeGreaterThan(0);

    expect(state.blocks["roman-b1"]!.position).not.toEqual({ x: 3, y: 3 });
    expect(state.blocks["saxon-b1"]!.position).toEqual({ x: 3, y: 3 });
    expect(state.blocks["saxon-b6"]!.position).toEqual({ x: 3, y: 4 });
    expect(state.eventLog).toContainEqual(expect.objectContaining({
      type: "formation_moved",
      message: expect.stringContaining("advanced after combat"),
    }));
  });

  it("38b. trades one casualty of damage for the extra pressure of Press", () => {
    const battle = blankState();
    addFormation(battle, "roman", [{ x: 3, y: 4 }], "north", "roman");
    addFormation(battle, "saxon", [{ x: 3, y: 3 }], "south", "saxon");
    attachCharacter(battle, "resistance-test", "saxon-b1", "saxon", "commander", { resistanceBonus: 99 });
    battle.formations.saxon!.unit.equipment = [];
    battle.formations.saxon!.unit.armour = 0;
    const press = structuredClone(battle);

    expect(resolveEngagedOrder(battle, "roman", "battle")).toBe(1);
    expect(resolveEngagedOrder(press, "roman", "press")).toBe(1);

    expect(battle.blocks["saxon-b1"]!.models).toBe(6);
    expect(press.blocks["saxon-b1"]!.models).toBe(7);
    expect(battle.blocks["roman-b1"]!.position).toEqual({ x: 3, y: 4 });
    expect(press.blocks["roman-b1"]!.position).toEqual({ x: 3, y: 4 });
  });

  it("38c. plans Battle and Press through the shared combat confirmation", () => {
    const battle = blankState();
    addFormation(battle, "roman", [{ x: 3, y: 4 }], "north", "roman");
    addFormation(battle, "saxon", [{ x: 3, y: 3 }], "south", "saxon");
    battle.selectedFormationId = "roman";
    const battlePlan = planOrder(battle, { type: "battle" });
    expect(battlePlan).toMatchObject({
      ok: true,
      order: { confirmation: { kind: "combat", title: "Confirm battle" } },
    });
    expect(battlePlan.order!.confirmation!.tiles.some((tile) => tile.factionId === "roman")).toBe(true);
    expect(battlePlan.order!.confirmation!.tiles.some((tile) => tile.factionId === "saxon")).toBe(true);

    const press = blankState();
    addFormation(press, "roman", [{ x: 3, y: 4 }, { x: 3, y: 5 }], "north", "roman");
    addFormation(press, "saxon", [{ x: 3, y: 3 }], "south", "saxon");
    press.blocks["saxon-b1"]!.models = 1;
    press.selectedFormationId = "roman";
    const pressPlan = planOrder(press, { type: "press" });
    expect(pressPlan).toMatchObject({
      ok: true,
      order: { command: { type: "press" }, confirmation: { kind: "combat", title: "Confirm press" } },
    });
    expect(pressPlan.order!.confirmation!.tiles).toContainEqual(expect.objectContaining({
      position: { x: 3, y: 3 }, factionId: "roman", certainty: "possible",
    }));
    expect(executeCommand(press, { type: "press" })).toEqual({
      accepted: false, reason: "Combat orders must be previewed and confirmed.",
    });
    expect(executeCommand(press, { type: "press" }, { confirmed: true }).accepted).toBe(true);
    expect(press.blocks["roman-b1"]!.position).toEqual({ x: 3, y: 3 });
  });

  it("38d. lets Battle make a line waver without moving it below its shove threshold", () => {
    const state = blankState();
    addFormation(state, "roman", [{ x: 3, y: 4 }], "north", "roman");
    addFormation(state, "saxon", [{ x: 3, y: 3 }], "south", "saxon");
    state.formations.roman!.unit.unitType = "heavy_infantry";
    state.formations.roman!.unit.attack = 0;
    state.formations.saxon!.unit.attack = 0;

    expect(resolveEngagedOrder(state, "roman", "battle")).toBe(1);
    expect(state.formations.saxon!.cohesion).toBe(8);
    expect(state.blocks["saxon-b1"]!.position).toEqual({ x: 3, y: 3 });
    expect(state.blocks["saxon-b1"]!.wavering).toBe(true);
  });

  it("38e. lets Battle shove every contact that clears its higher threshold", () => {
    const state = blankState();
    addFormation(state, "roman", [
      { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 },
    ], "north", "roman");
    addFormation(state, "saxon", [
      { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 },
    ], "south", "saxon");
    state.formations.roman!.unit.unitType = "heavy_infantry";
    state.formations.roman!.unit.attack = 3;
    state.formations.saxon!.unit.attack = 0;
    state.formations.saxon!.formationMode = "open";

    expect(resolveEngagedOrder(state, "roman", "battle")).toBe(3);
    expect(state.formations.saxon!.cohesion).toBeLessThan(8);
    expect(Object.values(state.blocks)
      .filter((block) => block.factionId === "saxon")
      .map((block) => block.position.y)).toEqual([2, 2, 2]);
  });

  it("38f. lets a block that closes a Battle gap immediately fight its new contact", () => {
    const state = blankState();
    addFormation(state, "roman", [
      { x: 2, y: 3 }, { x: 2, y: 4 }, { x: 3, y: 4 },
    ], "north", "roman");
    addFormation(state, "saxon", [
      { x: 2, y: 2 }, { x: 3, y: 2 },
    ], "south", "saxon");
    state.formations.roman!.unit.attack = 0;
    state.formations.saxon!.unit.attack = 0;
    attachCharacter(state, "resistance-test", "saxon-b1", "saxon", "commander", { resistanceBonus: 99 });
    attachCharacter(state, "resistance-test-2", "saxon-b2", "saxon", "commander", { resistanceBonus: 99 });

    expect(resolveEngagedOrder(state, "roman", "battle")).toBe(2);
    expect(state.blocks["roman-b3"]!.position).toEqual({ x: 3, y: 3 });
    expect(state.eventLog.filter((event) => event.type === "pressure_applied")
      .map((event) => event.blockIds?.[0])).toContain("roman-b3");
  });

  it("38g. spreads Battle contacts across adjacent defenders where possible", () => {
    const state = blankState();
    addFormation(state, "roman", [{ x: 2, y: 3 }, { x: 3, y: 2 }], "north", "roman");
    addFormation(state, "saxon", [{ x: 2, y: 2 }, { x: 3, y: 1 }], "south", "saxon");

    expect(engagedContacts(state, "roman")).toEqual([
      { attackerId: "roman-b1", defenderId: "saxon-b1" },
      { attackerId: "roman-b2", defenderId: "saxon-b2" },
    ]);
  });

  it("39. keeps the movement order open for a final facing choice after contact", () => {
    const state = blankState();
    addFormation(state, "roman", [{ x: 3, y: 4 }], "north", "roman");
    addFormation(state, "saxon", [{ x: 3, y: 2 }], "south", "saxon");
    expect(executeCommand(state, { type: "select_cell", position: { x: 3, y: 4 } }).accepted).toBe(true);
    expect(executeCommand(state, { type: "choose_action", action: "move" }).accepted).toBe(true);
    expect(executeCommand(state, { type: "move", direction: "north" }).accepted).toBe(true);
    expect(formationIsEngaged(state, "roman")).toBe(true);
    expect(state.currentAction).toBe("move");
    expect(executeCommand(state, { type: "finish_move", facing: "east" }).accepted).toBe(true);
    expect(state.formations.roman).toMatchObject({ facing: "east", hasActivated: true });
  });

  it("40. pulls every steady rear rank forward behind a successful Press", () => {
    const state = blankState();
    addFormation(state, "roman", [{ x: 3, y: 4 }, { x: 3, y: 5 }, { x: 3, y: 6 }], "north", "roman");
    addFormation(state, "saxon", [{ x: 3, y: 3 }], "south", "saxon");
    expect(resolveEngagedOrder(state, "roman", "press")).toBe(1);
    expect(state.blocks["roman-b1"]!.position).toEqual({ x: 3, y: 3 });
    expect(state.blocks["roman-b2"]!.position).toEqual({ x: 3, y: 4 });
    expect(state.blocks["roman-b3"]!.position).toEqual({ x: 3, y: 5 });
  });

  it("41. stops a pressed file when the next rear block is wavering", () => {
    const state = blankState();
    addFormation(state, "roman", [{ x: 3, y: 4 }, { x: 3, y: 5 }, { x: 3, y: 6 }], "north", "roman");
    addFormation(state, "saxon", [{ x: 3, y: 3 }], "south", "saxon");
    state.blocks["roman-b2"]!.wavering = true;
    expect(blockIsWavering(state, "roman-b2")).toBe(true);
    expect(resolveEngagedOrder(state, "roman", "press")).toBe(1);
    expect(state.blocks["roman-b1"]!.position).toEqual({ x: 3, y: 3 });
    expect(state.blocks["roman-b2"]!.position).toEqual({ x: 3, y: 5 });
    expect(state.blocks["roman-b3"]!.position).toEqual({ x: 3, y: 6 });
  });

  it("42. ignores routine casualties until a formation crosses a model-count breakpoint", () => {
    const state = blankState();
    const positions = Array.from({ length: 15 }, (_, index) => ({ x: 1 + index % 5, y: 1 + Math.floor(index / 5) }));
    addFormation(state, "warband", positions, "south", "saxon");
    damageBlock(state, "warband-b1", 3, "test");
    expect(state.formations.warband!.cohesion).toBe(8);
  });

  it("42b. applies morale shocks once at 75 and 50 percent of the starting models and routs at 25", () => {
    const state = blankState();
    addFormation(state, "century", Array.from({ length: 9 }, (_, index) => ({ x: index % 3, y: Math.floor(index / 3) })), "north");

    damageBlock(state, "century-b1", 9, "test");
    damageBlock(state, "century-b2", 9, "test");
    expect(state.formations.century!.cohesion).toBe(8);
    damageBlock(state, "century-b3", 3, "test");
    expect(state.formations.century!.cohesion).toBe(6);
    expect(state.formations.century!.casualtyMoraleStage).toBe(1);

    damageBlock(state, "century-b3", 6, "test");
    damageBlock(state, "century-b4", 9, "test");
    damageBlock(state, "century-b5", 6, "test");
    expect(state.formations.century!.cohesion).toBe(4);
    expect(state.formations.century!.casualtyMoraleStage).toBe(2);

    damageBlock(state, "century-b5", 3, "test");
    damageBlock(state, "century-b6", 9, "test");
    damageBlock(state, "century-b7", 9, "test");
    expect(state.formations.century!.cohesion).toBe(0);
    expect(state.formations.century!.status).toBe("routed");
    expect(state.eventLog.filter((event) => event.type === "morale_shock")).toHaveLength(3);
  });

  it("42c. lets a healthy century absorb four normal exchanges before its first morale loss", () => {
    const state = blankState();
    addFormation(state, "century", Array.from({ length: 9 }, (_, index) => ({ x: index % 3, y: Math.floor(index / 3) })), "north");
    for (const blockId of ["century-b1", "century-b2", "century-b3", "century-b4"]) {
      damageBlock(state, blockId, 4, "even melee exchange");
    }
    expect(state.formations.century!.cohesion).toBe(8);
    expect(Object.values(state.blocks).reduce((total, block) => total + block.models, 0)).toBe(65);
  });

  it("42d. caps flank and outnumbering morale shocks at once per round", () => {
    const state = blankState();
    addFormation(state, "target", [{ x: 1, y: 1 }, { x: 1, y: 2 }], "north");
    addFormation(state, "enemy", [{ x: 3, y: 1 }, { x: 3, y: 2 }, { x: 3, y: 3 }, { x: 3, y: 4 }], "west", "saxon");

    applyTacticalMoraleShock(state, "target", ["enemy"], "side");
    expect(state.formations.target!.cohesion).toBe(5);
    applyTacticalMoraleShock(state, "target", ["enemy"], "rear");
    expect(state.formations.target!.cohesion).toBe(5);

    state.round += 1;
    applyTacticalMoraleShock(state, "target", ["enemy"], "front");
    expect(state.formations.target!.cohesion).toBe(4);
  });

  it("42e. keeps matched healthy infantry close after four full melee rounds", () => {
    const state = blankState();
    const roman = addFormation(state, "roman", [
      { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 },
      { x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 },
      { x: 2, y: 6 }, { x: 3, y: 6 }, { x: 4, y: 6 },
    ], "north", "roman");
    const saxon = addFormation(state, "saxon", [
      { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 },
      { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 },
      { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 },
    ], "south", "saxon");
    saxon.unit.armour = 1;

    for (let round = 1; round <= 4; round += 1) {
      state.round = round;
      resolveEngagedOrder(state, roman.id, "battle");
      resolveEngagedOrder(state, saxon.id, "battle");
    }

    expect(Math.abs(roman.cohesion - saxon.cohesion)).toBeLessThanOrEqual(1);
    expect(roman.cohesion).toBeGreaterThanOrEqual(4);
    expect(saxon.cohesion).toBeGreaterThanOrEqual(4);
    expect(roman.blockIds.reduce((total, id) => total + (state.blocks[id]?.models ?? 0), 0)).toBeGreaterThan(20);
    expect(saxon.blockIds.reduce((total, id) => total + (state.blocks[id]?.models ?? 0), 0)).toBeGreaterThan(20);
  });

  it("42f. makes every block waver once its formation reaches breaking morale", () => {
    const state = blankState();
    addFormation(state, "roman", [{ x: 2, y: 2 }, { x: 2, y: 3 }], "north");
    state.formations.roman!.cohesion = 4;
    expect(blockIsWavering(state, "roman-b1")).toBe(false);
    state.formations.roman!.cohesion = 3;
    expect(blockIsWavering(state, "roman-b1")).toBe(true);
    expect(blockIsWavering(state, "roman-b2")).toBe(true);
  });

  it("43. lets a large formed unit waver before it fragments", () => {
    const state = blankState();
    addFormation(state, "warband", [
      { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 },
      { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 1, y: 3 },
      { x: 6, y: 5 }, { x: 6, y: 6 },
    ], "south", "saxon");
    expect(recalculateFormationConnectivity(state, "warband")).toEqual(["warband"]);
    expect(Object.keys(state.formations)).toEqual(["warband"]);
    expect(blockIsWavering(state, "warband-b8")).toBe(true);
    expect(blockIsWavering(state, "warband-b9")).toBe(true);
    expect(state.eventLog.some((event) => event.type === "formation_wavered")).toBe(true);

    state.formations.warband!.cohesion = 3;
    expect(recalculateFormationConnectivity(state, "warband")).toHaveLength(2);
    expect(Object.keys(state.formations)).toHaveLength(2);
    expect(state.eventLog.some((event) => event.type === "formation_split")).toBe(true);
  });

  it("44. clusters a seven-way breakup into no more than three original-unit groups", () => {
    const state = blankState();
    addFormation(state, "warband", [
      { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }, { x: 6, y: 0 },
      { x: 0, y: 2 }, { x: 2, y: 2 }, { x: 4, y: 2 },
    ], "south", "saxon");
    const groups = recalculateFormationConnectivity(state, "warband", true);
    expect(groups).toHaveLength(3);
    expect(Object.keys(state.formations)).toHaveLength(3);
    expect(groups.every((id) => originalFormationId(id) === "warband")).toBe(true);

    for (const id of [...groups]) recalculateFormationConnectivity(state, id, true);
    expect(Object.keys(state.formations)).toHaveLength(3);
  });

  it("45. automatically merges touching groups from the same original formation", () => {
    const state = blankState();
    addFormation(state, "warband", [{ x: 2, y: 2 }], "south", "saxon").provisionalFamilyId = "warband";
    const fragment = addFormation(state, "warband-fragment-1", [{ x: 3, y: 2 }], "south", "saxon");
    fragment.status = "fragment";
    fragment.provisionalFamilyId = "warband";
    expect(automaticallyMergeTouchingOriginalUnits(state)).toEqual(["warband"]);
    expect(Object.keys(state.formations)).toEqual(["warband"]);
    expect(state.formations.warband!.blockIds).toHaveLength(2);
    expect(state.eventLog.some((event) => event.type === "formation_merged")).toBe(true);
  });

  it("46. moves an activated fragment toward its original unit and merges on contact", () => {
    const state = blankState();
    addFormation(state, "warband", [{ x: 1, y: 2 }], "south", "saxon").provisionalFamilyId = "warband";
    const fragment = addFormation(state, "warband-fragment-1", [{ x: 3, y: 2 }], "south", "saxon");
    fragment.status = "fragment";
    fragment.provisionalFamilyId = "warband";
    expect(moveFragmentTowardOriginalUnit(state, "warband-fragment-1")).toBe(true);
    expect(state.blocks["warband-fragment-1-b1"]!.position).toEqual({ x: 2, y: 2 });

    resolveEndActivationRegrouping(state, "warband-fragment-1");
    expect(Object.keys(state.formations)).toEqual(["warband"]);
    expect(state.formations.warband!.blockIds).toHaveLength(2);
    expect(state.formations.warband!.provisionalFamilyId).toBeNull();
  });

  it("47. makes every engaged provisional group fight in the same order", () => {
    const state = blankState();
    addFormation(state, "warband", [{ x: 2, y: 2 }], "south", "saxon").provisionalFamilyId = "warband";
    const fragment = addFormation(state, "warband-fragment-1", [{ x: 4, y: 2 }], "south", "saxon");
    fragment.status = "fragment";
    fragment.provisionalFamilyId = "warband";
    addFormation(state, "roman-left", [{ x: 2, y: 3 }], "north", "roman");
    addFormation(state, "roman-right", [{ x: 4, y: 3 }], "north", "roman");

    expect(resolveEngagedOrder(state, "warband", "battle")).toBe(2);
    expect(state.blocks["roman-left-b1"]!.models).toBeLessThan(9);
    expect(state.blocks["roman-right-b1"]!.models).toBeLessThan(9);
    expect(state.eventLog).toContainEqual(expect.objectContaining({
      type: "engaged_order_resolved",
      formationIds: ["warband", "warband-fragment-1"],
    }));
  });

  it("48. counts a provisional family as one activation and reunites it after the shared attack", () => {
    const state = blankState();
    state.activeFactionId = "saxon";
    addFormation(state, "warband", [{ x: 1, y: 2 }], "south", "saxon").provisionalFamilyId = "warband";
    const fragment = addFormation(state, "warband-fragment-1", [{ x: 3, y: 2 }], "south", "saxon");
    fragment.status = "fragment";
    fragment.provisionalFamilyId = "warband";
    addFormation(state, "roman", [{ x: 6, y: 6 }], "north", "roman");

    expect(remainingActivations(state, "saxon")).toBe(1);
    expect(canSelectFormation(state, "warband")).toBe(true);
    expect(canSelectFormation(state, "warband-fragment-1")).toBe(true);
    endFormationActivation(state, "warband");
    expect(Object.keys(state.formations).filter((id) => id.startsWith("warband"))).toEqual(["warband"]);
    expect(state.formations.warband!.hasActivated).toBe(true);
    expect(remainingActivations(state, "saxon")).toBe(0);
  });

  it("49. confirms substantial independent fragments only after two shared regroup attempts fail", () => {
    const state = blankState();
    state.activeFactionId = "saxon";
    addFormation(state, "warband", [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }], "south", "saxon").provisionalFamilyId = "warband";
    const fragment = addFormation(state, "warband-fragment-1", [{ x: 7, y: 1 }, { x: 7, y: 2 }, { x: 7, y: 3 }], "south", "saxon");
    fragment.status = "fragment";
    fragment.provisionalFamilyId = "warband";
    addFormation(state, "roman", [{ x: 6, y: 6 }], "north", "roman");

    endFormationActivation(state, "warband");
    expect(state.formations.warband!.provisionalFamilyId).toBe("warband");
    expect(state.formations.warband!.failedRegroupActivations).toBe(1);
    expect(state.eventLog.some((event) => event.type === "formation_split_confirmed")).toBe(false);
    expect(remainingActivations(state, "saxon")).toBe(0);

    endFormationActivation(state, "roman");
    expect(state.round).toBe(2);
    expect(remainingActivations(state, "saxon")).toBe(1);

    endFormationActivation(state, "warband");
    expect(state.formations.warband!.provisionalFamilyId).toBeNull();
    expect(state.formations["warband-fragment-1"]!.provisionalFamilyId).toBeNull();
    expect(state.eventLog.some((event) => event.type === "formation_split_confirmed")).toBe(true);
    expect(remainingActivations(state, "saxon")).toBe(0);
  });

  it("49b. keeps one- and two-block stragglers attached to the shared activation", () => {
    const state = blankState();
    addFormation(state, "warband", [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }], "south", "saxon").provisionalFamilyId = "warband";
    const stragglers = addFormation(state, "warband-fragment-1", [{ x: 7, y: 1 }, { x: 7, y: 2 }], "south", "saxon");
    stragglers.status = "fragment";
    stragglers.provisionalFamilyId = "warband";

    resolveEndActivationRegrouping(state, "warband");
    resolveEndActivationRegrouping(state, "warband");
    resolveEndActivationRegrouping(state, "warband");

    expect(state.formations.warband!.provisionalFamilyId).toBe("warband");
    expect(state.formations["warband-fragment-1"]!.provisionalFamilyId).toBe("warband");
    expect(state.formations.warband!.hasActivated).toBe(true);
    expect(state.formations["warband-fragment-1"]!.hasActivated).toBe(true);
    expect(state.eventLog.some((event) => event.type === "formation_split_confirmed")).toBe(false);
    expect(remainingActivations(state, "saxon")).toBe(0);
  });

  it("49c. translates every body in a provisional family with one move order", () => {
    const state = blankState();
    state.activeFactionId = "saxon";
    addFormation(state, "warband", [{ x: 1, y: 2 }], "south", "saxon").provisionalFamilyId = "warband";
    const fragment = addFormation(state, "warband-fragment-1", [{ x: 4, y: 2 }], "south", "saxon");
    fragment.status = "fragment";
    fragment.provisionalFamilyId = "warband";

    expect(translateFormation(state, "warband", "north").ok).toBe(true);
    expect(state.blocks["warband-b1"]!.position).toEqual({ x: 1, y: 1 });
    expect(state.blocks["warband-fragment-1-b1"]!.position).toEqual({ x: 4, y: 1 });
    expect(state.eventLog.at(-1)).toEqual(expect.objectContaining({
      type: "formation_moved",
      formationIds: ["warband", "warband-fragment-1"],
    }));
  });

  it("49d. collapses automatic regrouping into one log event", () => {
    const state = blankState();
    addFormation(state, "warband", [{ x: 2, y: 2 }], "south", "saxon").provisionalFamilyId = "warband";
    const fragment = addFormation(state, "warband-fragment-1", [{ x: 3, y: 2 }], "south", "saxon");
    fragment.status = "fragment";
    fragment.provisionalFamilyId = "warband";

    automaticallyMergeTouchingOriginalUnits(state);

    expect(state.eventLog.filter((event) => event.type === "formation_merged")).toHaveLength(1);
    expect(state.eventLog.at(-1)?.message).toContain("regrouped from 2 bodies into 1");
  });

  it("50. clears a provisional breakup when only one group survives", () => {
    const state = blankState();
    const survivor = addFormation(state, "warband", [{ x: 2, y: 2 }], "south", "saxon");
    survivor.provisionalFamilyId = "warband";
    resolveEndActivationRegrouping(state, "warband");
    expect(survivor.provisionalFamilyId).toBeNull();
    expect(survivor.status).toBe("formed");
    expect(state.eventLog.some((event) => event.type === "formation_split_confirmed")).toBe(false);
  });

  it("51. gives a contacted defender one damaging counterattack", () => {
    const state = blankState();
    addFormation(state, "roman", [{ x: 3, y: 4 }], "north", "roman");
    addFormation(state, "saxon", [{ x: 3, y: 3 }], "south", "saxon");

    expect(resolveEngagedOrder(state, "roman", "battle")).toBe(1);
    expect(state.blocks["roman-b1"]!.models).toBeLessThan(9);
    expect(state.eventLog).toContainEqual(expect.objectContaining({
      type: "counterattack_resolved",
      blockIds: ["saxon-b1", "roman-b1"],
    }));
  });

  it("52. resolves a counterattack even when the defender is destroyed", () => {
    const state = blankState();
    addFormation(state, "roman", [{ x: 3, y: 4 }], "north", "roman");
    addFormation(state, "saxon", [{ x: 3, y: 3 }], "south", "saxon");
    state.blocks["roman-b1"]!.models = 1;
    state.blocks["saxon-b1"]!.models = 2;

    expect(resolveEngagedOrder(state, "roman", "battle")).toBe(1);
    expect(state.blocks["roman-b1"]).toBeUndefined();
    expect(state.blocks["saxon-b1"]).toBeUndefined();
    expect(state.eventLog.filter((event) => event.type === "block_destroyed")).toHaveLength(2);
  });

  it("53. allows each defending block only one counterattack per enemy order", () => {
    const state = blankState();
    addFormation(state, "roman", [{ x: 3, y: 4 }, { x: 4, y: 3 }, { x: 4, y: 4 }], "north", "roman");
    addFormation(state, "saxon", [{ x: 3, y: 3 }], "south", "saxon");
    attachCharacter(state, "resistance-test", "saxon-b1", "saxon", "commander", { resistanceBonus: 99 });

    expect(resolveEngagedOrder(state, "roman", "battle")).toBe(2);
    expect(state.formations.roman!.blockIds.reduce((total, id) => total + state.blocks[id]!.models, 0)).toBeLessThan(27);
    expect(state.eventLog.filter((event) => event.type === "counterattack_resolved")).toHaveLength(1);
  });

  it("54. flows soldiers from a steady rear block into the damaged head of the formation", () => {
    const state = blankState();
    addFormation(state, "roman", [{ x: 3, y: 2 }, { x: 3, y: 3 }], "north", "roman");
    addFormation(state, "saxon", [{ x: 3, y: 1 }], "south", "saxon");
    state.blocks["roman-b1"]!.models = 4;
    state.blocks["roman-b2"]!.models = 5;

    refillFormationFront(state, "roman");

    expect(state.blocks["roman-b1"]!.models).toBe(9);
    expect(state.blocks["roman-b2"]).toBeUndefined();
    expect(state.formations.roman!.blockIds).toEqual(["roman-b1"]);
    expect(state.eventLog.some((event) => event.type === "block_destroyed")).toBe(false);
    expect(state.eventLog).toContainEqual(expect.objectContaining({
      type: "engagement_closed",
      blockIds: expect.arrayContaining(["roman-b1", "roman-b2"]),
    }));
  });

  it("55. leaves a front shortage in place when the rear donor is wavering", () => {
    const state = blankState();
    addFormation(state, "roman", [{ x: 3, y: 2 }, { x: 3, y: 4 }], "north", "roman");
    addFormation(state, "saxon", [{ x: 3, y: 1 }], "south", "saxon");
    state.blocks["roman-b1"]!.models = 4;
    state.blocks["roman-b2"]!.models = 5;
    state.blocks["roman-b2"]!.wavering = true;

    refillFormationFront(state, "roman");

    expect(state.blocks["roman-b1"]!.models).toBe(4);
    expect(state.blocks["roman-b2"]!.models).toBe(5);
    expect(state.blocks["roman-b2"]!.position).toEqual({ x: 3, y: 4 });
  });

  it("56. cascades steady rear blocks forward to remove an internal gap", () => {
    const state = blankState();
    addFormation(state, "roman", [{ x: 3, y: 2 }, { x: 3, y: 4 }, { x: 3, y: 5 }], "north", "roman");
    addFormation(state, "saxon", [{ x: 3, y: 1 }], "south", "saxon");

    expect(closeEngagementGaps(state, "roman")).toEqual(["roman-b2", "roman-b3"]);
    expect(state.blocks["roman-b1"]!.position).toEqual({ x: 3, y: 2 });
    expect(state.blocks["roman-b2"]!.position).toEqual({ x: 3, y: 3 });
    expect(state.blocks["roman-b3"]!.position).toEqual({ x: 3, y: 4 });
  });

  it("57. lets Battle fill an internal gap without expanding the formation footprint", () => {
    const state = blankState();
    state.activeFactionId = "saxon";
    addFormation(state, "roman", [{ x: 3, y: 3 }], "north", "roman");
    addFormation(state, "saxon", [
      { x: 3, y: 4 }, { x: 4, y: 4 }, { x: 5, y: 4 }, { x: 5, y: 3 },
    ], "north", "saxon");
    state.formations.saxon!.status = "formed";
    state.formations.saxon!.cohesion = 8;
    state.formations.saxon!.unit.attack = 0;
    state.formations.saxon!.formationMode = "open";
    state.formations.saxon!.unit.unitType = "light_infantry";
    state.formations.roman!.unit.attack = 0;
    attachCharacter(state, "resistance-test", "roman-b1", "roman", "commander", { resistanceBonus: 99 });

    expect(resolveEngagedOrder(state, "saxon", "battle")).toBe(2);

    expect(state.blocks["saxon-b4"]!.position).toEqual({ x: 4, y: 3 });
    expect(meleeDamagePreview(state, "saxon-b4", "roman-b1")!.contactEdge).toBe("side");
    expect(state.eventLog).toContainEqual(expect.objectContaining({
      type: "engagement_closed",
      message: expect.stringContaining("internal formation gap"),
    }));
  });

  it("58. refills a damaged formation from its rear when its faction becomes active", () => {
    const state = blankState();
    state.activeFactionId = "saxon";
    addFormation(state, "roman", [{ x: 3, y: 2 }, { x: 3, y: 3 }], "north", "roman");
    addFormation(state, "saxon", [{ x: 3, y: 1 }], "south", "saxon");
    state.blocks["roman-b1"]!.models = 4;
    state.blocks["roman-b2"]!.models = 5;

    endFormationActivation(state, "saxon");

    expect(state.activeFactionId).toBe("roman");
    expect(state.blocks["roman-b1"]!.models).toBe(9);
    expect(state.blocks["roman-b2"]).toBeUndefined();
    expect(state.formations.roman!.blockIds).toEqual(["roman-b1"]);
    expect(state.eventLog).toContainEqual(expect.objectContaining({
      type: "engagement_closed",
      formationIds: ["roman"],
    }));
  });

  it("59. waits until the engaged order ends before rear soldiers refill the front", () => {
    const state = blankState();
    addFormation(state, "roman", [{ x: 3, y: 4 }, { x: 3, y: 5 }], "north", "roman");
    addFormation(state, "saxon", [{ x: 3, y: 3 }], "south", "saxon");
    state.blocks["roman-b1"]!.models = 4;
    state.blocks["roman-b2"]!.models = 5;
    state.formations.roman!.formationMode = "open";
    state.formations.roman!.unit.unitType = "light_infantry";
    state.formations.saxon!.unit.attack = 0;
    attachCharacter(state, "resistance-test", "saxon-b1", "saxon", "commander", { resistanceBonus: 99 });

    expect(executeCommand(state, { type: "select_cell", position: { x: 3, y: 4 } }).accepted).toBe(true);
    expect(state.blocks["roman-b1"]!.models).toBe(4);
    expect(state.blocks["roman-b2"]!.models).toBe(5);

    expect(executeCommand(state, { type: "battle" }, { confirmed: true }).accepted).toBe(true);
    expect(state.blocks["roman-b1"]!.models).toBe(9);
    expect(state.blocks["roman-b2"]).toBeUndefined();
  });

  it("60b. reorders the wide Saxon formation into three files through the ford", () => {
    const state = createPrototypeGridScenario();
    const planned = planFormationMove(state, "great-warband", "south");
    expect(planned.ok).toBe(true);
    expect(planned.plan).toMatchObject({ reordered: true, movementCosts: { "great-warband": 2 } });
    expect(new Set(planned.plan!.relocations.map((relocation) => `${relocation.destination.x},${relocation.destination.y}`)))
      .toEqual(new Set(Array.from({ length: 5 }, (_, row) => [2, 3, 4].map((x) => `${x},${4 + row}`)).flat()));

    expect(translateFormation(state, "great-warband", "south")).toEqual({
      ok: false, reason: "This formation-changing move must be previewed and confirmed.",
    });
    expect(translateFormation(state, "great-warband", "south", true).ok).toBe(true);
    expect(state.formations["great-warband"]!.blockIds.every((id) => {
      const { x, y } = state.blocks[id]!.position;
      return x >= 2 && x <= 4 && y >= 4 && y <= 8;
    })).toBe(true);
  });

  it("61. leaves one soldier behind when a full infantry block enters a small-tree cell", () => {
    const state = blankState();
    addFormation(state, "roman", [{ x: 3, y: 4 }], "north", "roman");
    addMapTerrainObject(state.battlefield, { x: 3, y: 3 }, "tree_small");

    expect(translateFormation(state, "roman", "north").ok).toBe(false);
    expect(translateFormation(state, "roman", "north", true).ok).toBe(true);

    expect(state.blocks["roman-b1"]!.position).toEqual({ x: 3, y: 3 });
    expect(state.blocks["roman-b1"]!.models).toBe(8);
    expect(state.blocks["roman-b1-overflow-1"]!.position).toEqual({ x: 3, y: 4 });
    expect(state.blocks["roman-b1-overflow-1"]!.models).toBe(1);
    expect(state.formations.roman!.movementRemaining).toBe(3);
  });

  it("62. leaves four soldiers behind when a full infantry block enters a large-tree cell", () => {
    const state = blankState();
    addFormation(state, "roman", [{ x: 3, y: 4 }], "north", "roman");
    addMapTerrainObject(state.battlefield, { x: 3, y: 3 }, "tree_large");

    expect(translateFormation(state, "roman", "north").ok).toBe(false);
    expect(translateFormation(state, "roman", "north", true).ok).toBe(true);

    expect(state.blocks["roman-b1"]!.models).toBe(5);
    expect(state.blocks["roman-b1-overflow-1"]!.models).toBe(4);
    expect(state.eventLog).toContainEqual(expect.objectContaining({ type: "terrain_overflow" }));
  });

  it("62a. completely blocks a tile filled by two large trees and one small tree", () => {
    const state = blankState();
    addFormation(state, "roman", [{ x: 3, y: 4 }], "north", "roman");
    addMapTerrainObject(state.battlefield, { x: 3, y: 3 }, "tree_large");
    addMapTerrainObject(state.battlefield, { x: 3, y: 3 }, "tree_large");
    addMapTerrainObject(state.battlefield, { x: 3, y: 3 }, "tree_small");

    expect(terrainBlockCapacityAt(state, { x: 3, y: 3 }, 9)).toBe(0);
    expect(translateFormation(state, "roman", "north").ok).toBe(false);
  });

  it("62a-2. completely blocks a mixed stack that fills all nine spaces", () => {
    const state = blankState();
    addFormation(state, "roman", [{ x: 3, y: 4 }], "north", "roman");
    addMapTerrainObject(state.battlefield, { x: 3, y: 3 }, "pond");
    addMapTerrainObject(state.battlefield, { x: 3, y: 3 }, "rock_large");
    addMapTerrainObject(state.battlefield, { x: 3, y: 3 }, "tree_small");

    expect(terrainBlockCapacityAt(state, { x: 3, y: 3 }, 9)).toBe(0);
    expect(translateFormation(state, "roman", "north").ok).toBe(false);
  });

  it("62b. lets a five-soldier loose block rearrange around a large tree without splitting", () => {
    const state = blankState();
    addFormation(state, "scouts", [{ x: 3, y: 4 }], "north", "roman");
    const block = state.blocks["scouts-b1"]!;
    state.formations.scouts!.unit.unitType = "light_infantry";
    state.formations.scouts!.formationMode = "open";
    block.models = 5;
    block.modelCapacity = 5;
    state.formations.scouts!.initialModelCount = 5;
    addMapTerrainObject(state.battlefield, { x: 3, y: 3 }, "tree_large");

    expect(translateFormation(state, "scouts", "north").ok).toBe(true);

    expect(block.position).toEqual({ x: 3, y: 3 });
    expect(block.models).toBe(5);
    expect(Object.keys(state.blocks)).toEqual(["scouts-b1"]);
    expect(state.eventLog).not.toContainEqual(expect.objectContaining({ type: "terrain_overflow" }));
  });

  it("62c. creates terrain overflow when closing an engagement gap through trees", () => {
    const state = blankState();
    addFormation(state, "roman", [{ x: 3, y: 3 }, { x: 5, y: 3 }, { x: 4, y: 4 }], "north", "roman");
    addFormation(state, "saxon", [{ x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 }], "south", "saxon");
    addMapTerrainObject(state.battlefield, { x: 4, y: 3 }, "tree_large");

    expect(closeEngagementGaps(state, "roman")).toContain("roman-b3");

    expect(state.blocks["roman-b3"]!).toMatchObject({ position: { x: 4, y: 3 }, models: 5 });
    expect(state.blocks["roman-b3-overflow-1"]!).toMatchObject({ position: { x: 4, y: 4 }, models: 4 });
  });

  it("62d. creates terrain overflow during a one-block Reform", () => {
    const state = blankState();
    addFormation(state, "roman", [{ x: 2, y: 3 }, { x: 4, y: 3 }], "north", "roman");
    addMapTerrainObject(state.battlefield, { x: 3, y: 3 }, "tree_large");

    expect(reformBlock(state, "roman-b1", { x: 3, y: 3 })).toBe(true);

    expect(state.blocks["roman-b1"]!).toMatchObject({ position: { x: 3, y: 3 }, models: 5 });
    expect(state.blocks["roman-b1-overflow-1"]!).toMatchObject({ position: { x: 2, y: 3 }, models: 4 });
  });

  it("62e. creates terrain overflow while a fragment automatically regroups", () => {
    const state = blankState();
    addFormation(state, "warband", [{ x: 1, y: 2 }], "south", "saxon").provisionalFamilyId = "warband";
    const fragment = addFormation(state, "warband-fragment-1", [{ x: 3, y: 2 }], "south", "saxon");
    fragment.status = "fragment";
    fragment.provisionalFamilyId = "warband";
    addMapTerrainObject(state.battlefield, { x: 2, y: 2 }, "tree_large");

    expect(moveFragmentTowardOriginalUnit(state, fragment.id)).toBe(true);

    expect(state.blocks["warband-fragment-1-b1"]!).toMatchObject({ position: { x: 2, y: 2 }, models: 5 });
    expect(state.blocks["warband-fragment-1-b1-overflow-1"]!).toMatchObject({ position: { x: 3, y: 2 }, models: 4 });
  });

  it("63. makes shallow water cost two movement and add one incoming casualty", () => {
    const dry = blankState();
    addFormation(dry, "roman", [{ x: 3, y: 4 }], "north", "roman");
    addFormation(dry, "saxon", [{ x: 3, y: 3 }], "south", "saxon");
    dry.formations.saxon!.unit.equipment = [];
    dry.formations.saxon!.unit.armour = 0;
    const shallow = structuredClone(dry);
    setMapTerrain(shallow.battlefield, { x: 3, y: 3 }, "river_shallow");

    expect(meleeDamagePreview(shallow, "roman-b1", "saxon-b1")!.expectedCasualties)
      .toBe(meleeDamagePreview(dry, "roman-b1", "saxon-b1")!.expectedCasualties + 1);

    const movement = blankState();
    addFormation(movement, "roman", [{ x: 3, y: 4 }], "north", "roman");
    setMapTerrain(movement.battlefield, { x: 3, y: 3 }, "river_shallow");
    expect(translateFormation(movement, "roman", "north").ok).toBe(true);
    expect(movement.formations.roman!.movementRemaining).toBe(2);
  });

  it("63a. makes dangerous open ground rougher and more damaging regardless of texture", () => {
    const dry = blankState();
    addFormation(dry, "roman", [{ x: 3, y: 4 }], "north", "roman");
    addFormation(dry, "saxon", [{ x: 3, y: 3 }], "south", "saxon");
    dry.formations.saxon!.unit.equipment = [];
    dry.formations.saxon!.unit.armour = 0;
    const dangerous = structuredClone(dry);
    setMapTerrain(dangerous.battlefield, { x: 3, y: 3 }, "dangerous");

    expect(defendingResistance(dangerous, "saxon-b1", "south"))
      .toBe(defendingResistance(dry, "saxon-b1", "south") - 1);
    expect(meleeDamagePreview(dangerous, "roman-b1", "saxon-b1")!.expectedCasualties)
      .toBe(meleeDamagePreview(dry, "roman-b1", "saxon-b1")!.expectedCasualties + 1);

    const movement = blankState();
    addFormation(movement, "roman", [{ x: 3, y: 4 }], "north", "roman");
    setMapTerrain(movement.battlefield, { x: 3, y: 3 }, "dangerous");
    expect(translateFormation(movement, "roman", "north").ok).toBe(true);
    expect(movement.formations.roman!.movementRemaining).toBe(2);
  });

  it("64. blocks voluntary entry into deep water but drowns a block forced into it", () => {
    const movement = blankState();
    addFormation(movement, "roman", [{ x: 3, y: 4 }], "north", "roman");
    setMapTerrain(movement.battlefield, { x: 3, y: 3 }, "river_deep");
    expect(translateFormation(movement, "roman", "north").ok).toBe(false);

    const retreat = blankState();
    addFormation(retreat, "saxon", [{ x: 3, y: 3 }], "south", "saxon");
    setMapTerrain(retreat.battlefield, { x: 3, y: 2 }, "river_deep");
    expect(retreatBlock(retreat, "saxon-b1", "north")).toBe("destroyed");
    expect(retreat.blocks["saxon-b1"]).toBeUndefined();
    expect(retreat.eventLog).toContainEqual(expect.objectContaining({ type: "block_drowned" }));
  });

  it("64b. allows one-level climbs and drops but blocks larger voluntary elevation changes", () => {
    const blocked = blankState();
    addFormation(blocked, "roman", [{ x: 3, y: 3 }], "north", "roman");
    setMapElevation(blocked.battlefield, { x: 3, y: 2 }, 2);
    expect(translateFormation(blocked, "roman", "north").ok).toBe(false);

    const uphill = blankState();
    addFormation(uphill, "roman", [{ x: 3, y: 3 }], "north", "roman");
    setMapElevation(uphill.battlefield, { x: 3, y: 2 }, 1);
    expect(translateFormation(uphill, "roman", "north").ok).toBe(true);

    const downhill = blankState();
    addFormation(downhill, "roman", [{ x: 3, y: 2 }], "south", "roman");
    setMapElevation(downhill.battlefield, { x: 3, y: 2 }, 1);
    expect(translateFormation(downhill, "roman", "south").ok).toBe(true);

    const forcedUphill = blankState();
    addFormation(forcedUphill, "defender", [{ x: 3, y: 3 }], "south", "saxon");
    setMapElevation(forcedUphill.battlefield, { x: 3, y: 2 }, 1);
    expect(retreatBlock(forcedUphill, "defender-b1", "north")).toBe("retreated");

    const forcedDownhill = blankState();
    setMapElevation(forcedDownhill.battlefield, { x: 3, y: 3 }, 1);
    addFormation(forcedDownhill, "defender", [{ x: 3, y: 3 }], "south", "saxon");
    expect(retreatBlock(forcedDownhill, "defender-b1", "north")).toBe("retreated");
  });

  it("64c. makes lethal retreat hazards resist pressure and destroys blocks forced across large cliffs", () => {
    const safe = blankState();
    addFormation(safe, "defender", [{ x: 3, y: 3 }], "south", "saxon");
    const baseResistance = defendingResistance(safe, "defender-b1", "south");
    const deepWater = structuredClone(safe);
    setMapTerrain(deepWater.battlefield, { x: 3, y: 2 }, "river_deep");
    expect(defendingResistance(deepWater, "defender-b1", "south")).toBe(baseResistance + 3);

    const cliff = structuredClone(safe);
    setMapElevation(cliff.battlefield, { x: 3, y: 2 }, 2);
    expect(defendingResistance(cliff, "defender-b1", "south")).toBe(baseResistance + 3);
    addFormation(cliff, "attacker", [{ x: 3, y: 4 }], "north", "roman");
    expect(pressurePreview(cliff, "attacker-b1", "defender-b1", { pressureBonus: 20 })).toMatchObject({
      retreatHazard: "cliff",
    });

    const retreat = structuredClone(safe);
    setMapElevation(retreat.battlefield, { x: 3, y: 2 }, 2);
    expect(translateFormation(retreat, "defender", "north").ok).toBe(false);
    expect(retreatBlock(retreat, "defender-b1", "north")).toBe("destroyed");
    expect(retreat.blocks["defender-b1"]).toBeUndefined();
    expect(retreat.eventLog).toContainEqual(expect.objectContaining({ type: "block_fell" }));

    const fall = blankState();
    setMapElevation(fall.battlefield, { x: 3, y: 3 }, 2);
    addFormation(fall, "defender", [{ x: 3, y: 3 }], "south", "saxon");
    expect(retreatBlock(fall, "defender-b1", "north")).toBe("destroyed");
    expect(fall.eventLog).toContainEqual(expect.objectContaining({ type: "block_fell" }));

    const cascade = blankState();
    addFormation(cascade, "defender", [{ x: 3, y: 3 }, { x: 3, y: 2 }], "south", "saxon");
    setMapElevation(cascade.battlefield, { x: 3, y: 1 }, 2);
    expect(retreatBlock(cascade, "defender-b1", "north")).toBe("cascade");
    expect(cascade.blocks["defender-b1"]?.position).toEqual({ x: 3, y: 2 });
    expect(cascade.blocks["defender-b2"]).toBeUndefined();
    expect(cascade.eventLog).toContainEqual(expect.objectContaining({
      type: "block_fell",
      blockIds: ["defender-b2"],
    }));
  });

  it("65. requires buildings to occupy at least four squares", () => {
    const state = blankState();
    expect(() => placeBuilding(state, {
      id: "shed", origin: { x: 2, y: 2 }, width: 3, depth: 1,
    })).toThrow("at least four grid squares");
    expect(() => placeBuilding(state, {
      id: "hall", origin: { x: 2, y: 2 }, width: 2, depth: 2,
    })).not.toThrow();
    expect(Object.keys(state.battlefield.buildingCells)).toHaveLength(4);
    expect(buildingCellAt(state, { x: 2, y: 3 })?.walls).toEqual(["south", "west"]);
  });

  it("66. makes every square in a building footprint solid", () => {
    const state = blankState();
    placeBuilding(state, {
      id: "hall", origin: { x: 3, y: 2 }, width: 2, depth: 2,
    });
    addFormation(state, "roman", [{ x: 2, y: 3 }], "east", "roman");

    expect(translateFormation(state, "roman", "east").ok).toBe(false);
    expect(translateFormation(state, "roman", "east", true).ok).toBe(false);
    expect(terrainBlockCapacityAt(state, { x: 3, y: 3 }, 9)).toBe(0);
  });

  it("66a. lets blocks move and fight along fortress walls but treats their sides as cliffs", () => {
    const top = blankState();
    setMapTerrain(top.battlefield, { x: 3, y: 3 }, "fortress_wall");
    setMapTerrain(top.battlefield, { x: 4, y: 3 }, "fortress_wall");
    addFormation(top, "roman", [{ x: 3, y: 3 }], "east", "roman");
    expect(translateFormation(top, "roman", "east").ok).toBe(true);
    expect(terrainElevationAt(top, { x: 4, y: 3 })).toBe(2);

    const approach = blankState();
    setMapTerrain(approach.battlefield, { x: 3, y: 3 }, "fortress_wall");
    setMapElevation(approach.battlefield, { x: 2, y: 3 }, 1);
    addFormation(approach, "roman", [{ x: 2, y: 3 }], "east", "roman");
    expect(translateFormation(approach, "roman", "east").ok).toBe(true);

    const battle = blankState();
    setMapTerrain(battle.battlefield, { x: 3, y: 3 }, "fortress_wall");
    setMapTerrain(battle.battlefield, { x: 4, y: 3 }, "fortress_wall");
    addFormation(battle, "attack", [{ x: 3, y: 3 }], "east", "roman");
    addFormation(battle, "defend", [{ x: 4, y: 3 }], "west", "saxon");
    expect(() => resolvePressure(battle, "attack-b1", "defend-b1")).not.toThrow();

    const fall = blankState();
    setMapTerrain(fall.battlefield, { x: 3, y: 3 }, "fortress_wall");
    addFormation(fall, "defender", [{ x: 3, y: 3 }], "east", "saxon");
    expect(retreatBlock(fall, "defender-b1", "west")).toBe("destroyed");
    expect(fall.eventLog).toContainEqual(expect.objectContaining({ type: "block_fell" }));
  });

  it("66b. keeps edge features movement-neutral", () => {
    const state = blankState();
    setMapEdgeFeature(state.battlefield, { x: 3, y: 3 }, "east", "enclosed_tall");
    addFormation(state, "roman", [{ x: 3, y: 3 }], "east", "roman");
    expect(translateFormation(state, "roman", "east").ok).toBe(true);
  });

  it("67. charges half a movement point to traverse a road square", () => {
    const state = blankState();
    addFormation(state, "roman", [{ x: 3, y: 4 }], "north", "roman");
    setMapTerrain(state.battlefield, { x: 3, y: 3 }, "road");

    expect(terrainMovementCost("road")).toBe(0.5);
    expect(translateFormation(state, "roman", "north").ok).toBe(true);
    expect(state.formations.roman!.movementRemaining).toBe(3.5);
  });

  it("68. lets only close-order infantry brace and ends its activation", () => {
    const state = blankState();
    const closeInfantry = addFormation(state, "close", [{ x: 3, y: 4 }], "north", "roman");
    addFormation(state, "enemy", [{ x: 7, y: 1 }], "south", "saxon");
    closeInfantry.formationMode = "closed";
    state.selectedFormationId = closeInfantry.id;

    expect(executeCommand(state, { type: "brace" })).toEqual({ accepted: true });
    expect(closeInfantry).toMatchObject({ isBraced: true, hasActivated: true, movementRemaining: 0 });
    expect(state.eventLog).toContainEqual(expect.objectContaining({ type: "formation_braced" }));

    const openInfantry = addFormation(state, "open", [{ x: 5, y: 4 }], "north", "roman");
    openInfantry.formationMode = "open";
    state.selectedFormationId = openInfantry.id;
    expect(executeCommand(state, { type: "brace" })).toEqual({
      accepted: false,
      reason: "Only close-order infantry may brace.",
    });

    const cavalry = addFormation(state, "cavalry", [{ x: 6, y: 4 }], "north", "roman");
    cavalry.formationMode = "closed";
    cavalry.unit.unitType = "light_cavalry";
    state.selectedFormationId = cavalry.id;
    expect(executeCommand(state, { type: "brace" }).accepted).toBe(false);
  });

  it("69. gives a braced formation one guaranteed point of armour", () => {
    const state = blankState();
    addFormation(state, "attack", [{ x: 3, y: 4 }], "north", "roman");
    const defender = addFormation(state, "defend", [{ x: 3, y: 3 }], "south", "saxon");
    defender.formationMode = "closed";
    const normal = meleeDamagePreview(state, "attack-b1", "defend-b1")!;

    defender.isBraced = true;
    const braced = meleeDamagePreview(state, "attack-b1", "defend-b1")!;

    expect(braced.braceArmour).toBe(1);
    expect(braced.expectedCasualties).toBe(normal.expectedCasualties - 1);
  });

  it("70. removes the brace bonus the next time the formation moves", () => {
    const state = blankState();
    const formation = addFormation(state, "roman", [{ x: 3, y: 4 }], "north", "roman");
    formation.formationMode = "closed";
    formation.isBraced = true;

    expect(translateFormation(state, formation.id, "north").ok).toBe(true);
    expect(formation.isBraced).toBe(false);

    formation.isBraced = true;
    expect(retreatBlock(state, "roman-b1", "north")).toBe("retreated");
    expect(formation.isBraced).toBe(false);
  });

  it("71. moves characters to the middle of the new front rank after a pivot", () => {
    const state = blankState();
    const formation = addFormation(state, "roman", [
      { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 },
      { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 },
      { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 },
    ], "north", "roman");
    attachCharacter(state, "champion", "roman-b1", "roman", "champion");

    expect(finishFormationMove(state, formation.id, "east").ok).toBe(true);
    expect(state.characters.champion!.hostBlockId).toBe("roman-b6");
    expect(state.blocks["roman-b6"]!.characterId).toBe("champion");
    expect(state.blocks["roman-b1"]!.characterId).toBeNull();
  });
});
