import {
  ALL_BLOCK_SLOTS_MASK,
  BLOCK_SLOT_COUNT,
  blockSlotBit,
  blockSlotCount,
  type BlockSlotIndex,
  type BlockSlotMask,
} from "./blockSlots";
import {
  addMapBuilding,
  mapTileSurfaceElevation,
  mapTileAt,
  type BuildingDefinition,
} from "./battlefieldMap";
import type {
  BuildingCell,
  Direction,
  GameState,
  GridPosition,
  TerrainType,
} from "./types";
import {
  defaultGroundTexture,
  groundTextureDefinition,
  isTerrainObject,
  terrainDefinition,
  type GroundTextureId,
  type TerrainObjectType,
} from "./terrainDefinitions";

export type { BuildingDefinition } from "./battlefieldMap";

const DEFAULT_OBJECT_SLOT_ORDER = [4, 1, 3, 5, 7, 0, 2, 6, 8] as const;
const SINGLE_FOUR_SPACE_OBJECT_SLOT_ORDER = [1, 3, 4, 5, 0, 2, 6, 7, 8] as const;
const FIRST_STACKED_FOUR_SPACE_OBJECT_SLOT_ORDER = [0, 1, 3, 4, 2, 5, 6, 7, 8] as const;
const SECOND_STACKED_FOUR_SPACE_OBJECT_SLOT_ORDER = [8, 7, 5, 6, 4, 2, 3, 1, 0] as const;
function buildingKey(position: GridPosition): string {
  return `${position.x},${position.y}`;
}

export function terrainElevationAt(state: GameState, position: GridPosition): number {
  const tile = mapTileAt(state.battlefield, position);
  return tile ? mapTileSurfaceElevation(tile) : 0;
}

export function rampDirectionAt(state: GameState, position: GridPosition): Direction | undefined {
  return mapTileAt(state.battlefield, position)?.ramp;
}

export function terrainAt(state: GameState, position: GridPosition): TerrainType | undefined {
  if (buildingCellAt(state, position)) return "building";
  return mapTileAt(state.battlefield, position)?.terrain;
}

export function terrainObjectsAt(state: GameState, position: GridPosition): readonly TerrainObjectType[] {
  return mapTileAt(state.battlefield, position)?.objects ?? [];
}

export function groundTextureAt(state: GameState, position: GridPosition): GroundTextureId | undefined {
  const tile = mapTileAt(state.battlefield, position);
  return tile ? tile.groundTexture ?? defaultGroundTexture(tile.terrain) : undefined;
}

export function buildingCellAt(state: GameState, position: GridPosition): BuildingCell | undefined {
  return state.battlefield.buildingCells[buildingKey(position)];
}

export function placeBuilding(state: GameState, definition: BuildingDefinition): void {
  addMapBuilding(state.battlefield, definition);
}

export interface TerrainObjectSlotPlacement {
  object: TerrainObjectType;
  objectIndex: number;
  slotMask: BlockSlotMask;
}

function firstAvailableSlots(
  order: readonly BlockSlotIndex[],
  count: number,
  unavailableMask: BlockSlotMask,
): BlockSlotMask {
  let mask = 0;
  let remaining = count;
  for (const slot of order) {
    const bit = blockSlotBit(slot);
    if ((unavailableMask & bit) !== 0) continue;
    mask |= bit;
    remaining -= 1;
    if (remaining === 0) break;
  }
  if (remaining > 0) throw new Error("Terrain objects exceed the tile's nine shared spaces.");
  return mask;
}

export function terrainObjectSlotPlacements(
  objects: readonly TerrainObjectType[],
): TerrainObjectSlotPlacement[] {
  const ordered = objects
    .map((object, objectIndex) => ({ object, objectIndex }))
    .sort((left, right) => terrainDefinition(right.object).spaceOccupancy
      - terrainDefinition(left.object).spaceOccupancy || left.objectIndex - right.objectIndex);
  const fourSpaceObjectCount = ordered.filter(
    ({ object }) => terrainDefinition(object).spaceOccupancy === 4,
  ).length;
  let fourSpaceObjectIndex = 0;
  let occupiedMask = 0;
  const placements = ordered.map(({ object, objectIndex }) => {
    const spaceOccupancy = terrainDefinition(object).spaceOccupancy;
    let order: readonly BlockSlotIndex[] = DEFAULT_OBJECT_SLOT_ORDER;
    if (spaceOccupancy === 4) {
      order = fourSpaceObjectCount === 1
        ? SINGLE_FOUR_SPACE_OBJECT_SLOT_ORDER
        : fourSpaceObjectIndex === 0
          ? FIRST_STACKED_FOUR_SPACE_OBJECT_SLOT_ORDER
          : SECOND_STACKED_FOUR_SPACE_OBJECT_SLOT_ORDER;
      fourSpaceObjectIndex += 1;
    }
    const slotMask = firstAvailableSlots(order, spaceOccupancy, occupiedMask);
    occupiedMask |= slotMask;
    return { object, objectIndex, slotMask };
  });
  return placements.sort((left, right) => left.objectIndex - right.objectIndex);
}

export function terrainObjectSlotMask(objects: readonly TerrainObjectType[]): BlockSlotMask {
  return terrainObjectSlotPlacements(objects).reduce((mask, placement) => mask | placement.slotMask, 0);
}

export function terrainSlotMask(terrain: TerrainType, buildingCell?: BuildingCell): BlockSlotMask {
  if (isTerrainObject(terrain)) return terrainObjectSlotMask([terrain]);
  if (terrain === "building") return ALL_BLOCK_SLOTS_MASK;
  void buildingCell;
  return 0;
}

export function terrainSlotMaskAt(state: GameState, position: GridPosition): BlockSlotMask {
  const terrain = terrainAt(state, position);
  if (!terrain) return ALL_BLOCK_SLOTS_MASK;
  return terrainSlotMask(terrain, buildingCellAt(state, position)) | terrainObjectSlotMask(terrainObjectsAt(state, position));
}

export function terrainBlocksVoluntaryMovement(terrain: TerrainType): boolean {
  return terrainDefinition(terrain).blocksVoluntaryMovement;
}

export type ForcedRelocationHazard = "river_deep" | "cliff";

export function forcedRelocationHazard(
  state: GameState,
  origin: GridPosition,
  destination: GridPosition,
): ForcedRelocationHazard | null {
  const destinationTerrain = terrainAt(state, destination);
  if (destinationTerrain && terrainDefinition(destinationTerrain).lethalForcedDestination) return "river_deep";
  return Math.abs(terrainElevationAt(state, origin) - terrainElevationAt(state, destination)) > 1
    ? "cliff"
    : null;
}

function elevationBlocksRelocation(
  state: GameState,
  origin: GridPosition,
  destination: GridPosition,
): boolean {
  const originElevation = terrainElevationAt(state, origin);
  const destinationElevation = terrainElevationAt(state, destination);
  return Math.abs(originElevation - destinationElevation) > 1;
}

export function buildingBlocksRelocation(
  state: GameState,
  origin: GridPosition,
  destination: GridPosition,
): boolean {
  const originCell = buildingCellAt(state, origin);
  const destinationCell = buildingCellAt(state, destination);
  return Boolean(originCell || destinationCell);
}

export function terrainBlocksVoluntaryRelocation(
  state: GameState,
  origin: GridPosition,
  destination: GridPosition,
): boolean {
  const destinationTerrain = terrainAt(state, destination);
  return !destinationTerrain
    || terrainBlocksVoluntaryMovement(destinationTerrain)
    || terrainSlotMaskAt(state, destination) === ALL_BLOCK_SLOTS_MASK
    || buildingBlocksRelocation(state, origin, destination)
    || elevationBlocksRelocation(state, origin, destination);
}

export function terrainBlocksForcedRelocation(
  state: GameState,
  origin: GridPosition,
  destination: GridPosition,
): boolean {
  const destinationTerrain = terrainAt(state, destination);
  if (!destinationTerrain || destinationTerrain === "impassable"
    || terrainSlotMaskAt(state, destination) === ALL_BLOCK_SLOTS_MASK) return true;
  return buildingBlocksRelocation(state, origin, destination);
}

export function terrainMovementCost(terrain: TerrainType | undefined): number {
  return terrain ? terrainDefinition(terrain).movementCost : 1;
}

export function terrainAllowsCharge(terrain: TerrainType | undefined): boolean {
  return terrain ? terrainDefinition(terrain).allowsCharge : false;
}

export function terrainLimitsInfantryCharge(terrain: TerrainType | undefined): boolean {
  return terrain ? terrainDefinition(terrain).limitsInfantryCharge : false;
}

export function terrainResistanceModifier(terrain: TerrainType | undefined): number {
  return terrain ? terrainDefinition(terrain).resistanceModifier ?? 0 : 0;
}

export function terrainMeleeDamageReceivedBonus(terrain: TerrainType | undefined): number {
  return terrain ? terrainDefinition(terrain).meleeDamageReceivedBonus ?? 0 : 0;
}

export function terrainBlockCapacity(
  terrain: TerrainType,
  normalCapacity: number,
  buildingCell?: BuildingCell,
  objects: readonly TerrainObjectType[] = [],
): number {
  const terrainSlots = blockSlotCount(terrainSlotMask(terrain, buildingCell) | terrainObjectSlotMask(objects));
  return Math.min(Math.max(0, normalCapacity), BLOCK_SLOT_COUNT - terrainSlots);
}

export function terrainBlockCapacityAt(
  state: GameState,
  position: GridPosition,
  normalCapacity: number,
): number {
  const terrain = terrainAt(state, position);
  if (!terrain) return 0;
  return terrainBlockCapacity(terrain, normalCapacity, buildingCellAt(state, position), terrainObjectsAt(state, position));
}

export function terrainDescription(
  terrain: TerrainType,
  buildingCell?: BuildingCell,
  elevation = 0,
  rampDirection?: Direction,
  objects: readonly TerrainObjectType[] = [],
  groundTexture?: GroundTextureId,
): string {
  const height = elevation !== 0 ? ` · height ${elevation}` : "";
  const ramp = rampDirection ? ` · ramp climbs ${rampDirection}` : "";
  const objectDescription = objects.length > 0
    ? ` · ${objects.map((object) => terrainDefinition(object).label.toLowerCase()).join(" + ")}`
    : "";
  let description = terrainDefinition(terrain).description;
  if (groundTexture) description = `${groundTextureDefinition(groundTexture).label.toLowerCase()} · ${description}`;
  if (terrain === "building") {
    description = `${buildingCell ? "solid building" : "building"} · impassable · blocks line of sight`;
  }
  return `${description}${objectDescription}${height}${ramp}`;
}
