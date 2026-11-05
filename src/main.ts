import "./style.css";
import { requiredElement } from "./ui/dom";
import { renderTestScenario, selectedTestDeployment, toggleTestUnit } from "./ui/TestScenarioScreen";
import { CustomMapGame, Game } from "./core/Game";
import type { BattleFormationResult, BattleReport } from "./campaign/BattleReport";
import {
  deployedStrength,
  formationCasualties,
  formationExperience,
  formationHealthLabel,
  formationHealthPercent,
} from "./campaign/CampaignRules";
import {
  CAMPAIGNS,
  CAMPAIGN_BY_ID,
  MISSION_BY_ID,
  campaignCompletion,
  currentMissionForCampaign,
  isMissionUnlocked,
} from "./campaign/CampaignCatalog";
import type { CampaignDefinition, MissionDefinition } from "./campaign/CampaignTypes";
import {
  completeMission,
  loadCampaignProgress,
  resilientProgressStorage,
  saveCampaignProgress,
} from "./campaign/CampaignProgress";
import {
  COMPANION_BY_ID,
  ROMAN_FORMATION_BY_ID,
  ROMAN_FORMATIONS,
  type CompanionDefinition,
  type RomanFormationDefinition,
} from "./scenario/Roster";
import { applyCompanionPortrait } from "./ui/Portraits";
import { getUnitArchetype } from "./units/UnitArchetypes";
import { TEST_SCENARIO_MISSION } from "./campaign/missions/TestScenarioMission";
import {
  formatProfileHandling,
  formatProfileRanged,
} from "./units/UnitPresentation";
import { MapEditor } from "./mapEditor/MapEditor";
import {
  listProjectMaps,
  loadProjectMap,
  savedMapsStatus,
  type ProjectMapSummary,
} from "./mapEditor/MapStorage";

const campaignEvents = new AbortController();
const listenerOptions = { signal: campaignEvents.signal };
const progressStorage = resilientProgressStorage(() => window.localStorage);
let campaignProgress = loadCampaignProgress(progressStorage);

const companionFormation = new Map(
  ROMAN_FORMATIONS.map((formation) => [formation.companion.id, formation]),
);

let activeCampaign: CampaignDefinition | undefined;
let activeMission: MissionDefinition | undefined;
let activeFormations: RomanFormationDefinition[] = [];
let activeCompanion = "";
let game: Game | CustomMapGame | undefined;
let deployedUnitIds: string[] = [];
let lastBattleReport: BattleReport | undefined;
let cutsceneStep = 0;
let cutsceneSpeakers: string[] = [];
let launchTimer: number | undefined;
/** Which screen a finished battle returns to. */
let battleMode: "campaign" | "sandbox" | "custom" = "campaign";
let mapEditor: MapEditor | undefined;

function missionFormationDefinitions(mission: MissionDefinition): RomanFormationDefinition[] {
  return mission.deployment.formationIds.map((id) => {
    const formation = ROMAN_FORMATION_BY_ID.get(id);
    if (!formation) throw new Error(`Mission ${mission.id} references missing formation ${id}`);
    return formation;
  });
}

function createCampaignCard(campaign: CampaignDefinition): HTMLElement {
  const completion = campaignCompletion(campaign, campaignProgress.completedMissions);
  const available = campaign.available && campaign.missions.length > 0;
  const currentMission = currentMissionForCampaign(campaign, campaignProgress);
  const card = document.createElement("article");
  card.className = `campaign-card ${available ? "available" : "locked"}`;

  const number = document.createElement("span");
  number.className = "campaign-number";
  number.textContent = campaign.numeral;
  const kicker = document.createElement("p");
  kicker.className = "campaign-kicker";
  kicker.textContent = campaign.kicker;
  const title = document.createElement("h2");
  title.textContent = campaign.title;
  const description = document.createElement("p");
  description.textContent = campaign.description;
  card.append(number, kicker, title, description);

  if (!available || !currentMission) {
    const locked = document.createElement("span");
    locked.className = "campaign-lock";
    locked.textContent = "COMING SOON";
    card.append(locked);
    return card;
  }

  const progress = document.createElement("div");
  progress.className = "campaign-progress";
  const track = document.createElement("i");
  const fill = document.createElement("em");
  fill.style.width = `${completion.percent}%`;
  track.append(fill);
  const status = document.createElement("span");
  status.textContent = completion.completed === completion.total
    ? `Campaign current · ${completion.completed} of ${completion.total}`
    : `Mission ${currentMission.sequence} ready · ${completion.completed} of ${completion.total}`;
  progress.append(track, status);

  const button = document.createElement("button");
  button.className = "select-campaign";
  button.dataset.campaign = campaign.id;
  const buttonTitle = document.createElement("span");
  buttonTitle.textContent = completion.completed > 0 ? "CONTINUE CAMPAIGN" : "ENTER CAMPAIGN";
  const buttonDetail = document.createElement("small");
  buttonDetail.textContent = `${currentMission.title} · ${currentMission.dateLabel}`;
  button.append(buttonTitle, buttonDetail);
  card.append(progress, button);
  return card;
}

function renderCampaignSelection(): void {
  requiredElement("campaign-grid").replaceChildren(...CAMPAIGNS.map(createCampaignCard));
}

function openTestScenario(): void {
  battleMode = "sandbox";
  activeCampaign = undefined;
  activeMission = TEST_SCENARIO_MISSION;
  activeFormations = [];
  renderTestScenario();
  setBattleCopy(TEST_SCENARIO_MISSION);
  requiredElement("campaign-select").hidden = true;
  requiredElement("campaign-screen").hidden = true;
  requiredElement("test-scenario-screen").hidden = false;
}

function createFormationCard(formation: RomanFormationDefinition): HTMLElement {
  if (!activeMission) throw new Error("Cannot render a formation without an active mission");
  const archetype = getUnitArchetype(formation.archetypeId);
  const selected = activeMission.deployment.defaultFormationIds.includes(formation.id);
  const card = document.createElement("article");
  card.className = `formation-card${selected ? " selected" : ""}${activeMission.deployment.fixed ? " fixed" : ""}`;
  card.tabIndex = activeMission.deployment.fixed ? -1 : 0;
  card.setAttribute("role", "checkbox");
  card.setAttribute("aria-checked", String(selected));
  if (activeMission.deployment.fixed) card.setAttribute("aria-disabled", "true");
  card.dataset.unitId = formation.id;
  card.dataset.companion = formation.companion.id;

  const portrait = document.createElement("div");
  portrait.className = `mini-portrait ${formation.companion.portraitTone}`;
  portrait.setAttribute("aria-hidden", "true");
  const initials = document.createElement("span");
  initials.textContent = formation.companion.initials;
  portrait.append(initials);
  applyCompanionPortrait(portrait, formation.companion);

  const copy = document.createElement("div");
  copy.className = "formation-copy";
  const heading = document.createElement("div");
  const name = document.createElement("h3");
  name.textContent = formation.name;
  const readiness = document.createElement("span");
  readiness.className = "readiness ready";
  readiness.textContent = "READY";
  heading.append(name, readiness);
  const role = document.createElement("p");
  role.textContent = `${formation.companion.name} · ${formation.campaignRole}`;
  const stats = document.createElement("div");
  stats.className = "formation-stats";
  const strength = document.createElement("span");
  strength.textContent = `${formation.count} ${archetype.type === "cavalry" ? "riders" : archetype.type === "archers" ? "archers" : "soldiers"}`;
  const handling = document.createElement("span");
  handling.textContent = formatProfileHandling(archetype);
  stats.append(strength, handling);
  copy.append(heading, role, stats);
  const ranged = formatProfileRanged(archetype);
  if (ranged) {
    const weapon = document.createElement("p");
    weapon.className = "formation-equipment";
    weapon.textContent = ranged;
    copy.append(weapon);
  }

  const check = document.createElement("span");
  check.className = "formation-check";
  check.setAttribute("aria-hidden", "true");
  check.textContent = "✓";
  const talk = document.createElement("button");
  talk.className = "talk-button";
  talk.dataset.talk = formation.companion.id;
  talk.textContent = "Speak";
  card.append(portrait, copy, check, talk);
  return card;
}

function selectedFormationCards(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".formation-card.selected")];
}

function updateDeployment(): void {
  if (!activeMission) return;
  const selected = selectedFormationCards();
  const selectedIds = new Set(
    selected.map((card) => card.dataset.unitId).filter((id): id is string => id !== undefined),
  );
  const deployment = activeMission.deployment;
  requiredElement("formation-count").textContent = String(selected.length);
  requiredElement("formation-limit").textContent = String(deployment.maximum);
  requiredElement("deployed-strength").textContent = String(deployedStrength(activeFormations, selectedIds));
  requiredElement<HTMLButtonElement>("begin-battle").disabled =
    selected.length < deployment.minimum || selected.length > deployment.maximum;
  requiredElement("deployment-warning").textContent = selected.length < deployment.minimum
    ? `Select at least ${deployment.minimum} formations.`
    : selected.length > deployment.maximum
      ? `Only ${deployment.maximum} formations may deploy.`
      : deployment.note;
}

function toggleFormation(card: HTMLElement): void {
  if (!activeMission || activeMission.deployment.fixed) return;
  const selectedCount = selectedFormationCards().length;
  if (!card.classList.contains("selected") && selectedCount >= activeMission.deployment.maximum) {
    requiredElement("deployment-warning").textContent = `Only ${activeMission.deployment.maximum} formations may deploy.`;
    return;
  }
  if (card.classList.contains("selected") && selectedCount <= activeMission.deployment.minimum) {
    requiredElement("deployment-warning").textContent = `At least ${activeMission.deployment.minimum} formations must deploy.`;
    return;
  }
  card.classList.toggle("selected");
  card.setAttribute("aria-checked", String(card.classList.contains("selected")));
  updateDeployment();
}

function missionDialogue(companion: CompanionDefinition) {
  return activeMission?.dialogueByCompanionId[companion.id] ?? companion;
}

function showCompanion(id: string): void {
  const companion = COMPANION_BY_ID.get(id);
  if (!companion) return;
  const dialogue = missionDialogue(companion);
  activeCompanion = id;
  requiredElement("speaker-name").textContent = companion.name;
  requiredElement("speaker-role").textContent = companion.role;
  requiredElement("speaker-line").textContent = dialogue.briefingLine;
  const portrait = requiredElement("speaker-portrait");
  portrait.dataset.initials = companion.initials;
  portrait.querySelector("span")!.textContent = companion.initials;
  applyCompanionPortrait(portrait, companion);
  document.querySelectorAll<HTMLElement>(".formation-card").forEach((card) => {
    card.classList.toggle("speaking", card.dataset.companion === id);
  });
}

function renderMissionList(campaign: CampaignDefinition, mission: MissionDefinition): void {
  const completed = new Set(campaignProgress.completedMissions);
  const buttons = campaign.missions.map((candidate) => {
    const button = document.createElement("button");
    button.dataset.mission = candidate.id;
    button.disabled = !isMissionUnlocked(campaign, candidate, completed);
    button.classList.toggle("active", candidate.id === mission.id);
    button.classList.toggle("completed", completed.has(candidate.id));
    button.textContent = `${candidate.numeral} · ${candidate.title}`;
    return button;
  });
  requiredElement("mission-list").replaceChildren(...buttons);
}

function setBattleCopy(mission: MissionDefinition): void {
  requiredElement("battle-date").textContent = mission.dateLabel;
  requiredElement("battle-objective").textContent = mission.objective;
  requiredElement("battle-objective-detail").textContent = mission.objectiveDetail;
  requiredElement("debrief-title").textContent = mission.debrief.title;
  requiredElement("debrief-detail").textContent = mission.debrief.detail;
  requiredElement("debrief-footer-copy").textContent = mission.debrief.footer;
  requiredElement("cutscene-chapter-label").textContent = mission.cutscene.chapterLabel;
  requiredElement("cutscene-location-label").textContent = mission.cutscene.locationLabel;
}

function renderCampaignPhase(campaign: CampaignDefinition, mission: MissionDefinition): void {
  activeCampaign = campaign;
  activeMission = mission;
  activeFormations = missionFormationDefinitions(mission);
  activeCompanion = activeFormations[0]?.companion.id ?? "";
  campaignProgress = {
    ...campaignProgress,
    selectedCampaignId: campaign.id,
    selectedMissionIds: { ...campaignProgress.selectedMissionIds, [campaign.id]: mission.id },
  };
  saveCampaignProgress(progressStorage, campaignProgress);

  requiredElement("campaign-phase-title").textContent = campaign.title;
  requiredElement("campaign-phase-number").textContent = `${campaign.numeral} of ${CAMPAIGNS.length}`;
  requiredElement("mission-phase-number").textContent = String(mission.sequence);
  requiredElement("mission-roman").textContent = mission.numeral;
  requiredElement("mission-kicker").textContent = mission.chapterLabel;
  requiredElement("mission-title-lead").textContent = mission.titleLead;
  requiredElement("mission-title-emphasis").textContent = mission.titleEmphasis;
  requiredElement("mission-lede").textContent = mission.description;
  requiredElement("mission-objective").textContent = mission.objective;

  const facts = mission.facts.map((fact) => {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = fact.label;
    const detail = document.createElement("dd");
    detail.textContent = fact.value;
    row.append(term, detail);
    return row;
  });
  requiredElement("mission-facts").replaceChildren(...facts);
  requiredElement("scout-report-copy").textContent = mission.scoutReport;
  requiredElement("scout-report-attribution").textContent = mission.scoutAttribution;
  const rewardElements = mission.rewards.map((reward) => {
    const span = document.createElement("span");
    const value = document.createElement("b");
    value.textContent = reward.value;
    span.append(value, ` ${reward.label}`);
    return span;
  });
  requiredElement("mission-reward").replaceChildren(
    Object.assign(document.createElement("small"), { textContent: "REWARD" }),
    ...rewardElements,
  );

  const map = requiredElement("campaign-map");
  map.className = `campaign-map map-${mission.map.theme}`;
  map.setAttribute("aria-label", mission.map.ariaLabel);
  requiredElement("map-primary-label").textContent = mission.map.primaryLabel;
  requiredElement("map-crossing-label").textContent = mission.map.crossingLabel;
  requiredElement("map-home-label").textContent = mission.map.homeLabel;
  requiredElement("map-player-pin").textContent = mission.map.playerPinLabel;
  requiredElement("map-enemy-pin").textContent = mission.map.enemyPinLabel;
  requiredElement("map-distance").textContent = mission.map.distanceLabel;

  requiredElement("roster-help").textContent = mission.deployment.help;
  requiredElement<HTMLButtonElement>("begin-battle").querySelector("span")!.textContent =
    campaignProgress.completedMissions.includes(mission.id) ? "REPLAY MISSION" : "BEGIN MISSION";
  requiredElement<HTMLButtonElement>("begin-battle").querySelector("small")!.textContent = mission.launchLabel;
  requiredElement("campaign-date").textContent = mission.dateLabel;
  requiredElement("campaign-region").textContent = mission.regionLabel;
  renderMissionList(campaign, mission);
  requiredElement("formation-list").replaceChildren(...activeFormations.map(createFormationCard));
  setBattleCopy(mission);
  updateDeployment();
  if (activeCompanion) showCompanion(activeCompanion);
}

function resultRow(formation: BattleFormationResult): HTMLElement {
  const health = formationHealthPercent(formation);
  const row = document.createElement("article");
  row.className = "formation-result-row";
  const insignia = document.createElement("span");
  insignia.className = `result-insignia ${formation.type}`;
  insignia.setAttribute("aria-hidden", "true");
  insignia.textContent = formation.id.replace("R-", "");
  const formationCopy = document.createElement("div");
  formationCopy.className = "result-formation";
  const name = document.createElement("b");
  name.textContent = formation.name;
  const detail = document.createElement("small");
  detail.textContent = `${formation.type} · ${formationHealthLabel(formation)}`;
  formationCopy.append(name, detail);
  const healthDisplay = document.createElement("div");
  healthDisplay.className = "result-health";
  const count = document.createElement("span");
  const surviving = document.createElement("b");
  surviving.textContent = String(formation.soldierCount);
  count.append(surviving, ` / ${formation.maximumSoldiers}`);
  const bar = document.createElement("i");
  const fill = document.createElement("em");
  fill.style.width = `${health}%`;
  bar.append(fill);
  const casualties = document.createElement("small");
  const casualtyCount = formationCasualties(formation);
  casualties.className = "result-casualties";
  casualties.textContent = casualtyCount === 0 ? "No losses" : `${casualtyCount} lost`;
  healthDisplay.append(count, casualties, bar);
  const experience = document.createElement("strong");
  experience.className = "result-xp";
  experience.textContent = `+${formationExperience(formation)} XP`;
  row.append(insignia, formationCopy, healthDisplay, experience);
  return row;
}

function handleBattleEnded(report: BattleReport, persistProgress = true): void {
  if (!activeMission) return;
  if (battleMode === "sandbox") {
    lastBattleReport = report;
    const returnButton = requiredElement<HTMLButtonElement>("return-from-battle");
    returnButton.hidden = false;
    returnButton.querySelector("span")!.textContent = "RETURN TO TEST DEPLOYMENT";
    returnButton.querySelector("small")!.textContent = "Choose another Roman force";
    return;
  }
  const returnButton = requiredElement<HTMLButtonElement>("return-from-battle");
  returnButton.querySelector("span")!.textContent = "RETURN TO CAMPAIGN";
  returnButton.querySelector("small")!.textContent = "Back to the campaign phase";
  if (report.outcome !== "romanVictory") {
    returnButton.hidden = false;
    return;
  }
  if (persistProgress) {
    campaignProgress = completeMission(campaignProgress, activeMission.id);
    saveCampaignProgress(progressStorage, campaignProgress);
    renderCampaignSelection();
  }
  lastBattleReport = report;
  const battle = requiredElement("battle-screen");
  const results = requiredElement("formation-results");
  let companyExperience = 0;
  battle.classList.add("debrief-active");
  results.replaceChildren();
  for (const formation of report.formations) {
    companyExperience += formationExperience(formation);
    results.append(resultRow(formation));
  }
  requiredElement("company-experience").textContent = `+${companyExperience} XP`;
  requiredElement("victory-debrief").hidden = false;
}

function cutsceneParticipants(): string[] {
  const selected = deployedUnitIds
    .map((id) => ROMAN_FORMATION_BY_ID.get(id)?.companion.id)
    .filter((id): id is string => id !== undefined);
  const fallbacks = activeFormations.slice(0, 2).map((formation) => formation.companion.id);
  const participants = selected.length >= 2 ? selected : fallbacks;
  return [...participants, participants[0] ?? activeCompanion];
}

function formationResultFor(companionId: string): BattleFormationResult | undefined {
  const unitId = companionFormation.get(companionId)?.id;
  return lastBattleReport?.formations.find((formation) => formation.id === unitId);
}

function afterBattleCopy(companion: CompanionDefinition): string {
  const dialogue = missionDialogue(companion);
  const formation = formationResultFor(companion.id);
  if (!formation) return dialogue.afterBattleLine;
  const health = formationHealthPercent(formation);
  if (formation.state === "broken" || formation.state === "escaped" || health === 0) return dialogue.lostLine;
  if (formation.state === "routing" || formation.state === "shaken" || health < 55) return dialogue.bloodiedLine;
  return dialogue.afterBattleLine;
}

function renderCutsceneStep(): void {
  if (!activeMission) return;
  const speakerId = cutsceneSpeakers[cutsceneStep] ?? activeCompanion;
  const speaker = COMPANION_BY_ID.get(speakerId);
  if (!speaker) return;
  const portrait = requiredElement("cutscene-portrait");
  portrait.className = `cutscene-portrait portrait-${speaker.portraitTone} ${cutsceneStep % 2 === 0 ? "portrait-left" : "portrait-right"}`;
  portrait.dataset.initials = speaker.initials;
  applyCompanionPortrait(portrait, speaker);
  requiredElement("post-battle-cutscene").classList.toggle("speaker-right", cutsceneStep % 2 === 1);
  requiredElement("cutscene-speaker-name").textContent = speaker.name;
  requiredElement("cutscene-speaker-role").textContent = speaker.role;
  requiredElement("cutscene-line").textContent = cutsceneStep === cutsceneSpeakers.length - 1
    ? activeMission.cutscene.closingLine
    : afterBattleCopy(speaker);
  const progress = requiredElement("cutscene-progress");
  progress.replaceChildren();
  cutsceneSpeakers.forEach((_, index) => {
    const marker = document.createElement("i");
    marker.classList.toggle("active", index === cutsceneStep);
    progress.append(marker);
  });
  requiredElement<HTMLButtonElement>("next-cutscene-line").innerHTML =
    cutsceneStep === cutsceneSpeakers.length - 1
      ? "RETURN TO CAMPAIGN <span>→</span>"
      : "NEXT <span>→</span>";
}

function showPostBattleCutscene(): void {
  requiredElement("victory-debrief").hidden = true;
  requiredElement("post-battle-cutscene").hidden = false;
  cutsceneSpeakers = cutsceneParticipants();
  cutsceneStep = 0;
  renderCutsceneStep();
}

function returnToCampaignPhase(): void {
  game?.stop();
  game = undefined;
  const battle = requiredElement("battle-screen");
  battle.hidden = true;
  battle.classList.remove("debrief-active");
  requiredElement("battle-result").hidden = true;
  requiredElement("victory-debrief").hidden = true;
  requiredElement("post-battle-cutscene").hidden = true;
  requiredElement<HTMLButtonElement>("return-from-battle").hidden = true;
  if (battleMode === "custom") {
    battleMode = "campaign";
    activeCampaign = undefined;
    activeMission = undefined;
    requiredElement("campaign-select").hidden = false;
    requiredElement("campaign-screen").hidden = true;
    requiredElement("test-scenario-screen").hidden = true;
    renderCampaignSelection();
    return;
  }
  if (battleMode === "sandbox") {
    activeMission = TEST_SCENARIO_MISSION;
    renderTestScenario();
    setBattleCopy(TEST_SCENARIO_MISSION);
    const testScreen = requiredElement("test-scenario-screen");
    testScreen.classList.remove("departing");
    testScreen.hidden = false;
    requiredElement("campaign-select").hidden = true;
    requiredElement("campaign-screen").hidden = true;
    return;
  }
  const campaign = activeCampaign ?? CAMPAIGN_BY_ID.get(campaignProgress.selectedCampaignId);
  if (!campaign) {
    requiredElement("campaign-select").hidden = false;
    return;
  }
  const mission = currentMissionForCampaign(campaign, campaignProgress);
  if (!mission) {
    requiredElement("campaign-select").hidden = false;
    return;
  }
  renderCampaignPhase(campaign, mission);
  requiredElement("campaign-screen").classList.remove("departing");
  requiredElement("campaign-screen").hidden = false;
  requiredElement("campaign-select").hidden = true;
}

function openCampaign(campaignId: string): void {
  const campaign = CAMPAIGN_BY_ID.get(campaignId);
  if (!campaign?.available) return;
  const mission = currentMissionForCampaign(campaign, campaignProgress);
  if (!mission) return;
  battleMode = "campaign";
  renderCampaignPhase(campaign, mission);
  requiredElement("campaign-select").hidden = true;
  requiredElement("campaign-screen").hidden = false;
}

function launchBattle(
  sourceScreen: HTMLElement,
  mission: MissionDefinition,
  selectedUnitIds: readonly string[],
): void {
  if (launchTimer !== undefined) return;
  if (battleMode === "custom") battleMode = "campaign";
  deployedUnitIds = [...selectedUnitIds];
  activeMission = mission;
  setBattleCopy(mission);
  const battle = requiredElement("battle-screen");
  sourceScreen.classList.add("departing");
  launchTimer = window.setTimeout(() => {
    sourceScreen.hidden = true;
    battle.hidden = false;
    const canvas = requiredElement<HTMLCanvasElement>("battlefield");
    game?.stop();
    game = new Game(canvas, mission, deployedUnitIds, handleBattleEnded);
    game.start();
    launchTimer = undefined;
  }, 420);
}

function launchCustomMapBattle(
  map: Awaited<ReturnType<typeof loadProjectMap>>,
  name: string,
): void {
  const romanFormations = map.deployments.filter((deployment) => deployment.factionId === "roman").length;
  const saxonFormations = map.deployments.filter((deployment) => deployment.factionId === "saxon").length;
  if (romanFormations === 0 || saxonFormations === 0) {
    requiredElement("saved-map-browser-status").textContent =
      "A custom battle needs at least one connected Roman formation and one connected Saxon formation.";
    return;
  }

  game?.stop();
  battleMode = "custom";
  activeCampaign = undefined;
  activeMission = undefined;
  requiredElement("saved-map-browser").hidden = true;
  requiredElement("campaign-select").hidden = true;
  requiredElement("campaign-screen").hidden = true;
  requiredElement("test-scenario-screen").hidden = true;
  requiredElement("map-editor-screen").hidden = true;
  const battle = requiredElement("battle-screen");
  battle.classList.remove("debrief-active");
  battle.hidden = false;
  requiredElement("battle-result").hidden = true;
  requiredElement("victory-debrief").hidden = true;
  requiredElement("post-battle-cutscene").hidden = true;
  requiredElement<HTMLButtonElement>("return-from-battle").hidden = true;
  requiredElement("battle-date").textContent = "CUSTOM MAP";
  requiredElement("battle-objective").textContent = "Defeat all enemy units";
  requiredElement("battle-objective-detail").textContent =
    "Break every deployed Saxon formation. Campaign spawnpoints are not used in custom battles.";
  game = new CustomMapGame(requiredElement<HTMLCanvasElement>("battlefield"), map, name);
  game.start();
}

function selectMission(missionId: string): void {
  if (!activeCampaign) return;
  const mission = MISSION_BY_ID.get(missionId);
  if (!mission || mission.campaignId !== activeCampaign.id) return;
  if (!isMissionUnlocked(activeCampaign, mission, new Set(campaignProgress.completedMissions))) return;
  renderCampaignPhase(activeCampaign, mission);
}

function previewVictoryFlow(): void {
  const campaign = CAMPAIGN_BY_ID.get(campaignProgress.selectedCampaignId) ?? CAMPAIGNS.find((item) => item.available);
  if (!campaign) return;
  const mission = currentMissionForCampaign(campaign, campaignProgress);
  if (!mission) return;
  renderCampaignPhase(campaign, mission);
  deployedUnitIds = mission.deployment.defaultFormationIds.slice();
  requiredElement("campaign-select").hidden = true;
  requiredElement("campaign-screen").hidden = true;
  requiredElement("battle-screen").hidden = false;
  handleBattleEnded({
    outcome: "romanVictory",
    formations: activeFormations.map((formation, index) => ({
      id: formation.id,
      name: formation.name,
      type: getUnitArchetype(formation.archetypeId).type,
      soldierCount: Math.max(0, formation.count - 12 - index * 5),
      maximumSoldiers: formation.count,
      state: index === 1 ? "shaken" as const : "steady" as const,
    })),
  }, false);
}

function showMapEditor(map?: Awaited<ReturnType<typeof loadProjectMap>>, name?: string, fileName?: string): void {
  requiredElement("saved-map-browser").hidden = true;
  requiredElement("campaign-select").hidden = true;
  requiredElement("map-editor-screen").hidden = false;
  mapEditor ??= new MapEditor(requiredElement("map-editor-screen"));
  if (map && name && fileName) mapEditor.loadMap(map, name, fileName);
  else mapEditor.refresh();
}

function savedMapCard(map: ProjectMapSummary): HTMLElement {
  const card = document.createElement("article");
  card.className = "saved-map-card";
  card.dataset.mapFile = map.fileName;
  card.dataset.mapName = map.name;
  const heading = document.createElement("strong");
  heading.textContent = map.name;
  const dimensions = document.createElement("span");
  dimensions.textContent = `${map.width} × ${map.height}`;
  const fileName = document.createElement("small");
  fileName.textContent = map.fileName;
  const deploymentSummary = document.createElement("p");
  deploymentSummary.textContent =
    `${map.romanFormations} Roman · ${map.saxonFormations} Saxon · ${map.spawnPoints} campaign spawnpoints`;
  const actions = document.createElement("div");
  actions.className = "saved-map-card-actions";
  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.dataset.mapAction = "edit";
  editButton.textContent = "EDIT";
  const battleButton = document.createElement("button");
  battleButton.type = "button";
  battleButton.dataset.mapAction = "battle";
  battleButton.textContent = "BATTLE →";
  const battleReady = map.romanFormations > 0 && map.saxonFormations > 0;
  battleButton.disabled = !battleReady;
  if (!battleReady) battleButton.title = "Deploy at least one Roman and one Saxon formation first.";
  actions.append(editButton, battleButton);
  card.append(heading, dimensions, fileName, deploymentSummary, actions);
  return card;
}

async function openSavedMapBrowser(): Promise<void> {
  const browser = requiredElement("saved-map-browser");
  const list = requiredElement("saved-map-list");
  const status = requiredElement("saved-map-browser-status");
  browser.hidden = false;
  list.replaceChildren();
  status.textContent = "Reading public/maps…";
  try {
    const { maps, unreadable } = await listProjectMaps();
    list.replaceChildren(...maps.map(savedMapCard));
    status.textContent = savedMapsStatus(maps, unreadable);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Saved maps could not be listed.";
    status.textContent = `${detail} Project-folder loading requires PLAY_GAME.cmd or npm run dev.`;
  }
}

function bindEvents(): void {
  requiredElement<HTMLButtonElement>("open-map-editor").addEventListener(
    "click",
    () => showMapEditor(),
    listenerOptions,
  );
  requiredElement<HTMLButtonElement>("open-saved-maps").addEventListener(
    "click",
    () => void openSavedMapBrowser(),
    listenerOptions,
  );
  requiredElement<HTMLButtonElement>("close-saved-maps").addEventListener(
    "click",
    () => { requiredElement("saved-map-browser").hidden = true; },
    listenerOptions,
  );
  requiredElement("saved-map-list").addEventListener("click", (event) => {
    const actionButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-map-action]");
    const card = actionButton?.closest<HTMLElement>("[data-map-file]");
    const fileName = card?.dataset.mapFile;
    const name = card?.dataset.mapName;
    const action = actionButton?.dataset.mapAction;
    if (!actionButton || !fileName || !name || !action) return;
    if (action !== "battle" && mapEditor && !mapEditor.confirmDiscardChanges()) return;
    actionButton.disabled = true;
    requiredElement("saved-map-browser-status").textContent = `Loading ${fileName}…`;
    void loadProjectMap(fileName).then((map) => {
      if (action === "battle") launchCustomMapBattle(map, name);
      else showMapEditor(map, name, fileName);
    }).catch((error: unknown) => {
      actionButton.disabled = false;
      requiredElement("saved-map-browser-status").textContent = error instanceof Error
        ? error.message
        : "The selected map could not be loaded.";
    });
  }, listenerOptions);
  requiredElement<HTMLButtonElement>("leave-map-editor").addEventListener("click", () => {
    requiredElement("map-editor-screen").hidden = true;
    requiredElement("campaign-select").hidden = false;
  }, listenerOptions);
  requiredElement<HTMLButtonElement>("open-test-scenario").addEventListener(
    "click",
    openTestScenario,
    listenerOptions,
  );
  requiredElement<HTMLButtonElement>("leave-test-scenario").addEventListener("click", () => {
    battleMode = "campaign";
    activeMission = undefined;
    requiredElement("test-scenario-screen").hidden = true;
    requiredElement("campaign-select").hidden = false;
    renderCampaignSelection();
  }, listenerOptions);
  requiredElement("test-unit-grid").addEventListener("click", (event) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>(".test-unit-card");
    if (card) toggleTestUnit(card);
  }, listenerOptions);
  requiredElement("test-unit-grid").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = (event.target as HTMLElement).closest<HTMLElement>(".test-unit-card");
    if (!card) return;
    event.preventDefault();
    toggleTestUnit(card);
  }, listenerOptions);
  requiredElement<HTMLButtonElement>("begin-test-scenario").addEventListener("click", () => {
    const selected = selectedTestDeployment();
    if (selected.length < TEST_SCENARIO_MISSION.deployment.minimum) return;
    launchBattle(requiredElement("test-scenario-screen"), TEST_SCENARIO_MISSION, selected);
  }, listenerOptions);
  requiredElement("campaign-grid").addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-campaign]");
    if (button?.dataset.campaign) openCampaign(button.dataset.campaign);
  }, listenerOptions);
  requiredElement("mission-list").addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-mission]");
    if (button?.dataset.mission) selectMission(button.dataset.mission);
  }, listenerOptions);
  requiredElement("formation-list").addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const talk = target.closest<HTMLButtonElement>("[data-talk]");
    if (talk?.dataset.talk) {
      showCompanion(talk.dataset.talk);
      return;
    }
    const card = target.closest<HTMLElement>(".formation-card");
    if (card) toggleFormation(card);
  }, listenerOptions);
  requiredElement("formation-list").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = (event.target as HTMLElement).closest<HTMLElement>(".formation-card");
    if (!card) return;
    event.preventDefault();
    toggleFormation(card);
  }, listenerOptions);
  document.querySelectorAll<HTMLButtonElement>("[data-reply]").forEach((button) => {
    button.addEventListener("click", () => {
      const companion = COMPANION_BY_ID.get(activeCompanion);
      if (!companion) return;
      const dialogue = missionDialogue(companion);
      requiredElement("speaker-line").textContent =
        button.dataset.reply === "trust" ? dialogue.trustReply : dialogue.concernReply;
      document.querySelectorAll<HTMLButtonElement>("[data-reply]").forEach((reply) => {
        reply.classList.toggle("chosen", reply === button);
      });
    }, listenerOptions);
  });
  requiredElement<HTMLButtonElement>("continue-story").addEventListener("click", showPostBattleCutscene, listenerOptions);
  requiredElement<HTMLButtonElement>("next-cutscene-line").addEventListener("click", () => {
    if (cutsceneStep >= cutsceneSpeakers.length - 1) {
      returnToCampaignPhase();
      return;
    }
    cutsceneStep += 1;
    renderCutsceneStep();
  }, listenerOptions);
  requiredElement<HTMLButtonElement>("return-from-battle").addEventListener("click", returnToCampaignPhase, listenerOptions);
  requiredElement<HTMLButtonElement>("begin-battle").addEventListener("click", () => {
    if (!activeMission) return;
    const selected = selectedFormationCards()
      .map((card) => card.dataset.unitId)
      .filter((id): id is string => id !== undefined);
    launchBattle(requiredElement("campaign-screen"), activeMission, selected);
  }, listenerOptions);
  document.querySelector<HTMLAnchorElement>(".campaign-brand")?.addEventListener("click", (event) => {
    event.preventDefault();
    battleMode = "campaign";
    requiredElement("campaign-screen").hidden = true;
    requiredElement("campaign-select").hidden = false;
    renderCampaignSelection();
  }, listenerOptions);
}

renderCampaignSelection();
bindEvents();
if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("debrief")) previewVictoryFlow();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    campaignEvents.abort();
    if (launchTimer !== undefined) window.clearTimeout(launchTimer);
    mapEditor?.destroy();
    game?.stop();
  });
}
