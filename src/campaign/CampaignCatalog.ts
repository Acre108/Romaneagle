import type { CampaignProgress } from "./CampaignProgress";
import type { CampaignDefinition, MissionDefinition } from "./CampaignTypes";
import { BLACKWATER_FORD_MISSION } from "./missions/BlackwaterFordMission";
import { HADRIANS_WALL_MISSION } from "./missions/HadriansWallMission";
import { RAVEN_AT_VINDOLANDA_MISSION } from "./missions/RavenAtVindolandaMission";

export const CAMPAIGNS: readonly CampaignDefinition[] = [
  {
    id: "roman",
    numeral: "I",
    kicker: "THE NORTHERN FRONTIER",
    title: "The Wall in Shadow",
    description: "Fight three linked battles to hold Rome's northern road from Hadrian's Wall to Vindolanda.",
    available: true,
    missions: [
      HADRIANS_WALL_MISSION,
      BLACKWATER_FORD_MISSION,
      RAVEN_AT_VINDOLANDA_MISSION,
    ],
  },
  {
    id: "saxon-shore",
    numeral: "II",
    kicker: "CAMPAIGN II",
    title: "The Saxon Shore",
    description: "Coming in a later prototype milestone.",
    available: false,
    missions: [],
  },
  {
    id: "broken-province",
    numeral: "III",
    kicker: "CAMPAIGN III",
    title: "The Broken Province",
    description: "Coming in a later prototype milestone.",
    available: false,
    missions: [],
  },
  {
    id: "last-eagle",
    numeral: "IV",
    kicker: "CAMPAIGN IV",
    title: "The Last Eagle",
    description: "Coming in a later prototype milestone.",
    available: false,
    missions: [],
  },
];

export const CAMPAIGN_BY_ID = new Map(CAMPAIGNS.map((campaign) => [campaign.id, campaign]));
export const MISSION_BY_ID = new Map(
  CAMPAIGNS.flatMap((campaign) => campaign.missions.map((mission) => [mission.id, mission] as const)),
);

export function isMissionUnlocked(
  campaign: CampaignDefinition,
  mission: MissionDefinition,
  completedMissionIds: ReadonlySet<string>,
): boolean {
  const index = campaign.missions.findIndex((candidate) => candidate.id === mission.id);
  if (index < 0) return false;
  if (index === 0) return true;
  const previous = campaign.missions[index - 1];
  return previous !== undefined && completedMissionIds.has(previous.id);
}

export function currentMissionForCampaign(
  campaign: CampaignDefinition,
  progress: CampaignProgress,
): MissionDefinition | undefined {
  const completed = new Set(progress.completedMissions);
  const savedMissionId = progress.selectedMissionIds[campaign.id];
  const saved = campaign.missions.find((mission) => mission.id === savedMissionId);
  if (saved && isMissionUnlocked(campaign, saved, completed) && !completed.has(saved.id)) return saved;
  const next = campaign.missions.find((mission) =>
    !completed.has(mission.id) && isMissionUnlocked(campaign, mission, completed));
  return next ?? [...campaign.missions].reverse().find((mission) => completed.has(mission.id)) ?? campaign.missions[0];
}

export function campaignCompletion(
  campaign: CampaignDefinition,
  completedMissionIds: readonly string[],
): { completed: number; total: number; percent: number } {
  const completed = new Set(completedMissionIds);
  const count = campaign.missions.filter((mission) => completed.has(mission.id)).length;
  const total = campaign.missions.length;
  return { completed: count, total, percent: total === 0 ? 0 : count / total * 100 };
}
