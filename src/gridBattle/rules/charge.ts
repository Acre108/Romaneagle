import { BALANCE } from "../model/config";
import { terrainAllowsCharge, terrainAt, terrainLimitsInfantryCharge } from "../model/terrain";
import { enemyBlockAt, blockFormation } from "../model/occupancy";
import type { ChargePreview, Direction, Formation, GameState, GridPosition, OrderConfirmationPreview, PressurePreview, TroopBlock } from "../model/types";
import { emitEvent } from "../events/events";
import { addPosition, directionBetween, directionVector, formationEdgeType, oppositeDirection } from "./direction";
import { formationBlocks, planFormationAdvance } from "./movement";
import { recalculateAllConnectivity } from "./splitting";
import { blockFacing } from "./blockFacing";
import { clearFormationBrace } from "./brace";
import { applyTerrainOverflow, planTerrainOverflow } from "./terrainOverflow";
import { blockIsWavering } from "./wavering";
import { advanceCombatFile } from "./fileAdvance";
import { aggregateCombatOutcomes, blockCombatMath, contactSummaryLines } from "./combatPreview";
import { hasEquipment, isCavalry, isInfantry } from "../model/unitStats";
import { type PressureOptions, pressurePreview, damageBlock, createContestedCell, resolvePressure } from "./combat";
import { withMoraleOrder } from "./morale";

function infantryChargeCrossesDifficultTerrain(state: GameState, formation: Formation, distance: number): boolean {
  const vector = directionVector(formation.facing);
  return formationBlocks(state, formation).some((block) => {
    if (terrainLimitsInfantryCharge(terrainAt(state, block.position))) return true;
    for (let step = 1; step <= distance; step += 1) {
      const position = addPosition(block.position, vector, step);
      if (terrainLimitsInfantryCharge(terrainAt(state, position))) return true;
    }
    return false;
  });
}

function chargeLateralCoordinate(block: TroopBlock, facing: Direction): number {
  return facing === "north" || facing === "south" ? block.position.x : block.position.y;
}

interface FormationChargeContact {
  attackerId: string;
  defenderId: string;
}

function formationChargeContacts(state: GameState, formation: Formation): FormationChargeContact[] {
  const vector = directionVector(formation.facing);
  return formationBlocks(state, formation)
    .filter((block) => !block.isContested)
    .sort((a, b) => chargeLateralCoordinate(a, formation.facing) - chargeLateralCoordinate(b, formation.facing)
      || a.id.localeCompare(b.id))
    .flatMap((attacker) => {
      const defender = enemyBlockAt(state, addPosition(attacker.position, vector), attacker.factionId);
      return defender ? [{ attackerId: attacker.id, defenderId: defender.id }] : [];
    });
}

function infantryChargeBonusForContact(
  state: GameState,
  attacker: TroopBlock,
  defender: TroopBlock,
  attackerPosition: GridPosition = attacker.position,
): { attackBonus: number; bonusNullified: boolean } {
  const defenderFormation = blockFormation(state, defender);
  const incomingDirection = directionBetween(defender.position, attackerPosition);
  const bonusNullified = Boolean(defenderFormation?.isBraced && incomingDirection
    && formationEdgeType(blockFacing(state, defender.id), incomingDirection) === "front");
  return {
    attackBonus: bonusNullified ? 0 : BALANCE.infantryChargePressureBonus,
    bonusNullified,
  };
}

export function chargePreview(state: GameState, attackerId: string, defenderId: string): ChargePreview | null {
  const attacker = state.blocks[attackerId];
  const defender = state.blocks[defenderId];
  const formation = blockFormation(state, attacker);
  if (!attacker || !defender || !formation || formation.status !== "formed" || attacker.factionId === defender.factionId) return null;
  if (!isCavalry(formation.unit.unitType) && !isInfantry(formation.unit.unitType)) return null;
  if (formationBlocks(state, formation).some((block) => block.isContested)) return null;
  const vector = directionVector(formation.facing);
  const deltaX = defender.position.x - attacker.position.x;
  const deltaY = defender.position.y - attacker.position.y;
  const distance = Math.abs(deltaX) + Math.abs(deltaY);
  if ((vector.x !== 0 ? deltaY !== 0 || Math.sign(deltaX) !== vector.x : deltaX !== 0 || Math.sign(deltaY) !== vector.y)) return null;
  const travelled = distance - 1;
  const cavalry = isCavalry(formation.unit.unitType);
  if (cavalry ? travelled < 2 || travelled > formation.unit.movement : travelled < 1 || travelled > BALANCE.infantryChargeMaximumDistance) return null;
  if (cavalry) {
    for (let step = 1; step <= travelled; step += 1) {
      const position = addPosition(attacker.position, vector, step);
      if (!terrainAllowsCharge(terrainAt(state, position))) return null;
    }
  } else if (travelled > 1 && infantryChargeCrossesDifficultTerrain(state, formation, travelled)) return null;
  const finalAttackerPosition = addPosition(defender.position, directionVector(oppositeDirection(formation.facing)));
  const planned = planFormationAdvance(state, formation.id, formation.facing, travelled, {
    spendMovement: false,
    anchor: { blockId: attacker.id, destination: finalAttackerPosition },
  });
  if (!planned.ok || !planned.plan) return null;
  const incomingDirection = directionBetween(defender.position, finalAttackerPosition);
  if (!incomingDirection) return null;
  const infantryBonus = cavalry
    ? { attackBonus: 0, bonusNullified: false }
    : infantryChargeBonusForContact(state, attacker, defender, finalAttackerPosition);
  const momentum = Math.min(BALANCE.maximumChargeMomentum, travelled + BALANCE.cavalryMass);
  return {
    attackerId,
    defenderId,
    distance: travelled,
    momentum: cavalry ? momentum : 0,
    impactDamage: cavalry ? Math.max(1, Math.floor(momentum / 3)) : 0,
    attackBonus: cavalry ? momentum : infantryBonus.attackBonus,
    bonusNullified: infantryBonus.bonusNullified,
    unitType: formation.unit.unitType,
    reordered: planned.plan.reordered,
    relocations: planned.plan.relocations,
  };
}

export function chargeConfirmationPreview(
  state: GameState,
  attackerId: string,
  defenderId: string,
): OrderConfirmationPreview | null {
  const preview = chargePreview(state, attackerId, defenderId);
  const attacker = state.blocks[attackerId];
  const defender = state.blocks[defenderId];
  const formation = blockFormation(state, attacker);
  if (!preview || !attacker || !defender || !formation) return null;
  const contactState = structuredClone(state);
  const contactFormation = contactState.formations[formation.id]!;
  if (!translateChargingFormation(contactState, contactFormation.id, preview)) return null;
  const contacts = formationChargeContacts(contactState, contactFormation);
  const involved = new Set(contacts.flatMap((contact) => [contact.attackerId, contact.defenderId]));
  const mathByBlock = new Map<string, string[]>();
  const contactPreviews: PressurePreview[] = [];
  const appendMath = (blockId: string, lines: readonly string[]): void => {
    const existing = mathByBlock.get(blockId) ?? [];
    mathByBlock.set(blockId, [...existing, ...(existing.length > 0 ? ["—"] : []), ...lines]);
  };
  for (const contact of contacts) {
    const contactAttacker = contactState.blocks[contact.attackerId]!;
    const contactDefender = contactState.blocks[contact.defenderId]!;
    const chargeBonus = isCavalry(preview.unitType)
      ? preview.momentum
      : infantryChargeBonusForContact(contactState, contactAttacker, contactDefender).attackBonus;
    const pressure = pressurePreview(contactState, contact.attackerId, contact.defenderId, {
      pressureBonus: chargeBonus,
      cavalryCharge: isCavalry(preview.unitType),
    });
    if (!pressure) continue;
    contactPreviews.push(pressure);
    const impact = isCavalry(preview.unitType) ? [`Charge impact: ${preview.impactDamage} guaranteed damage before melee.`] : [];
    appendMath(contact.attackerId, [...impact, ...blockCombatMath(pressure, "attacker")]);
    appendMath(contact.defenderId, [...impact, ...blockCombatMath(pressure, "defender")]);
  }
  const outcomes = Array.from({ length: 100 }, (_, defenceRoll) => {
    const simulated = structuredClone(state);
    resolveCharge(simulated, attackerId, defenderId, { defenceRollOverride: defenceRoll });
    return simulated;
  });
  const outcomePreview = aggregateCombatOutcomes(state, outcomes, involved, mathByBlock);
  return {
    kind: "combat",
    title: "Confirm charge",
    detail: preview.reordered
      ? "The formation reorders before contact. ! is certain; ? is possible. Hover highlighted tiles for percentages."
      : "Highlighted tiles show fixed movement and possible advances. ! is certain; ? is possible. Hover for percentages.",
    tiles: outcomePreview.tiles,
    damage: outcomePreview.damage,
    forecast: outcomePreview.forecast,
    contactSummary: contactSummaryLines(contactPreviews),
  };
}

function translateChargingFormation(state: GameState, formationId: string, preview: ChargePreview): boolean {
  const formation = state.formations[formationId]!;
  const overflow = planTerrainOverflow(state, preview.relocations.map((relocation) => ({
    block: state.blocks[relocation.blockId]!,
    origin: relocation.origin,
    destination: relocation.destination,
  })));
  if (!overflow) return false;
  clearFormationBrace(state, formation.id);
  for (const relocation of preview.relocations) {
    const block = state.blocks[relocation.blockId]!;
    block.position = { ...relocation.destination };
    block.chargeDistance = preview.distance;
  }
  applyTerrainOverflow(state, overflow);
  emitEvent(state, "formation_moved", `${formation.name} charged ${preview.distance} ${preview.distance === 1 ? "square" : "squares"}${preview.reordered ? " in a reordered formation" : ""}.`, {
    blockIds: [...formation.blockIds], formationIds: [formation.id],
    detail: { kind: "charge" },
  });
  return true;
}

export function resolveCharge(
  state: GameState,
  attackerId: string,
  defenderId: string,
  options: Pick<PressureOptions, "defenceRollOverride"> = {},
): boolean {
  return withMoraleOrder(state, () => resolveChargeContacts(state, attackerId, defenderId, options));
}

function advanceChargingFile(state: GameState, formation: Formation, attackerId: string, attackerOrigin: GridPosition, defenderOrigin: GridPosition): string[] {
  return advanceCombatFile(state, formation, attackerId, attackerOrigin, defenderOrigin, {
    reason: "charge",
    stopAtWavering: false,
  });
}

/** Infantry hit once with a pressure bonus fixed when the charge landed, then follow up if the enemy gives way. */
function resolveInfantryContact(
  state: GameState,
  formation: Formation,
  contact: FormationChargeContact & ReturnType<typeof infantryChargeBonusForContact>,
  options: Pick<PressureOptions, "defenceRollOverride">,
): void {
  const attacker = state.blocks[contact.attackerId];
  const defender = state.blocks[contact.defenderId];
  if (!attacker || !defender) return;
  const attackerOrigin = { ...attacker.position };
  const defenderOrigin = { ...defender.position };
  emitEvent(state, "charge_impact", contact.bonusNullified
    ? `${attacker.id}'s charge bonus was stopped by the braced front.`
    : `${attacker.id} gained +${contact.attackBonus} pressure from the charge.`, {
    blockIds: [attacker.id, defender.id], formationIds: [formation.id], position: { ...defender.position },
  });
  const result = resolvePressure(state, attacker.id, defender.id, {
    pressureBonus: contact.attackBonus,
    defenceRollOverride: options.defenceRollOverride,
  });
  if (result.vacated && state.blocks[attacker.id]) advanceChargingFile(state, formation, attacker.id, attackerOrigin, defenderOrigin);
}

/** A cavalry block spends momentum on each collision and rides on down its lane while the enemy keeps giving way. */
function resolveCavalryLane(
  state: GameState,
  formation: Formation,
  contact: FormationChargeContact,
  startingMomentum: number,
  options: Pick<PressureOptions, "defenceRollOverride">,
): void {
  const attacker = state.blocks[contact.attackerId];
  if (!attacker) return;
  attacker.chargeMomentum = startingMomentum;
  let currentDefenderId: string | null = contact.defenderId;
  while (currentDefenderId && attacker.chargeMomentum > 0 && state.blocks[attacker.id]) {
    const currentDefender = state.blocks[currentDefenderId];
    if (!currentDefender) break;
    const attackerOrigin = { ...attacker.position };
    const defenderOrigin = { ...currentDefender.position };
    const incomingDirection = directionBetween(currentDefender.position, attacker.position);
    const defenderFormation = blockFormation(state, currentDefender);
    if (defenderFormation?.isBraced && hasEquipment(defenderFormation, "brace_against_charge")
      && incomingDirection === blockFacing(state, currentDefender.id) && !blockIsWavering(state, currentDefender.id)) {
      damageBlock(state, attacker.id, 1, "braced spears");
      if (!state.blocks[attacker.id]) break;
    }
    const impact = Math.max(1, Math.floor(attacker.chargeMomentum / 3));
    emitEvent(state, "charge_impact", `${attacker.id} inflicted ${impact} impact damage with ${attacker.chargeMomentum} momentum.`, {
      blockIds: [attacker.id, currentDefender.id], position: { ...currentDefender.position },
    });
    const destroyed = damageBlock(state, currentDefender.id, impact, "charge impact");
    let advanced = destroyed;
    if (!destroyed) {
      const pressureResult = resolvePressure(state, attacker.id, currentDefender.id, {
        pressureBonus: attacker.chargeMomentum,
        cavalryCharge: true,
        defenceRollOverride: options.defenceRollOverride,
      });
      advanced = pressureResult.vacated;
    }
    if (advanced && state.blocks[attacker.id]) {
      advanced = advanceChargingFile(state, formation, attacker.id, attackerOrigin, defenderOrigin).length > 0;
    }
    attacker.chargeMomentum = Math.max(0, attacker.chargeMomentum - BALANCE.chargeCollisionCost - BALANCE.chargeAdvanceCost);
    if (!advanced) {
      if (attacker.chargeMomentum <= 0 && state.blocks[currentDefender.id]) createContestedCell(state, attacker.id, currentDefender.id);
      break;
    }
    if (attacker.isContested || attacker.chargeMomentum <= 0) break;
    const nextPosition = addPosition(attacker.position, directionVector(formation.facing));
    if (!terrainAllowsCharge(terrainAt(state, nextPosition))) attacker.chargeMomentum = 0;
    currentDefenderId = enemyBlockAt(state, nextPosition, attacker.factionId)?.id ?? null;
  }
}

function resolveChargeContacts(
  state: GameState,
  attackerId: string,
  defenderId: string,
  options: Pick<PressureOptions, "defenceRollOverride">,
): boolean {
  const preview = chargePreview(state, attackerId, defenderId);
  if (!preview) return false;
  const formation = state.formations[state.blocks[attackerId]!.formationId!]!;
  if (!translateChargingFormation(state, formation.id, preview)) return false;
  const chargeContacts = formationChargeContacts(state, formation);
  if (isCavalry(preview.unitType)) {
    for (const contact of chargeContacts) resolveCavalryLane(state, formation, contact, preview.momentum, options);
  } else {
    // Bonuses are fixed for every contact before any of them fights, so earlier shoves cannot change later ones.
    const contactsWithBonuses = chargeContacts.map((contact) => ({
      ...contact,
      ...infantryChargeBonusForContact(state, state.blocks[contact.attackerId]!, state.blocks[contact.defenderId]!),
    }));
    for (const contact of contactsWithBonuses) resolveInfantryContact(state, formation, contact, options);
  }
  formation.hasActivated = true;
  formation.movementRemaining = 0;
  recalculateAllConnectivity(state);
  return true;
}
