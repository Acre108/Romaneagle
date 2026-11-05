import { describe, expect, it } from "vitest";
import { executeCommand, commandLegality } from "../gridBattle/commands/executeCommand";
import { planOrder } from "../gridBattle/commands/planOrder";
import { forceSplit } from "../gridBattle/rules/formationActions";
import {
  hasRangedLineOfSight,
  rangedEdgeCoverMultiplier,
  rangedActionReason,
  rangedAttackPreview,
  resolveRangedVolley,
} from "../gridBattle/rules/rangedCombat";
import { addFormation, blankState } from "./gridBattleTestState";
import { addMapTerrainObject, setMapEdgeFeature, setMapTerrain } from "../gridBattle/model/battlefieldMap";

function rangedFixture(targetFacing: "north" | "east" | "south" | "west" = "south") {
  const state = blankState(12, 12);
  const archers = addFormation(state, "archers", [{ x: 5, y: 9 }], "north");
  archers.formationMode = "open";
  archers.unit.rangedWeaponId = "composite-bow";
  archers.ammunition = 12;
  const defenders = addFormation(state, "defenders", [{ x: 5, y: 3 }], targetFacing, "saxon");
  defenders.unit.unitType = "heavy_infantry";
  defenders.unit.armour = 1;
  state.selectedFormationId = archers.id;
  state.phase = "choosing_action";
  return { state, archers, defenders, target: state.blocks["defenders-b1"]! };
}

describe("grid ranged combat", () => {
  it("blocks ground-level fire across a fortress wall but lets troops on top shoot over it", () => {
    const ground = blankState(12, 12);
    setMapTerrain(ground.battlefield, { x: 5, y: 6 }, "fortress_wall");
    expect(hasRangedLineOfSight(ground, { x: 5, y: 9 }, { x: 5, y: 3 })).toBe(false);

    setMapTerrain(ground.battlefield, { x: 5, y: 9 }, "fortress_wall");
    expect(hasRangedLineOfSight(ground, { x: 5, y: 9 }, { x: 5, y: 3 })).toBe(true);
  });

  it("lets short edge features provide cover while tall features block the shot", () => {
    const exposed = rangedFixture("east");
    const open = rangedFixture("east");
    const enclosed = rangedFixture("east");
    const blocked = rangedFixture("east");
    const blockedEnclosed = rangedFixture("east");
    const blockedDoor = rangedFixture("east");
    setMapEdgeFeature(open.state.battlefield, { x: 5, y: 3 }, "south", "hedge_short");
    setMapEdgeFeature(enclosed.state.battlefield, { x: 5, y: 3 }, "south", "stone_wall_short");
    setMapEdgeFeature(blocked.state.battlefield, { x: 5, y: 3 }, "south", "hedge_tall");
    setMapEdgeFeature(blockedEnclosed.state.battlefield, { x: 5, y: 3 }, "south", "stone_wall_tall");
    setMapEdgeFeature(blockedDoor.state.battlefield, { x: 5, y: 3 }, "south", "wooden_door");

    const exposedPreview = rangedAttackPreview(exposed.state, exposed.archers.id, exposed.target.id)!;
    const openPreview = rangedAttackPreview(open.state, open.archers.id, open.target.id)!;
    const enclosedPreview = rangedAttackPreview(enclosed.state, enclosed.archers.id, enclosed.target.id)!;
    expect(rangedEdgeCoverMultiplier(open.state, { x: 5, y: 9 }, { x: 5, y: 3 })).toBe(0.7);
    expect(openPreview.damage).toBeLessThan(exposedPreview.damage);
    expect(openPreview.damage).toBe(enclosedPreview.damage);
    expect(openPreview.impacts[0]?.coverMultiplier).toBe(0.7);
    expect(rangedAttackPreview(blocked.state, blocked.archers.id, blocked.target.id)).toBeNull();
    expect(rangedAttackPreview(
      blockedEnclosed.state,
      blockedEnclosed.archers.id,
      blockedEnclosed.target.id,
    )).toBeNull();
    expect(rangedAttackPreview(blockedDoor.state, blockedDoor.archers.id, blockedDoor.target.id)).toBeNull();
  });

  it("uses one deterministic unit volley and ends the formation activation", () => {
    const { state, archers, target } = rangedFixture();
    const preview = rangedAttackPreview(state, archers.id, target.id);
    expect(preview).not.toBeNull();
    expect(preview?.distance).toBe(6);
    expect(preview?.ammunition).toBe(12);

    const plan = planOrder(state, { type: "shoot", defenderId: target.id });
    expect(plan.ok).toBe(true);
    expect(plan.order?.confirmation?.title).toContain("composite bows");
    expect(plan.order?.confirmation?.damage[0]?.minimumDamage).toBe(preview?.damage);
    expect(executeCommand(state, { type: "shoot", defenderId: target.id })).toEqual({
      accepted: false,
      reason: "Ranged orders must be previewed and confirmed.",
    });

    const modelsBefore = target.models;
    expect(executeCommand(state, { type: "shoot", defenderId: target.id }, { confirmed: true })).toEqual({ accepted: true });
    expect(archers.ammunition).toBe(11);
    expect(archers.hasActivated).toBe(true);
    expect(state.blocks[target.id]?.models ?? 0).toBe(modelsBefore - (preview?.casualties ?? 0));
    expect(state.eventLog.some((event) =>
      event.type === "ranged_volley"
      && event.sourcePosition?.x === 5
      && event.projectileKind === "arrows",
    )).toBe(true);
  });

  it("lets frontal shields stop more missiles than an exposed side", () => {
    const frontal = rangedFixture("south");
    const side = rangedFixture("east");
    const frontalPreview = rangedAttackPreview(frontal.state, frontal.archers.id, frontal.target.id)!;
    const sidePreview = rangedAttackPreview(side.state, side.archers.id, side.target.id)!;
    expect(frontalPreview.targetEdge).toBe("front");
    expect(frontalPreview.shieldMultiplier).toBeLessThan(1);
    expect(sidePreview.targetEdge).toBe("side");
    expect(sidePreview.shieldMultiplier).toBe(1);
    expect(sidePreview.damage).toBeGreaterThan(frontalPreview.damage);
  });

  it("uses every eligible block and exposes participation intensity per target", () => {
    const state = blankState(14, 12);
    const archers = addFormation(state, "archers", [
      { x: 4, y: 9 }, { x: 5, y: 9 }, { x: 6, y: 9 },
    ], "north");
    archers.formationMode = "open";
    archers.unit.rangedWeaponId = "composite-bow";
    archers.ammunition = 12;
    state.selectedFormationId = archers.id;
    state.phase = "choosing_action";
    const centralTarget = addFormation(state, "central", [
      { x: 4, y: 3 }, { x: 5, y: 3 }, { x: 6, y: 3 },
    ], "east", "saxon");
    const edgeTarget = addFormation(state, "edge", [
      { x: 10, y: 3 }, { x: 10, y: 4 }, { x: 10, y: 2 },
    ], "east", "saxon");
    centralTarget.unit.equipment = [];
    edgeTarget.unit.equipment = [];

    const central = rangedAttackPreview(state, archers.id, "central-b2")!;
    const edge = rangedAttackPreview(state, archers.id, "edge-b1")!;
    expect(central.sourceBlockIds).toEqual(["archers-b2", "archers-b1", "archers-b3"]);
    expect(central.firingBlockCount).toBe(3);
    expect(central.impactCount).toBe(3);
    expect(central.firingIntensity).toBe(1);
    expect(central.strengthMultiplier).toBe(1);
    expect(edge.firingBlockCount).toBe(2);
    expect(edge.firingIntensity).toBeCloseTo(2 / 3);
    expect(edge.strengthMultiplier).toBeCloseTo(2 / 3);
    expect(central.damage).toBeGreaterThan(edge.damage);

    expect(resolveRangedVolley(state, archers.id, "central-b2").ok).toBe(true);
    const volley = state.eventLog.find((event) => event.type === "ranged_volley");
    expect(volley?.sourcePositions).toHaveLength(3);
    expect(volley?.targetPositions).toHaveLength(3);
    expect(volley?.blockIds?.slice(0, 3)).toEqual(["archers-b2", "archers-b1", "archers-b3"]);
    expect(new Set(volley?.blockIds?.slice(3))).toEqual(new Set(["central-b1", "central-b2", "central-b3"]));
  });

  it("spreads a five-block volley across five target blocks with shielded damage ranges", () => {
    const state = blankState(16, 16);
    const archers = addFormation(state, "archers", [
      { x: 4, y: 13 }, { x: 5, y: 13 }, { x: 6, y: 13 }, { x: 7, y: 13 }, { x: 8, y: 13 },
    ], "north");
    archers.formationMode = "open";
    archers.unit.rangedWeaponId = "composite-bow";
    archers.ammunition = 12;
    const defenders = addFormation(state, "defenders", [
      { x: 4, y: 6 }, { x: 5, y: 6 }, { x: 6, y: 6 }, { x: 7, y: 6 }, { x: 8, y: 6 },
    ], "south", "saxon");
    defenders.unit.armour = 1;
    state.selectedFormationId = archers.id;
    state.phase = "choosing_action";

    const preview = rangedAttackPreview(state, archers.id, "defenders-b3")!;
    expect(preview.firingBlockCount).toBe(5);
    expect(preview.impactCount).toBe(5);
    expect(new Set(preview.targetBlockIds).size).toBe(5);
    expect(preview.minimumDamage).toBe(5);
    expect(preview.maximumDamage).toBe(15);
    expect(preview.shieldBlockChance).toBe(70);
    expect(preview.shieldedImpactCount).toBe(4);
    expect(preview.damage).toBe(7);
    expect(preview.impacts.every((impact) =>
      impact.minimumDamage === 1 && impact.maximumDamage === 3)).toBe(true);

    const confirmation = planOrder(state, { type: "shoot", defenderId: "defenders-b3" }).order?.confirmation;
    expect(confirmation?.damage).toHaveLength(5);
    expect(confirmation?.damage.every((impact) =>
      impact.evadeChance === 70 && impact.mitigationLabel === "shield block")).toBe(true);

    const modelsBefore = defenders.blockIds.reduce((total, blockId) => total + state.blocks[blockId]!.models, 0);
    expect(resolveRangedVolley(state, archers.id, "defenders-b3").ok).toBe(true);
    const modelsAfter = defenders.blockIds.reduce((total, blockId) => total + state.blocks[blockId]!.models, 0);
    expect(modelsBefore - modelsAfter).toBe(7);
    const volley = state.eventLog.find((event) => event.type === "ranged_volley");
    expect(volley?.sourcePositions).toHaveLength(5);
    expect(volley?.targetPositions).toHaveLength(5);
  });

  it("requires a clear forward shot and forbids volleys while engaged", () => {
    const blocked = rangedFixture();
    setMapTerrain(blocked.state.battlefield, { x: 5, y: 6 }, "impassable");
    expect(rangedAttackPreview(blocked.state, blocked.archers.id, blocked.target.id)).toBeNull();
    expect(rangedActionReason(blocked.state, blocked.archers.id)).toContain("line of sight");

    const treesOnlyTakeSpace = rangedFixture();
    addMapTerrainObject(treesOnlyTakeSpace.state.battlefield, { x: 5, y: 6 }, "tree_large");
    expect(rangedAttackPreview(treesOnlyTakeSpace.state, treesOnlyTakeSpace.archers.id, treesOnlyTakeSpace.target.id))
      .not.toBeNull();

    const behind = rangedFixture();
    behind.target.position = { x: 5, y: 11 };
    expect(rangedAttackPreview(behind.state, behind.archers.id, behind.target.id)).toBeNull();

    const engaged = rangedFixture();
    addFormation(engaged.state, "contact", [{ x: 5, y: 8 }], "south", "saxon");
    expect(rangedAttackPreview(engaged.state, engaged.archers.id, engaged.target.id)).toBeNull();
    expect(commandLegality(engaged.state, "shoot")).toEqual({
      accepted: false,
      reason: "Engaged formations must Fall back, Battle, or Press.",
    });
  });

  it("uses weapon-specific grid ranges and does not spend ammo on an illegal shot", () => {
    const { state, archers, target } = rangedFixture();
    archers.unit.rangedWeaponId = "javelins";
    archers.ammunition = 4;
    target.position = { x: 5, y: 5 };
    expect(rangedAttackPreview(state, archers.id, target.id)).toBeNull();
    expect(resolveRangedVolley(state, archers.id, target.id).ok).toBe(false);
    expect(archers.ammunition).toBe(4);

    target.position = { x: 5, y: 6 };
    const preview = rangedAttackPreview(state, archers.id, target.id);
    expect(preview?.maximumRange).toBe(3);
    expect(preview?.projectileKind).toBe("javelins");
  });

  it("conserves unit ammunition when a ranged formation breaks into fragments", () => {
    const state = blankState();
    const formation = addFormation(state, "archers", [
      { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 },
    ], "north");
    formation.unit.rangedWeaponId = "composite-bow";
    formation.ammunition = 5;
    expect(forceSplit(state, formation.id)).toBe(true);
    const family = Object.values(state.formations)
      .filter((candidate) => candidate.provisionalFamilyId === formation.id);
    expect(family.length).toBeGreaterThan(1);
    expect(family.reduce((total, candidate) => total + (candidate.ammunition ?? 0), 0)).toBe(5);
  });
});
