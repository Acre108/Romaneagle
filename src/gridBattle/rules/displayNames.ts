import type { GameState } from "../model/types";
import { familyDisplayName, originalFormationId } from "./splitting";

/** A block id, including the overflow blocks a formation sheds on crowded ground. */
const BLOCK_ID_PATTERN = /[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*-b\d+(?:-overflow-\d+)*/g;
const FRAGMENT_LABEL = / – (Main Body|Fragment [A-Z]+)/g;

/** Keeps names of formations seen so far, so a destroyed formation can still be named in messages about it. */
export function rememberFormationNames(state: Pick<GameState, "formations">, names: Map<string, string>): void {
  for (const formation of Object.values(state.formations)) {
    const key = originalFormationId(formation.id);
    if (!names.has(key)) names.set(key, formation.name);
  }
}

export function formationDisplayName(names: ReadonlyMap<string, string>, formationId: string): string {
  const name = names.get(originalFormationId(formationId));
  return familyDisplayName(name ?? originalFormationId(formationId).replaceAll("-", " "));
}

export function blockFormationId(blockId: string): string {
  return originalFormationId(blockId.replace(/-b\d+(?:-overflow-\d+)*$/, ""));
}

/** Rule messages name blocks by id, which means nothing to a player. This says which formation instead. */
export function withFormationNames(message: string, names: ReadonlyMap<string, string>): string {
  return message
    .replace(BLOCK_ID_PATTERN, (blockId) => formationDisplayName(names, blockFormationId(blockId)))
    .replace(FRAGMENT_LABEL, "");
}
