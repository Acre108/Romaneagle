import type {
  CombatBlockDamagePreview,
  FactionId,
  GameState,
  MoraleReason,
  GridPosition,
  OrderPreviewTile,
  PressurePreview,
  PressureResult,
  TroopBlock,
} from "../model/types";
import { blockHitPoints } from "../model/unitStats";
import { positionKey } from "../model/occupancy";
import { originalFormationId, familyDisplayName } from "./splitting";

function blockChanged(before: TroopBlock, after: TroopBlock | undefined): boolean {
  return !after
    || positionKey(before.position) !== positionKey(after.position)
    || before.models !== after.models
    || before.wounds !== after.wounds
    || before.wavering !== after.wavering
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
    ...(preview.defence > 0 ? [`Defence: ${preview.defence}% evade; ${100 - preview.defence}% hit`] : []),
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
  forecast: string[];
}

const RESULT_LABELS: readonly [PressureResult, string][] = [
  ["scattered", "Scattered"], ["pushed", "Pushed"], ["wavers", "Wavers"], ["holds", "Holds"],
];

const RESULT_WORDS: Readonly<Record<PressureResult, string>> = { scattered: "Scattered", pushed: "Pushed", wavers: "Wavers", holds: "Holds" };

/** Groups contacts with matching odds, e.g. `3 contacts from the front: pressure 10 vs 8 \u00b7 Pushed \u00b7 1 damage each`. */
export function contactSummaryLines(previews: readonly PressurePreview[]): string[] {
  const groups = new Map<string, { preview: PressurePreview; count: number }>();
  for (const preview of previews) {
    const key = [preview.attackingPressure, preview.defendingResistance, preview.result, preview.contactEdge, preview.expectedDamage].join("|");
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { preview, count: 1 });
  }
  return [...groups.values()].map(({ preview, count }) => [
    `${count} contact${count === 1 ? "" : "s"} from the ${preview.contactEdge}: pressure ${preview.attackingPressure} vs ${preview.defendingResistance}`,
    RESULT_WORDS[preview.result],
    `${preview.expectedDamage} damage${count === 1 ? "" : " each"}`,
  ].join(" \u00b7 "));
}

interface FamilyMorale {
  morale: number;
  routed: boolean;
}

function familyMorale(state: GameState, originalId: string): FamilyMorale {
  const family = Object.values(state.formations).filter((formation) => originalFormationId(formation.id) === originalId);
  if (family.length === 0) return { morale: 0, routed: true };
  return {
    morale: Math.max(...family.map((formation) => formation.cohesion)),
    routed: family.some((formation) => formation.status === "routed"),
  };
}

const MORALE_REASON_LABELS: Readonly<Record<MoraleReason, string>> = {
  pushed: "pushed",
  flanked: "flanked",
  rear: "rear attack",
  outnumbered: "outnumbered",
  losses: "losses",
  too_few: "too few left",
  neighbour_routed: "neighbour routed",
  leader_lost: "leader lost",
};

/** Each morale loss a simulation caused, as "−2 flanked", keyed by original formation. */
function moraleLossLabels(before: GameState, outcome: GameState): Map<string, string[]> {
  const labels = new Map<string, string[]>();
  for (const event of outcome.eventLog) {
    if (event.id < before.nextEventId || event.detail?.kind !== "morale") continue;
    const formationId = event.formationIds?.[0];
    if (!formationId) continue;
    const key = originalFormationId(formationId);
    const label = `\u2212${event.detail.lost} ${event.detail.reasons.map((reason) => MORALE_REASON_LABELS[reason]).join(" + ")}`;
    labels.set(key, [...(labels.get(key) ?? []), label]);
  }
  return labels;
}

/** Reasons found in every outcome read plainly; reasons only some outcomes reach end in "?". */
function moraleReasonText(perOutcome: readonly (readonly string[])[]): string {
  const ordered: string[] = [];
  for (const labels of perOutcome) for (const label of labels) if (!ordered.includes(label)) ordered.push(label);
  if (ordered.length === 0) return "";
  const text = ordered.map((label) => perOutcome.every((labels) => labels.includes(label)) ? label : `${label}?`);
  return ` (${text.join(", ")})`;
}

function moraleText(before: FamilyMorale, after: readonly FamilyMorale[], reasons = ""): string {
  if (before.routed) return "Already routing";
  const values = after.map((entry) => entry.morale);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const afterText = low === high ? String(low) : `${low}\u2013${high}`;
  const routs = after.filter((entry) => entry.routed).length;
  const verdict = routs === 0 ? "" : routs === after.length ? " \u00b7 ROUTS" : " \u00b7 may rout";
  return low === before.morale && high === before.morale
    ? `Morale ${before.morale}${verdict}`
    : `Morale ${before.morale} \u2192 ${afterText}${reasons}${verdict}`;
}

/**
 * Says what an order will do to each formation in the words a player acts on. Result
 * words come from the first outcome: pressure never depends on the defence roll.
 */
export function combatForecast(before: GameState, outcomes: readonly GameState[]): string[] {
  if (outcomes.length === 0) return [];
  const results = new Map<string, Map<PressureResult, number>>();
  for (const event of outcomes[0]!.eventLog) {
    if (event.id < before.nextEventId || !event.pressureResult) continue;
    const defenderId = event.blockIds?.[1];
    const formationId = defenderId ? before.blocks[defenderId]?.formationId : null;
    if (!formationId) continue;
    const originalId = originalFormationId(formationId);
    const tally = results.get(originalId) ?? new Map<PressureResult, number>();
    tally.set(event.pressureResult, (tally.get(event.pressureResult) ?? 0) + 1);
    results.set(originalId, tally);
  }
  const originalIds = [...new Set(Object.keys(before.formations).map(originalFormationId))];
  const lossLabels = outcomes.map((outcome) => moraleLossLabels(before, outcome));
  const rows: { enemy: boolean; text: string }[] = [];
  for (const originalId of originalIds) {
    const start = familyMorale(before, originalId);
    const after = outcomes.map((outcome) => familyMorale(outcome, originalId));
    const tally = results.get(originalId);
    if (!tally && after.every((entry) => entry.morale === start.morale)) continue;
    const member = Object.values(before.formations).find((formation) => originalFormationId(formation.id) === originalId)!;
    const name = familyDisplayName(member.name);
    const words = RESULT_LABELS.flatMap(([result, label]) => {
      const count = tally?.get(result) ?? 0;
      return count > 0 ? [`${label} \u00d7${count}`] : [];
    });
    rows.push({
      enemy: member.factionId !== before.activeFactionId,
      text: [
        `${name}: ${moraleText(start, after, moraleReasonText(lossLabels.map((labels) => labels.get(originalId) ?? [])))}`,
        words.join(", "),
      ].filter(Boolean).join(" \u00b7 "),
    });
  }
  return rows.sort((a, b) => Number(b.enemy) - Number(a.enemy)).map((row) => row.text);
}

const FACTION_PLURAL: Readonly<Record<FactionId, [string, string]>> = {
  roman: ["Roman", "Romans"],
  saxon: ["Saxon", "Saxons"],
};

/** "~3 Saxons and ~1 Roman fall" for one typical outcome; men who flee the field count as fallen. */
export function typicalLossesText(before: GameState, outcome: GameState): string {
  const lost = new Map<FactionId, number>();
  for (const block of Object.values(before.blocks)) {
    const remaining = outcome.blocks[block.id]?.models ?? 0;
    if (remaining < block.models) lost.set(block.factionId, (lost.get(block.factionId) ?? 0) + block.models - remaining);
  }
  const order: FactionId[] = before.activeFactionId === "roman" ? ["saxon", "roman"] : ["roman", "saxon"];
  const parts = order.map((factionId) => {
    const count = lost.get(factionId) ?? 0;
    const [one, many] = FACTION_PLURAL[factionId];
    return `~${count} ${count === 1 ? one : many}`;
  });
  return `${parts.join(" and ")} fall`;
}

/**
 * Two lines that set an order beside its alternative from one typical outcome each. The
 * forecast above already gives this order's results, so its line adds only the losses;
 * the alternative names just the formations whose result would differ.
 */
export function orderComparisonLines(
  before: GameState,
  chosen: { label: string; outcome: GameState; note?: string },
  alternative: { label: string; outcome: GameState; note?: string } | null,
): string[] {
  const join = (parts: readonly string[]): string => parts.filter(Boolean).join(" \u00b7 ");
  const lines = [`${chosen.label}: ${join([typicalLossesText(before, chosen.outcome), chosen.note ?? ""])}`];
  if (!alternative) return lines;
  const chosenRows = new Set(combatForecast(before, [chosen.outcome]));
  const changed = combatForecast(before, [alternative.outcome]).filter((row) => !chosenRows.has(row));
  lines.push(`${alternative.label}: ${join([
    changed.length > 0 ? changed.join("; ") : "same results",
    typicalLossesText(before, alternative.outcome),
    alternative.note ?? "",
  ])}`);
  return lines;
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
  if (outcomes.length === 0) return { tiles: [], damage: [], forecast: [] };
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
    forecast: combatForecast(before, outcomes),
  };
}
