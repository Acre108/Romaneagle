import { BALANCE } from "../model/config";
import type { FactionId, GameState, PressurePreview } from "../model/types";
import { blockHitPoints, hasEquipment } from "../model/unitStats";
import { effectiveBlockFacing } from "../rules/blockFacing";
import type { MissionObjectiveDefinition } from "../rules/campaignObjectives";
import { attackingPressure, defendingResistance, rearSupport } from "../rules/combat";
import { pressureCalculationLines } from "../rules/combatPreview";
import { blockIsWavering, formationIsEngaged } from "../rules/engagement";
import type { RangedAttackPreview } from "../rules/rangedCombat";
import { connectedComponents, provisionalFormationFamily } from "../rules/splitting";
import { getRangedWeaponProfile } from "../../units/RangedWeapons";
import { requiredElement } from "../../ui/dom";

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

export function renderCombatPreview(preview: PressurePreview | null): void {
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
      : preview.netPressure < 2
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

export function renderRangedPreview(preview: RangedAttackPreview | null): void {
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

export function renderFormationPanel(state: GameState, factionLabel: (factionId: FactionId) => string): void {
  const formation = state.selectedFormationId ? state.formations[state.selectedFormationId] : undefined;
  const name = requiredElement("grid-formation-name");
  const stats = requiredElement("grid-formation-stats");
  if (!formation) {
    name.textContent = "No formation selected";
    stats.replaceChildren();
    return;
  }
  const blocks = formation.blockIds.map((id) => state.blocks[id]).filter((block) => block !== undefined);
  const characters = blocks.map((block) => block.characterId ? state.characters[block.characterId]?.name : null).filter(Boolean);
  const family = provisionalFormationFamily(state, formation.id);
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
    ["Faction", factionLabel(formation.factionId)],
    ["Status", formation.status],
    ["Engagement", formationIsEngaged(state, formation.id) ? "Engaged" : "Free"],
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
    ["Connectivity", connectedComponents(state, formation.id).length === 1 ? "Intact" : "Broken"],
  ]));
}

export function renderBlockPanel(state: GameState): void {
  const block = state.selectedBlockId ? state.blocks[state.selectedBlockId] : undefined;
  const name = requiredElement("grid-block-name");
  const stats = requiredElement("grid-block-stats");
  if (!block) {
    name.textContent = "Click a selected formation block again";
    stats.replaceChildren();
    return;
  }
  const character = block.characterId ? state.characters[block.characterId] : undefined;
  const formation = block.formationId ? state.formations[block.formationId] : undefined;
  name.textContent = block.id;
  stats.replaceChildren(...definitionRows([
    ["Models", `${block.models}/${block.modelCapacity}`],
    ["Hit points", formation ? blockHitPoints(formation, block) : 0],
    ["Disorder", block.disorder],
    ["Facing", effectiveBlockFacing(state, block.id)],
    ["Morale", blockIsWavering(state, block.id) ? "Wavering" : "Steady"],
    ["Pressure", attackingPressure(state, block.id)],
    ["Resistance", defendingResistance(state, block.id, effectiveBlockFacing(state, block.id))],
    ["Shield", formation && hasEquipment(formation, "shield_front") ? "+1 frontal armour" : "None"],
    ["Equipment", formation?.unit.equipment.join(", ").replaceAll("_", " ") || "None"],
    ["Rear support", rearSupport(state, block.id)],
    ["Host character", character ? `${character.name} (${character.role})` : "None"],
    ["Contested", block.isContested ? "Yes" : "No"],
  ]));
}

export function renderLog(state: GameState): void {
  const log = requiredElement<HTMLOListElement>("grid-combat-log");
  const rows = state.eventLog.slice(-12).reverse().map((event) => {
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

export function renderObjective(state: GameState, objective: MissionObjectiveDefinition | undefined): void {
  const status = requiredElement("grid-objective-status");
  const progress = requiredElement<HTMLUListElement>("grid-objective-progress");
  if (!objective) {
    status.textContent = "Break the opposing force.";
    progress.replaceChildren();
    return;
  }
  const evaluation = objective.evaluate(state);
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
