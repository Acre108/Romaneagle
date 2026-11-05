import type { UnitState, UnitType } from "../units/types";

export interface BattleFormationResult {
  id: string;
  name: string;
  type: UnitType;
  soldierCount: number;
  maximumSoldiers: number;
  state: UnitState;
}

export interface BattleReport {
  outcome: "romanVictory" | "saxonVictory" | "mutualDestruction";
  formations: BattleFormationResult[];
}
