import { BALANCE } from "../model/config";
import type { FactionId, Formation, GameState, OrderConfirmationPreview, TroopBlock } from "../model/types";
import { blockHitPoints, formationPressure, formationResistance, isCavalry } from "../model/unitStats";
import { blockFacing } from "../rules/blockFacing";
import { rememberFormationNames, withFormationNames } from "../rules/displayNames";
import { battleLogEntries } from "../rules/battleLog";
import type { MissionObjectiveDefinition } from "../rules/campaignObjectives";
import { attackingPressure, defendingResistance, rearSupport } from "../rules/combat";
import { chargePreview } from "../rules/charge";
import { oppositeDirection, rotateDirection } from "../rules/direction";
import { blockIsWavering, formationIsEngaged } from "../rules/engagement";
import { moraleWord } from "../rules/formationPlates";
import type { RangedAttackPreview } from "../rules/rangedCombat";
import { connectedComponents, provisionalFormationFamily } from "../rules/splitting";
import { getRangedWeaponProfile } from "../../units/RangedWeapons";
import { requiredElement } from "../../ui/dom";
import { blockFormation } from "../model/occupancy";

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

/**
 * The charge readout for a hovered target. `forecast` is the full outcome preview, which is slow to build;
 * leave it out to show the lane summary straight away.
 */
export function renderChargePreview(
  state: GameState,
  attackerId: string | null,
  defenderId: string | null,
  forecast?: OrderConfirmationPreview | null,
): void {
  const charge = attackerId && defenderId ? chargePreview(state, attackerId, defenderId) : null;
  if (!charge || !attackerId || !defenderId) {
    setPreviewLines(["Choose an enemy in the forward lane to see what the charge will do."]);
    return;
  }
  setPreviewLines([
    ...(forecast?.forecast ?? []),
    isCavalry(charge.unitType)
      ? `Charge lane ${charge.distance} squares · momentum ${charge.momentum} · impact ${charge.impactDamage}, then local pressure.`
      : `Infantry charge ${charge.distance} ${charge.distance === 1 ? "square" : "squares"} · ${charge.bonusNullified ? "attack bonus nullified by braced front" : `+${charge.attackBonus} attack pressure`}.`,
    ...(forecast?.contactSummary ?? []),
  ]);
}

function setPreviewLines(lines: readonly string[]): void {
  requiredElement("grid-combat-preview").replaceChildren(...lines.map((line) => {
    const row = document.createElement("div");
    row.textContent = line;
    return row;
  }));
}

/** Shows what a pending order will do. Charge and Shoot keep their hover readout until then. */
export function renderOrderPreview(state: GameState, preview: OrderConfirmationPreview | undefined): void {
  if (preview?.kind === "combat") {
    setPreviewLines([...(preview.forecast ?? []), ...(preview.contactSummary ?? [])]);
    return;
  }
  if (state.currentAction === "charge" || state.currentAction === "shoot") return;
  setPreviewLines(["Choose Battle, Press, Charge, or Shoot to see what the order will do."]);
}

export function renderRangedPreview(preview: RangedAttackPreview | null, forecast: readonly string[] = [], formationNames: ReadonlyMap<string, string> = new Map()): void {
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
    ...forecast,
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
  math.textContent = preview.math.map((line) => withFormationNames(line, formationNames)).join("\n");
  detail.append(summary, math);
  panel.append(detail);
}

export function renderFormationPanel(
  state: GameState,
  inspected: Formation | undefined,
  selected: Formation | undefined,
  factionLabel: (factionId: FactionId) => string,
): void {
  const formation = inspected ?? selected;
  requiredElement("grid-formation-label").textContent = inspected ? "INSPECTING FORMATION" : "SELECTED FORMATION";
  requiredElement("grid-formation-more-toggle").hidden = !formation;
  const name = requiredElement("grid-formation-name");
  const stats = requiredElement("grid-formation-stats");
  if (!formation) {
    name.textContent = "No formation selected";
    stats.replaceChildren();
    requiredElement("grid-formation-more").replaceChildren();
    return;
  }
  const blocks = formation.blockIds.map((id) => state.blocks[id]).filter((block) => block !== undefined);
  const characters = blocks.map((block) => block.characterId ? state.characters[block.characterId]?.name : null).filter(Boolean);
  const family = provisionalFormationFamily(state, formation.id);
  const hasStragglers = family.some((candidate) => candidate.blockIds.length <= BALANCE.stragglerBlockThreshold);
  const breakup = formation.provisionalFamilyId
    ? `${family.length} bodies — shared activation · ${hasStragglers ? "stragglers attached" : `regroup ${formation.failedRegroupActivations ?? 0}/${BALANCE.fragmentRegroupGraceActivations}`}`
    : formation.status === "fragment" ? "Independent fragment" : "Unified";
  const rangedWeapon = formation.unit.rangedWeaponId
    ? getRangedWeaponProfile(formation.unit.rangedWeaponId)
    : null;
  name.textContent = formation.name;
  const wavering = blocks.filter((block) => blockIsWavering(state, block.id)).length;
  const optional: [string, string | number][] = [];
  if (rangedWeapon) optional.push(["Ranged", `${rangedWeapon.label} · ${formation.ammunition ?? 0} ${rangedWeapon.ammunitionLabel}`]);
  if (formation.isBraced) optional.push(["Stance", "Braced (+1 armour)"]);
  if (characters.length > 0) optional.push(["Characters", characters.join(", ")]);
  if (formation.provisionalFamilyId || formation.status === "fragment") optional.push(["Split", breakup]);
  stats.replaceChildren(...definitionRows([
    ["Faction", factionLabel(formation.factionId)],
    ["Morale", `${formation.cohesion}/${formation.maxCohesion} · ${moraleWord(formation)}`],
    ["Men", blocks.reduce((sum, block) => sum + block.models, 0)],
    ["Blocks", blocks.length],
    ["Wavering blocks", wavering],
    ["Type", `${formation.unit.unitType.replaceAll("_", " ")} · ${formation.formationMode}`],
    ["Attack / Armour", `${formation.unit.attack} / ${formation.unit.armour}`],
    ["Base pressure / resistance", `${formationPressure(formation)} / ${formationResistance(formation)}`],
    ["Facing", formation.facing],
    ["Movement left", formation.movementRemaining],
    ...optional,
  ]));
  requiredElement("grid-formation-more").replaceChildren(...definitionRows([
    ["Engagement", formationIsEngaged(state, formation.id) ? "Engaged" : "Free"],
    ["Model size", formation.unit.modelSize],
    ["HP per model", formation.unit.hitPointsPerModel],
    ["Defence", `${formation.unit.defence}%`],
    ["Connectivity", connectedComponents(state, formation.id).length === 1 ? "Intact" : "Broken"],
  ]));
}

export function renderBlockPanel(state: GameState, inspected: TroopBlock | undefined, selected: TroopBlock | undefined): void {
  const block = inspected ?? selected;
  requiredElement("grid-block-label").textContent = inspected ? "INSPECTING BLOCK" : "SELECTED BLOCK";
  const name = requiredElement("grid-block-name");
  const stats = requiredElement("grid-block-stats");
  if (!block) {
    name.textContent = "Click a block for its details";
    stats.replaceChildren();
    return;
  }
  const character = block.characterId ? state.characters[block.characterId] : undefined;
  const formation = blockFormation(state, block);
  name.textContent = `${String.fromCharCode(65 + block.position.x)}${block.position.y + 1} · ${formation?.name ?? "Block"}`;
  const facing = blockFacing(state, block.id);
  const optional: [string, string | number][] = [];
  if (character) optional.push(["Character", `${character.name} (${character.role})`]);
  if (block.isContested) optional.push(["Contested", "Intermingled with the enemy"]);
  stats.replaceChildren(...definitionRows([
    ["Men", `${block.models}/${block.modelCapacity}`],
    ["Hit points", formation ? blockHitPoints(formation, block) : 0],
    ["State", blockIsWavering(state, block.id) ? "Wavering" : "Steady"],
    ["Pressure", attackingPressure(state, block.id)],
    ["Resistance", `${defendingResistance(state, block.id, facing)} front · ${defendingResistance(state, block.id, rotateDirection(facing, "left"))} side · ${defendingResistance(state, block.id, oppositeDirection(facing))} rear`],
    ["Rear support", rearSupport(state, block.id)],
    ["Equipment", formation?.unit.equipment.join(", ").replaceAll("_", " ") || "None"],
    ...optional,
  ]));
}

export function renderLog(state: GameState, formationNames: Map<string, string>): void {
  const log = requiredElement<HTMLOListElement>("grid-combat-log");
  rememberFormationNames(state, formationNames);
  const rows = battleLogEntries(state.eventLog, formationNames).map((entry) => {
    const item = document.createElement("li");
    item.textContent = entry.headline;
    for (const note of entry.moraleNotes) {
      const line = document.createElement("span");
      line.className = "grid-log-morale";
      line.textContent = note;
      item.append(line);
    }
    for (const detail of entry.details) {
      const line = document.createElement("span");
      line.className = "grid-log-detail";
      line.textContent = detail;
      item.append(line);
    }
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
