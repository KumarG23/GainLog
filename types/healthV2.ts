export interface HealthV2Component {
  score?: number;
  weight?: number;
  sourceConfidence?: number;
  valueMinutes?: number;
  valueMs?: number;
  valueBpm?: number;
  baselineMedianMs?: number;
  baselineMedianBpm?: number;
  deviationPercent?: number;
  deviationBpm?: number;
  baselineDays?: number;
  minutes?: number;
  basePoints?: number;
}

export interface HealthV2Score {
  score: number | null;
  state: string;
  confidence: number;
  qualityStatus?: string;
  components: Record<string, HealthV2Component>;
}

export interface HealthV2Load {
  loadPoints: number | null;
  state: string;
  confidence: number;
  qualityStatus?: string;
  components: Record<string, HealthV2Component>;
  baseline?: {
    medianActiveDayPoints: number;
    activeDays: number;
    ratio: number;
  };
}

export interface HealthV2StressSegment {
  startMinute: number;
  state: string;
  score: number | null;
  confidence: number;
}

export interface HealthV2Stress {
  score: number | null;
  state: string;
  confidence: number;
  baselineReady: boolean;
  baselineDays: number;
  expectedMinutes: number;
  observedHeartRateMinutes: number;
  scoredMinutes: number;
  stateCounts: Record<string, number>;
  segments: HealthV2StressSegment[];
}

export interface HealthV2Today {
  date: string;
  version: string;
  provenance: string;
  sleep: HealthV2Score;
  recovery: HealthV2Score;
  load: HealthV2Load;
  stress: HealthV2Stress;
}
