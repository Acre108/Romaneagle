import type {
  CombatBlockDamagePreview,
  GameState,
  GridPosition,
  OrderPreviewTile,
  PressurePreview,
  TroopBlock,
} from "../model/types";
import { blockHitPoints } from "../model/unitStats";
import { positionKey } from "../model/occupancy";

function blockChanged(before: TroopBlock, after: TroopBlock | undefined): boolean {
  return !after
    || positionKey(before.position) !== positionKey(after.position)
    || before.models !== after.models
    || before.wounds !== after.wounds
    || before.disorder !== after.disorder
    || before.formationId !== after.formationId
    || before.isContested !== after.isContested;
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

function equation(terms: PressurePreview["pressureMath"]): string {
  const visible = terms.filter((term, index) => index < 2 || term.value !== 0);
  return visible.map((term, index) => index === 0 ? `${term.value}` : signed(term.value)).join(" ");
}

export function pressureCalculationLines(preview: PressurePreview): string[] {
  const protection = preview.armour + preview.shieldArmour + preview.braceArmour;
  return [
    `Pressure: ${equation(preview.pressureMath)} = ${preview.attackingPressure}`,
    `Resistance: ${equation(preview.resistanceMath)} = ${preview.defendingResistance}`,
    `Net pressure: ${preview.attackingPressure} - ${preview.defendingResistance} = ${preview.netPressure}`,
    `Damage: ${preview.rawDamage} - ${protection} protection${preview.damagePenalty > 0 ? ` - ${preview.damagePenalty} order penalty` : ""} = ${preview.damageOnHit} on hit`,
    `Protection: ${preview.armour} armour + ${preview.shieldArmour} shield + ${preview.braceArmour} brace`,
    `Defence: ${preview.defence}% evade; ${100 - preview.defence}% hit`,
    `Contact: ${preview.contactEdge}; damage range ${preview.minimumDamage}–${preview.maximumDamage}`,
  ];
}

export function blockCombatMath(
  preview: PressurePreview,
  role: "attacker" | "defender",
): string[] {
  const relationship = role === "defender"
    ? `${preview.attackerId} attacks this block`
    : `This block attacks ${preview.defenderId}`;
  return [relationship, ...pressureCalculationLines(preview)];
}

interface TileAccumulator {
  count: number;
  position: GridPosition;
  factionId: OrderPreviewTile["factionId"];
  contributors: Map<string, number>;
}

export interface CombatOutcomePreview {
  tiles: OrderPreviewTile[];
  damage: CombatBlockDamagePreview[];
}

/**
 * Summarises one simulation for every possible percentile defence roll. Keeping
 * this outside rendering makes the percentages deterministic and testable.
 */
export function aggregateCombatOutcomes(
  before: GameState,
  outcomes: readonly GameState[],
  involvedBlockIds: ReadonlySet<string>,
  mathByBlock: ReadonlyMap<string, readonly string[]>,
): CombatOutcomePreview {
  if (outcomes.length === 0) return { tiles: [], damage: [] };
  const candidateIds = new Set(involvedBlockIds);
  for (const block of Object.values(before.blocks)) {
    if (outcomes.some((outcome) => blockChanged(block, outcome.blocks[block.id]))) candidateIds.add(block.id);
  }

  const tileAccumulators = new Map<string, TileAccumulator>();
  for (const outcome of outcomes) {
    const seen = new Set<string>();
    for (const blockId of candidateIds) {
      const block = outcome.blocks[blockId];
      if (!block) continue;
      const key = `${block.factionId}:${positionKey(block.position)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const accumulator = tileAccumulators.get(key) ?? {
        count: 0,
        position: { ...block.position },
        factionId: block.factionId,
        contributors: new Map<string, number>(),
      };
      accumulator.count += 1;
      accumulator.contributors.set(blockId, (accumulator.contributors.get(blockId) ?? 0) + 1);
      tileAccumulators.set(key, accumulator);
    }
  }

  const tiles = [...tileAccumulators.values()].map((accumulator): OrderPreviewTile => {
    const [blockId] = [...accumulator.contributors.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]!;
    const chance = Math.round(accumulator.count / outcomes.length * 100);
    return {
      position: accumulator.position,
      factionId: accumulator.factionId,
      certainty: "possible",
      chance,
      blockId,
      math: [
        `${blockId} occupies this square on ${accumulator.count} of ${outcomes.length} defence rolls.`,
        ...(mathByBlock.get(blockId) ?? ["Position changes only when the combat result moves or removes this block."]),
      ],
    };
  });

  const damage: CombatBlockDamagePreview[] = [];
  for (const blockId of candidateIds) {
    const original = before.blocks[blockId];
    const formation = original?.formationId ? before.formations[original.formationId] : undefined;
    if (!original || !formation) continue;
    const startingHitPoints = blockHitPoints(formation, original);
    let minimumDamage = Number.POSITIVE_INFINITY;
    let maximumDamage = 0;
    const positions = new Map<string, { count: number; position: GridPosition }>();
    for (const outcome of outcomes) {
      const after = outcome.blocks[blockId];
      const remainingHitPoints = after ? blockHitPoints(formation, after) : 0;
      const taken = Math.max(0, startingHitPoints - remainingHitPoints);
      minimumDamage = Math.min(minimumDamage, taken);
      maximumDamage = Math.max(maximumDamage, taken);
      if (after) {
        const key = positionKey(after.position);
        const entry = positions.get(key) ?? { count: 0, position: { ...after.position } };
        entry.count += 1;
        positions.set(key, entry);
      }
    }
    if (!involvedBlockIds.has(blockId) && maximumDamage === 0) continue;
    const position = [...positions.values()].sort((a, b) => b.count - a.count)[0]?.position ?? original.position;
    damage.push({
      blockId,
      factionId: original.factionId,
      position: { ...position },
      minimumDamage: Number.isFinite(minimumDamage) ? minimumDamage : 0,
      maximumDamage,
      evadeChance: Math.max(0, Math.min(100, formation.unit.defence)),
      math: [
        `Observed across all ${outcomes.length} possible defence rolls.`,
        ...(mathByBlock.get(blockId) ?? ["No direct melee calculation affects this block."]),
      ],
    });
  }

  return {
    tiles: tiles.sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x || a.factionId.localeCompare(b.factionId)),
    damage: damage.sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x || a.factionId.localeCompare(b.factionId)),
  };
}
