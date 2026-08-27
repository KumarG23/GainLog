import test from 'node:test';
import assert from 'node:assert/strict';
import * as autoSync from '../utils/healthConnectAutoSync.ts';
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

test('a forced foreground sync bypasses an otherwise fresh lane timestamp', async () => {
  const ran = [];
  const result = await runIndependentAutoSyncLanes({
    nowMs: 2_000,
    force: true,
    lanes: [{
      name: 'health',
      lastSuccessMs: 1_999,
      run: async () => { ran.push('health'); },
    }],
    saveSuccess: async () => {},
  });

  assert.deepEqual(ran, ['health']);
  assert.deepEqual(result.succeeded, ['health']);
});

test('a foreground force queues behind an active background sync instead of being discarded', async () => {
  assert.equal(typeof autoSync.createForceAwareTaskRunner, 'function');
  const calls = [];
  let releaseBackground;
  const backgroundGate = new Promise(resolve => { releaseBackground = resolve; });
  const run = autoSync.createForceAwareTaskRunner(async options => {
    calls.push(options);
    if (!options.force) await backgroundGate;
    return options.force ? 'foreground' : 'background';
  });

  const background = run({ requestPermissions: false, force: false });
  const foreground = run({ requestPermissions: true, force: true });
  const duplicateForeground = run({ requestPermissions: true, force: true });
  assert.deepEqual(calls, [{ requestPermissions: false, force: false }]);
  assert.strictEqual(foreground, duplicateForeground);

  releaseBackground();
  assert.equal(await background, 'background');
  assert.equal(await foreground, 'foreground');
  assert.deepEqual(calls, [
    { requestPermissions: false, force: false },
    { requestPermissions: true, force: true },
  ]);
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
