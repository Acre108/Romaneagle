export type Faction = "roman" | "saxon";
export type UnitType =
  | "infantry"
  | "cavalry"
  | "skirmishers"
  | "archers"
  | "artillery"
  | "standard";
export type FormationShape =
  | "line"
  | "column"
  | "wedge"
  | "battery"
  | "shieldwall"
  | "tortoise"
  | "mob";
export type FormationSpacing = "close" | "loose" | "open";
export interface FormationConfiguration {
  shape: FormationShape;
  spacing: FormationSpacing;
  files: number;
}
export type UniqueAbilityType = "tortoise" | "shieldwall";
export type UnitState = "steady" | "shaken" | "routing" | "broken" | "escaped";
export type UnitTerrain =
  | "open"
  | "road"
  | "rough"
  | "woods"
  | "swamp"
  | "shallow water"
  | "deep water";
