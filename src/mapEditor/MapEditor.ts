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
  type EdgeFeatureType,
  type GroundTerrainType,
  type GroundTextureId,
  type MapFormationDeployment,
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
import type { Direction, FactionId, GridPosition } from "../gridBattle/model/types";
import {
  UNIT_ARCHETYPES,
  getUnitArchetype,
  type UnitArchetypeId,
} from "../units/UnitArchetypes";
import { MapEditHistory } from "./MapEditHistory";
import { drawTerrainDetail, drawElevationTint, drawBuildingCell, drawBuildingPlacementPreview, drawEdgeFeature, drawEdgeHover, drawRamp, drawElevationBadge, drawObject, drawSpawnPoint, drawDeploymentBlock, drawCoordinates, type CanvasLayout } from "./mapEditorArt";
import { ProjectMapConflictError, projectMapFileName, saveProjectMap } from "./MapStorage";
import { cssColour } from "../ui/dom";

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

function requiredDescendant<T extends HTMLElement>(root: HTMLElement, selector: string): T {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`Missing map editor element ${selector}`);
  return element as T;
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
        drawTerrainDetail(context, tile.terrain, textureId, drawX, drawY, cellSize, x + y * this.map.width);
        drawElevationTint(context, tile.elevation, drawX, drawY, cellSize);
        const buildingCell = this.map.buildingCells[`${x},${y}`];
        if (buildingCell) drawBuildingCell(context, buildingCell, drawX, drawY, cellSize);
        for (let index = 0; index < (tile.objects?.length ?? 0); index += 1) {
          drawObject(context, tile.objects![index]!, drawX, drawY, cellSize, index);
        }
        const spawnPoint = spawnPointsByPosition.get(`${x},${y}`);
        if (spawnPoint) drawSpawnPoint(context, spawnPoint, drawX, drawY, cellSize);
        const deployment = deploymentsByPosition.get(`${x},${y}`);
        if (deployment) {
          drawDeploymentBlock(context, deployment, { x, y }, drawX, drawY, cellSize);
        }
        if (tile.ramp) drawRamp(context, tile.ramp, drawX, drawY, cellSize);
        drawElevationBadge(context, tile.elevation, drawX, drawY, cellSize);
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

    for (const feature of this.map.edgeFeatures) drawEdgeFeature(this.layout, context, feature);

    if (this.hoveredEdge && (this.tool.kind === "edge" || this.tool.kind === "erase-edge")) {
      drawEdgeHover(this.layout, context, this.hoveredEdge.position, this.hoveredEdge.direction, this.tool.kind === "erase-edge");
    } else if (this.hoveredTile && this.tool.kind === "building") {
      drawBuildingPlacementPreview(this.layout, this.buildingPlacementIsValid(this.hoveredTile, this.tool.width, this.tool.depth), context, this.hoveredTile, this.tool.width, this.tool.depth);
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
    drawCoordinates(this.layout, this.map, context, boardWidth, boardHeight);
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
