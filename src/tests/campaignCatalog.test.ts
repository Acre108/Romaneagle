import { describe, expect, it } from "vitest";
import {
  CAMPAIGNS,
  CAMPAIGN_BY_ID,
  MISSION_BY_ID,
  campaignCompletion,
  currentMissionForCampaign,
  isMissionUnlocked,
} from "../campaign/CampaignCatalog";
import type { CampaignDefinition, MissionDefinition } from "../campaign/CampaignTypes";
import type { CampaignProgress } from "../campaign/CampaignProgress";
import { ROMAN_FORMATION_BY_ID } from "../scenario/Roster";

const mission = (id: string, sequence: number): MissionDefinition => ({
  ...MISSION_BY_ID.get("roman-1-hadrians-wall")!,
  id,
  sequence,
  numeral: String(sequence),
  title: id,
});

const progress = (completedMissions: string[], selectedMissionId?: string): CampaignProgress => ({
  completedMissions,
  selectedCampaignId: "test",
  selectedMissionIds: selectedMissionId ? { test: selectedMissionId } : {},
});

describe("campaign catalog", () => {
  it("indexes every configured campaign and mission", () => {
    expect(CAMPAIGNS).toHaveLength(4);
    expect(CAMPAIGN_BY_ID.get("roman")?.missions[0]?.id).toBe("roman-1-hadrians-wall");
    expect(CAMPAIGN_BY_ID.get("roman")?.missions.map((candidate) => candidate.id)).toEqual([
      "roman-1-hadrians-wall",
      "roman-2-blackwater-ford",
      "roman-3-raven-at-vindolanda",
    ]);
    expect(MISSION_BY_ID.get("roman-1-hadrians-wall")?.battlefield.terrain).toBe("wallApproach");
    expect(MISSION_BY_ID.get("roman-2-blackwater-ford")?.battlefield.terrain).toBe("riverValley");
    expect(MISSION_BY_ID.get("roman-3-raven-at-vindolanda")?.dialogueByCompanionId.valeria).toBeDefined();
  });

  it("unlocks missions in data order and advances to the next incomplete mission", () => {
    const first = mission("first", 1);
    const second = mission("second", 2);
    const third = mission("third", 3);
    const campaign: CampaignDefinition = {
      id: "test",
      numeral: "T",
      kicker: "TEST",
      title: "Test campaign",
      description: "Test",
      available: true,
      missions: [first, second, third],
    };
    expect(isMissionUnlocked(campaign, first, new Set())).toBe(true);
    expect(isMissionUnlocked(campaign, second, new Set())).toBe(false);
    expect(isMissionUnlocked(campaign, second, new Set([first.id]))).toBe(true);
    expect(currentMissionForCampaign(campaign, progress([first.id]))?.id).toBe(second.id);
    expect(currentMissionForCampaign(campaign, progress([first.id], third.id))?.id).toBe(second.id);
    expect(currentMissionForCampaign(campaign, progress([first.id, second.id, third.id]))?.id).toBe(third.id);
  });

  it("derives campaign completion from mission data", () => {
    const campaign = CAMPAIGN_BY_ID.get("roman")!;
    expect(campaignCompletion(campaign, [])).toEqual({ completed: 0, total: 3, percent: 0 });
    const firstComplete = campaignCompletion(campaign, [campaign.missions[0]!.id]);
    expect(firstComplete).toEqual(expect.objectContaining({ completed: 1, total: 3 }));
    expect(firstComplete.percent).toBeCloseTo(100 / 3);
  });

  it("configures every Roman mission with valid deployments and companion dialogue", () => {
    const campaign = CAMPAIGN_BY_ID.get("roman")!;
    for (const configured of campaign.missions) {
      expect(configured.sequence).toBe(campaign.missions.indexOf(configured) + 1);
      expect(configured.deployment.minimum).toBeGreaterThan(0);
      expect(configured.deployment.minimum).toBeLessThanOrEqual(configured.deployment.maximum);
      expect(configured.deployment.defaultFormationIds.length).toBeGreaterThanOrEqual(configured.deployment.minimum);
      expect(configured.deployment.defaultFormationIds.length).toBeLessThanOrEqual(configured.deployment.maximum);
      expect(configured.deployment.defaultFormationIds.every((id) =>
        configured.deployment.formationIds.includes(id))).toBe(true);
      expect(configured.deployment.formationIds.every((id) => {
        const companionId = ROMAN_FORMATION_BY_ID.get(id)?.companion.id;
        return companionId !== undefined && configured.dialogueByCompanionId[companionId] !== undefined;
      })).toBe(true);
    }
  });
});
