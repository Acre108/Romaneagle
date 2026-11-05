# Battlefield map format

Terrain is authored as a versioned `BattlefieldMapDocument` and converted to runtime state with
`createBattlefieldMap`. The saved document contains dimensions, row-major tiles, building definitions,
edge-feature placements, deployments, and campaign spawnpoints. Runtime revision history and derived building
cells are deliberately excluded.

```ts
interface BattlefieldMapDocument {
  schemaVersion: 2;
  width: number;
  height: number;
  tiles: TerrainTile[]; // exactly width * height, row-major
  buildings: BuildingDefinition[];
  edgeFeatures?: EdgeFeaturePlacement[];
  triggers?: MapTriggerDefinition[];
  deployments?: MapFormationDeployment[];
  spawnPoints?: MapSpawnPoint[];
}

interface TerrainTile {
  terrain: GroundTerrainType;
  groundTexture?: GroundTextureId;
  elevation: number;
  ramp?: Direction;
  objects?: TerrainObjectType[];
}

interface BuildingDefinition {
  id: string;
  origin: GridPosition;
  width: number;
  depth: number;
}

interface EdgeFeaturePlacement {
  position: GridPosition;
  direction: Direction;
  type: "hedge_short" | "hedge_tall" | "stone_wall_short" | "stone_wall_tall" | "wooden_door"
    | "open_short" | "open_tall" | "enclosed_short" | "enclosed_tall";
}

interface MapFormationDeployment {
  id: string;
  name: string;
  factionId: "roman" | "saxon";
  archetypeId: UnitArchetypeId;
  facing: Direction;
  positions: GridPosition[];
}

interface MapSpawnPoint {
  factionId: "roman" | "saxon";
  position: GridPosition;
}
```

## Editor rules

- Load maps with `createBattlefieldMap` and save them with `serializeBattlefieldMap`.
- Use `setMapTerrain`, `setMapGroundTexture`, `addMapTerrainObject`, `removeMapTerrainObject`, `clearMapTerrainObjects`,
  `setMapEdgeFeature`, `removeMapEdgeFeature`,
  `setMapElevation`, `setMapRamp`, `addMapBuilding`, `removeMapBuilding`, and
  `addMapTrigger`, `removeMapTrigger`, and `resizeBattlefieldMap`; do not mutate tile arrays directly.
- Elevation must be an integer from `MINIMUM_MAP_ELEVATION` (`-4`) through
  `MAXIMUM_MAP_ELEVATION` (`10`), inclusive. Registered terrain height offsets also count toward these
  bounds; editor controls should import the constants and use the map setters rather than pre-validating raw values.
- A ramp is presentation metadata for a sloped surface. It belongs to its lower tile and must point to an
  orthogonally adjacent tile exactly one level higher; it is not required for movement.
- Changing elevation automatically removes ramps that are no longer valid.
- Adjacent tiles with an elevation difference of one are traversable uphill or downhill. A difference of
  more than one is a cliff: voluntary movement is blocked, while a block forced across it is destroyed.
- Ridges are elevation borders, not a paintable terrain type.
- Open ground has only three gameplay categories. Each category contains interchangeable visual textures:
  - `clear`: grass, pasture, dry grass, and upland grass. Movement costs one; charges and Resistance are unaffected.
  - `rough`: rough ground, heather moor, ploughed field, scree, and shingle. Movement costs two, charges are limited, and Resistance is reduced by one.
  - `dangerous`: swamp, peat bog, saltmarsh, and mudflat. It has the rough-ground rules and adds one incoming melee casualty.
- The map editor presents those three categories as expandable menus. Selecting a registered subtype paints both
  its parent gameplay category and its `groundTexture`; selecting roads, rivers, forest floor, obstacles, or
  structures remains a direct one-step terrain paint operation.
- A tile's optional `groundTexture` must belong to its ground category. Changing category with `setMapTerrain`
  clears an incompatible texture; `setMapGroundTexture` rejects cross-category combinations. If no texture is saved,
  the renderer uses that category's first registered texture. Texture choice never changes gameplay rules.
- Each tile has one ground type and may stack any mix of terrain art objects. Every object declares an integer
  footprint from one through four of the shared nine soldier spaces. Object placement cannot exceed nine
  occupied spaces, so two four-space objects plus one one-space object completely block a tile.
- Trees, rocks, and ponds are currently capacity-only objects. They can share a tile whenever their combined
  footprint fits, and they do not change movement cost, charging, line of sight, damage, or forced-movement
  hazards. Paint the
  ground as `forest` when a wooded area should use the forest-floor texture and limit infantry and cavalry charges.
- Buildings are solid rectangular footprints. They have unique IDs, occupy at least four cells, cannot overlap,
  must be level, and cannot occupy ramps, fortress walls, or terrain objects. Every covered cell consumes all nine
  soldier spaces, blocks voluntary and forced entry, and blocks line of sight. Doors and enterable interiors are not
  part of the solid-building prototype.
- In the map editor, choose a width and depth and click the north-west origin tile to place the footprint. The
  hover preview is green when the complete footprint is valid and red when it would violate a building rule.
  The remove tool, or right-click while a building tool is selected, removes the complete building from any of
  its covered cells.
- Building cell coverage and outer edges are derived from building definitions and are never serialized separately.
- `fortress_wall` is a paintable, occupiable structure surface with a registered height offset of `+2`. Blocks move
  and fight normally between adjoining wall-top cells. A wall side therefore has a two-level difference from ordinary
  ground: voluntary crossing is blocked and a block forced over it falls. Provide access with an adjoining effective
  height-one approach; a ramp may be placed on the lower approach tile for presentation. Fortress-wall cells cannot
  contain terrain objects, buildings, or ramps and they limit charges.
- Fortress walls block ground-level ranged lines passing across them. A block standing at wall-top height can shoot
  over the wall, including along a continuous wall walk.
- Edge features belong to one physical border shared by two neighbouring tiles. Authoring or removing the border
  from either tile side addresses the same feature, so maps cannot contain doubled edges. At an elevation change the
  renderer anchors the feature to the higher surface.
- In the map editor, select one of the five concrete edge-object types and click or drag near a tile side; the nearest side is
  highlighted and receives the boundary. Right-click or the remove-edge tool deletes that same shared physical edge.
- Authorable boundaries are low or tall hedges, low or high stone walls, and closed wooden doors. The four older
  `open_*`/`enclosed_*` types remain valid so existing scenarios and saved maps continue to load, but they are no
  longer shown in the editor palette.
- `short` edges do not block line of sight. A ranged attack crossing a short edge immediately before entering its
  target tile deals `70%` damage. `tall` edges block every ranged line that crosses them, including the final border
  into a target tile. Both rules work identically from either side of the shared edge.
- Edge features, including closed doors, do not currently affect movement, charging, melee, tile capacity, elevation,
  or forced movement. Door opening and movement-blocking boundaries should be added as explicit registry and state
  fields if the prototype later needs interactive gates.
- Renderer consumers use the revisioned change log to update edited tiles and neighbouring ledges only.
- Map triggers are serialized authoring data but their fire counts and interaction history belong to `GameState`.
  See [TRIGGERS.md](./TRIGGERS.md) for the supported conditions, effects, ordering, and failure rules.
- Unit deployment is painted one block at a time for either faction. Four-directionally connected blocks with the
  same faction and archetype are normalized into one formation; disconnected islands are separate formations.
  Diagonal contact alone does not join formations. Deployment blocks cannot overlap, occupy buildings, or use
  terrain that blocks voluntary movement.
- Custom battles instantiate the normalized deployments, give Rome to the player and Saxons to the formation AI,
  and end when every enemy formation is ineffective. Authored spawnpoints do not create units in custom battles.
- Spawnpoints are faction-tagged campaign authoring data. The current prototype stores and validates them but does
  not yet implement campaign reinforcement timing, spawn selection, or trigger integration.

`TERRAIN_AUTHORING_REGISTRY` is the single exhaustive registry for terrain labels, palette grouping and
ordering, editor preview metadata, nested ground textures, structure height offsets, colours, minimap colours,
movement properties, charge restrictions, lethal forced-movement behaviour, and line-of-sight blocking.
`AUTHORABLE_GROUND_TERRAIN_TYPES` is derived
from registry entries whose authoring tool is `paint`. `AUTHORABLE_TERRAIN_OBJECT_TYPES` is derived from
entries using the `art-object` tool; buildings use the separate `building` tool.

Editor preview metadata is a discriminated union supporting colours, texture asset IDs, and art-object asset IDs
without placing PixiJS asset loading in the map model.

`EDGE_FEATURE_AUTHORING_REGISTRY` is the exhaustive editor and rules registry for concrete hedge, stone-wall, and
door boundaries plus the four legacy structural types. It owns their labels, descriptions, appearances,
line-of-sight behaviour, cover multiplier, and rendering colours.

Current object footprints are: small tree `1`, large tree `4`, small rock `1`, large rock `4`, and pond `4`.
Additional object types should use the same registry field rather than adding object-specific capacity rules.

## Campaign battlefields

Mission One uses `createHadriansWallBattlefieldMap` rather than the generic prototype map. Its authored layout
places a walkable east-west wall across the Roman rear, leaves a two-square road through the milecastle gate,
adds tower buildings behind the gate, and divides the northern approach into western moor, open central ground,
and an eastern wood. The mission scenario factory also places the allied archers on the wall walk.

Mission Two uses `createBlackwaterFordBattlefieldMap`. A two-row river divides the battlefield; the main road
crosses a three-file shallow ford while a narrower eastern crossing gives cavalry a flank route. Deep water is
impassable and lethal to forced retreats. A Saxon formation begins as a bridgehead on the southern bank while
the remaining warband and cavalry hold the raised northern side. The TEST SCENARIO continues to use the generic
prototype battlefield and its trigger so that mechanics experiments remain repeatable from campaign select.

Mission Three uses `createVindolandaBattlefieldMap`. Vindolanda's old fort occupies the northern edge with a
two-square southern gate, wall access ramps, and two solid barrack buildings. The north-south military road meets
an east-west road immediately behind the Raven host. Rough flanks and low ruined boundaries constrain the side
formations while the eastern approach leaves room for the cavalry fight described in the briefing. The Roman line
begins south of the junction and the Saxon host forms directly beneath the fort.
