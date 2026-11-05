import { Container, Graphics, Text, type Application } from "pixi.js";
import { BALANCE } from "../model/config";
import type { GameEvent, GridPosition } from "../model/types";
import { DIAMOND_POINTS, ISO_METRICS } from "./isometric/IsoConfig";
import { calculateIsoDepth, ISO_DEPTH_PRIORITY } from "./isometric/IsoDepth";
import { gridToIso, type ScreenPosition } from "./isometric/IsoProjection";

export type AnimationSpeed = 0 | 0.5 | 1 | 2;

function durationFor(event: GameEvent): number {
  switch (event.type) {
    case "formation_moved": return BALANCE.animationMs.move;
    case "block_retreated": return BALANCE.animationMs.retreat;
    case "formation_routed": return BALANCE.animationMs.rout;
    case "formation_escaped": return BALANCE.animationMs.rout;
    case "retreat_cascade": return BALANCE.animationMs.cascadeStagger * Math.max(1, event.blockIds?.length ?? 1);
    case "chaotic_retreat": return BALANCE.animationMs.retreat + BALANCE.animationMs.cascadeStagger * Math.max(1, event.blockIds?.length ?? 1);
    case "charge_impact": return BALANCE.animationMs.impact;
    case "block_damaged": return BALANCE.animationMs.impact;
    case "ranged_volley": return BALANCE.animationMs.ranged;
    case "counterattack_resolved": return BALANCE.animationMs.melee;
    case "block_destroyed": return BALANCE.animationMs.destroyed;
    case "formation_split": return BALANCE.animationMs.split;
    case "contested_melee_resolved": return BALANCE.animationMs.melee;
    case "duel_resolved": return BALANCE.animationMs.duel;
    default: return 110;
  }
}

export class AnimationQueue {
  private readonly queue: GameEvent[] = [];
  private current: GameEvent | null = null;
  private remainingMs = 0;
  private speed: AnimationSpeed = 1;
  private projectPosition: (position: GridPosition) => ScreenPosition = (position) => gridToIso(position, ISO_METRICS);
  private fallbackPosition: ScreenPosition = { x: 0, y: 0 };
  private readonly projectileFlights: Array<{
    graphic: Graphics;
    source: { x: number; y: number };
    target: { x: number; y: number };
    durationMs: number;
  }> = [];

  constructor(
    private readonly app: Application,
    private readonly layer: Container,
    private readonly describe: (text: string) => string,
  ) {
    app.ticker.add(this.update, this);
  }

  /** True while an effect is showing or waiting to show. */
  get busy(): boolean {
    return this.current !== null || this.queue.length > 0;
  }

  setSpeed(speed: AnimationSpeed): void {
    this.speed = speed;
    if (speed === 0) this.clear();
  }

  setTerrainProjection(projectPosition: (position: GridPosition) => ScreenPosition, fallbackPosition: ScreenPosition): void {
    this.projectPosition = projectPosition;
    this.fallbackPosition = { ...fallbackPosition };
  }

  enqueue(events: readonly GameEvent[]): void {
    if (this.speed === 0) return;
    this.queue.push(...events);
  }

  private start(event: GameEvent): void {
    this.layer.removeChildren().forEach((child) => child.destroy());
    this.projectileFlights.length = 0;
    const isCasualty = event.type === "block_damaged";
    const isSplit = event.type === "formation_split";
    const isVolley = event.type === "ranged_volley";
    const text = new Text({
      text: isSplit
        ? "FORMATION SPLIT"
        : isVolley
          ? `${event.projectileKind?.toUpperCase() ?? "MISSILE"} VOLLEY`
        : isCasualty
          ? `-${event.casualties ?? 0} ${(event.casualties ?? 0) === 1 ? "CASUALTY" : "CASUALTIES"}`
          : event.type === "pressure_applied" ? event.pressureResult?.toUpperCase() ?? "" : this.describe(event.message),
      style: {
        fontFamily: "Arial",
        fontSize: isSplit || isCasualty ? 22 : 13,
        fontWeight: "700",
        fill: isCasualty ? 0xff8b76 : isSplit || isVolley ? 0xffd37a : 0xfff2ce,
        stroke: { color: 0x1b1711, width: 4 },
        align: "center",
      },
    });
    text.anchor.set(0.5);
    const position = event.position
      ? this.projectPosition(event.position)
      : this.fallbackPosition;
    text.position.set(position.x, event.position ? position.y - 54 : position.y - 100);
    text.zIndex = event.position
      ? calculateIsoDepth(event.position.x, event.position.y, ISO_DEPTH_PRIORITY.floatingLabel)
      : Number.MAX_SAFE_INTEGER;
    this.layer.addChild(text);
    const durationMs = durationFor(event) / this.speed;
    const sourcePositions = event.sourcePositions?.length
      ? event.sourcePositions
      : event.sourcePosition ? [event.sourcePosition] : [];
    if (isVolley && sourcePositions.length > 0 && event.position) {
      const longProjectile = event.projectileKind === "javelins" || event.projectileKind === "bolts";
      const length = longProjectile ? 28 : event.projectileKind === "darts" ? 13 : 18;
      const colour = event.projectileKind === "bolts" ? 0xe8d5a4 : 0xf7e4ae;
      sourcePositions.forEach((sourcePosition, sourceIndex) => {
        const source = this.projectPosition(sourcePosition);
        const targetPosition = event.targetPositions?.[sourceIndex] ?? event.position!;
        const target = this.projectPosition(targetPosition);
        const projectile = new Graphics();
        for (let index = -1; index <= 1; index += 1) {
          const offset = index * 6;
          projectile.moveTo(-length / 2, offset).lineTo(length / 2, offset)
            .stroke({ width: longProjectile ? 2.5 : 1.5, color: colour, cap: "round" });
          projectile.moveTo(length / 2 - 5, offset - 3).lineTo(length / 2, offset).lineTo(length / 2 - 5, offset + 3)
            .stroke({ width: 1.5, color: colour, cap: "round" });
        }
        const flightSource = { x: source.x, y: source.y - 18 };
        const flightTarget = { x: target.x, y: target.y - 18 };
        projectile.position.set(flightSource.x, flightSource.y);
        projectile.rotation = Math.atan2(
          flightTarget.y - flightSource.y,
          flightTarget.x - flightSource.x,
        );
        projectile.zIndex = Number.MAX_SAFE_INTEGER - 1;
        this.layer.addChild(projectile);
        this.projectileFlights.push({
          graphic: projectile,
          source: flightSource,
          target: flightTarget,
          durationMs,
        });
      });
    }
    if (event.position) {
      const effectColour = isCasualty ? 0xb52b25 : 0xffd37a;
      const flash = new Graphics()
        .poly(DIAMOND_POINTS, true)
        .stroke({ width: 4, color: effectColour, alpha: 0.9 });
      flash.position.set(position.x, position.y);
      flash.zIndex = calculateIsoDepth(event.position.x, event.position.y, ISO_DEPTH_PRIORITY.effect);
      this.layer.addChild(flash);
      if (isCasualty) {
        const fallen = new Graphics();
        const marks = Math.min(3, event.casualties ?? 1);
        for (let index = 0; index < marks; index += 1) {
          const x = (index - (marks - 1) / 2) * 12;
          const y = 4 + (index % 2) * 4;
          fallen.ellipse(x, y, 6, 2.5).fill({ color: 0x5d151c, alpha: 0.9 });
          fallen.moveTo(x - 5, y - 4).lineTo(x + 5, y + 4).stroke({ width: 2, color: 0xe0c19b });
        }
        fallen.position.set(position.x, position.y);
        fallen.zIndex = calculateIsoDepth(event.position.x, event.position.y, ISO_DEPTH_PRIORITY.effect + 1);
        this.layer.addChild(fallen);
      }
    }
    this.remainingMs = durationMs;
  }

  private update(): void {
    if (this.speed === 0) return;
    if (!this.current) {
      this.current = this.queue.shift() ?? null;
      if (this.current) this.start(this.current);
      return;
    }
    this.remainingMs -= this.app.ticker.deltaMS;
    for (const flight of this.projectileFlights) {
      const progress = Math.max(0, Math.min(1, 1 - this.remainingMs / flight.durationMs));
      const eased = progress * progress * (3 - 2 * progress);
      flight.graphic.position.set(
        flight.source.x + (flight.target.x - flight.source.x) * eased,
        flight.source.y + (flight.target.y - flight.source.y) * eased
          - Math.sin(Math.PI * progress) * 44,
      );
      flight.graphic.alpha = Math.min(1, (1 - progress) * 3);
    }
    if (this.remainingMs <= 0) {
      this.layer.removeChildren().forEach((child) => child.destroy());
      this.projectileFlights.length = 0;
      this.current = null;
    }
  }

  clear(): void {
    this.queue.length = 0;
    this.current = null;
    this.remainingMs = 0;
    this.projectileFlights.length = 0;
    this.layer.removeChildren().forEach((child) => child.destroy());
  }

  destroy(): void {
    this.app.ticker.remove(this.update, this);
    this.clear();
  }
}
