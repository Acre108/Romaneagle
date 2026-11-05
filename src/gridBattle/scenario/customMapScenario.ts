import { getUnitArchetype, type UnitArchetypeProfile } from "../../units/UnitArchetypes";
import { parseBattlefieldMap, serializeBattlefieldMap, type BattlefieldMap } from "../model/battlefieldMap";
import { createBattleState, createFormation, deployFormation } from "../model/battleStateFactory";
import type { FormationMode, GameState } from "../model/types";
import { archetypeCohesion, archetypeUnitProfile, startingAmmunition } from "./archetypeUnits";

function formationMode(archetype: UnitArchetypeProfile): FormationMode {
  return archetype.spacing === "close" ? "closed" : "open";
}

export function createCustomMapScenario(source: BattlefieldMap): GameState {
  const state = createBattleState(parseBattlefieldMap(serializeBattlefieldMap(source)));
  for (const deployment of state.battlefield.deployments) {
    const archetype = getUnitArchetype(deployment.archetypeId);
    const mode = formationMode(archetype);
    const unit = archetypeUnitProfile(archetype, mode);
    const formation = {
      ...createFormation({
        id: deployment.id,
        factionId: deployment.factionId,
        name: deployment.name,
        facing: deployment.facing,
        formationMode: mode,
        unit,
        cohesion: archetypeCohesion(archetype),
      }),
      ...startingAmmunition(unit),
    };
    deployFormation(state, formation, deployment.positions);
  }
  return state;
}
