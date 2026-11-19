import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOOD_PRESSURE_AUTO_IMPORT_DAYS,
  bloodPressureImportPayload,
} from '../utils/healthConnectBloodPressure.ts';

const record = (extra = {}) => ({
  time: '2026-11-19T12:00:00Z',
  systolic: { inMillimetersOfMercury: 118.4 },
  diastolic: { inMillimetersOfMercury: 76.6 },
  bodyPosition: 2,
  measurementLocation: 3,
  metadata: { id: 'hc-1' },
  ...extra,
});

test('maps a Health Connect reading to the server payload with rounding and labels', () => {
  assert.deepEqual(bloodPressureImportPayload(record()), {
    time: '2026-11-19T12:00:00Z', systolic: 118, diastolic: 77,
    position: 'sitting', arm: 'left', sourceRecordId: 'hc-1',
  });
});

test('unknown position or arm codes become null instead of guesses', () => {
  const payload = bloodPressureImportPayload(record({ bodyPosition: 0, measurementLocation: undefined }));
  assert.equal(payload.position, null);
  assert.equal(payload.arm, null);
});

test('records without a Health Connect id are skipped because they cannot be de-duplicated', () => {
  assert.equal(bloodPressureImportPayload(record({ metadata: {} })), null);
  assert.equal(bloodPressureImportPayload(record({ metadata: undefined })), null);
});

test('the automatic window is short but covers a missed week', () => {
  assert.equal(BLOOD_PRESSURE_AUTO_IMPORT_DAYS, 7);
});
