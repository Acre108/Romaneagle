import type { Camera } from "../core/Camera";
import type { Battlefield } from "../world/Battlefield";
import type {
  BattleEffect,
  BattleStandard,
  DiscardedEquipment,
  FallenBody,
  RoutEscapeVisual,
} from "../systems/Simulation";
import type { Unit } from "../units/types";
import { IsometricRenderer } from "./IsometricRenderer";
import { TopDownRenderer } from "./TopDownRenderer";
import type { DragVisual, RendererMode, RenderStats } from "./RenderTypes";

export type { DragVisual, RendererMode, RenderStats } from "./RenderTypes";

interface RendererImplementation {
  render(
    units: Unit[],
    standards: BattleStandard[],
    routEscapeVisuals: RoutEscapeVisual[],
    discardedEquipment: DiscardedEquipment[],
    bodies: FallenBody[],
    effects: BattleEffect[],
    drag: DragVisual,
    time: number,
    debug?: boolean,
    terrainOverlay?: boolean,
  ): RenderStats;
}

export class Renderer {
  private readonly implementation: RendererImplementation;

  constructor(
    canvas: HTMLCanvasElement,
    camera: Camera,
    battlefield: Battlefield,
    mode: RendererMode,
  ) {
    this.implementation = mode === "isometric"
      ? new IsometricRenderer(canvas, camera, battlefield)
      : new TopDownRenderer(canvas, camera, battlefield);
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
    return this.implementation.render(
      units,
      standards,
      routEscapeVisuals,
      discardedEquipment,
      bodies,
      effects,
      drag,
      time,
      debug,
      terrainOverlay,
    );
  }
}
