import type { UnitArchetypeProfile } from "../../units/UnitArchetypes";
import type { UnitType } from "../model/types";

/** The grid-battle unit type a catalogue archetype fights as. Its movement and base stats come from this. */
export function gridUnitType(archetype: UnitArchetypeProfile): UnitType {
  if (archetype.type === "archers" || archetype.type === "skirmishers" || archetype.type === "artillery") return "light_infantry";
  if (archetype.type === "cavalry") {
    return archetype.unitClass === "heavy cavalry" ? "heavy_cavalry" : "light_cavalry";
  }
  if (archetype.type === "infantry") {
    return archetype.unitClass === "heavy infantry" ? "heavy_infantry" : "medium_infantry";
  }
  throw new Error(`${archetype.name} cannot deploy in the grid battle.`);
}
