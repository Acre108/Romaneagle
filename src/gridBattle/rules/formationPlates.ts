import { BALANCE } from "../model/config";
import type { GameState, GridPosition } from "../model/types";
import { manhattanDistance } from "./direction";
import { originalFormationId } from "./splitting";

export type PlateTone = "steady" | "shaken" | "breaking";

export interface FormationPlate {
  key: string;
  text: string;
  tone: PlateTone;
  position: GridPosition;
}

const STEADY_MORALE_SHARE = 0.7;

function shortName(name: string): string {
  const withoutFragment = name.replace(/ – (Main Body|Fragment [A-Z]+)$/, "");
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
    const share = morale / Math.max(1, members[0]!.maxCohesion);
    plates.push({
      key,
      text: routed
        ? `${shortName(members[0]!.name)}  ROUTING  ${men}`
        : `${shortName(members[0]!.name)}  ♥${morale}  ${men}`,
      tone: routed || morale <= BALANCE.breakingMoraleThreshold ? "breaking"
        : share >= STEADY_MORALE_SHARE ? "steady" : "shaken",
      position: { ...anchor.position },
    });
  }
  return plates.sort((a, b) => a.key.localeCompare(b.key));
}
