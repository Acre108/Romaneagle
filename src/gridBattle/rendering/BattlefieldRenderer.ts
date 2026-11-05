import { AccessibilitySystem, Application, Assets, Container, Graphics, Matrix, Point, Sprite, Text, type Texture } from "pixi.js";
import romanCenturySoldierUrl from "../../../Art/Roman/Roman Century Soldier.png";
import basicSaxonInfantryUrl from "../../../Art/Saxon/Basic Saxon Infantry.png";
import detailedSaxonInfantryUrl from "../../../Art/Saxon/Detailed Saxon Infantry.png";
import { BALANCE } from "../model/config";
import {
  edgeFeatureAt,
  edgeFeaturePhysicalKey,
  mapChangesSince,
  mapElevationRange,
  type BattlefieldMap,
  type EdgeFeaturePlacement,
} from "../model/battlefieldMap";
import { blocksAt, occupancyAt, positionKey, blockFormation } from "../model/occupancy";
import {
  buildingCellAt,
  groundTextureAt,
  rampDirectionAt,
  terrainAt,
  terrainElevationAt,
  terrainDescription as terrainTypeDescription,
  terrainObjectSlotPlacements,
  terrainObjectsAt,
  terrainSlotMaskAt,
} from "../model/terrain";
import { groundTextureDefinition, terrainDefinition } from "../model/terrainDefinitions";
import type { BuildingCell, Direction, GameEvent, GameState, GridPosition, OrderConfirmationPreview, TerrainType, TroopBlock } from "../model/types";
import {
  blockSlotIndices,
  deriveBlockSlotOccupancy,
  deriveContestedCellSlotOccupancies,
  type BlockSlotMask,
  type ContestedBlockSlotOccupancy,
} from "../model/blockSlots";
import { addPosition, directionVector, oppositeDirection } from "../rules/direction";
import { blockIsWavering, formationIsEngaged } from "../rules/engagement";
import { canSelectFormation } from "../rules/turnSystem";
import { blockFacing } from "../rules/blockFacing";
import { rememberFormationNames, withFormationNames } from "../rules/displayNames";
import { formationPlates } from "../rules/formationPlates";
import { isCavalry } from "../model/unitStats";
import { edgeFeatureDefinition } from "../model/edgeFeatureDefinitions";
import { drawActionPreviews } from "./actionPreviews";
import { AnimationQueue, type AnimationSpeed } from "./AnimationQueue";
import { drawFallenBody, drawSkullIcon } from "./casualtyArt";
import { debugReadoutText, drawAxes, drawDebugCandidates, drawDebugLabels } from "./debugOverlay";
import { drawMinimap } from "./minimap";
import { OrderPreviewOverlay, type BoardView } from "./orderPreviewOverlay";
import { drawEdgeFeatureShape, drawGroundTextureDetails, drawTerrainObject, interpolatePoint } from "./terrainArt";
import {
  BLOCK_SLOT_POINTS,
  soldierArtKind,
  type SoldierArtKind,
} from "./soldierMarkLayout";
import { updateCasualtyMarkers, type CasualtyTileMarker } from "./casualtyMarkers";
import { IsoCamera, type IsoWorldBounds } from "./isometric/IsoCamera";
import {
  BLOCK_PLATFORM_HEIGHT,
  DIAMOND_POINTS,
  ELEVATION_STEP_HEIGHT,
  ISO_METRICS,
  ISO_VIEW_HEIGHT,
  ISO_VIEW_WIDTH,
} from "./isometric/IsoConfig";
import { calculateIsoBoundaryDepth, calculateIsoDepth, ISO_DEPTH_PRIORITY } from "./isometric/IsoDepth";
import { isoPickCandidates, pickElevatedIsoTile } from "./isometric/IsoPicking";
import { surfaceRampDirectionAt } from "./isometric/IsoTerrainSurface";
import {
  directionToDiamondEdge,
  fractionalGridToIso,
  gridToIso,
  gridSurfaceToIso,
  interpolateGridPosition,
  isoSurfaceCorners,
  isoToFractionalGrid,
  rampSurfaceGradient,
  surfaceLocalToIso,
  type DiamondEdge,
  type ScreenPosition,
} from "./isometric/IsoProjection";
import { cssColour } from "../../ui/dom";

interface RendererCallbacks {
  onCellTap(position: GridPosition): void;
  onCellHover(position: GridPosition | null): void;
}

interface VisualAnchor {
  display: Container;
  offsetX: number;
  offsetY: number;
  priority: number;
}

interface BlockMotion {
  blockId: string;
  start: GridPosition;
  end: GridPosition;
  elapsedMs: number;
  delayMs: number;
  durationMs: number;
  visuals: VisualAnchor[];
  destroyOnComplete?: boolean;
}

const FORMATION_COLOURS: Record<string, number> = {
  "legio-i": 0x9e2730,
  lanciarii: 0x6f1724,
  exploratores: 0xc45b55,
  "great-warband": 0x7d4b2c,
  "loose-warband": 0x4f3226,
  "saxon-cavalry": 0x8a5d2d,
};

const BRACED_BORDER_COLOUR = 0x3b82f6;

const INSPECTED_OUTLINE_COLOUR = 0x63d4ff;

const PLATE_COLOURS = { steady: 0xa8dcae, shaken: 0xe8c56a, breaking: 0xf08a7a } as const;

const MORALE_COLOURS = {
  steady: 0x4f8b57,
  shaken: 0xb08a3b,
  wavering: 0xa9433c,
} as const;

const PLATFORM_TOP: number[] = [0, -30, 43, -8, 0, 14, -43, -8];
const PLATFORM_LEFT_FACE: number[] = [-43, -8, 0, 14, 0, 22, -43, 0];
const PLATFORM_RIGHT_FACE: number[] = [43, -8, 0, 14, 0, 22, 43, 0];
const CASUALTY_BODY_OFFSETS: readonly ScreenPosition[] = [
  { x: -18, y: -6 }, { x: -6, y: 1 }, { x: 8, y: -5 },
  { x: 19, y: 3 }, { x: -14, y: 7 }, { x: 0, y: 8 },
  { x: 14, y: 8 }, { x: -1, y: -9 }, { x: 18, y: -7 },
];
const CASUALTY_BODY_ANGLES: readonly number[] = [0.2, -0.45, 0.55, -0.1, 0.75, -0.7, 0.35, -0.25, 0.6];

function baseFormationId(id: string | null): string {
  return id?.split("-fragment-")[0] ?? "";
}

function formationColour(block: TroopBlock): number {
  return FORMATION_COLOURS[baseFormationId(block.formationId)] ?? (block.factionId === "roman" ? 0x9e2730 : 0x725035);
}

function moraleColour(state: GameState, block: TroopBlock): number {
  const formation = blockFormation(state, block);
  if (!formation || blockIsWavering(state, block.id) || formation.cohesion <= 3) return MORALE_COLOURS.wavering;
  return formation.cohesion / formation.maxCohesion >= 0.7 ? MORALE_COLOURS.steady : MORALE_COLOURS.shaken;
}

function samePosition(a: GridPosition | null, b: GridPosition | null): boolean {
  return a?.x === b?.x && a?.y === b?.y;
}

function diamondAt(centre: ScreenPosition, scale = 1): number[] {
  return [
    centre.x, centre.y - ISO_METRICS.tileHeight * 0.5 * scale,
    centre.x + ISO_METRICS.tileWidth * 0.5 * scale, centre.y,
    centre.x, centre.y + ISO_METRICS.tileHeight * 0.5 * scale,
    centre.x - ISO_METRICS.tileWidth * 0.5 * scale, centre.y,
  ];
}

function boardBounds(
  columns: number,
  rows: number,
  elevationRange: Readonly<{ minimum: number; maximum: number }> = { minimum: 0, maximum: 0 },
): IsoWorldBounds {
  const centres = [
    gridToIso({ x: 0, y: 0 }, ISO_METRICS),
    gridToIso({ x: columns - 1, y: 0 }, ISO_METRICS),
    gridToIso({ x: columns - 1, y: rows - 1 }, ISO_METRICS),
    gridToIso({ x: 0, y: rows - 1 }, ISO_METRICS),
  ];
  return {
    minX: Math.min(...centres.map((point) => point.x)) - ISO_METRICS.tileWidth / 2 - 40,
    minY: Math.min(...centres.map((point) => point.y)) - elevationRange.maximum * ELEVATION_STEP_HEIGHT - 80,
    maxX: Math.max(...centres.map((point) => point.x)) + ISO_METRICS.tileWidth / 2 + 40,
    maxY: Math.max(...centres.map((point) => point.y))
      - elevationRange.minimum * ELEVATION_STEP_HEIGHT + ISO_METRICS.tileHeight / 2 + 48,
  };
}

function edgePoints(edge: DiamondEdge, verticalOffset = 0): readonly [number, number, number, number] {
  const top: readonly [number, number] = [0, -30 + verticalOffset];
  const right: readonly [number, number] = [43, -8 + verticalOffset];
  const bottom: readonly [number, number] = [0, 14 + verticalOffset];
  const left: readonly [number, number] = [-43, -8 + verticalOffset];
  switch (edge) {
    case "upperLeft": return [left[0], left[1], top[0], top[1]];
    case "upperRight": return [top[0], top[1], right[0], right[1]];
    case "lowerRight": return [right[0], right[1], bottom[0], bottom[1]];
    case "lowerLeft": return [bottom[0], bottom[1], left[0], left[1]];
  }
}

function projectedDirection(direction: Direction, length = 1): ScreenPosition {
  const vector = directionVector(direction);
  return fractionalGridToIso({ x: vector.x * length, y: vector.y * length }, ISO_METRICS);
}

function terrainEdgePoints(corners: readonly ScreenPosition[], direction: Direction): readonly [ScreenPosition, ScreenPosition] {
  const [top, right, bottom, left] = corners as readonly [ScreenPosition, ScreenPosition, ScreenPosition, ScreenPosition];
  switch (direction) {
    case "north": return [top, right];
    case "east": return [right, bottom];
    case "south": return [bottom, left];
    case "west": return [left, top];
  }
}

export class BattlefieldRenderer {
  readonly app = new Application();
  private readonly worldContainer = new Container({ label: "isoWorld" });
  private readonly terrainLayer = new Container({ label: "terrainLayer", sortableChildren: true });
  private readonly gridOverlayLayer = new Container({ label: "gridOverlayLayer" });
  private readonly movementPreviewLayer = new Container({ label: "movementPreviewLayer" });
  private readonly motionTrailLayer = new Container({ label: "motionTrailLayer" });
  private readonly blockShadowLayer = new Container({ label: "blockShadowLayer", sortableChildren: true });
  private readonly blockLayer = new Container({ label: "blockLayer", sortableChildren: true });
  private readonly casualtyBodyLayer = new Container({ label: "casualtyBodyLayer", sortableChildren: true });
  private readonly characterLayer = new Container({ label: "characterLayer", sortableChildren: true });
  private readonly casualtySkullLayer = new Container({ label: "casualtySkullLayer", sortableChildren: true });
  private readonly orderPreviewLayer = new Container({ label: "orderPreviewLayer" });
  private readonly formationIndicatorLayer = new Container({ label: "formationIndicatorLayer", sortableChildren: true });
  private readonly activationPulseLayer = new Container({ label: "activationPulseLayer", sortableChildren: true });
  private readonly effectsLayer = new Container({ label: "effectsLayer", sortableChildren: true });
  private readonly floatingTextLayer = new Container({ label: "floatingTextLayer", sortableChildren: true });
  private readonly debugLayer = new Container({ label: "debugLayer" });
  private readonly pixiUiLayer = new Container({ label: "pixiUiLayer" });
  private readonly inputEvents = new AbortController();
  private readonly camera = new IsoCamera(
    { width: ISO_VIEW_WIDTH, height: ISO_VIEW_HEIGHT },
    boardBounds(1, 1),
  );
  private animationQueue: AnimationQueue | null = null;
  private animationSpeed: AnimationSpeed = 1;
  private pendingEvents: readonly GameEvent[] = [];
  private readonly boardView: BoardView = {
    projectTile: (position) => this.projectTile(position),
    surfaceDiamond: (position, scale) => this.surfaceDiamond(position, scale),
    hoveredCell: () => this.hoveredCell,
    describe: (text) => withFormationNames(text, this.formationNames),
  };
  private readonly formationNames = new Map<string, string>();
  private readonly orderPreviewOverlay = new OrderPreviewOverlay(this.orderPreviewLayer, this.boardView);
  private readonly previousBlockPositions = new Map<string, GridPosition>();
  private readonly previousCharacterPositions = new Map<string, GridPosition>();
  private readonly blockVisuals = new Map<string, VisualAnchor[]>();
  private readonly characterVisuals = new Map<string, VisualAnchor[]>();
  private readonly casualtyBodyTiles = new Map<string, CasualtyTileMarker>();
  private readonly casualtyTurnSkulls = new Map<string, CasualtyTileMarker>();
  private readonly motions: BlockMotion[] = [];
  private state: GameState | null = null;
  private terrainMap: BattlefieldMap | null = null;
  private terrainRevision = -1;
  private readonly terrainTiles = new Map<string, Graphics>();
  private readonly terrainOccluders = new Map<string, Graphics>();
  private debugVisible = false;
  private moraleVisible = false;
  private inspectedFormationId: string | null = null;
  private activationPulseElapsedMs = 0;
  private axesVisible = false;
  private hoveredCell: GridPosition | null = null;
  private hoveredCandidates: GridPosition[] = [];
  private lastLocalPointer: ScreenPosition | null = null;
  private pointerId: number | null = null;
  private pointerStart: ScreenPosition | null = null;
  private lastPointer: ScreenPosition | null = null;
  private isPanning = false;
  private spaceHeld = false;
  private spaceTapPending = false;
  private spaceDragged = false;
  private minimap: HTMLCanvasElement | null = null;
  private romanCenturySoldierTexture: Texture | null = null;
  private basicSaxonInfantryTexture: Texture | null = null;
  private detailedSaxonInfantryTexture: Texture | null = null;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly callbacks: RendererCallbacks) {}

  private async loadSoldierTexture(
    alias: string,
    src: string,
    label: string,
    scaleMode: "nearest" | "linear" = "nearest",
  ): Promise<Texture | null> {
    try {
      return await Assets.load<Texture>({
        alias,
        src,
        parser: "texture",
        data: { scaleMode },
      });
    } catch (error) {
      console.warn(`${label} art could not be loaded; using vector soldier marks.`, error);
      return null;
    }
  }

  private textureForSoldierArt(kind: SoldierArtKind | null): Texture | null {
    switch (kind) {
      case "roman-century": return this.romanCenturySoldierTexture;
      case "saxon-basic": return this.basicSaxonInfantryTexture;
      case "saxon-detailed": return this.detailedSaxonInfantryTexture;
      default: return null;
    }
  }

  async init(): Promise<void> {
    AccessibilitySystem.defaultOptions.enabledByDefault = true;
    AccessibilitySystem.defaultOptions.deactivateOnMouseMove = false;
    await this.app.init({
      canvas: this.canvas,
      width: ISO_VIEW_WIDTH,
      height: ISO_VIEW_HEIGHT,
      background: 0x171a16,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      eventFeatures: { move: false, globalMove: false, click: true, wheel: false },
    });
    [
      this.romanCenturySoldierTexture,
      this.basicSaxonInfantryTexture,
      this.detailedSaxonInfantryTexture,
    ] = await Promise.all([
      this.loadSoldierTexture("roman-century-soldier", romanCenturySoldierUrl, "Roman century soldier"),
      this.loadSoldierTexture("basic-saxon-infantry", basicSaxonInfantryUrl, "Basic Saxon infantry"),
      this.loadSoldierTexture(
        "detailed-saxon-infantry",
        detailedSaxonInfantryUrl,
        "Detailed Saxon infantry",
        "linear",
      ),
    ]);
    this.app.stage.addChild(this.worldContainer, this.pixiUiLayer);
    this.worldContainer.addChild(
      this.terrainLayer,
      this.casualtyBodyLayer,
      this.gridOverlayLayer,
      this.movementPreviewLayer,
      this.motionTrailLayer,
      this.blockShadowLayer,
      this.blockLayer,
      this.characterLayer,
      this.casualtySkullLayer,
      this.orderPreviewLayer,
      this.formationIndicatorLayer,
      this.activationPulseLayer,
      this.effectsLayer,
      this.floatingTextLayer,
      this.debugLayer,
    );
    for (const layer of this.worldContainer.children) layer.eventMode = "none";
    this.worldContainer.eventMode = "passive";
    this.orderPreviewLayer.eventMode = "passive";
    this.pixiUiLayer.eventMode = "none";
    this.animationQueue = new AnimationQueue(this.app, this.effectsLayer, this.boardView.describe);
    this.app.ticker.add(this.updateMotions, this);
    this.app.ticker.add(this.updateActivationPulse, this);
    this.minimap = document.getElementById("grid-minimap") as HTMLCanvasElement | null;
    this.bindInput();
    this.applyCamera();
  }

  private bindInput(): void {
    const options = { signal: this.inputEvents.signal };
    this.canvas.addEventListener("pointerdown", this.handlePointerDown, options);
    this.canvas.addEventListener("pointermove", this.handlePointerMove, options);
    this.canvas.addEventListener("pointerup", this.handlePointerUp, options);
    this.canvas.addEventListener("pointercancel", this.handlePointerUp, options);
    this.canvas.addEventListener("pointerleave", this.handlePointerLeave, options);
    this.canvas.addEventListener("wheel", this.handleWheel, { ...options, passive: false });
    this.canvas.addEventListener("contextmenu", this.preventContextMenu, options);
    window.addEventListener("keydown", this.handleCameraKeyDown, options);
    window.addEventListener("keyup", this.handleCameraKeyUp, options);
    window.addEventListener("resize", this.handleResize, options);
    this.minimap?.addEventListener("click", this.handleMinimapClick, options);
  }

  private canvasPoint(event: MouseEvent | PointerEvent | WheelEvent): ScreenPosition {
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * this.app.screen.width / bounds.width,
      y: (event.clientY - bounds.top) * this.app.screen.height / bounds.height,
    };
  }

  private pickAtScreen(screen: ScreenPosition): GridPosition | null {
    const local = this.worldContainer.toLocal(new Point(screen.x, screen.y));
    this.lastLocalPointer = { x: local.x, y: local.y };
    if (!this.state) {
      this.hoveredCandidates = isoPickCandidates(local, ISO_METRICS);
      return null;
    }
    const picked = pickElevatedIsoTile(
      local,
      this.state.battlefield.width,
      this.state.battlefield.height,
      ISO_METRICS,
      ELEVATION_STEP_HEIGHT,
      (position) => terrainElevationAt(this.state!, position),
      (position) => surfaceRampDirectionAt(this.state!, position),
      mapElevationRange(this.state.battlefield),
    );
    this.hoveredCandidates = picked
      ? [picked, ...isoPickCandidates(local, ISO_METRICS).filter((candidate) => !samePosition(candidate, picked))]
      : isoPickCandidates(local, ISO_METRICS);
    return picked;
  }

  private projectTile(position: GridPosition): ScreenPosition {
    return gridSurfaceToIso(
      position,
      this.state ? terrainElevationAt(this.state, position) : 0,
      this.state ? surfaceRampDirectionAt(this.state, position) : undefined,
      ISO_METRICS,
      ELEVATION_STEP_HEIGHT,
    );
  }

  private surfaceCorners(position: GridPosition, scale = 1): ScreenPosition[] {
    return isoSurfaceCorners(
      position,
      this.state ? terrainElevationAt(this.state, position) : 0,
      this.state ? surfaceRampDirectionAt(this.state, position) : undefined,
      ISO_METRICS,
      ELEVATION_STEP_HEIGHT,
      scale,
    );
  }

  private surfaceDiamond(position: GridPosition, scale = 1): number[] {
    return this.surfaceCorners(position, scale).flatMap((point) => [point.x, point.y]);
  }

  private surfacePoint(position: GridPosition, localPoint: ScreenPosition): ScreenPosition {
    const ramp = this.state ? surfaceRampDirectionAt(this.state, position) : undefined;
    return surfaceLocalToIso(this.projectTile(position), localPoint, ramp, ISO_METRICS, ELEVATION_STEP_HEIGHT);
  }

  private applySurfaceTransform(display: Container, position: GridPosition): void {
    const ramp = this.state ? surfaceRampDirectionAt(this.state, position) : undefined;
    if (!ramp) return;
    const gradient = rampSurfaceGradient(ramp, ISO_METRICS, ELEVATION_STEP_HEIGHT);
    display.setFromMatrix(new Matrix(1, gradient.x, 0, 1 + gradient.y, 0, 0));
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    const screen = this.canvasPoint(event);
    const panButton = event.button === 1 || (event.button === 0 && this.spaceHeld);
    if (event.button !== 0 && event.button !== 1) return;
    this.pointerId = event.pointerId;
    this.pointerStart = screen;
    this.lastPointer = screen;
    this.isPanning = panButton;
    if (panButton) {
      this.canvas.setPointerCapture(event.pointerId);
      this.canvas.style.cursor = "grabbing";
      event.preventDefault();
    }
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const screen = this.canvasPoint(event);
    if (this.isPanning && this.pointerId === event.pointerId && this.lastPointer) {
      const dx = screen.x - this.lastPointer.x;
      const dy = screen.y - this.lastPointer.y;
      this.camera.panBy(dx, dy);
      this.lastPointer = screen;
      if (this.pointerStart && Math.hypot(screen.x - this.pointerStart.x, screen.y - this.pointerStart.y) > 3) {
        this.spaceDragged = true;
        this.spaceTapPending = false;
      }
      this.applyCamera();
      return;
    }
    const local = this.worldContainer.toLocal(new Point(screen.x, screen.y));
    const picked = this.orderPreviewOverlay.isOverPositionControl(local) ? this.hoveredCell : this.pickAtScreen(screen);
    if (!samePosition(picked, this.hoveredCell)) {
      this.hoveredCell = picked;
      this.callbacks.onCellHover(picked);
      this.orderPreviewOverlay.handleHoverChanged();
    }
    this.renderDebugCandidates();
    this.updateDebugReadout();
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (this.pointerId !== event.pointerId) return;
    const screen = this.canvasPoint(event);
    const moved = this.pointerStart ? Math.hypot(screen.x - this.pointerStart.x, screen.y - this.pointerStart.y) : 0;
    if (!this.isPanning && event.button === 0 && moved <= 4) {
      const local = this.worldContainer.toLocal(new Point(screen.x, screen.y));
      const previewControl = this.orderPreviewOverlay.controlAt(local);
      if (previewControl) {
        this.orderPreviewOverlay.toggleMath(previewControl);
      } else {
        const picked = this.pickAtScreen(screen);
        if (picked) this.callbacks.onCellTap(picked);
      }
    }
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    this.pointerId = null;
    this.pointerStart = null;
    this.lastPointer = null;
    this.isPanning = false;
    this.canvas.style.cursor = "crosshair";
  };

  private readonly handlePointerLeave = (): void => {
    if (this.isPanning) return;
    this.hoveredCell = null;
    this.hoveredCandidates = [];
    this.callbacks.onCellHover(null);
    this.orderPreviewOverlay.handleHoverChanged();
    this.renderDebugCandidates();
    this.updateDebugReadout();
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const screen = this.canvasPoint(event);
    const nextZoom = this.camera.state.zoom * Math.exp(-event.deltaY * 0.0012);
    this.camera.zoomAt(screen, nextZoom);
    this.applyCamera();
  };

  private readonly handleCameraKeyDown = (event: KeyboardEvent): void => {
    if ((event.target as HTMLElement).matches("input, select, textarea")) return;
    if (event.code === "Space" && !event.repeat) {
      this.spaceHeld = true;
      this.spaceTapPending = true;
      this.spaceDragged = false;
    }
    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      this.camera.frameBattlefield();
      this.applyCamera();
    }
    if (event.key === "Home") {
      event.preventDefault();
      this.camera.reset();
      this.applyCamera();
    }
  };

  private readonly handleCameraKeyUp = (event: KeyboardEvent): void => {
    if (event.code === "Space") this.spaceHeld = false;
  };

  private readonly handleResize = (): void => {
    this.camera.setViewport({ width: this.app.screen.width, height: this.app.screen.height });
    this.applyCamera();
  };

  private readonly handleMinimapClick = (event: MouseEvent): void => {
    if (!this.state || !this.minimap) return;
    const bounds = this.minimap.getBoundingClientRect();
    const grid = {
      x: Math.max(0, Math.min(this.state.battlefield.width - 1, (event.clientX - bounds.left) / bounds.width * this.state.battlefield.width - 0.5)),
      y: Math.max(0, Math.min(this.state.battlefield.height - 1, (event.clientY - bounds.top) / bounds.height * this.state.battlefield.height - 0.5)),
    };
    this.camera.centerOn(fractionalGridToIso(grid, ISO_METRICS));
    this.applyCamera();
  };

  private readonly preventContextMenu = (event: MouseEvent): void => event.preventDefault();

  private applyCamera(): void {
    const { x, y, zoom } = this.camera.state;
    this.worldContainer.position.set(x, y);
    this.worldContainer.scale.set(zoom);
    this.renderMinimap();
    this.updateDebugReadout();
  }

  consumeSpaceTap(): boolean {
    const shouldEnd = this.spaceTapPending && !this.spaceDragged;
    this.spaceTapPending = false;
    this.spaceDragged = false;
    return shouldEnd;
  }

  frameBattlefield(): void {
    this.camera.frameBattlefield();
    this.applyCamera();
  }

  setAnimationSpeed(speed: AnimationSpeed): void {
    this.animationSpeed = speed;
    if (speed === 0) this.motions.length = 0;
    this.animationQueue?.setSpeed(speed);
  }

  setDebugVisible(visible: boolean): void {
    this.debugVisible = visible;
    this.renderDebugCandidates();
    this.updateDebugReadout();
    if (this.state) this.render(this.state);
  }

  setInspectedFormation(formationId: string | null): void {
    this.inspectedFormationId = formationId;
  }

  setMoraleVisible(visible: boolean): void {
    this.moraleVisible = visible;
    if (this.state) this.render(this.state);
  }

  toggleAxes(): boolean {
    this.axesVisible = !this.axesVisible;
    this.renderAxes();
    return this.axesVisible;
  }

  enqueueEvents(events: readonly GameEvent[]): void {
    // A trigger can add a formation in the same command, before the next render sees it.
    if (this.state) rememberFormationNames(this.state, this.formationNames);
    updateCasualtyMarkers(this.casualtyBodyTiles, this.casualtyTurnSkulls, events);
    this.pendingEvents = events;
    this.animationQueue?.enqueue(events);
  }

  private clearDynamicLayers(): void {
    for (const layer of [
      this.movementPreviewLayer,
      this.motionTrailLayer,
      this.blockShadowLayer,
      this.casualtyBodyLayer,
      this.characterLayer,
      this.casualtySkullLayer,
      this.orderPreviewLayer,
      this.formationIndicatorLayer,
      this.activationPulseLayer,
      this.floatingTextLayer,
      this.debugLayer,
    ]) {
      layer.removeChildren().forEach((child) => child.destroy({ children: true }));
    }
    for (const child of [...this.blockLayer.children]) {
      if (child.label?.startsWith("terrain-ledge-")) continue;
      this.blockLayer.removeChild(child);
      child.destroy({ children: true });
    }
    this.blockVisuals.clear();
    this.characterVisuals.clear();
    this.motions.length = 0;
    this.orderPreviewOverlay.clearHitAreas();
  }

  private registerBlockVisual(blockId: string, display: Container, position: GridPosition, priority: number): void {
    const projected = this.projectTile(position);
    const visuals = this.blockVisuals.get(blockId) ?? [];
    visuals.push({
      display,
      offsetX: display.position.x - projected.x,
      offsetY: display.position.y - projected.y,
      priority,
    });
    this.blockVisuals.set(blockId, visuals);
  }

  private registerCharacterVisual(characterId: string, display: Container, position: GridPosition): void {
    const projected = this.projectTile(position);
    this.characterVisuals.set(characterId, [{
      display,
      offsetX: display.position.x - projected.x,
      offsetY: display.position.y - projected.y,
      priority: ISO_DEPTH_PRIORITY.character,
    }]);
  }

  private timingForBlock(blockId: string): { durationMs: number; delayMs: number; charge: boolean } {
    const event = this.pendingEvents.find((candidate) => candidate.blockIds?.includes(blockId)
      && (candidate.type === "formation_moved" || candidate.type === "block_retreated"
        || candidate.type === "retreat_cascade" || candidate.type === "chaotic_retreat"));
    if (!event) return { durationMs: BALANCE.animationMs.move, delayMs: 0, charge: false };
    if (event.type === "retreat_cascade") {
      const index = Math.max(0, event.blockIds?.indexOf(blockId) ?? 0);
      const count = event.blockIds?.length ?? 1;
      return {
        durationMs: BALANCE.animationMs.retreat,
        delayMs: (count - index - 1) * BALANCE.animationMs.cascadeStagger,
        charge: false,
      };
    }
    if (event.type === "block_retreated") return { durationMs: BALANCE.animationMs.retreat, delayMs: 0, charge: false };
    if (event.type === "chaotic_retreat") {
      const index = Math.max(0, event.blockIds?.indexOf(blockId) ?? 0);
      return {
        durationMs: BALANCE.animationMs.retreat + BALANCE.animationMs.cascadeStagger,
        delayMs: index * Math.floor(BALANCE.animationMs.cascadeStagger / 2),
        charge: false,
      };
    }
    const charge = event.detail?.kind === "charge";
    return {
      durationMs: charge ? BALANCE.animationMs.charge * 3 : BALANCE.animationMs.move,
      delayMs: 0,
      charge,
    };
  }

  private drawChargeTrail(start: GridPosition, end: GridPosition): void {
    const difference = { x: end.x - start.x, y: end.y - start.y };
    const distance = Math.abs(difference.x) + Math.abs(difference.y);
    if (distance < 2) return;
    const step = { x: Math.sign(difference.x), y: Math.sign(difference.y) };
    const g = new Graphics();
    const startIso = this.projectTile(start);
    const endIso = this.projectTile(end);
    g.moveTo(startIso.x, startIso.y).lineTo(endIso.x, endIso.y)
      .stroke({ width: 5, color: 0xf3b94f, alpha: 0.42 });
    for (let index = 1; index <= distance; index += 1) {
      const crossed = { x: start.x + step.x * index, y: start.y + step.y * index };
      g.poly(this.surfaceDiamond(crossed, 0.42), true)
        .fill({ color: 0xf4c35d, alpha: 0.11 })
        .stroke({ width: 1.5, color: 0xf4c35d, alpha: 0.45 });
    }
    this.motionTrailLayer.addChild(g);
  }

  private animateMovedBlocks(state: GameState): void {
    if (this.animationSpeed === 0) return;
    const chargedTrails = new Set<string>();
    for (const block of Object.values(state.blocks)) {
      const start = this.previousBlockPositions.get(block.id);
      const visuals = this.blockVisuals.get(block.id);
      if (!start || !visuals || (start.x === block.position.x && start.y === block.position.y)) continue;
      const timing = this.timingForBlock(block.id);
      if (timing.charge) {
        const trailKey = `${start.x},${start.y}:${block.position.x},${block.position.y}`;
        if (!chargedTrails.has(trailKey)) {
          chargedTrails.add(trailKey);
          this.drawChargeTrail(start, block.position);
        }
      }
      this.motions.push({
        blockId: block.id,
        start: { ...start },
        end: { ...block.position },
        elapsedMs: 0,
        delayMs: timing.delayMs,
        durationMs: timing.durationMs / this.animationSpeed,
        visuals,
      });
      const projected = this.projectTile(start);
      for (const visual of visuals) visual.display.position.set(projected.x + visual.offsetX, projected.y + visual.offsetY);
    }
  }

  private animateMovedCharacters(state: GameState): void {
    if (this.animationSpeed === 0) return;
    for (const character of Object.values(state.characters)) {
      if (character.status === "defeated") continue;
      const host = state.blocks[character.hostBlockId];
      const start = this.previousCharacterPositions.get(character.id);
      const visuals = this.characterVisuals.get(character.id);
      if (!host || !start || !visuals || (start.x === host.position.x && start.y === host.position.y)) continue;
      const transferred = this.pendingEvents.some((event) => event.type === "character_transferred"
        && event.blockIds?.includes(host.id));
      this.motions.push({
        blockId: character.id,
        start: { ...start },
        end: { ...host.position },
        elapsedMs: 0,
        delayMs: 0,
        durationMs: (transferred ? BALANCE.animationMs.characterTransfer : BALANCE.animationMs.move) / this.animationSpeed,
        visuals,
      });
      const projected = this.projectTile(start);
      for (const visual of visuals) visual.display.position.set(projected.x + visual.offsetX, projected.y + visual.offsetY);
    }
  }

  private animateDepartingBlocks(state: GameState): void {
    if (this.animationSpeed === 0) return;
    const departures = this.pendingEvents.flatMap((event) => event.departingBlocks ?? []);
    for (const departure of departures) {
      const container = new Container({ label: `${departure.block.id}-departing` });
      const start = this.projectTile(departure.from);
      this.applySurfaceTransform(container, departure.from);
      container.position.set(start.x, start.y);
      container.zIndex = calculateIsoDepth(departure.from.x, departure.from.y, ISO_DEPTH_PRIORITY.blockBase);
      container.alpha = 0.9;
      this.drawPlatform(container, formationColour(departure.block), false, false, false);
      this.drawSoldiers(state, container, departure.block);
      this.blockLayer.addChild(container);
      this.motions.push({
        blockId: departure.block.id,
        start: departure.from,
        end: departure.to,
        elapsedMs: 0,
        delayMs: 0,
        durationMs: BALANCE.animationMs.rout / this.animationSpeed,
        visuals: [{ display: container, offsetX: 0, offsetY: 0, priority: ISO_DEPTH_PRIORITY.blockBase }],
        destroyOnComplete: true,
      });
    }
  }

  private readonly updateMotions = (): void => {
    if (this.motions.length === 0) return;
    for (let index = this.motions.length - 1; index >= 0; index -= 1) {
      const motion = this.motions[index]!;
      motion.elapsedMs += this.app.ticker.deltaMS;
      const progress = Math.max(0, Math.min(1, (motion.elapsedMs - motion.delayMs) / motion.durationMs));
      const grid = interpolateGridPosition(motion.start, motion.end, progress);
      const projected = interpolatePoint(this.projectTile(motion.start), this.projectTile(motion.end), progress);
      for (const visual of motion.visuals) {
        visual.display.position.set(projected.x + visual.offsetX, projected.y + visual.offsetY);
        visual.display.zIndex = calculateIsoDepth(grid.x, grid.y, visual.priority);
      }
      if (progress >= 1) {
        if (motion.destroyOnComplete) {
          for (const visual of motion.visuals) visual.display.destroy({ children: true });
        }
        this.motions.splice(index, 1);
      }
    }
    if (this.motions.length === 0) this.motionTrailLayer.removeChildren().forEach((child) => child.destroy());
  };

  private readonly updateActivationPulse = (): void => {
    if (this.activationPulseLayer.children.length === 0) return;
    this.activationPulseElapsedMs += this.app.ticker.deltaMS;
    this.activationPulseLayer.alpha = 0.72 + Math.sin(this.activationPulseElapsedMs / 420) * 0.18;
  };

  private drawSolidBuildingCell(graphics: Graphics, position: GridPosition, cell: BuildingCell): void {
    const baseCorners = this.surfaceCorners(position);
    const roofCorners = baseCorners.map((corner) => ({ x: corner.x, y: corner.y - 28 }));
    for (const direction of ["east", "south"] as const) {
      if (!cell.walls.includes(direction)) continue;
      const [baseStart, baseEnd] = terrainEdgePoints(baseCorners, direction);
      const [roofStart, roofEnd] = terrainEdgePoints(roofCorners, direction);
      graphics.poly([
        baseStart.x, baseStart.y, baseEnd.x, baseEnd.y,
        roofEnd.x, roofEnd.y, roofStart.x, roofStart.y,
      ], true).fill(direction === "east" ? 0x65503d : 0x584535)
        .stroke({ width: 1.5, color: 0x382c23, alpha: 0.95 });
    }
    graphics.poly(roofCorners.flatMap((corner) => [corner.x, corner.y]), true)
      .fill(0x927a5b)
      .stroke({ width: 2, color: 0xc1a77e, alpha: 0.9 });
    const centre = this.projectTile(position);
    graphics.moveTo(centre.x - 20, centre.y - 28).lineTo(centre.x, centre.y - 38)
      .lineTo(centre.x + 20, centre.y - 28)
      .stroke({ width: 2, color: 0x5a4635, alpha: 0.78 });
  }

  private drawTerrainTile(state: GameState, position: GridPosition, type: TerrainType): Graphics {
    const terrain = new Graphics({ label: `terrain-tile-${positionKey(position)}` });
    const centre = this.projectTile(position);
    const definition = terrainDefinition(type);
    const textureId = type === "building" ? undefined : groundTextureAt(state, position);
    const texture = textureId ? groundTextureDefinition(textureId) : undefined;
    const baseColour = texture?.colour ?? definition.colour;
    const alternateColour = texture?.alternateColour ?? definition.alternateColour;
    const colour = alternateColour !== undefined && (position.x + position.y) % 2 === 0
      ? alternateColour
      : baseColour;
    terrain.poly(this.surfaceDiamond(position), true).fill(colour)
      .stroke({ width: definition.strokeWidth, color: definition.strokeColour, alpha: 0.56 });
    if (textureId && texture) {
      drawGroundTextureDetails(terrain, centre, textureId, texture.detailColour);
    } else if (type === "forest") {
      terrain.circle(centre.x - 18, centre.y - 3, 3).fill({ color: 0x172918, alpha: 0.6 })
        .circle(centre.x + 14, centre.y + 5, 4).fill({ color: 0x45603a, alpha: 0.48 })
        .ellipse(centre.x + 2, centre.y - 7, 7, 2.5).fill({ color: 0x1f301c, alpha: 0.7 })
        .moveTo(centre.x - 9, centre.y + 8).lineTo(centre.x - 3, centre.y + 4)
        .moveTo(centre.x + 7, centre.y).lineTo(centre.x + 12, centre.y - 3)
        .stroke({ width: 1.5, color: 0x71805a, alpha: 0.55 });
    } else if (type === "impassable") {
      terrain.poly([centre.x - 17, centre.y + 8, centre.x - 10, centre.y - 12,
        centre.x + 2, centre.y - 22, centre.x + 16, centre.y + 7], true)
        .fill(0x595d56).stroke({ width: 2, color: 0x929488 });
    } else if (type === "road") {
      terrain.moveTo(centre.x - 31, centre.y - 7).lineTo(centre.x + 31, centre.y + 7)
        .moveTo(centre.x - 31, centre.y + 1).lineTo(centre.x + 31, centre.y + 15)
        .stroke({ width: 2, color: 0xa4936b, alpha: 0.75 })
        .ellipse(centre.x - 10, centre.y, 4, 2).fill(0x5d543f).ellipse(centre.x + 13, centre.y + 6, 5, 2).fill(0x5d543f);
    } else if (type === "fortress_wall") {
      terrain.moveTo(centre.x - 25, centre.y).lineTo(centre.x + 25, centre.y)
        .moveTo(centre.x, centre.y - 11).lineTo(centre.x, centre.y + 11)
        .stroke({ width: 1.2, color: 0x55564f, alpha: 0.72 })
        .ellipse(centre.x - 13, centre.y - 2, 5, 2.5).fill({ color: 0xa6a397, alpha: 0.5 })
        .ellipse(centre.x + 14, centre.y + 3, 6, 2.5).fill({ color: 0x5d5e57, alpha: 0.55 });
    } else if (type === "building") {
      const cell = buildingCellAt(state, position);
      if (cell) this.drawSolidBuildingCell(terrain, position, cell);
    } else if (type === "river_shallow" || type === "river_deep") {
      const waveColour = type === "river_deep" ? 0x9bd4df : 0xb5d9d2;
      terrain.moveTo(centre.x - 20, centre.y - 3).quadraticCurveTo(centre.x - 10, centre.y - 7, centre.x, centre.y - 3)
        .quadraticCurveTo(centre.x + 10, centre.y + 1, centre.x + 20, centre.y - 3)
        .moveTo(centre.x - 13, centre.y + 5).quadraticCurveTo(centre.x - 4, centre.y + 1, centre.x + 5, centre.y + 5)
        .quadraticCurveTo(centre.x + 12, centre.y + 8, centre.x + 17, centre.y + 5)
        .stroke({ width: type === "river_deep" ? 2 : 1.5, color: waveColour, alpha: 0.8 });
    }
    const objectPlacements = terrainObjectSlotPlacements(terrainObjectsAt(state, position))
      .sort((left, right) => Number(left.object !== "pond") - Number(right.object !== "pond")
        || left.objectIndex - right.objectIndex);
    for (const placement of objectPlacements) {
      const slots = blockSlotIndices(placement.slotMask);
      const objectCentre = slots.reduce((total, slotIndex) => {
        const offset = this.soldierOffset(BLOCK_SLOT_POINTS[slotIndex]!);
        return { x: total.x + offset.x / slots.length, y: total.y + offset.y / slots.length };
      }, { x: centre.x, y: centre.y });
      drawTerrainObject(terrain, placement.object, objectCentre.x, objectCentre.y);
    }
    terrain.eventMode = "none";
    terrain.zIndex = calculateIsoDepth(position.x, position.y, ISO_DEPTH_PRIORITY.terrain);
    return terrain;
  }

  private renderTerrain(state: GameState): void {
    const map = state.battlefield;
    const mapChanged = this.terrainMap !== map;
    const changes = mapChanged ? null : mapChangesSince(map, this.terrainRevision);
    if (!mapChanged && changes?.length === 0) return;
    const fullRebuild = mapChanged || changes === null || changes.some((change) => change.topologyChanged);
    const dirtyKeys = new Set<string>();
    if (fullRebuild) {
      for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) dirtyKeys.add(`${x},${y}`);
      this.terrainLayer.removeChildren().forEach((child) => child.destroy());
      this.terrainTiles.clear();
      for (const occluder of this.terrainOccluders.values()) {
        occluder.removeFromParent();
        occluder.destroy();
      }
      this.terrainOccluders.clear();
    } else {
      for (const change of changes) for (const key of change.dirtyCells) dirtyKeys.add(key);
    }
    const boundsChanged = fullRebuild || changes?.some((change) => change.boundsChanged) === true;
    if (boundsChanged) {
      this.camera.setBounds(boardBounds(map.width, map.height, mapElevationRange(map)), mapChanged);
      this.applyCamera();
    }
    for (const key of dirtyKeys) {
      const [x, y] = key.split(",").map(Number);
      const position = { x: x!, y: y! };
      const previous = this.terrainTiles.get(key);
      if (previous) {
        previous.removeFromParent();
        previous.destroy();
      }
      const type = terrainAt(state, position);
      if (!type) {
        this.terrainTiles.delete(key);
        continue;
      }
      const graphic = this.drawTerrainTile(state, position, type);
      this.terrainTiles.set(key, graphic);
      this.terrainLayer.addChild(graphic);
    }
    this.renderTerrainOccluders(dirtyKeys);
    this.renderEdgeFeatures();
    this.terrainMap = map;
    this.terrainRevision = map.revision;
    this.animationQueue?.setTerrainProjection(
      (position) => this.projectTile(position),
      fractionalGridToIso({ x: (map.width - 1) / 2, y: (map.height - 1) / 2 }, ISO_METRICS),
    );
  }

  private renderTerrainOccluders(dirtyKeys: ReadonlySet<string>): void {
    for (const key of dirtyKeys) {
      const [x, y] = key.split(",").map(Number);
        const position = { x, y };
        const corners = this.surfaceCorners(position);
        for (const direction of ["east", "south"] as const) {
          const occluderKey = `${x},${y}-${direction}`;
          const previous = this.terrainOccluders.get(occluderKey);
          if (previous) {
            previous.removeFromParent();
            previous.destroy();
            this.terrainOccluders.delete(occluderKey);
          }
          const neighbour = addPosition(position, directionVector(direction));
          const neighbourCorners = this.surfaceCorners(neighbour);
          const [start, end, lowerStart, lowerEnd] = direction === "east"
            ? [corners[1]!, corners[2]!, neighbourCorners[0]!, neighbourCorners[3]!]
            : [corners[2]!, corners[3]!, neighbourCorners[1]!, neighbourCorners[0]!];
          if (start.y >= lowerStart.y && end.y >= lowerEnd.y) continue;

          const stoneWall = terrainAt(this.state!, position) === "fortress_wall";
          const face = new Graphics({ label: `terrain-ledge-${x},${y}-${direction}` })
            .poly([
              start.x, start.y,
              end.x, end.y,
              lowerEnd.x, lowerEnd.y,
              lowerStart.x, lowerStart.y,
            ], true)
            .fill(stoneWall ? (direction === "east" ? 0x5f605a : 0x52534e) : (direction === "east" ? 0x403c2c : 0x343225))
            .stroke({ width: stoneWall ? 1.5 : 1, color: stoneWall ? 0xa6a397 : 0x81765a, alpha: 0.7 });
          face.zIndex = calculateIsoBoundaryDepth(
            position.x,
            position.y,
            neighbour.x,
            neighbour.y,
            ISO_DEPTH_PRIORITY.blockBase,
          );
          face.eventMode = "none";
          this.blockLayer.addChild(face);
          this.terrainOccluders.set(occluderKey, face);
        }
    }
  }

  private renderEdgeFeatures(): void {
    if (!this.state) return;
    for (const [key, graphic] of [...this.terrainOccluders]) {
      if (!key.startsWith("edge:")) continue;
      graphic.removeFromParent();
      graphic.destroy();
      this.terrainOccluders.delete(key);
    }
    for (const feature of this.state.battlefield.edgeFeatures) {
      const graphic = this.drawEdgeFeature(feature);
      const neighbour = addPosition(feature.position, directionVector(feature.direction));
      graphic.zIndex = calculateIsoBoundaryDepth(
        feature.position.x,
        feature.position.y,
        neighbour.x,
        neighbour.y,
        ISO_DEPTH_PRIORITY.blockBase + 1,
      );
      graphic.eventMode = "none";
      this.blockLayer.addChild(graphic);
      this.terrainOccluders.set(`edge:${edgeFeaturePhysicalKey(feature.position, feature.direction)}`, graphic);
    }
  }

  private drawEdgeFeature(feature: EdgeFeaturePlacement): Graphics {
    const definition = edgeFeatureDefinition(feature.type);
    let anchorPosition = feature.position;
    let anchorDirection = feature.direction;
    const neighbour = addPosition(feature.position, directionVector(feature.direction));
    const neighbourInBounds = this.state !== null
      && neighbour.x >= 0 && neighbour.y >= 0
      && neighbour.x < this.state.battlefield.width && neighbour.y < this.state.battlefield.height;
    if (this.state && neighbourInBounds
      && terrainElevationAt(this.state, neighbour) > terrainElevationAt(this.state, feature.position)) {
      anchorPosition = neighbour;
      anchorDirection = oppositeDirection(feature.direction);
    }
    const [baseStart, baseEnd] = terrainEdgePoints(this.surfaceCorners(anchorPosition), anchorDirection);
    return drawEdgeFeatureShape(feature, definition, baseStart, baseEnd);
  }

  private drawShadow(position: GridPosition, blockId: string): void {
    const centre = this.projectTile(position);
    const shadow = new Graphics()
      .ellipse(0, 12, 39, 14)
      .fill({ color: 0x050705, alpha: 0.38 });
    this.applySurfaceTransform(shadow, position);
    shadow.position.set(centre.x, centre.y);
    shadow.zIndex = calculateIsoDepth(position.x, position.y, ISO_DEPTH_PRIORITY.blockShadow);
    this.blockShadowLayer.addChild(shadow);
    this.registerBlockVisual(blockId, shadow, position, ISO_DEPTH_PRIORITY.blockShadow);
  }

  private drawPlatform(container: Container, colour: number, selected: boolean, contested: boolean, braced: boolean): void {
    const base = new Graphics()
      .poly(PLATFORM_LEFT_FACE, true).fill(contested ? 0x403a31 : 0x38241f)
      .poly(PLATFORM_RIGHT_FACE, true).fill(contested ? 0x554b3b : 0x552b25)
      .poly(PLATFORM_TOP, true)
      .fill({ color: contested ? 0x665b47 : colour, alpha: contested ? 0.9 : 0.94 })
      .stroke({
        width: braced || selected ? 3 : 1.5,
        color: braced ? BRACED_BORDER_COLOUR : selected ? 0xffe6a3 : 0x211914,
        alpha: 0.95,
      });
    base.eventMode = "none";
    container.addChild(base);
  }

  private soldierOffset(mark: GridPosition): ScreenPosition {
    return fractionalGridToIso(
      { x: (mark.x - 26) / 52, y: (mark.y - 26) / 52 },
      ISO_METRICS,
    );
  }

  private drawSoldiers(
    state: GameState,
    container: Container,
    block: TroopBlock,
    unavailableMask: BlockSlotMask = 0,
    soldierMask?: BlockSlotMask,
  ): void {
    const occupiedSlots = blockSlotIndices(
      soldierMask ?? deriveBlockSlotOccupancy(state, block, unavailableMask).soldierMask,
    );
    const soldiers = new Graphics();
    const formation = blockFormation(state, block);
    const soldierTexture = this.textureForSoldierArt(soldierArtKind(state, block));
    for (const slotIndex of occupiedSlots) {
      const projected = this.soldierOffset(BLOCK_SLOT_POINTS[slotIndex]!);
      const jitter = (block.wavering ? 2 : 0) * ((slotIndex % 3) - 1);
      const markX = projected.x + jitter;
      const markY = projected.y - BLOCK_PLATFORM_HEIGHT - 3 + (block.wavering ? (slotIndex % 2) * 2 : 0);
      if (soldierTexture) {
        const sprite = new Sprite({
          texture: soldierTexture,
          anchor: { x: 0.5, y: 1 },
          position: { x: Math.round(markX), y: Math.round(markY + 4) },
          roundPixels: true,
        });
        sprite.width = 16;
        sprite.height = 16;
        sprite.eventMode = "none";
        container.addChild(sprite);
      } else if (formation && isCavalry(formation.unit.unitType)) {
        soldiers.ellipse(markX, markY, 6, 3).fill(0xead8b5)
          .rect(markX - 1.5, markY - 9, 3, 8).fill(0x2c211a)
          .circle(markX, markY - 11, 2).fill(0xe6c7a4);
      } else {
        soldiers.circle(markX, markY - 9, 2.4).fill(0xe6c7a4)
          .moveTo(markX, markY - 7).lineTo(markX, markY + 2)
          .stroke({ width: 2.5, color: 0x2c211a });
        if (block.factionId === "roman") {
          soldiers.rect(markX - 3.2, markY - 4, 6.4, 8).fill(0xe9d5b6).stroke({ width: 1, color: 0x5d151c });
        } else {
          soldiers.circle(markX, markY, 3.8).fill(0xd2b98f).stroke({ width: 1, color: 0x4d3324 });
        }
      }
    }
    soldiers.eventMode = "none";
    container.addChild(soldiers);
  }

  private renderCasualtyBodies(): void {
    for (const marker of this.casualtyBodyTiles.values()) {
      const centre = this.projectTile(marker.position);
      const group = new Container({ label: `casualty-bodies-${positionKey(marker.position)}` });
      this.applySurfaceTransform(group, marker.position);
      group.position.set(centre.x, centre.y);
      group.zIndex = calculateIsoDepth(marker.position.x, marker.position.y, ISO_DEPTH_PRIORITY.soldier - 1);
      const graphics = new Graphics({ roundPixels: true })
        .poly(diamondAt({ x: 0, y: 0 }, 0.72), true)
        .fill({ color: 0x4f1118, alpha: Math.min(0.18, 0.035 + marker.casualties * 0.015) });
      const visibleBodies = Math.min(marker.casualties, CASUALTY_BODY_OFFSETS.length);
      for (let index = 0; index < visibleBodies; index += 1) {
        const offset = CASUALTY_BODY_OFFSETS[index]!;
        drawFallenBody(graphics, offset.x, offset.y, CASUALTY_BODY_ANGLES[index]!);
      }
      graphics.eventMode = "none";
      group.addChild(graphics);
      this.casualtyBodyLayer.addChild(group);
    }
  }

  private renderCasualtySkulls(): void {
    for (const marker of this.casualtyTurnSkulls.values()) {
      const centre = this.projectTile(marker.position);
      const group = new Container({ label: `casualty-skulls-${positionKey(marker.position)}` });
      group.position.set(centre.x, centre.y);
      group.zIndex = calculateIsoDepth(marker.position.x, marker.position.y, ISO_DEPTH_PRIORITY.effect);
      const graphics = new Graphics({ roundPixels: true });
      const columns = Math.min(5, marker.casualties);
      for (let index = 0; index < marker.casualties; index += 1) {
        const row = Math.floor(index / 5);
        const column = index % 5;
        const remaining = marker.casualties - row * 5;
        const rowColumns = Math.min(columns, remaining);
        const x = (column - (rowColumns - 1) / 2) * 10;
        const y = -37 - row * 10 + (column % 2 === 0 ? -1 : 1);
        drawSkullIcon(graphics, x, y);
      }
      graphics.eventMode = "none";
      group.addChild(graphics);
      this.casualtySkullLayer.addChild(group);
    }
  }

  private drawTerrainOccupant(
    container: Container,
    state: GameState,
    position: GridPosition,
    terrainType: TerrainType,
  ): void {
    const terrainSlots = blockSlotIndices(terrainSlotMaskAt(state, position));
    if (terrainSlots.length === 0) return;
    if (terrainType === "building") {
      return;
    }
    const objects = new Graphics();
    const objectPlacements = terrainObjectSlotPlacements(terrainObjectsAt(state, position))
      .sort((left, right) => Number(left.object !== "pond") - Number(right.object !== "pond")
        || left.objectIndex - right.objectIndex);
    for (const placement of objectPlacements) {
      const slots = blockSlotIndices(placement.slotMask);
      const centre = slots.reduce((total, slotIndex) => {
        const offset = this.soldierOffset(BLOCK_SLOT_POINTS[slotIndex]!);
        return { x: total.x + offset.x / slots.length, y: total.y + offset.y / slots.length };
      }, { x: 0, y: 0 });
      drawTerrainObject(objects, placement.object, centre.x, centre.y - BLOCK_PLATFORM_HEIGHT);
    }
    objects.eventMode = "none";
    container.addChild(objects);
  }

  private drawContestedEffects(container: Container): void {
    const effects = new Graphics()
      .circle(-8, -9, 7).fill({ color: 0xc8b27e, alpha: 0.13 })
      .circle(7, -12, 9).fill({ color: 0xc8b27e, alpha: 0.1 })
      .moveTo(-12, -20).lineTo(11, 1)
      .moveTo(11, -20).lineTo(-12, 1)
      .stroke({ width: 2.5, color: 0xf0d99c, alpha: 0.85 });
    container.addChild(effects);
  }

  private contestedSlotOccupancies(
    state: GameState,
    blocks: readonly TroopBlock[],
    unavailableMask: BlockSlotMask,
  ): ContestedBlockSlotOccupancy[] {
    const livingCharacterBlocks = blocks.map((block) => this.blockWithRenderableCharacter(state, block));
    const duelActive = livingCharacterBlocks.length === 2 && livingCharacterBlocks.every((block) => {
      const character = block.characterId ? state.characters[block.characterId] : undefined;
      return character?.status === "duelling";
    });
    return deriveContestedCellSlotOccupancies(state, livingCharacterBlocks, unavailableMask, duelActive);
  }

  private blockWithRenderableCharacter(state: GameState, block: TroopBlock): TroopBlock {
    const character = block.characterId ? state.characters[block.characterId] : undefined;
    return character?.status === "defeated" ? { ...block, characterId: null } : block;
  }

  private drawBlockCell(state: GameState, blocks: TroopBlock[]): void {
    const position = blocks[0]!.position;
    const terrainType = terrainAt(state, position)!;
    const unavailableMask = terrainSlotMaskAt(state, position);
    const centre = this.projectTile(position);
    const contested = blocks.length > 1 && blocks.some((block) => block.isContested);
    if (contested) {
      this.drawShadow(position, blocks[0]!.id);
      const container = new Container({ label: `contested-${positionKey(position)}` });
      this.applySurfaceTransform(container, position);
      container.position.set(centre.x, centre.y);
      container.zIndex = calculateIsoDepth(position.x, position.y, ISO_DEPTH_PRIORITY.blockBase);
      const selected = blocks.some((block) => state.selectedBlockId === block.id || state.selectedFormationId === block.formationId);
      const braced = blocks.some((block) => block.formationId && state.formations[block.formationId]?.isBraced);
      this.drawPlatform(container, 0x665b47, selected, true, braced);
      this.drawTerrainOccupant(container, state, position, terrainType);
      const ordered = [...blocks].sort((a, b) => a.factionId.localeCompare(b.factionId));
      const slotOccupancies = this.contestedSlotOccupancies(state, ordered, unavailableMask);
      ordered.forEach((block) => {
        const occupancy = slotOccupancies.find((candidate) => candidate.blockId === block.id);
        this.drawSoldiers(state, container, block, unavailableMask, occupancy?.soldierMask);
      });
      this.drawContestedEffects(container);
      this.blockLayer.addChild(container);
    } else {
      for (const block of blocks) {
        this.drawShadow(position, block.id);
        const selected = state.selectedBlockId === block.id || (!state.selectedBlockId && state.selectedFormationId === block.formationId);
        const container = new Container({ label: block.id });
        this.applySurfaceTransform(container, position);
        container.position.set(centre.x, centre.y);
        container.zIndex = calculateIsoDepth(position.x, position.y, ISO_DEPTH_PRIORITY.blockBase);
        const braced = Boolean(block.formationId && state.formations[block.formationId]?.isBraced);
        this.drawPlatform(container, this.moraleVisible ? moraleColour(state, block) : formationColour(block), selected, false, braced);
        this.drawFormationBorders(container, state, block);
        this.drawTerrainOccupant(container, state, position, terrainType);
        const renderableBlock = this.blockWithRenderableCharacter(state, block);
        this.drawSoldiers(state, container, renderableBlock, unavailableMask);
        this.blockLayer.addChild(container);
        this.registerBlockVisual(block.id, container, block.position, ISO_DEPTH_PRIORITY.blockBase);
        this.drawFormationIndicator(state, block, selected);
      }
    }
  }

  private sameFormationNeighbour(state: GameState, block: TroopBlock, direction: Direction): boolean {
    const neighbour = addPosition(block.position, directionVector(direction));
    const occupancy = occupancyAt(state, neighbour);
    return [occupancy.romanBlockId, occupancy.saxonBlockId]
      .some((id) => id !== null && state.blocks[id]?.formationId === block.formationId);
  }

  private drawFormationBorders(container: Container, state: GameState, block: TroopBlock): void {
    const formation = blockFormation(state, block);
    if (!formation || block.isContested) return;
    const facing = blockFacing(state, block.id);
    const g = new Graphics();
    if (formationIsEngaged(state, formation.id)) {
      g.poly(DIAMOND_POINTS, true).stroke({ width: 2.5, color: 0xf08a4b, alpha: 0.72 });
    }
    if (this.inspectedFormationId === formation.id) {
      g.poly(DIAMOND_POINTS, true).stroke({ width: 4, color: INSPECTED_OUTLINE_COLOUR, alpha: 1 });
    }
    for (const direction of ["north", "east", "south", "west"] as const) {
      if (this.sameFormationNeighbour(state, block, direction)) continue;
      const edge = edgePoints(directionToDiamondEdge(direction));
      const isFront = direction === facing;
      const isRear = direction === oppositeDirection(facing);
      const newlyExposed = formation.status === "fragment" && !isFront && !isRear;
      const colour = formation.isBraced ? BRACED_BORDER_COLOUR
        : isFront ? (block.factionId === "roman" ? 0xffd1b2 : 0xffd58d)
        : newlyExposed ? 0xffc766 : isRear ? 0x171713 : 0xd7ccb2;
      const width = formation.isBraced ? 4 : isFront ? 5 : newlyExposed ? 3 : isRear ? 3 : 1.5;
      const alpha = formation.isBraced ? 1 : isFront || newlyExposed ? 1 : isRear ? 0.92 : 0.58;
      g.moveTo(edge[0], edge[1]).lineTo(edge[2], edge[3]).stroke({ width, color: colour, alpha });
      if (isFront) {
        for (const ratio of [0.35, 0.65]) {
          const x = edge[0] + (edge[2] - edge[0]) * ratio;
          const y = edge[1] + (edge[3] - edge[1]) * ratio;
          g.circle(x, y, 2.2).fill(colour);
        }
      }
    }
    g.eventMode = "none";
    container.addChild(g);
  }

  private drawFormationIndicator(state: GameState, block: TroopBlock, selected: boolean): void {
    const formation = blockFormation(state, block);
    if (!formation || block.isContested || !selected) return;
    const facing = blockFacing(state, block.id);
    const edge = edgePoints(directionToDiamondEdge(facing));
    const midX = (edge[0] + edge[2]) / 2;
    const midY = (edge[1] + edge[3]) / 2;
    const direction = projectedDirection(facing);
    const magnitude = Math.hypot(direction.x, direction.y);
    const dx = direction.x / magnitude;
    const dy = direction.y / magnitude;
    const g = new Graphics()
      .moveTo(midX, midY).lineTo(midX + dx * 14, midY + dy * 14)
      .stroke({ width: 3, color: 0xffffff })
      .poly([
        midX + dx * 17, midY + dy * 17,
        midX + dx * 9 - dy * 4, midY + dy * 9 + dx * 4,
        midX + dx * 9 + dy * 4, midY + dy * 9 - dx * 4,
      ], true).fill(0xffffff);
    const centre = this.projectTile(block.position);
    this.applySurfaceTransform(g, block.position);
    g.position.set(centre.x, centre.y);
    g.zIndex = calculateIsoDepth(block.position.x, block.position.y, ISO_DEPTH_PRIORITY.soldier);
    this.formationIndicatorLayer.addChild(g);
    this.registerBlockVisual(block.id, g, block.position, ISO_DEPTH_PRIORITY.soldier);
  }

  private renderBlocks(state: GameState): void {
    const cells = new Map<string, TroopBlock[]>();
    for (const block of Object.values(state.blocks)) {
      const key = positionKey(block.position);
      const list = cells.get(key) ?? [];
      list.push(block);
      cells.set(key, list);
    }
    const ordered = [...cells.values()].sort((a, b) =>
      calculateIsoDepth(a[0]!.position.x, a[0]!.position.y) - calculateIsoDepth(b[0]!.position.x, b[0]!.position.y));
    for (const blocks of ordered) this.drawBlockCell(state, blocks);
  }

  private renderActivationPulses(state: GameState): void {
    this.activationPulseElapsedMs = 0;
    this.activationPulseLayer.alpha = 0.72;
    if (state.phase !== "selecting" || state.selectedFormationId !== null) return;
    for (const block of Object.values(state.blocks)) {
      if (!block.formationId || !canSelectFormation(state, block.formationId)) continue;
      const pulse = new Graphics()
        .poly(this.surfaceDiamond(block.position, 0.93), true)
        .fill({ color: 0xffd782, alpha: 0.07 })
        .stroke({ width: 3, color: 0xffd782, alpha: 0.58 });
      pulse.zIndex = calculateIsoDepth(block.position.x, block.position.y, ISO_DEPTH_PRIORITY.soldier + 1);
      pulse.eventMode = "none";
      this.activationPulseLayer.addChild(pulse);
      this.registerBlockVisual(block.id, pulse, block.position, ISO_DEPTH_PRIORITY.soldier + 1);
    }
  }

  private renderCharacters(state: GameState): void {
    for (const character of Object.values(state.characters)) {
      if (character.status === "defeated") continue;
      const host = state.blocks[character.hostBlockId];
      if (!host) continue;
      const hostTerrainMask = terrainSlotMaskAt(state, host.position);
      const occupants = blocksAt(state, host.position);
      const contestedOccupancy = host.isContested
        ? this.contestedSlotOccupancies(state, occupants, hostTerrainMask)
          .find((occupancy) => occupancy.blockId === host.id)
        : undefined;
      const characterSlot = blockSlotIndices(contestedOccupancy?.characterMask
        ?? deriveBlockSlotOccupancy(state, host, hostTerrainMask).characterMask)[0];
      const characterOffset = characterSlot === undefined
        ? { x: 0, y: 0 }
        : this.soldierOffset(BLOCK_SLOT_POINTS[characterSlot]!);
      const group = new Container({ label: character.id });
      const surfacePosition = this.surfacePoint(host.position, {
        x: characterOffset.x,
        y: characterOffset.y - BLOCK_PLATFORM_HEIGHT - 10,
      });
      group.position.set(surfacePosition.x, surfacePosition.y);
      group.zIndex = calculateIsoDepth(host.position.x, host.position.y, ISO_DEPTH_PRIORITY.character + (host.factionId === "roman" ? 0 : 1));
      const g = new Graphics().circle(0, 0, 8).fill(0xf4d889).stroke({ width: 2, color: 0x3a2917 });
      if (character.role === "commander") {
        g.moveTo(0, -8).lineTo(0, -22).lineTo(11, -18).lineTo(0, -13).fill(0xf0c95f);
      } else if (character.role === "champion") {
        g.poly([-7, -8, 0, -16, 7, -8], true).fill(0xd8d1c1);
      }
      const initial = new Text({
        text: character.name[0]!,
        style: { fontFamily: "Georgia", fontSize: 10, fontWeight: "700", fill: 0x2b1a10 },
      });
      initial.anchor.set(0.5);
      group.addChild(g, initial);
      if (state.selectedBlockId === host.id) {
        const name = new Text({
          text: character.name,
          style: { fontFamily: "Arial", fontSize: 10, fill: 0xffedb2, stroke: { color: 0x17130e, width: 3 } },
        });
        name.anchor.set(0.5, 1);
        name.position.set(0, -14);
        group.addChild(name);
      }
      this.characterLayer.addChild(group);
      this.registerCharacterVisual(character.id, group, host.position);
    }
  }

  /** Name, morale, and men left for every formation on both sides, always on. */
  private renderFormationPlates(state: GameState, orderPreview: OrderConfirmationPreview | null): void {
    const involved = new Set((orderPreview?.damage ?? [])
      .map((damage) => baseFormationId(state.blocks[damage.blockId]?.formationId ?? null)));
    for (const plate of formationPlates(state)) {
      if (involved.has(plate.key)) continue;
      const position = this.surfacePoint(plate.position, { x: 0, y: -BLOCK_PLATFORM_HEIGHT - 34 });
      const text = new Text({
        text: plate.text,
        style: { fontFamily: "Arial", fontSize: 18, fontWeight: "700", fill: PLATE_COLOURS[plate.tone] },
      });
      text.anchor.set(0.5);
      const background = new Graphics()
        .roundRect(-text.width / 2 - 5, -text.height / 2 - 2, text.width + 10, text.height + 4, 3)
        .fill({ color: plate.factionId === "roman" ? 0x4a1418 : 0x33260f, alpha: 0.9 });
      const group = new Container({ label: `plate-${plate.key}` });
      group.position.set(position.x, position.y);
      group.eventMode = "none";
      group.zIndex = calculateIsoDepth(plate.position.x, plate.position.y, ISO_DEPTH_PRIORITY.floatingLabel);
      group.addChild(background, text);
      this.characterLayer.addChild(group);
    }
  }

  private renderDebugCandidates(): void {
    this.debugLayer.removeChildren().forEach((child) => child.destroy());
    if (this.debugVisible) drawDebugCandidates(this.debugLayer, this.boardView, this.state, this.hoveredCandidates);
  }

  private updateDebugReadout(): void {
    const readout = document.getElementById("grid-iso-debug-readout");
    if (readout) readout.textContent = debugReadoutText(this.boardView, this.camera.state, this.hoveredCandidates, this.lastLocalPointer);
  }

  private renderAxes(): void {
    this.pixiUiLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    if (this.axesVisible) drawAxes(this.pixiUiLayer);
  }

  private renderMinimap(): void {
    if (!this.state || !this.minimap) return;
    const state = this.state;
    const corners = [
      { x: 0, y: 0 }, { x: this.app.screen.width, y: 0 },
      { x: this.app.screen.width, y: this.app.screen.height }, { x: 0, y: this.app.screen.height },
    ].map((screen) => isoToFractionalGrid(this.camera.screenToWorld(screen), ISO_METRICS));
    drawMinimap(this.minimap, state, (block) => (this.moraleVisible
      ? cssColour(moraleColour(state, block))
      : block.factionId === "roman" ? "#cf4b58" : "#b08150"), corners);
  }

  render(state: GameState, orderPreview: OrderConfirmationPreview | null = this.orderPreviewOverlay.current): void {
    if (this.state && this.state !== state) {
      this.casualtyBodyTiles.clear();
      this.casualtyTurnSkulls.clear();
      this.formationNames.clear();
    }
    this.state = state;
    rememberFormationNames(state, this.formationNames);
    this.orderPreviewOverlay.setPreview(orderPreview);
    this.renderTerrain(state);
    this.clearDynamicLayers();
    if (!orderPreview) drawActionPreviews(state, this.movementPreviewLayer, this.boardView);
    this.renderBlocks(state);
    this.renderCasualtyBodies();
    this.renderActivationPulses(state);
    this.renderCharacters(state);
    this.renderFormationPlates(state, orderPreview);
    this.renderCasualtySkulls();
    this.orderPreviewOverlay.draw();
    this.animateMovedBlocks(state);
    this.animateMovedCharacters(state);
    this.animateDepartingBlocks(state);
    this.pendingEvents = [];
    if (this.debugVisible) drawDebugLabels(this.floatingTextLayer, this.boardView, state);
    this.renderDebugCandidates();
    this.renderMinimap();
    this.previousBlockPositions.clear();
    for (const block of Object.values(state.blocks)) this.previousBlockPositions.set(block.id, { ...block.position });
    this.previousCharacterPositions.clear();
    for (const character of Object.values(state.characters)) {
      const host = state.blocks[character.hostBlockId];
      if (host) this.previousCharacterPositions.set(character.id, { ...host.position });
    }
  }

  terrainDescription(position: GridPosition): string {
    const terrain = this.state ? terrainAt(this.state, position) ?? "outside" : "outside";
    if (!this.state) return terrain;
    const occupancy = occupancyAt(this.state, position);
    const occupants = [occupancy.romanBlockId, occupancy.saxonBlockId].filter((id): id is string => id !== null);
    const blocks = this.debugVisible
      ? occupants.join(" + ")
      : occupants.map((id) => {
        const formationId = this.state!.blocks[id]?.formationId;
        return formationId ? this.state!.formations[formationId]?.name ?? "" : "";
      }).filter(Boolean).join(" + ");
    const description = terrain === "outside"
      ? terrain
      : terrainTypeDescription(
        terrain,
        buildingCellAt(this.state, position),
        terrainElevationAt(this.state, position),
        rampDirectionAt(this.state, position),
        terrainObjectsAt(this.state, position),
        groundTextureAt(this.state, position),
      );
    const edgeDescriptions = (["north", "east", "south", "west"] as const).flatMap((direction) => {
      const feature = edgeFeatureAt(this.state!.battlefield, position, direction);
      return feature ? [`${direction} ${edgeFeatureDefinition(feature.type).description}`] : [];
    });
    const withEdges = edgeDescriptions.length > 0 ? `${description} · ${edgeDescriptions.join(" · ")}` : description;
    return blocks ? `${withEdges} · ${blocks}` : withEdges;
  }

  destroy(): void {
    this.inputEvents.abort();
    this.app.ticker.remove(this.updateMotions, this);
    this.app.ticker.remove(this.updateActivationPulse, this);
    this.animationQueue?.destroy();
    this.animationQueue = null;
    // Destroying the app loses this canvas's WebGL context for good, and Pixi hangs if it
    // initialises on a lost context. The next battle needs a new canvas in the same place.
    this.canvas.replaceWith(this.canvas.cloneNode(false));
    this.app.destroy({ removeView: false, releaseGlobalResources: true }, { children: true });
  }
}
