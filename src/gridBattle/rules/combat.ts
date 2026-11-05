import { BALANCE } from "../model/config";
import {
  forcedRelocationHazard,
  terrainAllowsCharge,
  terrainAt,
  terrainBlocksForcedRelocation,
  terrainLimitsInfantryCharge,
  terrainMeleeDamageReceivedBonus,
  terrainResistanceModifier,
  type ForcedRelocationHazard,
} from "../model/terrain";
import { terrainDefinition } from "../model/terrainDefinitions";
import { blocksAt, enemyBlockAt, friendlyBlockAt, inBounds, occupancyAt, positionKey } from "../model/occupancy";
import type {
  ChargePreview,
  Character,
  CombatCalculationTerm,
  Direction,
  Formation,
  GameState,
  GridPosition,
  OrderConfirmationPreview,
  PressurePreview,
  RetreatMode,
  TroopBlock,
} from "../model/types";
import { emitEvent } from "../events/events";
import {
  addPosition,
  directionBetween,
  directionVector,
  facingContactModifier,
  formationEdgeType,
  manhattanDistance,
  oppositeDirection,
  orthogonalNeighbours,
  rotateDirection,
} from "./direction";
import { formationBlocks, planFormationAdvance } from "./movement";
import { provisionalFormationFamily, recalculateAllConnectivity, recalculateFormationConnectivity } from "./splitting";
import { clearFormationEngagementFacings, effectiveBlockFacing } from "./blockFacing";
import { clearBlockFormationBrace, clearFormationBrace } from "./brace";
import { applyTerrainOverflow, planTerrainOverflow } from "./terrainOverflow";
import { advanceCombatFile } from "./fileAdvance";
import { aggregateCombatOutcomes, blockCombatMath } from "./combatPreview";
import {
  blockHitPoints,
  blockModelsAfterDamage,
  formationModelCount,
  hasEquipment,
  isCavalry,
  isInfantry,
} from "../model/unitStats";

function formationCohesionModifier(cohesion: number): number {
  if (cohesion >= 8) return 1;
  if (cohesion <= 3) return -2;
  return 0;
}

function disorderPenalty(disorder: number): number {
  return Math.min(BALANCE.disorderPenaltyMaximum, Math.floor(disorder / 2));
}

function formationStayingPower(state: GameState, formationId: string | null): number {
  const blockCount = formationId ? state.formations[formationId]?.blockIds.length ?? 0 : 0;
  return Math.min(BALANCE.maximumFormationStayingPower, Math.floor(Math.max(0, blockCount - 1) / 6));
}

function hostCharacter(state: GameState, block: TroopBlock): Character | undefined {
  const character = block.characterId ? state.characters[block.characterId] : undefined;
  return character?.status === "defeated" ? undefined : character;
}

export function rearSupport(state: GameState, blockId: string): number {
  const block = state.blocks[blockId];
  const formation = block?.formationId ? state.formations[block.formationId] : undefined;
  if (!block || !formation || block.isContested) return 0;
  const behind = directionVector(oppositeDirection(effectiveBlockFacing(state, block.id)));
  let support = 0;
  let cursor = block.position;
  for (let depth = 0; depth < BALANCE.rearSupportMaximum; depth += 1) {
    cursor = addPosition(cursor, behind);
    const supporter = friendlyBlockAt(state, cursor, block.factionId);
    if (!supporter || supporter.formationId !== formation.id || supporter.isContested) break;
    support += 1;
  }
  return support;
}

function commandCohesionBonus(state: GameState, block: TroopBlock): number {
  return Object.values(state.characters).some((character) => {
    if (character.role !== "commander" || character.factionId !== block.factionId || character.status === "defeated") return false;
    const host = state.blocks[character.hostBlockId];
    return host && manhattanDistance(host.position, block.position) <= character.commandRadius;
  }) ? 1 : 0;
}

function sumCalculation(terms: readonly CombatCalculationTerm[]): number {
  return terms.reduce((total, term) => total + term.value, 0);
}

function forcedRetreatHazard(
  state: GameState,
  block: TroopBlock,
  incomingDirection: Direction,
): ForcedRelocationHazard | null {
  const retreat = traceRetreat(state, block, oppositeDirection(incomingDirection));
  return retreatPlanHazard(state, retreat);
}

export function attackingPressureBreakdown(
  state: GameState,
  blockId: string,
  chargeBonus = 0,
): CombatCalculationTerm[] {
  const block = state.blocks[blockId];
  const formation = block?.formationId ? state.formations[block.formationId] : undefined;
  if (!block || !formation || block.isContested) return [];
  const character = hostCharacter(state, block);
  const effectiveCohesion = Math.min(10, formation.cohesion + commandCohesionBonus(state, block));
  return [
    { label: `${formation.unit.unitType.replaceAll("_", " ")} pressure`, value: BALANCE.unitTypePressure[formation.unit.unitType] },
    { label: `${formation.formationMode} formation`, value: BALANCE.formationPressure[formation.formationMode] },
    { label: "Rear support", value: rearSupport(state, block.id) },
    { label: "Cohesion", value: formationCohesionModifier(effectiveCohesion) },
    { label: character ? character.name : "Character", value: character?.pressureBonus ?? 0 },
    { label: "Order / charge", value: chargeBonus },
    { label: "Disorder", value: -disorderPenalty(block.disorder) },
  ];
}

export function attackingPressure(state: GameState, blockId: string, chargeBonus = 0): number {
  return sumCalculation(attackingPressureBreakdown(state, blockId, chargeBonus));
}

export function defendingResistanceBreakdown(
  state: GameState,
  blockId: string,
  incomingDirection: Direction,
  cavalryCharge = false,
): CombatCalculationTerm[] {
  const block = state.blocks[blockId];
  const formation = block?.formationId ? state.formations[block.formationId] : undefined;
  if (!block || !formation) return [];
  const character = hostCharacter(state, block);
  const terrain = terrainAt(state, block.position)!;
  const facing = effectiveBlockFacing(state, block.id);
  const effectiveCohesion = Math.min(10, formation.cohesion + commandCohesionBonus(state, block));
  const spearBonus = cavalryCharge && formation.isBraced && hasEquipment(formation, "brace_against_charge")
    && incomingDirection === facing && block.disorder < 4
    ? BALANCE.spearChargeResistance
    : 0;
  const retreatHazard = forcedRetreatHazard(state, block, incomingDirection);
  return [
    { label: `${formation.unit.unitType.replaceAll("_", " ")} resistance`, value: BALANCE.unitTypeResistance[formation.unit.unitType] },
    { label: `${formation.formationMode} formation`, value: BALANCE.formationResistance[formation.formationMode] },
    { label: "Rear support", value: rearSupport(state, block.id) },
    { label: "Cohesion", value: formationCohesionModifier(effectiveCohesion) },
    { label: character ? character.name : "Character", value: character?.resistanceBonus ?? 0 },
    { label: terrainDefinition(terrain).label, value: terrainResistanceModifier(terrain) },
    { label: retreatHazard === "cliff" ? "Cliff behind" : "Deep water behind", value: retreatHazard ? BALANCE.lethalRetreatResistance : 0 },
    { label: `${formationEdgeType(facing, incomingDirection)} contact`, value: facingContactModifier(facing, incomingDirection) },
    { label: "Braced spears", value: spearBonus },
    { label: "Disorder", value: -disorderPenalty(block.disorder) },
  ];
}

export function defendingResistance(
  state: GameState,
  blockId: string,
  incomingDirection: Direction,
  cavalryCharge = false,
): number {
  return sumCalculation(defendingResistanceBreakdown(
    state,
    blockId,
    incomingDirection,
    cavalryCharge,
  ));
}

interface RetreatPlan {
  destination: GridPosition;
  destinations: GridPosition[];
  chain: TroopBlock[];
  blocked: boolean;
  enemyCollisionId?: string;
}

function retreatPlanHazard(state: GameState, retreat: RetreatPlan): ForcedRelocationHazard | null {
  for (let index = 0; index < retreat.destinations.length; index += 1) {
    const block = retreat.chain[index];
    const destination = retreat.destinations[index];
    if (!block || !destination) continue;
    const hazard = forcedRelocationHazard(state, block.position, destination);
    if (hazard) return hazard;
  }
  return null;
}

function traceRetreat(state: GameState, defender: TroopBlock, retreatDirection: Direction): RetreatPlan {
  const vector = directionVector(retreatDirection);
  const chain: TroopBlock[] = [defender];
  let cursor = addPosition(defender.position, vector);
  let previous = defender.position;
  while (inBounds(state, cursor)
    && !terrainBlocksForcedRelocation(state, previous, cursor)) {
    const occupants = blocksAt(state, cursor);
    if (occupants.length === 0) {
      return {
        destination: addPosition(defender.position, vector),
        destinations: chain.map((block) => addPosition(block.position, vector)),
        chain,
        blocked: false,
      };
    }
    const friendly = occupants.find((block) => block.factionId === defender.factionId);
    if (!friendly) {
      const enemy = occupants.find((block) => block.factionId !== defender.factionId);
      if (enemy && !enemy.isContested && occupants.length === 1) {
        return {
          destination: addPosition(defender.position, vector),
          destinations: chain.map((block) => addPosition(block.position, vector)),
          chain,
          blocked: false,
          enemyCollisionId: enemy.id,
        };
      }
      break;
    }
    if (friendly.isContested || occupants.length > 1) break;
    chain.push(friendly);
    previous = cursor;
    cursor = addPosition(cursor, vector);
  }
  return {
    destination: addPosition(defender.position, vector),
    destinations: [],
    chain,
    blocked: true,
  };
}

function offsetPosition(
  position: GridPosition,
  retreatDirection: Direction,
  lateralDirection: Direction | null,
  retreatDistance: number,
): GridPosition {
  const retreat = directionVector(retreatDirection);
  const lateral = lateralDirection ? directionVector(lateralDirection) : { x: 0, y: 0 };
  return {
    x: position.x + retreat.x * retreatDistance + lateral.x,
    y: position.y + retreat.y * retreatDistance + lateral.y,
  };
}

function chaoticRetreatPlan(state: GameState, defender: TroopBlock, retreatDirection: Direction): RetreatPlan {
  const straight = traceRetreat(state, defender, retreatDirection);
  if (straight.blocked || straight.enemyCollisionId) return straight;
  const movingIds = new Set(straight.chain.map((block) => block.id));
  const claimedDestinations = new Set<string>();
  const destinationsById = new Map<string, GridPosition>();

  for (let index = straight.chain.length - 1; index >= 0; index -= 1) {
    const block = straight.chain[index]!;
    const firstSide = rotateDirection(retreatDirection, index % 2 === 0 ? "left" : "right");
    const secondSide = rotateDirection(retreatDirection, index % 2 === 0 ? "right" : "left");
    const candidates = index === 0
      ? [offsetPosition(block.position, retreatDirection, null, 1)]
      : [
        offsetPosition(block.position, retreatDirection, firstSide, 1),
        offsetPosition(block.position, retreatDirection, firstSide, 2),
        offsetPosition(block.position, retreatDirection, secondSide, 1),
        offsetPosition(block.position, retreatDirection, secondSide, 2),
        offsetPosition(block.position, retreatDirection, null, 2),
        offsetPosition(block.position, retreatDirection, null, 1),
      ];
    const destination = candidates.find((candidate) => {
      if (!inBounds(state, candidate) || terrainBlocksForcedRelocation(state, block.position, candidate)) return false;
      if (claimedDestinations.has(positionKey(candidate))) return false;
      return blocksAt(state, candidate).every((occupant) => movingIds.has(occupant.id));
    });
    if (!destination) {
      return { ...straight, destinations: [], blocked: true };
    }
    claimedDestinations.add(positionKey(destination));
    destinationsById.set(block.id, destination);
  }

  const destinations = straight.chain.map((block) => destinationsById.get(block.id)!);
  return { destination: destinations[0]!, destinations, chain: straight.chain, blocked: false };
}

function retreatModeFor(
  state: GameState,
  defender: TroopBlock,
  netPressure: number,
): RetreatMode {
  const formation = defender.formationId ? state.formations[defender.formationId] : undefined;
  const stayingPower = formationStayingPower(state, defender.formationId);
  return netPressure >= BALANCE.chaoticRetreatPressureThreshold + stayingPower
    || (formation?.cohesion ?? 0) <= BALANCE.chaoticRetreatCohesionThreshold - stayingPower
    || defender.disorder >= BALANCE.chaoticRetreatDisorderThreshold
    || formation?.status !== "formed"
    ? "chaotic"
    : "good_order";
}

function deterministicDefenceRoll(state: GameState, attackerId: string, defenderId: string): number {
  let hash = state.round * 31;
  for (const character of `${attackerId}|${defenderId}`) hash = (hash * 33 + character.charCodeAt(0)) >>> 0;
  return hash % 100;
}

export function meleeDamagePreview(
  state: GameState,
  attackerId: string,
  defenderId: string,
  defenceRollOverride?: number,
): Pick<PressurePreview,
  | "rawDamage"
  | "damageOnHit"
  | "minimumDamage"
  | "maximumDamage"
  | "damagePenalty"
  | "expectedDamage"
  | "flankBonus"
  | "terrainDamageBonus"
  | "shieldArmour"
  | "braceArmour"
  | "armour"
  | "defence"
  | "defenceRoll"
  | "evaded"
  | "contactEdge"
  | "expectedCasualties"
> | null {
  const attacker = state.blocks[attackerId];
  const defender = state.blocks[defenderId];
  const attackerFormation = attacker?.formationId ? state.formations[attacker.formationId] : undefined;
  const defenderFormation = defender?.formationId ? state.formations[defender.formationId] : undefined;
  if (!attacker || !defender || !attackerFormation || !defenderFormation) return null;
  const incomingDirection = directionBetween(defender.position, attacker.position);
  const contactEdge = incomingDirection
    ? formationEdgeType(effectiveBlockFacing(state, defender.id), incomingDirection)
    : "side";
  const flankBonus = contactEdge === "front" ? 0 : BALANCE.flankDamageBonus;
  const terrainDamageBonus = terrainMeleeDamageReceivedBonus(terrainAt(state, defender.position));
  const character = hostCharacter(state, attacker);
  const rawDamage = attackerFormation.unit.attack + (character?.meleeBonus ?? 0)
    + (character?.temporaryMeleeBonus ?? 0) + flankBonus + terrainDamageBonus;
  const shieldArmour = contactEdge === "front" && hasEquipment(defenderFormation, "shield_front")
    ? BALANCE.shieldFrontArmour : 0;
  const braceArmour = defenderFormation.isBraced ? BALANCE.braceArmourBonus : 0;
  const armour = Math.max(0, defenderFormation.unit.armour);
  const defence = Math.max(0, Math.min(100, defenderFormation.unit.defence));
  const defenceRoll = defenceRollOverride ?? deterministicDefenceRoll(state, attackerId, defenderId);
  const evaded = defenceRoll < defence;
  const damageOnHit = Math.min(BALANCE.maximumMeleeDamage, Math.max(0, rawDamage - armour - shieldArmour - braceArmour));
  const minimumDamage = defence > 0 ? 0 : damageOnHit;
  const maximumDamage = defence >= 100 ? 0 : damageOnHit;
  const expectedDamage = evaded ? 0 : damageOnHit;
  const expectedCasualties = defender.models - blockModelsAfterDamage(defenderFormation, defender, expectedDamage);
  return {
    rawDamage,
    damageOnHit,
    minimumDamage,
    maximumDamage,
    damagePenalty: 0,
    expectedDamage,
    flankBonus,
    terrainDamageBonus,
    shieldArmour,
    braceArmour,
    armour,
    defence,
    defenceRoll,
    evaded,
    contactEdge,
    expectedCasualties,
  };
}

export interface PressureOptions {
  pressureBonus?: number;
  damagePenalty?: number;
  cavalryCharge?: boolean;
  allowAnyContact?: boolean;
  followUp?: boolean;
  retreatRequiresMoraleLoss?: boolean;
  retreatMoraleBaseline?: number;
  defenceRollOverride?: number;
}

function planRetreat(
  state: GameState,
  defender: TroopBlock,
  retreatDirection: Direction,
  mode: RetreatMode,
): RetreatPlan {
  return mode === "chaotic"
    ? chaoticRetreatPlan(state, defender, retreatDirection)
    : traceRetreat(state, defender, retreatDirection);
}

export function pressurePreview(
  state: GameState,
  attackerId: string,
  defenderId: string,
  options: PressureOptions = {},
): PressurePreview | null {
  const attacker = state.blocks[attackerId];
  const defender = state.blocks[defenderId];
  const attackerFormation = attacker?.formationId ? state.formations[attacker.formationId] : undefined;
  const defenderFormation = defender?.formationId ? state.formations[defender.formationId] : undefined;
  if (!attacker || !defender || !attackerFormation || !defenderFormation || attacker.factionId === defender.factionId) return null;
  const contactDirection = directionBetween(defender.position, attacker.position)
    ?? (attacker.isContested && defender.isContested ? effectiveBlockFacing(state, defender.id) : null);
  if (!contactDirection || (!options.allowAnyContact
    && directionBetween(attacker.position, defender.position) !== effectiveBlockFacing(state, attacker.id))) return null;
  const attack = attackingPressure(state, attackerId, options.pressureBonus ?? 0);
  const defence = defendingResistance(state, defenderId, contactDirection, options.cavalryCharge ?? false);
  const net = attack - defence;
  const damagePenalty = options.damagePenalty ?? 0;
  const damage = meleeDamagePreview(state, attackerId, defenderId, options.defenceRollOverride)!;
  const damageOnHit = Math.max(0, damage.damageOnHit - damagePenalty);
  const minimumDamage = damage.defence > 0 ? 0 : damageOnHit;
  const maximumDamage = damage.defence >= 100 ? 0 : damageOnHit;
  const expectedDamage = Math.max(0, damage.expectedDamage - damagePenalty);
  const expectedCasualties = defender.models - blockModelsAfterDamage(defenderFormation, defender, expectedDamage);
  const retreatDirection = oppositeDirection(contactDirection);
  const retreatMode = retreatModeFor(state, defender, net);
  const retreat = planRetreat(state, defender, retreatDirection, retreatMode);
  const retreatHazard = net >= 2 ? retreatPlanHazard(state, retreat) : null;
  const retreatIntoDeepWater = retreatHazard === "river_deep";
  const characterModifiers: string[] = [];
  const attackingCharacter = hostCharacter(state, attacker);
  const defendingCharacter = hostCharacter(state, defender);
  if (attackingCharacter?.pressureBonus) characterModifiers.push(`${attackingCharacter.name} +${attackingCharacter.pressureBonus} pressure`);
  if (defendingCharacter?.resistanceBonus) characterModifiers.push(`${defendingCharacter.name} +${defendingCharacter.resistanceBonus} resistance`);
  const retreatDescription = retreatMode === "chaotic" ? "chaotic retreat" : "retreat in good order";
  const casualtyDescription = expectedCasualties === 0
    ? "no casualties"
    : `${expectedCasualties} ${expectedCasualties === 1 ? "casualty" : "casualties"}`;
  const expectedResult = net <= 0 ? `${casualtyDescription}; defender holds`
    : net === 1 ? `${casualtyDescription}; defender gains disorder`
      : retreatHazard === "river_deep" ? `${casualtyDescription}; forced into deep water and drowns`
        : retreatHazard === "cliff" ? `${casualtyDescription}; forced over a cliff and destroyed`
      : net <= 5 ? `${casualtyDescription}; ${retreatDescription}`
        : `${casualtyDescription}; ${retreatDescription}; possible advance`;
  return {
    attackerId,
    defenderId,
    attackingPressure: attack,
    defendingResistance: defence,
    netPressure: net,
    rawDamage: damage.rawDamage,
    damageOnHit,
    minimumDamage,
    maximumDamage,
    damagePenalty,
    expectedDamage,
    flankBonus: damage.flankBonus,
    terrainDamageBonus: damage.terrainDamageBonus,
    shieldArmour: damage.shieldArmour,
    braceArmour: damage.braceArmour,
    armour: damage.armour,
    defence: damage.defence,
    defenceRoll: damage.defenceRoll,
    evaded: damage.evaded,
    contactEdge: damage.contactEdge,
    expectedCasualties,
    expectedResult,
    retreatMode,
    retreatDestination: retreat.destination,
    retreatDestinations: retreat.destinations,
    cascadeLength: Math.max(0, retreat.chain.length - 1),
    mayCompress: retreat.blocked,
    retreatIntoDeepWater,
    retreatHazard,
    characterModifiers,
    pressureMath: attackingPressureBreakdown(state, attackerId, options.pressureBonus ?? 0),
    resistanceMath: defendingResistanceBreakdown(state, defenderId, contactDirection, options.cavalryCharge ?? false),
  };
}

function shockFormation(state: GameState, formationId: string | null, loss: number): void {
  const formation = formationId ? state.formations[formationId] : undefined;
  if (!formation) return;
  formation.cohesion = Math.max(0, formation.cohesion - loss);
  if (formation.cohesion === 0) formation.status = "routed";
  else if (formation.cohesion <= 3) formation.status = "disordered";
}

function formationModels(state: GameState, formation: Formation): number {
  return formationModelCount(state, formation);
}

function moraleFamily(state: GameState, formationId: string): Formation[] {
  return provisionalFormationFamily(state, formationId).filter((formation) => state.formations[formation.id]);
}

function familyModels(state: GameState, formationId: string): number {
  return moraleFamily(state, formationId).reduce((total, formation) => total + formationModels(state, formation), 0);
}

function shockMoraleFamily(state: GameState, formationId: string, loss: number): Formation[] {
  const family = moraleFamily(state, formationId);
  for (const formation of family) shockFormation(state, formation.id, loss);
  return family;
}

function applyCasualtyThresholds(state: GameState, formationId: string | null): void {
  if (!formationId || !state.formations[formationId]) return;
  const family = moraleFamily(state, formationId);
  if (family.length === 0) return;
  const initialModels = Math.max(...family.map((formation) => formation.initialModelCount));
  const currentModels = family.reduce((total, formation) => total + formationModels(state, formation), 0);
  const previousStage = Math.max(...family.map((formation) => formation.casualtyMoraleStage));
  const remainingRatio = initialModels > 0 ? currentModels / initialModels : 0;
  let nextStage = previousStage;
  let moraleLoss = 0;
  for (let index = previousStage; index < BALANCE.casualtyMoraleThresholds.length; index += 1) {
    const threshold = BALANCE.casualtyMoraleThresholds[index]!;
    if (remainingRatio > threshold.remainingRatio) break;
    nextStage = index + 1;
    moraleLoss += threshold.moraleLoss;
  }
  if (nextStage === previousStage) return;
  for (const formation of family) formation.casualtyMoraleStage = nextStage;
  shockMoraleFamily(state, formationId, moraleLoss);
  const crossed = BALANCE.casualtyMoraleThresholds[nextStage - 1]!;
  const name = family[0]!.name.replace(/ – (Main Body|Fragment [A-Z]+)$/, "");
  emitEvent(state, "morale_shock", `${name} fell to ${Math.round(crossed.remainingRatio * 100)}% of its models and lost ${moraleLoss} morale.`, {
    blockIds: family.flatMap((formation) => formation.blockIds),
    formationIds: family.map((formation) => formation.id),
  });
}

export function applyTacticalMoraleShock(
  state: GameState,
  formationId: string,
  enemyFormationIds: readonly string[],
  worstContactEdge: "front" | "side" | "rear",
): void {
  const formation = state.formations[formationId];
  if (!formation) return;
  const family = moraleFamily(state, formationId);
  if (family.length === 0) return;
  let moraleLoss = 0;
  const reasons: string[] = [];
  if (worstContactEdge !== "front" && family.every((candidate) => candidate.lastFlankShockRound !== state.round)) {
    moraleLoss += worstContactEdge === "rear" ? BALANCE.rearFlankMoraleLoss : BALANCE.sideFlankMoraleLoss;
    reasons.push(worstContactEdge === "rear" ? "attacked from the rear" : "flanked");
    for (const candidate of family) candidate.lastFlankShockRound = state.round;
  }
  const enemyFamilies = new Map<string, string>();
  for (const enemyFormationId of enemyFormationIds) {
    const enemy = state.formations[enemyFormationId];
    if (enemy) enemyFamilies.set(enemy.provisionalFamilyId ?? enemy.id, enemy.id);
  }
  const enemyModels = [...enemyFamilies.values()].reduce((total, id) => total + familyModels(state, id), 0);
  const ownModels = familyModels(state, formationId);
  const ratio = ownModels > 0 ? enemyModels / ownModels : Number.POSITIVE_INFINITY;
  if (ratio >= BALANCE.outnumberedRatio
    && family.every((candidate) => candidate.lastOutnumberedShockRound !== state.round)) {
    const heavilyOutnumbered = ratio >= BALANCE.heavilyOutnumberedRatio;
    moraleLoss += heavilyOutnumbered ? BALANCE.heavilyOutnumberedMoraleLoss : BALANCE.outnumberedMoraleLoss;
    reasons.push(heavilyOutnumbered ? "heavily outnumbered" : "outnumbered");
    for (const candidate of family) candidate.lastOutnumberedShockRound = state.round;
  }
  if (moraleLoss <= 0) return;
  shockMoraleFamily(state, formationId, moraleLoss);
  emitEvent(state, "morale_shock", `${formation.name} lost ${moraleLoss} morale: ${reasons.join(" and ")}.`, {
    blockIds: family.flatMap((candidate) => candidate.blockIds),
    formationIds: family.map((candidate) => candidate.id),
  });
}

function applyLeaderLossShock(state: GameState, formationId: string | null, characterName: string): void {
  if (!formationId || !state.formations[formationId]) return;
  const family = shockMoraleFamily(state, formationId, BALANCE.leaderDeathMoraleLoss);
  emitEvent(state, "morale_shock", `${family[0]?.name ?? "The formation"} lost ${BALANCE.leaderDeathMoraleLoss} morale when ${characterName} fell.`, {
    blockIds: family.flatMap((formation) => formation.blockIds),
    formationIds: family.map((formation) => formation.id),
  });
}

function rescueOrDefeatCharacter(state: GameState, block: TroopBlock): void {
  if (!block.characterId) return;
  const character = state.characters[block.characterId];
  if (!character) return;
  const rescue = orthogonalNeighbours(block.position)
    .flatMap((position) => blocksAt(state, position))
    .filter((candidate) => candidate.factionId === block.factionId && !candidate.isContested)
    .sort((a, b) => Number(b.formationId === block.formationId) - Number(a.formationId === block.formationId) || a.id.localeCompare(b.id))[0];
  if (rescue) {
    rescue.characterId = character.id;
    character.hostBlockId = rescue.id;
    character.wounds += 1;
    character.status = character.wounds >= character.maxWounds ? "defeated" : "wounded";
    if (character.status === "defeated") applyLeaderLossShock(state, rescue.formationId, character.name);
    emitEvent(state, "character_transferred", `${character.name} escaped to ${rescue.id} with a wound.`, {
      blockIds: [block.id, rescue.id], formationIds: [rescue.formationId!],
    });
  } else {
    character.status = "defeated";
    applyLeaderLossShock(state, block.formationId, character.name);
    emitEvent(state, "duel_resolved", `${character.name} was lost with their block.`, { blockIds: [block.id] });
  }
}

function clearOrphanedContestedCell(state: GameState, position: GridPosition): string[] {
  const occupants = blocksAt(state, position);
  if (new Set(occupants.map((block) => block.factionId)).size > 1) return [];
  const affectedFormationIds = new Set<string>();
  for (const survivor of occupants) {
    survivor.isContested = false;
    survivor.engagementFacing = undefined;
    if (survivor.formationId) affectedFormationIds.add(survivor.formationId);
  }
  return [...affectedFormationIds];
}

/** A partner can leave a contested cell without dying there (forced retreat, routing dispersal). */
export function clearOrphanedContestedFlags(state: GameState): void {
  const affectedFormationIds = new Set<string>();
  for (const block of Object.values(state.blocks)) {
    if (!block.isContested) continue;
    for (const formationId of clearOrphanedContestedCell(state, block.position)) affectedFormationIds.add(formationId);
  }
  for (const formationId of affectedFormationIds) {
    if (state.formations[formationId]) recalculateFormationConnectivity(state, formationId);
  }
}

export function damageBlock(state: GameState, blockId: string, amount: number, reason: string): boolean {
  const block = state.blocks[blockId];
  if (!block) return true;
  const formation = block.formationId ? state.formations[block.formationId] : undefined;
  if (!formation) return false;
  const hitPointsBefore = blockHitPoints(formation, block);
  const damage = Math.min(hitPointsBefore, Math.max(0, amount));
  const modelsBefore = block.models;
  const remainingHitPoints = hitPointsBefore - damage;
  block.models = Math.ceil(remainingHitPoints / formation.unit.hitPointsPerModel);
  block.wounds = block.models > 0
    ? block.models * formation.unit.hitPointsPerModel - remainingHitPoints
    : 0;
  const casualties = modelsBefore - block.models;
  if (damage > 0) {
    applyCasualtyThresholds(state, block.formationId);
    emitEvent(
      state,
      "block_damaged",
      `${block.id} suffered ${damage} damage and lost ${casualties} ${casualties === 1 ? "model" : "models"} (${reason}).`,
      {
        blockIds: [block.id], formationIds: block.formationId ? [block.formationId] : [],
        position: { ...block.position }, casualties,
      },
    );
  }
  if (block.models > 0) return false;
  rescueOrDefeatCharacter(state, block);
  const formationId = block.formationId;
  if (formationId && state.formations[formationId]) {
    state.formations[formationId]!.blockIds = state.formations[formationId]!.blockIds.filter((id) => id !== block.id);
  }
  delete state.blocks[block.id];
  const affectedFormationIds = clearOrphanedContestedCell(state, block.position);
  emitEvent(state, "block_destroyed", `${block.id} was destroyed.`, {
    blockIds: [block.id], formationIds: formationId ? [formationId] : [], position: { ...block.position },
  });
  if (formationId) recalculateFormationConnectivity(state, formationId);
  for (const affectedFormationId of affectedFormationIds) {
    if (affectedFormationId !== formationId) recalculateFormationConnectivity(state, affectedFormationId);
  }
  return true;
}

export type RetreatResult = "retreated" | "cascade" | "chaotic" | "compressed" | "destroyed";

export function retreatBlock(
  state: GameState,
  blockId: string,
  retreatDirection?: Direction,
  mode: RetreatMode = "good_order",
): RetreatResult {
  const defender = state.blocks[blockId];
  if (!defender) return "destroyed";
  const direction = retreatDirection ?? oppositeDirection(effectiveBlockFacing(state, defender.id));
  const retreat = planRetreat(state, defender, direction, mode);
  const affectedFormationIds = new Set(retreat.chain.map((block) => block.formationId).filter((id): id is string => Boolean(id)));
  if (!retreat.blocked) {
    const hazards = retreat.chain.map((block, index) =>
      forcedRelocationHazard(state, block.position, retreat.destinations[index]!));
    for (const formationId of affectedFormationIds) clearFormationBrace(state, formationId);
    const collisionIndex = retreat.enemyCollisionId ? retreat.chain.length - 1 : -1;
    for (let index = retreat.chain.length - 1; index >= 0; index -= 1) {
      const block = retreat.chain[index]!;
      if (index !== collisionIndex) block.position = { ...retreat.destinations[index]! };
    }
    if (collisionIndex >= 0) {
      createContestedCell(state, retreat.chain[collisionIndex]!.id, retreat.enemyCollisionId!);
    }
    for (const block of retreat.chain) {
      block.engagementFacing = undefined;
      block.disorder += mode === "chaotic" ? 2 : 1;
      block.hasRetreatedThisRound = true;
    }
    for (const formationId of affectedFormationIds) {
      shockFormation(state, formationId, mode === "chaotic" ? 2 : retreat.chain.length > 1 ? 1 : 0);
    }
    emitEvent(
      state,
      mode === "chaotic" ? "chaotic_retreat" : retreat.chain.length > 1 ? "retreat_cascade" : "block_retreated",
      retreat.enemyCollisionId
        ? `${defender.id} was pushed directly into ${retreat.enemyCollisionId}.`
        : mode === "chaotic"
        ? `${defender.id} broke into a chaotic retreat; ${retreat.chain.length} block${retreat.chain.length === 1 ? "" : "s"} scattered.`
        : retreat.chain.length > 1
        ? `Retreat displaced ${retreat.chain.length - 1} friendly block${retreat.chain.length === 2 ? "" : "s"}.`
        : `${defender.id} retreated one square.`,
      {
        blockIds: retreat.chain.map((block) => block.id),
        formationIds: [...affectedFormationIds],
        position: { ...retreat.destination },
      },
    );
    for (let index = 0; index < retreat.chain.length; index += 1) {
      const block = retreat.chain[index]!;
      const hazard = hazards[index];
      if (!hazard || !state.blocks[block.id]) continue;
      const drowned = hazard === "river_deep";
      emitEvent(state, drowned ? "block_drowned" : "block_fell", drowned
        ? `${block.id} was forced into deep water and drowned.`
        : `${block.id} was forced over a cliff and destroyed.`, {
        blockIds: [block.id],
        formationIds: block.formationId ? [block.formationId] : [],
        position: { ...block.position },
      });
      const formation = block.formationId ? state.formations[block.formationId] : undefined;
      damageBlock(state, block.id, formation ? blockHitPoints(formation, block) : block.models,
        drowned ? "drowning in deep water" : "being forced over a cliff");
    }
    for (const formationId of affectedFormationIds) recalculateFormationConnectivity(state, formationId, mode === "chaotic");
    if (!state.blocks[defender.id]) return "destroyed";
    return mode === "chaotic" ? "chaotic" : retreat.chain.length > 1 ? "cascade" : "retreated";
  }
  defender.disorder += 2;
  for (const block of retreat.chain.slice(1)) block.disorder += 1;
  shockFormation(state, defender.formationId, 2);
  emitEvent(state, "block_compressed", `${defender.id} was compressed with no retreat space.`, {
    blockIds: retreat.chain.map((block) => block.id),
    formationIds: [...affectedFormationIds],
    position: { ...defender.position },
  });
  return damageBlock(state, defender.id, 1, "compression") ? "destroyed" : "compressed";
}

export function createContestedCell(state: GameState, attackerId: string, defenderId: string): boolean {
  const attacker = state.blocks[attackerId];
  const defender = state.blocks[defenderId];
  if (!attacker || !defender || attacker.factionId === defender.factionId) return false;
  const targetOccupancy = occupancyAt(state, defender.position);
  if (attacker.factionId === "roman" ? targetOccupancy.romanBlockId : targetOccupancy.saxonBlockId) return false;
  clearBlockFormationBrace(state, attacker);
  attacker.position = { ...defender.position };
  attacker.isContested = true;
  defender.isContested = true;
  attacker.disorder += BALANCE.contestedDisorder;
  defender.disorder += BALANCE.contestedDisorder;
  emitEvent(state, "contested_cell_created", `${attacker.id} and ${defender.id} became intermingled.`, {
    blockIds: [attacker.id, defender.id],
    formationIds: [attacker.formationId, defender.formationId].filter((id): id is string => Boolean(id)),
    position: { ...defender.position },
  });
  const attackerCharacter = hostCharacter(state, attacker);
  const defenderCharacter = hostCharacter(state, defender);
  if (attackerCharacter && defenderCharacter) {
    attackerCharacter.status = "duelling";
    defenderCharacter.status = "duelling";
    emitEvent(state, "duel_started", `${attackerCharacter.name} engaged ${defenderCharacter.name} in a duel.`, {
      blockIds: [attacker.id, defender.id], position: { ...defender.position },
    });
  }
  if (attacker.formationId) recalculateFormationConnectivity(state, attacker.formationId);
  if (defender.formationId) recalculateFormationConnectivity(state, defender.formationId);
  return true;
}

export function resolvePressure(
  state: GameState,
  attackerId: string,
  defenderId: string,
  options: PressureOptions = {},
): { ok: boolean; vacated: boolean; compressed: boolean } {
  const preview = pressurePreview(state, attackerId, defenderId, options);
  if (!preview) return { ok: false, vacated: false, compressed: false };
  const attacker = state.blocks[attackerId]!;
  const defender = state.blocks[defenderId]!;
  const defenderPosition = { ...defender.position };
  emitEvent(state, "pressure_applied", `${attacker.id} applied ${preview.attackingPressure} pressure to ${defender.id} (${preview.netPressure} net).`, {
    blockIds: [attacker.id, defender.id], position: defenderPosition,
  });
  const destroyedByMelee = preview.expectedDamage > 0
    ? damageBlock(state, defenderId, preview.expectedDamage, "melee")
    : false;
  if (destroyedByMelee) {
    if (options.followUp && state.blocks[attackerId]) {
      clearBlockFormationBrace(state, state.blocks[attackerId]);
      state.blocks[attackerId]!.position = defenderPosition;
      emitEvent(state, "block_advanced", `${attacker.id} advanced into the gap.`, { blockIds: [attacker.id], position: defenderPosition });
      if (attacker.formationId) recalculateFormationConnectivity(state, attacker.formationId);
    }
    return { ok: true, vacated: true, compressed: false };
  }
  const survivingDefender = state.blocks[defenderId];
  const survivingFormation = survivingDefender?.formationId
    ? state.formations[survivingDefender.formationId]
    : undefined;
  const moraleBaseline = options.retreatMoraleBaseline ?? survivingFormation?.cohesion ?? 0;
  const moraleDropped = Boolean(survivingFormation && survivingFormation.cohesion < moraleBaseline);
  if (options.retreatRequiresMoraleLoss && !moraleDropped) {
    if (preview.netPressure > 0 && survivingDefender) survivingDefender.disorder += 1;
    return { ok: true, vacated: false, compressed: false };
  }
  if (preview.netPressure <= 0) {
    if (preview.netPressure <= -3) attacker.disorder += 1;
    return { ok: true, vacated: false, compressed: false };
  }
  if (preview.netPressure === 1) {
    defender.disorder += 1;
    return { ok: true, vacated: false, compressed: false };
  }
  const retreatDirection = directionBetween(attacker.position, defender.position);
  if (!retreatDirection) return { ok: false, vacated: false, compressed: false };
  const retreat = retreatBlock(state, defenderId, retreatDirection, preview.retreatMode);
  const vacated = retreat === "retreated" || retreat === "cascade" || retreat === "chaotic" || retreat === "destroyed";
  if (vacated && options.followUp && state.blocks[attackerId]) {
    clearBlockFormationBrace(state, state.blocks[attackerId]);
    state.blocks[attackerId]!.position = defenderPosition;
    emitEvent(state, "block_advanced", `${attacker.id} advanced after the retreat.`, { blockIds: [attacker.id], position: defenderPosition });
    if (attacker.formationId) recalculateFormationConnectivity(state, attacker.formationId);
  } else if (retreat === "compressed" && state.blocks[attackerId] && state.blocks[defenderId]) {
    createContestedCell(state, attackerId, defenderId);
  }
  return { ok: true, vacated, compressed: retreat === "compressed" };
}

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
  const defenderFormation = defender.formationId ? state.formations[defender.formationId] : undefined;
  const incomingDirection = directionBetween(defender.position, attackerPosition);
  const bonusNullified = Boolean(defenderFormation?.isBraced && incomingDirection
    && formationEdgeType(effectiveBlockFacing(state, defender.id), incomingDirection) === "front");
  return {
    attackBonus: bonusNullified ? 0 : BALANCE.infantryChargePressureBonus,
    bonusNullified,
  };
}

export function chargePreview(state: GameState, attackerId: string, defenderId: string): ChargePreview | null {
  const attacker = state.blocks[attackerId];
  const defender = state.blocks[defenderId];
  const formation = attacker?.formationId ? state.formations[attacker.formationId] : undefined;
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
  const formation = attacker?.formationId ? state.formations[attacker.formationId] : undefined;
  if (!preview || !attacker || !defender || !formation) return null;
  const contactState = structuredClone(state);
  const contactFormation = contactState.formations[formation.id]!;
  if (!translateChargingFormation(contactState, contactFormation.id, preview)) return null;
  const contacts = formationChargeContacts(contactState, contactFormation);
  const involved = new Set(contacts.flatMap((contact) => [contact.attackerId, contact.defenderId]));
  const mathByBlock = new Map<string, string[]>();
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
  clearFormationEngagementFacings(state, formation.id);
  for (const relocation of preview.relocations) {
    const block = state.blocks[relocation.blockId]!;
    block.position = { ...relocation.destination };
    block.chargeDistance = preview.distance;
  }
  applyTerrainOverflow(state, overflow);
  emitEvent(state, "formation_moved", `${formation.name} charged ${preview.distance} ${preview.distance === 1 ? "square" : "squares"}${preview.reordered ? " in a reordered formation" : ""}.`, {
    blockIds: [...formation.blockIds], formationIds: [formation.id],
  });
  return true;
}

export function resolveCharge(
  state: GameState,
  attackerId: string,
  defenderId: string,
  options: Pick<PressureOptions, "defenceRollOverride"> = {},
): boolean {
  const preview = chargePreview(state, attackerId, defenderId);
  if (!preview) return false;
  const initiatingAttacker = state.blocks[attackerId]!;
  const formation = state.formations[initiatingAttacker.formationId!]!;
  if (!translateChargingFormation(state, formation.id, preview)) return false;
  const chargeContacts = formationChargeContacts(state, formation);
  if (!isCavalry(preview.unitType)) {
    const contactsWithBonuses = chargeContacts.map((contact) => {
      const attacker = state.blocks[contact.attackerId]!;
      const defender = state.blocks[contact.defenderId]!;
      return { ...contact, ...infantryChargeBonusForContact(state, attacker, defender) };
    });
    for (const contact of contactsWithBonuses) {
      const attacker = state.blocks[contact.attackerId];
      const defender = state.blocks[contact.defenderId];
      if (!attacker || !defender) continue;
      const attackerOrigin = { ...attacker.position };
      const defenderOrigin = { ...defender.position };
      const bonus = contact;
      emitEvent(state, "charge_impact", bonus.bonusNullified
        ? `${attacker.id}'s charge bonus was stopped by the braced front.`
        : `${attacker.id} gained +${bonus.attackBonus} pressure from the charge.`, {
        blockIds: [attacker.id, defender.id], formationIds: [formation.id], position: { ...defender.position },
      });
      const result = resolvePressure(state, attacker.id, defender.id, {
        pressureBonus: bonus.attackBonus,
        followUp: false,
        defenceRollOverride: options.defenceRollOverride,
      });
      if (result.vacated && state.blocks[attacker.id]) {
        advanceCombatFile(state, formation, attacker.id, attackerOrigin, defenderOrigin, {
          reason: "charge",
          stopAtWavering: false,
        });
      }
    }
    formation.hasActivated = true;
    formation.movementRemaining = 0;
    recalculateAllConnectivity(state);
    return true;
  }
  for (const contact of chargeContacts) {
    const attacker = state.blocks[contact.attackerId];
    if (!attacker) continue;
    attacker.chargeMomentum = preview.momentum;
    let currentDefenderId: string | null = contact.defenderId;
    while (currentDefenderId && attacker.chargeMomentum > 0 && state.blocks[attacker.id]) {
      const currentDefender = state.blocks[currentDefenderId];
      if (!currentDefender) break;
      const attackerOrigin = { ...attacker.position };
      const defenderOrigin = { ...currentDefender.position };
      const incomingDirection = directionBetween(currentDefender.position, attacker.position);
      const defenderFormation = currentDefender.formationId ? state.formations[currentDefender.formationId] : undefined;
      if (defenderFormation?.isBraced && hasEquipment(defenderFormation, "brace_against_charge")
        && incomingDirection === effectiveBlockFacing(state, currentDefender.id) && currentDefender.disorder < 4) {
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
          followUp: false,
          defenceRollOverride: options.defenceRollOverride,
        });
        advanced = pressureResult.vacated;
      }
      if (advanced && state.blocks[attacker.id]) {
        advanced = advanceCombatFile(state, formation, attacker.id, attackerOrigin, defenderOrigin, {
          reason: "charge",
          stopAtWavering: false,
        }).length > 0;
      }
      attacker.chargeMomentum = Math.max(0, attacker.chargeMomentum - BALANCE.chargeCollisionCost - BALANCE.chargeAdvanceCost);
      if (!advanced) {
        if (attacker.chargeMomentum <= 0 && state.blocks[currentDefender.id]) createContestedCell(state, attacker.id, currentDefender.id);
        break;
      }
      if (attacker.isContested || attacker.chargeMomentum <= 0) break;
      const nextPosition = addPosition(attacker.position, directionVector(formation.facing));
      const nextTerrain = terrainAt(state, nextPosition);
      if (!terrainAllowsCharge(nextTerrain)) attacker.chargeMomentum = 0;
      currentDefenderId = enemyBlockAt(state, nextPosition, attacker.factionId)?.id ?? null;
    }
  }
  formation.hasActivated = true;
  formation.movementRemaining = 0;
  recalculateAllConnectivity(state);
  return true;
}

function modelCountModifier(models: number, capacity: number): number {
  const ratio = capacity > 0 ? models / capacity : 0;
  if (ratio >= 1) return 2;
  if (ratio >= 2 / 3) return 1;
  if (ratio >= 1 / 3) return 0;
  return -1;
}

function adjacentMeleeSupport(state: GameState, block: TroopBlock): number {
  return Math.min(2, orthogonalNeighbours(block.position).filter((position) => {
    const friendly = friendlyBlockAt(state, position, block.factionId);
    return friendly && !friendly.isContested;
  }).length);
}

export function meleeScore(state: GameState, blockId: string): number {
  const block = state.blocks[blockId];
  const formation = block?.formationId ? state.formations[block.formationId] : undefined;
  if (!block || !formation) return 0;
  const character = hostCharacter(state, block);
  return formation.unit.attack + modelCountModifier(block.models, block.modelCapacity) + (character?.meleeBonus ?? 0)
    + (character?.temporaryMeleeBonus ?? 0) + adjacentMeleeSupport(state, block) - disorderPenalty(block.disorder);
}

export function resolveContestedMelees(state: GameState): void {
  const cells = new Map<string, [string, string]>();
  for (const block of Object.values(state.blocks)) {
    if (!block.isContested) continue;
    const occupancy = occupancyAt(state, block.position);
    if (occupancy.romanBlockId && occupancy.saxonBlockId) cells.set(positionKey(block.position), [occupancy.romanBlockId, occupancy.saxonBlockId]);
  }
  const damage = new Map<string, number>();
  for (const [romanId, saxonId] of cells.values()) {
    const romanScore = meleeScore(state, romanId);
    const saxonScore = meleeScore(state, saxonId);
    const difference = romanScore - saxonScore;
    const romanInflicted = meleeDamagePreview(state, romanId, saxonId)?.expectedDamage ?? 0;
    const saxonInflicted = meleeDamagePreview(state, saxonId, romanId)?.expectedDamage ?? 0;
    if (romanInflicted > 0) damage.set(saxonId, romanInflicted);
    if (saxonInflicted > 0) damage.set(romanId, saxonInflicted);
    if (difference !== 0) {
      const winner = difference > 0 ? romanId : saxonId;
      const winnerBlock = state.blocks[winner];
      if (winnerBlock) winnerBlock.disorder += 1;
    }
    emitEvent(state, "contested_melee_resolved", `Contested melee: ${romanId} inflicted ${romanInflicted}, ${saxonId} inflicted ${saxonInflicted}.`, {
      blockIds: [romanId, saxonId], position: state.blocks[romanId] ? { ...state.blocks[romanId]!.position } : undefined,
    });
  }
  for (const [blockId, amount] of damage) damageBlock(state, blockId, amount, "contested melee");
  for (const [romanId, saxonId] of cells.values()) {
    const roman = state.blocks[romanId];
    const saxon = state.blocks[saxonId];
    if (roman && !saxon) { roman.isContested = false; roman.disorder = Math.max(2, roman.disorder); }
    if (saxon && !roman) { saxon.isContested = false; saxon.disorder = Math.max(2, saxon.disorder); }
  }
  recalculateAllConnectivity(state);
}

function defeatCharacter(state: GameState, character: Character, opponent?: Character): void {
  character.status = "defeated";
  const host = state.blocks[character.hostBlockId];
  if (host?.formationId) applyLeaderLossShock(state, host.formationId, character.name);
  if (host) {
    for (const position of orthogonalNeighbours(host.position)) {
      const friendly = friendlyBlockAt(state, position, character.factionId);
      if (friendly) friendly.disorder += 1;
    }
  }
  if (opponent) opponent.temporaryMeleeBonus = 1;
  emitEvent(state, "duel_resolved", `${character.name} was defeated in the duel.`, {
    blockIds: host ? [host.id] : [], formationIds: host?.formationId ? [host.formationId] : [],
  });
}

export function resolveDuels(state: GameState): void {
  const handled = new Set<string>();
  for (const block of Object.values(state.blocks)) {
    if (!block.isContested || !block.characterId) continue;
    const occupancy = occupancyAt(state, block.position);
    const otherId = block.factionId === "roman" ? occupancy.saxonBlockId : occupancy.romanBlockId;
    const otherBlock = otherId ? state.blocks[otherId] : undefined;
    if (!otherBlock?.characterId) continue;
    const key = [block.characterId, otherBlock.characterId].sort().join(":");
    if (handled.has(key)) continue;
    handled.add(key);
    const first = state.characters[block.characterId]!;
    const second = state.characters[otherBlock.characterId]!;
    if (first.status === "defeated" || second.status === "defeated") continue;
    const firstScore = first.prowess + modelCountModifier(block.models, block.modelCapacity) + (first.role === "champion" ? 1 : 0);
    const secondScore = second.prowess + modelCountModifier(otherBlock.models, otherBlock.modelCapacity) + (second.role === "champion" ? 1 : 0);
    const difference = Math.abs(firstScore - secondScore);
    if (difference === 0) {
      first.tiedDuelRounds += 1;
      second.tiedDuelRounds += 1;
      if (first.tiedDuelRounds % 2 === 0) { first.wounds += 1; second.wounds += 1; }
    } else {
      const loser = firstScore < secondScore ? first : second;
      loser.wounds += difference >= 3 ? 2 : 1;
    }
    emitEvent(state, "duel_resolved", `${first.name} (${firstScore}) duelled ${second.name} (${secondScore}).`, {
      blockIds: [block.id, otherBlock.id], position: { ...block.position },
    });
    const firstDefeated = first.wounds >= first.maxWounds;
    const secondDefeated = second.wounds >= second.maxWounds;
    if (firstDefeated) defeatCharacter(state, first, second);
    if (secondDefeated) defeatCharacter(state, second, first);
    if (firstDefeated !== secondDefeated) {
      const survivor = firstDefeated ? second : first;
      survivor.status = survivor.wounds > 0 ? "wounded" : "active";
    }
  }
}
