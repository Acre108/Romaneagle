import { SeededRandom, pointSegmentDistance, type Vec2 } from "../core/math";

export const WORLD_WIDTH = 2400;
export const WORLD_HEIGHT = 1600;

export interface TerrainPatch extends Vec2 { radius: number; tone: number }
export interface Decoration extends Vec2 { size: number; rotation: number }
export type WaterDepth = "deep" | "shallow";

export const STREAM_HALF_WIDTH = 27;
export const BRIDGE_CENTRE_X = 1190;
export const BRIDGE_HALF_LENGTH = 105;
export const SHALLOW_FORDS = [
  { startX: 315, endX: 585 },
  { startX: 1740, endX: 1995 },
] as const;
export const WATER_CROSSINGS = [
  { x: (SHALLOW_FORDS[0].startX + SHALLOW_FORDS[0].endX) * 0.5, kind: "shallow" },
  { x: BRIDGE_CENTRE_X, kind: "bridge" },
  { x: (SHALLOW_FORDS[1].startX + SHALLOW_FORDS[1].endX) * 0.5, kind: "shallow" },
] as const;

export class Battlefield {
  readonly width = WORLD_WIDTH;
  readonly height = WORLD_HEIGHT;
  readonly rough: TerrainPatch[] = [];
  readonly trees: Decoration[] = [];
  readonly rocks: Decoration[] = [];
  readonly grass: Decoration[] = [];
  readonly flowers: Decoration[] = [];
  readonly road: Vec2[] = [
    { x: -80, y: 1190 }, { x: 330, y: 1100 }, { x: 720, y: 920 },
    { x: 1050, y: 850 }, { x: 1380, y: 740 }, { x: 1740, y: 650 },
    { x: 2080, y: 460 }, { x: 2480, y: 390 },
  ];

  constructor(seed = 402) {
    const rng = new SeededRandom(seed);
    for (let i = 0; i < 11; i += 1) {
      this.rough.push({
        x: rng.range(160, WORLD_WIDTH - 160),
        y: rng.range(150, WORLD_HEIGHT - 150),
        radius: rng.range(65, 145),
        tone: rng.range(0, 1),
      });
    }
    for (let i = 0; i < 68; i += 1) {
      const x = rng.range(50, WORLD_WIDTH - 50);
      const y = rng.range(50, WORLD_HEIGHT - 50);
      if (Math.abs(y - this.streamY(x)) > 55 && !this.isOnRoad({ x, y }, 55)) {
        this.trees.push({ x, y, size: rng.range(10, 22), rotation: rng.range(0, Math.PI * 2) });
      }
    }
    for (let i = 0; i < 42; i += 1) {
      this.rocks.push({
        x: rng.range(30, WORLD_WIDTH - 30),
        y: rng.range(30, WORLD_HEIGHT - 30),
        size: rng.range(5, 13),
        rotation: rng.range(0, Math.PI * 2),
      });
    }
    for (let i = 0; i < 90; i += 1) {
      this.grass.push({
        x: rng.range(30, WORLD_WIDTH - 30),
        y: rng.range(30, WORLD_HEIGHT - 30),
        size: rng.range(2, 5),
        rotation: rng.range(0, Math.PI * 2),
      });
    }
    for (let i = 0; i < 28; i += 1) {
      this.flowers.push({
        x: rng.range(60, WORLD_WIDTH - 60),
        y: rng.range(60, WORLD_HEIGHT - 60),
        size: rng.range(1.5, 3),
        rotation: rng.range(0, Math.PI * 2),
      });
    }
  }

  streamY(x: number): number {
    return 795 + Math.sin(x / 230) * 78 + Math.sin(x / 83) * 18;
  }

  isAtCrossing(position: Vec2): boolean {
    return Math.abs(position.x - BRIDGE_CENTRE_X) <= BRIDGE_HALF_LENGTH;
  }

  waterDepthAtX(x: number): WaterDepth {
    for (const ford of SHALLOW_FORDS) {
      if (x >= ford.startX && x <= ford.endX) return "shallow";
    }
    return "deep";
  }

  isInWaterBand(position: Vec2): boolean {
    return Math.abs(position.y - this.streamY(position.x)) < STREAM_HALF_WIDTH;
  }

  isDeepWater(position: Vec2): boolean {
    return this.isDeepWaterAt(position.x, position.y);
  }

  isBlocked(position: Vec2): boolean {
    return this.isDeepWater(position);
  }

  segmentBlocked(start: Vec2, end: Vec2): boolean {
    return this.segmentCrossesDeepWater(start, end);
  }

  movementCost(position: Vec2): number {
    return this.movementModifier(position);
  }

  isDeepWaterAt(x: number, y: number): boolean {
    return (
      Math.abs(y - this.streamY(x)) < STREAM_HALF_WIDTH &&
      Math.abs(x - BRIDGE_CENTRE_X) > BRIDGE_HALF_LENGTH &&
      this.waterDepthAtX(x) === "deep"
    );
  }

  segmentCrossesDeepWater(start: Vec2, end: Vec2): boolean {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 12));
    for (let step = 0; step <= steps; step += 1) {
      const ratio = step / steps;
      if (this.isDeepWaterAt(start.x + dx * ratio, start.y + dy * ratio)) return true;
    }
    return false;
  }

  isShallowWater(position: Vec2): boolean {
    return (
      this.isInWaterBand(position) &&
      !this.isAtCrossing(position) &&
      this.waterDepthAtX(position.x) === "shallow"
    );
  }

  isInStream(position: Vec2): boolean {
    return this.isDeepWater(position) || this.isShallowWater(position);
  }

  isRough(position: Vec2): boolean {
    return this.rough.some((patch) => Math.hypot(position.x - patch.x, position.y - patch.y) < patch.radius);
  }

  isInWoods(position: Vec2): boolean {
    for (const tree of this.trees) {
      const radius = 38 + tree.size;
      const dx = position.x - tree.x;
      const dy = position.y - tree.y;
      if (dx * dx + dy * dy < radius * radius) return true;
    }
    return false;
  }

  isOnRoad(position: Vec2, width = 34): boolean {
    for (let i = 1; i < this.road.length; i += 1) {
      const previous = this.road[i - 1];
      const current = this.road[i];
      if (previous && current && pointSegmentDistance(position, previous, current) < width) return true;
    }
    return false;
  }

  movementModifier(position: Vec2): number {
    if (this.isShallowWater(position)) return 0.48;
    if (this.isDeepWater(position)) return 0;
    if (this.isInWoods(position)) return 0.62;
    if (this.isRough(position)) return 0.68;
    return 1;
  }
}
