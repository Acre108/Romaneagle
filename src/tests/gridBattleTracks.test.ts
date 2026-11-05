import { describe, expect, it } from "vitest";
import { executeCommand } from "../gridBattle/commands/executeCommand";
import { planOrder } from "../gridBattle/commands/planOrder";
import { planAiActivation } from "../gridBattle/ai/formationAi";
import { formationPlates } from "../gridBattle/rules/formationPlates";
import { hitPointsPerModel } from "../gridBattle/model/unitStats";
import { attackingPressure, damageBlock, pressurePreview, retreatBlock } from "../gridBattle/rules/combat";
import { resolveEngagedOrder } from "../gridBattle/rules/engagement";
import { resolveRoutingFormationActivation } from "../gridBattle/rules/routing";
import { endFormationActivation } from "../gridBattle/rules/turnSystem";
import { addFormation, attachCharacter, blankState } from "./gridBattleTestState";
import type { Formation, GameState, GridPosition, UnitType } from "../gridBattle/model/types";

/**
 * Position, morale and strength should matter in that order. These matchups pin
 * what one engaged order pays by angle of attack. The defender never replies, so
 * they measure the rules' payoff rather than overall battle balance.
 */
interface Profile {
  unitType: UnitType;
  formationMode: Formation["formationMode"];
  attack: number;
  armour: number;
  morale: number;
  modelsPerBlock: number;
  shield: boolean;
  width: number;
  depth: number;
}

const PRIMA: Profile = {
  unitType: "heavy_infantry", formationMode: "closed", attack: 3, armour: 1, morale: 9, modelsPerBlock: 9, shield: true, width: 3, depth: 3,
};
const GREAT_WARBAND: Profile = {
  unitType: "heavy_infantry", formationMode: "closed", attack: 3, armour: 0, morale: 8, modelsPerBlock: 9, shield: true, width: 5, depth: 3,
};
const LOOSE_WARBAND: Profile = {
  unitType: "light_infantry", formationMode: "open", attack: 2, armour: 0, morale: 7, modelsPerBlock: 5, shield: false, width: 4, depth: 3,
};

type Angle = "front" | "side" | "rear";
type Order = "battle" | "press";

function rectangle(x: number, y: number, width: number, height: number): GridPosition[] {
  const positions: GridPosition[] = [];
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) positions.push({ x: x + column, y: y + row });
  }
  return positions;
}

function applyProfile(state: GameState, formation: Formation, profile: Profile): void {
  formation.formationMode = profile.formationMode;
  formation.cohesion = profile.morale;
  formation.initialModelCount = profile.modelsPerBlock * formation.blockIds.length;
  Object.assign(formation.unit, {
    unitType: profile.unitType,
    attack: profile.attack,
    armour: profile.armour,
    equipment: profile.shield ? ["shield_front"] : [],
  });
  for (const blockId of formation.blockIds) {
    state.blocks[blockId]!.models = profile.modelsPerBlock;
    state.blocks[blockId]!.modelCapacity = profile.modelsPerBlock;
  }
}

/** The defender faces south, so its front is y+, its side x+ and its rear y-. */
function matchup(attacker: Profile, defender: Profile, angle: Angle, attackerWidth = attacker.width): GameState {
  const state = blankState(30, 30);
  const left = 12;
  const top = 12;
  const offset = left + Math.floor((defender.width - attackerWidth) / 2);
  const position = {
    front: rectangle(offset, top + defender.depth, attackerWidth, attacker.depth),
    side: rectangle(left + defender.width, top, attacker.depth, Math.min(attackerWidth, defender.depth)),
    rear: rectangle(offset, top - attacker.depth, attackerWidth, attacker.depth),
  }[angle];
  const facing = ({ front: "north", side: "west", rear: "south" } as const)[angle];
  applyProfile(state, addFormation(state, "attacker", position, facing, "roman"), attacker);
  applyProfile(state, addFormation(state, "defender", rectangle(left, top, defender.width, defender.depth), "south", "saxon"), defender);
  return state;
}

function defenders(state: GameState): Formation[] {
  return Object.values(state.formations).filter((formation) => formation.factionId === "saxon");
}

function modelsOf(state: GameState, factionId: "roman" | "saxon"): number {
  return Object.values(state.blocks)
    .filter((block) => block.factionId === factionId)
    .reduce((total, block) => total + block.models, 0);
}

interface OrderResult {
  /** Orders resolved before the defender routed or contact ended. */
  orders: number;
  outcome: "routed" | "contact_lost" | "still_fighting";
  morale: number[];
  defenderModelsLeft: number;
  attackerModelsLeft: number;
  squaresShifted: number;
}

function repeatOrder(state: GameState, order: Order, maximumOrders = 10): OrderResult {
  const starts = new Map(Object.values(state.blocks)
    .filter((block) => block.factionId === "saxon")
    .map((block) => [block.id, { ...block.position }]));
  const initialDefenders = modelsOf(state, "saxon");
  const initialAttackers = modelsOf(state, "roman");
  const morale: number[] = [];
  let orders = 0;
  let outcome: OrderResult["outcome"] = "still_fighting";
  for (let round = 1; round <= maximumOrders; round += 1) {
    state.round = round;
    if (resolveEngagedOrder(state, "attacker", order) === 0) {
      outcome = "contact_lost";
      break;
    }
    orders = round;
    const remaining = defenders(state);
    morale.push(remaining.length === 0 ? 0 : Math.max(...remaining.map((formation) => formation.cohesion)));
    if (remaining.length === 0 || remaining.some((formation) => formation.status === "routed")) {
      outcome = "routed";
      break;
    }
  }
  const squaresShifted = Object.values(state.blocks)
    .filter((block) => block.factionId === "saxon")
    .reduce((total, block) => {
      const start = starts.get(block.id);
      return total + (start ? Math.abs(block.position.x - start.x) + Math.abs(block.position.y - start.y) : 0);
    }, 0);
  return {
    orders,
    outcome,
    morale,
    defenderModelsLeft: Math.round(modelsOf(state, "saxon") / initialDefenders * 100),
    attackerModelsLeft: Math.round(modelsOf(state, "roman") / initialAttackers * 100),
    squaresShifted,
  };
}

describe("what an order pays by angle of attack", () => {
  it.each([
    ["front", "battle", 5, "contact_lost"],
    ["side", "battle", 1, "contact_lost"],
    ["rear", "battle", 1, "contact_lost"],
    ["front", "press", 3, "routed"],
    ["side", "press", 2, "routed"],
    ["rear", "press", 2, "routed"],
  ] as const)("Great Warband struck from the %s by %s", (angle, order, orders, outcome) => {
    expect(repeatOrder(matchup(PRIMA, GREAT_WARBAND, angle), order)).toMatchObject({ orders, outcome });
  });

  it.each([
    ["front", "battle", 1, "contact_lost"],
    ["side", "battle", 1, "contact_lost"],
    ["rear", "battle", 1, "contact_lost"],
    ["front", "press", 3, "routed"],
    ["side", "press", 2, "routed"],
    ["rear", "press", 2, "routed"],
  ] as const)("Loose Warband struck from the %s by %s", (angle, order, orders, outcome) => {
    expect(repeatOrder(matchup(PRIMA, LOOSE_WARBAND, angle), order)).toMatchObject({ orders, outcome });
  });

  it("never lets one order rout a fresh formation with morale above the per-order limit", () => {
    for (const defender of [GREAT_WARBAND, LOOSE_WARBAND]) {
      for (const angle of ["front", "side", "rear"] as const) {
        for (const order of ["battle", "press"] as const) {
          const state = matchup(PRIMA, defender, angle);
          resolveEngagedOrder(state, "attacker", order);
          expect(defenders(state).every((formation) => formation.status !== "routed")).toBe(true);
        }
      }
    }
  });

  it("routs a formation long before killing it", () => {
    for (const angle of ["front", "side", "rear"] as const) {
      const result = repeatOrder(matchup(PRIMA, GREAT_WARBAND, angle), "press");
      expect(result.defenderModelsLeft).toBeGreaterThanOrEqual(80);
      expect(result.outcome).toBe("routed");
    }
  });

  it("makes a frontal Battle a slow, even grind that moves nobody", () => {
    expect(repeatOrder(matchup(PRIMA, GREAT_WARBAND, "front"), "battle")).toMatchObject({
      squaresShifted: 0,
      defenderModelsLeft: 80,
      attackerModelsLeft: 81,
    });
  });
});

function matched(): GameState {
  const state = blankState(30, 30);
  const south = addFormation(state, "south", rectangle(12, 15, 4, 3), "north", "roman");
  const north = addFormation(state, "north", rectangle(12, 12, 4, 3), "south", "saxon");
  for (const formation of [south, north]) {
    formation.unit.unitType = "heavy_infantry";
    formation.unit.armour = 1;
  }
  return state;
}

describe("pressing overextends a formation", () => {
  function pressThenEndActivation(state: GameState): void {
    resolveEngagedOrder(state, "south", "press");
    state.activeFactionId = "roman";
    endFormationActivation(state, "south");
  }
  const southWavering = (state: GameState) => Object.values(state.blocks)
    .filter((block) => block.formationId === "south" && block.wavering).length;

  it("leaves blocks that advanced wavering after the Press ends", () => {
    const state = matched();
    pressThenEndActivation(state);
    expect(southWavering(state)).toBe(12);
  });

  it("does not overextend a Press that shoved nothing", () => {
    const state = matched();
    for (const id of ["north-b9", "north-b10", "north-b11", "north-b12"]) {
      attachCharacter(state, `anchor-${id}`, id, "saxon", "commander", { resistanceBonus: 99, commandRadius: 0 });
    }
    pressThenEndActivation(state);
    expect(southWavering(state)).toBe(0);
  });

  it("lets an order that does not press settle the line again", () => {
    const state = matched();
    pressThenEndActivation(state);
    state.round += 1;
    state.activeFactionId = "roman";
    state.formations.south!.hasActivated = false;
    endFormationActivation(state, "south");
    expect(southWavering(state)).toBe(0);
  });

  it("makes a second Press in a row leave files behind", () => {
    const state = matched();
    pressThenEndActivation(state);
    resolveEngagedOrder(state, "south", "press");
    const ys = Object.values(state.blocks).filter((block) => block.factionId === "roman").map((block) => block.position.y);
    expect(Math.max(...ys) - Math.min(...ys) + 1).toBeGreaterThan(3);
  });

  it("has the computer stop pressing once it is overextended", () => {
    const state = matched();
    state.activeFactionId = "saxon";
    for (const id of state.formations.north!.blockIds) state.blocks[id]!.wavering = true;
    expect(planAiActivation(state, "saxon")?.intent).toBe("battle");
  });
});

describe("matched formations replying to each other", () => {
  it("lets a shoved formation shove straight back", () => {
    const state = matched();
    resolveEngagedOrder(state, "south", "press");
    expect(state.formations.north!.cohesion).toBe(6);
    resolveEngagedOrder(state, "north", "press");
    expect(state.formations.south!.cohesion).toBeLessThan(8);
  });

  it("makes a block easier to shove while it wavers, until its own order ends", () => {
    const steady = matched();
    const wavering = matched();
    wavering.blocks["north-b9"]!.wavering = true;
    const contact = (state: GameState) => pressurePreview(state, "south-b1", "north-b9", { allowAnyContact: true })!;
    expect(contact(wavering).netPressure).toBe(contact(steady).netPressure + 2);
    expect(attackingPressure(wavering, "north-b9")).toBe(attackingPressure(steady, "north-b9"));
  });
});

describe("strength follows the shove", () => {
  it("evens a full block's strength across block sizes", () => {
    expect(hitPointsPerModel("closed", 2) * 9).toBe(9);
    expect(hitPointsPerModel("open", 2) * 5).toBe(10);
    expect(hitPointsPerModel("open", 3) * 3).toBe(9);
  });

  it("stops a block counterattacking a clean Battle shove", () => {
    const state = matchup(PRIMA, LOOSE_WARBAND, "rear");
    const attackers = modelsOf(state, "roman");
    resolveEngagedOrder(state, "attacker", "battle");
    expect(state.formations.defender!.cohesion).toBeLessThan(LOOSE_WARBAND.morale);
    expect(state.eventLog.some((event) => event.type === "counterattack_resolved")).toBe(false);
    expect(modelsOf(state, "roman")).toBe(attackers);
  });

  it("lets a shoved block counter a Press", () => {
    const state = matchup(PRIMA, LOOSE_WARBAND, "rear");
    resolveEngagedOrder(state, "attacker", "press");
    expect(state.eventLog.some((event) => event.type === "counterattack_resolved")).toBe(true);
  });

  it("routs a formation on casualties alone at a quarter of its men, whatever its morale", () => {
    const state = matchup(PRIMA, GREAT_WARBAND, "front");
    state.formations.defender!.cohesion = 10;
    const ids = [...state.formations.defender!.blockIds];
    for (const id of ids.slice(0, 11)) damageBlock(state, id, 9, "test");
    expect(state.formations.defender!.status).not.toBe("routed");
    damageBlock(state, ids[11]!, 9, "test");
    expect(state.formations.defender!.status).toBe("routed");
    expect(state.eventLog.some((event) => event.message.includes("and broke"))).toBe(true);
  });

  it("ends a long frontal Battle in a rout rather than mutual annihilation", () => {
    const state = matched();
    let routed = false;
    for (let round = 1; round <= 20 && !routed; round += 1) {
      state.round = round;
      resolveEngagedOrder(state, "south", "battle");
      if (state.formations.north) resolveEngagedOrder(state, "north", "battle");
      routed = Object.values(state.formations).some((formation) => formation.status === "routed");
    }
    expect(routed).toBe(true);
    expect(modelsOf(state, "roman")).toBeGreaterThanOrEqual(15);
  });

  it("counts a counterattack in damage, so tough models do not lose extra strength", () => {
    const state = matchup(PRIMA, GREAT_WARBAND, "front");
    state.formations.attacker!.unit.hitPointsPerModel = 2;
    resolveEngagedOrder(state, "attacker", "battle");
    const damaged = Object.values(state.blocks).filter((block) => block.factionId === "roman" && block.wounds > 0);
    expect(damaged.length).toBeGreaterThan(0);
  });
});

describe("a rout disturbs the line around it", () => {
  it("costs the formation beside it one morale when it breaks", () => {
    const state = blankState(12, 12);
    addFormation(state, "enemy", [{ x: 4, y: 7 }], "north", "saxon");
    const breaking = addFormation(state, "breaking", [{ x: 4, y: 6 }], "south", "roman");
    const beside = addFormation(state, "beside", [{ x: 5, y: 5 }], "south", "roman");
    const distant = addFormation(state, "distant", [{ x: 9, y: 2 }], "south", "roman");
    breaking.cohesion = 1;
    retreatBlock(state, "breaking-b1", "north", "chaotic");
    expect(breaking.status).toBe("routed");
    expect(beside.cohesion).toBe(7);
    expect(distant.cohesion).toBe(8);
  });

  it("lets routers pour through friends, who swap places and waver", () => {
    const state = blankState(12, 12);
    addFormation(state, "enemy", [{ x: 4, y: 2 }], "south", "saxon");
    const routed = addFormation(state, "routed", [{ x: 4, y: 3 }], "north", "roman");
    addFormation(state, "friend", [{ x: 4, y: 4 }], "north", "roman");
    routed.unit.movement = 1;
    routed.cohesion = 0;
    routed.status = "routed";
    const result = resolveRoutingFormationActivation(state, "routed");
    expect(result.movedSteps).toBe(1);
    expect(state.blocks["routed-b1"]!.position).toEqual({ x: 4, y: 4 });
    expect(state.blocks["friend-b1"]!.position).toEqual({ x: 4, y: 3 });
    expect(state.blocks["friend-b1"]!.wavering).toBe(true);
  });

  it("still traps routers against enemies and impassable ground", () => {
    const state = blankState(12, 12);
    addFormation(state, "south-enemy", [{ x: 4, y: 4 }], "north", "saxon");
    addFormation(state, "north-enemy", [{ x: 4, y: 2 }], "south", "saxon");
    addFormation(state, "east-enemy", [{ x: 5, y: 3 }], "west", "saxon");
    addFormation(state, "west-enemy", [{ x: 3, y: 3 }], "east", "saxon");
    const routed = addFormation(state, "routed", [{ x: 4, y: 3 }], "north", "roman");
    routed.cohesion = 0;
    routed.status = "routed";
    expect(resolveRoutingFormationActivation(state, "routed").movedSteps).toBe(0);
    expect(resolveRoutingFormationActivation(state, "routed").formationEscaped).toBe(true);
    expect(state.formations.routed).toBeUndefined();
  });
});

describe("the order confirmation says what will happen", () => {
  function confirmation(state: GameState, order: Order): string[] {
    state.selectedFormationId = "attacker";
    return planOrder(state, { type: order }).order?.confirmation?.forecast ?? [];
  }

  it("lists the enemy first, with its morale change and result words", () => {
    const lines = confirmation(matchup(PRIMA, GREAT_WARBAND, "front"), "press");
    expect(lines[0]).toMatch(/^defender: Morale 8 \u2192 6 \(\u22122 pushed\) \u00b7 .*Pushed \u00d73/);
  });

  it("says why a formation loses morale, even when it is winning", () => {
    const state = matchup(PRIMA, GREAT_WARBAND, "side");
    state.selectedFormationId = "attacker";
    const lines = planOrder(state, { type: "battle" }).order?.confirmation?.forecast ?? [];
    const defender = lines.find((line) => line.startsWith("defender:"));
    expect(defender).toContain("\u22122 flanked");
  });

  it("sets Battle and Press side by side, from one typical result each", () => {
    const state = matchup(PRIMA, GREAT_WARBAND, "front");
    state.selectedFormationId = "attacker";
    const battle = planOrder(state, { type: "battle" }).order?.confirmation?.comparison ?? [];
    expect(battle).toHaveLength(2);
    expect(battle[0]).toMatch(/^This Battle: ~\d+ Saxons? and ~\d+ Romans? fall$/);
    expect(battle[1]).toMatch(/^Press instead: defender: Morale 8 \u2192 6 \(\u22122 pushed\) \u00b7 Pushed \u00d73.*fall \u00b7 advancing blocks stay wavering$/);
    const press = planOrder(state, { type: "press" }).order?.confirmation?.comparison ?? [];
    expect(press[0]).toMatch(/^This Press: ~\d+ Saxons? and ~\d+ Romans? fall \u00b7 advancing blocks stay wavering$/);
    expect(press[1]).toMatch(/^Battle instead: /);
  });

  it("warns before an order routs a formation", () => {
    const state = matchup(PRIMA, GREAT_WARBAND, "front");
    state.formations.defender!.cohesion = 2;
    expect(confirmation(state, "press")[0]).toContain("ROUTS");
  });

  it("does not blame the order for a rout that already happened", () => {
    const state = matchup(PRIMA, GREAT_WARBAND, "front");
    state.formations.defender!.cohesion = 0;
    state.formations.defender!.status = "routed";
    expect(confirmation(state, "battle")[0]).toContain("defender: Already routing");
  });

  it("says plainly when a line holds", () => {
    const lines = confirmation(matchup(PRIMA, GREAT_WARBAND, "front"), "battle");
    expect(lines[0]).toBe("defender: Morale 8 \u00b7 Holds \u00d73");
  });

  it("does not change the state it previews", () => {
    const state = matchup(PRIMA, GREAT_WARBAND, "front");
    state.selectedFormationId = "attacker";
    const before = JSON.stringify(state);
    planOrder(state, { type: "press" });
    planOrder(state, { type: "battle" });
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("every formation shows its state on the board", () => {
  it("labels both sides with morale and men left", () => {
    const state = matchup(PRIMA, GREAT_WARBAND, "front");
    expect(formationPlates(state).map((plate) => plate.text)).toEqual(["attacker  ♥9  81", "defender  ♥8  135"]);
  });

  it("colours a plate by morale and says when a formation is routing", () => {
    const state = matchup(PRIMA, GREAT_WARBAND, "front");
    state.formations.defender!.cohesion = 5;
    state.formations.attacker!.cohesion = 0;
    state.formations.attacker!.status = "routed";
    const [attacker, defender] = formationPlates(state);
    expect(attacker).toMatchObject({ tone: "breaking", text: "attacker  ROUTING  81" });
    expect(defender?.tone).toBe("shaken");
  });

  it("gives a split formation one plate", () => {
    const state = matchup(PRIMA, GREAT_WARBAND, "front");
    state.formations["defender-fragment-1"] = { ...state.formations.defender!, id: "defender-fragment-1", blockIds: ["defender-b1"] };
    state.formations.defender!.blockIds = state.formations.defender!.blockIds.filter((id) => id !== "defender-b1");
    expect(formationPlates(state).filter((plate) => plate.key === "defender")).toHaveLength(1);
  });
});

describe("how much one point or a free turn changes", () => {
  it("does not let an attacker's own morale decide whether its front can shove", () => {
    for (const width of [1, 2, 3]) {
      const state = matchup(PRIMA, GREAT_WARBAND, "front", width);
      resolveEngagedOrder(state, "attacker", "press");
      expect(defenders(state)[0]!.cohesion).toBeLessThan(GREAT_WARBAND.morale);
    }
  });

  it("charges a shove once per order, however many files were pushed", () => {
    for (const width of [1, 3]) {
      const state = matchup(PRIMA, GREAT_WARBAND, "front", width);
      resolveEngagedOrder(state, "attacker", "press");
      expect(state.formations.defender!.cohesion).toBe(6);
    }
  });

  it("keeps a block wavering through its next activation and steadies it afterwards", () => {
    const state = matchup(PRIMA, GREAT_WARBAND, "front");
    resolveEngagedOrder(state, "attacker", "press");
    const shoved = Object.values(state.blocks).filter((block) => block.factionId === "saxon" && block.wavering);
    expect(shoved.length).toBeGreaterThan(0);
    state.activeFactionId = "saxon";
    endFormationActivation(state, "defender");
    expect(Object.values(state.blocks).filter((block) => block.formationId === "defender" && block.wavering)).toEqual([]);
  });

  it("gives a flanked formation no free turn when it fights", () => {
    const state = matchup(PRIMA, GREAT_WARBAND, "side");
    const contact = () => pressurePreview(state, "attacker-b1", "defender-b5", { allowAnyContact: true })!.contactEdge;
    expect(contact()).toBe("side");
    resolveEngagedOrder(state, "defender", "battle");
    expect(state.formations.defender!.facing).toBe("south");
    expect(contact()).toBe("side");
  });

  it("makes turning in contact cost the whole activation", () => {
    const state = matchup(PRIMA, GREAT_WARBAND, "side");
    state.activeFactionId = "saxon";
    state.selectedFormationId = "defender";
    expect(executeCommand(state, { type: "turn", facing: "south" })).toEqual({
      accepted: false, reason: "The formation already faces that way.",
    });
    expect(executeCommand(state, { type: "turn", facing: "east" }).accepted).toBe(true);
    expect(state.formations.defender).toMatchObject({ facing: "east", hasActivated: true });
    const contact = pressurePreview(state, "attacker-b1", "defender-b5", { allowAnyContact: true })!;
    expect(contact.contactEdge).toBe("front");
  });

  it("refuses a turn to a formation that is not in contact", () => {
    const state = blankState(12, 12);
    addFormation(state, "free", [{ x: 2, y: 2 }], "north", "roman");
    addFormation(state, "enemy", [{ x: 9, y: 9 }], "north", "saxon");
    state.selectedFormationId = "free";
    expect(executeCommand(state, { type: "turn", facing: "east" }).accepted).toBe(false);
  });

  it("has the computer turn a formation with nothing to its front", () => {
    const state = matchup(PRIMA, GREAT_WARBAND, "side");
    state.activeFactionId = "saxon";
    const plan = planAiActivation(state, "saxon");
    expect(plan?.intent).toBe("turn");
    expect(plan?.steps.at(-1)?.command).toEqual({ type: "turn", facing: "east" });
  });
});
