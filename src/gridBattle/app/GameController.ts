import { requiredElement } from "../../ui/dom";
import { executeCommand, commandLegality, moveIsCommitted, type GameCommand } from "../commands/executeCommand";
import { renderBlockPanel, renderChargePreview, renderFormationPanel, renderLog, renderObjective, renderOrderPreview, renderRangedPreview } from "./battlePanels";
import { planOrder } from "../commands/planOrder";
import { canSelectFormation } from "../rules/turnSystem";
import { eventsSince } from "../events/events";
import { blocksAt } from "../model/occupancy";
import { BALANCE } from "../model/config";
import type { BattleAction, Direction, FactionId, Formation, GameState, GridPosition, OrderConfirmationPreview, TroopBlock } from "../model/types";
import { chargePreview } from "../rules/charge";
import { mergeCandidates } from "../rules/formationActions";
import { moveDirectionFromCell, planFormationMove } from "../rules/movement";
import { formationIsEngaged } from "../rules/engagement";
import { formationFamilyIsRouted } from "../rules/routing";
import { remainingActivations } from "../rules/turnSystem";
import { createPrototypeGridScenario } from "../scenario/prototypeScenario";
import type { GridBattleScenarioFactory } from "../scenario/campaignScenario";
import { BattlefieldRenderer } from "../rendering/BattlefieldRenderer";
import type { AnimationSpeed } from "../rendering/AnimationQueue";
import { rangedAttackPreview, rangedConfirmationPreview } from "../rules/rangedCombat";
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

export class GridBattleController {
  private state: GameState;
  private readonly renderer: BattlefieldRenderer;
  private readonly events = new AbortController();
  private debugVisible = false;
  private moraleVisible = false;
  /** A block being read, not ordered. This is view state only and never reaches the rules. */
  private inspectedBlockId: string | null = null;
  /** Names outlive routed and destroyed formations so the log can still name them. */
  private readonly formationNames = new Map<string, string>();
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

  private inspectedBlock(): TroopBlock | undefined {
    return this.inspectedBlockId ? this.state.blocks[this.inspectedBlockId] : undefined;
  }

  private inspectedFormation(): Formation | undefined {
    const formationId = this.inspectedBlock()?.formationId;
    return formationId ? this.state.formations[formationId] : undefined;
  }

  private inspectBlock(block: TroopBlock): void {
    this.inspectedBlockId = block.id;
    if (!this.pendingOrder) requiredElement("grid-action-help").textContent = "Inspecting only: buttons still command your selected formation. Press Esc or click one of your formations to return.";
    this.renderAll();
  }

  private clearInspection(): boolean {
    if (!this.inspectedBlockId) return false;
    this.inspectedBlockId = null;
    return true;
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
    if (this.concluded) return;
    const occupants = blocksAt(this.state, position);
    if (this.pendingOrder || this.isComputerTurn()) {
      if (occupants[0]) this.inspectBlock(occupants[0]);
      return;
    }
    const formation = this.selectedFormation();
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
    if (formation && action === "charge" && enemy) {
      const attacker = this.chargeSourceFor(enemy.id);
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
    const selectable = occupants.some((block) => block.factionId === this.state.activeFactionId
      && block.formationId && canSelectFormation(this.state, block.formationId));
    if (!selectable && occupants[0]) {
      this.inspectBlock(occupants[0]);
      return;
    }
    this.clearInspection();
    if (this.dispatch({ type: "select_cell", position })) {
      requiredElement("grid-action-help").textContent = `${this.selectedFormation()?.name ?? "Formation"} selected. Choose an order.`;
    }
  }

  private beginOrderPreview(preview: OrderConfirmationPreview, command: GameCommand): void {
    this.pendingOrder = { preview, command };
    requiredElement("grid-action-help").textContent = "Review the shadow destinations, then confirm or cancel.";
    this.renderAll();
  }

  private confirmPendingOrder(): void {
    const pending = this.pendingOrder;
    if (!pending) return;
    this.clearInspection();
    this.dispatch(pending.command, true);
  }

  private cancelPendingOrder(): void {
    if (!this.pendingOrder) return;
    this.pendingOrder = null;
    requiredElement("grid-action-help").textContent = "Preview cancelled. Choose another destination.";
    this.renderAll();
  }

  private chargeSourceFor(defenderId: string): TroopBlock | undefined {
    const formation = this.selectedFormation();
    if (!formation) return undefined;
    const preferred = this.selectedBlock();
    if (preferred && chargePreview(this.state, preferred.id, defenderId)) return preferred;
    return formation.blockIds
      .map((id) => this.state.blocks[id])
      .find((block) => block && chargePreview(this.state, block.id, defenderId));
  }

  private handleCellHover(position: GridPosition | null): void {
    const hover = requiredElement("grid-hover-info");
    if (!position) {
      hover.textContent = "Hover a square to inspect it";
      return;
    }
    hover.textContent = `${String.fromCharCode(65 + position.x)}${position.y + 1} · ${this.renderer.terrainDescription(position)}`;
    const formation = this.selectedFormation();
    if (formation && this.state.currentAction === "move") {
      const direction = moveDirectionFromCell(formation, this.state, position);
      const plan = direction ? planFormationMove(this.state, formation.id, direction) : null;
      if (plan?.plan) hover.textContent += ` · Costs ${plan.plan.movementCosts[formation.id] ?? 0} of ${formation.movementRemaining} movement left`;
      else if (plan?.reason) hover.textContent += ` · ${plan.reason}`;
      return;
    }
    if (!formation || (this.state.currentAction !== "charge" && this.state.currentAction !== "shoot")) return;
    const enemy = blocksAt(this.state, position).find((block) => block.factionId !== formation.factionId);
    if (this.state.currentAction === "shoot") {
      const preview = enemy ? rangedAttackPreview(this.state, formation.id, enemy.id) : null;
      renderRangedPreview(preview, enemy && preview ? rangedConfirmationPreview(this.state, formation.id, enemy.id)?.forecast ?? [] : []);
      return;
    }
    const attacker = enemy ? this.chargeSourceFor(enemy.id) : undefined;
    renderChargePreview(this.state, enemy && attacker ? attacker.id : null, enemy?.id ?? null);
  }

  private chooseAction(action: UiAction): void {
    this.clearInspection();
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
      move: `Click a highlighted square to step; hover it for the cost. ${formation.movementRemaining} movement left. Then choose the final facing.`,
      shoot: "Click a highlighted enemy. Every block with range and line of sight strikes a separate block in that target formation; frontal shields block some lanes.",
      charge: "Click an enemy in the forward lane. Infantry charge 1–2 squares; difficult terrain limits them to 1.",
      reform: "Click a green destination, or an adjacent friendly block to transfer the selected character.",
      merge: "Click a connected friendly fragment with matching facing.",
      brace: "Brace in place for +1 armour. The bonus lasts until any block in the formation moves.",
      hold: "Hold position.",
      fall_back: "Reverse one square and leave contact if the rear is clear.",
      turn: "Choose a new facing. Turning in contact uses this formation's whole activation.",
      battle: "Fight every contact at full damage. Shoves only on a clear win, net pressure 4 or more; blocks closing a gap fight immediately.",
      press: "Gain +2 pressure but deal 1 less damage and still take counters. Shoves at net pressure 2 or more; files that advance stay wavering through your next activation.",
    };
    requiredElement("grid-action-help").textContent = help[action];
    if (action === "shoot") renderRangedPreview(null);
    if (action === "charge") renderChargePreview(this.state, null, null);
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
      if (!button || this.inputLocked()) return;
      const facing = button.dataset.gridFacing as Direction;
      this.planAndDispatch(this.state.currentAction === "turn" ? { type: "turn", facing } : { type: "finish_move", facing });
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
      m: "move", s: "shoot", c: "charge", r: "reform", g: "merge", x: "brace", h: "hold",
      v: "fall_back", t: "turn", b: "battle", p: "press",
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
    if (this.clearInspection()) {
      requiredElement("grid-action-help").textContent = "Back to your orders.";
      this.renderAll();
      return;
    }
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
      button.title = accepted ? "" : legality.reason ?? "";
      button.classList.toggle("active", this.state.currentAction === action);
    });
    const facingPanel = requiredElement("grid-move-facing");
    const turning = this.state.currentAction === "turn";
    const choosingMoveFacing = Boolean(formation && (this.state.currentAction === "move" || turning)) && !this.isComputerTurn();
    requiredElement("grid-move-facing-label").textContent = turning ? "Turn to face" : "Finish move facing";
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

  private renderUi(): void {
    requiredElement("grid-round").textContent = String(this.state.round);
    requiredElement("grid-active-faction").textContent = `${this.factionLabel(this.state.activeFactionId)}${this.isComputerTurn() ? " · Computer" : ""}`;
    requiredElement("grid-remaining").textContent = String(remainingActivations(this.state));
    renderFormationPanel(this.state, this.inspectedFormation(), this.selectedFormation(), (factionId) => this.factionLabel(factionId));
    renderBlockPanel(this.state, this.inspectedBlock(), this.selectedBlock());
    this.renderActions();
    renderLog(this.state, this.formationNames);
    renderObjective(this.state, this.objectiveDefinition);
    renderOrderPreview(this.state, this.pendingOrder?.preview);
  }

  private renderAll(): void {
    this.renderer.setInspectedFormation(this.inspectedFormation()?.id ?? null);
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
