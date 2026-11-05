import type { TerrainType } from "./types";

export type TerrainAuthoringTool = "paint" | "art-object" | "building";
export type TerrainPaletteGroup = "ground" | "vegetation" | "water" | "obstacle" | "structure";

export type TerrainEditorPreview =
  | { kind: "colour" }
  | { kind: "texture"; assetId: string }
  | { kind: "art-object"; assetId: string };

export interface TerrainAuthoringMetadata {
  tool: TerrainAuthoringTool;
  paletteGroup: TerrainPaletteGroup;
  paletteOrder: number;
  preview: TerrainEditorPreview;
}

export interface GroundTextureDefinition {
  id: string;
  label: string;
  preview: TerrainEditorPreview;
  colour: number;
  alternateColour?: number;
  detailColour: number;
  minimapColour: string;
}

export interface TerrainDefinition {
  authoring: TerrainAuthoringMetadata;
  label: string;
  description: string;
  colour: number;
  alternateColour?: number;
  strokeColour: number;
  strokeWidth: number;
  minimapColour: string;
  movementCost: number;
  blocksVoluntaryMovement: boolean;
  lethalForcedDestination: boolean;
  allowsCharge: boolean;
  limitsInfantryCharge: boolean;
  blocksLineOfSight: boolean;
  spaceOccupancy: 0 | 1 | 2 | 3 | 4;
  resistanceModifier?: number;
  meleeDamageReceivedBonus?: number;
  surfaceElevationOffset?: number;
  groundTextures?: readonly GroundTextureDefinition[];
}

export const TERRAIN_AUTHORING_REGISTRY = {
  clear: {
    authoring: { tool: "paint", paletteGroup: "ground", paletteOrder: 10, preview: { kind: "colour" } },
    label: "Clear ground", description: "clear ground", colour: 0x35412d, alternateColour: 0x39452f,
    strokeColour: 0x75806a, strokeWidth: 1, minimapColour: "#46543b", movementCost: 1,
    blocksVoluntaryMovement: false, lethalForcedDestination: false, allowsCharge: true,
    limitsInfantryCharge: false, blocksLineOfSight: false, spaceOccupancy: 0,
    groundTextures: [
      { id: "grass", label: "Grass", preview: { kind: "texture", assetId: "ground-grass" }, colour: 0x35412d, alternateColour: 0x39452f, detailColour: 0x697856, minimapColour: "#46543b" },
      { id: "pasture", label: "Pasture", preview: { kind: "texture", assetId: "ground-pasture" }, colour: 0x42523a, alternateColour: 0x47583d, detailColour: 0x82906a, minimapColour: "#536449" },
      { id: "dry_grass", label: "Dry grass", preview: { kind: "texture", assetId: "ground-dry-grass" }, colour: 0x5b5638, alternateColour: 0x625b3b, detailColour: 0x978b58, minimapColour: "#6c6543" },
      { id: "upland_grass", label: "Upland grass", preview: { kind: "texture", assetId: "ground-upland-grass" }, colour: 0x394432, alternateColour: 0x3e4935, detailColour: 0x718064, minimapColour: "#48533f" },
    ],
  },
  rough: {
    authoring: { tool: "paint", paletteGroup: "ground", paletteOrder: 20, preview: { kind: "colour" } },
    label: "Rough ground", description: "rough ground · costs 2 movement · limits charges · -1 resistance", colour: 0x554e35,
    strokeColour: 0x75806a, strokeWidth: 1, minimapColour: "#6b6142", movementCost: 2,
    blocksVoluntaryMovement: false, lethalForcedDestination: false, allowsCharge: false,
    limitsInfantryCharge: true, blocksLineOfSight: false, spaceOccupancy: 0,
    resistanceModifier: -1,
    groundTextures: [
      { id: "rough_ground", label: "Broken ground", preview: { kind: "texture", assetId: "ground-rough" }, colour: 0x554e35, detailColour: 0x8e7f55, minimapColour: "#6b6142" },
      { id: "heather_moor", label: "Heather moor", preview: { kind: "texture", assetId: "ground-heather-moor" }, colour: 0x4c403d, alternateColour: 0x51433f, detailColour: 0x80617a, minimapColour: "#5b4c51" },
      { id: "ploughed_field", label: "Ploughed field", preview: { kind: "texture", assetId: "ground-ploughed-field" }, colour: 0x5b4632, alternateColour: 0x624b35, detailColour: 0x92704d, minimapColour: "#684f38" },
      { id: "scree", label: "Scree", preview: { kind: "texture", assetId: "ground-scree" }, colour: 0x4d514a, detailColour: 0x858a80, minimapColour: "#5e625a" },
      { id: "shingle", label: "Shingle", preview: { kind: "texture", assetId: "ground-shingle" }, colour: 0x625e50, detailColour: 0x9a927b, minimapColour: "#716c5d" },
    ],
  },
  dangerous: {
    authoring: { tool: "paint", paletteGroup: "ground", paletteOrder: 25, preview: { kind: "texture", assetId: "ground-swamp" } },
    label: "Dangerous ground", description: "dangerous ground · costs 2 movement · limits charges · +1 damage received",
    colour: 0x354238, strokeColour: 0x697763, strokeWidth: 1, minimapColour: "#465449", movementCost: 2,
    blocksVoluntaryMovement: false, lethalForcedDestination: false, allowsCharge: false,
    limitsInfantryCharge: true, blocksLineOfSight: false, spaceOccupancy: 0,
    resistanceModifier: -1, meleeDamageReceivedBonus: 1,
    groundTextures: [
      { id: "swamp", label: "Swamp", preview: { kind: "texture", assetId: "ground-swamp" }, colour: 0x354238, alternateColour: 0x39483d, detailColour: 0x71806a, minimapColour: "#465449" },
      { id: "peat_bog", label: "Peat bog", preview: { kind: "texture", assetId: "ground-peat-bog" }, colour: 0x403a30, alternateColour: 0x463e32, detailColour: 0x75634b, minimapColour: "#50483b" },
      { id: "saltmarsh", label: "Saltmarsh", preview: { kind: "texture", assetId: "ground-saltmarsh" }, colour: 0x465044, alternateColour: 0x4b5649, detailColour: 0x81917a, minimapColour: "#576253" },
      { id: "mudflat", label: "Mudflat", preview: { kind: "texture", assetId: "ground-mudflat" }, colour: 0x554c40, alternateColour: 0x5a5043, detailColour: 0x8b7b67, minimapColour: "#665b4c" },
    ],
  },
  forest: {
    authoring: { tool: "paint", paletteGroup: "vegetation", paletteOrder: 35, preview: { kind: "texture", assetId: "forest-floor" } },
    label: "Forest floor", description: "forest floor · limits charges", colour: 0x293a26,
    alternateColour: 0x30432b, strokeColour: 0x62745a, strokeWidth: 1, minimapColour: "#30452d", movementCost: 1,
    blocksVoluntaryMovement: false, lethalForcedDestination: false, allowsCharge: false,
    limitsInfantryCharge: true, blocksLineOfSight: false, spaceOccupancy: 0,
  },
  impassable: {
    authoring: { tool: "paint", paletteGroup: "obstacle", paletteOrder: 70, preview: { kind: "colour" } },
    label: "Impassable", description: "impassable ground", colour: 0x2c302c,
    strokeColour: 0x868a79, strokeWidth: 2, minimapColour: "#242824", movementCost: 1,
    blocksVoluntaryMovement: true, lethalForcedDestination: false, allowsCharge: false,
    limitsInfantryCharge: false, blocksLineOfSight: true, spaceOccupancy: 0,
  },
  tree_small: {
    authoring: { tool: "art-object", paletteGroup: "vegetation", paletteOrder: 40, preview: { kind: "art-object", assetId: "tree-small" } },
    label: "Small tree", description: "small tree · occupies 1 soldier space", colour: 0x30452c,
    strokeColour: 0x75806a, strokeWidth: 1, minimapColour: "#355a35", movementCost: 1,
    blocksVoluntaryMovement: false, lethalForcedDestination: false, allowsCharge: true,
    limitsInfantryCharge: false, blocksLineOfSight: false, spaceOccupancy: 1,
  },
  tree_large: {
    authoring: { tool: "art-object", paletteGroup: "vegetation", paletteOrder: 50, preview: { kind: "art-object", assetId: "tree-large" } },
    label: "Large tree", description: "large tree · occupies 4 soldier spaces", colour: 0x263b27,
    strokeColour: 0x75806a, strokeWidth: 1, minimapColour: "#264a2c", movementCost: 1,
    blocksVoluntaryMovement: false, lethalForcedDestination: false, allowsCharge: true,
    limitsInfantryCharge: false, blocksLineOfSight: false, spaceOccupancy: 4,
  },
  rock_small: {
    authoring: { tool: "art-object", paletteGroup: "obstacle", paletteOrder: 45, preview: { kind: "art-object", assetId: "rock-small" } },
    label: "Small rock", description: "small rock · occupies 1 soldier space", colour: 0x555951,
    strokeColour: 0x85897e, strokeWidth: 1, minimapColour: "#555951", movementCost: 1,
    blocksVoluntaryMovement: false, lethalForcedDestination: false, allowsCharge: true,
    limitsInfantryCharge: false, blocksLineOfSight: false, spaceOccupancy: 1,
  },
  rock_large: {
    authoring: { tool: "art-object", paletteGroup: "obstacle", paletteOrder: 55, preview: { kind: "art-object", assetId: "rock-large" } },
    label: "Large rock", description: "large rock · occupies 4 soldier spaces", colour: 0x484c47,
    strokeColour: 0x85897e, strokeWidth: 1, minimapColour: "#484c47", movementCost: 1,
    blocksVoluntaryMovement: false, lethalForcedDestination: false, allowsCharge: true,
    limitsInfantryCharge: false, blocksLineOfSight: false, spaceOccupancy: 4,
  },
  pond: {
    authoring: { tool: "art-object", paletteGroup: "water", paletteOrder: 59, preview: { kind: "art-object", assetId: "pond" } },
    label: "Pond", description: "pond · occupies 4 soldier spaces", colour: 0x315a5d,
    strokeColour: 0x70a7a1, strokeWidth: 1, minimapColour: "#315a5d", movementCost: 1,
    blocksVoluntaryMovement: false, lethalForcedDestination: false, allowsCharge: true,
    limitsInfantryCharge: false, blocksLineOfSight: false, spaceOccupancy: 4,
  },
  road: {
    authoring: { tool: "paint", paletteGroup: "ground", paletteOrder: 30, preview: { kind: "colour" } },
    label: "Road", description: "road · costs ½ movement", colour: 0x776b50,
    strokeColour: 0x75806a, strokeWidth: 1, minimapColour: "#8e8164", movementCost: 0.5,
    blocksVoluntaryMovement: false, lethalForcedDestination: false, allowsCharge: true,
    limitsInfantryCharge: false, blocksLineOfSight: false, spaceOccupancy: 0,
  },
  fortress_wall: {
    authoring: { tool: "paint", paletteGroup: "structure", paletteOrder: 85, preview: { kind: "texture", assetId: "fortress-wall-stone" } },
    label: "Fortress wall", description: "fortress wall top · walkable · limits charges · sides are cliffs",
    colour: 0x77766c, alternateColour: 0x818076, strokeColour: 0xb0aa98, strokeWidth: 2,
    minimapColour: "#8b887d", movementCost: 1, surfaceElevationOffset: 2,
    blocksVoluntaryMovement: false, lethalForcedDestination: false, allowsCharge: false,
    limitsInfantryCharge: true, blocksLineOfSight: true, spaceOccupancy: 0,
  },
  building: {
    authoring: { tool: "building", paletteGroup: "structure", paletteOrder: 90, preview: { kind: "colour" } },
    label: "Building", description: "building", colour: 0x715f49,
    strokeColour: 0x75806a, strokeWidth: 1, minimapColour: "#806c54", movementCost: 1,
    blocksVoluntaryMovement: true, lethalForcedDestination: false, allowsCharge: false,
    limitsInfantryCharge: false, blocksLineOfSight: true, spaceOccupancy: 0,
  },
  river_shallow: {
    authoring: { tool: "paint", paletteGroup: "water", paletteOrder: 60, preview: { kind: "colour" } },
    label: "Shallow river", description: "shallow river · costs 2 movement · +1 damage received", colour: 0x3d7180,
    strokeColour: 0x75806a, strokeWidth: 1, minimapColour: "#4e93a3", movementCost: 2,
    blocksVoluntaryMovement: false, lethalForcedDestination: false, allowsCharge: false,
    limitsInfantryCharge: true, blocksLineOfSight: false, spaceOccupancy: 0,
    meleeDamageReceivedBonus: 1,
  },
  river_deep: {
    authoring: { tool: "paint", paletteGroup: "water", paletteOrder: 80, preview: { kind: "colour" } },
    label: "Deep river", description: "deep river · impassable · extra pressure resistance · forced blocks drown",
    colour: 0x244e68, strokeColour: 0x75b7cb, strokeWidth: 2, minimapColour: "#245a78", movementCost: 1,
    blocksVoluntaryMovement: true, lethalForcedDestination: true, allowsCharge: false,
    limitsInfantryCharge: false, blocksLineOfSight: false, spaceOccupancy: 0,
  },
} as const satisfies Record<TerrainType, TerrainDefinition>;

export type GroundTerrainType = {
  [Terrain in keyof typeof TERRAIN_AUTHORING_REGISTRY]:
  typeof TERRAIN_AUTHORING_REGISTRY[Terrain]["authoring"]["tool"] extends "paint" ? Terrain : never;
}[keyof typeof TERRAIN_AUTHORING_REGISTRY];

export type TerrainObjectType = {
  [Terrain in keyof typeof TERRAIN_AUTHORING_REGISTRY]:
  typeof TERRAIN_AUTHORING_REGISTRY[Terrain]["authoring"]["tool"] extends "art-object" ? Terrain : never;
}[keyof typeof TERRAIN_AUTHORING_REGISTRY];

export type GroundTextureId = {
  [Terrain in keyof typeof TERRAIN_AUTHORING_REGISTRY]:
  typeof TERRAIN_AUTHORING_REGISTRY[Terrain] extends { groundTextures: readonly (infer Texture)[] }
    ? Texture extends { id: infer Id extends string } ? Id : never
    : never;
}[keyof typeof TERRAIN_AUTHORING_REGISTRY];

export const AUTHORABLE_GROUND_TERRAIN_TYPES = Object.freeze(
  (Object.keys(TERRAIN_AUTHORING_REGISTRY) as TerrainType[])
    .filter((terrain): terrain is GroundTerrainType => TERRAIN_AUTHORING_REGISTRY[terrain].authoring.tool === "paint")
    .sort((left, right) => TERRAIN_AUTHORING_REGISTRY[left].authoring.paletteOrder
      - TERRAIN_AUTHORING_REGISTRY[right].authoring.paletteOrder),
);

export const AUTHORABLE_TERRAIN_OBJECT_TYPES = Object.freeze(
  (Object.keys(TERRAIN_AUTHORING_REGISTRY) as TerrainType[])
    .filter((terrain): terrain is TerrainObjectType => TERRAIN_AUTHORING_REGISTRY[terrain].authoring.tool === "art-object")
    .sort((left, right) => TERRAIN_AUTHORING_REGISTRY[left].authoring.paletteOrder
      - TERRAIN_AUTHORING_REGISTRY[right].authoring.paletteOrder),
);

export function isGroundTerrain(value: unknown): value is GroundTerrainType {
  return typeof value === "string"
    && Object.hasOwn(TERRAIN_AUTHORING_REGISTRY, value)
    && TERRAIN_AUTHORING_REGISTRY[value as TerrainType].authoring.tool === "paint";
}

export function isTerrainObject(value: unknown): value is TerrainObjectType {
  return typeof value === "string"
    && Object.hasOwn(TERRAIN_AUTHORING_REGISTRY, value)
    && TERRAIN_AUTHORING_REGISTRY[value as TerrainType].authoring.tool === "art-object";
}

export function groundTexturesForTerrain(terrain: GroundTerrainType): readonly GroundTextureDefinition[] {
  return terrainDefinition(terrain).groundTextures ?? [];
}

export function terrainSupportsGroundTexture(
  terrain: GroundTerrainType,
  texture: GroundTextureId,
): boolean {
  return groundTexturesForTerrain(terrain).some((definition) => definition.id === texture);
}

export function isGroundTexture(value: unknown): value is GroundTextureId {
  return typeof value === "string" && AUTHORABLE_GROUND_TERRAIN_TYPES.some(
    (terrain) => groundTexturesForTerrain(terrain).some((definition) => definition.id === value),
  );
}

export function defaultGroundTexture(terrain: GroundTerrainType): GroundTextureId | undefined {
  return groundTexturesForTerrain(terrain)[0]?.id as GroundTextureId | undefined;
}

export function groundTextureDefinition(texture: GroundTextureId): GroundTextureDefinition {
  for (const terrain of AUTHORABLE_GROUND_TERRAIN_TYPES) {
    const definition = groundTexturesForTerrain(terrain).find((candidate) => candidate.id === texture);
    if (definition) return definition;
  }
  throw new Error(`Unknown ground texture ${texture}.`);
}

export function terrainDefinition(terrain: TerrainType): TerrainDefinition {
  return TERRAIN_AUTHORING_REGISTRY[terrain];
}
