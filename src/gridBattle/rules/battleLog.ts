import type { FactionId, GameEvent, GameEventDetail, PressureResult } from "../model/types";
import { blockFormationId, formationDisplayName, withFormationNames } from "./displayNames";
import { originalFormationId } from "./splitting";

export interface BattleLogEntry {
  headline: string;
  details: string[];
  /** Morale changes and routs: what the player most needs to see, kept apart from detail. */
  moraleNotes: string[];
}

const DEFAULT_ENTRY_LIMIT = 8;

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
  ended: Extract<GameEventDetail, { kind: "activation_ended" }> | null;
}

/** An activation in which nothing happened: shown grouped with the faction's other waits that round. */
interface Wait {
  factionId: FactionId | null;
  name: string;
}

interface LogItem {
  entry: BattleLogEntry;
  wait?: Wait;
}

function defaultFactionLabel(factionId: FactionId): string {
  return factionId === "roman" ? "Romans" : "Saxons";
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
      if (formationId) {
        tally.actor = formationId;
        tally.ended = detail?.kind === "activation_ended" ? detail : null;
      } else {
        recordPlainEvent(tally, event, named);
      }
      return;
    case "engaged_order_resolved":
      if (!formationId) recordPlainEvent(tally, event, named);
      else if (detail?.kind === "engaged_order") tally.headlines.push(`${formationDisplayName(names, formationId)} ${detail.order === "press" ? "pressed" : "fought a Battle"}.`);
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
      else if (detail?.kind === "turned") tally.headlines.push(`${formationDisplayName(names, formationId)} turned to face ${detail.facing}.`);
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

function composeEntry(tally: ActivationTally, names: ReadonlyMap<string, string>): LogItem | null {
  const { headlines, details, moraleNotes, losses, results, steps, finalFacing, actor, ended } = tally;
  for (const [key, count] of steps) {
    const facing = finalFacing.get(key);
    headlines.unshift(`${formationDisplayName(names, key)} moved ${squares(count)}${facing ? `, facing ${facing}` : ""}.`);
  }
  if (headlines.length === 0 && actor && details.length === 0 && moraleNotes.length === 0 && losses.size === 0) {
    const name = formationDisplayName(names, actor);
    if (ended?.moraleRecovered !== undefined) {
      const headline = ended.moraleRecovered > 0
        ? `${name} held and recovered ${ended.moraleRecovered} morale.`
        : `${name} held; its morale is already full.`;
      return { entry: { headline, details: [], moraleNotes: [] } };
    }
    return { entry: { headline: `${name} waited.`, details: [], moraleNotes: [] }, wait: { factionId: ended?.factionId ?? null, name } };
  }
  for (const [key, tallyByResult] of results) {
    const words = RESULT_WORDS.flatMap(([result, word]) => {
      const count = tallyByResult.get(result) ?? 0;
      return count > 0 ? [`${word} ×${count}`] : [];
    });
    details.unshift(`${formationDisplayName(names, key)}: ${words.join(", ")}.`);
  }
  if (losses.size > 0) {
    details.push(`Lost: ${[...losses].map(([key, count]) => `${formationDisplayName(names, key)} ${count}`).join(", ")}.`);
  }
  const headline = headlines.shift() ?? details.shift() ?? moraleNotes[0];
  if (!headline) return null;
  return {
    entry: {
      headline,
      details: [...headlines, ...details],
      moraleNotes: moraleNotes.filter((note) => note !== headline),
    },
  };
}

/** Turns one activation's raw events into a line a player can read. */
function summarise(events: readonly GameEvent[], names: ReadonlyMap<string, string>): LogItem | null {
  const tally: ActivationTally = {
    headlines: [],
    details: [],
    moraleNotes: [],
    losses: new Map(),
    results: new Map(),
    steps: new Map(),
    finalFacing: new Map(),
    actor: null,
    ended: null,
  };
  for (const event of events) recordEvent(tally, event, names);
  return composeEntry(tally, names);
}

/**
 * The battle so far, newest first, one entry per activation. Formations that only ended
 * their activation are gathered into one "waited" line per faction and round, placed at the latest wait.
 */
export function battleLogEntries(
  eventLog: readonly GameEvent[],
  names: ReadonlyMap<string, string>,
  limit = DEFAULT_ENTRY_LIMIT,
  factionLabel: (factionId: FactionId) => string = defaultFactionLabel,
): BattleLogEntry[] {
  const entries: BattleLogEntry[] = [];
  const waits = new Map<FactionId, { entry: BattleLogEntry; names: string[] }>();
  let group: GameEvent[] = [];
  const flush = (): void => {
    const item = summarise(group, names);
    group = [];
    if (!item) return;
    const factionId = item.wait?.factionId;
    if (!item.wait || !factionId) {
      entries.push(item.entry);
      return;
    }
    const previous = waits.get(factionId);
    if (previous) entries.splice(entries.indexOf(previous.entry), 1);
    const waited = [...(previous?.names ?? []), item.wait.name];
    const entry: BattleLogEntry = { headline: `${factionLabel(factionId)} waited: ${waited.join(", ")}.`, details: [], moraleNotes: [] };
    waits.set(factionId, { entry, names: waited });
    entries.push(entry);
  };
  for (const event of eventLog) {
    if (event.type === "round_started") {
      flush();
      waits.clear();
      entries.push({ headline: event.message.split(".")[0] + ".", details: [], moraleNotes: [] });
      continue;
    }
    group.push(event);
    if (event.type === "activation_ended") flush();
  }
  flush();
  return entries.slice(-limit).reverse();
}
