export const CAMPAIGN_PROGRESS_KEY = "last-eagle-campaign-progress-v1";

export interface CampaignProgress {
  completedMissions: string[];
  selectedCampaignId: string;
  selectedMissionIds: Record<string, string>;
}

export const DEFAULT_CAMPAIGN_PROGRESS: CampaignProgress = {
  completedMissions: [],
  selectedCampaignId: "roman",
  selectedMissionIds: {},
};

export interface ProgressStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function parseCampaignProgress(raw: string | null): CampaignProgress {
  if (!raw) return { ...DEFAULT_CAMPAIGN_PROGRESS, completedMissions: [], selectedMissionIds: {} };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") throw new Error("Invalid progress");
    const candidate = value as Partial<CampaignProgress>;
    return {
      selectedCampaignId: typeof candidate.selectedCampaignId === "string"
        ? candidate.selectedCampaignId
        : DEFAULT_CAMPAIGN_PROGRESS.selectedCampaignId,
      completedMissions: Array.isArray(candidate.completedMissions)
        ? [...new Set(candidate.completedMissions.filter((id): id is string => typeof id === "string"))]
        : [],
      selectedMissionIds: candidate.selectedMissionIds && typeof candidate.selectedMissionIds === "object"
        ? Object.fromEntries(
            Object.entries(candidate.selectedMissionIds)
              .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
          )
        : {},
    };
  } catch {
    return { ...DEFAULT_CAMPAIGN_PROGRESS, completedMissions: [], selectedMissionIds: {} };
  }
}

/** Blocked or full browser storage must not stop the game: progress simply lasts for this session. */
export function resilientProgressStorage(open: () => ProgressStorage): ProgressStorage {
  return {
    getItem(key) {
      try {
        return open().getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        open().setItem(key, value);
      } catch {
        // Nothing useful to do: the in-memory progress is still correct.
      }
    },
  };
}

export function loadCampaignProgress(storage: ProgressStorage): CampaignProgress {
  return parseCampaignProgress(storage.getItem(CAMPAIGN_PROGRESS_KEY));
}

export function saveCampaignProgress(
  storage: ProgressStorage,
  progress: CampaignProgress,
): void {
  storage.setItem(CAMPAIGN_PROGRESS_KEY, JSON.stringify(progress));
}

export function completeMission(
  progress: CampaignProgress,
  missionId: string,
): CampaignProgress {
  if (progress.completedMissions.includes(missionId)) return progress;
  return {
    ...progress,
    completedMissions: [...progress.completedMissions, missionId],
  };
}
