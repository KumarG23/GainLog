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
    errors: { health: 'health import failed' },
  });
});

test('a failed lane records a readable failure for Settings without blocking other lanes', async () => {
  const failures = [];
  const result = await runIndependentAutoSyncLanes({
    nowMs: 5_000,
    force: true,
    lanes: [
      { name: 'nutrition', lastSuccessMs: null, run: async () => { throw new TypeError('Network request failed'); } },
      { name: 'workouts', lastSuccessMs: null, run: async () => {} },
    ],
    saveSuccess: async () => {},
    saveFailure: async (name, failure) => { failures.push([name, failure]); },
  });
  assert.deepEqual(result.failed, ['nutrition']);
  assert.deepEqual(result.succeeded, ['workouts']);
  assert.deepEqual(failures, [[
    'nutrition',
    { atMs: 5_000, message: 'Could not reach the GainLog server. Check that Tailscale is connected.' },
  ]]);
});

test('status bookkeeping failures never mask a lane result', async () => {
  const result = await runIndependentAutoSyncLanes({
    nowMs: 1,
    force: true,
    lanes: [{ name: 'health', lastSuccessMs: null, run: async () => { throw new Error('boom'); } }],
    saveSuccess: async () => {},
    saveFailure: async () => { throw new Error('storage full'); },
  });
  assert.deepEqual(result.failed, ['health']);
});

test('sync errors become short, actionable Settings messages', () => {
  assert.equal(
    autoSync.describeAutoSyncError(new TypeError('Network request failed')),
    'Could not reach the GainLog server. Check that Tailscale is connected.',
  );
  assert.equal(
    autoSync.describeAutoSyncError(null),
    'Could not reach the GainLog server. Check that Tailscale is connected.',
  );
  assert.equal(
    autoSync.describeAutoSyncError(new Error('GainLog needs Health Connect nutrition write permission.')),
    'GainLog needs Health Connect nutrition write permission.',
  );
  assert.equal(autoSync.describeAutoSyncError('x'.repeat(300)).length, 160);
});

test('foreground retries back off and then stop', () => {
  assert.deepEqual(
    [0, 1, 2, 3].map(autoSync.autoSyncRetryDelayMs),
    [30_000, 120_000, 300_000, null],
  );
});

test('stored failures and sync ages parse defensively', () => {
  assert.deepEqual(autoSync.parseAutoSyncFailure('{"atMs":10,"message":"m"}'), { atMs: 10, message: 'm' });
  assert.equal(autoSync.parseAutoSyncFailure('not json'), null);
  assert.equal(autoSync.parseAutoSyncFailure('{"atMs":"x","message":"m"}'), null);
  const now = 10 * 3_600_000;
  assert.equal(autoSync.formatSyncAge(now, null), 'never');
  assert.equal(autoSync.formatSyncAge(now, now - 10_000), 'just now');
  assert.equal(autoSync.formatSyncAge(now, now - 5 * 60_000), '5 min ago');
  assert.equal(autoSync.formatSyncAge(now, now - 3 * 3_600_000), '3 h ago');
  assert.equal(autoSync.formatSyncAge(now, now - 72 * 3_600_000), '3 days ago');
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
