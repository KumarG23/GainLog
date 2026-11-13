import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@gainlog:cardio-zone2:v1';
export interface Zone2Band { lower: number; upper: number }
export const DEFAULT_ZONE2_BAND: Zone2Band = { lower: 110, upper: 130 };

// This band is a user-editable estimate, never a measured lactate/ventilatory threshold.
export function validateZone2Band(lower: number, upper: number): Zone2Band | null {
  if (!Number.isInteger(lower) || !Number.isInteger(upper) ||
      lower < 60 || upper > 200 || upper - lower < 5 || upper - lower > 60) return null;
  return { lower, upper };
}

export async function readZone2Band(): Promise<Zone2Band> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return DEFAULT_ZONE2_BAND;
  try {
    const parsed = JSON.parse(raw) as Zone2Band;
    return validateZone2Band(parsed.lower, parsed.upper) ?? DEFAULT_ZONE2_BAND;
  } catch { return DEFAULT_ZONE2_BAND; }
}

export async function saveZone2Band(lower: number, upper: number): Promise<Zone2Band> {
  const band = validateZone2Band(lower, upper);
  if (!band) throw new Error('Enter whole-number limits from 60–200 bpm, 5–60 bpm apart.');
  await AsyncStorage.setItem(KEY, JSON.stringify(band));
  return band;
}
