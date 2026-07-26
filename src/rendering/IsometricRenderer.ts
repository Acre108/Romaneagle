import type { Camera } from "../core/Camera";
import { clamp, type Vec2 } from "../core/math";
import {
  STANDARD_AURA_RADIUS,
  type BattleEffect,
  type BattleStandard,
  type DiscardedEquipment,
  type FallenBody,
  type RoutEscapeVisual,
} from "../systems/Simulation";
import { formationRadius } from "../units/formation";
import { calculateFormationOrderLayout } from "../units/FormationOrderLayout";
import {
  FACTION_STYLE,
  isUnitInactive,
  TACTICAL_STATE_STYLE,
  type Unit,
} from "../units/types";
import {
  getUnitActivityStatus,
  getUnitActivityText,
  getUnitMoraleStatus,
  UNIT_STATUS_STYLE,
} from "../units/UnitStatus";
import type { Battlefield, Decoration } from "../world/Battlefield";
import {
  BRIDGE_CENTRE_X,
  BRIDGE_HALF_LENGTH,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../world/Battlefield";
import { getProjectedDepth, worldVectorToScreen } from "./IsometricProjection";
import type { DragVisual, RenderStats } from "./RenderTypes";
import { buildWaterSegments } from "./WaterSegments";
import { drawBattleStandardScreen } from "./BattleStandardVisual";
import {
  resolveUnitLabelPlacements,
  type UnitLabelPlacement,
} from "./UnitLabelLayout";

const BODY = 0;
const EQUIPMENT = 1;
const ROUT_ESCAPE = 2;
const SOLDIER = 3;
const ROCK = 4;
const TREE = 5;
const STANDARD = 6;
const EFFECT = 7;

interface RenderRecord {
  kind: number;
  depth: number;
  screenX: number;
  screenY: number;
  unit?: Unit;
  soldierIndex: number;
  direction: number;
  decoration?: Decoration;
  effect?: BattleEffect;
  body?: FallenBody;
  standard?: BattleStandard;
  routEscape?: RoutEscapeVisual;
  equipment?: DiscardedEquipment;
}

interface UnitLabelRecord extends UnitLabelPlacement {
  unit?: Unit;
  anchorX: number;
  anchorY: number;
}

export class IsometricRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly screenScratch: Vec2 = { x: 0, y: 0 };
  private readonly renderPool: RenderRecord[] = [];
  private readonly activeRecords: RenderRecord[] = [];
  private readonly roughPolygons: Vec2[][];
  private readonly colourBands: Vec2[][];
  private readonly streamPoints: Vec2[] = [];
  private readonly deepStreamSegments: Vec2[][] = [];
  private readonly shallowStreamSegments: Vec2[][] = [];
  private readonly labelPool: UnitLabelRecord[] = [];
  private recordCount = 0;
  private width = 0;
  private height = 0;
  private visibleTerrainObjects = 0;
  private visibleBodies = 0;
  private visibleEquipment = 0;
  private visibleEscapeVisuals = 0;
  private culledSoldiers = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: Camera,
    private readonly battlefield: Battlefield,
  ) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas 2D is unavailable");
    this.context = context;
    this.roughPolygons = battlefield.rough.map((patch) => {
      const points: Vec2[] = [];
      for (let index = 0; index < 12; index += 1) {
        const angle = index / 12 * Math.PI * 2;
        const radius = patch.radius * (0.83 + Math.sin(index * 4.7 + patch.x) * 0.12);
        points.push({
          x: patch.x + Math.cos(angle) * radius,
          y: patch.y + Math.sin(angle) * radius,
        });
      }
      return points;
    });
    this.colourBands = Array.from({ length: 16 }, (_, index) => {
      const centreX = (index * 389) % WORLD_WIDTH;
      const centreY = (index * 647) % WORLD_HEIGHT;
      const radiusX = 230 + index * 7;
      const radiusY = 100 + index % 3 * 28;
      return Array.from({ length: 14 }, (__, pointIndex) => {
        const angle = pointIndex / 14 * Math.PI * 2;
        return {
          x: centreX + Math.cos(angle) * radiusX,
          y: centreY + Math.sin(angle) * radiusY,
        };
      });
    });
    for (let x = -20; x <= WORLD_WIDTH + 20; x += 18) {
      this.streamPoints.push({ x, y: battlefield.streamY(x) });
    }
    const waterSegments = buildWaterSegments(battlefield);
    this.deepStreamSegments.push(...waterSegments.deep);
    this.shallowStreamSegments.push(...waterSegments.shallow);
  }

  render(
    units: Unit[],
    standards: BattleStandard[],
    routEscapeVisuals: RoutEscapeVisual[],
    discardedEquipment: DiscardedEquipment[],
    bodies: FallenBody[],
    effects: BattleEffect[],
    drag: DragVisual,
    time: number,
    debug = false,
    terrainOverlay = false,
  ): RenderStats {
    const renderStarted = performance.now();
    this.resize();
    const ctx = this.context;
    const ratio = this.canvas.width / this.width;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = "#182016";
    ctx.fillRect(0, 0, this.width, this.height);

    this.visibleTerrainObjects = 0;
    this.visibleBodies = 0;
    this.visibleEquipment = 0;
    this.visibleEscapeVisuals = 0;
    this.culledSoldiers = 0;
    this.drawGround(ctx, debug);
    if (terrainOverlay) this.drawTerrainOverlay(ctx);
    this.drawStandardAuras(ctx, standards);
    this.drawSelectionFootprints(ctx, units, time);
    this.drawSelectedRoutes(ctx, units);
    if (drag.orderStart && drag.orderEnd) this.drawOrderPreview(ctx, drag.orderStart, drag.orderEnd, units);
    this.collectDepthRecords(
      units,
      standards,
      routEscapeVisuals,
      discardedEquipment,
      bodies,
      effects,
    );
    this.activeRecords.length = this.recordCount;
    this.activeRecords.sort((a, b) => a.depth - b.depth || a.kind - b.kind);
    for (let index = 0; index < this.recordCount; index += 1) {
      const record = this.activeRecords[index];
      if (record) this.drawRecord(ctx, record, time);
    }
    if (drag.selectionStart && drag.selectionEnd) {
      this.drawSelectionRectangle(ctx, drag.selectionStart, drag.selectionEnd);
    }
    this.drawUnitLabels(ctx, units, time);

    return {
      visibleSoldiers: this.recordCountSoldiers(),
      culledSoldiers: this.culledSoldiers,
      visibleTerrainObjects: this.visibleTerrainObjects,
      visibleBodies: this.visibleBodies,
      visibleEquipment: this.visibleEquipment,
      visibleEscapeVisuals: this.visibleEscapeVisuals,
      renderTimeMs: performance.now() - renderStarted,
    };
  }

  private resize(): void {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(1, this.canvas.clientWidth);
    this.height = Math.max(1, this.canvas.clientHeight);
    const pixelWidth = Math.floor(this.width * ratio);
    const pixelHeight = Math.floor(this.height * ratio);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
  }

  private project(worldX: number, worldY: number): Vec2 {
    return this.camera.worldToScreenInto(worldX, worldY, this.width, this.height, this.screenScratch);
  }

  private drawSelectedRoutes(ctx: CanvasRenderingContext2D, units: Unit[]): void {
    ctx.save();
    ctx.strokeStyle = "rgba(238, 202, 112, .86)";
    ctx.fillStyle = "#f1d17d";
    ctx.lineWidth = 2;
    ctx.setLineDash([9, 7]);
    for (const unit of units) {
      const route = unit.selected ? unit.order.route : undefined;
      if (!route || route.length === 0) continue;
      const startIndex = Math.max(0, unit.order.routeIndex ?? 0);
      const start = { ...this.project(unit.position.x, unit.position.y) };
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      for (let index = startIndex; index < route.length; index += 1) {
        const point = route[index];
        if (!point) continue;
        const screen = this.project(point.x, point.y);
        ctx.lineTo(screen.x, screen.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      for (let index = startIndex; index < route.length; index += 1) {
        const point = route[index];
        if (!point) continue;
        const screen = this.project(point.x, point.y);
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.setLineDash([9, 7]);
    }
    ctx.restore();
  }

  private drawGround(ctx: CanvasRenderingContext2D, debug: boolean): void {
    ctx.save();
    this.beginWorldPolygon(ctx, [
      { x: 0, y: 0 },
      { x: WORLD_WIDTH, y: 0 },
      { x: WORLD_WIDTH, y: WORLD_HEIGHT },
      { x: 0, y: WORLD_HEIGHT },
    ]);
    ctx.fillStyle = "#587544";
    ctx.fill();
    ctx.clip();

    for (let index = 0; index < this.colourBands.length; index += 1) {
      const polygon = this.colourBands[index];
      if (!polygon) continue;
      this.beginWorldPolygon(ctx, polygon);
      ctx.fillStyle = index % 2 ? "rgba(137,158,85,.10)" : "rgba(35,67,32,.11)";
      ctx.fill();
    }

    for (let index = 0; index < this.roughPolygons.length; index += 1) {
      const polygon = this.roughPolygons[index];
      const patch = this.battlefield.rough[index];
      if (!polygon || !patch) continue;
      this.beginWorldPolygon(ctx, polygon);
      ctx.fillStyle = patch.tone > 0.5 ? "rgba(75,84,43,.55)" : "rgba(104,105,52,.48)";
      ctx.fill();
      ctx.strokeStyle = "rgba(52,59,34,.35)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    this.strokeWorldPath(ctx, this.battlefield.road, "#796946", 62);
    this.strokeWorldPath(ctx, this.battlefield.road, "#ad9461", 47);
    this.strokeWorldPath(ctx, this.battlefield.road, "rgba(69,55,34,.33)", 3);
    this.strokeWorldPath(ctx, this.streamPoints, "#294650", 67);
    for (const segment of this.deepStreamSegments) {
      this.strokeWorldPath(ctx, segment, "#315c70", 52);
    }
    for (const segment of this.shallowStreamSegments) {
      this.strokeWorldPath(ctx, segment, "#73958d", 52);
    }
    this.strokeWorldPath(ctx, this.streamPoints, "rgba(191,218,204,.28)", 5);
    this.drawBridge(ctx);
    this.drawGroundDecorations(ctx);
    if (debug) this.drawDebugGrid(ctx);
    ctx.restore();

    this.beginWorldPolygon(ctx, [
      { x: 0, y: 0 },
      { x: WORLD_WIDTH, y: 0 },
      { x: WORLD_WIDTH, y: WORLD_HEIGHT },
      { x: 0, y: WORLD_HEIGHT },
    ]);
    ctx.strokeStyle = "#2d3825";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  private drawTerrainOverlay(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    this.beginWorldPolygon(ctx, [
      { x: 0, y: 0 },
      { x: WORLD_WIDTH, y: 0 },
      { x: WORLD_WIDTH, y: WORLD_HEIGHT },
      { x: 0, y: WORLD_HEIGHT },
    ]);
    ctx.fillStyle = "rgba(173,194,115,.12)";
    ctx.fill();
    ctx.clip();

    this.strokeWorldPath(ctx, this.battlefield.road, "rgba(214,179,99,.56)", 68);
    for (const patch of this.battlefield.rough) {
      this.beginWorldCircle(ctx, patch.x, patch.y, patch.radius);
      ctx.fillStyle = "rgba(190,129,66,.36)";
      ctx.fill();
      ctx.strokeStyle = "rgba(244,174,91,.72)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    for (const tree of this.battlefield.trees) {
      this.beginWorldCircle(ctx, tree.x, tree.y, 38 + tree.size);
      ctx.fillStyle = "rgba(53,112,59,.32)";
      ctx.fill();
      ctx.strokeStyle = "rgba(103,181,96,.62)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    for (const segment of this.deepStreamSegments) {
      this.strokeWorldPath(ctx, segment, "rgba(32,71,118,.78)", 54);
    }
    for (const segment of this.shallowStreamSegments) {
      this.strokeWorldPath(ctx, segment, "rgba(89,188,190,.72)", 54);
    }
    ctx.restore();
  }

  private drawStandardAuras(
    ctx: CanvasRenderingContext2D,
    standards: BattleStandard[],
  ): void {
    ctx.save();
    for (const standard of standards) {
      if (standard.status !== "unit") continue;
      this.beginWorldCircle(
        ctx,
        standard.position.x,
        standard.position.y,
        STANDARD_AURA_RADIUS,
      );
      const roman = standard.faction === "roman";
      ctx.fillStyle = roman ? "rgba(214,180,93,.075)" : "rgba(144,180,204,.075)";
      ctx.strokeStyle = roman ? "rgba(230,197,111,.4)" : "rgba(157,197,221,.4)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 8]);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  private beginWorldCircle(
    ctx: CanvasRenderingContext2D,
    centreX: number,
    centreY: number,
    radius: number,
  ): void {
    ctx.beginPath();
    for (let index = 0; index < 24; index += 1) {
      const angle = index / 24 * Math.PI * 2;
      const screen = this.project(
        centreX + Math.cos(angle) * radius,
        centreY + Math.sin(angle) * radius,
      );
      if (index === 0) ctx.moveTo(screen.x, screen.y);
      else ctx.lineTo(screen.x, screen.y);
    }
    ctx.closePath();
  }

  private beginWorldPolygon(ctx: CanvasRenderingContext2D, points: readonly Vec2[]): void {
    const first = points[0];
    if (!first) return;
    let screen = this.project(first.x, first.y);
    ctx.beginPath();
    ctx.moveTo(screen.x, screen.y);
    for (let index = 1; index < points.length; index += 1) {
      const point = points[index];
      if (!point) continue;
      screen = this.project(point.x, point.y);
      ctx.lineTo(screen.x, screen.y);
    }
    ctx.closePath();
  }

  private strokeWorldPath(
    ctx: CanvasRenderingContext2D,
    points: readonly Vec2[],
    colour: string,
    worldWidth: number,
  ): void {
    const first = points[0];
    if (!first) return;
    let screen = this.project(first.x, first.y);
    ctx.beginPath();
    ctx.moveTo(screen.x, screen.y);
    for (let index = 1; index < points.length; index += 1) {
      const point = points[index];
      if (!point) continue;
      screen = this.project(point.x, point.y);
      ctx.lineTo(screen.x, screen.y);
    }
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(1, worldWidth * this.camera.zoom * 0.42);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }

  private drawBridge(ctx: CanvasRenderingContext2D): void {
    const centreY = this.battlefield.streamY(BRIDGE_CENTRE_X);
    const startX = BRIDGE_CENTRE_X - BRIDGE_HALF_LENGTH;
    const endX = BRIDGE_CENTRE_X + BRIDGE_HALF_LENGTH;
    const corners = [
      { x: startX, y: centreY - 45 },
      { x: endX, y: centreY - 45 },
      { x: endX, y: centreY + 45 },
      { x: startX, y: centreY + 45 },
    ];
    this.beginWorldPolygon(ctx, corners);
    ctx.fillStyle = "#8f754b";
    ctx.fill();
    ctx.strokeStyle = "#604d34";
    ctx.lineWidth = 2;
    ctx.stroke();
    for (let x = startX + 10; x < endX - 5; x += 18) {
      const start = { ...this.project(x, centreY - 42) };
      const end = { ...this.project(x, centreY + 42) };
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.strokeStyle = x % 36 ? "#b3935c" : "#765f3d";
      ctx.lineWidth = Math.max(1, this.camera.zoom * 4);
      ctx.stroke();
    }
  }

  private drawGroundDecorations(ctx: CanvasRenderingContext2D): void {
    ctx.lineCap = "round";
    for (const grass of this.battlefield.grass) {
      const screen = this.project(grass.x, grass.y);
      if (!this.isVisible(screen.x, screen.y, 8)) continue;
      this.visibleTerrainObjects += 1;
      const size = Math.max(1.5, grass.size * this.camera.zoom);
      ctx.strokeStyle = "rgba(48,82,38,.58)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(screen.x, screen.y);
      ctx.lineTo(screen.x - size, screen.y - size * 1.6);
      ctx.moveTo(screen.x, screen.y);
      ctx.lineTo(screen.x + size * .7, screen.y - size * 1.8);
      ctx.stroke();
    }
    for (const flower of this.battlefield.flowers) {
      const screen = this.project(flower.x, flower.y);
      if (!this.isVisible(screen.x, screen.y, 6)) continue;
      this.visibleTerrainObjects += 1;
      ctx.fillStyle = flower.rotation > Math.PI ? "#d2c58a" : "#b7c6d5";
      ctx.beginPath();
      ctx.arc(screen.x, screen.y - 2, Math.max(1, flower.size * this.camera.zoom), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawDebugGrid(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = "rgba(235,224,177,.16)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= WORLD_WIDTH; x += 200) {
      const start = { ...this.project(x, 0) };
      const end = { ...this.project(x, WORLD_HEIGHT) };
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
    for (let y = 0; y <= WORLD_HEIGHT; y += 200) {
      const start = { ...this.project(0, y) };
      const end = { ...this.project(WORLD_WIDTH, y) };
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
  }

  private drawSelectionFootprints(
    ctx: CanvasRenderingContext2D,
    units: Unit[],
    time: number,
  ): void {
    for (const unit of units) {
      if (isUnitInactive(unit)) continue;
      const attackFlash = unit.attackCommandFlashTimer > 0 &&
        Math.floor(time * 12) % 2 === 0;
      if (!unit.selected && !attackFlash) continue;
      this.beginFormationFootprint(ctx, unit.position, unit.facing, unit.formationWidth + 20, unit.formationDepth + 22);
      ctx.fillStyle = attackFlash
        ? "rgba(197,43,40,.14)"
        : "rgba(244,219,137,.10)";
      ctx.strokeStyle = attackFlash
        ? "rgba(255,68,61,.96)"
        : "rgba(244,219,137,.82)";
      ctx.lineWidth = attackFlash ? 3 : 2;
      ctx.setLineDash(attackFlash ? [4, 3] : [7, 5]);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private beginFormationFootprint(
    ctx: CanvasRenderingContext2D,
    position: Vec2,
    facing: number,
    width: number,
    depth: number,
  ): void {
    const cos = Math.cos(facing);
    const sin = Math.sin(facing);
    const halfW = width * 0.5;
    const halfD = depth * 0.5;
    const localCorners = [
      { x: -halfW, y: -halfD },
      { x: halfW, y: -halfD },
      { x: halfW, y: halfD },
      { x: -halfW, y: halfD },
    ];
    ctx.beginPath();
    for (let index = 0; index < localCorners.length; index += 1) {
      const corner = localCorners[index];
      if (!corner) continue;
      const worldX = position.x + corner.x * cos - corner.y * sin;
      const worldY = position.y + corner.x * sin + corner.y * cos;
      const screen = this.project(worldX, worldY);
      if (index === 0) ctx.moveTo(screen.x, screen.y);
      else ctx.lineTo(screen.x, screen.y);
    }
    ctx.closePath();
  }

  private collectDepthRecords(
    units: Unit[],
    standards: BattleStandard[],
    routEscapeVisuals: RoutEscapeVisual[],
    discardedEquipment: DiscardedEquipment[],
    bodies: FallenBody[],
    effects: BattleEffect[],
  ): void {
    this.recordCount = 0;
    for (const equipment of discardedEquipment) {
      const screen = this.project(equipment.x, equipment.y);
      if (!this.isVisible(screen.x, screen.y, 18)) continue;
      this.visibleEquipment += 1;
      const record = this.nextRecord(EQUIPMENT);
      record.screenX = screen.x;
      record.screenY = screen.y;
      record.depth = getProjectedDepth(equipment.x, equipment.y);
      record.equipment = equipment;
    }
    for (const visual of routEscapeVisuals) {
      const screen = this.project(visual.x, visual.y);
      if (!this.isVisible(screen.x, screen.y, 22)) continue;
      this.visibleEscapeVisuals += 1;
      const record = this.nextRecord(ROUT_ESCAPE);
      record.screenX = screen.x;
      record.screenY = screen.y;
      record.depth = getProjectedDepth(visual.x, visual.y) + 0.0001;
      record.routEscape = visual;
    }
    for (const rock of this.battlefield.rocks) {
      const screen = this.project(rock.x, rock.y);
      if (!this.isVisible(screen.x, screen.y, 30)) continue;
      this.visibleTerrainObjects += 1;
      const record = this.nextRecord(ROCK);
      record.screenX = screen.x;
      record.screenY = screen.y;
      record.depth = getProjectedDepth(rock.x, rock.y);
      record.decoration = rock;
    }
    for (const tree of this.battlefield.trees) {
      const screen = this.project(tree.x, tree.y);
      if (!this.isVisible(screen.x, screen.y, 70)) continue;
      this.visibleTerrainObjects += 1;
      const record = this.nextRecord(TREE);
      record.screenX = screen.x;
      record.screenY = screen.y;
      record.depth = getProjectedDepth(tree.x, tree.y);
      record.decoration = tree;
    }
    for (const body of bodies) {
      const screen = this.project(body.x, body.y);
      if (!this.isVisible(screen.x, screen.y, 22)) continue;
      this.visibleBodies += 1;
      const record = this.nextRecord(BODY);
      record.screenX = screen.x;
      record.screenY = screen.y;
      record.depth = getProjectedDepth(body.x, body.y);
      record.body = body;
    }
    for (const unit of units) {
      if (isUnitInactive(unit)) continue;
      const cos = Math.cos(unit.facing);
      const sin = Math.sin(unit.facing);
      const forward = worldVectorToScreen(Math.sin(unit.facing), -Math.cos(unit.facing));
      const screenAngle = Math.atan2(forward.y, forward.x);
      const direction = (Math.round((screenAngle + Math.PI * 2) / (Math.PI / 4)) + 8) % 8;
      for (let index = 0; index < unit.soldierCount; index += 1) {
        const soldier = unit.soldiers[index];
        if (!soldier) continue;
        const worldX = unit.position.x + soldier.x * cos - soldier.y * sin;
        const worldY = unit.position.y + soldier.x * sin + soldier.y * cos;
        const screen = this.project(worldX, worldY);
        if (!this.isVisible(screen.x, screen.y, 22)) {
          this.culledSoldiers += 1;
          continue;
        }
        const record = this.nextRecord(SOLDIER);
        record.screenX = screen.x;
        record.screenY = screen.y;
        record.depth = getProjectedDepth(worldX, worldY) + index * 0.00001;
        record.unit = unit;
        record.soldierIndex = index;
        record.direction = direction;
      }
    }
    for (const standard of standards) {
      if (standard.status === "escaped") continue;
      const standardScreen = this.project(standard.position.x, standard.position.y);
      if (!this.isVisible(standardScreen.x, standardScreen.y, 80)) continue;
      const record = this.nextRecord(STANDARD);
      record.screenX = standardScreen.x;
      record.screenY = standardScreen.y;
      record.depth = getProjectedDepth(standard.position.x, standard.position.y) + 0.01;
      record.standard = standard;
    }
    for (const effect of effects) {
      const screen = this.project(effect.x, effect.y);
      if (!this.isVisible(screen.x, screen.y, 30)) continue;
      const record = this.nextRecord(EFFECT);
      record.screenX = screen.x;
      record.screenY = screen.y;
      record.depth = getProjectedDepth(effect.x, effect.y) + 0.02;
      record.effect = effect;
    }
  }

  private nextRecord(kind: number): RenderRecord {
    let record = this.renderPool[this.recordCount];
    if (!record) {
      record = { kind, depth: 0, screenX: 0, screenY: 0, soldierIndex: 0, direction: 0 };
      this.renderPool.push(record);
    }
    record.kind = kind;
    record.unit = undefined;
    record.decoration = undefined;
    record.effect = undefined;
    record.body = undefined;
    record.standard = undefined;
    record.routEscape = undefined;
    record.equipment = undefined;
    this.activeRecords[this.recordCount] = record;
    this.recordCount += 1;
    return record;
  }

  private drawRecord(ctx: CanvasRenderingContext2D, record: RenderRecord, time: number): void {
    if (record.kind === BODY && record.body) this.drawBody(ctx, record);
    else if (record.kind === EQUIPMENT && record.equipment) this.drawEquipment(ctx, record);
    else if (record.kind === ROUT_ESCAPE && record.routEscape) this.drawRoutEscape(ctx, record, time);
    else if (record.kind === SOLDIER && record.unit) this.drawSoldier(ctx, record, time);
    else if (record.kind === ROCK && record.decoration) this.drawRock(ctx, record);
    else if (record.kind === TREE && record.decoration) this.drawTree(ctx, record);
    else if (record.kind === STANDARD && record.standard) this.drawStandardMarker(ctx, record);
    else if (record.kind === EFFECT && record.effect) this.drawEffect(ctx, record);
  }

  private drawBody(ctx: CanvasRenderingContext2D, record: RenderRecord): void {
    const body = record.body;
    if (!body) return;
    const style = FACTION_STYLE[body.faction];
    const direction = worldVectorToScreen(Math.cos(body.facing), Math.sin(body.facing));
    const angle = Math.atan2(direction.y, direction.x);
    const scale = clamp(this.camera.zoom, 0.62, 1.45);
    ctx.save();
    ctx.translate(record.screenX, record.screenY + 1);
    ctx.rotate(angle);
    ctx.fillStyle = "rgba(23,21,17,.28)";
    ctx.beginPath();
    ctx.ellipse(1.5 * scale, 1.5 * scale, 7 * scale, 2.5 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = style.dark;
    ctx.fillRect(-4.8 * scale, -1.8 * scale, 9 * scale, 3.6 * scale);
    ctx.fillStyle = style.primary;
    ctx.fillRect(-3.8 * scale, -1.2 * scale, 6.8 * scale, 2.4 * scale);
    ctx.fillStyle = "#aa8062";
    ctx.beginPath();
    ctx.arc(4.3 * scale, 0, 1.8 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(45,35,25,.72)";
    ctx.lineWidth = Math.max(1, scale * .8);
    const limb = Math.sin(body.phase) > 0 ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(-2 * scale, 0);
    ctx.lineTo(-6 * scale, limb * 3 * scale);
    ctx.moveTo(1 * scale, 0);
    ctx.lineTo(-2 * scale, -limb * 3.5 * scale);
    ctx.stroke();
    ctx.restore();
  }

  private drawEquipment(ctx: CanvasRenderingContext2D, record: RenderRecord): void {
    const equipment = record.equipment;
    if (!equipment) return;
    const style = FACTION_STYLE[equipment.faction];
    const scale = clamp(this.camera.zoom, 0.62, 1.35);
    ctx.save();
    ctx.translate(record.screenX, record.screenY + 1);
    ctx.rotate(equipment.rotation);
    if (equipment.kind === "shield") {
      ctx.fillStyle = style.detail;
      ctx.strokeStyle = style.dark;
      ctx.lineWidth = Math.max(1, scale);
      ctx.beginPath();
      ctx.ellipse(0, 0, 4 * scale, 2.4 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.strokeStyle = "#4b3825";
      ctx.lineWidth = Math.max(1, scale);
      ctx.beginPath();
      ctx.moveTo(-6 * scale, 0);
      ctx.lineTo(6 * scale, 0);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawRoutEscape(
    ctx: CanvasRenderingContext2D,
    record: RenderRecord,
    time: number,
  ): void {
    const visual = record.routEscape;
    if (!visual) return;
    const style = FACTION_STYLE[visual.faction];
    const scale = clamp(this.camera.zoom * 1.05, 0.58, 1.35);
    const screenDirection = worldVectorToScreen(visual.directionX, visual.directionY);
    const direction = Math.atan2(screenDirection.y, screenDirection.x);
    const swimming = this.battlefield.isInWaterBand(visual);
    ctx.save();
    ctx.translate(record.screenX, record.screenY);
    if (swimming) {
      ctx.rotate(direction);
      ctx.strokeStyle = "rgba(206,225,216,.38)";
      ctx.lineWidth = Math.max(1, scale);
      ctx.beginPath();
      ctx.moveTo(-7 * scale, 2 * scale);
      ctx.lineTo(5 * scale, 2 * scale);
      ctx.stroke();
      ctx.fillStyle = style.primary;
      ctx.fillRect(-4.5 * scale, -1.8 * scale, 8 * scale, 3.6 * scale);
      ctx.fillStyle = "#c89b72";
      ctx.beginPath();
      ctx.arc(4.4 * scale, 0, 1.8 * scale, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const bob = Math.sin(time * 9 + visual.phase) * 0.6;
      ctx.translate(0, bob);
      ctx.fillStyle = "rgba(21,29,19,.24)";
      ctx.beginPath();
      ctx.ellipse(0, 1, 3.8 * scale, 1.3 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = style.dark;
      ctx.lineWidth = Math.max(1, scale);
      ctx.beginPath();
      ctx.moveTo(-1.5 * scale, -1 * scale);
      ctx.lineTo(-3 * scale, 3 * scale);
      ctx.moveTo(1.5 * scale, -1 * scale);
      ctx.lineTo(3 * scale, 3 * scale);
      ctx.stroke();
      ctx.fillStyle = style.primary;
      ctx.fillRect(-2.5 * scale, -8 * scale, 5 * scale, 7 * scale);
      ctx.fillStyle = "#c89b72";
      ctx.beginPath();
      ctx.arc(0, -10 * scale, 1.8 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawSoldier(ctx: CanvasRenderingContext2D, record: RenderRecord, time: number): void {
    const unit = record.unit;
    if (!unit) return;
    const soldier = unit.soldiers[record.soldierIndex];
    if (!soldier) return;
    const style = FACTION_STYLE[unit.faction];
    const direction = record.direction;
    const side = direction <= 2 || direction >= 7 ? 1 : -1;
    const profile = direction % 4 === 0 ? 0.72 : direction % 2 === 0 ? 1 : 0.86;
    const scale = clamp(this.camera.zoom * 1.18, 0.58, 1.55);
    const bob = unit.velocity > 2 ? Math.sin(time * 8 + soldier.phase) * 0.6 : 0;
    const disorderLean = unit.state === "routing" ? Math.sin(soldier.phase * 3.7) * 0.18 : 0;
    const x = record.screenX;
    const y = record.screenY + bob;
    const overheadTortoiseShield = unit.formation === "tortoise" &&
      soldier.baseY > -unit.formationDepth * 0.5 + 10;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(disorderLean);
    if (unit.type === "cavalry") {
      ctx.fillStyle = "#5b4430";
      ctx.beginPath();
      ctx.ellipse(0, -2 * scale, 5.2 * scale, 3.1 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-3.5 * scale, -1 * scale, 1.2 * scale, 5 * scale);
      ctx.fillRect(2.4 * scale, -1 * scale, 1.2 * scale, 5 * scale);
    }
    ctx.strokeStyle = "#32261d";
    ctx.lineWidth = Math.max(1, scale);
    ctx.beginPath();
    if (unit.type === "archers") {
      ctx.arc(side * 3.4 * scale, -7 * scale, 4.2 * scale, -Math.PI * .55, Math.PI * .55);
      ctx.moveTo(side * 3.4 * scale, -11.2 * scale);
      ctx.lineTo(side * 3.4 * scale, -2.8 * scale);
    } else {
      ctx.moveTo(side * 3.2 * scale, -3 * scale);
      ctx.lineTo(side * 4.2 * scale, -13 * scale);
    }
    ctx.stroke();
    ctx.fillStyle = style.dark;
    ctx.fillRect(-2.8 * profile * scale, -9 * scale, 5.6 * profile * scale, 8 * scale);
    ctx.fillStyle = style.primary;
    ctx.beginPath();
    ctx.moveTo(-3.1 * profile * scale, -9 * scale);
    ctx.lineTo(3.1 * profile * scale, -9 * scale);
    ctx.lineTo(2.1 * profile * scale, -1 * scale);
    ctx.lineTo(-2.1 * profile * scale, -1 * scale);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#c89b72";
    ctx.beginPath();
    ctx.arc(side * 0.35 * scale, -11 * scale, 2 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = style.detail;
    if (unit.type === "archers") {
      // Archers trade shield protection for a clearly readable bow silhouette.
    } else if (unit.faction === "roman" && overheadTortoiseShield) {
      ctx.fillStyle = style.detail;
      ctx.strokeStyle = style.dark;
      ctx.lineWidth = Math.max(1, scale);
      ctx.fillRect(-4.2 * scale, -18 * scale, 8.4 * scale, 8.4 * scale);
      ctx.strokeRect(-4.2 * scale, -18 * scale, 8.4 * scale, 8.4 * scale);
      ctx.fillStyle = "rgba(255,240,190,.2)";
      ctx.fillRect(-3.5 * scale, -17.2 * scale, 7 * scale, .8 * scale);
    } else if (unit.faction === "roman" && unit.formation === "tortoise") {
      const shieldX = -side * 5.4 * scale - (side < 0 ? 5.4 * scale : 0);
      ctx.fillRect(shieldX, -7.5 * scale, 5.4 * scale, 5.4 * scale);
      ctx.strokeStyle = style.dark;
      ctx.strokeRect(shieldX, -7.5 * scale, 5.4 * scale, 5.4 * scale);
    } else if (unit.faction === "roman") {
      ctx.fillRect(-side * 5.2 * scale - (side < 0 ? 2.8 * scale : 0), -8 * scale, 2.8 * scale, 6.4 * scale);
      ctx.strokeStyle = style.dark;
      ctx.strokeRect(-side * 5.2 * scale - (side < 0 ? 2.8 * scale : 0), -8 * scale, 2.8 * scale, 6.4 * scale);
    } else {
      ctx.beginPath();
      ctx.arc(-side * 3.8 * scale, -5 * scale, 3 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = style.primary;
      ctx.beginPath();
      ctx.arc(-side * 3.8 * scale, -5 * scale, 1.25 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(21,29,19,.25)";
    ctx.beginPath();
    ctx.ellipse(0, 1, 4.2 * scale, 1.5 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawRock(ctx: CanvasRenderingContext2D, record: RenderRecord): void {
    const rock = record.decoration;
    if (!rock) return;
    const size = Math.max(3, rock.size * this.camera.zoom * 0.9);
    ctx.save();
    ctx.translate(record.screenX, record.screenY);
    ctx.fillStyle = "#77796b";
    ctx.beginPath();
    ctx.moveTo(-size, 0);
    ctx.lineTo(-size * .45, -size * 1.2);
    ctx.lineTo(size * .55, -size * 1.45);
    ctx.lineTo(size, -.15 * size);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#4a4e46";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = "rgba(26,31,23,.22)";
    ctx.beginPath();
    ctx.ellipse(size * .35, size * .25, size, size * .35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawTree(ctx: CanvasRenderingContext2D, record: RenderRecord): void {
    const tree = record.decoration;
    if (!tree) return;
    const size = Math.max(8, tree.size * this.camera.zoom * 1.25);
    ctx.save();
    ctx.translate(record.screenX, record.screenY);
    ctx.fillStyle = "rgba(22,29,18,.24)";
    ctx.beginPath();
    ctx.ellipse(size * .45, size * .15, size * .9, size * .28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#59432e";
    ctx.fillRect(-size * .12, -size * 1.25, size * .24, size * 1.3);
    ctx.fillStyle = "#294522";
    ctx.beginPath();
    for (let index = 0; index < 7; index += 1) {
      const angle = tree.rotation + index / 7 * Math.PI * 2;
      const x = Math.cos(angle) * size;
      const y = -size * 1.55 + Math.sin(angle) * size * .72;
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#193318";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "rgba(119,145,70,.22)";
    ctx.beginPath();
    ctx.ellipse(-size * .2, -size * 1.85, size * .45, size * .22, -.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawStandardMarker(ctx: CanvasRenderingContext2D, record: RenderRecord): void {
    const standard = record.standard;
    if (!standard) return;
    drawBattleStandardScreen(ctx, standard, record.screenX, record.screenY);
  }

  private drawUnitLabels(
    ctx: CanvasRenderingContext2D,
    units: Unit[],
    time: number,
  ): void {
    let count = 0;
    for (const unit of units) {
      if (isUnitInactive(unit) || unit.soldierCount <= 0) continue;
      const anchor = this.project(unit.position.x, unit.position.y);
      if (!this.isVisible(anchor.x, anchor.y, 80)) continue;
      const activity = getUnitActivityStatus(unit);
      let label = this.labelPool[count];
      if (!label) {
        label = {
          id: unit.id,
          desiredX: 0,
          desiredTop: 0,
          x: 0,
          top: 0,
          width: 76,
          height: 37,
          anchorX: 0,
          anchorY: 0,
        };
        this.labelPool.push(label);
      }
      label.id = unit.id;
      label.unit = unit;
      label.anchorX = anchor.x;
      label.anchorY = anchor.y;
      label.desiredX = anchor.x;
      label.desiredTop = anchor.y - 49;
      label.width = 68;
      label.height = activity === "idle" ? 31 : 37;
      count += 1;
    }
    this.labelPool.length = count;
    resolveUnitLabelPlacements(this.labelPool, count, this.width, this.height);

    ctx.strokeStyle = "rgba(25,29,23,.82)";
    ctx.lineWidth = 1;
    for (let index = 0; index < count; index += 1) {
      const label = this.labelPool[index];
      if (!label) continue;
      if (
        Math.abs(label.x - label.desiredX) < 1 &&
        Math.abs(label.top - label.desiredTop) < 1
      ) continue;
      ctx.beginPath();
      ctx.moveTo(label.anchorX, label.anchorY - 2);
      ctx.lineTo(label.x, label.top + label.height);
      ctx.stroke();
    }
    for (let index = 0; index < count; index += 1) {
      const label = this.labelPool[index];
      if (label?.unit) this.drawUnitLabel(ctx, label.unit, label.x, label.top, time);
    }
  }

  private drawUnitLabel(
    ctx: CanvasRenderingContext2D,
    unit: Unit,
    x: number,
    top: number,
    time: number,
  ): void {
    const tacticalStyle = TACTICAL_STATE_STYLE[unit.tacticalState];
    const attackFlash = unit.attackCommandFlashTimer > 0 &&
      Math.floor(time * 12) % 2 === 0;
    ctx.fillStyle = tacticalStyle.fill;
    ctx.fillRect(x - 30, top, 60, 13);
    ctx.strokeStyle = attackFlash ? "#ff443d" : tacticalStyle.border;
    ctx.lineWidth = attackFlash ? 2.5 : 1.5;
    ctx.strokeRect(x - 30, top, 60, 13);
    ctx.fillStyle = tacticalStyle.text;
    ctx.font = "700 9px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${unit.id}  ${unit.soldierCount}`, x, top + 10);
    ctx.fillStyle = "#252a23";
    ctx.fillRect(x - 29, top + 15, 58, 3);
    ctx.fillStyle = unit.morale > 48 ? "#aeb56d" : unit.morale > 22 ? "#c5944b" : "#9f4b40";
    ctx.fillRect(x - 29, top + 15, 58 * clamp(unit.morale / 100, 0, 1), 3);
    const activity = getUnitActivityStatus(unit);
    const statusStyle = unit.state === "routing"
      ? UNIT_STATUS_STYLE.pressed
      : UNIT_STATUS_STYLE[activity];
    const activityText = getUnitActivityText(activity);
    const moraleText = getUnitMoraleStatus(unit);
    const twoLines = activity !== "idle";
    ctx.font = "800 7px Inter, sans-serif";
    const statusWidth = clamp(
      Math.max(ctx.measureText(activityText).width, ctx.measureText(moraleText).width) + 9,
      48,
      76,
    );
    const statusHeight = twoLines ? 16 : 10;
    const statusTop = top + 21;
    ctx.fillStyle = statusStyle.fill;
    ctx.fillRect(x - statusWidth * .5, statusTop, statusWidth, statusHeight);
    ctx.strokeStyle = statusStyle.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(x - statusWidth * .5, statusTop, statusWidth, statusHeight);
    ctx.fillStyle = statusStyle.text;
    if (twoLines) {
      ctx.fillText(activityText, x, statusTop + 7);
      ctx.fillText(moraleText, x, statusTop + 14);
    } else {
      ctx.fillText(moraleText, x, statusTop + 7);
    }
  }

  private drawEffect(ctx: CanvasRenderingContext2D, record: RenderRecord): void {
    const effect = record.effect;
    if (!effect) return;
    const alpha = clamp(effect.life / .85, 0, 1);
    const rise = (1 - alpha) * 18;
    const x = record.screenX;
    const y = record.screenY - rise;
    if (effect.label) {
      ctx.strokeStyle = `rgba(24,17,13,${alpha * .95})`;
      ctx.lineWidth = 4;
      ctx.fillStyle = `rgba(238,79,67,${alpha})`;
      ctx.font = "900 16px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.strokeText(effect.label, x, y - 12);
      ctx.fillText(effect.label, x, y - 12);
      return;
    }
    if (effect.ranged && effect.sourceX !== undefined && effect.sourceY !== undefined) {
      const source = this.project(effect.sourceX, effect.sourceY);
      const progress = 1 - clamp(effect.life / 1.05, 0, 1);
      const arrowX = source.x + (x - source.x) * progress;
      const arrowY = source.y + (y - source.y) * progress;
      const length = Math.max(1, Math.hypot(x - source.x, y - source.y));
      const dx = (x - source.x) / length;
      const dy = (y - source.y) / length;
      ctx.strokeStyle = `rgba(245,224,171,${Math.max(.28, alpha)})`;
      ctx.lineWidth = 1.6;
      for (let arrow = -2; arrow <= 2; arrow += 1) {
        const spread = arrow * 3.2;
        ctx.beginPath();
        ctx.moveTo(arrowX - dx * 8 - dy * spread, arrowY - dy * 8 + dx * spread);
        ctx.lineTo(arrowX + dx * 3 - dy * spread, arrowY + dy * 3 + dx * spread);
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = `rgba(255,217,133,${alpha})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x - 8, y - 8);
      ctx.lineTo(x + 8, y + 8);
      ctx.moveTo(x + 8, y - 8);
      ctx.lineTo(x - 8, y + 8);
      ctx.stroke();
    }
    if (effect.amount !== undefined) {
      const damageText = effect.amount > 0
        ? `−${effect.amount}${effect.charge ? "!" : ""}`
        : "BLOCKED";
      ctx.font = effect.charge
        ? "900 19px Inter, sans-serif"
        : effect.amount > 0 ? "900 16px Inter, sans-serif" : "900 11px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.strokeStyle = `rgba(25,18,13,${alpha * .98})`;
      ctx.lineWidth = effect.amount > 0 ? 5 : 4;
      ctx.strokeText(damageText, x, y - 13);
      ctx.fillStyle = effect.charge
        ? `rgba(255,202,91,${alpha})`
        : `rgba(255,230,190,${alpha})`;
      ctx.fillText(damageText, x, y - 13);
    }
  }

  private drawOrderPreview(ctx: CanvasRenderingContext2D, start: Vec2, end: Vec2, units: Unit[]): void {
    const selected = units.filter((unit) =>
      unit.selected && unit.state !== "routing" && unit.formationChangeTimer <= 0);
    if (selected.length === 0) return;
    const layout = calculateFormationOrderLayout(
      start,
      end,
      selected.map((unit) => ({
        frontageWidth: unit.formationWidth,
        boundaryMargin: formationRadius(unit) + 8,
      })),
      selected[0]?.facing ?? 0,
      { width: WORLD_WIDTH, height: WORLD_HEIGHT },
    );
    if (layout.dragged) {
      const startScreen = { ...this.project(start.x, start.y) };
      const endScreen = { ...this.project(end.x, end.y) };
      const midX = (startScreen.x + endScreen.x) * .5;
      const midY = (startScreen.y + endScreen.y) * .5;
      const forwardWorldX = Math.sin(layout.facing);
      const forwardWorldY = -Math.cos(layout.facing);
      const projectedForward = worldVectorToScreen(forwardWorldX, forwardWorldY);
      const length = Math.max(.001, Math.hypot(projectedForward.x, projectedForward.y));
      const forwardX = projectedForward.x / length;
      const forwardY = projectedForward.y / length;
      ctx.strokeStyle = "rgba(246,220,135,.82)";
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      ctx.moveTo(startScreen.x, startScreen.y);
      ctx.lineTo(endScreen.x, endScreen.y);
      ctx.moveTo(midX, midY);
      ctx.lineTo(midX + forwardX * 38, midY + forwardY * 38);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(246,220,135,.86)";
      ctx.beginPath();
      ctx.moveTo(midX + forwardX * 44, midY + forwardY * 44);
      ctx.lineTo(midX + forwardX * 30 - forwardY * 6, midY + forwardY * 30 + forwardX * 6);
      ctx.lineTo(midX + forwardX * 30 + forwardY * 6, midY + forwardY * 30 - forwardX * 6);
      ctx.closePath();
      ctx.fill();
    }
    for (let index = 0; index < selected.length; index += 1) {
      const unit = selected[index];
      const placement = layout.placements[index];
      if (!unit || !placement) continue;
      this.beginFormationFootprint(
        ctx,
        placement.destination,
        placement.facing,
        unit.formationWidth,
        unit.formationDepth,
      );
      ctx.fillStyle = "rgba(246,220,135,.10)";
      ctx.strokeStyle = "rgba(246,220,135,.78)";
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawSelectionRectangle(ctx: CanvasRenderingContext2D, start: Vec2, end: Vec2): void {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    ctx.fillStyle = "rgba(221,202,129,.11)";
    ctx.strokeStyle = "rgba(238,219,149,.8)";
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x + .5, y + .5, width, height);
  }

  private isVisible(x: number, y: number, margin: number): boolean {
    return x >= -margin && x <= this.width + margin && y >= -margin && y <= this.height + margin;
  }

  private recordCountSoldiers(): number {
    let count = 0;
    for (let index = 0; index < this.recordCount; index += 1) {
      if (this.activeRecords[index]?.kind === SOLDIER) count += 1;
    }
    return count;
  }
}
