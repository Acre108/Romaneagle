import { Camera } from "./Camera";
import { distance, type Vec2 } from "./math";
import {
  Renderer,
  type DragVisual,
  type RendererMode,
  type RenderStats,
} from "../rendering/Renderer";
import { createPrototypeScenario } from "../scenario/PrototypeScenario";
import { Simulation } from "../systems/Simulation";
import {
  applyFormation,
  beginAboutFace,
  formationRadius,
} from "../units/formation";
import { useUniqueAbility } from "../units/abilities";
import {
  assignFormationOrderPlacements,
  calculateFormationOrderLayout,
} from "../units/FormationOrderLayout";
import { assignFormationMoveOrder } from "../units/FormationPathfinding";
import {
  createEngagementSlotUsage,
  selectEngagementSlot,
} from "../units/EngagementSlots";
import {
  attackTargetPaddingForZoom,
  isPointWithinAttackTarget,
  issueAttackOrder,
} from "../units/orders";
import { isUnitInactive, type FormationType, type Unit } from "../units/types";
import { UIController } from "../ui/UIController";
import { Battlefield, WORLD_HEIGHT, WORLD_WIDTH } from "../world/Battlefield";

export interface BattleFormationResult {
  id: string;
  name: string;
  type: Unit["type"];
  soldierCount: number;
  maximumSoldiers: number;
  state: Unit["state"];
}

export interface BattleReport {
  outcome: "romanVictory" | "saxonVictory" | "mutualDestruction";
  formations: BattleFormationResult[];
}

export class Game {
  private readonly camera: Camera;
  private readonly battlefield = new Battlefield();
  private readonly units: Unit[];
  private readonly simulation: Simulation;
  private readonly renderer: Renderer;
  private readonly ui = new UIController();
  private readonly keys = new Set<string>();
  private readonly drag: DragVisual = {};
  private rightPointerStart?: Vec2;
  private middleDragging = false;
  private lastPointer: Vec2 = { x: 0, y: 0 };
  private frameRequest = 0;
  private lastTime = performance.now();
  private accumulator = 0;
  private fps = 60;
  private fpsFrames = 0;
  private fpsTime = 0;
  private renderStats: RenderStats = {
    visibleSoldiers: 0,
    culledSoldiers: 0,
    visibleTerrainObjects: 0,
    visibleBodies: 0,
    visibleEquipment: 0,
    visibleEscapeVisuals: 0,
    renderTimeMs: 0,
  };
  private mouseWorld: Vec2 = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
  private debugEnabled = false;
  private terrainOverlayEnabled = false;
  private battleReportSent = false;
  private speed = 1;
  private paused = false;
  private readonly fixedStep = 1 / 60;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    rendererMode: RendererMode = "isometric",
    selectedRomanUnitIds?: readonly string[],
    private readonly onBattleEnded?: (report: BattleReport) => void,
  ) {
    this.units = createPrototypeScenario(selectedRomanUnitIds);
    this.simulation = new Simulation(this.units, this.battlefield);
    this.camera = new Camera(rendererMode);
    this.renderer = new Renderer(canvas, this.camera, this.battlefield, rendererMode);
    this.bindInput();
    this.bindUI();
  }

  start(): void {
    this.lastTime = performance.now();
    this.frameRequest = requestAnimationFrame(this.frame);
  }

  stop(): void {
    cancelAnimationFrame(this.frameRequest);
  }

  private readonly frame = (time: number): void => {
    const rawDelta = Math.min(0.1, (time - this.lastTime) / 1000);
    this.lastTime = time;
    this.fpsTime += rawDelta;
    this.fpsFrames += 1;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsTime = 0;
      this.fpsFrames = 0;
    }
    this.updateCamera(rawDelta);
    if (!this.paused) {
      this.accumulator += rawDelta * this.speed;
      let steps = 0;
      while (this.accumulator >= this.fixedStep && steps < 8) {
        this.simulation.update(this.fixedStep);
        this.accumulator -= this.fixedStep;
        steps += 1;
        if (this.simulation.stats.outcome !== "ongoing") {
          this.paused = true;
          this.accumulator = 0;
          this.sendBattleReport();
          break;
        }
      }
    }
    this.mouseWorld = this.toWorld(this.lastPointer);
    this.renderStats = this.renderer.render(
      this.units,
      this.simulation.standards,
      this.simulation.routEscapeVisuals,
      this.simulation.discardedEquipment,
      this.simulation.bodies,
      this.simulation.effects,
      this.drag,
      time / 1000,
      this.debugEnabled,
      this.terrainOverlayEnabled,
    );
    this.ui.update(
      this.units,
      this.simulation.stats,
      this.fps,
      this.renderStats,
      this.speed,
      this.paused,
      this.camera.position,
      this.mouseWorld,
    );
    this.frameRequest = requestAnimationFrame(this.frame);
  };

  private sendBattleReport(): void {
    if (this.battleReportSent || this.simulation.stats.outcome === "ongoing") return;
    this.battleReportSent = true;
    this.onBattleEnded?.({
      outcome: this.simulation.stats.outcome,
      formations: this.units
        .filter((unit) => unit.faction === "roman")
        .map((unit) => ({
          id: unit.id,
          name: unit.name,
          type: unit.type,
          soldierCount: unit.soldierCount,
          maximumSoldiers: unit.maximumSoldiers,
          state: unit.state,
        })),
    });
  }

  private bindInput(): void {
    window.addEventListener("keydown", (event) => {
      const key = event.key.toLowerCase();
      this.keys.add(key);
      if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) event.preventDefault();
      if (event.repeat && !["w", "a", "s", "d"].includes(key)) return;
      if (key === " ") this.paused = !this.paused;
      else if (key === "escape") this.clearSelection();
      else if (key === "f3") {
        event.preventDefault();
        this.debugEnabled = this.ui.toggleDebug();
      } else if (key === "t") {
        this.toggleTerrainOverlay();
      } else if (["1", "2", "3"].includes(key)) {
        this.speed = Number(key);
        this.paused = false;
      } else if (key === "l") this.setFormation("line");
      else if (key === "c") this.setFormation("column");
      else if (key === "g") this.useUniqueAbilitySelected();
      else if (key === "b") this.setFormation("mob");
      else if (key === "f") this.aboutFaceSelected();
      else if (key === "h") this.holdSelected();
      else if (key === "r") this.rallySelected();
    });
    window.addEventListener("keyup", (event) => this.keys.delete(event.key.toLowerCase()));
    window.addEventListener("blur", () => this.keys.clear());
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const pointer = this.pointerPosition(event);
      this.camera.setZoom(
        this.camera.zoom * Math.exp(-event.deltaY * 0.0012),
        pointer,
        this.canvas.clientWidth,
        this.canvas.clientHeight,
      );
    }, { passive: false });
    this.canvas.addEventListener("pointerdown", (event) => {
      const point = this.pointerPosition(event);
      this.lastPointer = point;
      this.canvas.setPointerCapture(event.pointerId);
      if (event.button === 1) {
        this.middleDragging = true;
      } else if (event.button === 0) {
        this.drag.selectionStart = point;
        this.drag.selectionEnd = point;
      } else if (
        event.button === 2 &&
        this.selectedUnits().some((unit) => unit.formationChangeTimer <= 0)
      ) {
        const world = this.toWorld(point);
        this.rightPointerStart = point;
        this.drag.orderStart = world;
        this.drag.orderEnd = world;
      }
    });
    this.canvas.addEventListener("pointermove", (event) => {
      const point = this.pointerPosition(event);
      if (this.middleDragging) {
        this.camera.panScreen(
          -(point.x - this.lastPointer.x),
          -(point.y - this.lastPointer.y),
          this.canvas.clientWidth,
          this.canvas.clientHeight,
        );
      }
      if (this.drag.selectionStart) this.drag.selectionEnd = point;
      if (this.drag.orderStart) this.drag.orderEnd = this.toWorld(point);
      this.lastPointer = point;
    });
    this.canvas.addEventListener("pointerup", (event) => {
      const point = this.pointerPosition(event);
      if (event.button === 1) this.middleDragging = false;
      if (event.button === 0 && this.drag.selectionStart) {
        this.completeSelection(this.drag.selectionStart, point, event.shiftKey);
        delete this.drag.selectionStart;
        delete this.drag.selectionEnd;
      }
      if (event.button === 2 && this.drag.orderStart) {
        const enemy = this.rightPointerStart && distance(this.rightPointerStart, point) < 7
          ? this.findEnemyAt(this.toWorld(point))
          : undefined;
        if (enemy) this.issueAttack(enemy);
        else this.issueMove(this.drag.orderStart, this.drag.orderEnd ?? this.drag.orderStart);
        this.rightPointerStart = undefined;
        delete this.drag.orderStart;
        delete this.drag.orderEnd;
      }
    });
  }

  private bindUI(): void {
    document.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((button) => {
      button.addEventListener("click", () => {
        this.speed = Number(button.dataset.speed);
        this.paused = false;
      });
    });
    document.getElementById("pause-button")?.addEventListener("click", () => { this.paused = !this.paused; });
    document.getElementById("terrain-button")?.addEventListener("click", () => this.toggleTerrainOverlay());
    document.querySelectorAll<HTMLButtonElement>("[data-command]").forEach((button) => {
      button.addEventListener("click", () => {
        const command = button.dataset.command;
        if (
          command === "line" ||
          command === "column" ||
          command === "mob"
        ) this.setFormation(command);
        else if (command === "ability") this.useUniqueAbilitySelected();
        else if (command === "hold") this.holdSelected();
        else if (command === "about-face") this.aboutFaceSelected();
        else if (command === "rally") this.rallySelected();
      });
    });
  }

  private toggleTerrainOverlay(): void {
    this.terrainOverlayEnabled = !this.terrainOverlayEnabled;
    this.ui.setTerrainOverlay(this.terrainOverlayEnabled);
  }

  private updateCamera(dt: number): void {
    const speed = 650 * dt;
    let dx = 0;
    let dy = 0;
    if (this.keys.has("a") || this.keys.has("arrowleft")) dx -= speed;
    if (this.keys.has("d") || this.keys.has("arrowright")) dx += speed;
    if (this.keys.has("w") || this.keys.has("arrowup")) dy -= speed;
    if (this.keys.has("s") || this.keys.has("arrowdown")) dy += speed;
    if (dx || dy) this.camera.panScreen(dx, dy, this.canvas.clientWidth, this.canvas.clientHeight);
  }

  private pointerPosition(event: PointerEvent | WheelEvent): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private toWorld(screen: Vec2): Vec2 {
    return this.camera.screenToWorld(screen, this.canvas.clientWidth, this.canvas.clientHeight);
  }

  private selectedUnits(): Unit[] {
    return this.units.filter((unit) =>
      unit.selected && unit.faction === "roman" && !isUnitInactive(unit));
  }

  private clearSelection(): void {
    for (const unit of this.units) unit.selected = false;
  }

  private completeSelection(start: Vec2, end: Vec2, additive: boolean): void {
    if (!additive) this.clearSelection();
    const moved = distance(start, end);
    if (moved < 6) {
      const world = this.toWorld(end);
      let closest: Unit | undefined;
      let best = Infinity;
      for (const unit of this.units) {
        if (unit.faction !== "roman" || isUnitInactive(unit)) continue;
        const d = distance(world, unit.position);
        if (d < formationRadius(unit) + 24 && d < best) {
          closest = unit;
          best = d;
        }
      }
      if (closest) closest.selected = additive ? !closest.selected : true;
      return;
    }
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    for (const unit of this.units) {
      if (unit.faction !== "roman" || isUnitInactive(unit)) continue;
      const screen = this.camera.worldToScreen(unit.position, this.canvas.clientWidth, this.canvas.clientHeight);
      if (screen.x >= minX && screen.x <= maxX && screen.y >= minY && screen.y <= maxY) unit.selected = true;
    }
  }

  private issueMove(destination: Vec2, dragEnd: Vec2): void {
    const selected = this.selectedUnits().filter((unit) =>
      unit.state !== "routing" && unit.formationChangeTimer <= 0);
    if (selected.length === 0) return;
    const layout = calculateFormationOrderLayout(
      destination,
      dragEnd,
      selected.map((unit) => ({
        frontageWidth: unit.formationWidth,
        boundaryMargin: formationRadius(unit) + 8,
      })),
      selected[0]?.facing ?? 0,
      { width: WORLD_WIDTH, height: WORLD_HEIGHT },
    );
    const assignments = assignFormationOrderPlacements(
      selected.map((unit) => unit.position),
      layout,
    );
    selected.forEach((unit, index) => {
      const placement = assignments[index];
      if (placement) {
        unit.pathCrossingX = undefined;
        unit.crossingPhase = undefined;
        unit.crossingOriginBank = undefined;
        unit.crossingLaneCommitted = false;
        assignFormationMoveOrder(
          unit,
          placement.destination,
          placement.facing,
          this.battlefield,
        );
      }
    });
  }

  private findEnemyAt(world: Vec2): Unit | undefined {
    let closest: Unit | undefined;
    let bestDistance = Infinity;
    for (const unit of this.units) {
      if (unit.faction !== "saxon" || isUnitInactive(unit)) continue;
      const unitDistance = distance(world, unit.position);
      if (
        isPointWithinAttackTarget(
          unit,
          world,
          attackTargetPaddingForZoom(this.camera.zoom),
        ) &&
        unitDistance < bestDistance
      ) {
        closest = unit;
        bestDistance = unitDistance;
      }
    }
    return closest;
  }

  private issueAttack(target: Unit): void {
    const usage = createEngagementSlotUsage();
    for (const unit of this.selectedUnits()) {
      const slot = selectEngagementSlot(unit, target, usage);
      if (!slot) continue;
      if (issueAttackOrder(unit, target, slot)) usage[slot.arc] += 1;
    }
  }

  private setFormation(formation: FormationType): void {
    for (const unit of this.selectedUnits()) {
      if (
        unit.state !== "routing" &&
        unit.formationChangeTimer <= 0 &&
        unit.formation !== formation
      ) applyFormation(unit, formation);
    }
  }

  private useUniqueAbilitySelected(): void {
    for (const unit of this.selectedUnits()) useUniqueAbility(unit);
  }

  private holdSelected(): void {
    for (const unit of this.selectedUnits()) {
      if (unit.state !== "routing" && unit.formationChangeTimer <= 0) {
        unit.pathingState = "direct";
        unit.stuckTimer = 0;
        unit.fallbackDestination = undefined;
        unit.pathCrossingX = undefined;
        unit.crossingPhase = undefined;
        unit.crossingOriginBank = undefined;
        unit.order = { type: "hold" };
      }
    }
  }

  private aboutFaceSelected(): void {
    for (const unit of this.selectedUnits()) {
      if (unit.state !== "routing" && unit.formationChangeTimer <= 0) {
        beginAboutFace(unit);
      }
    }
  }

  private rallySelected(): void {
    for (const unit of this.selectedUnits()) {
      if (
        unit.formationChangeTimer <= 0 &&
        (unit.state === "routing" || unit.state === "shaken")
      ) unit.order = { type: "rally" };
    }
  }
}
