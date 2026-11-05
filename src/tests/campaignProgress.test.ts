import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_PROGRESS_KEY,
  completeMission,
  loadCampaignProgress,
  parseCampaignProgress,
  saveCampaignProgress,
} from "../campaign/CampaignProgress";

describe("campaign progress", () => {
  it("falls back safely when no valid save exists", () => {
    expect(parseCampaignProgress(null)).toEqual({
      completedMissions: [],
      selectedCampaignId: "roman",
      selectedMissionIds: {},
    });
    expect(parseCampaignProgress("not-json").completedMissions).toEqual([]);
  });

  it("completes a mission once and persists it", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const completed = completeMission(
      { completedMissions: [], selectedCampaignId: "roman", selectedMissionIds: {} },
      "roman-1-hadrians-wall",
    );
    saveCampaignProgress(storage, completed);
    expect(values.has(CAMPAIGN_PROGRESS_KEY)).toBe(true);
    expect(loadCampaignProgress(storage).completedMissions).toEqual([
      "roman-1-hadrians-wall",
    ]);
    expect(completeMission(completed, "roman-1-hadrians-wall")).toBe(completed);
  });
});
