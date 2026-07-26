import "./style.css";
import { Game } from "./core/Game";
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

const requiredElement = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing campaign element #${id}`);
  return found as T;
};

let activeCompanion = "flavia";
let game: Game | undefined;

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

requiredElement<HTMLButtonElement>("begin-battle").addEventListener("click", () => {
  const selectedUnitIds = [...document.querySelectorAll<HTMLElement>(".formation-card.selected")]
    .map((card) => card.dataset.unitId)
    .filter((id): id is string => id !== undefined);
  const campaign = requiredElement("campaign-screen");
  const battle = requiredElement("battle-screen");
  campaign.classList.add("departing");
  window.setTimeout(() => {
    campaign.hidden = true;
    battle.hidden = false;
    const canvas = requiredElement<HTMLCanvasElement>("battlefield");
    const rendererMode: RendererMode =
      new URLSearchParams(window.location.search).get("renderer") === "topDown" ? "topDown" : "isometric";
    game = new Game(canvas, rendererMode, selectedUnitIds);
    game.start();
  }, 420);
});

showCompanion("flavia");
updateDeployment();

if (import.meta.hot) {
  import.meta.hot.dispose(() => game?.stop());
}
