export type Focus = 'sleep' | 'movement' | 'strength' | 'nutrition' | 'stress';
export interface DayCheckIn {
  date: string;
  revision: number;
  updatedAt: string | null;
  energy: number | null;
  soreness: number | null;
  stress: number | null;
  trainingIntent: 'plan' | 'rest' | null;
  note: string | null;
  stressMinute: number | null;
  reflection: string | null;
  nutritionReviewed: boolean;
  nutritionReviewedAt: string | null;
  nutritionFingerprint: string | null;
}
export type CheckInPatch = Partial<Pick<DayCheckIn, 'energy' | 'soreness' | 'stress' | 'trainingIntent' | 'note' | 'stressMinute' | 'reflection' | 'nutritionReviewed' | 'nutritionFingerprint'>>;
export interface JourneyPreferences {
  revision: number;
  wakeTime: string | null;
  sleepMinutes: number | null;
  windDownMinutes: number;
  focus: Focus | null;
}
export interface JourneySnapshot {
  version: 1;
  startDate: string;
  endDate: string;
  days: DayCheckIn[];
  preferences: JourneyPreferences;
}
export interface SleepNight {
  date: string;
  startUtc: string;
  endUtc: string;
  startOffsetSeconds: number | null;
  endOffsetSeconds: number | null;
  minutesAsleep: number | null;
  minutesAwake: number | null;
  provenance: string;
  sourceId: string | null;
}
export interface SleepDetail {
  date: string;
  night: SleepNight | null;
  stages: { type: string; startUtc: string; endUtc: string }[];
  timelineStatus: 'available' | 'missing' | 'invalid';
  history: SleepNight[];
}
