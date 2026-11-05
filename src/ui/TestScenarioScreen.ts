import { TEST_SCENARIO_MISSION } from "../campaign/missions/TestScenarioMission";
import {
  DEFAULT_TEST_UNIT_IDS,
  TEST_SAXON_SPECS,
  TEST_UNIT_OPTIONS,
  type TestUnitOption,
} from "../scenario/TestScenario";
import { getUnitArchetype } from "../units/UnitArchetypes";
import { formatProfileClassification, formatProfileEquipment, formatProfileHandling, formatProfileSpeciality } from "../units/UnitPresentation";
import { requiredElement } from "./dom";

const selectedTestUnitIds = new Set(DEFAULT_TEST_UNIT_IDS);

export function selectedTestDeployment(): string[] {
  return TEST_UNIT_OPTIONS.filter((option) => selectedTestUnitIds.has(option.id)).map((option) => option.id);
}

function createTestUnitCard(option: TestUnitOption): HTMLElement {
  const profile = getUnitArchetype(option.archetypeId);
  const selected = selectedTestUnitIds.has(option.id);
  const card = document.createElement("article");
  card.className = `test-unit-card${selected ? " selected" : ""}`;
  card.tabIndex = 0;
  card.setAttribute("role", "checkbox");
  card.setAttribute("aria-checked", String(selected));
  card.dataset.testUnitId = option.id;
  const name = document.createElement("h3");
  name.textContent = option.name;
  const role = document.createElement("p");
  role.className = "test-unit-role";
  role.textContent = formatProfileClassification(profile);
  const meta = document.createElement("div");
  meta.className = "test-unit-meta";
  const strength = document.createElement("span");
  strength.textContent = `${option.strength} strength`;
  const handling = document.createElement("span");
  handling.textContent = formatProfileHandling(profile);
  meta.append(strength, handling);
  const equipment = document.createElement("p");
  equipment.className = "test-unit-equipment";
  equipment.textContent = formatProfileEquipment(profile);
  const speciality = document.createElement("p");
  speciality.className = "test-unit-speciality";
  speciality.textContent = formatProfileSpeciality(profile);
  const check = document.createElement("span");
  check.className = "test-unit-check";
  check.setAttribute("aria-hidden", "true");
  check.textContent = "✓";
  card.append(name, role, meta, equipment, speciality, check);
  return card;
}

function updateTestDeployment(): void {
  const selected = TEST_UNIT_OPTIONS.filter((option) => selectedTestUnitIds.has(option.id));
  const deployment = TEST_SCENARIO_MISSION.deployment;
  requiredElement("test-unit-count").textContent = String(selected.length);
  requiredElement("test-deployed-strength").textContent = String(
    selected.reduce((total, option) => total + option.strength, 0),
  );
  requiredElement<HTMLButtonElement>("begin-test-scenario").disabled =
    selected.length < deployment.minimum || selected.length > deployment.maximum;
  requiredElement("test-deployment-warning").textContent = selected.length < deployment.minimum
    ? `Select at least ${deployment.minimum} formation.`
    : selected.length > deployment.maximum
      ? `Only ${deployment.maximum} formations may deploy.`
      : deployment.note;
}

export function renderTestScenario(): void {
  requiredElement("test-unit-grid").replaceChildren(
    ...TEST_UNIT_OPTIONS.map(createTestUnitCard),
  );
  const opposition = TEST_SAXON_SPECS
    .map((spec) => {
      const row = document.createElement("div");
      const name = document.createElement("span");
      name.textContent = spec.name;
      const role = document.createElement("small");
      role.textContent = spec.role;
      row.append(name, role);
      return row;
    });
  requiredElement("test-opposition-list").replaceChildren(...opposition);
  updateTestDeployment();
}

export function toggleTestUnit(card: HTMLElement): void {
  const id = card.dataset.testUnitId;
  if (!id) return;
  const deployment = TEST_SCENARIO_MISSION.deployment;
  if (!selectedTestUnitIds.has(id) && selectedTestUnitIds.size >= deployment.maximum) {
    requiredElement("test-deployment-warning").textContent =
      `Only ${deployment.maximum} formations may deploy.`;
    return;
  }
  if (selectedTestUnitIds.has(id)) selectedTestUnitIds.delete(id);
  else selectedTestUnitIds.add(id);
  card.classList.toggle("selected", selectedTestUnitIds.has(id));
  card.setAttribute("aria-checked", String(selectedTestUnitIds.has(id)));
  updateTestDeployment();
}
