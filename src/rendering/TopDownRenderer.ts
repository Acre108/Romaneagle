import type { Camera } from "../core/Camera";
import { clamp, type Vec2 } from "../core/math";
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
import type { Battlefield } from "../world/Battlefield";
import {
  BRIDGE_CENTRE_X,
  BRIDGE_HALF_LENGTH,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../world/Battlefield";
import {
  STANDARD_AURA_RADIUS,
  type BattleEffect,
  type BattleStandard,
  type DiscardedEquipment,
  type FallenBody,
  type RoutEscapeVisual,
} from "../systems/Simulation";
import type { DragVisual, RenderStats } from "./RenderTypes";
import { drawBattleStandardScreen } from "./BattleStandardVisual";
import { buildWaterSegments } from "./WaterSegments";
import {
  resolveUnitLabelPlacements,
  type UnitLabelPlacement,
} from "./UnitLabelLayout";

interface UnitLabelRecord extends UnitLabelPlacement {
  unit?: Unit;
  anchorX: number;
  anchorY: number;
}

export class TopDownRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly labelPool: UnitLabelRecord[] = [];
  private readonly deepStreamSegments: Vec2[][] = [];
  private readonly shallowStreamSegments: Vec2[][] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: Camera,
    private readonly battlefield: Battlefield,
  ) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas 2D is unavailable");
    this.context = context;
    const waterSegments = buildWaterSegments(battlefield);
    this.deepStreamSegments.push(...waterSegments.deep);
    this.shallowStreamSegments.push(...waterSegments.shallow);
  }

  resize(): void {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.floor(this.canvas.clientWidth * ratio);
    const height = Math.floor(this.canvas.clientHeight * ratio);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
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
    _debug = false,
    terrainOverlay = false,
  ): RenderStats {
    const renderStarted = performance.now();
    this.resize();
    const ctx = this.context;
    const ratio = this.canvas.width / this.canvas.clientWidth;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = "#1b2418";
    ctx.fillRect(0, 0, width, height);
    const origin = this.camera.worldToScreen({ x: 0, y: 0 }, width, height);
    ctx.setTransform(
      this.camera.zoom * ratio, 0, 0, this.camera.zoom * ratio,
      origin.x * ratio, origin.y * ratio,
    );
    this.drawTerrain(ctx);
    if (terrainOverlay) this.drawTerrainOverlay(ctx);
    this.drawStandardAuras(ctx, standards);
    this.drawSelectedRoutes(ctx, units);
    this.drawDiscardedEquipment(ctx, discardedEquipment);
    this.drawBodies(ctx, bodies);
    let visibleSoldiers = 0;
    const ordered = units.filter((unit) => !isUnitInactive(unit)).sort((a, b) => a.position.y - b.position.y);
    for (const unit of ordered) {
      visibleSoldiers += this.drawUnit(ctx, unit, time);
    }
    this.drawRoutEscapeVisuals(ctx, routEscapeVisuals, time);
    this.drawEffects(ctx, effects);
    if (drag.orderStart && drag.orderEnd) this.drawOrderPreview(ctx, drag.orderStart, drag.orderEnd, units);

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.drawBattleStandards(ctx, standards, width, height);
    if (drag.selectionStart && drag.selectionEnd) this.drawSelectionRectangle(ctx, drag.selectionStart, drag.selectionEnd);
    this.drawUnitLabels(ctx, units, width, height, time);
    return {
      visibleSoldiers,
      culledSoldiers: 0,
      visibleTerrainObjects: this.battlefield.trees.length + this.battlefield.rocks.length,
      visibleBodies: bodies.length,
      visibleEquipment: discardedEquipment.length,
      visibleEscapeVisuals: routEscapeVisuals.length,
      renderTimeMs: performance.now() - renderStarted,
    };
  }

  private drawSelectedRoutes(ctx: CanvasRenderingContext2D, units: Unit[]): void {
    ctx.save();
    ctx.strokeStyle = "rgba(238, 202, 112, .82)";
    ctx.fillStyle = "#f1d17d";
    ctx.lineWidth = 2 / this.camera.zoom;
    ctx.setLineDash([9 / this.camera.zoom, 7 / this.camera.zoom]);
    for (const unit of units) {
      const route = unit.selected ? unit.order.route : undefined;
      if (!route || route.length === 0) continue;
      const startIndex = Math.max(0, unit.order.routeIndex ?? 0);
      ctx.beginPath();
      ctx.moveTo(unit.position.x, unit.position.y);
      for (let index = startIndex; index < route.length; index += 1) {
        const point = route[index];
        if (point) ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      for (let index = startIndex; index < route.length; index += 1) {
        const point = route[index];
        if (!point) continue;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4 / this.camera.zoom, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.setLineDash([9 / this.camera.zoom, 7 / this.camera.zoom]);
    }
    ctx.restore();
  }

  private drawDiscardedEquipment(
    ctx: CanvasRenderingContext2D,
    equipmentItems: DiscardedEquipment[],
  ): void {
    for (const equipment of equipmentItems) {
      const style = FACTION_STYLE[equipment.faction];
      ctx.save();
      ctx.translate(equipment.x, equipment.y);
      ctx.rotate(equipment.rotation);
      if (equipment.kind === "shield") {
        ctx.fillStyle = style.detail;
        ctx.strokeStyle = style.dark;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(0, 0, 4, 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.strokeStyle = "#4b3825";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-7, 0);
        ctx.lineTo(7, 0);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawRoutEscapeVisuals(
    ctx: CanvasRenderingContext2D,
    visuals: RoutEscapeVisual[],
    time: number,
  ): void {
    for (const visual of visuals) {
      const style = FACTION_STYLE[visual.faction];
      const swimming = this.battlefield.isInWaterBand(visual);
      ctx.save();
      ctx.translate(visual.x, visual.y);
      if (swimming) {
        ctx.rotate(Math.atan2(visual.directionY, visual.directionX));
        ctx.strokeStyle = "rgba(206,225,216,.42)";
        ctx.beginPath();
        ctx.moveTo(-8, 3);
        ctx.lineTo(6, 3);
        ctx.stroke();
        ctx.fillStyle = style.primary;
        ctx.fillRect(-5, -2, 9, 4);
        ctx.fillStyle = "#c89b72";
        ctx.beginPath();
        ctx.arc(5, 0, 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.translate(0, Math.sin(time * 9 + visual.phase) * 0.7);
        ctx.fillStyle = style.primary;
        ctx.fillRect(-2.8, -4, 5.6, 8);
        ctx.fillStyle = "#c89b72";
        ctx.beginPath();
        ctx.arc(0, -6, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawStandardAuras(
    ctx: CanvasRenderingContext2D,
    standards: BattleStandard[],
  ): void {
    ctx.save();
    ctx.setLineDash([10, 9]);
    ctx.lineWidth = 2;
    for (const standard of standards) {
      if (standard.status !== "unit") continue;
      ctx.beginPath();
      ctx.arc(standard.position.x, standard.position.y, STANDARD_AURA_RADIUS, 0, Math.PI * 2);
      const roman = standard.faction === "roman";
      ctx.fillStyle = roman ? "rgba(214,180,93,.075)" : "rgba(144,180,204,.075)";
      ctx.strokeStyle = roman ? "rgba(230,197,111,.5)" : "rgba(157,197,221,.5)";
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawBattleStandards(
    ctx: CanvasRenderingContext2D,
    standards: BattleStandard[],
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    for (const standard of standards) {
      if (standard.status === "escaped") continue;
      const screen = this.camera.worldToScreen(
        standard.position,
        viewportWidth,
        viewportHeight,
      );
      drawBattleStandardScreen(ctx, standard, screen.x, screen.y);
    }
  }

  private drawBodies(ctx: CanvasRenderingContext2D, bodies: FallenBody[]): void {
    for (const body of bodies) {
      const style = FACTION_STYLE[body.faction];
      ctx.save();
      ctx.translate(body.x, body.y);
      ctx.rotate(body.facing);
      ctx.fillStyle = "rgba(25,21,17,.25)";
      ctx.beginPath();
      ctx.ellipse(2, 2, 8, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = style.dark;
      ctx.fillRect(-5, -2, 10, 4);
      ctx.fillStyle = style.primary;
      ctx.fillRect(-4, -1.3, 7, 2.6);
      ctx.fillStyle = "#aa8062";
      ctx.beginPath();
      ctx.arc(5, 0, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawTerrain(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "#536f3f";
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    ctx.clip();
    for (let i = 0; i < 18; i += 1) {
      const x = (i * 389) % WORLD_WIDTH;
      const y = (i * 647) % WORLD_HEIGHT;
      ctx.fillStyle = i % 2 ? "rgba(134,155,83,.10)" : "rgba(40,69,35,.09)";
      ctx.beginPath();
      ctx.ellipse(x, y, 260 + i * 8, 110 + (i % 3) * 30, i * 0.23, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const patch of this.battlefield.rough) {
      ctx.fillStyle = patch.tone > 0.5 ? "rgba(77,88,48,.45)" : "rgba(97,105,55,.38)";
      ctx.beginPath();
      for (let k = 0; k < 9; k += 1) {
        const angle = k / 9 * Math.PI * 2;
        const radius = patch.radius * (0.83 + Math.sin(k * 4.7 + patch.x) * 0.12);
        const px = patch.x + Math.cos(angle) * radius;
        const py = patch.y + Math.sin(angle) * radius * 0.65;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(61,65,38,.24)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    this.strokePath(ctx, this.battlefield.road, "#8b7952", 58);
    this.strokePath(ctx, this.battlefield.road, "#aa9364", 43);
    this.strokePath(ctx, this.battlefield.road, "rgba(70,61,41,.23)", 2);

    ctx.beginPath();
    for (let x = -20; x <= WORLD_WIDTH + 20; x += 18) {
      const y = this.battlefield.streamY(x);
      if (x < 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "#395f68";
    ctx.lineWidth = 62;
    ctx.stroke();
    for (const segment of this.deepStreamSegments) {
      this.strokePath(ctx, segment, "#315c70", 48);
    }
    for (const segment of this.shallowStreamSegments) {
      this.strokePath(ctx, segment, "#73958d", 48);
    }
    for (const segment of this.deepStreamSegments) {
      this.strokePath(ctx, segment, "rgba(185,211,190,.18)", 4);
    }
    for (const segment of this.shallowStreamSegments) {
      this.strokePath(ctx, segment, "rgba(215,231,195,.3)", 4);
    }
    ctx.fillStyle = "#947e51";
    const bridgeStartX = BRIDGE_CENTRE_X - BRIDGE_HALF_LENGTH;
    const bridgeWidth = BRIDGE_HALF_LENGTH * 2;
    ctx.fillRect(
      bridgeStartX,
      this.battlefield.streamY(BRIDGE_CENTRE_X) - 38,
      bridgeWidth,
      76,
    );
    for (let x = bridgeStartX + 10; x < bridgeStartX + bridgeWidth - 10; x += 18) {
      ctx.fillStyle = x % 36 ? "#a88c59" : "#7d6847";
      ctx.fillRect(x, this.battlefield.streamY(BRIDGE_CENTRE_X) - 34, 12, 68);
    }

    for (const rock of this.battlefield.rocks) {
      ctx.save();
      ctx.translate(rock.x, rock.y);
      ctx.rotate(rock.rotation);
      ctx.fillStyle = "#727567";
      ctx.beginPath();
      ctx.moveTo(-rock.size, rock.size * .5);
      ctx.lineTo(-rock.size * .45, -rock.size * .7);
      ctx.lineTo(rock.size * .65, -rock.size * .45);
      ctx.lineTo(rock.size, rock.size * .55);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#4d5148";
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();
    }
    for (const tree of this.battlefield.trees) {
      ctx.fillStyle = "rgba(24,33,19,.24)";
      ctx.beginPath();
      ctx.ellipse(tree.x + 7, tree.y + 10, tree.size * .9, tree.size * .45, .4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#2e4927";
      ctx.beginPath();
      const sides = 5;
      for (let k = 0; k < sides; k += 1) {
        const angle = tree.rotation + k / sides * Math.PI * 2;
        const x = tree.x + Math.cos(angle) * tree.size;
        const y = tree.y + Math.sin(angle) * tree.size * .8;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#1d351b";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.strokeStyle = "#313c27";
    ctx.lineWidth = 8;
    ctx.strokeRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    ctx.restore();
  }

  private drawTerrainOverlay(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    ctx.clip();
    ctx.fillStyle = "rgba(173,194,115,.12)";
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.strokePath(ctx, this.battlefield.road, "rgba(214,179,99,.56)", 68);
    for (const patch of this.battlefield.rough) {
      ctx.fillStyle = "rgba(190,129,66,.36)";
      ctx.strokeStyle = "rgba(244,174,91,.72)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(patch.x, patch.y, patch.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    for (const tree of this.battlefield.trees) {
      ctx.fillStyle = "rgba(53,112,59,.32)";
      ctx.strokeStyle = "rgba(103,181,96,.62)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(tree.x, tree.y, 38 + tree.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    for (const segment of this.deepStreamSegments) {
      this.strokePath(ctx, segment, "rgba(32,71,118,.78)", 54);
    }
    for (const segment of this.shallowStreamSegments) {
      this.strokePath(ctx, segment, "rgba(89,188,190,.72)", 54);
    }
    ctx.restore();
  }

  private strokePath(ctx: CanvasRenderingContext2D, points: Vec2[], color: string, width: number): void {
    const first = points[0];
    if (!first) return;
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < points.length; i += 1) {
      const point = points[i];
      if (point) ctx.lineTo(point.x, point.y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }

  private drawUnit(ctx: CanvasRenderingContext2D, unit: Unit, time: number): number {
    const attackFlash = unit.attackCommandFlashTimer > 0 &&
      Math.floor(time * 12) % 2 === 0;
    if (unit.selected || attackFlash) {
      ctx.save();
      ctx.translate(unit.position.x, unit.position.y);
      ctx.rotate(unit.facing);
      ctx.strokeStyle = attackFlash
        ? "rgba(255,68,61,.96)"
        : "rgba(244,220,139,.75)";
      ctx.fillStyle = attackFlash
        ? "rgba(197,43,40,.14)"
        : "rgba(236,204,117,.065)";
      ctx.lineWidth = attackFlash ? 3 : 2;
      ctx.setLineDash(attackFlash ? [4, 3] : [7, 5]);
      ctx.beginPath();
      ctx.ellipse(0, 0, unit.formationWidth * .56 + 8, unit.formationDepth * .7 + 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(unit.position.x, unit.position.y);
    ctx.rotate(unit.facing);
    const style = FACTION_STYLE[unit.faction];
    const bob = unit.velocity > 2 ? Math.sin(time * 8) * .35 : 0;
    for (let i = 0; i < unit.soldierCount; i += 1) {
      const soldier = unit.soldiers[i];
      if (!soldier) continue;
      ctx.save();
      ctx.translate(soldier.x, soldier.y + bob * Math.sin(soldier.phase));
      if (unit.state === "routing") ctx.rotate(Math.sin(soldier.phase * 4.1) * .4);
      this.drawSoldier(ctx, unit, soldier, style);
      ctx.restore();
    }
    ctx.restore();
    return unit.soldierCount;
  }

  private drawSoldier(
    ctx: CanvasRenderingContext2D,
    unit: Unit,
    soldier: Unit["soldiers"][number],
    style: typeof FACTION_STYLE.roman | typeof FACTION_STYLE.saxon,
  ): void {
    const cavalry = unit.type === "cavalry";
    const overheadTortoiseShield = unit.formation === "tortoise" &&
      soldier.baseY > -unit.formationDepth * 0.5 + 10;
    if (cavalry) {
      ctx.fillStyle = "#5b4430";
      ctx.beginPath();
      ctx.ellipse(0, 2, 4.7, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "#3b2d22";
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    if (unit.type === "archers") {
      ctx.arc(3.5, -1.5, 4.2, -Math.PI * .55, Math.PI * .55);
      ctx.moveTo(3.5, -5.7);
      ctx.lineTo(3.5, 2.7);
    } else {
      ctx.moveTo(3.6, 3);
      ctx.lineTo(3.6, -8.5);
    }
    ctx.stroke();
    ctx.fillStyle = style.dark;
    ctx.fillRect(-2.8, -3.7, 5.6, 8.2);
    ctx.fillStyle = style.primary;
    ctx.beginPath();
    ctx.moveTo(-3.2, -3.5);
    ctx.lineTo(3.2, -3.5);
    ctx.lineTo(2.2, 4.8);
    ctx.lineTo(-2.2, 4.8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#c89b72";
    ctx.beginPath();
    ctx.arc(0, -5.3, 2.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = style.detail;
    if (unit.type === "archers") {
      // The bow silhouette identifies unshielded ranged troops.
    } else if (unit.faction === "roman" && overheadTortoiseShield) {
      ctx.fillStyle = style.detail;
      ctx.strokeStyle = style.dark;
      ctx.fillRect(-4.2, -9.8, 8.4, 8.4);
      ctx.strokeRect(-4.2, -9.8, 8.4, 8.4);
    } else if (unit.faction === "roman" && unit.formation === "tortoise") {
      ctx.fillRect(-5, -1.8, 5.6, 5.6);
      ctx.strokeStyle = style.dark;
      ctx.strokeRect(-5, -1.8, 5.6, 5.6);
    } else if (unit.faction === "roman") {
      ctx.fillRect(-4.8, -1.8, 2.7, 6.2);
      ctx.strokeStyle = style.dark;
      ctx.strokeRect(-4.8, -1.8, 2.7, 6.2);
    } else {
      ctx.beginPath();
      ctx.arc(-3.4, .7, 3.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = style.primary;
      ctx.beginPath();
      ctx.arc(-3.4, .7, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawUnitLabels(
    ctx: CanvasRenderingContext2D,
    units: Unit[],
    viewportWidth: number,
    viewportHeight: number,
    time: number,
  ): void {
    let count = 0;
    for (const unit of units) {
      if (isUnitInactive(unit) || unit.soldierCount <= 0) continue;
      const anchor = this.camera.worldToScreen({
        x: unit.position.x,
        y: unit.position.y - formationRadius(unit) * 0.55,
      }, viewportWidth, viewportHeight);
      const unitScreen = this.camera.worldToScreen(unit.position, viewportWidth, viewportHeight);
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
          height: 40,
          anchorX: 0,
          anchorY: 0,
        };
        this.labelPool.push(label);
      }
      label.id = unit.id;
      label.unit = unit;
      label.anchorX = unitScreen.x;
      label.anchorY = unitScreen.y;
      label.desiredX = anchor.x;
      label.desiredTop = anchor.y - 18;
      label.width = 68;
      label.height = activity === "idle" ? 34 : 40;
      count += 1;
    }
    this.labelPool.length = count;
    resolveUnitLabelPlacements(this.labelPool, count, viewportWidth, viewportHeight);

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
      ctx.moveTo(label.anchorX, label.anchorY);
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
    ctx.fillRect(x - 31, top, 62, 14);
    ctx.strokeStyle = attackFlash ? "#ff443d" : tacticalStyle.border;
    ctx.lineWidth = attackFlash ? 2.5 : 1.5;
    ctx.strokeRect(x - 31, top, 62, 14);
    ctx.fillStyle = tacticalStyle.text;
    ctx.font = "700 9px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${unit.id}  ${unit.soldierCount}`, x, top + 10);
    ctx.fillStyle = "#282c25";
    ctx.fillRect(x - 30, top + 16, 60, 3);
    ctx.fillStyle = unit.morale > 48 ? "#aeb56d" : unit.morale > 22 ? "#c5944b" : "#9f4b40";
    ctx.fillRect(x - 30, top + 16, 60 * clamp(unit.morale / 100, 0, 1), 3);
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
    const statusHeight = twoLines ? 17 : 11;
    const statusTop = top + 23;
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
      ctx.fillText(moraleText, x, statusTop + 8);
    }
  }

  private drawEffects(ctx: CanvasRenderingContext2D, effects: BattleEffect[]): void {
    for (const effect of effects) {
      const alpha = clamp(effect.life / .85, 0, 1);
      if (effect.label) {
        ctx.strokeStyle = `rgba(24,17,13,${alpha * .95})`;
        ctx.lineWidth = 4;
        ctx.fillStyle = `rgba(238,79,67,${alpha})`;
        ctx.font = "900 16px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.strokeText(effect.label, effect.x, effect.y - 12);
        ctx.fillText(effect.label, effect.x, effect.y - 12);
        continue;
      }
      if (effect.ranged && effect.sourceX !== undefined && effect.sourceY !== undefined) {
        const progress = 1 - clamp(effect.life / 1.05, 0, 1);
        const arrowX = effect.sourceX + (effect.x - effect.sourceX) * progress;
        const arrowY = effect.sourceY + (effect.y - effect.sourceY) * progress;
        const length = Math.max(
          1,
          Math.hypot(effect.x - effect.sourceX, effect.y - effect.sourceY),
        );
        const dx = (effect.x - effect.sourceX) / length;
        const dy = (effect.y - effect.sourceY) / length;
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
        ctx.moveTo(effect.x - 8, effect.y - 8);
        ctx.lineTo(effect.x + 8, effect.y + 8);
        ctx.moveTo(effect.x + 8, effect.y - 8);
        ctx.lineTo(effect.x - 8, effect.y + 8);
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
        ctx.strokeText(damageText, effect.x, effect.y - 13);
        ctx.fillStyle = effect.charge
          ? `rgba(255,202,91,${alpha})`
          : `rgba(255,230,190,${alpha})`;
        ctx.fillText(damageText, effect.x, effect.y - 13);
      }
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

    ctx.save();
    ctx.setLineDash([8, 5]);
    if (layout.dragged) {
      const midX = (start.x + end.x) * 0.5;
      const midY = (start.y + end.y) * 0.5;
      const forwardX = Math.sin(layout.facing);
      const forwardY = -Math.cos(layout.facing);
      ctx.strokeStyle = "rgba(246,220,135,.78)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.moveTo(midX, midY);
      ctx.lineTo(midX + forwardX * 34, midY + forwardY * 34);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(246,220,135,.8)";
      ctx.beginPath();
      ctx.moveTo(midX + forwardX * 40, midY + forwardY * 40);
      ctx.lineTo(midX + forwardX * 27 - forwardY * 6, midY + forwardY * 27 + forwardX * 6);
      ctx.lineTo(midX + forwardX * 27 + forwardY * 6, midY + forwardY * 27 - forwardX * 6);
      ctx.closePath();
      ctx.fill();
      ctx.setLineDash([8, 5]);
    }
    selected.forEach((unit, index) => {
      const placement = layout.placements[index];
      if (!placement) return;
      ctx.save();
      ctx.translate(placement.destination.x, placement.destination.y);
      ctx.rotate(placement.facing);
      ctx.strokeStyle = "rgba(246,220,135,.75)";
      ctx.fillStyle = "rgba(246,220,135,.09)";
      ctx.lineWidth = 2;
      ctx.fillRect(
        -unit.formationWidth / 2,
        -unit.formationDepth / 2,
        unit.formationWidth,
        unit.formationDepth,
      );
      ctx.strokeRect(
        -unit.formationWidth / 2,
        -unit.formationDepth / 2,
        unit.formationWidth,
        unit.formationDepth,
      );
      ctx.restore();
    });
    ctx.restore();
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
}
