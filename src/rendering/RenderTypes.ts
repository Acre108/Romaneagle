import type { Vec2 } from "../core/math";
import type { ProjectionMode } from "./IsometricProjection";

export type RendererMode = ProjectionMode;

export interface DragVisual {
  selectionStart?: Vec2;
  selectionEnd?: Vec2;
  orderStart?: Vec2;
  orderEnd?: Vec2;
}

export interface RenderStats {
  visibleSoldiers: number;
  culledSoldiers: number;
  visibleTerrainObjects: number;
  visibleBodies: number;
  visibleEquipment: number;
  visibleEscapeVisuals: number;
  renderTimeMs: number;
}
