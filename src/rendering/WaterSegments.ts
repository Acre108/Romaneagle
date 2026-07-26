import type { Vec2 } from "../core/math";
import type { Battlefield, WaterDepth } from "../world/Battlefield";
import { WORLD_WIDTH } from "../world/Battlefield";

export interface WaterSegments {
  deep: Vec2[][];
  shallow: Vec2[][];
}

export function buildWaterSegments(battlefield: Battlefield, step = 18): WaterSegments {
  const segments: WaterSegments = { deep: [], shallow: [] };
  let active: Vec2[] | undefined;
  let activeDepth: WaterDepth | undefined;
  for (let x = -20; x <= WORLD_WIDTH + 20; x += step) {
    const point = { x, y: battlefield.streamY(x) };
    const depth = battlefield.isAtCrossing(point) ? undefined : battlefield.waterDepthAtX(x);
    if (depth !== activeDepth) {
      if (active && activeDepth && active.length > 1) segments[activeDepth].push(active);
      active = depth ? [point] : undefined;
      activeDepth = depth;
    } else if (active) {
      active.push(point);
    }
  }
  if (active && activeDepth && active.length > 1) segments[activeDepth].push(active);
  return segments;
}
