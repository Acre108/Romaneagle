import type { RangedProjectileKind, RangedWeaponId } from "../../units/RangedWeapons";
import type { BattlefieldMap } from "./battlefieldMap";

export type FactionId = "roman" | "saxon";
export type Direction = "north" | "east" | "south" | "west";
export type FormationMode = "open" | "closed";
export type UnitType =
  | "light_infantry"
  | "medium_infantry"
  | "heavy_infantry"
  | "light_cavalry"
  | "heavy_cavalry";
export type EquipmentAbility = "shield_front" | "brace_against_charge";
export type TerrainType =
  | "clear"
  | "rough"
  | "dangerous"
  | "forest"
  | "impassable"
  | "tree_small"
  | "tree_large"
  | "rock_small"
  | "rock_large"
  | "pond"
  | "road"
  | "fortress_wall"
  | "building"
  | "river_shallow"
  | "river_deep";
export type RetreatMode = "good_order" | "chaotic";

export interface GridPosition {
  x: number;
  y: number;
}

export interface PlannedBlockRelocation {
  blockId: string;
  formationId: string;
  origin: GridPosition;
  destination: GridPosition;
}

export interface FormationRelocationPlan {
  formationIds: string[];
  direction: Direction;
  distance: number;
  reordered: boolean;
  movementCosts: Record<string, number>;
  relocations: PlannedBlockRelocation[];
}

export interface OrderPreviewTile {
  position: GridPosition;
  factionId: FactionId;
  certainty: "certain" | "possible";
  chance: number;
  blockId?: string;
  math: string[];
}

export interface CombatCalculationTerm {
  label: string;
  value: number;
}

export interface CombatBlockDamagePreview {
  blockId: string;
  factionId: FactionId;
  position: GridPosition;
  minimumDamage: number;
  maximumDamage: number;
  evadeChance: number;
  mitigationLabel?: string;
  math: string[];
}

export interface OrderConfirmationPreview {
  kind: "movement" | "combat";
  title: string;
  detail: string;
  tiles: OrderPreviewTile[];
  damage: CombatBlockDamagePreview[];
}

export interface TroopBlock {
  id: string;
  factionId: FactionId;
  formationId: string | null;
  position: GridPosition;
  models: number;
  modelCapacity: number;
  wounds: number;
  disorder: number;
  characterId: string | null;
  hasRetreatedThisRound: boolean;
  isContested: boolean;
  engagementFacing?: Direction;
  chargeDistance: number;
  chargeMomentum: number;
}

export interface UnitProfile {
  unitType: UnitType;
  modelSize: number;
  attack: number;
  armour: number;
  defence: number;
  hitPointsPerModel: number;
  movement: number;
  equipment: EquipmentAbility[];
  rangedWeaponId?: RangedWeaponId;
}

export interface Formation {
  id: string;
  factionId: FactionId;
  name: string;
  blockIds: string[];
  facing: Direction;
  formationMode: FormationMode;
  unit: UnitProfile;
  cohesion: number;
  maxCohesion: number;
  initialModelCount: number;
  casualtyMoraleStage: number;
  lastFlankShockRound?: number;
  lastOutnumberedShockRound?: number;
  routingActivations?: number;
  routingStalledActivations?: number;
  movementRemaining: number;
  hasActivated: boolean;
  leaderCharacterId: string | null;
  status: "formed" | "fragment" | "disordered" | "routed";
  provisionalFamilyId?: string | null;
  failedRegroupActivations?: number;
  isBraced?: boolean;
  ammunition?: number;
}

export type CharacterRole = "commander" | "centurion" | "champion";

export interface Character {
  id: string;
  factionId: FactionId;
  name: string;
  role: CharacterRole;
  hostBlockId: string;
  pressureBonus: number;
  resistanceBonus: number;
  meleeBonus: number;
  commandRadius: number;
  prowess: number;
  wounds: number;
  maxWounds: number;
  status: "active" | "duelling" | "wounded" | "defeated";
  tiedDuelRounds: number;
  temporaryMeleeBonus: number;
}

export interface CellOccupancy {
  romanBlockId: string | null;
  saxonBlockId: string | null;
}

export interface BuildingCell {
  buildingId: string;
  walls: Direction[];
}

export type BattleAction =
  | "move"
  | "attack"
  | "shoot"
  | "charge"
  | "reform"
  | "merge"
  | "brace"
  | "hold"
  | "fall_back"
  | "battle"
  | "press";

export type GameEventType =
  | "formation_moved"
  | "formation_rotated"
  | "ranged_volley"
  | "pressure_applied"
  | "block_retreated"
  | "retreat_cascade"
  | "chaotic_retreat"
  | "block_compressed"
  | "block_damaged"
  | "block_destroyed"
  | "formation_split"
  | "formation_split_confirmed"
  | "formation_wavered"
  | "morale_shock"
  | "formation_routed"
  | "formation_rallied"
  | "formation_escaped"
  | "terrain_overflow"
  | "block_drowned"
  | "block_fell"
  | "charge_impact"
  | "block_advanced"
  | "contested_cell_created"
  | "contested_melee_resolved"
  | "character_transferred"
  | "duel_started"
  | "duel_resolved"
  | "formation_merged"
  | "formation_braced"
  | "engagement_closed"
  | "counterattack_resolved"
  | "engaged_order_resolved"
  | "round_started"
  | "activation_ended"
  | "trigger_fired"
  | "trigger_interaction"
  | "trigger_spawned"
  | "trigger_ai_activated"
  | "trigger_failed";

export interface GameEvent {
  id: number;
  type: GameEventType;
  message: string;
  blockIds?: string[];
  formationIds?: string[];
  position?: GridPosition;
  sourcePosition?: GridPosition;
  sourcePositions?: GridPosition[];
  targetPositions?: GridPosition[];
  projectileKind?: RangedProjectileKind;
  casualties?: number;
  departingBlocks?: BlockDeparture[];
  triggerId?: string;
}

export interface TriggerInteraction {
  triggerId: string;
  characterId?: string;
  speaker: string;
  text: string;
}

export interface TriggerRuntimeState {
  fireCounts: Record<string, number>;
  interactions: TriggerInteraction[];
}

export interface BlockDeparture {
  block: TroopBlock;
  from: GridPosition;
  to: GridPosition;
}

export interface GameState {
  battlefield: BattlefieldMap;
  round: number;
  activeFactionId: FactionId;
  blocks: Record<string, TroopBlock>;
  formations: Record<string, Formation>;
  characters: Record<string, Character>;
  selectedFormationId: string | null;
  selectedBlockId: string | null;
  phase: "selecting" | "choosing_action" | "animating" | "resolving_melees";
  currentAction: BattleAction | null;
  eventLog: GameEvent[];
  /** Immutable snapshots of blocks that fled the playable map, retained for battle reporting. */
  departedBlocks?: BlockDeparture[];
  nextEventId: number;
  nextFragmentId: number;
  triggerState: TriggerRuntimeState;
}

export interface PressurePreview {
  attackerId: string;
  defenderId: string;
  attackingPressure: number;
  defendingResistance: number;
  netPressure: number;
  rawDamage: number;
  damageOnHit: number;
  minimumDamage: number;
  maximumDamage: number;
  damagePenalty: number;
  expectedDamage: number;
  flankBonus: number;
  terrainDamageBonus: number;
  shieldArmour: number;
  braceArmour: number;
  armour: number;
  defence: number;
  defenceRoll: number;
  evaded: boolean;
  contactEdge: "front" | "side" | "rear";
  expectedCasualties: number;
  expectedResult: string;
  retreatMode: RetreatMode;
  retreatDestination: GridPosition;
  retreatDestinations: GridPosition[];
  cascadeLength: number;
  mayCompress: boolean;
  retreatIntoDeepWater: boolean;
  retreatHazard: "river_deep" | "cliff" | null;
  characterModifiers: string[];
  pressureMath: CombatCalculationTerm[];
  resistanceMath: CombatCalculationTerm[];
}

export interface ChargePreview {
  attackerId: string;
  defenderId: string;
  distance: number;
  momentum: number;
  impactDamage: number;
  attackBonus: number;
  bonusNullified: boolean;
  unitType: UnitType;
  reordered: boolean;
  relocations: PlannedBlockRelocation[];
}
