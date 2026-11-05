import { ROMAN_FORMATION_BY_ID, type RomanFormationDefinition } from "../../scenario/Roster";
import { getUnitArchetype, type UnitArchetypeProfile } from "../../units/UnitArchetypes";
import { createFormation, deployFormation, rectangularPositions } from "../model/battleStateFactory";
import { BALANCE, GRID_COLUMNS, GRID_ROWS } from "../model/config";
import { buildingCellAt, terrainAt, terrainElevationAt, terrainObjectsAt } from "../model/terrain";
import type { Character, Formation, FormationMode, GameState, GridPosition } from "../model/types";
import { modelCapacity } from "../model/unitStats";
import { archetypeCohesion, archetypeUnitProfile, startingAmmunition } from "./archetypeUnits";

interface DeploymentLayout {
  infantry: readonly (readonly GridPosition[])[];
  cavalry: readonly (readonly GridPosition[])[];
  archers: readonly (readonly GridPosition[])[];
  wallArchers?: readonly GridPosition[];
}

function line(x: number, y: number, length: number): GridPosition[] {
  return Array.from({ length }, (_, index) => ({ x: x + index, y }));
}

const DEPLOYMENT_LAYOUTS: Readonly<Record<string, DeploymentLayout>> = {
  "roman-1-hadrians-wall": {
    infantry: [rectangularPositions(5, 7, 3, 3), rectangularPositions(12, 7, 3, 3)],
    cavalry: [line(13, 10, 7)],
    archers: [],
    wallArchers: line(2, 11, 5),
  },
  "roman-2-blackwater-ford": {
    infantry: [rectangularPositions(1, 9, 3, 3), rectangularPositions(5, 9, 3, 3)],
    cavalry: [line(13, 12, 7)],
    archers: [line(0, 13, 11)],
  },
  "roman-3-raven-at-vindolanda": {
    infantry: [
      rectangularPositions(0, 9, 3, 3),
      rectangularPositions(4, 9, 3, 3),
      rectangularPositions(8, 9, 3, 3),
      rectangularPositions(12, 9, 3, 3),
    ],
    cavalry: [line(13, 12, 7)],
    archers: [line(0, 13, 11)],
  },
};

function removeRomanDeployments(state: GameState): void {
  for (const formation of Object.values(state.formations)) {
    if (formation.factionId !== "roman") continue;
    for (const blockId of formation.blockIds) delete state.blocks[blockId];
    delete state.formations[formation.id];
  }
  for (const character of Object.values(state.characters)) {
    if (character.factionId === "roman") delete state.characters[character.id];
  }
}

type DeployableFormation = Pick<RomanFormationDefinition, "id" | "name" | "count" | "archetypeId"> & {
  companion: Pick<RomanFormationDefinition["companion"], "id" | "name">;
};

function addCharacter(state: GameState, definition: DeployableFormation, formation: Formation): void {
  const hostBlockId = formation.blockIds[Math.floor(formation.blockIds.length / 2)]!;
  const character: Character = {
    id: definition.companion.id,
    factionId: "roman",
    name: definition.companion.name,
    role: "commander",
    hostBlockId,
    pressureBonus: 1,
    resistanceBonus: 1,
    meleeBonus: 0,
    commandRadius: 2,
    prowess: 3,
    wounds: 0,
    maxWounds: 3,
    status: "active",
    tiedDuelRounds: 0,
    temporaryMeleeBonus: 0,
  };
  state.characters[character.id] = character;
  state.blocks[hostBlockId]!.characterId = character.id;
  formation.leaderCharacterId = character.id;
}

function campaignFormationMode(archetype: UnitArchetypeProfile): FormationMode {
  return archetype.type === "archers" ? "open" : "closed";
}

function addFormation(
  state: GameState,
  definition: DeployableFormation,
  positions: readonly GridPosition[],
): void {
  const archetype = getUnitArchetype(definition.archetypeId);
  const formationMode = campaignFormationMode(archetype);
  const unit = archetypeUnitProfile(archetype, formationMode);
  const formation: Formation = {
    ...createFormation({
      id: definition.id,
      factionId: "roman",
      name: definition.name,
      facing: "north",
      formationMode,
      unit,
      cohesion: archetypeCohesion(archetype),
    }),
    ...startingAmmunition(unit),
  };
  const requiredBlocks = Math.ceil(definition.count / modelCapacity(formation));
  if (positions.length !== requiredBlocks) {
    throw new Error(`${definition.name} needs ${requiredBlocks} deployment blocks, received ${positions.length}.`);
  }
  deployFormation(state, formation, positions, definition.count);
  addCharacter(state, definition, formation);
}

function placementKind(archetype: UnitArchetypeProfile): keyof Pick<DeploymentLayout, "infantry" | "cavalry" | "archers"> {
  if (archetype.type === "cavalry") return "cavalry";
  if (archetype.type === "archers") return "archers";
  return "infantry";
}

function addWallArchers(state: GameState, positions: readonly GridPosition[]): void {
  const sagittarii = ROMAN_FORMATION_BY_ID.get("R-ARCH");
  if (!sagittarii) throw new Error("The wall archer definition is missing.");
  addFormation(state, {
    ...sagittarii,
    id: "wall-archers",
    name: "Allied Wall Archers",
    count: 25,
    companion: { ...sagittarii.companion, id: "wall-archer-captain", name: "Wall Archer Captain" },
  }, positions);
}

/** Replaces the prototype Roman force with the formations selected at the campaign war council. */
export function applyCampaignRomanDeployment(
  state: GameState,
  missionId: string,
  selectedFormationIds: readonly string[],
): void {
  const layout = DEPLOYMENT_LAYOUTS[missionId];
  if (!layout) throw new Error(`No Roman deployment layout exists for mission ${missionId}.`);
  const uniqueIds = [...new Set(selectedFormationIds)];
  if (uniqueIds.length !== selectedFormationIds.length) throw new Error("A campaign formation cannot deploy twice.");

  const definitions = uniqueIds.map((id) => {
    const definition = ROMAN_FORMATION_BY_ID.get(id);
    if (!definition) throw new Error(`Unknown Roman campaign formation ${id}.`);
    return definition;
  });

  removeRomanDeployments(state);
  const used = { infantry: 0, cavalry: 0, archers: 0 };
  for (const definition of definitions) {
    const kind = placementKind(getUnitArchetype(definition.archetypeId));
    const positions = layout[kind][used[kind]++];
    if (!positions) throw new Error(`Mission ${missionId} has no remaining ${kind} deployment slot.`);
    addFormation(state, definition, positions);
  }
  if (layout.wallArchers) addWallArchers(state, layout.wallArchers);
}

const TEST_DEPLOYMENT_WIDTHS = [5, 4, 3, 7, 10] as const;

function isOpenDeploymentCell(state: GameState, position: GridPosition): boolean {
  const terrain = terrainAt(state, position);
  return (terrain === "clear" || terrain === "road")
    && !buildingCellAt(state, position)
    && terrainElevationAt(state, position) === 0
    && terrainObjectsAt(state, position).length === 0;
}

function testDeploymentFootprint(state: GameState, blockCount: number, gap: boolean): GridPosition[] | null {
  const blocks = Object.values(state.blocks);
  const free = (position: GridPosition): boolean => isOpenDeploymentCell(state, position)
    && blocks.every((block) => {
      const distance = Math.abs(block.position.x - position.x) + Math.abs(block.position.y - position.y);
      return distance > 1 || (distance === 1 && !gap && block.factionId === "roman");
    });
  for (const width of TEST_DEPLOYMENT_WIDTHS) {
    const depth = Math.ceil(blockCount / width);
    for (let y = GRID_ROWS - depth; y >= 0; y -= 1) {
      for (let x = 0; x + width <= GRID_COLUMNS; x += 1) {
        const positions = rectangularPositions(x, y, width, depth).slice(0, blockCount);
        if (positions.every(free)) return positions;
      }
    }
  }
  return null;
}

/** Deploys sandbox formations from the southern edge upward, on open ground and clear of the enemy. */
export function applyTestRomanDeployment(
  state: GameState,
  units: readonly { id: string; name: string; strength: number; archetypeId: RomanFormationDefinition["archetypeId"] }[],
): void {
  removeRomanDeployments(state);
  for (const unit of units) {
    const archetype = getUnitArchetype(unit.archetypeId);
    const mode = campaignFormationMode(archetype);
    const capacity = Math.max(1, Math.floor(BALANCE.formationModelSpace[mode] / archetypeUnitProfile(archetype, mode).modelSize));
    const blockCount = Math.ceil(unit.strength / capacity);
    const positions = testDeploymentFootprint(state, blockCount, true) ?? testDeploymentFootprint(state, blockCount, false);
    if (!positions) throw new Error(`The test battlefield has no room for ${unit.name}.`);
    addFormation(state, {
      id: unit.id,
      name: unit.name,
      count: unit.strength,
      archetypeId: unit.archetypeId,
      companion: { id: `${unit.id}-captain`, name: `${unit.name} Captain` },
    }, positions);
  }
}
