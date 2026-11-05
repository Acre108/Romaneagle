import { MAX_CAMERA_ZOOM, MIN_CAMERA_ZOOM, READABLE_OPENING_ZOOM } from "./IsoConfig";
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
  private openingArmies: IsoWorldBounds | null = null;

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

  /** A camera the player has not touched reframes for the new size; otherwise the same spot stays centred. */
  setViewport(viewport: IsoViewport): void {
    const untouched = this.current.x === this.initial.x && this.current.y === this.initial.y && this.current.zoom === this.initial.zoom;
    const centre = this.screenToWorld({ x: this.viewport.width / 2, y: this.viewport.height / 2 });
    this.viewport = viewport;
    if (untouched) this.frameOpening(this.openingArmies);
    else this.centerOn(centre);
  }

  setBounds(bounds: IsoWorldBounds, frame = false): void {
    this.bounds = bounds;
    if (frame) this.frameOpening(null);
    else this.constrain();
  }

  frameBattlefield(captureInitial = false, area: IsoWorldBounds = this.bounds): void {
    const width = area.maxX - area.minX;
    const height = area.maxY - area.minY;
    const zoom = Math.min((this.viewport.width - 120) / width, (this.viewport.height - 100) / height);
    this.current.zoom = clamp(zoom, MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM);
    this.current.x = this.viewport.width / 2 - (area.minX + area.maxX) * 0.5 * this.current.zoom;
    this.current.y = this.viewport.height / 2 - (area.minY + area.maxY) * 0.5 * this.current.zoom;
    this.constrain();
    if (captureInitial) Object.assign(this.initial, this.current);
  }

  /** Opens on the whole battlefield, or on the armies when the whole map would be too small to read. */
  frameOpening(armies: IsoWorldBounds | null): void {
    this.openingArmies = armies;
    this.frameBattlefield(true, armies && !this.battlefieldReadableWhole() ? armies : this.bounds);
  }

  private battlefieldReadableWhole(): boolean {
    return (this.bounds.maxX - this.bounds.minX) * READABLE_OPENING_ZOOM <= this.viewport.width - 120
      && (this.bounds.maxY - this.bounds.minY) * READABLE_OPENING_ZOOM <= this.viewport.height - 100;
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
