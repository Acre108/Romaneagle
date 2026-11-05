import type { GameEvent, PressureResult } from "../model/types";
import { originalFormationId, familyDisplayName } from "./splitting";

export interface BattleLogEntry {
  headline: string;
  details: string[];
  /** Morale changes and routs: what the player most needs to see, kept apart from detail. */
  moraleNotes: string[];
}

const DEFAULT_ENTRY_LIMIT = 8;
const BLOCK_ID_PATTERN = /[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*-b\d+/g;
const FRAGMENT_LABEL = / – (Main Body|Fragment [A-Z]+)/g;

/** Reported as they are written, because they already name formations and matter to the player. */
const REPORTED_EVENTS: ReadonlySet<GameEvent["type"]> = new Set<GameEvent["type"]>([
  "formation_split",
  "formation_split_confirmed",
  "formation_wavered",
  "block_drowned",
  "block_fell",
  "contested_cell_created",
  "character_transferred",
  "duel_started",
  "duel_resolved",
  "trigger_fired",
  "trigger_spawned",
]);

const MORALE_EVENTS: ReadonlySet<GameEvent["type"]> = new Set<GameEvent["type"]>([
  "morale_shock",
  "formation_routed",
  "formation_rallied",
  "formation_escaped",
]);

const RESULT_WORDS: readonly [PressureResult, string][] = [
  ["scattered", "scattered"], ["pushed", "pushed"], ["wavers", "wavers"], ["holds", "holds"],
];

function formationName(names: ReadonlyMap<string, string>, formationId: string): string {
  const name = names.get(originalFormationId(formationId));
  return familyDisplayName(name ?? originalFormationId(formationId).replaceAll("-", " "));
}

function blockFormationId(blockId: string): string {
  return originalFormationId(blockId.replace(/-b\d+$/, ""));
}

function withFormationNames(message: string, names: ReadonlyMap<string, string>): string {
  return message
    .replace(BLOCK_ID_PATTERN, (blockId) => formationName(names, blockFormationId(blockId)))
    .replace(FRAGMENT_LABEL, "");
}

function squares(count: number): string {
  return `${count} ${count === 1 ? "square" : "squares"}`;
}

interface ActivationTally {
  headlines: string[];
  details: string[];
  moraleNotes: string[];
  losses: Map<string, number>;
  results: Map<string, Map<PressureResult, number>>;
  steps: Map<string, number>;
  finalFacing: Map<string, string>;
  actor: string | null;
}

function addToCount<K>(counts: Map<K, number>, key: K, amount: number): void {
  counts.set(key, (counts.get(key) ?? 0) + amount);
}

/** Events with no special handling: the morale and reported sets decide where their message goes. */
function recordPlainEvent(tally: ActivationTally, event: GameEvent, named: string): void {
  if (MORALE_EVENTS.has(event.type)) tally.moraleNotes.push(named);
  else if (REPORTED_EVENTS.has(event.type) && event.detail?.kind !== "leader_repositioned") tally.details.push(named);
}

function recordEvent(tally: ActivationTally, event: GameEvent, names: ReadonlyMap<string, string>): void {
  const formationId = event.formationIds?.[0];
  const named = withFormationNames(event.message, names);
  const detail = event.detail;
  switch (event.type) {
    case "activation_ended":
      if (formationId) tally.actor = formationId;
      else recordPlainEvent(tally, event, named);
      return;
    case "engaged_order_resolved":
      if (!formationId) recordPlainEvent(tally, event, named);
      else if (detail?.kind === "engaged_order") tally.headlines.push(`${formationName(names, formationId)} ${detail.order === "press" ? "pressed" : "fought a Battle"}.`);
      else tally.headlines.push(named);
      return;
    case "formation_moved":
      if (!formationId) recordPlainEvent(tally, event, named);
      else if (detail?.kind === "step") addToCount(tally.steps, originalFormationId(formationId), 1);
      else if (detail?.kind === "charge") tally.headlines.push(named);
      else if (detail?.kind === "flight") tally.moraleNotes.push(named);
      return;
    case "formation_rotated":
      if (!formationId) recordPlainEvent(tally, event, named);
      else if (detail?.kind === "turned") tally.headlines.push(`${formationName(names, formationId)} turned to face ${detail.facing}.`);
      else if (detail?.kind === "final_facing") tally.finalFacing.set(originalFormationId(formationId), detail.facing);
      return;
    case "formation_merged":
      if (detail?.kind === "regrouped") tally.details.push(named);
      else tally.headlines.push(named);
      return;
    case "ranged_volley":
    case "formation_braced":
      tally.headlines.push(named);
      return;
    case "block_damaged":
      if (formationId && event.casualties) addToCount(tally.losses, originalFormationId(formationId), event.casualties);
      else recordPlainEvent(tally, event, named);
      return;
    case "pressure_applied": {
      const targetBlockId = event.blockIds?.[1];
      if (!event.pressureResult || !targetBlockId) {
        recordPlainEvent(tally, event, named);
        return;
      }
      const key = blockFormationId(targetBlockId);
      const counts = tally.results.get(key) ?? new Map<PressureResult, number>();
      addToCount(counts, event.pressureResult, 1);
      tally.results.set(key, counts);
      return;
    }
    default:
      recordPlainEvent(tally, event, named);
  }
}

function composeEntry(tally: ActivationTally, names: ReadonlyMap<string, string>): BattleLogEntry | null {
  const { headlines, details, moraleNotes, losses, results, steps, finalFacing, actor } = tally;
  for (const [key, count] of steps) {
    const facing = finalFacing.get(key);
    headlines.unshift(`${formationName(names, key)} moved ${squares(count)}${facing ? `, facing ${facing}` : ""}.`);
  }
  if (headlines.length === 0 && actor && details.length === 0 && moraleNotes.length === 0 && losses.size === 0) {
    headlines.push(`${formationName(names, actor)} held its ground.`);
  }
  for (const [key, tallyByResult] of results) {
    const words = RESULT_WORDS.flatMap(([result, word]) => {
      const count = tallyByResult.get(result) ?? 0;
      return count > 0 ? [`${word} ×${count}`] : [];
    });
    details.unshift(`${formationName(names, key)}: ${words.join(", ")}.`);
  }
  if (losses.size > 0) {
    details.push(`Lost: ${[...losses].map(([key, count]) => `${formationName(names, key)} ${count}`).join(", ")}.`);
  }
  const headline = headlines.shift() ?? details.shift() ?? moraleNotes[0];
  if (!headline) return null;
  return {
    headline,
    details: [...headlines, ...details],
    moraleNotes: moraleNotes.filter((note) => note !== headline),
  };
}

/** Turns one activation's raw events into a line a player can read. */
function summarise(events: readonly GameEvent[], names: ReadonlyMap<string, string>): BattleLogEntry | null {
  const tally: ActivationTally = {
    headlines: [],
    details: [],
    moraleNotes: [],
    losses: new Map(),
    results: new Map(),
    steps: new Map(),
    finalFacing: new Map(),
    actor: null,
  };
  for (const event of events) recordEvent(tally, event, names);
  return composeEntry(tally, names);
}

/** The battle so far, newest first, one entry per activation. */
export function battleLogEntries(
  eventLog: readonly GameEvent[],
  names: ReadonlyMap<string, string>,
  limit = DEFAULT_ENTRY_LIMIT,
): BattleLogEntry[] {
  const entries: BattleLogEntry[] = [];
  let group: GameEvent[] = [];
  const flush = (): void => {
    const entry = summarise(group, names);
    if (entry) entries.push(entry);
    group = [];
  };
  for (const event of eventLog) {
    if (event.type === "round_started") {
      flush();
      entries.push({ headline: event.message.split(".")[0] + ".", details: [], moraleNotes: [] });
      continue;
    }
    group.push(event);
    if (event.type === "activation_ended") flush();
  }
  flush();
  return entries.slice(-limit).reverse();
}
