import { BALANCE } from "./config";
import type { EquipmentAbility, Formation, FormationMode, GameState, TroopBlock, UnitType } from "./types";

export function isInfantry(unitType: UnitType): boolean {
  return unitType === "light_infantry" || unitType === "medium_infantry" || unitType === "heavy_infantry";
}

export function isCavalry(unitType: UnitType): boolean {
  return unitType === "light_cavalry" || unitType === "heavy_cavalry";
}

export function hasEquipment(formation: Formation, ability: EquipmentAbility): boolean {
  return formation.unit.equipment.includes(ability);
}

export function modelCapacity(formation: Formation): number {
  return Math.max(1, Math.floor(BALANCE.formationModelSpace[formation.formationMode] / formation.unit.modelSize));
}

/** Bigger models are tougher, so one blow costs any full block about the same share of its strength. */
export function hitPointsPerModel(formationMode: FormationMode, modelSize: number): number {
  const capacity = Math.max(1, Math.floor(BALANCE.formationModelSpace[formationMode] / modelSize));
  return Math.max(1, Math.round(BALANCE.blockHitPointsTarget / capacity));
}

export function blockHitPoints(formation: Formation, block: TroopBlock): number {
  return Math.max(0, block.models * formation.unit.hitPointsPerModel - block.wounds);
}

export function blockModelsAfterDamage(formation: Formation, block: TroopBlock, damage: number): number {
  const remainingHitPoints = Math.max(0, blockHitPoints(formation, block) - Math.max(0, damage));
  return Math.ceil(remainingHitPoints / formation.unit.hitPointsPerModel);
}

export function formationModelCount(state: GameState, formation: Formation): number {
  return formation.blockIds.reduce((total, blockId) => total + (state.blocks[blockId]?.models ?? 0), 0);
}

export function formationPressure(formation: Formation): number {
  return BALANCE.unitTypePressure[formation.unit.unitType]
    + BALANCE.formationPressure[formation.formationMode];
}

export function formationResistance(formation: Formation): number {
  return BALANCE.unitTypeResistance[formation.unit.unitType]
    + BALANCE.formationResistance[formation.formationMode];
}
