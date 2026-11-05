export type EdgeFeatureEnclosure = "open" | "enclosed";
export type EdgeFeatureHeight = "short" | "tall";
export type EdgeFeatureAppearance = "generic" | "hedge" | "stone_wall" | "door";

export interface EdgeFeatureAuthoringDefinition {
  label: string;
  description: string;
  enclosure: EdgeFeatureEnclosure;
  height: EdgeFeatureHeight;
  appearance: EdgeFeatureAppearance;
  blocksLineOfSight: boolean;
  rangedDamageMultiplier: number;
  wallColour: number;
  topColour: number;
  roofColour?: number;
  minimapColour: string;
}

export const SHORT_EDGE_RANGED_DAMAGE_MULTIPLIER = 0.7;

export const EDGE_FEATURE_AUTHORING_REGISTRY = {
  open_short: {
    label: "Open short edge",
    description: "open short edge · provides ranged cover",
    enclosure: "open",
    height: "short",
    appearance: "generic",
    blocksLineOfSight: false,
    rangedDamageMultiplier: SHORT_EDGE_RANGED_DAMAGE_MULTIPLIER,
    wallColour: 0x6f684f,
    topColour: 0xa29670,
    minimapColour: "#8f8566",
  },
  open_tall: {
    label: "Open tall edge",
    description: "open tall edge · blocks line of sight",
    enclosure: "open",
    height: "tall",
    appearance: "generic",
    blocksLineOfSight: true,
    rangedDamageMultiplier: 1,
    wallColour: 0x5f5b4b,
    topColour: 0x99927a,
    minimapColour: "#777160",
  },
  enclosed_short: {
    label: "Enclosed short edge",
    description: "enclosed short edge · roofed · provides ranged cover",
    enclosure: "enclosed",
    height: "short",
    appearance: "generic",
    blocksLineOfSight: false,
    rangedDamageMultiplier: SHORT_EDGE_RANGED_DAMAGE_MULTIPLIER,
    wallColour: 0x765d45,
    topColour: 0xae8a66,
    roofColour: 0x584332,
    minimapColour: "#8c6c50",
  },
  enclosed_tall: {
    label: "Enclosed tall edge",
    description: "enclosed tall edge · roofed · blocks line of sight",
    enclosure: "enclosed",
    height: "tall",
    appearance: "generic",
    blocksLineOfSight: true,
    rangedDamageMultiplier: 1,
    wallColour: 0x654d3c,
    topColour: 0x9d775b,
    roofColour: 0x493528,
    minimapColour: "#725744",
  },
  hedge_short: {
    label: "Low hedge",
    description: "low hedge · provides ranged cover",
    enclosure: "open",
    height: "short",
    appearance: "hedge",
    blocksLineOfSight: false,
    rangedDamageMultiplier: SHORT_EDGE_RANGED_DAMAGE_MULTIPLIER,
    wallColour: 0x31502c,
    topColour: 0x69824a,
    minimapColour: "#587443",
  },
  hedge_tall: {
    label: "Tall hedge",
    description: "tall hedge · blocks line of sight",
    enclosure: "open",
    height: "tall",
    appearance: "hedge",
    blocksLineOfSight: true,
    rangedDamageMultiplier: 1,
    wallColour: 0x263f25,
    topColour: 0x58743f,
    minimapColour: "#48663a",
  },
  stone_wall_short: {
    label: "Low stone wall",
    description: "low stone wall · provides ranged cover",
    enclosure: "enclosed",
    height: "short",
    appearance: "stone_wall",
    blocksLineOfSight: false,
    rangedDamageMultiplier: SHORT_EDGE_RANGED_DAMAGE_MULTIPLIER,
    wallColour: 0x68675f,
    topColour: 0xa19f91,
    roofColour: 0x858378,
    minimapColour: "#84837a",
  },
  stone_wall_tall: {
    label: "High stone wall",
    description: "high stone wall · blocks line of sight",
    enclosure: "enclosed",
    height: "tall",
    appearance: "stone_wall",
    blocksLineOfSight: true,
    rangedDamageMultiplier: 1,
    wallColour: 0x55564f,
    topColour: 0x94948a,
    roofColour: 0x74756c,
    minimapColour: "#72736c",
  },
  wooden_door: {
    label: "Wooden door",
    description: "closed wooden door · blocks line of sight",
    enclosure: "enclosed",
    height: "tall",
    appearance: "door",
    blocksLineOfSight: true,
    rangedDamageMultiplier: 1,
    wallColour: 0x60442e,
    topColour: 0xb08355,
    roofColour: 0x775236,
    minimapColour: "#8e623e",
  },
} as const satisfies Record<string, EdgeFeatureAuthoringDefinition>;

export type EdgeFeatureType = keyof typeof EDGE_FEATURE_AUTHORING_REGISTRY;

export const AUTHORABLE_EDGE_FEATURE_TYPES = Object.freeze([
  "hedge_short",
  "hedge_tall",
  "stone_wall_short",
  "stone_wall_tall",
  "wooden_door",
] as const satisfies readonly EdgeFeatureType[]);

export function isEdgeFeatureType(value: unknown): value is EdgeFeatureType {
  return typeof value === "string" && Object.hasOwn(EDGE_FEATURE_AUTHORING_REGISTRY, value);
}

export function edgeFeatureDefinition(type: EdgeFeatureType): EdgeFeatureAuthoringDefinition {
  return EDGE_FEATURE_AUTHORING_REGISTRY[type];
}
