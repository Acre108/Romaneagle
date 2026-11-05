import type { GameEvent, PressureResult } from "../model/types";
import { originalFormationId } from "./splitting";

export interface BattleLogEntry {
  headline: string;
  details: string[];
  /** Morale changes and routs: what the player most needs to see, kept apart from detail. */
  moraleNotes: string[];
}

const DEFAULT_ENTRY_LIMIT = 8;
const BLOCK_ID_PATTERN = /[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*-b\d+/g;
const FRAGMENT_SUFFIX = / – (Main Body|Fragment [A-Z]+)$/;
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
  return (name ?? originalFormationId(formationId).replaceAll("-", " ")).replace(FRAGMENT_SUFFIX, "");
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

/** Turns one activation's raw events into a line a player can read. */
function summarise(events: readonly GameEvent[], names: ReadonlyMap<string, string>): BattleLogEntry | null {
  const headlines: string[] = [];
  const details: string[] = [];
  const moraleNotes: string[] = [];
  const losses = new Map<string, number>();
  const results = new Map<string, Map<PressureResult, number>>();
  const steps = new Map<string, number>();
  const finalFacing = new Map<string, string>();
  let actor: string | null = null;

  for (const event of events) {
    const formationId = event.formationIds?.[0];
    if (event.type === "activation_ended" && formationId) actor = formationId;
    else if (event.type === "engaged_order_resolved" && formationId) {
      const order = /chose to (battle|press)/.exec(event.message)?.[1];
      if (order) headlines.push(`${formationName(names, formationId)} ${order === "press" ? "pressed" : "fought a Battle"}.`);
      else headlines.push(withFormationNames(event.message, names));
    } else if (event.type === "formation_moved" && formationId) {
      if (/ moved (north|east|south|west)\.$/.test(event.message)) {
        const key = originalFormationId(formationId);
        steps.set(key, (steps.get(key) ?? 0) + 1);
      } else if (/ charged /.test(event.message)) {
        headlines.push(withFormationNames(event.message, names));
      } else if (/ fled /.test(event.message)) {
        moraleNotes.push(withFormationNames(event.message, names));
      }
    } else if (event.type === "formation_rotated" && formationId) {
      const facing = /facing (north|east|south|west)\.$/.exec(event.message)?.[1];
      const turned = /turned to face (north|east|south|west)\.$/.exec(event.message)?.[1];
      if (turned) headlines.push(`${formationName(names, formationId)} turned to face ${turned}.`);
      else if (facing) finalFacing.set(originalFormationId(formationId), facing);
    } else if (event.type === "formation_merged" && event.message.includes("regrouped")) {
      details.push(withFormationNames(event.message, names));
    } else if (event.type === "ranged_volley" || event.type === "formation_braced" || event.type === "formation_merged") {
      headlines.push(withFormationNames(event.message, names));
    } else if (event.type === "block_damaged" && formationId && event.casualties) {
      const key = originalFormationId(formationId);
      losses.set(key, (losses.get(key) ?? 0) + event.casualties);
    } else if (event.type === "pressure_applied" && event.pressureResult && event.blockIds?.[1]) {
      const key = blockFormationId(event.blockIds[1]);
      const tally = results.get(key) ?? new Map<PressureResult, number>();
      tally.set(event.pressureResult, (tally.get(event.pressureResult) ?? 0) + 1);
      results.set(key, tally);
    } else if (MORALE_EVENTS.has(event.type)) {
      moraleNotes.push(withFormationNames(event.message, names));
    } else if (REPORTED_EVENTS.has(event.type) && !event.message.includes("moved to the new centre")) {
      details.push(withFormationNames(event.message, names));
    }
  }

  for (const [key, count] of steps) {
    const facing = finalFacing.get(key);
    headlines.unshift(`${formationName(names, key)} moved ${squares(count)}${facing ? `, facing ${facing}` : ""}.`);
  }
  if (headlines.length === 0 && actor && details.length === 0 && moraleNotes.length === 0 && losses.size === 0) {
    headlines.push(`${formationName(names, actor)} held its ground.`);
  }
  for (const [key, tally] of results) {
    const words = RESULT_WORDS.flatMap(([result, word]) => {
      const count = tally.get(result) ?? 0;
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
