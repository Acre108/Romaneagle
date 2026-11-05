import { BALANCE } from "../model/config";
import type { Formation, GameState, TroopBlock } from "../model/types";
import { emitEvent } from "../events/events";

function adjacent(a: TroopBlock, b: TroopBlock): boolean {
  return !a.isContested && !b.isContested
    && Math.abs(a.position.x - b.position.x) + Math.abs(a.position.y - b.position.y) === 1;
}

export function connectedComponents(state: GameState, formationId: string): string[][] {
  const formation = state.formations[formationId];
  if (!formation) return [];
  const remaining = new Set(formation.blockIds.filter((id) => state.blocks[id]));
  const components: string[][] = [];
  while (remaining.size > 0) {
    const first = remaining.values().next().value as string;
    const queue = [first];
    const component: string[] = [];
    remaining.delete(first);
    while (queue.length > 0) {
      const id = queue.shift()!;
      const block = state.blocks[id]!;
      component.push(id);
      for (const candidateId of [...remaining]) {
        const candidate = state.blocks[candidateId]!;
        if (adjacent(block, candidate)) {
          remaining.delete(candidateId);
          queue.push(candidateId);
        }
      }
    }
    components.push(component);
  }
  return components;
}

function componentWithLeader(state: GameState, formation: Formation, components: string[][]): string[] | undefined {
  const leader = formation.leaderCharacterId ? state.characters[formation.leaderCharacterId] : undefined;
  return leader ? components.find((component) => component.includes(leader.hostBlockId)) : undefined;
}

function retainedComponent(state: GameState, formation: Formation, components: string[][]): string[] {
  const leaderComponent = componentWithLeader(state, formation, components);
  return [...components].sort((a, b) => b.length - a.length
    || Number(b === leaderComponent) - Number(a === leaderComponent)
    || a[0]!.localeCompare(b[0]!))[0]!;
}

export function originalFormationId(formationId: string): string {
  return formationId.split("-fragment-")[0]!;
}

export function provisionalFormationFamily(state: GameState, formationId: string): Formation[] {
  const formation = state.formations[formationId];
  if (!formation?.provisionalFamilyId) return formation ? [formation] : [];
  return Object.values(state.formations)
    .filter((candidate) => candidate.provisionalFamilyId === formation.provisionalFamilyId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function componentDistance(state: GameState, first: string[], second: string[]): number {
  let distance = Number.POSITIVE_INFINITY;
  for (const firstId of first) {
    const firstBlock = state.blocks[firstId];
    if (!firstBlock) continue;
    for (const secondId of second) {
      const secondBlock = state.blocks[secondId];
      if (!secondBlock) continue;
      distance = Math.min(distance,
        Math.abs(firstBlock.position.x - secondBlock.position.x)
          + Math.abs(firstBlock.position.y - secondBlock.position.y));
    }
  }
  return distance;
}

function componentKey(component: string[]): string {
  return [...component].sort((a, b) => a.localeCompare(b)).join("|");
}

function clusterComponents(state: GameState, components: string[][], maximumGroups: number): string[][] {
  const groups = components.map((component) => [...component].sort((a, b) => a.localeCompare(b)));
  while (groups.length > maximumGroups) {
    let bestFirst = 0;
    let bestSecond = 1;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestKey = "";
    for (let first = 0; first < groups.length; first += 1) {
      for (let second = first + 1; second < groups.length; second += 1) {
        const distance = componentDistance(state, groups[first]!, groups[second]!);
        const key = `${componentKey(groups[first]!)}::${componentKey(groups[second]!)}`;
        if (distance < bestDistance || (distance === bestDistance && (!bestKey || key < bestKey))) {
          bestFirst = first;
          bestSecond = second;
          bestDistance = distance;
          bestKey = key;
        }
      }
    }
    groups[bestFirst] = [...groups[bestFirst]!, ...groups[bestSecond]!].sort((a, b) => a.localeCompare(b));
    groups.splice(bestSecond, 1);
  }
  return groups;
}

function familyFormationCount(state: GameState, formationId: string): number {
  const originalId = originalFormationId(formationId);
  return Object.keys(state.formations).filter((id) => originalFormationId(id) === originalId).length;
}

function canAbsorbTemporarySeparation(formation: Formation, forceSplit: boolean): boolean {
  return !forceSplit
    && formation.blockIds.length >= BALANCE.largeFormationBlockThreshold
    && formation.status === "formed"
    && formation.cohesion > 3;
}

export function recalculateFormationConnectivity(state: GameState, formationId: string, forceSplit = false): string[] {
  const formation = state.formations[formationId];
  if (!formation) return [];
  formation.blockIds = formation.blockIds.filter((id) => state.blocks[id]);
  if (formation.blockIds.length === 0) {
    delete state.formations[formationId];
    return [];
  }
  const connected = connectedComponents(state, formationId);
  if (connected.length <= 1) {
    formation.status = formation.cohesion <= 0 ? "routed"
      : formation.cohesion <= 3 ? "disordered" : formation.status === "fragment" ? "fragment" : "formed";
    return [formationId];
  }
  const retainedConnected = retainedComponent(state, formation, connected);
  if (canAbsorbTemporarySeparation(formation, forceSplit)) {
    const newlyWavering = connected
      .filter((component) => component !== retainedConnected)
      .flat()
      .filter((id) => state.blocks[id]!.disorder < BALANCE.waveringDisorderThreshold);
    for (const id of newlyWavering) {
      state.blocks[id]!.disorder = BALANCE.waveringDisorderThreshold;
    }
    if (newlyWavering.length > 0) {
      emitEvent(state, "formation_wavered", `${formation.name} bent but held together; ${newlyWavering.length} block${newlyWavering.length === 1 ? " is" : "s are"} wavering.`, {
        blockIds: newlyWavering,
        formationIds: [formation.id],
      });
    }
    return [formation.id];
  }
  const availableGroups = Math.max(1,
    BALANCE.maximumFragmentGroups - familyFormationCount(state, formation.id) + 1);
  if (availableGroups === 1) {
    for (const component of connected) {
      if (component === retainedConnected) continue;
      for (const id of component) {
        state.blocks[id]!.disorder = Math.max(state.blocks[id]!.disorder, BALANCE.waveringDisorderThreshold);
      }
    }
    return [formation.id];
  }
  const components = clusterComponents(state, connected, availableGroups);
  const retained = retainedComponent(state, formation, components);
  const originalAmmunition = formation.ammunition;
  const ammunitionByComponent = new Map<string[], number>();
  if (originalAmmunition !== undefined) {
    const originalBlockCount = formation.blockIds.length;
    let allocated = 0;
    components.forEach((component, index) => {
      const ammunition = index === components.length - 1
        ? originalAmmunition - allocated
        : Math.floor(originalAmmunition * component.length / originalBlockCount);
      ammunitionByComponent.set(component, ammunition);
      allocated += ammunition;
    });
  }
  const provisionalFamilyId = formation.provisionalFamilyId ?? formation.id;
  const originalName = formation.name.replace(/ – (Main Body|Fragment [A-Z]+)$/, "");
  const originalLeaderCharacterId = formation.leaderCharacterId;
  const retainedHasLeader = originalLeaderCharacterId
    ? retained.includes(state.characters[originalLeaderCharacterId]?.hostBlockId ?? "")
    : false;
  formation.blockIds = retained;
  formation.name = `${originalName} – Main Body`;
  formation.provisionalFamilyId = provisionalFamilyId;
  formation.failedRegroupActivations ??= 0;
  formation.leaderCharacterId = retainedHasLeader ? originalLeaderCharacterId : null;
  if (originalAmmunition !== undefined) formation.ammunition = ammunitionByComponent.get(retained) ?? 0;
  const resultingIds = [formation.id];
  let labelCode = 65;
  for (const component of components) {
    if (component === retained) continue;
    const fragmentId = `${formation.id}-fragment-${state.nextFragmentId++}`;
    const fragment: Formation = {
      ...formation,
      id: fragmentId,
      name: `${originalName} – Fragment ${String.fromCharCode(labelCode++)}`,
      blockIds: component,
      cohesion: Math.max(0, formation.cohesion - BALANCE.fragmentCohesionLoss),
      leaderCharacterId: originalLeaderCharacterId && component.includes(state.characters[originalLeaderCharacterId]?.hostBlockId ?? "")
        ? originalLeaderCharacterId
        : null,
      status: formation.status === "routed" ? "routed" : "fragment",
      provisionalFamilyId,
      ammunition: originalAmmunition === undefined ? undefined : ammunitionByComponent.get(component) ?? 0,
    };
    state.formations[fragmentId] = fragment;
    for (const id of component) state.blocks[id]!.formationId = fragmentId;
    resultingIds.push(fragmentId);
  }
  emitEvent(state, "formation_split", `${originalName} split into ${components.length} groups.`, {
    blockIds: components.flat(), formationIds: resultingIds,
  });
  return resultingIds;
}

export function recalculateAllConnectivity(state: GameState): void {
  for (const formationId of Object.keys(state.formations)) {
    if (state.formations[formationId]) recalculateFormationConnectivity(state, formationId);
  }
}

export function areFormationsConnected(state: GameState, firstId: string, secondId: string): boolean {
  const first = state.formations[firstId];
  const second = state.formations[secondId];
  if (!first || !second) return false;
  return first.blockIds.some((firstBlockId) => second.blockIds.some((secondBlockId) => {
    const a = state.blocks[firstBlockId];
    const b = state.blocks[secondBlockId];
    if (!a || !b || a.isContested || b.isContested) return false;
    return Math.abs(a.position.x - b.position.x) + Math.abs(a.position.y - b.position.y) === 1;
  }));
}

export function componentIndexForBlock(state: GameState, formationId: string, blockId: string): number {
  return connectedComponents(state, formationId).findIndex((component) => component.includes(blockId));
}
