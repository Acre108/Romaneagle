import type { UnitArchetypeId } from "../../units/UnitArchetypes";
import { UNIT_ARCHETYPE_BY_ID } from "../../units/UnitArchetypes";
import type { BuildingCell, Direction, FactionId, GridPosition } from "./types";
import {
  isGroundTerrain,
  isGroundTexture,
  isTerrainObject,
  terrainSupportsGroundTexture,
  terrainDefinition,
  type GroundTerrainType,
  type GroundTextureId,
  type TerrainObjectType,
} from "./terrainDefinitions";
import { isEdgeFeatureType, type EdgeFeatureType } from "./edgeFeatureDefinitions";
import {
  triggerPositions,
  type MapTriggerDefinition,
  type MapTriggerEffect,
} from "./triggerDefinitions";

export const BATTLEFIELD_MAP_SCHEMA_VERSION = 2 as const;

export type { GroundTerrainType, GroundTextureId, TerrainObjectType } from "./terrainDefinitions";
export type { EdgeFeatureType } from "./edgeFeatureDefinitions";
export type {
  MapTriggerCondition,
  MapTriggerDefinition,
  MapTriggerEffect,
  TriggerSpawnFormation,
} from "./triggerDefinitions";

export const MINIMUM_MAP_ELEVATION = -4;
export const MAXIMUM_MAP_ELEVATION = 10;

export interface TerrainTile {
  terrain: GroundTerrainType;
  elevation: number;
  groundTexture?: GroundTextureId;
  ramp?: Direction;
  objects?: TerrainObjectType[];
}

export interface BuildingDefinition {
  id: string;
  origin: GridPosition;
  width: number;
  depth: number;
}

export interface EdgeFeaturePlacement {
  position: GridPosition;
  direction: Direction;
  type: EdgeFeatureType;
}

export interface MapFormationDeployment {
  id: string;
  name: string;
  factionId: FactionId;
  archetypeId: UnitArchetypeId;
  facing: Direction;
  positions: GridPosition[];
}

export interface MapSpawnPoint {
  factionId: FactionId;
  position: GridPosition;
}

export interface BattlefieldMapDocument {
  schemaVersion: typeof BATTLEFIELD_MAP_SCHEMA_VERSION;
  width: number;
  height: number;
  tiles: TerrainTile[];
  buildings: BuildingDefinition[];
  edgeFeatures?: EdgeFeaturePlacement[];
  triggers?: MapTriggerDefinition[];
  deployments?: MapFormationDeployment[];
  spawnPoints?: MapSpawnPoint[];
}

export interface BattlefieldMapChange {
  revision: number;
  dirtyCells: string[];
  boundsChanged: boolean;
  topologyChanged: boolean;
}

/** Runtime map state. Derived building coverage and the change log are not serialized. */
export interface BattlefieldMap extends BattlefieldMapDocument {
  edgeFeatures: EdgeFeaturePlacement[];
  triggers: MapTriggerDefinition[];
  deployments: MapFormationDeployment[];
  spawnPoints: MapSpawnPoint[];
  revision: number;
  changes: BattlefieldMapChange[];
  buildingCells: Record<string, BuildingCell>;
}

const DIRECTIONS: readonly Direction[] = ["north", "east", "south", "west"];
const MAX_CHANGE_HISTORY = 256;

function positionKey(position: GridPosition): string {
  return `${position.x},${position.y}`;
}

function isDirection(value: unknown): value is Direction {
  return typeof value === "string" && DIRECTIONS.includes(value as Direction);
}

function isFactionId(value: unknown): value is FactionId {
  return value === "roman" || value === "saxon";
}

export function isDeployableMapArchetype(value: unknown): value is UnitArchetypeId {
  if (typeof value !== "string") return false;
  const archetype = UNIT_ARCHETYPE_BY_ID.get(value as UnitArchetypeId);
  return archetype !== undefined && (archetype.type === "infantry" || archetype.type === "archers"
    || archetype.type === "skirmishers" || archetype.type === "cavalry");
}

function assertPositiveInteger(value: unknown, name: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) <= 0) throw new Error(`${name} must be a positive integer.`);
}

function assertMapElevation(value: unknown, name: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < MINIMUM_MAP_ELEVATION
    || (value as number) > MAXIMUM_MAP_ELEVATION) {
    throw new Error(`${name} must be an integer between ${MINIMUM_MAP_ELEVATION} and ${MAXIMUM_MAP_ELEVATION}.`);
  }
}

function assertNonemptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} cannot be empty.`);
}

export function mapInBounds(map: Pick<BattlefieldMapDocument, "width" | "height">, position: GridPosition): boolean {
  return Number.isInteger(position.x) && Number.isInteger(position.y)
    && position.x >= 0 && position.y >= 0 && position.x < map.width && position.y < map.height;
}

export function mapTileIndex(map: Pick<BattlefieldMapDocument, "width" | "height">, position: GridPosition): number {
  if (!mapInBounds(map, position)) return -1;
  return position.y * map.width + position.x;
}

export function mapTileAt(map: BattlefieldMapDocument, position: GridPosition): Readonly<TerrainTile> | undefined {
  const index = mapTileIndex(map, position);
  return index >= 0 ? map.tiles[index] : undefined;
}

function directionVector(direction: Direction): GridPosition {
  switch (direction) {
    case "north": return { x: 0, y: -1 };
    case "east": return { x: 1, y: 0 };
    case "south": return { x: 0, y: 1 };
    case "west": return { x: -1, y: 0 };
  }
}

function edgeNeighbour(position: GridPosition, direction: Direction): GridPosition {
  const vector = directionVector(direction);
  return { x: position.x + vector.x, y: position.y + vector.y };
}

export function edgeFeaturePhysicalKey(position: GridPosition, direction: Direction): string {
  if (direction === "north" && position.y > 0) return `${position.x},${position.y - 1},south`;
  if (direction === "west" && position.x > 0) return `${position.x - 1},${position.y},east`;
  return `${position.x},${position.y},${direction}`;
}

export function edgeFeatureAt(
  map: Pick<BattlefieldMapDocument, "edgeFeatures">,
  position: GridPosition,
  direction: Direction,
): Readonly<EdgeFeaturePlacement> | undefined {
  const key = edgeFeaturePhysicalKey(position, direction);
  return (map.edgeFeatures ?? []).find(
    (feature) => edgeFeaturePhysicalKey(feature.position, feature.direction) === key,
  );
}

export function edgeFeaturesCrossed(
  map: Pick<BattlefieldMapDocument, "edgeFeatures">,
  origin: GridPosition,
  destination: GridPosition,
): readonly EdgeFeaturePlacement[] {
  const dx = destination.x - origin.x;
  const dy = destination.y - origin.y;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return [];
  const features: EdgeFeaturePlacement[] = [];
  if (dx !== 0) {
    const feature = edgeFeatureAt(map, origin, dx > 0 ? "east" : "west");
    if (feature) features.push(feature as EdgeFeaturePlacement);
  }
  if (dy !== 0) {
    const feature = edgeFeatureAt(map, origin, dy > 0 ? "south" : "north");
    if (feature && !features.includes(feature as EdgeFeaturePlacement)) features.push(feature as EdgeFeaturePlacement);
  }
  return features;
}

function rampIsValid(map: BattlefieldMapDocument, position: GridPosition, direction: Direction): boolean {
  const tile = mapTileAt(map, position);
  const vector = directionVector(direction);
  const higher = mapTileAt(map, { x: position.x + vector.x, y: position.y + vector.y });
  return tile !== undefined && higher !== undefined
    && mapTileSurfaceElevation(higher) === mapTileSurfaceElevation(tile) + 1;
}

export function mapTileSurfaceElevation(tile: Readonly<TerrainTile>): number {
  return tile.elevation + (terrainDefinition(tile.terrain).surfaceElevationOffset ?? 0);
}

function buildBuildingCells(document: BattlefieldMapDocument): Record<string, BuildingCell> {
  const cells: Record<string, BuildingCell> = {};
  const ids = new Set<string>();
  for (const building of document.buildings) {
    if (!building || typeof building.id !== "string" || !building.id.trim()) throw new Error("Building IDs cannot be empty.");
    if (ids.has(building.id)) throw new Error(`Building ID ${building.id} is already in use.`);
    ids.add(building.id);
    assertPositiveInteger(building.width, `Building ${building.id} width`);
    assertPositiveInteger(building.depth, `Building ${building.id} depth`);
    if (building.width * building.depth < 4) {
      throw new Error(`Building ${building.id} must occupy at least four grid squares.`);
    }
    let buildingElevation: number | undefined;
    for (let row = 0; row < building.depth; row += 1) {
      for (let column = 0; column < building.width; column += 1) {
        const position = { x: building.origin.x + column, y: building.origin.y + row };
        if (!mapInBounds(document, position)) throw new Error(`Building ${building.id} extends beyond the battlefield.`);
        const tile = mapTileAt(document, position)!;
        if (tile.ramp) throw new Error(`Building ${building.id} cannot occupy a ramp tile.`);
        if ((tile.objects?.length ?? 0) > 0) throw new Error(`Building ${building.id} cannot occupy terrain objects.`);
        if (tile.terrain === "fortress_wall") throw new Error(`Building ${building.id} cannot overlap a fortress wall.`);
        const surfaceElevation = mapTileSurfaceElevation(tile);
        buildingElevation ??= surfaceElevation;
        if (surfaceElevation !== buildingElevation) throw new Error(`Building ${building.id} must sit on one elevation level.`);
        const key = positionKey(position);
        if (cells[key]) throw new Error(`Building ${building.id} overlaps another building.`);
        const walls: Direction[] = [];
        if (row === 0) walls.push("north");
        if (column === building.width - 1) walls.push("east");
        if (row === building.depth - 1) walls.push("south");
        if (column === 0) walls.push("west");
        cells[key] = { buildingId: building.id, walls };
      }
    }
  }
  return cells;
}

function cloneTriggerEffect(effect: MapTriggerEffect): MapTriggerEffect {
  if (effect.type === "character_interaction") return { ...effect };
  if (effect.type === "activate_to_attack") return { ...effect };
  return {
    type: "spawn_formation",
    formation: {
      ...effect.formation,
      unit: { ...effect.formation.unit, equipment: [...effect.formation.unit.equipment] },
      positions: effect.formation.positions.map((position) => ({ ...position })),
    },
  };
}

function cloneMapTrigger(trigger: MapTriggerDefinition): MapTriggerDefinition {
  const condition = trigger.condition.type === "formation_enters"
    ? { ...trigger.condition, positions: trigger.condition.positions.map((position) => ({ ...position })) }
    : { ...trigger.condition };
  return { ...trigger, condition, effects: trigger.effects.map(cloneTriggerEffect) };
}

function validateTriggerEffect(document: BattlefieldMapDocument, triggerId: string, effect: MapTriggerEffect): void {
  if (effect.type === "character_interaction") {
    assertNonemptyString(effect.speaker, `Trigger ${triggerId} interaction speaker`);
    assertNonemptyString(effect.text, `Trigger ${triggerId} interaction text`);
    if (effect.characterId !== undefined) assertNonemptyString(effect.characterId, `Trigger ${triggerId} character ID`);
    return;
  }
  if (effect.type === "activate_to_attack") {
    assertNonemptyString(effect.formationId, `Trigger ${triggerId} activation formation ID`);
    if (effect.targetFactionId !== "roman" && effect.targetFactionId !== "saxon") {
      throw new Error(`Trigger ${triggerId} has an invalid activation target faction.`);
    }
    return;
  }
  if (effect.type !== "spawn_formation" || !effect.formation) {
    throw new Error(`Trigger ${triggerId} has an invalid effect.`);
  }
  const formation = effect.formation;
  assertNonemptyString(formation.id, `Trigger ${triggerId} spawn formation ID`);
  assertNonemptyString(formation.name, `Trigger ${triggerId} spawn formation name`);
  if (formation.factionId !== "roman" && formation.factionId !== "saxon") {
    throw new Error(`Trigger ${triggerId} has an invalid spawn faction.`);
  }
  if (!isDirection(formation.facing)) throw new Error(`Trigger ${triggerId} has an invalid spawn facing.`);
  if (formation.formationMode !== "open" && formation.formationMode !== "closed") {
    throw new Error(`Trigger ${triggerId} has an invalid spawn formation mode.`);
  }
  if (!Number.isInteger(formation.cohesion) || !Number.isInteger(formation.maxCohesion)
    || formation.cohesion < 0 || formation.maxCohesion <= 0 || formation.cohesion > formation.maxCohesion) {
    throw new Error(`Trigger ${triggerId} has invalid spawn cohesion.`);
  }
  if (!formation.unit || !Number.isInteger(formation.unit.modelSize) || formation.unit.modelSize <= 0
    || !Number.isFinite(formation.unit.attack) || formation.unit.attack < 0
    || !Number.isFinite(formation.unit.armour) || formation.unit.armour < 0
    || !Number.isFinite(formation.unit.defence) || formation.unit.defence < 0
    || !Number.isInteger(formation.unit.hitPointsPerModel) || formation.unit.hitPointsPerModel <= 0
    || !Number.isFinite(formation.unit.movement) || formation.unit.movement <= 0
    || !Array.isArray(formation.unit.equipment)) {
    throw new Error(`Trigger ${triggerId} has an invalid spawn unit profile.`);
  }
  if (!Array.isArray(formation.positions) || formation.positions.length === 0) {
    throw new Error(`Trigger ${triggerId} spawn must contain at least one block position.`);
  }
  const positionKeys = new Set<string>();
  for (const position of formation.positions) {
    if (!mapInBounds(document, position)) throw new Error(`Trigger ${triggerId} spawn extends beyond the battlefield.`);
    const key = positionKey(position);
    if (positionKeys.has(key)) throw new Error(`Trigger ${triggerId} spawn repeats position ${key}.`);
    positionKeys.add(key);
  }
}

function validateMapTriggers(document: BattlefieldMapDocument): void {
  if (document.triggers !== undefined && !Array.isArray(document.triggers)) {
    throw new Error("Battlefield triggers must be an array.");
  }
  const ids = new Set<string>();
  for (const trigger of document.triggers ?? []) {
    if (!trigger) throw new Error("Battlefield contains an invalid trigger.");
    assertNonemptyString(trigger.id, "Trigger ID");
    assertNonemptyString(trigger.label, `Trigger ${trigger.id} label`);
    if (ids.has(trigger.id)) throw new Error(`Trigger ID ${trigger.id} is already in use.`);
    ids.add(trigger.id);
    if (typeof trigger.once !== "boolean") throw new Error(`Trigger ${trigger.id} once must be boolean.`);
    if (!trigger.condition) throw new Error(`Trigger ${trigger.id} has no condition.`);
    if (trigger.condition.type === "formation_enters") {
      if (!Array.isArray(trigger.condition.positions) || trigger.condition.positions.length === 0) {
        throw new Error(`Trigger ${trigger.id} entry condition needs at least one position.`);
      }
      for (const position of trigger.condition.positions) {
        if (!mapInBounds(document, position)) throw new Error(`Trigger ${trigger.id} condition extends beyond the battlefield.`);
      }
      if (trigger.condition.factionId !== undefined
        && trigger.condition.factionId !== "roman" && trigger.condition.factionId !== "saxon") {
        throw new Error(`Trigger ${trigger.id} has an invalid condition faction.`);
      }
    } else if (trigger.condition.type === "round_starts") {
      assertPositiveInteger(trigger.condition.round, `Trigger ${trigger.id} round`);
    } else if (trigger.condition.type === "formation_destroyed") {
      assertNonemptyString(trigger.condition.formationId, `Trigger ${trigger.id} destroyed formation ID`);
    } else {
      throw new Error(`Trigger ${trigger.id} has an invalid condition.`);
    }
    if (!Array.isArray(trigger.effects) || trigger.effects.length === 0) {
      throw new Error(`Trigger ${trigger.id} needs at least one effect.`);
    }
    for (const effect of trigger.effects) validateTriggerEffect(document, trigger.id, effect);
  }
}

function connectedPositionComponents(positions: readonly GridPosition[]): GridPosition[][] {
  const remaining = new Map(positions.map((position) => [positionKey(position), position]));
  const components: GridPosition[][] = [];
  while (remaining.size > 0) {
    const first = remaining.values().next().value as GridPosition;
    const queue = [first];
    const component: GridPosition[] = [];
    remaining.delete(positionKey(first));
    while (queue.length > 0) {
      const position = queue.shift()!;
      component.push(position);
      for (const offset of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const adjacent = { x: position.x + offset[0], y: position.y + offset[1] };
        const found = remaining.get(positionKey(adjacent));
        if (!found) continue;
        remaining.delete(positionKey(adjacent));
        queue.push(found);
      }
    }
    components.push(component.sort((left, right) => left.y - right.y || left.x - right.x));
  }
  return components.sort((left, right) => left[0]!.y - right[0]!.y || left[0]!.x - right[0]!.x);
}

function validateMapDeployments(
  document: BattlefieldMapDocument,
  buildingCells: Record<string, BuildingCell>,
): void {
  if (document.deployments !== undefined && !Array.isArray(document.deployments)) {
    throw new Error("Battlefield deployments must be an array.");
  }
  const deploymentIds = new Set<string>();
  const occupiedPositions = new Set<string>();
  for (const deployment of document.deployments ?? []) {
    if (!deployment) throw new Error("Battlefield contains an invalid deployment.");
    assertNonemptyString(deployment.id, "Deployment ID");
    assertNonemptyString(deployment.name, `Deployment ${deployment.id} name`);
    if (deploymentIds.has(deployment.id)) throw new Error(`Deployment ID ${deployment.id} is already in use.`);
    deploymentIds.add(deployment.id);
    if (!isFactionId(deployment.factionId)) throw new Error(`Deployment ${deployment.id} has an invalid faction.`);
    if (!isDeployableMapArchetype(deployment.archetypeId)) {
      throw new Error(`Deployment ${deployment.id} has an invalid unit archetype.`);
    }
    const archetype = UNIT_ARCHETYPE_BY_ID.get(deployment.archetypeId)!;
    if (archetype.faction !== deployment.factionId) {
      throw new Error(`Deployment ${deployment.id} faction does not match its unit archetype.`);
    }
    if (!isDirection(deployment.facing)) throw new Error(`Deployment ${deployment.id} has an invalid facing.`);
    if (!Array.isArray(deployment.positions) || deployment.positions.length === 0) {
      throw new Error(`Deployment ${deployment.id} must contain at least one block position.`);
    }
    const ownPositions = new Set<string>();
    for (const position of deployment.positions) {
      if (!mapInBounds(document, position)) throw new Error(`Deployment ${deployment.id} extends beyond the battlefield.`);
      const key = positionKey(position);
      if (ownPositions.has(key)) throw new Error(`Deployment ${deployment.id} repeats position ${key}.`);
      if (occupiedPositions.has(key)) throw new Error(`More than one deployment occupies position ${key}.`);
      if (buildingCells[key]) throw new Error(`Deployment ${deployment.id} occupies a building at ${key}.`);
      const tile = mapTileAt(document, position)!;
      if (terrainDefinition(tile.terrain).blocksVoluntaryMovement) {
        throw new Error(`Deployment ${deployment.id} occupies blocked terrain at ${key}.`);
      }
      ownPositions.add(key);
      occupiedPositions.add(key);
    }
    if (connectedPositionComponents(deployment.positions).length !== 1) {
      throw new Error(`Deployment ${deployment.id} blocks must form one connected formation.`);
    }
  }
}

function validateMapSpawnPoints(
  document: BattlefieldMapDocument,
  buildingCells: Record<string, BuildingCell>,
): void {
  if (document.spawnPoints !== undefined && !Array.isArray(document.spawnPoints)) {
    throw new Error("Battlefield spawnpoints must be an array.");
  }
  const positions = new Set<string>();
  for (const spawnPoint of document.spawnPoints ?? []) {
    if (!spawnPoint || !isFactionId(spawnPoint.factionId)) throw new Error("Battlefield has an invalid spawnpoint faction.");
    if (!mapInBounds(document, spawnPoint.position)) throw new Error("A battlefield spawnpoint is outside the map.");
    const key = positionKey(spawnPoint.position);
    if (positions.has(key)) throw new Error(`More than one spawnpoint occupies position ${key}.`);
    if (buildingCells[key]) throw new Error(`Spawnpoint at ${key} occupies a building.`);
    const tile = mapTileAt(document, spawnPoint.position)!;
    if (terrainDefinition(tile.terrain).blocksVoluntaryMovement) {
      throw new Error(`Spawnpoint at ${key} occupies blocked terrain.`);
    }
    positions.add(key);
  }
}

export function validateBattlefieldMap(document: BattlefieldMapDocument): void {
  if (document.schemaVersion !== BATTLEFIELD_MAP_SCHEMA_VERSION) {
    throw new Error(`Unsupported battlefield map schema version ${String(document.schemaVersion)}.`);
  }
  assertPositiveInteger(document.width, "Battlefield width");
  assertPositiveInteger(document.height, "Battlefield height");
  if (!Array.isArray(document.tiles) || document.tiles.length !== document.width * document.height) {
    throw new Error(`Battlefield must contain exactly ${document.width * document.height} tiles.`);
  }
  for (let index = 0; index < document.tiles.length; index += 1) {
    const tile = document.tiles[index];
    if (!tile || !isGroundTerrain(tile.terrain)) throw new Error(`Tile ${index} has an invalid terrain type.`);
    assertMapElevation(tile.elevation, `Tile ${index} elevation`);
    assertMapElevation(mapTileSurfaceElevation(tile), `Tile ${index} surface elevation`);
    if (tile.groundTexture !== undefined && (!isGroundTexture(tile.groundTexture)
      || !terrainSupportsGroundTexture(tile.terrain, tile.groundTexture))) {
      throw new Error(`Tile ${index} has a ground texture that does not belong to ${tile.terrain}.`);
    }
    if (tile.objects !== undefined) {
      if (!Array.isArray(tile.objects) || tile.objects.some((object) => !isTerrainObject(object))) {
        throw new Error(`Tile ${index} has an invalid terrain object.`);
      }
      const occupiedSpaces = tile.objects.reduce((total, object) => {
        const spaceOccupancy = terrainDefinition(object).spaceOccupancy;
        if (!Number.isInteger(spaceOccupancy) || spaceOccupancy < 1 || spaceOccupancy > 4) {
          throw new Error(`Tile ${index} has a terrain object outside the one-to-four-space model.`);
        }
        return total + spaceOccupancy;
      }, 0);
      if (occupiedSpaces > 9) throw new Error(`Tile ${index} terrain objects occupy more than nine spaces.`);
      if (tile.terrain === "fortress_wall" && tile.objects.length > 0) {
        throw new Error(`Tile ${index} fortress wall cannot contain terrain objects.`);
      }
    }
    if (tile.ramp !== undefined) {
      if (!isDirection(tile.ramp)) throw new Error(`Tile ${index} has an invalid ramp direction.`);
      if (tile.terrain === "fortress_wall") throw new Error(`Tile ${index} fortress wall cannot contain a ramp.`);
      const position = { x: index % document.width, y: Math.floor(index / document.width) };
      if (!rampIsValid(document, position, tile.ramp)) {
        throw new Error(`Ramp at ${positionKey(position)} must climb exactly one level toward ${tile.ramp}.`);
      }
    }
  }
  if (!Array.isArray(document.buildings)) throw new Error("Battlefield buildings must be an array.");
  const buildingCells = buildBuildingCells(document);
  if (document.edgeFeatures !== undefined && !Array.isArray(document.edgeFeatures)) {
    throw new Error("Battlefield edge features must be an array.");
  }
  const edgeKeys = new Set<string>();
  for (const feature of document.edgeFeatures ?? []) {
    if (!feature || !feature.position || !mapInBounds(document, feature.position)) {
      throw new Error("Edge features must belong to a battlefield tile.");
    }
    if (!isDirection(feature.direction)) throw new Error("Edge feature direction is invalid.");
    if (!isEdgeFeatureType(feature.type)) throw new Error(`Invalid edge feature type ${String(feature.type)}.`);
    const key = edgeFeaturePhysicalKey(feature.position, feature.direction);
    if (edgeKeys.has(key)) throw new Error(`Battlefield edge ${key} has more than one feature.`);
    edgeKeys.add(key);
  }
  validateMapTriggers(document);
  validateMapDeployments(document, buildingCells);
  validateMapSpawnPoints(document, buildingCells);
}

function cloneDocument(document: BattlefieldMapDocument): BattlefieldMapDocument {
  return {
    schemaVersion: BATTLEFIELD_MAP_SCHEMA_VERSION,
    width: document.width,
    height: document.height,
    tiles: document.tiles.map((tile) => ({
      ...tile,
      ...(tile.objects ? { objects: [...tile.objects] } : {}),
    })),
    buildings: document.buildings.map((building) => ({
      ...building,
      origin: { ...building.origin },
    })),
    edgeFeatures: (document.edgeFeatures ?? []).map((feature) => ({
      ...feature,
      position: { ...feature.position },
    })),
    triggers: (document.triggers ?? []).map(cloneMapTrigger),
    deployments: (document.deployments ?? []).map((deployment) => ({
      ...deployment,
      positions: deployment.positions.map((position) => ({ ...position })),
    })),
    spawnPoints: (document.spawnPoints ?? []).map((spawnPoint) => ({
      ...spawnPoint,
      position: { ...spawnPoint.position },
    })),
  };
}

export function createBattlefieldMap(document: BattlefieldMapDocument): BattlefieldMap {
  validateBattlefieldMap(document);
  const copy = cloneDocument(document);
  return {
    ...copy,
    edgeFeatures: copy.edgeFeatures ?? [],
    triggers: copy.triggers ?? [],
    deployments: copy.deployments ?? [],
    spawnPoints: copy.spawnPoints ?? [],
    revision: 0,
    changes: [],
    buildingCells: buildBuildingCells(copy),
  };
}

export function parseBattlefieldMap(value: unknown): BattlefieldMap {
  if (!value || typeof value !== "object") throw new Error("Battlefield map must be an object.");
  return createBattlefieldMap(value as BattlefieldMapDocument);
}

export function createBlankBattlefieldMap(width: number, height: number): BattlefieldMap {
  assertPositiveInteger(width, "Battlefield width");
  assertPositiveInteger(height, "Battlefield height");
  return createBattlefieldMap({
    schemaVersion: BATTLEFIELD_MAP_SCHEMA_VERSION,
    width,
    height,
    tiles: Array.from({ length: width * height }, () => ({ terrain: "clear", elevation: 0 })),
    buildings: [],
    edgeFeatures: [],
    triggers: [],
    deployments: [],
    spawnPoints: [],
  });
}

export function serializeBattlefieldMap(map: BattlefieldMap): BattlefieldMapDocument {
  return cloneDocument(map);
}

function expandedDirtyCells(map: BattlefieldMap, positions: readonly GridPosition[]): string[] {
  const keys = new Set<string>();
  for (const position of positions) {
    for (const offset of [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const candidate = { x: position.x + offset[0], y: position.y + offset[1] };
      if (mapInBounds(map, candidate)) keys.add(positionKey(candidate));
    }
  }
  return [...keys];
}

function recordMapChange(
  map: BattlefieldMap,
  positions: readonly GridPosition[],
  boundsChanged = false,
  topologyChanged = false,
): void {
  map.revision += 1;
  map.changes.push({
    revision: map.revision,
    dirtyCells: expandedDirtyCells(map, positions),
    boundsChanged,
    topologyChanged,
  });
  if (map.changes.length > MAX_CHANGE_HISTORY) map.changes.splice(0, map.changes.length - MAX_CHANGE_HISTORY);
}

function mutableTileAt(map: BattlefieldMap, position: GridPosition): TerrainTile {
  const index = mapTileIndex(map, position);
  if (index < 0) throw new Error(`Tile ${positionKey(position)} is outside the battlefield.`);
  return map.tiles[index]!;
}

function clearInvalidRampsAround(map: BattlefieldMap, position: GridPosition): GridPosition[] {
  const changed: GridPosition[] = [];
  for (const offset of [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    const candidate = { x: position.x + offset[0], y: position.y + offset[1] };
    const tile = mapTileAt(map, candidate);
    if (tile?.ramp && !rampIsValid(map, candidate, tile.ramp)) {
      delete mutableTileAt(map, candidate).ramp;
      changed.push(candidate);
    }
  }
  return changed;
}

export function setMapTerrain(map: BattlefieldMap, position: GridPosition, terrain: GroundTerrainType): void {
  if (!isGroundTerrain(terrain)) throw new Error(`Invalid terrain type ${String(terrain)}.`);
  if (map.buildingCells[positionKey(position)]) throw new Error("Remove the building before changing its ground terrain.");
  const tile = mutableTileAt(map, position);
  if (tile.terrain === terrain) return;
  if (terrainDefinition(terrain).blocksVoluntaryMovement && deploymentAt(map, position)) {
    throw new Error("Remove the deployed unit block before painting blocked terrain here.");
  }
  if (terrainDefinition(terrain).blocksVoluntaryMovement && spawnPointAt(map, position)) {
    throw new Error("Remove the spawnpoint before painting blocked terrain here.");
  }
  if (terrain === "fortress_wall" && (tile.objects?.length ?? 0) > 0) {
    throw new Error("Fortress walls cannot contain terrain objects.");
  }
  assertMapElevation(
    tile.elevation + (terrainDefinition(terrain).surfaceElevationOffset ?? 0),
    "Surface elevation",
  );
  tile.terrain = terrain;
  if (tile.groundTexture && !terrainSupportsGroundTexture(terrain, tile.groundTexture)) delete tile.groundTexture;
  const removedRamps = clearInvalidRampsAround(map, position);
  recordMapChange(map, [position, ...removedRamps], true);
}

export function setMapGroundTexture(
  map: BattlefieldMap,
  position: GridPosition,
  texture: GroundTextureId | undefined,
): void {
  const tile = mutableTileAt(map, position);
  if (texture !== undefined && (!isGroundTexture(texture) || !terrainSupportsGroundTexture(tile.terrain, texture))) {
    throw new Error(`${String(texture)} is not a texture for ${tile.terrain}.`);
  }
  if (tile.groundTexture === texture) return;
  if (texture === undefined) delete tile.groundTexture;
  else tile.groundTexture = texture;
  recordMapChange(map, [position]);
}

export function addMapTerrainObject(
  map: BattlefieldMap,
  position: GridPosition,
  object: TerrainObjectType,
): void {
  if (!isTerrainObject(object)) throw new Error(`Invalid terrain object ${String(object)}.`);
  if (map.buildingCells[positionKey(position)]) throw new Error("Buildings cannot contain terrain objects.");
  const tile = mutableTileAt(map, position);
  if (tile.terrain === "fortress_wall") throw new Error("Fortress walls cannot contain terrain objects.");
  const occupiedSpaces = (tile.objects ?? []).reduce(
    (total, existing) => total + terrainDefinition(existing).spaceOccupancy,
    0,
  );
  const requiredSpaces = terrainDefinition(object).spaceOccupancy;
  if (occupiedSpaces + requiredSpaces > 9) {
    throw new Error(`${object} needs ${requiredSpaces} spaces but only ${9 - occupiedSpaces} remain.`);
  }
  (tile.objects ??= []).push(object);
  recordMapChange(map, [position]);
}

export function removeMapTerrainObject(
  map: BattlefieldMap,
  position: GridPosition,
  objectIndex: number,
): TerrainObjectType | undefined {
  const tile = mutableTileAt(map, position);
  if (!Number.isInteger(objectIndex) || objectIndex < 0 || objectIndex >= (tile.objects?.length ?? 0)) return undefined;
  const [removed] = tile.objects!.splice(objectIndex, 1);
  if (tile.objects!.length === 0) delete tile.objects;
  recordMapChange(map, [position]);
  return removed;
}

export function clearMapTerrainObjects(map: BattlefieldMap, position: GridPosition): void {
  const tile = mutableTileAt(map, position);
  if (!tile.objects?.length) return;
  delete tile.objects;
  recordMapChange(map, [position]);
}

interface DeploymentBlockDefinition {
  factionId: FactionId;
  archetypeId: UnitArchetypeId;
  position: GridPosition;
}

export function deploymentAt(
  map: Pick<BattlefieldMapDocument, "deployments">,
  position: GridPosition,
): Readonly<MapFormationDeployment> | undefined {
  return (map.deployments ?? []).find((deployment) =>
    deployment.positions.some((candidate) => candidate.x === position.x && candidate.y === position.y));
}

export function spawnPointAt(
  map: Pick<BattlefieldMapDocument, "spawnPoints">,
  position: GridPosition,
): Readonly<MapSpawnPoint> | undefined {
  return (map.spawnPoints ?? []).find((spawnPoint) =>
    spawnPoint.position.x === position.x && spawnPoint.position.y === position.y);
}

function deploymentBlocks(deployments: readonly MapFormationDeployment[]): DeploymentBlockDefinition[] {
  return deployments.flatMap((deployment) => deployment.positions.map((position) => ({
    factionId: deployment.factionId,
    archetypeId: deployment.archetypeId,
    position: { ...position },
  })));
}

function normalizedDeployments(blocks: readonly DeploymentBlockDefinition[]): MapFormationDeployment[] {
  const groups = new Map<string, DeploymentBlockDefinition[]>();
  for (const block of blocks) {
    const key = `${block.factionId}:${block.archetypeId}`;
    const group = groups.get(key) ?? [];
    group.push(block);
    groups.set(key, group);
  }
  const deployments: MapFormationDeployment[] = [];
  const factionCounts: Record<FactionId, number> = { roman: 0, saxon: 0 };
  for (const key of [...groups.keys()].sort()) {
    const blocksForUnit = groups.get(key)!;
    const first = blocksForUnit[0]!;
    const archetype = UNIT_ARCHETYPE_BY_ID.get(first.archetypeId)!;
    const components = connectedPositionComponents(blocksForUnit.map((block) => block.position));
    for (let componentIndex = 0; componentIndex < components.length; componentIndex += 1) {
      const sequence = ++factionCounts[first.factionId];
      deployments.push({
        id: `custom-${first.factionId}-${sequence}`,
        name: components.length === 1 ? archetype.name : `${archetype.name} ${componentIndex + 1}`,
        factionId: first.factionId,
        archetypeId: first.archetypeId,
        facing: first.factionId === "roman" ? "north" : "south",
        positions: components[componentIndex]!,
      });
    }
  }
  return deployments;
}

export function setMapDeploymentBlock(
  map: BattlefieldMap,
  position: GridPosition,
  factionId: FactionId,
  archetypeId: UnitArchetypeId,
): void {
  if (!isFactionId(factionId)) throw new Error("Deployment faction is invalid.");
  if (!isDeployableMapArchetype(archetypeId)) throw new Error(`Unit archetype ${String(archetypeId)} cannot deploy on the grid.`);
  const archetype = UNIT_ARCHETYPE_BY_ID.get(archetypeId)!;
  if (archetype.faction !== factionId) throw new Error(`${archetype.name} does not belong to the ${factionId} faction.`);
  const tile = mutableTileAt(map, position);
  const key = positionKey(position);
  if (map.buildingCells[key]) throw new Error("Unit blocks cannot deploy inside buildings.");
  if (terrainDefinition(tile.terrain).blocksVoluntaryMovement) {
    throw new Error(`Unit blocks cannot deploy on ${terrainDefinition(tile.terrain).label.toLowerCase()}.`);
  }
  const existing = deploymentAt(map, position);
  if (existing?.factionId === factionId && existing.archetypeId === archetypeId) return;
  if (existing) throw new Error("Remove the existing unit block before placing another here.");
  const blocks = deploymentBlocks(map.deployments);
  blocks.push({ factionId, archetypeId, position: { ...position } });
  map.deployments = normalizedDeployments(blocks);
  recordMapChange(map, [position], false, true);
}

export function removeMapDeploymentBlock(map: BattlefieldMap, position: GridPosition): boolean {
  if (!deploymentAt(map, position)) return false;
  const blocks = deploymentBlocks(map.deployments).filter((block) =>
    block.position.x !== position.x || block.position.y !== position.y);
  map.deployments = normalizedDeployments(blocks);
  recordMapChange(map, [position], false, true);
  return true;
}

export function setMapSpawnPoint(
  map: BattlefieldMap,
  position: GridPosition,
  factionId: FactionId,
): void {
  if (!isFactionId(factionId)) throw new Error("Spawnpoint faction is invalid.");
  const tile = mutableTileAt(map, position);
  const key = positionKey(position);
  if (map.buildingCells[key]) throw new Error("Spawnpoints cannot be placed inside buildings.");
  if (terrainDefinition(tile.terrain).blocksVoluntaryMovement) {
    throw new Error(`Spawnpoints cannot be placed on ${terrainDefinition(tile.terrain).label.toLowerCase()}.`);
  }
  const existing = spawnPointAt(map, position);
  if (existing?.factionId === factionId) return;
  map.spawnPoints = map.spawnPoints.filter((spawnPoint) =>
    spawnPoint.position.x !== position.x || spawnPoint.position.y !== position.y);
  map.spawnPoints.push({ factionId, position: { ...position } });
  recordMapChange(map, [position]);
}

export function removeMapSpawnPoint(map: BattlefieldMap, position: GridPosition): boolean {
  const before = map.spawnPoints.length;
  map.spawnPoints = map.spawnPoints.filter((spawnPoint) =>
    spawnPoint.position.x !== position.x || spawnPoint.position.y !== position.y);
  if (map.spawnPoints.length === before) return false;
  recordMapChange(map, [position]);
  return true;
}

export function setMapEdgeFeature(
  map: BattlefieldMap,
  position: GridPosition,
  direction: Direction,
  type: EdgeFeatureType,
): void {
  if (!mapInBounds(map, position)) throw new Error(`Tile ${positionKey(position)} is outside the battlefield.`);
  if (!isDirection(direction)) throw new Error("Edge feature direction is invalid.");
  if (!isEdgeFeatureType(type)) throw new Error(`Invalid edge feature type ${String(type)}.`);
  const key = edgeFeaturePhysicalKey(position, direction);
  const existingIndex = map.edgeFeatures.findIndex(
    (feature) => edgeFeaturePhysicalKey(feature.position, feature.direction) === key,
  );
  const next = { position: { ...position }, direction, type };
  if (existingIndex >= 0) {
    const existing = map.edgeFeatures[existingIndex]!;
    if (existing.position.x === position.x && existing.position.y === position.y
      && existing.direction === direction && existing.type === type) return;
    map.edgeFeatures[existingIndex] = next;
  } else {
    map.edgeFeatures.push(next);
  }
  recordMapChange(map, [position, edgeNeighbour(position, direction)].filter((candidate) => mapInBounds(map, candidate)));
}

export function removeMapEdgeFeature(
  map: BattlefieldMap,
  position: GridPosition,
  direction: Direction,
): boolean {
  if (!mapInBounds(map, position) || !isDirection(direction)) return false;
  const key = edgeFeaturePhysicalKey(position, direction);
  const existingIndex = map.edgeFeatures.findIndex(
    (feature) => edgeFeaturePhysicalKey(feature.position, feature.direction) === key,
  );
  if (existingIndex < 0) return false;
  const [removed] = map.edgeFeatures.splice(existingIndex, 1);
  recordMapChange(map, [removed!.position, edgeNeighbour(removed!.position, removed!.direction)]
    .filter((candidate) => mapInBounds(map, candidate)));
  return true;
}

export function addMapTrigger(map: BattlefieldMap, trigger: MapTriggerDefinition): void {
  const next = serializeBattlefieldMap(map);
  (next.triggers ??= []).push(cloneMapTrigger(trigger));
  validateBattlefieldMap(next);
  map.triggers = next.triggers;
  const positions = triggerPositions(trigger).filter((position) => mapInBounds(map, position));
  recordMapChange(map, positions.length > 0 ? positions : [{ x: 0, y: 0 }]);
}

export function removeMapTrigger(map: BattlefieldMap, triggerId: string): boolean {
  const existing = map.triggers.find((trigger) => trigger.id === triggerId);
  if (!existing) return false;
  map.triggers = map.triggers.filter((trigger) => trigger.id !== triggerId);
  const positions = triggerPositions(existing).filter((position) => mapInBounds(map, position));
  recordMapChange(map, positions.length > 0 ? positions : [{ x: 0, y: 0 }]);
  return true;
}

export function setMapElevation(map: BattlefieldMap, position: GridPosition, elevation: number): void {
  assertMapElevation(elevation, "Elevation");
  if (map.buildingCells[positionKey(position)]) throw new Error("Remove the building before changing its elevation.");
  const tile = mutableTileAt(map, position);
  assertMapElevation(
    elevation + (terrainDefinition(tile.terrain).surfaceElevationOffset ?? 0),
    "Surface elevation",
  );
  if (tile.elevation === elevation) return;
  tile.elevation = elevation;
  const removedRamps = clearInvalidRampsAround(map, position);
  recordMapChange(map, [position, ...removedRamps], true);
}

export function setMapRamp(map: BattlefieldMap, position: GridPosition, direction: Direction | undefined): void {
  if (direction !== undefined && map.buildingCells[positionKey(position)]) {
    throw new Error("Buildings cannot occupy ramp tiles.");
  }
  const tile = mutableTileAt(map, position);
  if (direction !== undefined && tile.terrain === "fortress_wall") {
    throw new Error("Place access ramps on the lower approach tile, not on the fortress wall.");
  }
  if (direction !== undefined && (!isDirection(direction) || !rampIsValid(map, position, direction))) {
    throw new Error(`Ramp at ${positionKey(position)} must climb exactly one level toward ${String(direction)}.`);
  }
  if (tile.ramp === direction) return;
  if (direction === undefined) delete tile.ramp;
  else tile.ramp = direction;
  recordMapChange(map, [position]);
}

export function addMapBuilding(map: BattlefieldMap, definition: BuildingDefinition): void {
  const next = serializeBattlefieldMap(map);
  next.buildings.push({
    ...definition,
    origin: { ...definition.origin },
  });
  validateBattlefieldMap(next);
  map.buildings = next.buildings;
  map.buildingCells = buildBuildingCells(next);
  const positions = Object.entries(map.buildingCells)
    .filter(([, cell]) => cell.buildingId === definition.id)
    .map(([key]) => {
      const [x, y] = key.split(",").map(Number);
      return { x: x!, y: y! };
    });
  recordMapChange(map, positions);
}

export function removeMapBuilding(map: BattlefieldMap, buildingId: string): boolean {
  const existing = map.buildings.find((building) => building.id === buildingId);
  if (!existing) return false;
  const positions = Object.entries(map.buildingCells)
    .filter(([, cell]) => cell.buildingId === buildingId)
    .map(([key]) => {
      const [x, y] = key.split(",").map(Number);
      return { x: x!, y: y! };
    });
  map.buildings = map.buildings.filter((building) => building.id !== buildingId);
  map.buildingCells = buildBuildingCells(map);
  recordMapChange(map, positions);
  return true;
}

export function resizeBattlefieldMap(
  map: BattlefieldMap,
  width: number,
  height: number,
  fill: GroundTerrainType = "clear",
): void {
  assertPositiveInteger(width, "Battlefield width");
  assertPositiveInteger(height, "Battlefield height");
  if (!isGroundTerrain(fill)) throw new Error(`Invalid terrain type ${String(fill)}.`);
  if (width === map.width && height === map.height) return;
  const tiles = Array.from({ length: width * height }, () => ({ terrain: fill, elevation: 0 } as TerrainTile));
  const copyWidth = Math.min(width, map.width);
  const copyHeight = Math.min(height, map.height);
  for (let y = 0; y < copyHeight; y += 1) {
    for (let x = 0; x < copyWidth; x += 1) {
      const source = map.tiles[y * map.width + x]!;
      tiles[y * width + x] = { ...source, ...(source.objects ? { objects: [...source.objects] } : {}) };
    }
  }
  const next: BattlefieldMapDocument = {
    schemaVersion: BATTLEFIELD_MAP_SCHEMA_VERSION,
    width,
    height,
    tiles,
    buildings: map.buildings,
    edgeFeatures: map.edgeFeatures.filter((feature) => mapInBounds({ width, height }, feature.position)),
    triggers: map.triggers,
    deployments: normalizedDeployments(deploymentBlocks(map.deployments).filter((block) =>
      mapInBounds({ width, height }, block.position))),
    spawnPoints: map.spawnPoints.filter((spawnPoint) => mapInBounds({ width, height }, spawnPoint.position)),
  };
  for (let index = 0; index < next.tiles.length; index += 1) {
    const tile = next.tiles[index]!;
    if (!tile.ramp) continue;
    const position = { x: index % width, y: Math.floor(index / width) };
    if (!rampIsValid(next, position, tile.ramp)) delete tile.ramp;
  }
  validateBattlefieldMap(next);
  map.width = width;
  map.height = height;
  map.tiles = tiles;
  map.edgeFeatures = next.edgeFeatures ?? [];
  map.triggers = next.triggers ?? [];
  map.deployments = next.deployments ?? [];
  map.spawnPoints = next.spawnPoints ?? [];
  map.buildingCells = buildBuildingCells(map);
  const allPositions = tiles.map((_, index) => ({ x: index % width, y: Math.floor(index / width) }));
  recordMapChange(map, allPositions, true, true);
}

export function mapChangesSince(map: BattlefieldMap, revision: number): BattlefieldMapChange[] | null {
  if (revision === map.revision) return [];
  const changes = map.changes.filter((change) => change.revision > revision);
  if (changes.length === 0 || changes[0]!.revision !== revision + 1) return null;
  return changes;
}

export function maximumMapElevation(map: BattlefieldMapDocument): number {
  let maximum = MINIMUM_MAP_ELEVATION;
  for (const tile of map.tiles) maximum = Math.max(maximum, mapTileSurfaceElevation(tile) + (tile.ramp ? 1 : 0));
  return maximum;
}

export function minimumMapElevation(map: BattlefieldMapDocument): number {
  let minimum = MAXIMUM_MAP_ELEVATION;
  for (const tile of map.tiles) minimum = Math.min(minimum, mapTileSurfaceElevation(tile));
  return minimum;
}

export function mapElevationRange(map: BattlefieldMapDocument): { minimum: number; maximum: number } {
  return { minimum: minimumMapElevation(map), maximum: maximumMapElevation(map) };
}
