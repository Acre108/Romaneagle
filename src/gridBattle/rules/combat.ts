import { BALANCE } from "../model/config";
import { forcedRelocationHazard, terrainAt, terrainBlocksForcedRelocation, terrainMeleeDamageReceivedBonus, terrainResistanceModifier, type ForcedRelocationHazard } from "../model/terrain";
import { terrainDefinition } from "../model/terrainDefinitions";
import { blocksAt, friendlyBlockAt, inBounds, occupancyAt, positionKey } from "../model/occupancy";
import type { Character, CombatCalculationTerm, Direction, GameState, GridPosition, PressurePreview, PressureResult, RetreatMode, TroopBlock } from "../model/types";
import { emitEvent } from "../events/events";
import { addPosition, directionBetween, directionVector, facingContactModifier, formationEdgeType, oppositeDirection, orthogonalNeighbours, rotateDirection } from "./direction";
import { recalculateFormationConnectivity } from "./splitting";
import { blockFacing } from "./blockFacing";
import { clearBlockFormationBrace, clearFormationBrace } from "./brace";
import { blockIsBreaking, blockIsWavering } from "./wavering";
import { blockHitPoints, blockModelsAfterDamage, hasEquipment } from "../model/unitStats";
import { shockPushedFormation, applyCasualtyThresholds, applyLeaderLossShock } from "./morale";

export function waveringPenalty(state: GameState, blockId: string): number {
  return blockIsWavering(state, blockId) ? BALANCE.waveringPenalty : 0;
}

function formationStayingPower(state: GameState, formationId: string | null): number {
  const blockCount = formationId ? state.formations[formationId]?.blockIds.length ?? 0 : 0;
  return Math.min(BALANCE.maximumFormationStayingPower, Math.floor(Math.max(0, blockCount - 1) / 6));
}

export function hostCharacter(state: GameState, block: TroopBlock): Character | undefined {
  const character = block.characterId ? state.characters[block.characterId] : undefined;
  return character?.status === "defeated" ? undefined : character;
}

export function rearSupport(state: GameState, blockId: string): number {
  const block = state.blocks[blockId];
  const formation = block?.formationId ? state.formations[block.formationId] : undefined;
  if (!block || !formation || block.isContested) return 0;
  const behind = directionVector(oppositeDirection(blockFacing(state, block.id)));
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
  return [
    { label: `${formation.unit.unitType.replaceAll("_", " ")} pressure`, value: BALANCE.unitTypePressure[formation.unit.unitType] },
    { label: `${formation.formationMode} formation`, value: BALANCE.formationPressure[formation.formationMode] },
    { label: "Rear support", value: rearSupport(state, block.id) },
    { label: character ? character.name : "Character", value: character?.pressureBonus ?? 0 },
    { label: "Order / charge", value: chargeBonus },
    { label: "Breaking", value: blockIsBreaking(state, block.id) ? -BALANCE.waveringPenalty : 0 },
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
  const facing = blockFacing(state, block.id);
  const spearBonus = cavalryCharge && formation.isBraced && hasEquipment(formation, "brace_against_charge")
    && incomingDirection === facing && !blockIsWavering(state, block.id)
    ? BALANCE.spearChargeResistance
    : 0;
  const retreatHazard = forcedRetreatHazard(state, block, incomingDirection);
  return [
    { label: `${formation.unit.unitType.replaceAll("_", " ")} resistance`, value: BALANCE.unitTypeResistance[formation.unit.unitType] },
    { label: `${formation.formationMode} formation`, value: BALANCE.formationResistance[formation.formationMode] },
    { label: "Rear support", value: rearSupport(state, block.id) },
    { label: character ? character.name : "Character", value: character?.resistanceBonus ?? 0 },
    { label: terrainDefinition(terrain).label, value: terrainResistanceModifier(terrain) },
    { label: retreatHazard === "cliff" ? "Cliff behind" : "Deep water behind", value: retreatHazard ? BALANCE.lethalRetreatResistance : 0 },
    { label: `${formationEdgeType(facing, incomingDirection)} contact`, value: facingContactModifier(facing, incomingDirection) },
    { label: "Braced spears", value: spearBonus },
    { label: "Wavering", value: -waveringPenalty(state, block.id) },
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
    || (formation?.cohesion ?? 0) <= BALANCE.breakingMoraleThreshold
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
    ? formationEdgeType(blockFacing(state, defender.id), incomingDirection)
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
  pushThreshold?: number;
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
    ?? (attacker.isContested && defender.isContested ? blockFacing(state, defender.id) : null);
  if (!contactDirection || (!options.allowAnyContact
    && directionBetween(attacker.position, defender.position) !== blockFacing(state, attacker.id))) return null;
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
  const pushThreshold = options.pushThreshold ?? BALANCE.pushPressureThreshold;
  const retreatHazard = net >= pushThreshold ? retreatPlanHazard(state, retreat) : null;
  const result: PressureResult = net <= 0 ? "holds"
    : net < pushThreshold ? "wavers"
      : retreatMode === "chaotic" ? "scattered" : "pushed";
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
  const expectedResult = result === "holds" ? `${casualtyDescription}; defender holds`
    : result === "wavers" ? `${casualtyDescription}; defender wavers`
      : retreatHazard === "river_deep" ? `${casualtyDescription}; forced into deep water and drowns`
        : retreatHazard === "cliff" ? `${casualtyDescription}; forced over a cliff and destroyed`
      : net <= 5 ? `${casualtyDescription}; ${retreatDescription}`
        : `${casualtyDescription}; ${retreatDescription}; possible advance`;
  return {
    result,
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
  const direction = retreatDirection ?? oppositeDirection(blockFacing(state, defender.id));
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
      block.wavering = true;
      block.hasRetreatedThisRound = true;
    }
    for (const formationId of affectedFormationIds) shockPushedFormation(state, formationId);
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
  for (const block of retreat.chain) block.wavering = true;
  if (defender.formationId) shockPushedFormation(state, defender.formationId);
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
    blockIds: [attacker.id, defender.id], position: defenderPosition, pressureResult: preview.result,
  });
  const destroyedByMelee = preview.expectedDamage > 0
    ? damageBlock(state, defenderId, preview.expectedDamage, "melee")
    : false;
  if (destroyedByMelee) return { ok: true, vacated: true, compressed: false };
  const survivingDefender = state.blocks[defenderId];
  if (preview.result === "holds") return { ok: true, vacated: false, compressed: false };
  if (preview.result === "wavers") {
    if (survivingDefender) survivingDefender.wavering = true;
    return { ok: true, vacated: false, compressed: false };
  }
  const retreatDirection = directionBetween(attacker.position, defender.position);
  if (!retreatDirection) return { ok: false, vacated: false, compressed: false };
  const retreat = retreatBlock(state, defenderId, retreatDirection, preview.retreatMode);
  const vacated = retreat === "retreated" || retreat === "cascade" || retreat === "chaotic" || retreat === "destroyed";
  if (retreat === "compressed" && state.blocks[attackerId] && state.blocks[defenderId]) {
    createContestedCell(state, attackerId, defenderId);
  }
  return { ok: true, vacated, compressed: retreat === "compressed" };
}
