import { executeCommand, commandLegality, moveIsCommitted, type GameCommand } from "../commands/executeCommand";
import { planOrder } from "../commands/planOrder";
import { eventsSince } from "../events/events";
import { blocksAt } from "../model/occupancy";
import { BALANCE } from "../model/config";
import type { BattleAction, Direction, FactionId, Formation, GameState, GridPosition, OrderConfirmationPreview, PressurePreview, TroopBlock } from "../model/types";
import { attackingPressure, chargePreview, defendingResistance, pressurePreview, rearSupport } from "../rules/combat";
import { pressureCalculationLines } from "../rules/combatPreview";
import { mergeCandidates } from "../rules/formationActions";
import { moveDirectionFromCell } from "../rules/movement";
import { connectedComponents, provisionalFormationFamily } from "../rules/splitting";
import { blockIsWavering, formationIsEngaged } from "../rules/engagement";
import { formationFamilyIsRouted } from "../rules/routing";
import { remainingActivations } from "../rules/turnSystem";
import { effectiveBlockFacing } from "../rules/blockFacing";
import { createPrototypeGridScenario } from "../scenario/prototypeScenario";
import type { GridBattleScenarioFactory } from "../scenario/campaignScenario";
import { BattlefieldRenderer } from "../rendering/BattlefieldRenderer";
import type { AnimationSpeed } from "../rendering/AnimationQueue";
import { blockHitPoints, hasEquipment, isCavalry } from "../model/unitStats";
import { rangedAttackPreview, type RangedAttackPreview } from "../rules/rangedCombat";
import { getRangedWeaponProfile } from "../../units/RangedWeapons";
import { planAiActivation, type AiActivationPlan } from "../ai/formationAi";
import type { MissionObjectiveDefinition, ObjectiveOutcome } from "../rules/campaignObjectives";
import {
  compileFormationBattleResults,
  type FormationBattleBaseline,
  type GridFormationBattleResult,
} from "../rules/battleReporting";

export interface GridBattleConclusion {
  outcome: "romanVictory" | "saxonVictory" | "mutualDestruction";
  romanStrength: number;
  romanMaximumStrength: number;
  romanFormations: readonly GridFormationBattleResult[];
}

type UiAction = BattleAction | "end";

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing grid battle element #${id}`);
  return element as T;
}

function definitionRows(values: readonly [string, string | number][]): HTMLElement[] {
  return values.map(([label, value]) => {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = String(value);
    row.append(term, detail);
    return row;
  });
}

export class GridBattleController {
  private state: GameState;
  private readonly renderer: BattlefieldRenderer;
  private readonly events = new AbortController();
  private debugVisible = false;
  private moraleVisible = false;
  private concluded = false;
  private started = false;
  private rendererReady = false;
  private pendingOrder: { preview: OrderConfirmationPreview; command: GameCommand } | null = null;
  private computerTimer: number | null = null;
  private computerBusy = false;
  private readonly romanFormationBaselines: readonly FormationBattleBaseline[];

  constructor(
    canvas: HTMLCanvasElement,
    private readonly onConclude: (result: GridBattleConclusion) => void,
    private readonly createScenario: GridBattleScenarioFactory = createPrototypeGridScenario,
    private readonly computerFactionId: FactionId | null = "saxon",
    private readonly objectiveDefinition?: MissionObjectiveDefinition,
    private readonly allowManualConclusion = true,
    private readonly enemyLabel = "Saxons",
  ) {
    this.state = this.createScenario();
    this.romanFormationBaselines = Object.values(this.state.formations)
      .filter((formation) => formation.factionId === "roman")
      .map((formation) => ({
        id: formation.id,
        name: formation.name,
        maximumStrength: formation.initialModelCount,
      }));
    this.renderer = new BattlefieldRenderer(canvas, {
      onCellTap: (position) => this.handleCellTap(position),
      onCellHover: (position) => this.handleCellHover(position),
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.renderer.init();
    this.rendererReady = true;
    if (!this.started) {
      this.renderer.destroy();
      this.rendererReady = false;
      return;
    }
    this.bindUi();
    requiredElement<HTMLButtonElement>("grid-reset").disabled = false;
    this.renderAll();
    this.scheduleComputerTurn();
  }

  private factionLabel(factionId: FactionId): string {
    return factionId === "roman" ? "Romans" : this.enemyLabel;
  }

  private inputLocked(): boolean {
    return this.concluded || this.isComputerTurn();
  }

  private selectedFormation(): Formation | undefined {
    return this.state.selectedFormationId ? this.state.formations[this.state.selectedFormationId] : undefined;
  }

  private selectedBlock(): TroopBlock | undefined {
    return this.state.selectedBlockId ? this.state.blocks[this.state.selectedBlockId] : undefined;
  }

  private dispatch(command: GameCommand, confirmed = false): boolean {
    const firstNewEventId = this.state.nextEventId;
    const result = executeCommand(this.state, command, { confirmed });
    if (!result.accepted) {
      requiredElement("grid-action-help").textContent = result.reason ?? "That command is not legal.";
      return false;
    }
    this.pendingOrder = null;
    if (confirmed) requiredElement("grid-action-help").textContent = "Order confirmed and resolved.";
    this.renderer.enqueueEvents(eventsSince(this.state.eventLog, firstNewEventId));
    this.renderAll();
    this.checkAutomaticConclusion();
    this.scheduleComputerTurn();
    return true;
  }

  private isComputerTurn(): boolean {
    return this.computerFactionId !== null && this.state.activeFactionId === this.computerFactionId;
  }

  private computerStepDelay(plan: AiActivationPlan, stepIndex: number): number {
    const command = plan.steps[stepIndex]?.command;
    if (!command) return 220;
    if (command.type === "select_cell") return 360;
    if (command.type === "shoot") return BALANCE.animationMs.ranged + 160;
    if (command.type === "battle" || command.type === "press") return BALANCE.animationMs.melee + 180;
    if (command.type === "charge") return BALANCE.animationMs.impact + 220;
    return command.type === "move" ? BALANCE.animationMs.move + 100 : 240;
  }

  private scheduleComputerTurn(delayMs = 420): void {
    if (!this.started || this.concluded || this.computerBusy || this.computerTimer !== null
      || !this.isComputerTurn() || this.pendingOrder) return;
    requiredElement("grid-action-help").textContent = `${this.factionLabel(this.state.activeFactionId)} are considering their next order…`;
    this.computerTimer = window.setTimeout(() => {
      this.computerTimer = null;
      this.runComputerActivation();
    }, delayMs);
  }

  private runComputerActivation(): void {
    if (!this.started || this.concluded || !this.isComputerTurn()) return;
    const plan = planAiActivation(this.state, this.state.activeFactionId);
    if (!plan) {
      requiredElement("grid-action-help").textContent = "The computer has no legal formation to activate.";
      return;
    }
    this.computerBusy = true;
    requiredElement("grid-action-help").textContent = plan.summary;
    this.executeComputerStep(plan, 0);
  }

  private executeComputerStep(plan: AiActivationPlan, stepIndex: number): void {
    if (!this.started || this.concluded || !this.isComputerTurn()) {
      this.computerBusy = false;
      return;
    }
    const step = plan.steps[stepIndex];
    if (!step) {
      this.computerBusy = false;
      requiredElement("grid-action-help").textContent = plan.summary;
      this.renderUi();
      this.scheduleComputerTurn(320);
      return;
    }
    if (!this.dispatch(step.command, step.confirmed)) {
      this.computerBusy = false;
      this.abandonComputerOrder(plan);
      return;
    }
    this.computerTimer = window.setTimeout(() => {
      this.computerTimer = null;
      this.executeComputerStep(plan, stepIndex + 1);
    }, this.computerStepDelay(plan, stepIndex));
  }

  /** A rejected AI order must not stop the battle: end that activation and let the turn move on. */
  private abandonComputerOrder(plan: AiActivationPlan): void {
    this.state.currentAction = null;
    if (!this.dispatch({ type: "end_activation" })) {
      requiredElement("grid-action-help").textContent = `${plan.formationName} could not finish its order.`;
    }
  }

  private planAndDispatch(command: GameCommand): boolean {
    const planned = planOrder(this.state, command);
    if (!planned.ok || !planned.order) {
      requiredElement("grid-action-help").textContent = planned.reason ?? "That command is not legal.";
      return false;
    }
    if (planned.order.confirmation) {
      this.beginOrderPreview(planned.order.confirmation, planned.order.command);
      return true;
    }
    return this.dispatch(planned.order.command);
  }

  private handleCellTap(position: GridPosition): void {
    if (this.pendingOrder || this.inputLocked()) return;
    const formation = this.selectedFormation();
    const occupants = blocksAt(this.state, position);
    const enemy = occupants.find((block) => formation && block.factionId !== formation.factionId);
    const action = this.state.currentAction;
    if (formation && action === "move") {
      const direction = moveDirectionFromCell(formation, this.state, position);
      if (direction) {
        this.planAndDispatch({ type: "move", direction });
        if (formationIsEngaged(this.state, formation.id)) requiredElement("grid-action-help").textContent = "Contact made. Choose the formation's final facing to finish the move.";
      }
      else requiredElement("grid-action-help").textContent = "Click a highlighted adjacent footprint.";
      return;
    }
    if (formation && action === "attack" && enemy) {
      const attacker = this.attackSourceFor(enemy.id, false);
      if (!attacker) {
        requiredElement("grid-action-help").textContent = "No front block contacts that enemy.";
        return;
      }
      this.planAndDispatch({ type: "attack", attackerId: attacker.id, defenderId: enemy.id });
      return;
    }
    if (formation && action === "charge" && enemy) {
      const attacker = this.attackSourceFor(enemy.id, true);
      if (attacker) this.planAndDispatch({ type: "charge", attackerId: attacker.id, defenderId: enemy.id });
      else requiredElement("grid-action-help").textContent = "No block has a legal forward charge lane to that target.";
      return;
    }
    if (formation && action === "shoot" && enemy) {
      const preview = rangedAttackPreview(this.state, formation.id, enemy.id);
      if (preview) this.planAndDispatch({ type: "shoot", defenderId: enemy.id });
      else requiredElement("grid-action-help").textContent = "Target must be in the formation's forward arc, range, and line of sight.";
      return;
    }
    if (formation && action === "reform" && this.state.selectedBlockId) {
      const selected = this.selectedBlock()!;
      const friendlyTarget = occupants.find((block) => block.formationId === formation.id && block.id !== selected.id);
      if (selected.characterId && friendlyTarget) {
        this.planAndDispatch({ type: "transfer_character", characterId: selected.characterId, targetBlockId: friendlyTarget.id });
      } else {
        this.planAndDispatch({ type: "reform", blockId: selected.id, destination: position });
      }
      return;
    }
    if (formation && action === "merge") {
      const target = occupants.find((block) => block.factionId === formation.factionId && block.formationId !== formation.id);
      if (target?.formationId) this.planAndDispatch({ type: "merge", otherFormationId: target.formationId });
      return;
    }
    this.dispatch({ type: "select_cell", position });
  }

  private beginOrderPreview(preview: OrderConfirmationPreview, command: GameCommand): void {
    this.pendingOrder = { preview, command };
    requiredElement("grid-action-help").textContent = "Review the shadow destinations, then confirm or cancel.";
    this.renderAll();
  }

  private confirmPendingOrder(): void {
    const pending = this.pendingOrder;
    if (pending) this.dispatch(pending.command, true);
  }

  private cancelPendingOrder(): void {
    if (!this.pendingOrder) return;
    this.pendingOrder = null;
    requiredElement("grid-action-help").textContent = "Preview cancelled. Choose another destination.";
    this.renderAll();
  }

  private attackSourceFor(defenderId: string, charge: boolean): TroopBlock | undefined {
    const formation = this.selectedFormation();
    if (!formation) return undefined;
    const preferred = this.selectedBlock();
    if (preferred && (charge ? chargePreview(this.state, preferred.id, defenderId) : pressurePreview(this.state, preferred.id, defenderId))) return preferred;
    return formation.blockIds
      .map((id) => this.state.blocks[id])
      .find((block) => block && (charge ? chargePreview(this.state, block.id, defenderId) : pressurePreview(this.state, block.id, defenderId)));
  }

  private handleCellHover(position: GridPosition | null): void {
    const hover = requiredElement("grid-hover-info");
    if (!position) {
      hover.textContent = "Hover a square to inspect it";
      return;
    }
    hover.textContent = `${String.fromCharCode(65 + position.x)}${position.y + 1} · ${this.renderer.terrainDescription(position)}`;
    const formation = this.selectedFormation();
    if (!formation || (this.state.currentAction !== "attack" && this.state.currentAction !== "charge" && this.state.currentAction !== "shoot")) return;
    const enemy = blocksAt(this.state, position).find((block) => block.factionId !== formation.factionId);
    if (!enemy) return;
    if (this.state.currentAction === "shoot") {
      this.renderRangedPreview(rangedAttackPreview(this.state, formation.id, enemy.id));
      return;
    }
    const attacker = this.attackSourceFor(enemy.id, this.state.currentAction === "charge");
    if (!attacker) return;
    if (this.state.currentAction === "attack") this.renderCombatPreview(pressurePreview(this.state, attacker.id, enemy.id));
    else {
      const charge = chargePreview(this.state, attacker.id, enemy.id);
      requiredElement("grid-combat-preview").textContent = charge
        ? isCavalry(charge.unitType)
          ? `Charge lane ${charge.distance} squares · momentum ${charge.momentum} · impact ${charge.impactDamage}, then local pressure.`
          : `Infantry charge ${charge.distance} ${charge.distance === 1 ? "square" : "squares"} · ${charge.bonusNullified ? "attack bonus nullified by braced front" : `+${charge.attackBonus} attack pressure`}.`
        : "That target is not in a legal charge lane.";
    }
  }

  private renderCombatPreview(preview: PressurePreview | null): void {
    const panel = requiredElement("grid-combat-preview");
    if (!preview) {
      panel.textContent = "Choose Attack, then hover or click a highlighted enemy block.";
      return;
    }
    panel.replaceChildren();
    const lines = [
      `Pressure ${preview.attackingPressure} vs resistance ${preview.defendingResistance}`,
      `Damage range ${preview.minimumDamage}–${preview.maximumDamage} · ${preview.defence}% evade from defence`,
      `On a hit: attack ${preview.rawDamage} vs ${preview.armour + preview.shieldArmour + preview.braceArmour} protection${preview.damagePenalty > 0 ? ` and ${preview.damagePenalty} order penalty` : ""}`,
      `Seeded result this round: ${preview.expectedDamage} damage · ${preview.expectedCasualties} ${preview.expectedCasualties === 1 ? "model" : "models"} lost`,
      `Net ${preview.netPressure}: ${preview.expectedResult}`,
      preview.retreatHazard
        ? preview.retreatHazard === "river_deep"
          ? "Retreat enters deep water: affected blocks drown"
          : "Retreat crosses a cliff of more than one level: affected blocks are destroyed"
        : preview.result === "holds" || preview.result === "wavers"
        ? "No retreat predicted"
        : preview.retreatMode === "chaotic"
        ? `Chaotic retreat: ${preview.retreatDestinations.map((position) => `${String.fromCharCode(65 + position.x)}${position.y + 1}`).join(", ")}`
        : `Good-order retreat: ${String.fromCharCode(65 + preview.retreatDestination.x)}${preview.retreatDestination.y + 1}`,
      preview.cascadeLength > 0 ? `Cascade may displace ${preview.cascadeLength} block(s)` : "No friendly retreat cascade predicted",
      preview.mayCompress ? "Retreat is blocked: compression and contested melee possible" : "Retreat space is available",
      ...preview.characterModifiers,
    ];
    for (const line of lines) {
      const row = document.createElement("div");
      row.textContent = line;
      panel.append(row);
    }
    const calculationLines = pressureCalculationLines(preview);
    const addMathButton = (label: string, details: readonly string[]): void => {
      const button = document.createElement("button");
      const detail = document.createElement("div");
      button.type = "button";
      button.className = "grid-preview-math-button";
      button.textContent = label;
      button.setAttribute("aria-expanded", "false");
      detail.className = "grid-preview-math-detail";
      detail.hidden = true;
      detail.textContent = details.join("\n");
      button.addEventListener("click", () => {
        detail.hidden = !detail.hidden;
        button.setAttribute("aria-expanded", String(!detail.hidden));
        button.textContent = detail.hidden ? label : "Hide math";
      });
      panel.append(button, detail);
    };
    addMathButton("Damage math", calculationLines.slice(3));
    addMathButton("Position math", calculationLines.slice(0, 3));
  }

  private renderRangedPreview(preview: RangedAttackPreview | null): void {
    const panel = requiredElement("grid-combat-preview");
    if (!preview) {
      panel.textContent = "Choose Shoot, then hover or click a highlighted enemy block.";
      return;
    }
    panel.replaceChildren();
    const distanceLabel = preview.distance === preview.farthestDistance
      ? String(preview.distance)
      : `${preview.distance}–${preview.farthestDistance}`;
    const lines = [
      `${preview.weaponLabel} · firing distance ${distanceLabel} squares (range ${preview.minimumRange}–${preview.maximumRange})`,
      `${preview.firingBlockCount}/${preview.totalBlockCount} blocks firing → ${preview.impactCount} target blocks hit`,
      `${preview.firingModelCount} participating models · ${preview.minimumDamage}–${preview.maximumDamage} damage range`,
      `${preview.ammunition} ammunition remaining · the volley spends 1`,
      `${preview.damage} deterministic damage · ${preview.casualties} ${preview.casualties === 1 ? "model" : "models"} lost`,
      `Target edge: ${preview.targetEdge} · shields block ${preview.shieldedImpactCount}/${preview.impactCount} lanes · armour ×${preview.armourMultiplier.toFixed(2)}`,
    ];
    for (const line of lines) {
      const row = document.createElement("div");
      row.textContent = line;
      panel.append(row);
    }
    const detail = document.createElement("details");
    const summary = document.createElement("summary");
    const math = document.createElement("div");
    summary.textContent = "Volley math";
    math.className = "grid-preview-math-detail";
    math.textContent = preview.math.join("\n");
    detail.append(summary, math);
    panel.append(detail);
  }

  private chooseAction(action: UiAction): void {
    if (this.pendingOrder || this.inputLocked()) return;
    if (action === "end") {
      this.planAndDispatch({ type: "end_activation" });
      return;
    }
    const formation = this.selectedFormation();
    if (!formation) {
      requiredElement("grid-action-help").textContent = "Select a formation belonging to the active faction.";
      return;
    }
    const legality = commandLegality(this.state, action);
    if (!legality.accepted) {
      requiredElement("grid-action-help").textContent = legality.reason ?? "That action is illegal.";
      return;
    }
    if (action === "hold" || action === "brace" || action === "fall_back" || action === "battle" || action === "press") {
      this.planAndDispatch({ type: action });
      return;
    }
    if (action === "merge") {
      const candidates = mergeCandidates(this.state, formation.id);
      if (candidates.length === 1) {
        this.planAndDispatch({ type: "merge", otherFormationId: candidates[0]! });
        return;
      }
    }
    this.planAndDispatch({ type: "choose_action", action });
    const help: Record<BattleAction, string> = {
      move: "Click highlighted cardinal translations, then choose the final facing. Blocks pivot in place.",
      attack: "Click a highlighted enemy block directly ahead of a front block.",
      shoot: "Click a highlighted enemy. Every block with range and line of sight strikes a separate block in that target formation; frontal shields block some lanes.",
      charge: "Click an enemy in the forward lane. Infantry charge 1–2 squares; difficult terrain limits them to 1.",
      reform: "Click a green destination, or an adjacent friendly block to transfer the selected character.",
      merge: "Click a connected friendly fragment with matching facing.",
      brace: "Brace in place for +1 armour. The bonus lasts until any block in the formation moves.",
      hold: "Hold position.",
      fall_back: "Reverse one square and leave contact if the rear is clear.",
      battle: "Fight every contact. Pressure moves the enemy only if its formation loses morale; blocks closing a gap fight immediately.",
      press: "Gain +2 pressure but inflict 1 fewer casualty per attack; steady files advance into space the enemy gives up.",
    };
    requiredElement("grid-action-help").textContent = help[action];
    if (action === "shoot") this.renderRangedPreview(null);
  }

  private toggleDebug(): void {
    this.debugVisible = !this.debugVisible;
    const button = requiredElement<HTMLButtonElement>("grid-debug-toggle");
    button.setAttribute("aria-pressed", String(this.debugVisible));
    requiredElement("grid-debug-panel").hidden = !this.debugVisible;
    this.renderer.setDebugVisible(this.debugVisible);
  }

  private toggleMorale(): void {
    this.moraleVisible = !this.moraleVisible;
    const button = requiredElement<HTMLButtonElement>("grid-morale-toggle");
    button.setAttribute("aria-pressed", String(this.moraleVisible));
    button.textContent = this.moraleVisible ? "Morale: on" : "Morale view";
    requiredElement("grid-morale-key").hidden = !this.moraleVisible;
    this.renderer.setMoraleVisible(this.moraleVisible);
  }

  private requestReset(): void {
    if (this.concluded) return;
    if (window.confirm("Restart this battle from the beginning? Current progress in it will be lost.")) this.reset();
  }

  private reset(): void {
    if (this.computerTimer !== null) window.clearTimeout(this.computerTimer);
    this.computerTimer = null;
    this.computerBusy = false;
    this.state = this.createScenario();
    this.pendingOrder = null;
    this.renderer.render(this.state, null);
    this.renderUi();
  }

  private bindUi(): void {
    const options = { signal: this.events.signal };
    requiredElement("grid-actions").addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-grid-action]");
      if (button) this.chooseAction(button.dataset.gridAction as UiAction);
    }, options);
    requiredElement("grid-move-facing").addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-grid-facing]");
      if (button && !this.inputLocked()) this.planAndDispatch({ type: "finish_move", facing: button.dataset.gridFacing as Direction });
    }, options);
    requiredElement("grid-order-confirm-accept").addEventListener("click", () => this.confirmPendingOrder(), options);
    requiredElement("grid-order-confirm-cancel").addEventListener("click", () => this.cancelPendingOrder(), options);
    requiredElement("grid-debug-panel").addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-grid-debug]");
      if (!button) return;
      const commands: Record<string, GameCommand["type"]> = {
        damage: "debug_damage", retreat: "debug_retreat", route: "debug_route", split: "debug_split",
        contested: "debug_contested", resolve: "debug_resolve", restore: "debug_restore",
      };
      const type = commands[button.dataset.gridDebug ?? ""];
      if (type) this.dispatch({ type } as GameCommand);
    }, options);
    requiredElement("grid-debug-toggle").addEventListener("click", () => this.toggleDebug(), options);
    requiredElement("grid-morale-toggle").addEventListener("click", () => this.toggleMorale(), options);
    requiredElement("grid-axes-toggle").addEventListener("click", () => {
      const visible = this.renderer.toggleAxes();
      requiredElement("grid-axes-toggle").setAttribute("aria-pressed", String(visible));
    }, options);
    requiredElement("grid-frame-camera").addEventListener("click", () => this.renderer.frameBattlefield(), options);
    requiredElement("grid-reset").addEventListener("click", () => this.requestReset(), options);
    requiredElement("grid-conclude").addEventListener("click", () => this.conclude(), options);
    requiredElement("grid-conclude").hidden = !this.allowManualConclusion;
    requiredElement<HTMLSelectElement>("grid-animation-speed").addEventListener("change", (event) => {
      this.renderer.setAnimationSpeed(Number((event.target as HTMLSelectElement).value) as AnimationSpeed);
    }, options);
    this.renderer.app.canvas.addEventListener("contextmenu", () => this.cancelAction(), options);
    window.addEventListener("keydown", this.handleKeyDown, options);
    window.addEventListener("keyup", this.handleKeyUp, options);
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (this.concluded || (event.target as HTMLElement).matches("input, select, textarea")) return;
    const key = event.key.toLowerCase();
    const shortcuts: Partial<Record<string, UiAction>> = {
      m: "move", a: "attack", s: "shoot", c: "charge", r: "reform", g: "merge", x: "brace", h: "hold",
      v: "fall_back", b: "battle", p: "press",
    };
    if (event.code === "Space") { event.preventDefault(); return; }
    if (event.key === "Enter" && this.pendingOrder) { event.preventDefault(); this.confirmPendingOrder(); return; }
    if (key === "d") { event.preventDefault(); this.toggleDebug(); return; }
    if (key === "escape") { event.preventDefault(); this.cancelAction(); return; }
    if (key === "backspace") {
      event.preventDefault();
      if (!event.repeat) this.requestReset();
      return;
    }
    const action = shortcuts[key];
    if (action) { event.preventDefault(); this.chooseAction(action); }
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if ((event.target as HTMLElement).matches("input, select, textarea")) return;
    if (event.code === "Space" && !this.pendingOrder && this.renderer.consumeSpaceTap()) {
      event.preventDefault();
      this.chooseAction("end");
    }
  };

  private cancelAction(): void {
    if (this.pendingOrder) {
      this.cancelPendingOrder();
      return;
    }
    if (this.isComputerTurn()) return;
    if (moveIsCommitted(this.state)) {
      requiredElement("grid-action-help").textContent = "This formation has already moved. Choose its final facing to finish.";
      return;
    }
    this.state.currentAction = null;
    this.state.phase = this.state.selectedFormationId ? "choosing_action" : "selecting";
    requiredElement("grid-action-help").textContent = "Action cancelled.";
    this.renderAll();
  }

  private renderFormationPanel(): void {
    const formation = this.selectedFormation();
    const name = requiredElement("grid-formation-name");
    const stats = requiredElement("grid-formation-stats");
    if (!formation) {
      name.textContent = "No formation selected";
      stats.replaceChildren();
      return;
    }
    const blocks = formation.blockIds.map((id) => this.state.blocks[id]).filter((block) => block !== undefined);
    const characters = blocks.map((block) => block.characterId ? this.state.characters[block.characterId]?.name : null).filter(Boolean);
    const family = provisionalFormationFamily(this.state, formation.id);
    const hasStragglers = family.some((candidate) => candidate.blockIds.length <= BALANCE.stragglerBlockThreshold);
    const breakup = formation.provisionalFamilyId
      ? `${family.length} bodies — shared activation · ${hasStragglers ? "stragglers attached" : `regroup ${formation.failedRegroupActivations ?? 0}/${BALANCE.fragmentRegroupGraceActivations}`}`
      : formation.status === "fragment" ? "Independent fragment" : "Unified";
    const moraleState = formation.cohesion <= 0 ? "Routed"
      : formation.cohesion <= BALANCE.breakingMoraleThreshold ? "Breaking"
        : formation.cohesion < 7 ? "Shaken" : "Steady";
    const rangedWeapon = formation.unit.rangedWeaponId
      ? getRangedWeaponProfile(formation.unit.rangedWeaponId)
      : null;
    name.textContent = formation.name;
    stats.replaceChildren(...definitionRows([
      ["Faction", this.factionLabel(formation.factionId)],
      ["Status", formation.status],
      ["Engagement", formationIsEngaged(this.state, formation.id) ? "Engaged" : "Free"],
      ["Breakup", breakup],
      ["Facing", formation.facing],
      ["Formation", formation.formationMode],
      ["Unit type", formation.unit.unitType.replaceAll("_", " ")],
      ["Blocks", blocks.length],
      ["Models", blocks.reduce((sum, block) => sum + block.models, 0)],
      ["Model size", formation.unit.modelSize],
      ["Attack", formation.unit.attack],
      ["Ranged weapon", rangedWeapon?.label ?? "None"],
      ["Ammunition", rangedWeapon ? `${formation.ammunition ?? 0} ${rangedWeapon.ammunitionLabel}` : "—"],
      ["Armour", formation.unit.armour],
      ["Defence", `${formation.unit.defence}%`],
      ["HP per model", formation.unit.hitPointsPerModel],
      ["Morale", `${formation.cohesion}/${formation.maxCohesion}`],
      ["Morale state", moraleState],
      ["Movement", formation.movementRemaining],
      ["Stance", formation.isBraced ? "Braced (+1 armour)" : "Mobile"],
      ["Characters", characters.join(", ") || "None"],
      ["Connectivity", connectedComponents(this.state, formation.id).length === 1 ? "Intact" : "Broken"],
    ]));
  }

  private renderBlockPanel(): void {
    const block = this.selectedBlock();
    const name = requiredElement("grid-block-name");
    const stats = requiredElement("grid-block-stats");
    if (!block) {
      name.textContent = "Click a selected formation block again";
      stats.replaceChildren();
      return;
    }
    const character = block.characterId ? this.state.characters[block.characterId] : undefined;
    const formation = block.formationId ? this.state.formations[block.formationId] : undefined;
    name.textContent = block.id;
    stats.replaceChildren(...definitionRows([
      ["Models", `${block.models}/${block.modelCapacity}`],
      ["Hit points", formation ? blockHitPoints(formation, block) : 0],
      ["Facing", effectiveBlockFacing(this.state, block.id)],
      ["Morale", blockIsWavering(this.state, block.id) ? "Wavering" : "Steady"],
      ["Pressure", attackingPressure(this.state, block.id)],
      ["Resistance", defendingResistance(this.state, block.id, effectiveBlockFacing(this.state, block.id))],
      ["Shield", formation && hasEquipment(formation, "shield_front") ? "+1 frontal armour" : "None"],
      ["Equipment", formation?.unit.equipment.join(", ").replaceAll("_", " ") || "None"],
      ["Rear support", rearSupport(this.state, block.id)],
      ["Host character", character ? `${character.name} (${character.role})` : "None"],
      ["Contested", block.isContested ? "Yes" : "No"],
    ]));
  }

  private renderActions(): void {
    const formation = this.selectedFormation();
    const engaged = formation ? formationIsEngaged(this.state, formation.id) : false;
    document.querySelectorAll<HTMLButtonElement>("[data-grid-action]").forEach((button) => {
      const action = button.dataset.gridAction as UiAction;
      const mode = button.dataset.actionMode;
      button.hidden = mode === "normal" ? engaged : mode === "engaged" ? !engaged : false;
      const legality = action === "end" ? { accepted: Boolean(formation), reason: "Select a formation first." }
        : commandLegality(this.state, action);
      const accepted = legality.accepted;
      button.disabled = !accepted || Boolean(this.pendingOrder) || this.isComputerTurn();
      if (!accepted && legality.reason) button.title = legality.reason;
      button.classList.toggle("active", this.state.currentAction === action);
    });
    const facingPanel = requiredElement("grid-move-facing");
    const choosingMoveFacing = Boolean(formation && this.state.currentAction === "move") && !this.isComputerTurn();
    facingPanel.hidden = !choosingMoveFacing || Boolean(this.pendingOrder);
    facingPanel.querySelectorAll<HTMLButtonElement>("[data-grid-facing]").forEach((button) => {
      button.disabled = !choosingMoveFacing || formationFamilyIsRouted(this.state, formation!.id);
      button.classList.toggle("current", button.dataset.gridFacing === formation?.facing);
    });
    const confirmPanel = requiredElement("grid-order-confirm");
    confirmPanel.hidden = !this.pendingOrder;
    if (this.pendingOrder) {
      requiredElement("grid-order-confirm-title").textContent = this.pendingOrder.preview.title;
      requiredElement("grid-order-confirm-detail").textContent = this.pendingOrder.preview.detail;
      requiredElement("grid-order-confirm-forecast").replaceChildren(...(this.pendingOrder.preview.forecast ?? []).map((line) => {
        const item = document.createElement("li");
        item.textContent = line;
        return item;
      }));
    }
  }

  private renderLog(): void {
    const log = requiredElement<HTMLOListElement>("grid-combat-log");
    const rows = this.state.eventLog.slice(-12).reverse().map((event) => {
      const item = document.createElement("li");
      item.textContent = event.message;
      return item;
    });
    if (rows.length === 0) {
      const item = document.createElement("li");
      item.textContent = "Round 1: Romans choose the first formation.";
      rows.push(item);
    }
    log.replaceChildren(...rows);
  }

  private renderObjective(): void {
    const status = requiredElement("grid-objective-status");
    const progress = requiredElement<HTMLUListElement>("grid-objective-progress");
    if (!this.objectiveDefinition) {
      status.textContent = "Break the opposing force.";
      progress.replaceChildren();
      return;
    }
    const evaluation = this.objectiveDefinition.evaluate(this.state);
    status.textContent = evaluation.status;
    progress.replaceChildren(...evaluation.progress.map((entry) => {
      const item = document.createElement("li");
      item.className = entry.state;
      const label = document.createElement("span");
      label.textContent = entry.label;
      const value = document.createElement("strong");
      value.textContent = entry.value;
      item.append(label, value);
      return item;
    }));
  }

  private renderUi(): void {
    requiredElement("grid-round").textContent = String(this.state.round);
    requiredElement("grid-active-faction").textContent = `${this.factionLabel(this.state.activeFactionId)}${this.isComputerTurn() ? " · Computer" : ""}`;
    requiredElement("grid-remaining").textContent = String(remainingActivations(this.state));
    this.renderFormationPanel();
    this.renderBlockPanel();
    this.renderActions();
    this.renderLog();
    this.renderObjective();
    if (this.state.currentAction !== "attack" && this.state.currentAction !== "shoot") this.renderCombatPreview(null);
  }

  private renderAll(): void {
    this.renderer.render(this.state, this.pendingOrder?.preview ?? null);
    this.renderUi();
  }

  private checkAutomaticConclusion(): void {
    if (this.objectiveDefinition) {
      const evaluation = this.objectiveDefinition.evaluate(this.state);
      if (evaluation.outcome !== "ongoing") this.conclude(evaluation.outcome);
      return;
    }
    const romans = Object.values(this.state.blocks).some((block) => block.factionId === "roman");
    const saxons = Object.values(this.state.blocks).some((block) => block.factionId === "saxon");
    if (!romans || !saxons) this.conclude();
  }

  private conclude(objectiveOutcome?: Exclude<ObjectiveOutcome, "ongoing">): void {
    if (this.concluded) return;
    this.concluded = true;
    requiredElement<HTMLButtonElement>("grid-reset").disabled = true;
    const romanBlocks = Object.values(this.state.blocks).filter((block) => block.factionId === "roman");
    const saxonBlocks = Object.values(this.state.blocks).filter((block) => block.factionId === "saxon");
    const romanModels = romanBlocks.reduce((sum, block) => sum + block.models, 0);
    const saxonModels = saxonBlocks.reduce((sum, block) => sum + block.models, 0);
    const romanFormations = compileFormationBattleResults(this.state, this.romanFormationBaselines);
    const romanMaximumModels = romanFormations.reduce((sum, formation) => sum + formation.maximumStrength, 0);
    const outcome = objectiveOutcome ?? (romanModels === saxonModels ? "mutualDestruction"
      : romanModels > saxonModels ? "romanVictory" : "saxonVictory");
    this.onConclude({
      outcome,
      // Keep the adapter's stable campaign-report field names while the grid model uses model counts.
      romanStrength: romanModels,
      romanMaximumStrength: romanMaximumModels,
      romanFormations,
    });
  }

  getState(): GameState {
    return this.state;
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.computerTimer !== null) window.clearTimeout(this.computerTimer);
    this.computerTimer = null;
    this.computerBusy = false;
    this.events.abort();
    if (this.rendererReady) {
      this.renderer.destroy();
      this.rendererReady = false;
    }
  }
}
