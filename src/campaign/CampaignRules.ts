import type { BattleFormationResult } from "./BattleReport";
import type {
  CompanionDefinition,
  RomanFormationDefinition,
} from "../scenario/Roster";

export function formationHealthPercent(
  formation: Pick<BattleFormationResult, "soldierCount" | "maximumSoldiers">,
): number {
  if (formation.maximumSoldiers <= 0) return 0;
  return Math.round(formation.soldierCount / formation.maximumSoldiers * 100);
}

export function formationHealthLabel(
  formation: Pick<BattleFormationResult, "soldierCount" | "maximumSoldiers" | "state">,
): string {
  const health = formationHealthPercent(formation);
  if (formation.state === "broken" || health === 0) return "Lost";
  if (formation.state === "escaped") return "Escaped";
  if (formation.state === "routing") return "Routing";
  if (health < 35) return "Mauled";
  if (health < 70) return "Bloodied";
  if (formation.state === "shaken") return "Shaken";
  return "Battle-ready";
}

export function formationExperience(
  formation: Pick<BattleFormationResult, "soldierCount" | "maximumSoldiers" | "type" | "state">,
): number {
  if (formation.soldierCount <= 0 || formation.state === "broken") return 0;
  const typeBonus = formation.type === "cavalry" ? 8
    : formation.type === "infantry" ? 6
      : formation.type === "archers" ? 5 : 0;
  const casualtyPercent = 100 - formationHealthPercent(formation);
  const hardshipBonus = Math.round(casualtyPercent * 0.3);
  const stateAdjustment = formation.state === "escaped" ? -15
    : formation.state === "routing" ? -10 : 0;
  return Math.max(10, 40 + typeBonus + hardshipBonus + stateAdjustment);
}

export function formationCasualties(
  formation: Pick<BattleFormationResult, "soldierCount" | "maximumSoldiers">,
): number {
  return Math.max(0, formation.maximumSoldiers - formation.soldierCount);
}

export function deployedStrength(
  roster: readonly RomanFormationDefinition[],
  selectedUnitIds: ReadonlySet<string>,
): number {
  let total = 0;
  for (const formation of roster) {
    if (selectedUnitIds.has(formation.id)) total += formation.count;
  }
  return total;
}

export function afterBattleLine(
  companion: CompanionDefinition,
  formation: BattleFormationResult | undefined,
): string {
  if (!formation) return companion.afterBattleLine;
  const health = formationHealthPercent(formation);
  if (formation.state === "broken" || formation.state === "escaped" || health === 0) return companion.lostLine;
  if (formation.state === "routing" || formation.state === "shaken" || health < 55) return companion.bloodiedLine;
  return companion.afterBattleLine;
}
