import { describe, expect, it } from "vitest";
import {
  ALL_BLOCK_SLOTS_MASK, blockSlotBit, blockSlotIndices, blockSlotMask,
  deriveBlockSlotOccupancy, deriveContestedCellSlotOccupancies, preferredSoldierSlotOrder,
} from "../gridBattle/model/blockSlots";
import {
  terrainBlockCapacity,
  terrainObjectSlotMask,
  terrainObjectSlotPlacements,
  terrainSlotMask,
} from "../gridBattle/model/terrain";
import type { BuildingCell, FormationMode, GameState, TroopBlock, UnitType } from "../gridBattle/model/types";
import {
  BLOCK_SLOT_POINTS, soldierArtKind, soldierMarkLayout, usesRomanCenturySoldierArt,
  visibleRegularSoldierMarkCount, visibleSoldierMarkCount,
} from "../gridBattle/rendering/soldierMarkLayout";
import { addFormation, blankState } from "./gridBattleTestState";

function layoutFixture(options: {
  id?: string; factionId?: "roman" | "saxon"; mode?: FormationMode; unitType?: UnitType;
  models?: number; capacity?: number; characterId?: string | null;
} = {}): { state: GameState; block: TroopBlock } {
  const state = blankState();
  const id = options.id ?? "unit";
  const factionId = options.factionId ?? "roman";
  const formation = addFormation(state, id, [{ x: 2, y: 2 }], "north", factionId);
  formation.formationMode = options.mode ?? "closed";
  formation.unit.unitType = options.unitType ?? "light_infantry";
  const block = state.blocks[`${id}-b1`]!;
  block.models = options.models ?? 9;
  block.modelCapacity = options.capacity ?? 9;
  block.characterId = options.characterId ?? null;
  return { state, block };
}

describe("soldier mark layouts", () => {
  it("defines one shared three-by-three grid as a nine-bit mask", () => {
    expect(BLOCK_SLOT_POINTS).toHaveLength(9);
    expect(blockSlotIndices(ALL_BLOCK_SLOTS_MASK)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(blockSlotMask([0, 2, 4, 6, 8])).toBe(0b1_0101_0101);
  });

  it("draws closed infantry as a full three-by-three square", () => {
    const { state, block } = layoutFixture();
    expect(soldierMarkLayout(state, block)).toEqual([
      { x: 14, y: 14 }, { x: 26, y: 14 }, { x: 38, y: 14 },
      { x: 14, y: 26 }, { x: 26, y: 26 }, { x: 38, y: 26 },
      { x: 14, y: 38 }, { x: 26, y: 38 }, { x: 38, y: 38 },
    ]);
  });

  it("draws open infantry as four corners and a centre", () => {
    const { state, block } = layoutFixture({ mode: "open", models: 5, capacity: 5 });
    expect(soldierMarkLayout(state, block)).toEqual([
      { x: 14, y: 14 }, { x: 38, y: 14 }, { x: 26, y: 26 },
      { x: 14, y: 38 }, { x: 38, y: 38 },
    ]);
  });

  it("draws cavalry according to model size and block capacity", () => {
    const closed = layoutFixture({ unitType: "light_cavalry", models: 3, capacity: 3 });
    const open = layoutFixture({ unitType: "light_cavalry", mode: "open", models: 3, capacity: 3 });
    expect(soldierMarkLayout(closed.state, closed.block)).toHaveLength(3);
    expect(soldierMarkLayout(open.state, open.block)).toHaveLength(3);
  });

  it("gives open and cavalry formations nine unique preferred slots", () => {
    const open = layoutFixture({ mode: "open", models: 5, capacity: 5 });
    const cavalry = layoutFixture({ mode: "open", unitType: "light_cavalry", models: 3, capacity: 3 });
    const openOrder = preferredSoldierSlotOrder(open.state, open.block);
    const cavalryOrder = preferredSoldierSlotOrder(cavalry.state, cavalry.block);
    expect(new Set(openOrder).size).toBe(9);
    expect(new Set(cavalryOrder).size).toBe(9);
    expect(openOrder.slice(0, 5)).toEqual([0, 2, 4, 6, 8]);
    expect(cavalryOrder.slice(0, 3)).toEqual([3, 4, 5]);
  });

  it("reduces visible marks as models are lost", () => {
    const infantry = layoutFixture({ models: 8 });
    const open = layoutFixture({ mode: "open", models: 4, capacity: 5 });
    const cavalry = layoutFixture({ mode: "open", unitType: "light_cavalry", models: 2, capacity: 3 });
    expect(visibleSoldierMarkCount(infantry.state, infantry.block)).toBe(8);
    expect(visibleSoldierMarkCount(open.state, open.block)).toBe(4);
    expect(visibleSoldierMarkCount(cavalry.state, cavalry.block)).toBe(2);
  });

  it("replaces one regular model mark with a hosted character", () => {
    const fixture = layoutFixture({ characterId: "centurion" });
    expect(visibleRegularSoldierMarkCount(fixture.state, fixture.block)).toBe(8);
    const occupancy = deriveBlockSlotOccupancy(fixture.state, fixture.block);
    expect(occupancy.characterMask).toBe(blockSlotBit(4));
    expect(occupancy.soldierMask & occupancy.characterMask).toBe(0);
    expect(occupancy.occupiedMask).toBe(ALL_BLOCK_SLOTS_MASK);
  });

  it("uses fallback slots when preferred points are unavailable", () => {
    const fixture = layoutFixture({ mode: "open", models: 5, capacity: 5 });
    const occupancy = deriveBlockSlotOccupancy(fixture.state, fixture.block, blockSlotBit(4));
    expect(blockSlotIndices(occupancy.soldierMask)).toEqual([0, 1, 2, 6, 8]);
  });

  it("represents terrain objects and buildings through shared terrain masks", () => {
    expect(blockSlotIndices(terrainSlotMask("tree_small"))).toEqual([4]);
    expect(blockSlotIndices(terrainSlotMask("tree_large"))).toEqual([1, 3, 4, 5]);
    expect(blockSlotIndices(terrainSlotMask("rock_small"))).toEqual([4]);
    expect(blockSlotIndices(terrainSlotMask("pond"))).toEqual([1, 3, 4, 5]);
    const buildingCell: BuildingCell = { buildingId: "hall", walls: ["south", "west"] };
    expect(blockSlotIndices(terrainSlotMask("building", buildingCell))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(terrainBlockCapacity("building", 9, buildingCell)).toBe(0);
  });

  it("fits open formations around trees but spills a full closed block", () => {
    expect(terrainBlockCapacity("tree_small", 9)).toBe(8);
    expect(terrainBlockCapacity("tree_large", 9)).toBe(5);
    expect(terrainBlockCapacity("tree_large", 5)).toBe(5);
    const fixture = layoutFixture({ mode: "open", models: 5, capacity: 5 });
    const occupancy = deriveBlockSlotOccupancy(fixture.state, fixture.block, terrainSlotMask("tree_large"));
    expect(blockSlotIndices(occupancy.soldierMask)).toEqual([0, 2, 6, 7, 8]);
  });

  it("stacks mixed four-space and one-space objects across all nine spaces", () => {
    const objects = ["pond", "rock_large", "tree_small"] as const;
    const placements = terrainObjectSlotPlacements(objects);
    expect(placements.map((placement) => blockSlotIndices(placement.slotMask))).toEqual([
      [0, 1, 3, 4],
      [5, 6, 7, 8],
      [2],
    ]);
    expect(terrainObjectSlotMask(objects)).toBe(ALL_BLOCK_SLOTS_MASK);
    expect(terrainBlockCapacity("clear", 9, undefined, objects)).toBe(0);
  });

  it("keeps terrain, duellists, and contested models in separate slots", () => {
    const state = blankState();
    addFormation(state, "roman", [{ x: 2, y: 2 }], "north", "roman");
    addFormation(state, "saxon", [{ x: 2, y: 2 }], "south", "saxon");
    state.blocks["roman-b1"]!.characterId = "centurion";
    state.blocks["saxon-b1"]!.characterId = "champion";
    const treeMask = terrainSlotMask("tree_small");
    const occupancies = deriveContestedCellSlotOccupancies(
      state, [state.blocks["roman-b1"]!, state.blocks["saxon-b1"]!], treeMask, true,
    );
    const roman = occupancies.find((occupancy) => occupancy.blockId === "roman-b1")!;
    const saxon = occupancies.find((occupancy) => occupancy.blockId === "saxon-b1")!;
    const combined = occupancies.reduce((mask, occupancy) => mask | occupancy.occupiedMask, 0);
    expect(roman.characterMask).toBe(blockSlotBit(3));
    expect(saxon.characterMask).toBe(blockSlotBit(5));
    expect(roman.occupiedMask & saxon.occupiedMask).toBe(0);
    expect(combined & treeMask).toBe(0);
    expect(combined | treeMask).toBe(ALL_BLOCK_SLOTS_MASK);
  });

  it("uses the supplied art for the Roman century and its fragments", () => {
    const century = layoutFixture({ id: "legio-i", unitType: "heavy_infantry" });
    expect(usesRomanCenturySoldierArt(century.state, century.block)).toBe(true);
    const fragment = layoutFixture({ id: "legio-i-fragment-2", unitType: "heavy_infantry" });
    expect(usesRomanCenturySoldierArt(fragment.state, fragment.block)).toBe(true);
    const lanciarii = layoutFixture({ id: "lanciarii", unitType: "heavy_infantry" });
    expect(usesRomanCenturySoldierArt(lanciarii.state, lanciarii.block)).toBe(false);
    const saxon = layoutFixture({ id: "legio-i", factionId: "saxon", unitType: "heavy_infantry" });
    expect(usesRomanCenturySoldierArt(saxon.state, saxon.block)).toBe(false);
  });

  it("assigns basic and detailed Saxon art to the two warbands and their fragments", () => {
    const greatWarband = layoutFixture({ id: "great-warband", factionId: "saxon", unitType: "heavy_infantry" });
    expect(soldierArtKind(greatWarband.state, greatWarband.block)).toBe("saxon-basic");
    const greatFragment = layoutFixture({
      id: "great-warband-fragment-2",
      factionId: "saxon",
      unitType: "heavy_infantry",
    });
    expect(soldierArtKind(greatFragment.state, greatFragment.block)).toBe("saxon-basic");

    const looseWarband = layoutFixture({ id: "loose-warband", factionId: "saxon" });
    expect(soldierArtKind(looseWarband.state, looseWarband.block)).toBe("saxon-detailed");
    const looseFragment = layoutFixture({ id: "loose-warband-fragment-1", factionId: "saxon" });
    expect(soldierArtKind(looseFragment.state, looseFragment.block)).toBe("saxon-detailed");

    const cavalry = layoutFixture({ id: "saxon-cavalry", factionId: "saxon", unitType: "light_cavalry" });
    expect(soldierArtKind(cavalry.state, cavalry.block)).toBeNull();
  });
});
