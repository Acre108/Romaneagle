import type { UnitArchetypeId } from "../../units/UnitArchetypes";
import { UNIT_ARCHETYPE_BY_ID } from "../../units/UnitArchetypes";
import type { Direction, FactionId, GridPosition } from "./types";
import { terrainDefinition } from "./terrainDefinitions";
import type { TerrainTile, EdgeFeaturePlacement, BattlefieldMapDocument } from "./battlefieldMap";

export const BATTLEFIELD_MAP_SCHEMA_VERSION = 2 as const;
export const MINIMUM_MAP_ELEVATION = -4;
export const MAXIMUM_MAP_ELEVATION = 10;
export const DIRECTIONS: readonly Direction[] = ["north", "east", "south", "west"];

export function positionKey(position: GridPosition): string {
  return `${position.x},${position.y}`;
}

export function isDirection(value: unknown): value is Direction {
  return typeof value === "string" && DIRECTIONS.includes(value as Direction);
}

export function isFactionId(value: unknown): value is FactionId {
  return value === "roman" || value === "saxon";
}

export function isDeployableMapArchetype(value: unknown): value is UnitArchetypeId {
  if (typeof value !== "string") return false;
  const archetype = UNIT_ARCHETYPE_BY_ID.get(value as UnitArchetypeId);
  return archetype !== undefined && (archetype.type === "infantry" || archetype.type === "archers"
    || archetype.type === "skirmishers" || archetype.type === "cavalry");
}

export function assertPositiveInteger(value: unknown, name: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) <= 0) throw new Error(`${name} must be a positive integer.`);
}

export function assertMapElevation(value: unknown, name: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < MINIMUM_MAP_ELEVATION
    || (value as number) > MAXIMUM_MAP_ELEVATION) {
    throw new Error(`${name} must be an integer between ${MINIMUM_MAP_ELEVATION} and ${MAXIMUM_MAP_ELEVATION}.`);
  }
}

export function assertNonemptyString(value: unknown, name: string): asserts value is string {
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

export function edgeNeighbour(position: GridPosition, direction: Direction): GridPosition {
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

export function rampIsValid(map: BattlefieldMapDocument, position: GridPosition, direction: Direction): boolean {
  const tile = mapTileAt(map, position);
  const vector = directionVector(direction);
  const higher = mapTileAt(map, { x: position.x + vector.x, y: position.y + vector.y });
  return tile !== undefined && higher !== undefined
    && mapTileSurfaceElevation(higher) === mapTileSurfaceElevation(tile) + 1;
}

export function mapTileSurfaceElevation(tile: Readonly<TerrainTile>): number {
  return tile.elevation + (terrainDefinition(tile.terrain).surfaceElevationOffset ?? 0);
}
