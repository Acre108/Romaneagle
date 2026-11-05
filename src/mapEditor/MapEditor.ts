import {
  addMapBuilding,
  addMapTerrainObject,
  clearMapTerrainObjects,
  createBlankBattlefieldMap,
  edgeFeaturePhysicalKey,
  mapElevationRange,
  mapTileSurfaceElevation,
  mapTileAt,
  MAXIMUM_MAP_ELEVATION,
  MINIMUM_MAP_ELEVATION,
  removeMapDeploymentBlock,
  removeMapBuilding,
  removeMapEdgeFeature,
  removeMapSpawnPoint,
  serializeBattlefieldMap,
  setMapDeploymentBlock,
  setMapElevation,
  setMapEdgeFeature,
  setMapGroundTexture,
  setMapRamp,
  setMapSpawnPoint,
  setMapTerrain,
  type BattlefieldMap,
  type EdgeFeaturePlacement,
  type EdgeFeatureType,
  type GroundTerrainType,
  type GroundTextureId,
  type MapFormationDeployment,
  type MapSpawnPoint,
  type TerrainObjectType,
} from "../gridBattle/model/battlefieldMap";
import {
  AUTHORABLE_GROUND_TERRAIN_TYPES,
  AUTHORABLE_TERRAIN_OBJECT_TYPES,
  defaultGroundTexture,
  groundTextureDefinition,
  groundTexturesForTerrain,
  terrainDefinition,
} from "../gridBattle/model/terrainDefinitions";
import {
  AUTHORABLE_EDGE_FEATURE_TYPES,
  edgeFeatureDefinition,
} from "../gridBattle/model/edgeFeatureDefinitions";
import type { BuildingCell, Direction, FactionId, GridPosition } from "../gridBattle/model/types";
import {
  UNIT_ARCHETYPES,
  getUnitArchetype,
  type UnitArchetypeId,
} from "../units/UnitArchetypes";
import { MapEditHistory } from "./MapEditHistory";
import { ProjectMapConflictError, projectMapFileName, saveProjectMap } from "./MapStorage";

export const MINIMUM_EDITOR_MAP_SIZE = 4;
export const MAXIMUM_EDITOR_MAP_SIZE = 64;
export const MAXIMUM_EDITOR_BUILDING_SIZE = 12;

export type MapEditorTool =
  | { kind: "terrain"; terrain: GroundTerrainType }
  | { kind: "ground-texture"; terrain: GroundTerrainType; texture: GroundTextureId }
  | { kind: "elevation"; elevation: number }
  | { kind: "elevation-delta"; delta: -1 | 1 }
  | { kind: "ramp"; direction: Direction }
  | { kind: "erase-ramp" }
  | { kind: "building"; width: number; depth: number }
  | { kind: "erase-building" }
  | { kind: "edge"; type: EdgeFeatureType }
  | { kind: "erase-edge" }
  | { kind: "object"; object: TerrainObjectType }
  | { kind: "erase-objects" }
  | { kind: "unit"; factionId: FactionId; archetypeId: UnitArchetypeId }
  | { kind: "erase-unit" }
  | { kind: "spawn"; factionId: FactionId }
  | { kind: "erase-spawn" };

export function applyMapEditorTool(
  map: BattlefieldMap,
  position: GridPosition,
  tool: MapEditorTool,
  edgeDirection?: Direction,
): void {
  if (tool.kind === "terrain") {
    setMapTerrain(map, position, tool.terrain);
    return;
  }
  if (tool.kind === "ground-texture") {
    setMapTerrain(map, position, tool.terrain);
    setMapGroundTexture(map, position, tool.texture);
    return;
  }
  if (tool.kind === "elevation") {
    setMapElevation(map, position, tool.elevation);
    return;
  }
  if (tool.kind === "elevation-delta") {
    const elevation = mapTileAt(map, position)?.elevation;
    if (elevation === undefined) throw new Error("That elevation tile is outside the battlefield.");
    setMapElevation(map, position, elevation + tool.delta);
    return;
  }
  if (tool.kind === "ramp") {
    setMapRamp(map, position, tool.direction);
    return;
  }
  if (tool.kind === "erase-ramp") {
    setMapRamp(map, position, undefined);
    return;
  }
  if (tool.kind === "building") {
    let id = `building-${position.x}-${position.y}`;
    let suffix = 2;
    while (map.buildings.some((building) => building.id === id)) {
      id = `building-${position.x}-${position.y}-${suffix}`;
      suffix += 1;
    }
    addMapBuilding(map, { id, origin: { ...position }, width: tool.width, depth: tool.depth });
    return;
  }
  if (tool.kind === "erase-building") {
    const buildingId = map.buildingCells[`${position.x},${position.y}`]?.buildingId;
    if (buildingId) removeMapBuilding(map, buildingId);
    return;
  }
  if (tool.kind === "edge") {
    if (!edgeDirection) throw new Error("Choose a tile edge for the boundary object.");
    setMapEdgeFeature(map, position, edgeDirection, tool.type);
    return;
  }
  if (tool.kind === "erase-edge") {
    if (!edgeDirection) throw new Error("Choose a tile edge to remove.");
    removeMapEdgeFeature(map, position, edgeDirection);
    return;
  }
  if (tool.kind === "object") {
    addMapTerrainObject(map, position, tool.object);
    return;
  }
  if (tool.kind === "erase-objects") {
    clearMapTerrainObjects(map, position);
    return;
  }
  if (tool.kind === "unit") {
    setMapDeploymentBlock(map, position, tool.factionId, tool.archetypeId);
    return;
  }
  if (tool.kind === "erase-unit") {
    removeMapDeploymentBlock(map, position);
    return;
  }
  if (tool.kind === "spawn") {
    setMapSpawnPoint(map, position, tool.factionId);
    return;
  }
  removeMapSpawnPoint(map, position);
}

/** Removes whatever the selected tool paints from a tile, and describes what happened. */
export function eraseMapEditorLayer(
  map: BattlefieldMap,
  position: GridPosition,
  tool: MapEditorTool,
  edge: { position: GridPosition; direction: Direction } | null,
): string {
  const at = `${position.x}, ${position.y}`;
  switch (tool.kind) {
    case "unit":
    case "erase-unit":
      return removeMapDeploymentBlock(map, position) ? `Removed the unit block at ${at}.` : `No unit block at ${at}.`;
    case "spawn":
    case "erase-spawn":
      return removeMapSpawnPoint(map, position) ? `Removed the spawnpoint at ${at}.` : `No spawnpoint at ${at}.`;
    case "ramp":
    case "erase-ramp":
      setMapRamp(map, position, undefined);
      return `Removed the ramp at ${at}.`;
    case "building":
    case "erase-building": {
      const buildingId = map.buildingCells[`${position.x},${position.y}`]?.buildingId;
      if (!buildingId) return `No building occupies ${at}.`;
      removeMapBuilding(map, buildingId);
      return `Removed ${buildingId}.`;
    }
    case "edge":
    case "erase-edge":
      if (!edge) return "Right-click nearer a tile edge.";
      return removeMapEdgeFeature(map, edge.position, edge.direction)
        ? `Removed the ${edge.direction} edge at ${edge.position.x}, ${edge.position.y}.`
        : `No edge object occupies that ${edge.direction} boundary.`;
    case "elevation":
    case "elevation-delta":
      setMapElevation(map, position, 0);
      return `Reset elevation at ${at} to 0.`;
    case "object":
    case "erase-objects": {
      const hadObjects = (mapTileAt(map, position)?.objects?.length ?? 0) > 0;
      clearMapTerrainObjects(map, position);
      return hadObjects ? `Removed objects from ${at}.` : `No objects at ${at}.`;
    }
    case "terrain":
    case "ground-texture":
      setMapTerrain(map, position, "clear");
      setMapGroundTexture(map, position, undefined);
      return `Reset terrain at ${at} to clear ground.`;
  }
}

/** Every tile a drag passes through, sharing sides so painted lines stay connected. */
export function tilesAlongLine(from: GridPosition, to: GridPosition): GridPosition[] {
  const distanceX = Math.abs(to.x - from.x);
  const distanceY = Math.abs(to.y - from.y);
  const stepX = Math.sign(to.x - from.x);
  const stepY = Math.sign(to.y - from.y);
  const tiles = [{ x: from.x, y: from.y }];
  let walkedX = 0;
  let walkedY = 0;
  while (walkedX < distanceX || walkedY < distanceY) {
    if ((2 * walkedX + 1) * distanceY < (2 * walkedY + 1) * distanceX) walkedX += 1;
    else walkedY += 1;
    tiles.push({ x: from.x + walkedX * stepX, y: from.y + walkedY * stepY });
  }
  return tiles;
}

export function mapEditorObjectCount(map: BattlefieldMap): number {
  let count = 0;
  for (const tile of map.tiles) count += tile.objects?.length ?? 0;
  return count;
}

interface CanvasLayout {
  cellSize: number;
  originX: number;
  originY: number;
}

function requiredDescendant<T extends HTMLElement>(root: HTMLElement, selector: string): T {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`Missing map editor element ${selector}`);
  return element as T;
}

function cssColour(colour: number): string {
  return `#${colour.toString(16).padStart(6, "0")}`;
}

function toolKey(tool: MapEditorTool): string {
  if (tool.kind === "terrain") return `terrain:${tool.terrain}`;
  if (tool.kind === "ground-texture") return `ground-texture:${tool.terrain}:${tool.texture}`;
  if (tool.kind === "elevation") return `elevation:${tool.elevation}`;
  if (tool.kind === "elevation-delta") return `elevation-delta:${tool.delta}`;
  if (tool.kind === "ramp") return `ramp:${tool.direction}`;
  if (tool.kind === "erase-ramp") return "erase-ramp";
  if (tool.kind === "building") return `building:${tool.width}:${tool.depth}`;
  if (tool.kind === "erase-building") return "erase-building";
  if (tool.kind === "edge") return `edge:${tool.type}`;
  if (tool.kind === "erase-edge") return "erase-edge";
  if (tool.kind === "object") return `object:${tool.object}`;
  if (tool.kind === "erase-objects") return "erase-objects";
  if (tool.kind === "unit") return `unit:${tool.factionId}:${tool.archetypeId}`;
  if (tool.kind === "spawn") return `spawn:${tool.factionId}`;
  return tool.kind;
}

function toolLabel(tool: MapEditorTool): string {
  if (tool.kind === "terrain") return terrainDefinition(tool.terrain).label;
  if (tool.kind === "ground-texture") return groundTextureDefinition(tool.texture).label;
  if (tool.kind === "elevation") return `Paint elevation ${tool.elevation >= 0 ? "+" : ""}${tool.elevation}`;
  if (tool.kind === "elevation-delta") return tool.delta > 0 ? "Raise elevation +1" : "Lower elevation −1";
  if (tool.kind === "ramp") return `Ramp climbs ${tool.direction}`;
  if (tool.kind === "erase-ramp") return "Remove ramp";
  if (tool.kind === "building") return `Place ${tool.width} × ${tool.depth} building`;
  if (tool.kind === "erase-building") return "Remove building";
  if (tool.kind === "edge") return edgeFeatureDefinition(tool.type).label;
  if (tool.kind === "erase-edge") return "Remove edge object";
  if (tool.kind === "object") return terrainDefinition(tool.object).label;
  if (tool.kind === "erase-objects") return "Remove objects";
  if (tool.kind === "unit") return `${tool.factionId === "roman" ? "Roman" : "Saxon"} ${getUnitArchetype(tool.archetypeId).name} block`;
  if (tool.kind === "erase-unit") return "Remove unit block";
  if (tool.kind === "spawn") return `${tool.factionId === "roman" ? "Roman" : "Saxon"} spawnpoint`;
  return "Remove spawnpoint";
}

export class MapEditor {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly widthInput: HTMLInputElement;
  private readonly heightInput: HTMLInputElement;
  private readonly status: HTMLElement;
  private readonly selection: HTMLElement;
  private readonly sizeReadout: HTMLElement;
  private readonly objectReadout: HTMLElement;
  private readonly elevationReadout: HTMLElement;
  private readonly rampReadout: HTMLElement;
  private readonly buildingReadout: HTMLElement;
  private readonly edgeReadout: HTMLElement;
  private readonly unitBlockReadout: HTMLElement;
  private readonly formationReadout: HTMLElement;
  private readonly spawnReadout: HTMLElement;
  private readonly unitArchetypeSelect: HTMLSelectElement;
  private readonly elevationInput: HTMLInputElement;
  private readonly buildingWidthInput: HTMLInputElement;
  private readonly buildingDepthInput: HTMLInputElement;
  private readonly mapNameInput: HTMLInputElement;
  private readonly saveStateReadout: HTMLElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly windowEvents = new AbortController();
  private map = createBlankBattlefieldMap(16, 12);
  /** Content comparison, so undoing back to the saved map reads as saved. */
  private savedDocument = "";
  private currentDocumentCache: { map: BattlefieldMap; revision: number; json: string } | null = null;
  private savedFileName: string | null = null;
  private downloaded = false;
  /** Changes whenever a different map is opened, so a slow save cannot claim to have saved it. */
  private mapGeneration = 0;
  private readonly history = new MapEditHistory();
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private strokeStart: { document: ReturnType<typeof serializeBattlefieldMap>; revision: number } | null = null;
  private lastPaintedTile: GridPosition | null = null;
  private lastPaintedDirection: Direction | null = null;
  private tool: MapEditorTool = { kind: "ground-texture", terrain: "clear", texture: "grass" };
  private groundTextureCategory: GroundTerrainType | null = null;
  private unitFaction: FactionId = "roman";
  private hoveredTile: GridPosition | null = null;
  private hoveredEdge: { position: GridPosition; direction: Direction } | null = null;
  private pointerDown = false;
  private paintedCells = new Set<string>();
  private layout: CanvasLayout = { cellSize: 1, originX: 0, originY: 0 };

  constructor(private readonly root: HTMLElement) {
    this.canvas = requiredDescendant(root, "#map-editor-canvas");
    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable for the map editor.");
    this.context = context;
    this.widthInput = requiredDescendant(root, "#map-editor-width");
    this.heightInput = requiredDescendant(root, "#map-editor-height");
    this.status = requiredDescendant(root, "#map-editor-status");
    this.selection = requiredDescendant(root, "#map-editor-selection");
    this.sizeReadout = requiredDescendant(root, "#map-editor-size-readout");
    this.objectReadout = requiredDescendant(root, "#map-editor-object-readout");
    this.elevationReadout = requiredDescendant(root, "#map-editor-elevation-readout");
    this.rampReadout = requiredDescendant(root, "#map-editor-ramp-readout");
    this.buildingReadout = requiredDescendant(root, "#map-editor-building-readout");
    this.edgeReadout = requiredDescendant(root, "#map-editor-edge-readout");
    this.unitBlockReadout = requiredDescendant(root, "#map-editor-unit-block-readout");
    this.formationReadout = requiredDescendant(root, "#map-editor-formation-readout");
    this.spawnReadout = requiredDescendant(root, "#map-editor-spawn-readout");
    this.unitArchetypeSelect = requiredDescendant(root, "#map-editor-unit-archetype");
    this.elevationInput = requiredDescendant(root, "#map-editor-elevation-value");
    this.buildingWidthInput = requiredDescendant(root, "#map-editor-building-width");
    this.buildingDepthInput = requiredDescendant(root, "#map-editor-building-depth");
    this.mapNameInput = requiredDescendant(root, "#map-editor-name");
    this.saveStateReadout = requiredDescendant(root, "#map-editor-save-state");
    this.undoButton = requiredDescendant(root, "#map-editor-undo");
    this.redoButton = requiredDescendant(root, "#map-editor-redo");
    this.savedDocument = this.currentDocument();
    this.createPalettes();
    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(this.canvas);
    this.updateInterface("Blank 16 × 12 battlefield ready.");
  }

  refresh(): void {
    this.render();
    this.canvas.focus({ preventScroll: true });
  }

  /** Asks before throwing away edits. Returns whether the caller may replace the current map. */
  confirmDiscardChanges(): boolean {
    return !this.hasUnsavedChanges()
      || window.confirm("This map has unsaved changes that will be lost. Continue?");
  }

  private currentDocument(): string {
    const cached = this.currentDocumentCache;
    if (cached?.map === this.map && cached.revision === this.map.revision) return cached.json;
    const json = JSON.stringify(serializeBattlefieldMap(this.map));
    this.currentDocumentCache = { map: this.map, revision: this.map.revision, json };
    return json;
  }

  private hasUnsavedChanges(): boolean {
    return this.currentDocument() !== this.savedDocument;
  }

  /** A freshly opened map starts clean, with nothing to undo. */
  private startNewMap(map: BattlefieldMap, fileName: string | null): void {
    this.map = map;
    this.savedDocument = this.currentDocument();
    this.savedFileName = fileName;
    this.downloaded = false;
    this.mapGeneration += 1;
    this.history.clear();
    this.strokeStart = null;
    this.hoveredTile = null;
    this.hoveredEdge = null;
  }

  loadMap(map: BattlefieldMap, name: string, fileName: string): void {
    this.startNewMap(map, fileName);
    this.mapNameInput.value = name;
    this.widthInput.value = String(map.width);
    this.heightInput.value = String(map.height);
    this.updateInterface(`Loaded ${name} from the project maps folder.`);
  }

  destroy(): void {
    this.windowEvents.abort();
    this.resizeObserver.disconnect();
  }

  private createPalettes(): void {
    const terrainPalette = requiredDescendant(this.root, "#map-editor-terrain-tools");
    terrainPalette.replaceChildren(...AUTHORABLE_GROUND_TERRAIN_TYPES.map((terrain) => {
      const definition = terrainDefinition(terrain);
      if (groundTexturesForTerrain(terrain).length > 0) {
        return this.createGroundTextureCategoryButton(terrain);
      }
      return this.createToolButton(
        { kind: "terrain", terrain },
        definition.label,
        cssColour(definition.colour),
      );
    }));

    const selectPaintedElevation = () => {
      const elevation = this.selectedElevation();
      this.tool = { kind: "elevation", elevation };
      this.renderElevationTools();
      this.updateInterface(`${toolLabel(this.tool)} selected.`);
    };
    this.elevationInput.addEventListener("input", () => {
      const elevation = Number(this.elevationInput.value);
      if (!Number.isInteger(elevation)
        || elevation < MINIMUM_MAP_ELEVATION || elevation > MAXIMUM_MAP_ELEVATION) return;
      selectPaintedElevation();
    });
    this.elevationInput.addEventListener("change", selectPaintedElevation);
    this.renderElevationTools();

    const rampPalette = requiredDescendant(this.root, "#map-editor-ramp-tools");
    rampPalette.replaceChildren(
      this.createToolButton({ kind: "ramp", direction: "north" }, "Climb north ↑", "#9d864c"),
      this.createToolButton({ kind: "ramp", direction: "east" }, "Climb east →", "#9d864c"),
      this.createToolButton({ kind: "ramp", direction: "south" }, "Climb south ↓", "#9d864c"),
      this.createToolButton({ kind: "ramp", direction: "west" }, "Climb west ←", "#9d864c"),
      this.createToolButton({ kind: "erase-ramp" }, "Remove ramp", "#8f3031"),
    );

    const selectBuildingSize = () => {
      const size = this.selectedBuildingSize();
      this.tool = { kind: "building", ...size };
      this.renderBuildingTools();
      this.updateInterface(`${toolLabel(this.tool)} selected.`);
    };
    for (const input of [this.buildingWidthInput, this.buildingDepthInput]) {
      input.addEventListener("input", () => {
        const value = Number(input.value);
        if (Number.isInteger(value) && value >= 1 && value <= MAXIMUM_EDITOR_BUILDING_SIZE) selectBuildingSize();
      });
      input.addEventListener("change", selectBuildingSize);
    }
    this.renderBuildingTools();

    const edgePalette = requiredDescendant(this.root, "#map-editor-edge-tools");
    edgePalette.replaceChildren(
      ...AUTHORABLE_EDGE_FEATURE_TYPES.map((type) => {
        const definition = edgeFeatureDefinition(type);
        return this.createToolButton(
          { kind: "edge", type },
          definition.label,
          cssColour(definition.roofColour ?? definition.topColour),
        );
      }),
      this.createToolButton({ kind: "erase-edge" }, "Remove edge", "#8f3031"),
    );

    const objectPalette = requiredDescendant(this.root, "#map-editor-object-tools");
    const erase = this.createToolButton({ kind: "erase-objects" }, "Remove objects", "#8f3031");
    objectPalette.replaceChildren(
      ...AUTHORABLE_TERRAIN_OBJECT_TYPES.map((object) => {
        const definition = terrainDefinition(object);
        return this.createToolButton(
          { kind: "object", object },
          definition.label,
          cssColour(definition.colour),
        );
      }),
      erase,
    );
    this.root.querySelectorAll<HTMLButtonElement>("[data-editor-faction]").forEach((button) => {
      button.addEventListener("click", () => {
        const factionId = button.dataset.editorFaction;
        if (factionId !== "roman" && factionId !== "saxon") return;
        this.unitFaction = factionId;
        this.populateUnitArchetypes();
        this.renderUnitTools();
        this.updateFactionButtons();
      });
    });
    this.unitArchetypeSelect.addEventListener("change", () => this.renderUnitTools());
    this.populateUnitArchetypes();
    this.renderUnitTools();
    const spawnPalette = requiredDescendant(this.root, "#map-editor-spawn-tools");
    spawnPalette.replaceChildren(
      this.createToolButton({ kind: "spawn", factionId: "roman" }, "Roman spawnpoint", "#9b3438"),
      this.createToolButton({ kind: "spawn", factionId: "saxon" }, "Saxon spawnpoint", "#a16a35"),
      this.createToolButton({ kind: "erase-spawn" }, "Remove spawnpoint", "#8f3031"),
    );
    this.updateFactionButtons();
    this.updateToolButtons();
  }

  private createGroundTextureCategoryButton(terrain: GroundTerrainType): HTMLButtonElement {
    const definition = terrainDefinition(terrain);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "map-editor-tool map-editor-terrain-category";
    button.dataset.groundTextureCategory = terrain;
    button.style.setProperty("--tool-colour", cssColour(definition.colour));
    button.setAttribute("aria-controls", "map-editor-ground-texture-menu");
    button.setAttribute("aria-expanded", "false");
    const swatch = document.createElement("i");
    swatch.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = terrain === "clear" ? "Open ground" : definition.label;
    button.append(swatch, text);
    button.addEventListener("click", () => {
      this.groundTextureCategory = this.groundTextureCategory === terrain ? null : terrain;
      this.renderGroundTextureMenu();
      this.updateToolButtons();
      this.status.textContent = this.groundTextureCategory
        ? `Choose ${terrain === "clear" ? "an open ground" : `a ${definition.label.toLowerCase()}`} type.`
        : `${terrain === "clear" ? "Open ground" : definition.label} types closed.`;
    });
    return button;
  }

  private renderGroundTextureMenu(): void {
    const menu = requiredDescendant(this.root, "#map-editor-ground-texture-menu");
    const heading = requiredDescendant(this.root, "#map-editor-ground-texture-heading");
    const palette = requiredDescendant(this.root, "#map-editor-ground-texture-tools");
    const terrain = this.groundTextureCategory;
    menu.hidden = terrain === null;
    if (!terrain) {
      palette.replaceChildren();
      return;
    }
    const categoryLabel = terrain === "clear" ? "Open ground" : terrainDefinition(terrain).label;
    heading.textContent = `${categoryLabel.toUpperCase()} TYPES`;
    palette.replaceChildren(...groundTexturesForTerrain(terrain).map((texture) => this.createToolButton(
      { kind: "ground-texture", terrain, texture: texture.id as GroundTextureId },
      texture.label,
      cssColour(texture.colour),
    )));
  }

  private selectedElevation(): number {
    const parsed = Number(this.elevationInput.value);
    const elevation = Number.isFinite(parsed)
      ? Math.max(MINIMUM_MAP_ELEVATION, Math.min(MAXIMUM_MAP_ELEVATION, Math.round(parsed)))
      : 0;
    this.elevationInput.value = String(elevation);
    return elevation;
  }

  private selectedBuildingSize(): { width: number; depth: number } {
    const dimension = (input: HTMLInputElement): number => {
      const parsed = Number(input.value);
      const value = Number.isFinite(parsed)
        ? Math.max(1, Math.min(MAXIMUM_EDITOR_BUILDING_SIZE, Math.round(parsed)))
        : 2;
      input.value = String(value);
      return value;
    };
    return { width: dimension(this.buildingWidthInput), depth: dimension(this.buildingDepthInput) };
  }

  private renderBuildingTools(): void {
    const size = this.selectedBuildingSize();
    const palette = requiredDescendant(this.root, "#map-editor-building-tools");
    palette.replaceChildren(
      this.createToolButton(
        { kind: "building", ...size },
        `Place ${size.width} × ${size.depth}`,
        "#927a5b",
      ),
      this.createToolButton({ kind: "erase-building" }, "Remove building", "#8f3031"),
    );
    this.updateToolButtons();
  }

  private renderElevationTools(): void {
    const elevation = this.selectedElevation();
    const palette = requiredDescendant(this.root, "#map-editor-elevation-tools");
    palette.replaceChildren(
      this.createToolButton(
        { kind: "elevation", elevation },
        `Paint level ${elevation >= 0 ? "+" : ""}${elevation}`,
        elevation > 0 ? "#8f9d73" : elevation < 0 ? "#405c68" : "#69705f",
      ),
      this.createToolButton({ kind: "elevation-delta", delta: 1 }, "Raise +1", "#929c72"),
      this.createToolButton({ kind: "elevation-delta", delta: -1 }, "Lower −1", "#46616d"),
    );
    this.updateToolButtons();
  }

  private populateUnitArchetypes(): void {
    const archetypes = UNIT_ARCHETYPES.filter((archetype) => archetype.faction === this.unitFaction
      && (archetype.type === "infantry" || archetype.type === "archers"
        || archetype.type === "skirmishers" || archetype.type === "cavalry"));
    const previous = this.unitArchetypeSelect.value;
    this.unitArchetypeSelect.replaceChildren(...archetypes.map((archetype) => {
      const option = document.createElement("option");
      option.value = archetype.id;
      option.textContent = archetype.name;
      return option;
    }));
    if (archetypes.some((archetype) => archetype.id === previous)) {
      this.unitArchetypeSelect.value = previous;
    }
  }

  private renderUnitTools(): void {
    const archetypeId = this.unitArchetypeSelect.value as UnitArchetypeId;
    const archetype = getUnitArchetype(archetypeId);
    const palette = requiredDescendant(this.root, "#map-editor-unit-tools");
    palette.replaceChildren(
      this.createToolButton(
        { kind: "unit", factionId: this.unitFaction, archetypeId },
        "Paint unit blocks",
        this.unitFaction === "roman" ? "#9b3438" : "#a16a35",
      ),
      this.createToolButton({ kind: "erase-unit" }, "Remove unit block", "#8f3031"),
    );
    this.unitArchetypeSelect.title = archetype.tacticalIdentity;
    this.updateToolButtons();
  }

  private updateFactionButtons(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-editor-faction]").forEach((button) => {
      const selected = button.dataset.editorFaction === this.unitFaction;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  private createToolButton(tool: MapEditorTool, label: string, colour: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "map-editor-tool";
    button.dataset.tool = toolKey(tool);
    button.style.setProperty("--tool-colour", colour);
    const swatch = document.createElement("i");
    swatch.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = label;
    button.append(swatch, text);
    button.addEventListener("click", () => {
      this.tool = tool;
      if (tool.kind !== "ground-texture") {
        this.groundTextureCategory = null;
        this.renderGroundTextureMenu();
      }
      this.updateToolButtons();
      this.updateInterface(`${toolLabel(tool)} selected.`);
    });
    return button;
  }

  private bindEvents(): void {
    requiredDescendant<HTMLFormElement>(this.root, "#map-editor-size-form").addEventListener("submit", (event) => {
      event.preventDefault();
      this.createBlankMap();
    });
    requiredDescendant<HTMLButtonElement>(this.root, "#map-editor-export").addEventListener(
      "click",
      () => this.exportMap(),
    );
    requiredDescendant<HTMLButtonElement>(this.root, "#map-editor-save-project").addEventListener(
      "click",
      (event) => void this.saveMapToProject(event.currentTarget as HTMLButtonElement),
    );
    window.addEventListener("beforeunload", (event) => {
      if (this.hasUnsavedChanges()) event.preventDefault();
    }, { signal: this.windowEvents.signal });
    this.canvas.addEventListener("pointerdown", (event) => this.handlePointerDown(event));
    this.canvas.addEventListener("pointermove", (event) => this.handlePointerMove(event));
    this.canvas.addEventListener("pointerup", (event) => this.handlePointerUp(event));
    this.canvas.addEventListener("pointercancel", (event) => this.handlePointerUp(event));
    this.canvas.addEventListener("pointerleave", () => {
      if (!this.pointerDown) {
        this.hoveredTile = null;
        this.hoveredEdge = null;
        this.render();
      }
    });
    this.canvas.addEventListener("contextmenu", (event) => this.handleContextMenu(event));
    this.undoButton.addEventListener("click", () => this.undo());
    this.redoButton.addEventListener("click", () => this.redo());
    window.addEventListener("keydown", (event) => this.handleKeyDown(event), { signal: this.windowEvents.signal });
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (this.root.hidden || !(event.ctrlKey || event.metaKey)) return;
    if ((event.target as HTMLElement).matches("input, select, textarea")) return;
    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      this.undo();
    } else if (key === "y" || (key === "z" && event.shiftKey)) {
      event.preventDefault();
      this.redo();
    }
  }

  private undo(): void {
    if (this.pointerDown) return;
    const map = this.history.undo(this.map);
    if (!map) return;
    this.map = map;
    this.updateInterface("Undid the last edit.");
  }

  private redo(): void {
    if (this.pointerDown) return;
    const map = this.history.redo(this.map);
    if (!map) return;
    this.map = map;
    this.updateInterface("Redid the edit.");
  }

  private handleContextMenu(event: MouseEvent): void {
    event.preventDefault();
    const position = this.tileAtPointer(event);
    if (!position || this.pointerDown) return;
    const edge = this.tool.kind === "edge" || this.tool.kind === "erase-edge" ? this.edgeAtPointer(event) : null;
    this.hoveredTile = position;
    const before = serializeBattlefieldMap(this.map);
    const revision = this.map.revision;
    let message: string;
    try {
      message = eraseMapEditorLayer(this.map, position, this.tool, edge);
    } catch (error) {
      message = error instanceof Error ? error.message : "That edit could not be applied.";
    }
    if (this.map.revision !== revision) this.history.record(before);
    this.updateInterface(message);
  }

  private createBlankMap(): void {
    const width = this.editorDimension(this.widthInput, "width");
    const height = this.editorDimension(this.heightInput, "height");
    if (width === null || height === null || !this.confirmDiscardChanges()) return;
    this.startNewMap(createBlankBattlefieldMap(width, height), null);
    this.updateInterface(`Created a blank ${width} × ${height} battlefield.`);
  }

  private editorDimension(input: HTMLInputElement, label: string): number | null {
    const value = Number(input.value);
    if (!Number.isInteger(value) || value < MINIMUM_EDITOR_MAP_SIZE || value > MAXIMUM_EDITOR_MAP_SIZE) {
      this.status.textContent = `${label[0]!.toUpperCase()}${label.slice(1)} must be a whole number from ${MINIMUM_EDITOR_MAP_SIZE} to ${MAXIMUM_EDITOR_MAP_SIZE}.`;
      input.focus();
      return null;
    }
    return value;
  }

  private updateToolButtons(): void {
    const selectedKey = toolKey(this.tool);
    this.root.querySelectorAll<HTMLButtonElement>(".map-editor-tool").forEach((button) => {
      const selected = button.dataset.tool === selectedKey;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-ground-texture-category]").forEach((button) => {
      const terrain = button.dataset.groundTextureCategory;
      const expanded = terrain === this.groundTextureCategory;
      const selected = this.tool.kind === "ground-texture" && this.tool.terrain === terrain;
      button.classList.toggle("expanded", expanded);
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-expanded", String(expanded));
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  private handlePointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    this.pointerDown = true;
    this.paintedCells.clear();
    this.lastPaintedTile = null;
    this.lastPaintedDirection = null;
    this.strokeStart = { document: serializeBattlefieldMap(this.map), revision: this.map.revision };
    this.canvas.setPointerCapture(event.pointerId);
    this.applyAtPointer(event);
  }

  private handlePointerMove(event: PointerEvent): void {
    const position = this.tileAtPointer(event);
    const edge = this.tool.kind === "edge" || this.tool.kind === "erase-edge"
      ? this.edgeAtPointer(event) : null;
    const changed = position?.x !== this.hoveredTile?.x || position?.y !== this.hoveredTile?.y
      || edge?.position.x !== this.hoveredEdge?.position.x || edge?.position.y !== this.hoveredEdge?.position.y
      || edge?.direction !== this.hoveredEdge?.direction;
    this.hoveredTile = position;
    this.hoveredEdge = edge;
    if (this.pointerDown && this.tool.kind !== "building") this.applyAtPointer(event);
    else if (changed) this.render();
  }

  private handlePointerUp(event: PointerEvent): void {
    this.pointerDown = false;
    this.paintedCells.clear();
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    const stroke = this.strokeStart;
    this.strokeStart = null;
    if (!stroke) return;
    if (this.map.revision !== stroke.revision) this.history.record(stroke.document);
    this.updateEditState();
  }

  private applyAtPointer(event: PointerEvent): void {
    const position = this.tileAtPointer(event);
    if (!position) {
      this.lastPaintedTile = null;
      return;
    }
    const edge = this.tool.kind === "edge" || this.tool.kind === "erase-edge"
      ? this.edgeAtPointer(event) : null;
    const direction = edge?.direction ?? null;
    // Pointer events skip tiles on a fast drag, so fill in the line since the last one.
    const start = this.lastPaintedTile && direction === this.lastPaintedDirection ? this.lastPaintedTile : position;
    let message: string | null = null;
    for (const tile of tilesAlongLine(start, position)) {
      const key = direction
        ? `edge:${edgeFeaturePhysicalKey(tile, direction)}`
        : `${tile.x},${tile.y}`;
      if (this.paintedCells.has(key)) continue;
      this.paintedCells.add(key);
      try {
        applyMapEditorTool(this.map, tile, this.tool, direction ?? undefined);
        message = `${toolLabel(this.tool)} applied at ${tile.x}, ${tile.y}${direction ? ` ${direction} edge` : ""}.`;
      } catch (error) {
        message = error instanceof Error ? error.message : "That edit could not be applied.";
      }
    }
    this.lastPaintedTile = position;
    this.lastPaintedDirection = direction;
    this.hoveredTile = position;
    this.hoveredEdge = edge;
    if (message) this.updateInterface(message);
    else this.render();
  }

  private tileAtPointer(event: MouseEvent | PointerEvent): GridPosition | null {
    const bounds = this.canvas.getBoundingClientRect();
    const x = (event.clientX - bounds.left - this.layout.originX) / this.layout.cellSize;
    const y = (event.clientY - bounds.top - this.layout.originY) / this.layout.cellSize;
    const position = { x: Math.floor(x), y: Math.floor(y) };
    return position.x >= 0 && position.y >= 0
      && position.x < this.map.width && position.y < this.map.height ? position : null;
  }

  private edgeAtPointer(event: MouseEvent | PointerEvent): { position: GridPosition; direction: Direction } | null {
    const bounds = this.canvas.getBoundingClientRect();
    const mapX = (event.clientX - bounds.left - this.layout.originX) / this.layout.cellSize;
    const mapY = (event.clientY - bounds.top - this.layout.originY) / this.layout.cellSize;
    const position = { x: Math.floor(mapX), y: Math.floor(mapY) };
    if (position.x < 0 || position.y < 0 || position.x >= this.map.width || position.y >= this.map.height) return null;
    const localX = mapX - position.x;
    const localY = mapY - position.y;
    const distances: Array<{ direction: Direction; distance: number }> = [
      { direction: "north", distance: localY },
      { direction: "east", distance: 1 - localX },
      { direction: "south", distance: 1 - localY },
      { direction: "west", distance: localX },
    ];
    distances.sort((left, right) => left.distance - right.distance);
    return { position, direction: distances[0]!.direction };
  }

  private updateInterface(message: string): void {
    this.status.textContent = message;
    this.selection.textContent = toolLabel(this.tool);
    this.sizeReadout.textContent = `${this.map.width} × ${this.map.height}`;
    this.objectReadout.textContent = String(mapEditorObjectCount(this.map));
    const elevation = mapElevationRange(this.map);
    this.elevationReadout.textContent = `${elevation.minimum} to ${elevation.maximum}`;
    this.rampReadout.textContent = String(this.map.tiles.filter((tile) => tile.ramp !== undefined).length);
    this.buildingReadout.textContent = String(this.map.buildings.length);
    this.edgeReadout.textContent = String(this.map.edgeFeatures.length);
    this.unitBlockReadout.textContent = String(this.map.deployments.reduce(
      (total, deployment) => total + deployment.positions.length,
      0,
    ));
    this.formationReadout.textContent = String(this.map.deployments.length);
    this.spawnReadout.textContent = String(this.map.spawnPoints.length);
    this.updateEditState();
    this.render();
  }

  private updateEditState(): void {
    this.saveStateReadout.textContent = this.hasUnsavedChanges() ? "Unsaved changes"
      : this.savedFileName ? "Saved"
        : this.downloaded ? "Downloaded" : "Blank map";
    this.undoButton.disabled = !this.history.canUndo;
    this.redoButton.disabled = !this.history.canRedo;
  }

  private render(): void {
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(bounds.width * ratio);
    const pixelHeight = Math.round(bounds.height * ratio);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    const context = this.context;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    context.fillStyle = "#141914";
    context.fillRect(0, 0, bounds.width, bounds.height);

    const padding = 34;
    const cellSize = Math.max(6, Math.min(
      54,
      Math.floor((bounds.width - padding * 2) / this.map.width),
      Math.floor((bounds.height - padding * 2) / this.map.height),
    ));
    const boardWidth = cellSize * this.map.width;
    const boardHeight = cellSize * this.map.height;
    this.layout = {
      cellSize,
      originX: Math.round((bounds.width - boardWidth) / 2),
      originY: Math.round((bounds.height - boardHeight) / 2),
    };

    context.save();
    context.shadowColor = "rgba(0, 0, 0, .55)";
    context.shadowBlur = 24;
    context.fillStyle = "#20271e";
    context.fillRect(this.layout.originX - 5, this.layout.originY - 5, boardWidth + 10, boardHeight + 10);
    context.restore();

    const deploymentsByPosition = new Map<string, MapFormationDeployment>();
    for (const deployment of this.map.deployments) {
      for (const position of deployment.positions) {
        deploymentsByPosition.set(`${position.x},${position.y}`, deployment);
      }
    }
    const spawnPointsByPosition = new Map(
      this.map.spawnPoints.map((spawnPoint) => [
        `${spawnPoint.position.x},${spawnPoint.position.y}`,
        spawnPoint,
      ]),
    );

    for (let y = 0; y < this.map.height; y += 1) {
      for (let x = 0; x < this.map.width; x += 1) {
        const tile = mapTileAt(this.map, { x, y });
        if (!tile) continue;
        const drawX = this.layout.originX + x * cellSize;
        const drawY = this.layout.originY + y * cellSize;
        const definition = terrainDefinition(tile.terrain);
        const textureId = tile.groundTexture ?? defaultGroundTexture(tile.terrain);
        const texture = textureId ? groundTextureDefinition(textureId) : undefined;
        context.fillStyle = cssColour(
          (texture?.alternateColour ?? definition.alternateColour) !== undefined && (x + y) % 2 === 1
            ? (texture?.alternateColour ?? definition.alternateColour)!
            : (texture?.colour ?? definition.colour),
        );
        context.fillRect(drawX, drawY, cellSize, cellSize);
        this.drawTerrainDetail(context, tile.terrain, textureId, drawX, drawY, cellSize, x + y * this.map.width);
        this.drawElevationTint(context, tile.elevation, drawX, drawY, cellSize);
        const buildingCell = this.map.buildingCells[`${x},${y}`];
        if (buildingCell) this.drawBuildingCell(context, buildingCell, drawX, drawY, cellSize);
        for (let index = 0; index < (tile.objects?.length ?? 0); index += 1) {
          this.drawObject(context, tile.objects![index]!, drawX, drawY, cellSize, index);
        }
        const spawnPoint = spawnPointsByPosition.get(`${x},${y}`);
        if (spawnPoint) this.drawSpawnPoint(context, spawnPoint, drawX, drawY, cellSize);
        const deployment = deploymentsByPosition.get(`${x},${y}`);
        if (deployment) {
          this.drawDeploymentBlock(context, deployment, { x, y }, drawX, drawY, cellSize);
        }
        if (tile.ramp) this.drawRamp(context, tile.ramp, drawX, drawY, cellSize);
        this.drawElevationBadge(context, tile.elevation, drawX, drawY, cellSize);
        if ((tile.objects?.length ?? 0) > 1 && cellSize >= 22) {
          context.fillStyle = "rgba(18, 22, 17, .84)";
          context.beginPath();
          context.arc(drawX + cellSize - 7, drawY + 7, 6, 0, Math.PI * 2);
          context.fill();
          context.fillStyle = "#f1dfaa";
          context.font = "700 8px Inter, sans-serif";
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.fillText(String(tile.objects!.length), drawX + cellSize - 7, drawY + 7.5);
        }
        context.strokeStyle = "rgba(226, 215, 184, .17)";
        context.lineWidth = 1;
        context.strokeRect(drawX + 0.5, drawY + 0.5, cellSize - 1, cellSize - 1);
      }
    }

    for (const feature of this.map.edgeFeatures) this.drawEdgeFeature(context, feature);

    if (this.hoveredEdge && (this.tool.kind === "edge" || this.tool.kind === "erase-edge")) {
      this.drawEdgeHover(context, this.hoveredEdge.position, this.hoveredEdge.direction, this.tool.kind === "erase-edge");
    } else if (this.hoveredTile && this.tool.kind === "building") {
      this.drawBuildingPlacementPreview(context, this.hoveredTile, this.tool.width, this.tool.depth);
    } else if (this.hoveredTile) {
      context.strokeStyle = "#f0cf76";
      context.lineWidth = 2;
      context.strokeRect(
        this.layout.originX + this.hoveredTile.x * cellSize + 1,
        this.layout.originY + this.hoveredTile.y * cellSize + 1,
        cellSize - 2,
        cellSize - 2,
      );
    }
    this.drawCoordinates(context, boardWidth, boardHeight);
  }

  private drawTerrainDetail(
    context: CanvasRenderingContext2D,
    terrain: GroundTerrainType,
    groundTexture: GroundTextureId | undefined,
    x: number,
    y: number,
    size: number,
    seed: number,
  ): void {
    if (size < 12) return;
    context.save();
    context.beginPath();
    context.rect(x, y, size, size);
    context.clip();
    if (groundTexture) {
      this.drawGroundTextureDetail(context, groundTexture, x, y, size, seed);
    } else if (terrain === "road") {
      context.fillStyle = "rgba(219, 197, 139, .18)";
      context.fillRect(x, y + size * .32, size, size * .36);
    } else if (terrain === "river_shallow" || terrain === "river_deep") {
      context.strokeStyle = terrain === "river_deep" ? "rgba(148, 211, 225, .38)" : "rgba(171, 225, 221, .3)";
      context.lineWidth = Math.max(1, size * .05);
      for (let offset = -size; offset < size * 2; offset += Math.max(6, size * .35)) {
        context.beginPath();
        context.moveTo(x + offset, y + size * .68);
        context.lineTo(x + offset + size * .5, y + size * .32);
        context.stroke();
      }
    } else if (terrain === "forest") {
      context.fillStyle = "rgba(13, 31, 14, .34)";
      for (let index = 0; index < 3; index += 1) {
        const px = x + size * (.22 + ((seed + index * 3) % 5) * .14);
        const py = y + size * (.25 + ((seed * 2 + index) % 4) * .17);
        context.beginPath();
        context.arc(px, py, Math.max(1.5, size * .08), 0, Math.PI * 2);
        context.fill();
      }
    } else if (terrain === "rough" || terrain === "dangerous") {
      context.strokeStyle = terrain === "dangerous" ? "rgba(176, 188, 151, .25)" : "rgba(224, 199, 136, .22)";
      context.lineWidth = 1;
      for (let index = 0; index < 3; index += 1) {
        const px = x + size * (.18 + index * .28);
        context.beginPath();
        context.moveTo(px, y + size * .72);
        context.lineTo(px + size * .1, y + size * .42);
        context.stroke();
      }
    } else if (terrain === "impassable" || terrain === "fortress_wall") {
      context.strokeStyle = terrain === "fortress_wall" ? "rgba(235, 225, 198, .32)" : "rgba(210, 213, 200, .2)";
      context.lineWidth = 1;
      const spacing = Math.max(5, size * .28);
      for (let offset = -size; offset < size * 2; offset += spacing) {
        context.beginPath();
        context.moveTo(x + offset, y + size);
        context.lineTo(x + offset + size, y);
        context.stroke();
      }
    }
    context.restore();
  }

  private drawGroundTextureDetail(
    context: CanvasRenderingContext2D,
    texture: GroundTextureId,
    x: number,
    y: number,
    size: number,
    seed: number,
  ): void {
    const detail = cssColour(groundTextureDefinition(texture).detailColour);
    context.fillStyle = detail;
    context.strokeStyle = detail;
    context.lineWidth = Math.max(1, size * .035);
    const point = (index: number) => ({
      x: x + size * (.18 + ((seed * 3 + index * 5) % 7) * .1),
      y: y + size * (.2 + ((seed + index * 3) % 6) * .12),
    });
    if (texture === "grass" || texture === "dry_grass" || texture === "upland_grass") {
      const stalks = texture === "upland_grass" ? 4 : 3;
      for (let index = 0; index < stalks; index += 1) {
        const p = point(index);
        const height = size * (texture === "dry_grass" ? .18 : .12);
        context.beginPath();
        context.moveTo(p.x, p.y + height);
        context.lineTo(p.x + (texture === "upland_grass" ? size * .12 : size * .04), p.y);
        context.stroke();
      }
      return;
    }
    if (texture === "pasture" || texture === "heather_moor" || texture === "shingle") {
      for (let index = 0; index < 5; index += 1) {
        const p = point(index);
        const radius = Math.max(1, size * (texture === "heather_moor" ? .07 : .035));
        context.beginPath();
        if (texture === "shingle") context.ellipse(p.x, p.y, radius * 1.6, radius, 0, 0, Math.PI * 2);
        else context.arc(p.x, p.y, radius, 0, Math.PI * 2);
        context.fill();
      }
      return;
    }
    if (texture === "ploughed_field" || texture === "saltmarsh") {
      for (let index = -1; index < 4; index += 1) {
        context.beginPath();
        if (texture === "ploughed_field") {
          context.moveTo(x + index * size * .28, y + size);
          context.lineTo(x + (index + 2) * size * .28, y);
        } else {
          const lineY = y + size * (.22 + index * .2);
          context.moveTo(x, lineY);
          context.quadraticCurveTo(x + size * .5, lineY + size * .12, x + size, lineY);
        }
        context.stroke();
      }
      return;
    }
    if (texture === "rough_ground" || texture === "scree") {
      for (let index = 0; index < 4; index += 1) {
        const p = point(index);
        const radius = size * (texture === "scree" ? .08 : .055);
        context.beginPath();
        context.moveTo(p.x - radius, p.y + radius);
        context.lineTo(p.x, p.y - radius);
        context.lineTo(p.x + radius, p.y + radius);
        context.closePath();
        context.fill();
      }
      return;
    }
    if (texture === "swamp") {
      context.globalAlpha = .72;
      for (let index = 0; index < 3; index += 1) {
        const p = point(index);
        context.beginPath();
        context.ellipse(p.x, p.y, size * .11, size * .045, 0, 0, Math.PI * 2);
        context.fill();
      }
      return;
    }
    if (texture === "peat_bog") {
      for (let index = 0; index < 4; index += 1) {
        const p = point(index);
        context.fillRect(p.x - size * .055, p.y - size * .035, size * .11, size * .07);
      }
      return;
    }
    for (let index = 0; index < 4; index += 1) {
      const p = point(index);
      context.beginPath();
      context.moveTo(p.x - size * .08, p.y - size * .03);
      context.lineTo(p.x, p.y + size * .04);
      context.lineTo(p.x + size * .07, p.y - size * .06);
      context.stroke();
    }
  }

  private drawElevationTint(
    context: CanvasRenderingContext2D,
    elevation: number,
    x: number,
    y: number,
    size: number,
  ): void {
    if (elevation === 0) return;
    context.save();
    const alpha = Math.min(.38, .055 * Math.abs(elevation));
    context.fillStyle = elevation > 0 ? `rgba(231, 218, 174, ${alpha})` : `rgba(19, 43, 55, ${alpha})`;
    context.fillRect(x, y, size, size);
    context.restore();
  }

  private drawBuildingCell(
    context: CanvasRenderingContext2D,
    cell: BuildingCell,
    x: number,
    y: number,
    size: number,
  ): void {
    context.save();
    context.fillStyle = "#927a5b";
    context.fillRect(x + 1, y + 1, size - 2, size - 2);
    context.strokeStyle = "rgba(74, 55, 40, .48)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x + size * .18, y + size * .76);
    context.lineTo(x + size * .82, y + size * .24);
    context.moveTo(x + size * .32, y + size * .88);
    context.lineTo(x + size * .92, y + size * .39);
    context.stroke();
    context.strokeStyle = "#d0b382";
    context.lineWidth = Math.max(2, size * .08);
    for (const wall of cell.walls) {
      context.beginPath();
      if (wall === "north") {
        context.moveTo(x, y); context.lineTo(x + size, y);
      } else if (wall === "east") {
        context.moveTo(x + size, y); context.lineTo(x + size, y + size);
      } else if (wall === "south") {
        context.moveTo(x + size, y + size); context.lineTo(x, y + size);
      } else {
        context.moveTo(x, y + size); context.lineTo(x, y);
      }
      context.stroke();
    }
    context.restore();
  }

  private buildingPlacementIsValid(origin: GridPosition, width: number, depth: number): boolean {
    if (width * depth < 4) return false;
    let surfaceElevation: number | undefined;
    for (let row = 0; row < depth; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const position = { x: origin.x + column, y: origin.y + row };
        const tile = mapTileAt(this.map, position);
        if (!tile || tile.ramp || tile.terrain === "fortress_wall" || (tile.objects?.length ?? 0) > 0) return false;
        const key = `${position.x},${position.y}`;
        if (this.map.buildingCells[key]
          || this.map.spawnPoints.some((spawn) => spawn.position.x === position.x && spawn.position.y === position.y)
          || this.map.deployments.some((deployment) => deployment.positions.some(
            (block) => block.x === position.x && block.y === position.y,
          ))) return false;
        const elevation = mapTileSurfaceElevation(tile);
        surfaceElevation ??= elevation;
        if (elevation !== surfaceElevation) return false;
      }
    }
    return true;
  }

  private drawBuildingPlacementPreview(
    context: CanvasRenderingContext2D,
    origin: GridPosition,
    width: number,
    depth: number,
  ): void {
    const valid = this.buildingPlacementIsValid(origin, width, depth);
    context.save();
    context.fillStyle = valid ? "rgba(114, 156, 102, .3)" : "rgba(176, 66, 67, .3)";
    context.strokeStyle = valid ? "#a5d18d" : "#e47b7d";
    context.lineWidth = 2;
    context.setLineDash([5, 3]);
    const x = this.layout.originX + origin.x * this.layout.cellSize;
    const y = this.layout.originY + origin.y * this.layout.cellSize;
    context.fillRect(x, y, width * this.layout.cellSize, depth * this.layout.cellSize);
    context.strokeRect(x + 1, y + 1, width * this.layout.cellSize - 2, depth * this.layout.cellSize - 2);
    context.restore();
  }

  private edgeLine(position: GridPosition, direction: Direction): [GridPosition, GridPosition] {
    const x = this.layout.originX + position.x * this.layout.cellSize;
    const y = this.layout.originY + position.y * this.layout.cellSize;
    const size = this.layout.cellSize;
    if (direction === "north") return [{ x, y }, { x: x + size, y }];
    if (direction === "east") return [{ x: x + size, y }, { x: x + size, y: y + size }];
    if (direction === "south") return [{ x: x + size, y: y + size }, { x, y: y + size }];
    return [{ x, y: y + size }, { x, y }];
  }

  private drawEdgeFeature(context: CanvasRenderingContext2D, feature: EdgeFeaturePlacement): void {
    const definition = edgeFeatureDefinition(feature.type);
    const [start, end] = this.edgeLine(feature.position, feature.direction);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const normalX = -dy / length;
    const normalY = dx / length;
    context.save();
    context.lineCap = "square";

    if (definition.appearance === "hedge") {
      context.strokeStyle = cssColour(definition.wallColour);
      context.lineWidth = definition.height === "tall" ? Math.max(8, this.layout.cellSize * .22)
        : Math.max(5, this.layout.cellSize * .14);
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
      context.fillStyle = cssColour(definition.topColour);
      const leafRadius = definition.height === "tall" ? Math.max(2.5, this.layout.cellSize * .085)
        : Math.max(2, this.layout.cellSize * .065);
      for (let index = 0; index <= 8; index += 1) {
        const ratio = index / 8;
        const offset = (index % 2 === 0 ? -1 : 1) * leafRadius * .45;
        context.beginPath();
        context.arc(
          start.x + dx * ratio + normalX * offset,
          start.y + dy * ratio + normalY * offset,
          leafRadius,
          0,
          Math.PI * 2,
        );
        context.fill();
      }
      context.restore();
      return;
    }

    context.strokeStyle = cssColour(definition.wallColour);
    context.lineWidth = definition.height === "tall" ? Math.max(5, this.layout.cellSize * .17)
      : Math.max(3, this.layout.cellSize * .1);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    context.strokeStyle = cssColour(definition.roofColour ?? definition.topColour);
    context.lineWidth = definition.enclosure === "enclosed" ? Math.max(3, this.layout.cellSize * .09) : 2;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();

    if (definition.appearance === "stone_wall" || definition.appearance === "door") {
      const divisions = definition.appearance === "door" ? [0.25, 0.5, 0.75] : [0.2, 0.4, 0.6, 0.8];
      context.strokeStyle = definition.appearance === "door" ? "rgba(58, 35, 20, .82)" : "rgba(54, 55, 51, .68)";
      context.lineWidth = Math.max(1, this.layout.cellSize * .035);
      for (const ratio of divisions) {
        const px = start.x + dx * ratio;
        const py = start.y + dy * ratio;
        const half = definition.appearance === "door" ? Math.max(3, this.layout.cellSize * .09)
          : Math.max(2, this.layout.cellSize * .055);
        context.beginPath();
        context.moveTo(px - normalX * half, py - normalY * half);
        context.lineTo(px + normalX * half, py + normalY * half);
        context.stroke();
      }
    }

    if (definition.appearance === "door") {
      const handleRatio = .68;
      context.fillStyle = "#e0bd72";
      context.beginPath();
      context.arc(
        start.x + dx * handleRatio + normalX * Math.max(2, this.layout.cellSize * .055),
        start.y + dy * handleRatio + normalY * Math.max(2, this.layout.cellSize * .055),
        Math.max(1.5, this.layout.cellSize * .035),
        0,
        Math.PI * 2,
      );
      context.fill();
    }

    if (definition.enclosure === "open") {
      context.fillStyle = cssColour(definition.topColour);
      for (const ratio of [0, .5, 1]) {
        const px = start.x + (end.x - start.x) * ratio;
        const py = start.y + (end.y - start.y) * ratio;
        context.beginPath();
        context.arc(px, py, Math.max(2, this.layout.cellSize * .06), 0, Math.PI * 2);
        context.fill();
      }
    }
    context.restore();
  }

  private drawEdgeHover(
    context: CanvasRenderingContext2D,
    position: GridPosition,
    direction: Direction,
    removing: boolean,
  ): void {
    const [start, end] = this.edgeLine(position, direction);
    context.save();
    context.strokeStyle = removing ? "#ef7779" : "#f0cf76";
    context.lineWidth = Math.max(4, this.layout.cellSize * .13);
    context.setLineDash([6, 3]);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    context.restore();
  }

  private drawRamp(
    context: CanvasRenderingContext2D,
    direction: Direction,
    x: number,
    y: number,
    size: number,
  ): void {
    if (size < 14) return;
    const vectors: Record<Direction, GridPosition> = {
      north: { x: 0, y: -1 }, east: { x: 1, y: 0 },
      south: { x: 0, y: 1 }, west: { x: -1, y: 0 },
    };
    const vector = vectors[direction];
    const centreX = x + size * .5;
    const centreY = y + size * .5;
    const endX = centreX + vector.x * size * .3;
    const endY = centreY + vector.y * size * .3;
    const angle = Math.atan2(vector.y, vector.x);
    const arrowSize = Math.max(3, size * .12);
    context.save();
    context.strokeStyle = "#f0cf76";
    context.fillStyle = "#f0cf76";
    context.lineWidth = Math.max(1.5, size * .055);
    context.beginPath();
    context.moveTo(centreX - vector.x * size * .2, centreY - vector.y * size * .2);
    context.lineTo(endX, endY);
    context.stroke();
    context.beginPath();
    context.moveTo(endX, endY);
    context.lineTo(endX - Math.cos(angle - .62) * arrowSize, endY - Math.sin(angle - .62) * arrowSize);
    context.lineTo(endX - Math.cos(angle + .62) * arrowSize, endY - Math.sin(angle + .62) * arrowSize);
    context.closePath();
    context.fill();
    context.restore();
  }

  private drawElevationBadge(
    context: CanvasRenderingContext2D,
    elevation: number,
    x: number,
    y: number,
    size: number,
  ): void {
    if (size < 18) return;
    const label = `${elevation >= 0 ? "+" : ""}${elevation}`;
    context.save();
    context.font = `700 ${Math.max(7, Math.floor(size * .18))}px ui-monospace, monospace`;
    const width = context.measureText(label).width + 5;
    context.fillStyle = elevation === 0 ? "rgba(17, 22, 17, .5)" : "rgba(17, 22, 17, .82)";
    context.fillRect(x + 2, y + 2, width, Math.max(10, size * .24));
    context.fillStyle = elevation > 0 ? "#f0dca1" : elevation < 0 ? "#a9d1dc" : "#98a08f";
    context.textAlign = "left";
    context.textBaseline = "top";
    context.fillText(label, x + 4, y + 3);
    context.restore();
  }

  private drawObject(
    context: CanvasRenderingContext2D,
    object: TerrainObjectType,
    x: number,
    y: number,
    size: number,
    stackIndex: number,
  ): void {
    const offsetX = (stackIndex % 3 - 1) * size * .13;
    const offsetY = (Math.floor(stackIndex / 3) - .3) * size * .11;
    const centreX = x + size * .5 + offsetX;
    const centreY = y + size * .53 + offsetY;
    const scale = object.endsWith("large") || object === "pond" ? .34 : .23;
    const radius = Math.max(2.5, size * scale);
    context.save();
    if (object.startsWith("tree")) {
      context.fillStyle = "#5b4430";
      context.fillRect(centreX - Math.max(1, size * .035), centreY, Math.max(2, size * .07), radius * .65);
      context.fillStyle = object === "tree_large" ? "#17331e" : "#28502c";
      context.beginPath();
      context.arc(centreX, centreY - radius * .18, radius, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "rgba(184, 207, 154, .45)";
      context.lineWidth = 1;
      context.stroke();
    } else if (object.startsWith("rock")) {
      context.fillStyle = object === "rock_large" ? "#646860" : "#777b70";
      context.beginPath();
      context.moveTo(centreX - radius, centreY + radius * .55);
      context.lineTo(centreX - radius * .55, centreY - radius * .62);
      context.lineTo(centreX + radius * .35, centreY - radius);
      context.lineTo(centreX + radius, centreY + radius * .42);
      context.closePath();
      context.fill();
      context.strokeStyle = "rgba(225, 223, 207, .5)";
      context.stroke();
    } else {
      context.fillStyle = "#2c6268";
      context.beginPath();
      context.ellipse(centreX, centreY, radius * 1.25, radius * .7, -.12, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#72aaa8";
      context.stroke();
    }
    context.restore();
  }

  private drawSpawnPoint(
    context: CanvasRenderingContext2D,
    spawnPoint: MapSpawnPoint,
    x: number,
    y: number,
    size: number,
  ): void {
    const colour = spawnPoint.factionId === "roman" ? "#e35a60" : "#e0a052";
    context.save();
    context.strokeStyle = colour;
    context.fillStyle = spawnPoint.factionId === "roman" ? "rgba(155, 52, 56, .22)" : "rgba(161, 106, 53, .22)";
    context.lineWidth = Math.max(1, size * .07);
    context.setLineDash([Math.max(2, size * .14), Math.max(2, size * .09)]);
    context.beginPath();
    context.arc(x + size / 2, y + size / 2, size * .36, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.setLineDash([]);
    context.beginPath();
    context.moveTo(x + size * .5, y + size * .28);
    context.lineTo(x + size * .5, y + size * .72);
    context.moveTo(x + size * .28, y + size * .5);
    context.lineTo(x + size * .72, y + size * .5);
    context.stroke();
    context.restore();
  }

  private drawDeploymentBlock(
    context: CanvasRenderingContext2D,
    deployment: MapFormationDeployment,
    position: GridPosition,
    x: number,
    y: number,
    size: number,
  ): void {
    const colour = deployment.factionId === "roman" ? "#a83b40" : "#aa6b34";
    const connected = (dx: number, dy: number) => deployment.positions.some(
      (candidate) => candidate.x === position.x + dx && candidate.y === position.y + dy,
    );
    context.save();
    context.fillStyle = colour;
    if (connected(1, 0)) context.fillRect(x + size * .5, y + size * .28, size, size * .44);
    if (connected(0, 1)) context.fillRect(x + size * .28, y + size * .5, size * .44, size);
    const inset = Math.max(2, size * .12);
    context.fillStyle = colour;
    context.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
    context.strokeStyle = deployment.factionId === "roman" ? "#f2a4a7" : "#f0bc78";
    context.lineWidth = Math.max(1, size * .045);
    context.strokeRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
    if (size >= 20) {
      context.fillStyle = "#fff1ce";
      context.font = `700 ${Math.max(8, Math.floor(size * .27))}px Georgia, serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(deployment.factionId === "roman" ? "R" : "S", x + size / 2, y + size / 2 + 1);
    }
    context.restore();
  }

  private drawCoordinates(context: CanvasRenderingContext2D, boardWidth: number, boardHeight: number): void {
    if (this.layout.cellSize < 15) return;
    context.fillStyle = "#7f8579";
    context.font = "8px ui-monospace, monospace";
    context.textAlign = "center";
    context.textBaseline = "bottom";
    for (let x = 0; x < this.map.width; x += 1) {
      if (x !== 0 && x !== this.map.width - 1 && x % 5 !== 0) continue;
      context.fillText(String(x), this.layout.originX + (x + .5) * this.layout.cellSize, this.layout.originY - 7);
    }
    context.textAlign = "right";
    context.textBaseline = "middle";
    for (let y = 0; y < this.map.height; y += 1) {
      if (y !== 0 && y !== this.map.height - 1 && y % 5 !== 0) continue;
      context.fillText(String(y), this.layout.originX - 7, this.layout.originY + (y + .5) * this.layout.cellSize);
    }
    context.strokeStyle = "rgba(221, 197, 137, .55)";
    context.lineWidth = 1;
    context.strokeRect(this.layout.originX - .5, this.layout.originY - .5, boardWidth + 1, boardHeight + 1);
  }

  private exportMap(): void {
    const json = JSON.stringify(serializeBattlefieldMap(this.map), null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = projectMapFileName(this.mapNameInput.value);
    anchor.click();
    URL.revokeObjectURL(url);
    this.savedDocument = this.currentDocument();
    this.downloaded = true;
    this.updateInterface(`Exported ${anchor.download}.`);
  }

  private async saveMapToProject(button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    this.updateInterface("Saving map to the project…");
    // Edits made while the request is in flight must still count as unsaved.
    const map = this.map;
    const savedDocument = this.currentDocument();
    const generation = this.mapGeneration;
    const name = this.mapNameInput.value;
    try {
      // Saving over the file this map came from is routine; any other existing file needs a yes.
      const saved = await this.writeMap(name, map);
      if (!saved) {
        this.updateInterface("Not saved. Choose a different map name, or save again to replace it.");
        return;
      }
      if (this.mapGeneration === generation) {
        this.savedDocument = savedDocument;
        this.savedFileName = saved.fileName;
        this.mapNameInput.value = saved.fileName.slice(0, -".json".length);
      }
      this.updateInterface(`Saved to ${saved.path}.`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The map could not be saved.";
      this.updateInterface(`${detail} Use Download map JSON when running a static build.`);
    } finally {
      button.disabled = false;
    }
  }

  private async writeMap(name: string, map: BattlefieldMap): Promise<Awaited<ReturnType<typeof saveProjectMap>> | null> {
    const isOwnFile = projectMapFileName(name) === this.savedFileName;
    try {
      return await saveProjectMap(name, map, isOwnFile);
    } catch (error) {
      if (!(error instanceof ProjectMapConflictError)) throw error;
      if (!window.confirm(`${error.message} Replace it with this map?`)) return null;
      return saveProjectMap(name, map, true);
    }
  }
}
