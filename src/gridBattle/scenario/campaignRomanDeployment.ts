import { ROMAN_FORMATION_BY_ID, type RomanFormationDefinition } from "../../scenario/Roster";
import { getUnitArchetype, type UnitArchetypeProfile } from "../../units/UnitArchetypes";
import { createFormation, deployFormation, rectangularPositions } from "../model/battleStateFactory";
import { BALANCE } from "../model/config";
import type { Character, Formation, FormationMode, GameState, GridPosition } from "../model/types";
import { modelCapacity } from "../model/unitStats";
import { archetypeCohesion, archetypeUnitProfile } from "./archetypeUnits";

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
  const formation = createFormation({
    id: definition.id,
    factionId: "roman",
    name: definition.name,
    facing: "north",
    formationMode,
    unit,
    cohesion: archetypeCohesion(archetype),
  });
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

const TEST_FORMATION_WIDTH = 4;
const TEST_LINE_GAP = 1;
const TEST_FORMATIONS_PER_LINE = 4;
const TEST_SUPPORT_WIDTH = 16;
const TEST_WING_INSET = 1;

interface TestUnit {
  id: string;
  name: string;
  strength: number;
  archetypeId: RomanFormationDefinition["archetypeId"];
}

function testBlockCount(unit: TestUnit): number {
  const archetype = getUnitArchetype(unit.archetypeId);
  const mode = campaignFormationMode(archetype);
  const capacity = Math.max(1, Math.floor(BALANCE.formationModelSpace[mode] / archetypeUnitProfile(archetype, mode).modelSize));
  return Math.ceil(unit.strength / capacity);
}

/** Lays formations side by side in one row, centred on the field, and returns the row below them. */
function placeTestRow(
  state: GameState,
  units: readonly TestUnit[],
  width: number,
  top: number,
  place: (unit: TestUnit, positions: readonly GridPosition[]) => void,
): number {
  const sized = units.map((unit) => {
    const blocks = testBlockCount(unit);
    const columns = Math.min(width, blocks);
    return { unit, blocks, columns, depth: Math.ceil(blocks / columns) };
  });
  const total = sized.reduce((sum, entry) => sum + entry.columns, 0) + TEST_LINE_GAP * (sized.length - 1);
  let x = Math.floor((state.battlefield.width - total) / 2);
  for (const { unit, blocks, columns, depth } of sized) {
    place(unit, rectangularPositions(x, top, columns, depth).slice(0, blocks));
    x += columns + TEST_LINE_GAP;
  }
  return top + Math.max(0, ...sized.map((entry) => entry.depth)) + TEST_LINE_GAP;
}

/** Deploys sandbox formations as a battle line: infantry in front, missiles behind it, cavalry on the wings. */
export function applyTestRomanDeployment(state: GameState, units: readonly TestUnit[], frontRow: number): void {
  removeRomanDeployments(state);
  const place = (unit: TestUnit, positions: readonly GridPosition[]): void => addFormation(state, {
    id: unit.id,
    name: unit.name,
    count: unit.strength,
    archetypeId: unit.archetypeId,
    companion: { id: `${unit.id}-captain`, name: `${unit.name} Captain` },
  }, positions);
  const wings = units.filter((unit) => getUnitArchetype(unit.archetypeId).type === "cavalry");
  const support = units.filter((unit) => {
    const { type } = getUnitArchetype(unit.archetypeId);
    return type === "archers" || type === "artillery";
  });
  const line = units.filter((unit) => !wings.includes(unit) && !support.includes(unit));

  let row = frontRow;
  for (let index = 0; index < line.length; index += TEST_FORMATIONS_PER_LINE) {
    row = placeTestRow(state, line.slice(index, index + TEST_FORMATIONS_PER_LINE), TEST_FORMATION_WIDTH, row, place);
  }
  placeTestRow(state, support, TEST_SUPPORT_WIDTH, row, place);

  const wingTops = [frontRow, frontRow];
  wings.forEach((unit, index) => {
    const side = index % 2;
    const blocks = testBlockCount(unit);
    const depth = Math.ceil(blocks / TEST_FORMATION_WIDTH);
    const x = side === 0 ? TEST_WING_INSET : state.battlefield.width - TEST_WING_INSET - TEST_FORMATION_WIDTH;
    place(unit, rectangularPositions(x, wingTops[side]!, TEST_FORMATION_WIDTH, depth).slice(0, blocks));
    wingTops[side]! += depth + TEST_LINE_GAP;
  });
}
