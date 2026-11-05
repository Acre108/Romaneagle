import { BALANCE } from "../model/config";
import type { Direction, FactionId, Formation, GameState, GridPosition } from "../model/types";
import { manhattanDistance } from "./direction";
import { originalFormationId, familyDisplayName } from "./splitting";

export type PlateTone = "steady" | "shaken" | "breaking";
/** Ready: can still act this round. Spent: has acted. Routing formations run on their own. */
export type PlateActivation = "ready" | "spent" | "routing";

export interface FormationPlate {
  key: string;
  text: string;
  tone: PlateTone;
  factionId: FactionId;
  position: GridPosition;
  facing: Direction;
  /** The facing as it looks on screen: north is drawn toward the upper right of the isometric board. */
  arrow: string;
  activation: PlateActivation;
}

export const FACING_ARROWS: Readonly<Record<Direction, string>> = {
  north: "↗",
  east: "↘",
  south: "↙",
  west: "↖",
};

const STEADY_MORALE_SHARE = 0.7;

export function moraleTone(formation: Pick<Formation, "cohesion" | "maxCohesion" | "status">): PlateTone {
  if (formation.status === "routed" || formation.cohesion <= BALANCE.breakingMoraleThreshold) return "breaking";
  return formation.cohesion / Math.max(1, formation.maxCohesion) >= STEADY_MORALE_SHARE ? "steady" : "shaken";
}

export function moraleWord(formation: Pick<Formation, "cohesion" | "maxCohesion" | "status">): string {
  if (formation.status === "routed") return "Routing";
  const tone = moraleTone(formation);
  return tone === "steady" ? "Steady" : tone === "shaken" ? "Shaken" : "Breaking";
}

function shortName(name: string): string {
  const withoutFragment = familyDisplayName(name);
  return withoutFragment.split(" · ").at(-1) ?? withoutFragment;
}

/** One always-visible label per formation, for both sides: name, morale, and men left. */
export function formationPlates(state: GameState): FormationPlate[] {
  const families = new Map<string, string[]>();
  for (const formation of Object.values(state.formations)) {
    const key = originalFormationId(formation.id);
    families.set(key, [...(families.get(key) ?? []), formation.id]);
  }
  const plates: FormationPlate[] = [];
  for (const [key, formationIds] of families) {
    const members = formationIds.map((id) => state.formations[id]!);
    const blocks = members.flatMap((formation) => formation.blockIds)
      .map((id) => state.blocks[id])
      .filter((block) => block !== undefined);
    if (blocks.length === 0) continue;
    const centre = {
      x: blocks.reduce((total, block) => total + block.position.x, 0) / blocks.length,
      y: blocks.reduce((total, block) => total + block.position.y, 0) / blocks.length,
    };
    const anchor = [...blocks].sort((a, b) =>
      manhattanDistance(a.position, centre) - manhattanDistance(b.position, centre) || a.id.localeCompare(b.id))[0]!;
    const men = blocks.reduce((total, block) => total + block.models, 0);
    const routed = members.some((formation) => formation.status === "routed");
    const morale = Math.max(...members.map((formation) => formation.cohesion));
    plates.push({
      key,
      text: routed
        ? `${shortName(members[0]!.name)}  ROUTING  ${men}`
        : `${shortName(members[0]!.name)}  ♥${morale}  ${men}`,
      tone: moraleTone({ cohesion: morale, maxCohesion: members[0]!.maxCohesion, status: routed ? "routed" : "formed" }),
      factionId: members[0]!.factionId,
      position: { ...anchor.position },
      facing: members[0]!.facing,
      arrow: FACING_ARROWS[members[0]!.facing],
      activation: routed ? "routing" : members.some((formation) => formation.hasActivated) ? "spent" : "ready",
    });
  }
  return plates.sort((a, b) => a.key.localeCompare(b.key));
}
