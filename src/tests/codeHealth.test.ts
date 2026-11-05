import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAMPAIGN_PROGRESS,
  loadCampaignProgress,
  resilientProgressStorage,
  saveCampaignProgress,
} from "../campaign/CampaignProgress";
import { isSameOriginRequest } from "../mapEditor/localMapServer";

describe("resilient campaign storage", () => {
  const failing = () => {
    throw new Error("Storage is blocked.");
  };

  it("starts with default progress when storage cannot be opened", () => {
    expect(loadCampaignProgress(resilientProgressStorage(failing))).toEqual(DEFAULT_CAMPAIGN_PROGRESS);
  });

  it("does not throw when progress cannot be saved", () => {
    expect(() => saveCampaignProgress(resilientProgressStorage(failing), DEFAULT_CAMPAIGN_PROGRESS)).not.toThrow();
  });

  it("uses storage normally when it works", () => {
    const values = new Map<string, string>();
    const storage = resilientProgressStorage(() => ({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => void values.set(key, value),
    }));
    const progress = { ...DEFAULT_CAMPAIGN_PROGRESS, completedMissions: ["roman-1-hadrians-wall"] };
    saveCampaignProgress(storage, progress);
    expect(loadCampaignProgress(storage).completedMissions).toEqual(["roman-1-hadrians-wall"]);
  });
});

describe("map server origin check", () => {
  it("allows the game's own pages and clients that send no origin", () => {
    expect(isSameOriginRequest("http://127.0.0.1:5173", "127.0.0.1:5173")).toBe(true);
    expect(isSameOriginRequest(undefined, "127.0.0.1:5173")).toBe(true);
  });

  it("refuses other websites and malformed origins", () => {
    expect(isSameOriginRequest("https://example.com", "127.0.0.1:5173")).toBe(false);
    expect(isSameOriginRequest("http://127.0.0.1:9999", "127.0.0.1:5173")).toBe(false);
    expect(isSameOriginRequest("not a url", "127.0.0.1:5173")).toBe(false);
  });
});
