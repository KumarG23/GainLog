import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_SYNC_INTERVAL_MS,
  runIndependentAutoSyncLanes,
  shouldAttemptHealthConnectAutoSync,
} from '../utils/healthConnectAutoSync.ts';

test('automatic Health Connect sync targets hourly freshness for nightly reviews', () => {
  assert.equal(AUTO_SYNC_INTERVAL_MS, 60 * 60 * 1000);
});

test('automatic Health Connect sync runs when there is no successful sync yet', () => {
  assert.equal(shouldAttemptHealthConnectAutoSync({
    nowMs: Date.parse('2026-08-21T09:00:00-04:00'),
    lastSuccessMs: null,
  }), true);
});

test('automatic Health Connect sync is throttled inside its interval', () => {
  const nowMs = Date.parse('2026-08-21T09:00:00-04:00');
  assert.equal(shouldAttemptHealthConnectAutoSync({
    nowMs,
    lastSuccessMs: nowMs - AUTO_SYNC_INTERVAL_MS + 1,
  }), false);
});

test('automatic Health Connect sync retries once the interval elapses', () => {
  const nowMs = Date.parse('2026-08-21T09:00:00-04:00');
  assert.equal(shouldAttemptHealthConnectAutoSync({
    nowMs,
    lastSuccessMs: nowMs - AUTO_SYNC_INTERVAL_MS,
  }), true);
});

test('a failed sync is not recorded as a successful throttle point', () => {
  const nowMs = Date.parse('2026-08-21T09:00:00-04:00');
  assert.equal(shouldAttemptHealthConnectAutoSync({
    nowMs,
    lastSuccessMs: null,
  }), true);
});

test('a failed health import does not block the independent nutrition export lane', async () => {
  const ran = [];
  const saved = [];
  const result = await runIndependentAutoSyncLanes({
    nowMs: 1234,
    force: false,
    lanes: [
      {
        name: 'health',
        lastSuccessMs: null,
        run: async () => {
          ran.push('health');
          throw new Error('health import failed');
        },
      },
      {
        name: 'nutrition',
        lastSuccessMs: null,
        run: async () => { ran.push('nutrition'); },
      },
    ],
    saveSuccess: async (name, value) => { saved.push([name, value]); },
  });

  assert.deepEqual(ran, ['health', 'nutrition']);
  assert.deepEqual(saved, [['nutrition', 1234]]);
  assert.deepEqual(result, {
    attempted: ['health', 'nutrition'],
    succeeded: ['nutrition'],
    failed: ['health'],
  });
});

test('each automatic sync lane uses its own freshness timestamp', async () => {
  const nowMs = Date.parse('2026-08-21T09:00:00-04:00');
  const ran = [];
  const result = await runIndependentAutoSyncLanes({
    nowMs,
    force: false,
    lanes: [
      {
        name: 'health',
        lastSuccessMs: nowMs - 1,
        run: async () => { ran.push('health'); },
      },
      {
        name: 'nutrition',
        lastSuccessMs: null,
        run: async () => { ran.push('nutrition'); },
      },
    ],
    saveSuccess: async () => {},
  });

  assert.deepEqual(ran, ['nutrition']);
  assert.deepEqual(result.succeeded, ['nutrition']);
});
