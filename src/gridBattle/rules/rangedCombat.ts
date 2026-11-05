import { simulationCopy } from "../model/simulationCopy";
import {
  getRangedWeaponProfile,
  rangedProtectionMultiplier,
  type RangedProjectileKind,
  type RangedWeaponProfile,
} from "../../units/RangedWeapons";
import { emitEvent } from "../events/events";
import type {
  Formation,
  GameState,
  GridPosition,
  OrderConfirmationPreview,
  TroopBlock,
} from "../model/types";
import { blockModelsAfterDamage, hasEquipment } from "../model/unitStats";
import { terrainAt, terrainElevationAt } from "../model/terrain";
import { terrainDefinition } from "../model/terrainDefinitions";
import { edgeFeaturesCrossed } from "../model/battlefieldMap";
import { edgeFeatureDefinition } from "../model/edgeFeatureDefinitions";
import { damageBlock } from "./combat";
import { withMoraleOrder } from "./morale";
import { combatForecast } from "./combatPreview";
import { directionVector, formationEdgeType } from "./direction";
import { formationIsEngaged } from "./engagement";
import { blockFacing } from "./blockFacing";
import { blockFormation } from "../model/occupancy";

const GRID_WORLD_UNITS = 60;

export interface RangedAttackPreview {
  formationId: string;
  sourceBlockIds: string[];
  defenderId: string;
  targetBlockIds: string[];
  weaponLabel: string;
  projectileKind: RangedProjectileKind;
  ammunition: number;
  distance: number;
  farthestDistance: number;
  minimumRange: number;
  maximumRange: number;
  firingBlockCount: number;
  totalBlockCount: number;
  firingModelCount: number;
  firingIntensity: number;
  impactCount: number;
  damage: number;
  minimumDamage: number;
  maximumDamage: number;
  casualties: number;
  targetEdge: "front" | "side" | "rear" | "mixed";
  shieldMultiplier: number;
  armourMultiplier: number;
  formationMultiplier: number;
  readinessMultiplier: number;
  strengthMultiplier: number;
  shieldBlockChance: number;
  shieldedImpactCount: number;
  impacts: RangedBlockImpactPreview[];
  math: string[];
}

export interface RangedBlockImpactPreview {
  sourceBlockId: string;
  targetBlockId: string;
  targetPosition: GridPosition;
  damage: number;
  minimumDamage: number;
  maximumDamage: number;
  casualties: number;
  targetEdge: "front" | "side" | "rear";
  shieldBlockChance: number;
  shielded: boolean;
  shieldMultiplier: number;
  coverMultiplier: number;
  math: string[];
}

function gridRange(weapon: RangedWeaponProfile): { minimum: number; maximum: number } {
  return {
    minimum: Math.ceil(weapon.minimumRange / GRID_WORLD_UNITS),
    maximum: Math.max(1, Math.round(weapon.maximumRange / GRID_WORLD_UNITS)),
  };
}

function shotDistance(source: GridPosition, target: GridPosition): number {
  return Math.ceil(Math.hypot(target.x - source.x, target.y - source.y));
}

function targetIsInForwardArc(formation: Formation, source: GridPosition, target: GridPosition): boolean {
  const forward = directionVector(formation.facing);
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const forwardDistance = dx * forward.x + dy * forward.y;
  const lateralDistance = Math.abs(dx * forward.y - dy * forward.x);
  return forwardDistance > 0 && lateralDistance <= forwardDistance;
}

function terrainBlocksLineOfSight(
  state: GameState,
  position: GridPosition,
  highestEndpoint: number,
): boolean {
  const terrain = terrainAt(state, position);
  if (!terrain) return true;
  if (!terrainDefinition(terrain).blocksLineOfSight) return false;
  if (terrain === "fortress_wall") return terrainElevationAt(state, position) > highestEndpoint;
  return true;
}

export function hasRangedLineOfSight(
  state: GameState,
  source: GridPosition,
  target: GridPosition,
): boolean {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  const highestEndpoint = Math.max(terrainElevationAt(state, source), terrainElevationAt(state, target));
  let previous = source;
  for (let step = 1; step <= steps; step += 1) {
    const position = {
      x: Math.round(source.x + dx * step / steps),
      y: Math.round(source.y + dy * step / steps),
    };
    if (edgeFeaturesCrossed(state.battlefield, previous, position).some(
      (feature) => edgeFeatureDefinition(feature.type).blocksLineOfSight,
    )) return false;
    if (step < steps && terrainBlocksLineOfSight(state, position, highestEndpoint)) return false;
    previous = position;
  }
  return true;
}

export function rangedEdgeCoverMultiplier(
  state: GameState,
  source: GridPosition,
  target: GridPosition,
): number {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps === 0) return 1;
  const previous = {
    x: Math.round(source.x + dx * (steps - 1) / steps),
    y: Math.round(source.y + dy * (steps - 1) / steps),
  };
  return edgeFeaturesCrossed(state.battlefield, previous, target).reduce(
    (multiplier, feature) => Math.min(multiplier, edgeFeatureDefinition(feature.type).rangedDamageMultiplier),
    1,
  );
}

function incomingDirection(source: GridPosition, target: GridPosition): Formation["facing"] {
  const dx = source.x - target.x;
  const dy = source.y - target.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "east" : "west";
  return dy > 0 ? "south" : "north";
}

function rangedSourcesForTarget(
  state: GameState,
  formation: Formation,
  target: TroopBlock,
  weapon: RangedWeaponProfile,
): TroopBlock[] {
  const range = gridRange(weapon);
  const sources: TroopBlock[] = [];
  for (const blockId of formation.blockIds) {
    const block = state.blocks[blockId];
    if (!block || block.isContested || !targetIsInForwardArc(formation, block.position, target.position)) continue;
    const distance = shotDistance(block.position, target.position);
    if (distance < range.minimum || distance > range.maximum) continue;
    if (!hasRangedLineOfSight(state, block.position, target.position)) continue;
    sources.push(block);
  }
  return sources.sort((first, second) =>
    shotDistance(first.position, target.position) - shotDistance(second.position, target.position)
      || first.id.localeCompare(second.id));
}

function sourceCanShootTarget(
  state: GameState,
  formation: Formation,
  source: TroopBlock,
  target: TroopBlock,
  weapon: RangedWeaponProfile,
): boolean {
  if (source.isContested || target.isContested || !targetIsInForwardArc(formation, source.position, target.position)) return false;
  const range = gridRange(weapon);
  const distance = shotDistance(source.position, target.position);
  return distance >= range.minimum
    && distance <= range.maximum
    && hasRangedLineOfSight(state, source.position, target.position);
}

function rangedImpactPairs(
  state: GameState,
  formation: Formation,
  selectedTarget: TroopBlock,
  targetFormation: Formation,
  weapon: RangedWeaponProfile,
): Array<{ source: TroopBlock; target: TroopBlock }> {
  const sources = rangedSourcesForTarget(state, formation, selectedTarget, weapon);
  if (sources.length === 0) return [];
  const candidates = targetFormation.blockIds
    .map((blockId) => state.blocks[blockId])
    .filter((block): block is TroopBlock => block !== undefined && !block.isContested)
    .sort((first, second) => {
      if (first.id === selectedTarget.id) return -1;
      if (second.id === selectedTarget.id) return 1;
      return shotDistance(first.position, selectedTarget.position) - shotDistance(second.position, selectedTarget.position)
        || first.id.localeCompare(second.id);
    });
  const targetAssignments = new Map<string, TroopBlock>();
  const sourceAssignments = new Map<string, TroopBlock>();
  const assignSource = (source: TroopBlock, visitedTargetIds: Set<string>): boolean => {
    for (const candidate of candidates) {
      if (visitedTargetIds.has(candidate.id)
        || !sourceCanShootTarget(state, formation, source, candidate, weapon)) continue;
      visitedTargetIds.add(candidate.id);
      const existingSource = targetAssignments.get(candidate.id);
      if (existingSource && !assignSource(existingSource, visitedTargetIds)) continue;
      targetAssignments.set(candidate.id, source);
      sourceAssignments.set(source.id, candidate);
      return true;
    }
    return false;
  };
  for (const source of sources) assignSource(source, new Set<string>());
  return sources.flatMap((source) => {
    const assignedTarget = sourceAssignments.get(source.id);
    return assignedTarget ? [{ source, target: assignedTarget }] : [];
  });
}

function rangedWeapon(formation: Formation): RangedWeaponProfile | null {
  return formation.unit.rangedWeaponId
    ? getRangedWeaponProfile(formation.unit.rangedWeaponId)
    : null;
}

export function rangedActionReason(state: GameState, formationId: string): string | null {
  const formation = state.formations[formationId];
  if (!formation) return "Select a formation first.";
  if (!rangedWeapon(formation)) return "This formation has no ranged weapon.";
  if ((formation.ammunition ?? 0) <= 0) return "This formation is out of ammunition.";
  if (formationIsEngaged(state, formation.id)) return "Engaged formations cannot shoot.";
  const target = Object.values(state.blocks).find((block) =>
    block.factionId !== formation.factionId
    && rangedAttackPreview(state, formation.id, block.id) !== null,
  );
  return target ? null : "No enemy is in the formation's forward arc, range, and line of sight.";
}

export function rangedAttackPreview(
  state: GameState,
  formationId: string,
  defenderId: string,
): RangedAttackPreview | null {
  const formation = state.formations[formationId];
  const target = state.blocks[defenderId];
  if (!formation || !target || target.factionId === formation.factionId || target.isContested) return null;
  const weapon = rangedWeapon(formation);
  if (!weapon || (formation.ammunition ?? 0) <= 0 || formationIsEngaged(state, formation.id)) return null;
  const targetFormation = blockFormation(state, target);
  if (!targetFormation) return null;
  const pairs = rangedImpactPairs(state, formation, target, targetFormation, weapon);
  if (pairs.length === 0) return null;
  const sources = pairs.map((pair) => pair.source);

  const distances = sources.map((source) => shotDistance(source.position, target.position));
  const distance = Math.min(...distances);
  const farthestDistance = Math.max(...distances);
  const range = gridRange(weapon);
  const firingModelCount = sources.reduce((total, source) => total + source.models, 0);
  const strengthMultiplier = firingModelCount / Math.max(1, formation.initialModelCount);
  const formationMultiplier = formation.formationMode === "open" ? 1 : 0.76;
  const edges = pairs.map(({ source, target: impactTarget }) => formationEdgeType(
    blockFacing(state, impactTarget.id),
    incomingDirection(source.position, impactTarget.position),
  ));
  const edge = edges.every((candidate) => candidate === edges[0]) ? edges[0]! : "mixed";
  const carriesFrontShields = hasEquipment(targetFormation, "shield_front");
  const protectedShieldMultiplier = rangedProtectionMultiplier(0.3, weapon.shieldPenetration);
  const frontalShieldImpactIndexes = edges
    .map((candidate, index) => carriesFrontShields && candidate === "front" ? index : -1)
    .filter((index) => index >= 0);
  const shieldBlockChance = carriesFrontShields
    ? Math.round((1 - protectedShieldMultiplier) * 100)
    : 0;
  const shieldedImpactCount = Math.round(frontalShieldImpactIndexes.length * shieldBlockChance / 100);
  const shieldedImpactIndexes = new Set(frontalShieldImpactIndexes.slice(0, shieldedImpactCount));
  const shieldMultiplier = pairs.reduce((total, pair, index) =>
    total + pair.source.models * (shieldedImpactIndexes.has(index) ? protectedShieldMultiplier : 1), 0)
    / Math.max(1, firingModelCount);
  const baseArmourMultiplier = Math.max(0.45, 1 - targetFormation.unit.armour * 0.2);
  const armourMultiplier = rangedProtectionMultiplier(baseArmourMultiplier, weapon.armourPenetration);
  const readinessMultiplier = targetFormation.isBraced ? 0.82 : 1;
  const defenceMultiplier = 1 - Math.min(80, Math.max(0, targetFormation.unit.defence)) / 100;
  const impactDamageCap = weapon.maximumCasualties * targetFormation.unit.hitPointsPerModel;
  const impacts: RangedBlockImpactPreview[] = pairs.map(({ source, target: impactTarget }, index) => {
    const sourceReadiness = source.models / Math.max(1, source.modelCapacity);
    const coverMultiplier = rangedEdgeCoverMultiplier(state, source.position, impactTarget.position);
    const unshieldedDamage = Math.max(0, Math.min(impactDamageCap, Math.round(
      weapon.casualtyPower * sourceReadiness * formationMultiplier
        * armourMultiplier * readinessMultiplier * defenceMultiplier * coverMultiplier,
    )));
    const protectedLane = carriesFrontShields && edges[index] === "front";
    const minimumDamage = protectedLane
      ? Math.max(0, Math.min(impactDamageCap, Math.round(unshieldedDamage * protectedShieldMultiplier)))
      : unshieldedDamage;
    const maximumDamage = unshieldedDamage;
    const shielded = shieldedImpactIndexes.has(index);
    const damage = shielded ? minimumDamage : maximumDamage;
    const modelsAfter = blockModelsAfterDamage(targetFormation, impactTarget, damage);
    const casualties = impactTarget.models - modelsAfter;
    const impactEdge = edges[index]!;
    const impactMath = [
      `${source.id} fires on ${impactTarget.id}`,
      `${weapon.label}: ${weapon.casualtyPower.toFixed(2)} power`,
      `Source readiness: ${source.models}/${source.modelCapacity} models, ×${sourceReadiness.toFixed(2)}`,
      `${formation.formationMode} firing order: ×${formationMultiplier.toFixed(2)}`,
      protectedLane
        ? `Frontal shields: ${shieldBlockChance}% block chance, ${minimumDamage}–${maximumDamage} damage; this lane is ${shielded ? "blocked" : "exposed"}`
        : `No frontal shield protection: ${maximumDamage} damage`,
      `Armour after penetration: ×${armourMultiplier.toFixed(2)}`,
      targetFormation.isBraced ? `Braced target: ×${readinessMultiplier.toFixed(2)}` : "Target not braced: ×1.00",
      targetFormation.unit.defence > 0 ? `Defence: ×${defenceMultiplier.toFixed(2)}` : "No defence reduction: ×1.00",
      coverMultiplier < 1 ? `Short edge cover: ×${coverMultiplier.toFixed(2)}` : "No edge cover: ×1.00",
      `Deterministic lane result: ${damage} damage`,
    ];
    return {
      sourceBlockId: source.id,
      targetBlockId: impactTarget.id,
      targetPosition: { ...impactTarget.position },
      damage,
      minimumDamage,
      maximumDamage,
      casualties,
      targetEdge: impactEdge,
      shieldBlockChance: protectedLane ? shieldBlockChance : 0,
      shielded,
      shieldMultiplier: shielded ? protectedShieldMultiplier : 1,
      coverMultiplier,
      math: impactMath,
    };
  });
  const damage = impacts.reduce((total, impact) => total + impact.damage, 0);
  const minimumDamage = impacts.reduce((total, impact) => total + impact.minimumDamage, 0);
  const maximumDamage = impacts.reduce((total, impact) => total + impact.maximumDamage, 0);
  const casualties = impacts.reduce((total, impact) => total + impact.casualties, 0);
  const math = [
    `${weapon.label}: ${weapon.casualtyPower.toFixed(2)} power`,
    `${sources.length}/${formation.blockIds.length} blocks fire on ${impacts.length} separate target blocks`,
    `${firingModelCount}/${formation.initialModelCount} initial models participate, ×${strengthMultiplier.toFixed(2)}`,
    `${formation.formationMode} firing order: ×${formationMultiplier.toFixed(2)}`,
    shieldedImpactCount > 0
      ? `Frontal shields block ${shieldedImpactCount}/${frontalShieldImpactIndexes.length} exposed lanes (${shieldBlockChance}% protection per lane)`
      : "No frontal shield protection: ×1.00",
    `Armour after penetration: ×${armourMultiplier.toFixed(2)}`,
    targetFormation.isBraced ? `Braced target: ×${readinessMultiplier.toFixed(2)}` : "Target not braced: ×1.00",
    targetFormation.unit.defence > 0 ? `Defence: ×${defenceMultiplier.toFixed(2)}` : "No defence reduction: ×1.00",
    `Formation-wide damage range: ${minimumDamage}–${maximumDamage}; deterministic result ${damage}`,
  ];
  return {
    formationId: formation.id,
    sourceBlockIds: sources.map((source) => source.id),
    defenderId: target.id,
    targetBlockIds: impacts.map((impact) => impact.targetBlockId),
    weaponLabel: weapon.label,
    projectileKind: weapon.projectile,
    ammunition: formation.ammunition ?? 0,
    distance,
    farthestDistance,
    minimumRange: range.minimum,
    maximumRange: range.maximum,
    firingBlockCount: sources.length,
    totalBlockCount: formation.blockIds.length,
    firingModelCount,
    firingIntensity: sources.length / Math.max(1, formation.blockIds.length),
    impactCount: impacts.length,
    damage,
    minimumDamage,
    maximumDamage,
    casualties,
    targetEdge: edge,
    shieldMultiplier,
    armourMultiplier,
    formationMultiplier,
    readinessMultiplier,
    strengthMultiplier,
    shieldBlockChance,
    shieldedImpactCount,
    impacts,
    math,
  };
}

export function rangedConfirmationPreview(
  state: GameState,
  formationId: string,
  defenderId: string,
): OrderConfirmationPreview | null {
  const preview = rangedAttackPreview(state, formationId, defenderId);
  const formation = state.formations[formationId];
  const defender = state.blocks[defenderId];
  if (!preview || !formation || !defender) return null;
  const outcome = simulationCopy(state);
  resolveRangedVolley(outcome, formationId, defenderId);
  return {
    kind: "combat",
    forecast: combatForecast(state, [outcome]),
    title: `Confirm ${preview.weaponLabel.toLowerCase()} volley`,
    detail: `${preview.firingBlockCount} of ${preview.totalBlockCount} formation blocks hit ${preview.impactCount} target blocks. Spend 1 of ${preview.ammunition} remaining ammunition; shields block a deterministic share of frontal lanes.`,
    tiles: preview.impacts.map((impact) => ({
      position: { ...impact.targetPosition },
      factionId: defender.factionId,
      certainty: "certain" as const,
      chance: 100,
      blockId: impact.targetBlockId,
      math: impact.math,
    })),
    damage: preview.impacts.map((impact) => ({
      blockId: impact.targetBlockId,
      factionId: defender.factionId,
      position: { ...impact.targetPosition },
      minimumDamage: impact.minimumDamage,
      maximumDamage: impact.maximumDamage,
      evadeChance: impact.shieldBlockChance,
      mitigationLabel: impact.shieldBlockChance > 0 ? "shield block" : "evade",
      math: impact.math,
    })),
  };
}

export function resolveRangedVolley(
  state: GameState,
  formationId: string,
  defenderId: string,
): { ok: boolean; reason?: string } {
  const preview = rangedAttackPreview(state, formationId, defenderId);
  const formation = state.formations[formationId];
  const sources = preview
    ? preview.sourceBlockIds.map((blockId) => state.blocks[blockId]).filter((block) => block !== undefined)
    : [];
  const defender = state.blocks[defenderId];
  const targets = preview
    ? preview.impacts.map((impact) => state.blocks[impact.targetBlockId]).filter((block) => block !== undefined)
    : [];
  if (!preview || !formation || sources.length === 0 || targets.length !== preview.impacts.length || !defender) {
    return { ok: false, reason: "Target must be in the formation's forward arc, range, and line of sight." };
  }
  formation.ammunition = Math.max(0, (formation.ammunition ?? 0) - 1);
  emitEvent(state, "ranged_volley", `${formation.name} loosed ${preview.weaponLabel.toLowerCase()} from ${sources.length} firing block${sources.length === 1 ? "" : "s"} into ${targets.length} block${targets.length === 1 ? "" : "s"} of ${state.formations[defender.formationId!]?.name ?? defender.id}.`, {
    blockIds: [...sources.map((source) => source.id), ...targets.map((target) => target.id)],
    formationIds: [formation.id, defender.formationId].filter((id): id is string => Boolean(id)),
    sourcePosition: { ...sources[0]!.position },
    sourcePositions: sources.map((source) => ({ ...source.position })),
    targetPositions: preview.impacts.map((impact) => ({ ...impact.targetPosition })),
    position: { ...defender.position },
    projectileKind: preview.projectileKind,
    casualties: preview.casualties,
  });
  withMoraleOrder(state, () => {
    for (const impact of preview.impacts) {
      damageBlock(state, impact.targetBlockId, impact.damage, `${preview.weaponLabel.toLowerCase()} volley`);
    }
  });
  return { ok: true };
}
