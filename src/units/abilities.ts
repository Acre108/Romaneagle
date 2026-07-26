import { applyFormation } from "./formation";
import {
  isUnitInactive,
  type FormationType,
  type UniqueAbilityType,
  type Unit,
} from "./types";

export interface UniqueAbilityDefinition {
  id: UniqueAbilityType;
  label: string;
  formation: FormationType;
}

const ABILITIES: Record<UniqueAbilityType, UniqueAbilityDefinition> = {
  tortoise: {
    id: "tortoise",
    label: "Tortoise",
    formation: "tortoise",
  },
  shieldwall: {
    id: "shieldwall",
    label: "Shieldwall",
    formation: "shieldwall",
  },
};

export function getUniqueAbility(
  unit: Pick<Unit, "uniqueAbility">,
): UniqueAbilityDefinition | undefined {
  return unit.uniqueAbility === undefined ? undefined : ABILITIES[unit.uniqueAbility];
}

export function canUseUniqueAbility(
  unit: Pick<Unit, "uniqueAbility" | "state" | "formationChangeTimer">,
): boolean {
  return getUniqueAbility(unit) !== undefined &&
    !isUnitInactive(unit) &&
    unit.state !== "routing" &&
    unit.formationChangeTimer <= 0;
}

export function useUniqueAbility(unit: Unit): boolean {
  const ability = getUniqueAbility(unit);
  if (
    ability === undefined ||
    !canUseUniqueAbility(unit) ||
    unit.formation === ability.formation
  ) return false;

  applyFormation(unit, ability.formation);
  return true;
}
