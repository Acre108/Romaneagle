import { MAX_CAMERA_ZOOM, MIN_CAMERA_ZOOM } from "./IsoConfig";
import type { ScreenPosition } from "./IsoProjection";

export interface IsoCameraState {
  x: number;
  y: number;
  zoom: number;
}

export interface IsoViewport {
  width: number;
  height: number;
}

export interface IsoWorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export class IsoCamera {
  private readonly current: IsoCameraState = { x: 0, y: 0, zoom: 1 };
  private readonly initial: IsoCameraState = { x: 0, y: 0, zoom: 1 };

  constructor(
    private viewport: IsoViewport,
    private bounds: IsoWorldBounds,
  ) {
    this.frameBattlefield(true);
  }

  get state(): Readonly<IsoCameraState> {
    return this.current;
  }

  screenToWorld(screen: ScreenPosition): ScreenPosition {
    return {
      x: (screen.x - this.current.x) / this.current.zoom,
      y: (screen.y - this.current.y) / this.current.zoom,
    };
  }

  worldToScreen(world: ScreenPosition): ScreenPosition {
    return {
      x: world.x * this.current.zoom + this.current.x,
      y: world.y * this.current.zoom + this.current.y,
    };
  }

  panBy(deltaX: number, deltaY: number): void {
    this.current.x += deltaX;
    this.current.y += deltaY;
    this.constrain();
  }

  zoomAt(screen: ScreenPosition, zoom: number): void {
    const world = this.screenToWorld(screen);
    this.current.zoom = clamp(zoom, MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM);
    this.current.x = screen.x - world.x * this.current.zoom;
    this.current.y = screen.y - world.y * this.current.zoom;
    this.constrain();
  }

  centerOn(world: ScreenPosition): void {
    this.current.x = this.viewport.width / 2 - world.x * this.current.zoom;
    this.current.y = this.viewport.height / 2 - world.y * this.current.zoom;
    this.constrain();
  }

  setViewport(viewport: IsoViewport): void {
    this.viewport = viewport;
    this.constrain();
  }

  setBounds(bounds: IsoWorldBounds, frame = false): void {
    this.bounds = bounds;
    if (frame) this.frameBattlefield(true);
    else this.constrain();
  }

  frameBattlefield(captureInitial = false): void {
    const width = this.bounds.maxX - this.bounds.minX;
    const height = this.bounds.maxY - this.bounds.minY;
    const zoom = Math.min((this.viewport.width - 120) / width, (this.viewport.height - 100) / height);
    this.current.zoom = clamp(zoom, MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM);
    this.current.x = this.viewport.width / 2 - (this.bounds.minX + this.bounds.maxX) * 0.5 * this.current.zoom;
    this.current.y = this.viewport.height / 2 - (this.bounds.minY + this.bounds.maxY) * 0.5 * this.current.zoom;
    this.constrain();
    if (captureInitial) Object.assign(this.initial, this.current);
  }

  reset(): void {
    Object.assign(this.current, this.initial);
    this.constrain();
  }

  private constrain(): void {
    const visibleMargin = 80;
    this.current.x = clamp(
      this.current.x,
      visibleMargin - this.bounds.maxX * this.current.zoom,
      this.viewport.width - visibleMargin - this.bounds.minX * this.current.zoom,
    );
    this.current.y = clamp(
      this.current.y,
      visibleMargin - this.bounds.maxY * this.current.zoom,
      this.viewport.height - visibleMargin - this.bounds.minY * this.current.zoom,
    );
  }
}
