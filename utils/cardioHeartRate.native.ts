import { getGrantedPermissions, initialize, readRecords, requestPermission } from 'react-native-health-connect';

export interface HeartRatePoint { time: string; beatsPerMinute: number }

export async function readCardioHeartRate(start: Date, end: Date): Promise<HeartRatePoint[]> {
  if (!(await initialize())) return [];
  const permission = { accessType: 'read' as const, recordType: 'HeartRate' as const };
  const granted = await getGrantedPermissions();
  if (!granted.some(item => item.accessType === permission.accessType && item.recordType === permission.recordType)) {
    const result = await requestPermission([permission]);
    if (!result.some(item => item.accessType === permission.accessType && item.recordType === permission.recordType)) return [];
  }
  const samples: HeartRatePoint[] = [];
  let pageToken: string | undefined;
  do {
    const page = await readRecords('HeartRate', {
      timeRangeFilter: { operator: 'between', startTime: start.toISOString(), endTime: end.toISOString() },
      pageSize: 1000, pageToken,
    });
    for (const record of page.records) {
      for (const point of record.samples) {
        if (Date.parse(point.time) >= start.getTime() && Date.parse(point.time) <= end.getTime()) {
          samples.push({ time: point.time, beatsPerMinute: point.beatsPerMinute });
        }
      }
    }
    pageToken = page.pageToken;
  } while (pageToken && samples.length < 5000);
  return samples.slice(0, 5000);
}
