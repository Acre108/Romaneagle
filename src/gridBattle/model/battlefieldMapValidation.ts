import { UNIT_ARCHETYPE_BY_ID } from "../../units/UnitArchetypes";
import type { BuildingCell, Direction, GridPosition } from "./types";
import { isGroundTerrain, isGroundTexture, isTerrainObject, terrainSupportsGroundTexture, terrainDefinition } from "./terrainDefinitions";
import { isEdgeFeatureType } from "./edgeFeatureDefinitions";
import { type MapTriggerEffect } from "./triggerDefinitions";
import type { BattlefieldMapDocument } from "./battlefieldMap";
import { BATTLEFIELD_MAP_SCHEMA_VERSION, positionKey, isDirection, isFactionId, isDeployableMapArchetype, assertPositiveInteger, assertMapElevation, assertNonemptyString, mapInBounds, mapTileAt, edgeFeaturePhysicalKey, rampIsValid, mapTileSurfaceElevation } from "./battlefieldMapGeometry";

export function buildBuildingCells(document: BattlefieldMapDocument): Record<string, BuildingCell> {
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

export function connectedPositionComponents(positions: readonly GridPosition[]): GridPosition[][] {
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
