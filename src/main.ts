import "./style.css";
import { Game, type BattleReport } from "./core/Game";
import type { RendererMode } from "./rendering/Renderer";

interface Companion {
  name: string;
  role: string;
  initials: string;
  line: string;
  trustReply: string;
  concernReply: string;
}

const companions: Record<string, Companion> = {
  flavia: {
    name: "Flavia Marcellus",
    role: "Commander · I Cohort Prima",
    initials: "FM",
    line: "“Give Prima the bridge. The river will guard one flank, and our shields will answer for the other.”",
    trustReply: "“Then Prima will be the stone in the river. Nothing crosses while I draw breath.”",
    concernReply: "“Let them try. Keep the archers watching the shallows and I will turn to meet them.”",
  },
  cassian: {
    name: "Cassian Corvus",
    role: "Commander · II Cohort Secunda",
    initials: "CC",
    line: "“Wulfgar wants us fixed at the bridge. I would hold Secunda back until his centre commits.”",
    trustReply: "“A reserve is only cowardice when it arrives late. Mine will arrive at the killing hour.”",
    concernReply: "“Then place me in the line. I will obey—but we surrender the one surprise we possess.”",
  },
  brennos: {
    name: "Brennos of Venta",
    role: "Commander · Equites Honoriani",
    initials: "BV",
    line: "“The eastern bank is firm enough for horses. Loose my riders there and their bowmen will never see noon.”",
    trustReply: "“Good. We will ride beyond their sight, then come back like winter.”",
    concernReply: "“If the ground fails us, we dismount. A spear is still a spear, even in the mud.”",
  },
  aelia: {
    name: "Aelia Naso",
    role: "Commander · Britannic Sagittarii",
    initials: "AN",
    line: "“Twelve volleys. Enough to break one advance, not two. Tell me which enemy matters most.”",
    trustReply: "“The Raven Banner, then. When it falls, every Saxon on that bank will feel alone.”",
    concernReply: "“Then keep me close to the standard. I can preserve the arrows until their shields are turned.”",
  },
};

const companionByUnitId: Record<string, string> = {
  "R-I": "flavia",
  "R-II": "cassian",
  "R-CAV": "brennos",
  "R-ARCH": "aelia",
};

const afterBattleLines: Record<string, string> = {
  flavia: "“The bridge is ours. Prima held, though I will hear their shields in my sleep for a while.”",
  cassian: "“A soldier who can still complain can still march. We bought the north another day.”",
  brennos: "“And Wulfgar’s bowmen learned that mud does not make a horse any less angry.”",
  aelia: "“Save the boasting for camp. We have wounded to count—and arrows to pull from Roman shields.”",
};

const requiredElement = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing campaign element #${id}`);
  return found as T;
};

let activeCompanion = "flavia";
let game: Game | undefined;
let deployedUnitIds: string[] = [];
let cutsceneStep = 0;
let cutsceneSpeakers: string[] = [];

function showCompanion(id: string): void {
  const companion = companions[id];
  if (!companion) return;
  activeCompanion = id;
  requiredElement("speaker-name").textContent = companion.name;
  requiredElement("speaker-role").textContent = companion.role;
  requiredElement("speaker-line").textContent = companion.line;
  const portrait = requiredElement("speaker-portrait");
  portrait.dataset.initials = companion.initials;
  portrait.querySelector("span")!.textContent = companion.initials;
  document.querySelectorAll<HTMLElement>(".formation-card").forEach((card) => {
    card.classList.toggle("speaking", card.dataset.companion === id);
  });
}

function updateDeployment(): void {
  const selected = [...document.querySelectorAll<HTMLElement>(".formation-card.selected")];
  const strength = selected.reduce((total, card) => {
    if (card.dataset.unitId === "R-CAV") return total + 50;
    if (card.dataset.unitId === "R-ARCH") return total + 60;
    return total + 80;
  }, 0);
  requiredElement("formation-count").textContent = String(selected.length);
  requiredElement("deployed-strength").textContent = String(strength);
  requiredElement<HTMLButtonElement>("begin-battle").disabled = selected.length < 2;
  requiredElement("deployment-warning").textContent = selected.length < 2
    ? "Select at least two formations before marching."
    : selected.length < 4 ? `${4 - selected.length} formation${selected.length === 3 ? "" : "s"} will remain at camp.` : "";
}

function toggleFormation(card: HTMLElement): void {
  const selectedCount = document.querySelectorAll(".formation-card.selected").length;
  if (card.classList.contains("selected") && selectedCount <= 2) {
    requiredElement("deployment-warning").textContent = "At least two formations must deploy.";
    return;
  }
  card.classList.toggle("selected");
  card.setAttribute("aria-checked", String(card.classList.contains("selected")));
  updateDeployment();
}

function healthLabel(health: number, state: string): string {
  if (state === "broken" || health === 0) return "Lost";
  if (health < 35) return "Mauled";
  if (health < 70) return "Bloodied";
  return "Battle-ready";
}

function experienceFor(health: number, type: string): number {
  const formationBonus = type === "standard" ? 10 : 25;
  return 35 + formationBonus + Math.round(health * .35);
}

function showVictoryDebrief(report: BattleReport): void {
  if (report.outcome !== "romanVictory") return;
  const battle = requiredElement("battle-screen");
  const results = requiredElement("formation-results");
  let companyExperience = 0;
  battle.classList.add("debrief-active");
  results.replaceChildren();
  for (const formation of report.formations) {
    const health = formation.maximumSoldiers === 0
      ? 0
      : Math.round(formation.soldierCount / formation.maximumSoldiers * 100);
    const experience = experienceFor(health, formation.type);
    companyExperience += experience;
    const row = document.createElement("article");
    row.className = "formation-result-row";
    row.innerHTML = `
      <span class="result-insignia ${formation.type}" aria-hidden="true">${formation.id.replace("R-", "")}</span>
      <div class="result-formation">
        <b>${formation.name}</b>
        <small>${formation.type} · ${healthLabel(health, formation.state)}</small>
      </div>
      <div class="result-health">
        <span><b>${formation.soldierCount}</b> / ${formation.maximumSoldiers}</span>
        <i><em style="width:${health}%"></em></i>
      </div>
      <strong class="result-xp">+${experience} XP</strong>`;
    results.append(row);
  }
  requiredElement("company-experience").textContent = `+${companyExperience} XP`;
  requiredElement("victory-debrief").hidden = false;
}

function cutsceneParticipants(): string[] {
  const selected = deployedUnitIds
    .map((id) => companionByUnitId[id])
    .filter((id): id is string => id !== undefined);
  const participants = selected.length >= 2 ? selected : ["flavia", "cassian"];
  return [...participants, participants[0] ?? "flavia"];
}

function renderCutsceneStep(): void {
  const speakerId = cutsceneSpeakers[cutsceneStep] ?? "flavia";
  const speaker = companions[speakerId];
  if (!speaker) return;
  const portrait = requiredElement("cutscene-portrait");
  portrait.className = `cutscene-portrait portrait-${speakerId} ${cutsceneStep % 2 === 0 ? "portrait-left" : "portrait-right"}`;
  requiredElement("post-battle-cutscene").classList.toggle("speaker-right", cutsceneStep % 2 === 1);
  requiredElement("cutscene-speaker-name").textContent = speaker.name;
  requiredElement("cutscene-speaker-role").textContent = speaker.role;
  requiredElement("cutscene-line").textContent = cutsceneStep === cutsceneSpeakers.length - 1
    ? "“See to the wounded. At first light, we carry word of Caer Durn back to the company.”"
    : afterBattleLines[speakerId] ?? speaker.line;
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

function returnToCampaign(): void {
  window.sessionStorage.setItem("last-eagle-caer-durn-complete", "true");
  window.location.assign(window.location.pathname);
}

function previewVictoryFlow(): void {
  deployedUnitIds = ["R-I", "R-II", "R-CAV", "R-ARCH"];
  requiredElement("campaign-screen").hidden = true;
  requiredElement("battle-screen").hidden = false;
  showVictoryDebrief({
    outcome: "romanVictory",
    formations: [
      { id: "R-I", name: "I Cohort · Prima", type: "infantry", soldierCount: 61, maximumSoldiers: 80, state: "steady" },
      { id: "R-II", name: "II Cohort · Secunda", type: "infantry", soldierCount: 43, maximumSoldiers: 80, state: "shaken" },
      { id: "R-CAV", name: "Equites Honoriani", type: "cavalry", soldierCount: 37, maximumSoldiers: 50, state: "steady" },
      { id: "R-ARCH", name: "Britannic Sagittarii", type: "archers", soldierCount: 52, maximumSoldiers: 60, state: "steady" },
      { id: "R-STD", name: "Draco Standard", type: "standard", soldierCount: 14, maximumSoldiers: 16, state: "steady" },
    ],
  });
}

document.querySelectorAll<HTMLElement>(".formation-card").forEach((card) => {
  card.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest(".talk-button")) return;
    toggleFormation(card);
  });
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleFormation(card);
    }
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-talk]").forEach((button) => {
  button.addEventListener("click", () => showCompanion(button.dataset.talk ?? "flavia"));
});

document.querySelectorAll<HTMLButtonElement>("[data-reply]").forEach((button) => {
  button.addEventListener("click", () => {
    const companion = companions[activeCompanion];
    if (!companion) return;
    requiredElement("speaker-line").textContent =
      button.dataset.reply === "trust" ? companion.trustReply : companion.concernReply;
    document.querySelectorAll<HTMLButtonElement>("[data-reply]").forEach((reply) => {
      reply.classList.toggle("chosen", reply === button);
    });
  });
});

requiredElement<HTMLButtonElement>("continue-story").addEventListener("click", showPostBattleCutscene);
requiredElement<HTMLButtonElement>("next-cutscene-line").addEventListener("click", () => {
  if (cutsceneStep >= cutsceneSpeakers.length - 1) {
    returnToCampaign();
    return;
  }
  cutsceneStep += 1;
  renderCutsceneStep();
});

requiredElement<HTMLButtonElement>("begin-battle").addEventListener("click", () => {
  const selectedUnitIds = [...document.querySelectorAll<HTMLElement>(".formation-card.selected")]
    .map((card) => card.dataset.unitId)
    .filter((id): id is string => id !== undefined);
  deployedUnitIds = selectedUnitIds;
  const campaign = requiredElement("campaign-screen");
  const battle = requiredElement("battle-screen");
  campaign.classList.add("departing");
  window.setTimeout(() => {
    campaign.hidden = true;
    battle.hidden = false;
    const canvas = requiredElement<HTMLCanvasElement>("battlefield");
    const rendererMode: RendererMode =
      new URLSearchParams(window.location.search).get("renderer") === "topDown" ? "topDown" : "isometric";
    game = new Game(canvas, rendererMode, selectedUnitIds, showVictoryDebrief);
    game.start();
  }, 420);
});

showCompanion("flavia");
updateDeployment();
if (window.sessionStorage.getItem("last-eagle-caer-durn-complete") === "true") {
  requiredElement("deployment-warning").textContent = "Caer Durn secured · Your commanders carry their experience forward.";
  requiredElement<HTMLButtonElement>("begin-battle").querySelector("span")!.textContent = "REPLAY MISSION";
  requiredElement<HTMLButtonElement>("begin-battle").querySelector("small")!.textContent = "Return to Caer Durn";
}
if (new URLSearchParams(window.location.search).has("debrief")) previewVictoryFlow();

if (import.meta.hot) {
  import.meta.hot.dispose(() => game?.stop());
}
