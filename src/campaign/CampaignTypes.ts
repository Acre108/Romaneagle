export type BattlefieldFeature = "hadriansWall";
export type BattlefieldTerrain = "riverValley" | "wallApproach";

export interface MissionDialogue {
  briefingLine: string;
  trustReply: string;
  concernReply: string;
  afterBattleLine: string;
  bloodiedLine: string;
  lostLine: string;
}

export interface MissionDefinition {
  id: string;
  campaignId: string;
  sequence: number;
  numeral: string;
  chapterLabel: string;
  title: string;
  titleLead: string;
  titleEmphasis: string;
  description: string;
  objective: string;
  objectiveDetail: string;
  facts: readonly { label: string; value: string }[];
  scoutReport: string;
  scoutAttribution: string;
  rewards: readonly { value: string; label: string }[];
  dateLabel: string;
  regionLabel: string;
  launchLabel: string;
  deployment: {
    formationIds: readonly string[];
    defaultFormationIds: readonly string[];
    minimum: number;
    maximum: number;
    fixed: boolean;
    help: string;
    note: string;
  };
  map: {
    ariaLabel: string;
    theme: string;
    primaryLabel: string;
    crossingLabel: string;
    homeLabel: string;
    playerPinLabel: string;
    enemyPinLabel: string;
    distanceLabel: string;
  };
  battle: {
    enemyLabel: string;
    enemyRoutedLabel: string;
    enemyDestroyedLabel: string;
    victoryTitle: string;
    victoryDetail: string;
    defeatTitle: string;
    defeatDetail: string;
    mutualTitle: string;
    mutualDetail: string;
  };
  debrief: {
    title: string;
    detail: string;
    footer: string;
  };
  cutscene: {
    chapterLabel: string;
    locationLabel: string;
    closingLine: string;
  };
  dialogueByCompanionId: Readonly<Record<string, MissionDialogue>>;
  battlefield: {
    seed: number;
    terrain: BattlefieldTerrain;
    features: readonly BattlefieldFeature[];
  };
}

export interface CampaignDefinition {
  id: string;
  numeral: string;
  kicker: string;
  title: string;
  description: string;
  available: boolean;
  missions: readonly MissionDefinition[];
}
