import type { UnitState } from "../../units/types";
import type { Formation, GameState } from "../model/types";
import { originalFormationId } from "./splitting";

export interface FormationBattleBaseline {
  id: string;
  name: string;
  maximumStrength: number;
}

export interface GridFormationBattleResult extends FormationBattleBaseline {
  strength: number;
  casualties: number;
  state: UnitState;
}

function familyFormations(state: GameState, id: string): Formation[] {
  return Object.values(state.formations).filter((formation) => originalFormationId(formation.id) === id);
}

function escapedModels(state: GameState, id: string): number {
  const departed = new Map<string, number>();
  for (const departure of state.departedBlocks ?? []) {
    const formationId = departure.block.formationId;
    if (formationId !== null && originalFormationId(formationId) === id) {
      departed.set(departure.block.id, departure.block.models);
    }
  }
  return [...departed.values()].reduce((total, models) => total + models, 0);
}

function formationState(family: readonly Formation[], escapedStrength: number): UnitState {
  if (family.length === 0) return escapedStrength > 0 ? "escaped" : "broken";
  if (family.some((formation) => formation.status === "routed")) return "routing";
  if (family.some((formation) => formation.status === "disordered"
    || formation.cohesion / Math.max(1, formation.maxCohesion) < 0.55)) return "shaken";
  return "steady";
}

/** Compiles exact survivor, casualty, and morale results for each original formation family. */
export function compileFormationBattleResults(
  state: GameState,
  baselines: readonly FormationBattleBaseline[],
): GridFormationBattleResult[] {
  return baselines.map((baseline) => {
    const family = familyFormations(state, baseline.id);
    const onFieldStrength = family.flatMap((formation) => formation.blockIds)
      .reduce((total, blockId) => total + (state.blocks[blockId]?.models ?? 0), 0);
    const escapedStrength = escapedModels(state, baseline.id);
    const strength = Math.min(baseline.maximumStrength, onFieldStrength + escapedStrength);
    return {
      ...baseline,
      strength,
      casualties: Math.max(0, baseline.maximumStrength - strength),
      state: formationState(family, escapedStrength),
    };
  });
}
