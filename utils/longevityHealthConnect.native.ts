import { getGrantedPermissions, initialize, readRecords, requestPermission, insertRecords } from 'react-native-health-connect';
import { API_URL } from '../constants/api';
import { BLOOD_PRESSURE_AUTO_IMPORT_DAYS, bloodPressureImportPayload } from './healthConnectBloodPressure';

const readPermission = { accessType: 'read' as const, recordType: 'BloodPressure' as const };
const writePermission = { accessType: 'write' as const, recordType: 'BloodPressure' as const };

export async function hasBloodPressureReadAccess(): Promise<boolean> {
  if (!await initialize()) return false;
  const permissions = await getGrantedPermissions();
  return permissions.some(p => 'accessType' in p && p.accessType === 'read' && 'recordType' in p && p.recordType === 'BloodPressure');
}

async function importBloodPressureWindow(days: number): Promise<number> {
  const end = new Date(); const start = new Date(end.getTime() - days * 86400000);
  let pageToken: string | undefined; let count = 0;
  do {
    const page = await readRecords('BloodPressure', { timeRangeFilter: { operator: 'between', startTime: start.toISOString(), endTime: end.toISOString() }, pageSize: 100, pageToken });
    for (const record of page.records) {
      const payload = bloodPressureImportPayload(record);
      if (!payload) continue;
      const response = await fetch(`${API_URL}/longevity/bp/health-connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error(`BP import failed (${response.status})`);
      count++;
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return count;
}

export async function importBloodPressure(): Promise<number> {
  if (!await initialize()) throw new Error('Health Connect is unavailable.');
  const grants = await requestPermission([readPermission]);
  if (!grants.some(g => g.accessType === 'read' && g.recordType === 'BloodPressure')) throw new Error('Blood pressure read permission was not granted.');
  return importBloodPressureWindow(30);
}

/** Automatic lane: never prompts; the server de-duplicates by Health Connect record id. */
export async function syncRecentBloodPressure(): Promise<number> {
  if (!await hasBloodPressureReadAccess()) throw new Error('GainLog needs Health Connect blood pressure read permission.');
  return importBloodPressureWindow(BLOOD_PRESSURE_AUTO_IMPORT_DAYS);
}

export async function writeBloodPressure(readings: { time: string; systolic: number; diastolic: number; arm: string; position: string }[]): Promise<void> {
  if (!await initialize()) throw new Error('Health Connect is unavailable.');
  const grants = await requestPermission([writePermission]);
  if (!grants.some(g => g.accessType === 'write' && g.recordType === 'BloodPressure')) throw new Error('Blood pressure write permission was not granted.');
  await insertRecords(readings.map(r => ({ recordType: 'BloodPressure' as const, time: r.time,
    systolic: { value: r.systolic, unit: 'millimetersOfMercury' as const }, diastolic: { value: r.diastolic, unit: 'millimetersOfMercury' as const },
    measurementLocation: r.arm === 'left' ? 3 : 4, bodyPosition: ({ sitting: 2, standing: 1, lying: 3, reclining: 4 } as Record<string, number>)[r.position],
  })));
}
