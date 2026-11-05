import type {
  Direction,
  FactionId,
  FormationMode,
  GridPosition,
  UnitProfile,
} from "./types";

export type MapTriggerCondition =
  | {
    type: "formation_enters";
    positions: GridPosition[];
    factionId?: FactionId;
  }
  | {
    type: "round_starts";
    round: number;
  }
  | {
    type: "formation_destroyed";
    formationId: string;
  };

export interface TriggerSpawnFormation {
  id: string;
  name: string;
  factionId: FactionId;
  facing: Direction;
  formationMode: FormationMode;
  cohesion: number;
  maxCohesion: number;
  unit: UnitProfile;
  positions: GridPosition[];
}

export type MapTriggerEffect =
  | {
    type: "character_interaction";
    characterId?: string;
    speaker: string;
    text: string;
  }
  | {
    type: "spawn_formation";
    formation: TriggerSpawnFormation;
  }
  | {
    type: "activate_to_attack";
    formationId: string;
    targetFactionId: FactionId;
  };

export interface MapTriggerDefinition {
  id: string;
  label: string;
  once: boolean;
  condition: MapTriggerCondition;
  effects: MapTriggerEffect[];
}

export function triggerPositions(trigger: MapTriggerDefinition): readonly GridPosition[] {
  const positions: GridPosition[] = [];
  if (trigger.condition.type === "formation_enters") positions.push(...trigger.condition.positions);
  for (const effect of trigger.effects) {
    if (effect.type === "spawn_formation") positions.push(...effect.formation.positions);
  }
  return positions;
}
