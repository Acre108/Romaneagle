import { clamp, type Vec2 } from "./math";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../world/Battlefield";
import {
  projectWorldBounds,
  screenToWorld as unprojectIsometric,
  screenVectorToWorld,
  worldToScreen as projectIsometric,
  worldToScreenInto as projectIsometricInto,
  type ProjectionMode,
} from "../rendering/IsometricProjection";

export class Camera {
  position: Vec2 = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
  zoom: number;
  minZoom = 0.38;
  maxZoom = 2.3;
  private readonly projectedCamera: Vec2 = { x: 0, y: 0 };

  constructor(readonly mode: ProjectionMode = "topDown") {
    this.zoom = mode === "isometric" ? 0.56 : 0.48;
  }

  worldToScreen(point: Vec2, width: number, height: number): Vec2 {
    return this.worldToScreenInto(point.x, point.y, width, height, { x: 0, y: 0 });
  }

  worldToScreenInto(worldX: number, worldY: number, width: number, height: number, output: Vec2): Vec2 {
    if (this.mode === "isometric") {
      projectIsometricInto(worldX, worldY, 0, output);
      projectIsometricInto(this.position.x, this.position.y, 0, this.projectedCamera);
      output.x = (output.x - this.projectedCamera.x) * this.zoom + width / 2;
      output.y = (output.y - this.projectedCamera.y) * this.zoom + height / 2;
      return output;
    }
    output.x = (worldX - this.position.x) * this.zoom + width / 2;
    output.y = (worldY - this.position.y) * this.zoom + height / 2;
    return output;
  }

  screenToWorld(point: Vec2, width: number, height: number): Vec2 {
    if (this.mode === "isometric") {
      const cameraAnchor = projectIsometric(this.position.x, this.position.y);
      return unprojectIsometric(
        (point.x - width / 2) / this.zoom + cameraAnchor.x,
        (point.y - height / 2) / this.zoom + cameraAnchor.y,
      );
    }
    return {
      x: (point.x - width / 2) / this.zoom + this.position.x,
      y: (point.y - height / 2) / this.zoom + this.position.y,
    };
  }

  panWorld(dx: number, dy: number, viewportWidth: number, viewportHeight: number): void {
    this.position.x += dx;
    this.position.y += dy;
    this.constrain(viewportWidth, viewportHeight);
  }

  panScreen(dx: number, dy: number, viewportWidth: number, viewportHeight: number): void {
    if (this.mode === "isometric") {
      const worldDelta = screenVectorToWorld(dx / this.zoom, dy / this.zoom);
      this.position.x += worldDelta.x;
      this.position.y += worldDelta.y;
    } else {
      this.position.x += dx / this.zoom;
      this.position.y += dy / this.zoom;
    }
    this.constrain(viewportWidth, viewportHeight);
  }

  setZoom(next: number, anchorScreen: Vec2, viewportWidth: number, viewportHeight: number): void {
    const before = this.screenToWorld(anchorScreen, viewportWidth, viewportHeight);
    this.zoom = clamp(next, this.minZoom, this.maxZoom);
    const after = this.screenToWorld(anchorScreen, viewportWidth, viewportHeight);
    this.position.x += before.x - after.x;
    this.position.y += before.y - after.y;
    this.constrain(viewportWidth, viewportHeight);
  }

  constrain(viewportWidth: number, viewportHeight: number): void {
    if (this.mode === "isometric") {
      const bounds = projectWorldBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      const projected = projectIsometric(this.position.x, this.position.y);
      const halfW = viewportWidth / this.zoom / 2;
      const halfH = viewportHeight / this.zoom / 2;
      const minX = bounds.minX + halfW;
      const maxX = bounds.maxX - halfW;
      const minY = bounds.minY + halfH;
      const maxY = bounds.maxY - halfH;
      const constrainedX = minX > maxX ? (bounds.minX + bounds.maxX) / 2 : clamp(projected.x, minX, maxX);
      const constrainedY = minY > maxY ? (bounds.minY + bounds.maxY) / 2 : clamp(projected.y, minY, maxY);
      const world = unprojectIsometric(constrainedX, constrainedY);
      this.position.x = clamp(world.x, 0, WORLD_WIDTH);
      this.position.y = clamp(world.y, 0, WORLD_HEIGHT);
      return;
    }
    const halfW = Math.min(WORLD_WIDTH / 2, viewportWidth / this.zoom / 2);
    const halfH = Math.min(WORLD_HEIGHT / 2, viewportHeight / this.zoom / 2);
    this.position.x = clamp(this.position.x, halfW, WORLD_WIDTH - halfW);
    this.position.y = clamp(this.position.y, halfH, WORLD_HEIGHT - halfH);
  }
}
