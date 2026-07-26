import type { Unit } from "../units/types";
import type { BattleStats } from "../systems/Simulation";
import type { Vec2 } from "../core/math";
import type { RenderStats } from "../rendering/Renderer";
import { canUseUniqueAbility, getUniqueAbility } from "../units/abilities";
import { isUnitInactive } from "../units/types";

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing UI element #${id}`);
  return found as T;
};

export class UIController {
  private readonly unitName = element("unit-name");
  private readonly unitType = element("unit-type");
  private readonly strength = element("unit-strength");
  private readonly ammunition = element("unit-ammo");
  private readonly morale = element("unit-morale");
  private readonly moraleBar = element<HTMLElement>("morale-bar");
  private readonly cohesion = element("unit-cohesion");
  private readonly cohesionBar = element<HTMLElement>("cohesion-bar");
  private readonly stamina = element("unit-stamina");
  private readonly formation = element("unit-formation");
  private readonly terrain = element("unit-terrain");
  private readonly order = element("unit-order");
  private readonly abilityCommandLabel = element("ability-command-label");
  private readonly romanCount = element("roman-count");
  private readonly saxonCount = element("saxon-count");
  private readonly romanRouted = element("roman-routed");
  private readonly saxonRouted = element("saxon-routed");
  private readonly romanDestroyed = element("roman-destroyed");
  private readonly saxonDestroyed = element("saxon-destroyed");
  private readonly battleResult = element("battle-result");
  private readonly battleResultTitle = element("battle-result-title");
  private readonly battleResultDetail = element("battle-result-detail");
  private readonly debug = element("debug");
  private readonly debugFps = element("debug-fps");
  private readonly debugSoldiers = element("debug-soldiers");
  private readonly debugUnits = element("debug-units");
  private readonly debugSpeed = element("debug-speed");
  private readonly debugSelected = element("debug-selected");
  private readonly debugCulled = element("debug-culled");
  private readonly debugTerrain = element("debug-terrain");
  private readonly debugBodies = element("debug-bodies");
  private readonly debugEquipment = element("debug-equipment");
  private readonly debugEscapeVisuals = element("debug-escape-visuals");
  private readonly debugRender = element("debug-render");
  private readonly debugCamera = element("debug-camera");
  private readonly debugMouse = element("debug-mouse");

  update(
    units: Unit[],
    stats: BattleStats,
    fps: number,
    renderStats: RenderStats,
    speed: number,
    paused: boolean,
    cameraPosition: Vec2,
    mouseWorld: Vec2,
  ): void {
    const selected = units.filter((unit) => unit.selected);
    const focus = selected[0];
    if (focus) {
      this.unitName.textContent = selected.length > 1 ? `${selected.length} formations selected` : focus.name;
      this.unitType.textContent = selected.length > 1
        ? "Roman battle group"
        : `${focus.tacticalState} · ${focus.state} ${focus.type}`;
      this.strength.textContent = selected.length > 1
        ? `${selected.reduce((sum, unit) => sum + unit.soldierCount, 0)} soldiers`
        : `${focus.soldierCount} / ${focus.maximumSoldiers}`;
      this.ammunition.textContent = focus.type === "archers"
        ? `${focus.ammunition} / ${focus.maximumAmmunition} volleys`
        : "—";
      this.morale.textContent = `${Math.round(focus.morale)}%`;
      this.moraleBar.style.width = `${focus.morale}%`;
      this.cohesion.textContent = `${Math.round(focus.cohesion)}%`;
      this.cohesionBar.style.width = `${focus.cohesion}%`;
      this.stamina.textContent = `${Math.round(focus.stamina)}%`;
      this.formation.textContent = focus.formation;
      this.terrain.textContent = focus.terrain;
      this.order.textContent = focus.pathingState === "reorganising"
        ? `repathing ${focus.formationChangeTimer.toFixed(1)}s`
        : focus.pathingState === "fallback" ? "falling back"
          : focus.pathingState === "blocked" ? "route blocked"
          : focus.aboutFacePending
            ? `about face ${focus.formationChangeTimer.toFixed(1)}s`
          : focus.formationChangeTimer > 0
        ? `reforming ${focus.formationChangeTimer.toFixed(1)}s`
        : focus.state === "routing" ? "routing"
          : (focus.order.route?.length ?? 0) > 1 ? `${focus.order.type} via crossing`
            : focus.order.type;
    } else {
      this.unitName.textContent = "No unit selected";
      this.unitType.textContent = "Drag or click to select Romans";
      for (const node of [
        this.strength,
        this.ammunition,
        this.morale,
        this.cohesion,
        this.stamina,
        this.formation,
        this.terrain,
        this.order,
      ]) {
        node.textContent = "—";
      }
      this.moraleBar.style.width = "0";
      this.cohesionBar.style.width = "0";
    }
    this.romanCount.textContent = String(units.filter((unit) => unit.faction === "roman" && !isUnitInactive(unit)).length);
    this.saxonCount.textContent = String(units.filter((unit) => unit.faction === "saxon" && !isUnitInactive(unit)).length);
    this.romanRouted.textContent = String(stats.romanRouted);
    this.saxonRouted.textContent = String(stats.saxonRouted);
    this.romanDestroyed.textContent = String(stats.romanDestroyed);
    this.saxonDestroyed.textContent = String(stats.saxonDestroyed);
    this.updateBattleResult(stats);
    this.debugFps.textContent = `FPS: ${Math.round(fps)}`;
    this.debugSoldiers.textContent = `Visible soldiers: ${renderStats.visibleSoldiers}`;
    this.debugCulled.textContent = `Culled soldiers: ${renderStats.culledSoldiers}`;
    this.debugTerrain.textContent = `Terrain objects: ${renderStats.visibleTerrainObjects}`;
    this.debugBodies.textContent = `Bodies: ${renderStats.visibleBodies}`;
    this.debugEquipment.textContent = `Equipment: ${renderStats.visibleEquipment}`;
    this.debugEscapeVisuals.textContent = `Escape visuals: ${renderStats.visibleEscapeVisuals}`;
    this.debugRender.textContent = `Render: ${renderStats.renderTimeMs.toFixed(2)} ms`;
    this.debugCamera.textContent = `Camera: ${cameraPosition.x.toFixed(0)}, ${cameraPosition.y.toFixed(0)}`;
    this.debugMouse.textContent = `Mouse: ${mouseWorld.x.toFixed(0)}, ${mouseWorld.y.toFixed(0)}`;
    this.debugUnits.textContent = `Active units: ${units.filter((unit) => !isUnitInactive(unit)).length}`;
    this.debugSpeed.textContent = `Game speed: ${paused ? "paused" : `${speed}×`}`;
    this.debugSelected.textContent = `Selected: ${selected.map((unit) => unit.id).join(", ") || "none"}`;
    document.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((button) => {
      button.classList.toggle("active", !paused && Number(button.dataset.speed) === speed);
    });
    element("pause-button").classList.toggle("active", paused);
    const abilityButton = document.querySelector<HTMLButtonElement>('[data-command="ability"]');
    const selectedAbilities = selected
      .map((unit) => getUniqueAbility(unit))
      .filter((ability) => ability !== undefined);
    const abilityLabels = new Set(selectedAbilities.map((ability) => ability.label));
    const abilityLabel = selected.length === 0
      ? "Unique ability"
      : selectedAbilities.length === 0
        ? "No ability"
        : abilityLabels.size === 1
          ? selectedAbilities[0]?.label ?? "Unique ability"
          : "Use abilities";
    this.abilityCommandLabel.textContent = abilityLabel;
    abilityButton?.setAttribute("aria-label", `G ${abilityLabel}`);
    document.querySelectorAll<HTMLButtonElement>("[data-command]").forEach((button) => {
      const command = button.dataset.command;
      if (command === "ability") {
        const abilityActive = selectedAbilities.length > 0 &&
          selected.every((unit) => {
            const ability = getUniqueAbility(unit);
            return ability !== undefined && unit.formation === ability.formation;
          });
        button.classList.toggle("active", abilityActive);
        button.disabled = !selected.some((unit) => canUseUniqueAbility(unit));
        return;
      }
      const formationActive = command === focus?.formation;
      button.classList.toggle("active", formationActive);
      button.disabled = Boolean(focus && focus.formationChangeTimer > 0);
    });
  }

  private updateBattleResult(stats: BattleStats): void {
    this.battleResult.hidden = stats.outcome === "ongoing";
    if (stats.outcome === "ongoing") return;
    if (stats.outcome === "romanVictory") {
      this.battleResultTitle.textContent = "Roman Victory";
      this.battleResultDetail.textContent =
        "The Saxon warband has collapsed. Its battle standard has been abandoned.";
    } else if (stats.outcome === "saxonVictory") {
      this.battleResultTitle.textContent = "Roman Defeat";
      this.battleResultDetail.textContent =
        "The Roman line has collapsed and its surviving standard bearers have withdrawn.";
    } else {
      this.battleResultTitle.textContent = "Mutual Destruction";
      this.battleResultDetail.textContent =
        "Neither army retains an effective fighting formation.";
    }
  }

  toggleDebug(): boolean {
    this.debug.hidden = !this.debug.hidden;
    return !this.debug.hidden;
  }

  setTerrainOverlay(enabled: boolean): void {
    const button = element<HTMLButtonElement>("terrain-button");
    button.classList.toggle("active", enabled);
    button.setAttribute("aria-pressed", String(enabled));
    button.setAttribute("aria-label", enabled ? "Hide terrain map" : "Show terrain map");
    element("terrain-legend").hidden = !enabled;
  }
}
