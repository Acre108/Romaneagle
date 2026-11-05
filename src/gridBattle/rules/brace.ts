import { emitEvent } from "../events/events";
import type { Formation, GameState, TroopBlock } from "../model/types";
import { isInfantry } from "../model/unitStats";

export interface BraceResult {
  ok: boolean;
  reason?: string;
}

function formationBlocks(state: GameState, formation: Formation): TroopBlock[] {
  return formation.blockIds
    .map((blockId) => state.blocks[blockId])
    .filter((block): block is TroopBlock => block !== undefined);
}

export function canBraceFormation(state: GameState, formationId: string): BraceResult {
  const formation = state.formations[formationId];
  if (!formation) return { ok: false, reason: "Formation no longer exists." };
  if (formation.hasActivated) return { ok: false, reason: "Formation has already activated." };
  if (formation.isBraced) return { ok: false, reason: "Formation is already braced." };
  const blocks = formationBlocks(state, formation);
  if (blocks.length === 0 || !isInfantry(formation.unit.unitType) || formation.formationMode !== "closed") {
    return { ok: false, reason: "Only close-order infantry may brace." };
  }
  return { ok: true };
}

export function braceFormation(state: GameState, formationId: string): BraceResult {
  const legality = canBraceFormation(state, formationId);
  if (!legality.ok) return legality;
  const formation = state.formations[formationId]!;
  formation.isBraced = true;
  emitEvent(state, "formation_braced", `${formation.name} braced and gained +1 armour until it moves.`, {
    blockIds: [...formation.blockIds],
    formationIds: [formation.id],
  });
  return { ok: true };
}

export function clearFormationBrace(state: GameState, formationId: string | null | undefined): void {
  if (!formationId) return;
  const formation = state.formations[formationId];
  if (formation) formation.isBraced = false;
}

export function clearBlockFormationBrace(state: GameState, block: TroopBlock | undefined): void {
  clearFormationBrace(state, block?.formationId);
}
