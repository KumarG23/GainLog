export interface HealthConnectBloodPressureRecord {
  time: string;
  systolic: { inMillimetersOfMercury: number };
  diastolic: { inMillimetersOfMercury: number };
  bodyPosition?: number;
  measurementLocation?: number;
  metadata?: { id?: string };
}

export interface BloodPressureImportPayload {
  time: string;
  systolic: number;
  diastolic: number;
  position: string | null;
  arm: string | null;
  sourceRecordId: string;
}

const POSITIONS: Record<number, string> = { 1: 'standing', 2: 'sitting', 3: 'lying', 4: 'reclining' };
const ARMS: Record<number, string> = { 3: 'left', 4: 'right' };

/** Automatic imports cover a short window; the Longevity button still backfills 30 days. */
export const BLOOD_PRESSURE_AUTO_IMPORT_DAYS = 7;

/** Null for records the server cannot de-duplicate (no Health Connect record id). */
export function bloodPressureImportPayload(
  record: HealthConnectBloodPressureRecord,
): BloodPressureImportPayload | null {
  const sourceRecordId = record.metadata?.id;
  if (!sourceRecordId) return null;
  return {
    time: record.time,
    systolic: Math.round(record.systolic.inMillimetersOfMercury),
    diastolic: Math.round(record.diastolic.inMillimetersOfMercury),
    position: POSITIONS[record.bodyPosition ?? -1] ?? null,
    arm: ARMS[record.measurementLocation ?? -1] ?? null,
    sourceRecordId,
  };
}
