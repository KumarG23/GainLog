import test from 'node:test';
import assert from 'node:assert/strict';
import * as healthConnectChangeSync from '../utils/healthConnectChangeSync.ts';

import {
  bootstrapHealthConnectChangeSync,
  buildHealthConnectWeightReconcilePayload,
  createSerialTaskRunner,
  HealthConnectRepairRequiredError,
  indexHealthConnectRecords,
  indexHealthConnectWeightRecords,
  loadHealthConnectSyncState,
  parseHealthConnectSyncState,
  planHealthConnectChangePage,
  prepareHealthConnectWeightReconciliation,
  reconcileHealthConnectChangePages,
  runHealthConnectChangeSync,
  stampHealthConnectRecordType,
} from '../utils/healthConnectChangeSync.ts';


test('change page plans old and new dates while updating the durable record index', () => {
  const state = {
    version: 1,
    changesToken: 'token-1',
    records: {
      moved: { recordType: 'Steps', dates: ['2026-08-24'] },
      removed: { recordType: 'Weight', dates: ['2026-08-23'] },
    },
  };
  const plan = planHealthConnectChangePage(state, {
    upsertionChanges: [{
      record: {
        recordType: 'Steps',
        startTime: '2026-08-25T23:30:00-04:00',
        endTime: '2026-08-26T00:15:00-04:00',
        metadata: { id: 'moved' },
      },
    }],
    deletionChanges: [{ recordId: 'removed' }],
    nextChangesToken: 'token-2',
    changesTokenExpired: false,
    hasMore: false,
  });

  assert.deepEqual(plan.changedDates, [
    '2026-08-23',
    '2026-08-24',
    '2026-08-25',
    '2026-08-26',
  ]);
  assert.deepEqual(plan.deletedWeightRecordIds, ['removed']);
  assert.equal(plan.requiresRepair, false);
  assert.deepEqual(plan.nextState, {
    version: 1,
    changesToken: 'token-2',
    records: {
      moved: { recordType: 'Steps', dates: ['2026-08-25', '2026-08-26'] },
    },
  });
});


test('expired change tokens preserve the last trusted state and require repair', () => {
  const state = {
    version: 1,
    changesToken: 'expired-token',
    records: {
      existing: { recordType: 'Weight', dates: ['2026-08-20'] },
    },
  };
  const plan = planHealthConnectChangePage(state, {
    upsertionChanges: [{
      record: {
        recordType: 'Weight',
        time: '2026-08-26T07:30:00-04:00',
        metadata: { id: 'new-weight' },
      },
    }],
    deletionChanges: [{ recordId: 'existing' }],
    nextChangesToken: 'untrusted-token',
    changesTokenExpired: true,
    hasMore: false,
  });

  assert.equal(plan.requiresRepair, true);
  assert.deepEqual(plan.changedDates, []);
  assert.deepEqual(plan.deletedWeightRecordIds, []);
  assert.deepEqual(plan.nextState, state);
});


test('durable state parser rejects corrupt or incompatible cursor state', () => {
  const valid = JSON.stringify({
    version: 1,
    changesToken: 'token-1',
    records: {
      weight: { recordType: 'Weight', dates: ['2026-08-26'] },
    },
  });

  assert.deepEqual(parseHealthConnectSyncState(valid), JSON.parse(valid));
  assert.equal(parseHealthConnectSyncState(null), null);
  assert.equal(parseHealthConnectSyncState('{bad json'), null);
  assert.equal(parseHealthConnectSyncState(JSON.stringify({
    version: 2,
    changesToken: 'token-1',
    records: {},
  })), null);
  assert.equal(parseHealthConnectSyncState(JSON.stringify({
    version: 1,
    changesToken: '',
    records: {},
  })), null);
  assert.equal(parseHealthConnectSyncState(JSON.stringify({
    version: 1,
    changesToken: 'token-1',
    records: { broken: { recordType: '', dates: ['not-a-date'] } },
  })), null);
});


test('persisted corrupt state requires repair instead of silent bootstrap', () => {
  assert.equal(loadHealthConnectSyncState(null), null);
  assert.throws(
    () => loadHealthConnectSyncState('{"version":1,"changesToken":"broken"}'),
    HealthConnectRepairRequiredError,
  );
});


test('failed server reconciliation never advances the durable change token', async () => {
  const saved = [];
  const initialState = {
    version: 1,
    changesToken: 'token-1',
    records: {},
  };

  await assert.rejects(
    reconcileHealthConnectChangePages({
      initialState,
      fetchPage: async () => ({
        upsertionChanges: [{
          record: {
            recordType: 'Steps',
            startTime: '2026-08-26T08:00:00-04:00',
            endTime: '2026-08-26T09:00:00-04:00',
            metadata: { id: 'steps-1' },
          },
        }],
        deletionChanges: [],
        nextChangesToken: 'token-2',
        changesTokenExpired: false,
        hasMore: false,
      }),
      reconcileDates: async () => {
        throw new Error('server unavailable');
      },
      deleteWeightRecords: async () => {},
      saveState: async state => saved.push(state),
    }),
    /server unavailable/,
  );

  assert.deepEqual(saved, []);
});


test('successful pages apply remote effects before saving each page token', async () => {
  const events = [];
  const pages = {
    'token-1': {
      upsertionChanges: [],
      deletionChanges: [{ recordId: 'weight-1' }],
      nextChangesToken: 'token-2',
      changesTokenExpired: false,
      hasMore: true,
    },
    'token-2': {
      upsertionChanges: [{
        record: {
          recordType: 'Steps',
          startTime: '2026-08-26T08:00:00-04:00',
          endTime: '2026-08-26T09:00:00-04:00',
          metadata: { id: 'steps-1' },
        },
      }],
      deletionChanges: [],
      nextChangesToken: 'token-3',
      changesTokenExpired: false,
      hasMore: false,
    },
  };

  const result = await reconcileHealthConnectChangePages({
    initialState: {
      version: 1,
      changesToken: 'token-1',
      records: {
        'weight-1': { recordType: 'Weight', dates: ['2026-08-23'] },
      },
    },
    fetchPage: async token => {
      events.push(`fetch:${token}`);
      return pages[token];
    },
    deleteWeightRecords: async ids => events.push(`delete:${ids.join(',')}`),
    reconcileDates: async dates => events.push(`reconcile:${dates.join(',')}`),
    saveState: async state => events.push(`save:${state.changesToken}`),
  });

  assert.deepEqual(events, [
    'fetch:token-1',
    'delete:weight-1',
    'reconcile:2026-08-23',
    'save:token-2',
    'fetch:token-2',
    'reconcile:2026-08-26',
    'save:token-3',
  ]);
  assert.equal(result.pages, 2);
  assert.equal(result.reconciledDates, 2);
  assert.equal(result.deletedWeightRecords, 1);
  assert.equal(result.state.changesToken, 'token-3');
});


test('unknown tombstones require repair without saving an untrusted token', async () => {
  const events = [];

  await assert.rejects(
    reconcileHealthConnectChangePages({
      initialState: {
        version: 1,
        changesToken: 'token-1',
        records: {},
      },
      fetchPage: async () => ({
        upsertionChanges: [],
        deletionChanges: [{ recordId: 'unknown-record' }],
        nextChangesToken: 'token-2',
        changesTokenExpired: false,
        hasMore: false,
      }),
      deleteWeightRecords: async () => events.push('delete'),
      reconcileDates: async () => events.push('reconcile'),
      saveState: async () => events.push('save'),
    }),
    error => error instanceof HealthConnectRepairRequiredError,
  );

  assert.deepEqual(events, []);
});


test('change reconciliation stops after the page safety limit', async () => {
  let fetches = 0;
  let saves = 0;

  await assert.rejects(
    reconcileHealthConnectChangePages({
      initialState: { version: 1, changesToken: 'token-0', records: {} },
      fetchPage: async () => {
        fetches += 1;
        return {
          upsertionChanges: [],
          deletionChanges: [],
          nextChangesToken: `token-${fetches}`,
          changesTokenExpired: false,
          hasMore: fetches <= 1_000,
        };
      },
      deleteWeightRecords: async () => {},
      reconcileDates: async () => {},
      saveState: async () => { saves += 1; },
    }),
    /page safety limit/,
  );

  assert.equal(fetches, 1_000);
  assert.equal(saves, 1_000);
});


test('bootstrap mints its token before baseline reconciliation and saves last', async () => {
  const events = [];
  let savedState = null;

  const result = await bootstrapHealthConnectChangeSync({
    fetchInitialPage: async () => {
      events.push('mint');
      return {
        upsertionChanges: [{
          record: {
            recordType: 'Steps',
            startTime: '2026-08-26T08:00:00-04:00',
            endTime: '2026-08-26T09:00:00-04:00',
            metadata: { id: 'steps-1' },
          },
        }],
        deletionChanges: [],
        nextChangesToken: 'token-1',
        changesTokenExpired: false,
        hasMore: false,
      };
    },
    reconcileBaseline: async () => {
      events.push('baseline');
      return {
        'weight-1': { recordType: 'Weight', dates: ['2026-08-25'] },
      };
    },
    deleteWeightRecords: async ids => events.push(`delete:${ids.join(',')}`),
    reconcileDates: async dates => events.push(`reconcile:${dates.join(',')}`),
    saveState: async state => {
      events.push(`save:${state.changesToken}`);
      savedState = state;
    },
  });

  assert.deepEqual(events, [
    'mint',
    'baseline',
    'reconcile:2026-08-26',
    'save:token-1',
  ]);
  assert.equal(result.pages, 1);
  assert.deepEqual(savedState.records, {
    'weight-1': { recordType: 'Weight', dates: ['2026-08-25'] },
    'steps-1': { recordType: 'Steps', dates: ['2026-08-26'] },
  });
});


test('authoritative repair baseline consumes a concurrent unknown tombstone', async () => {
  const events = [];

  const result = await bootstrapHealthConnectChangeSync({
    fetchInitialPage: async () => ({
      upsertionChanges: [],
      deletionChanges: [{ recordId: 'deleted-during-repair' }],
      nextChangesToken: 'token-after-repair',
      changesTokenExpired: false,
      hasMore: false,
    }),
    reconcileBaseline: async () => {
      events.push('baseline');
      return {};
    },
    allowUnknownTombstonesAfterBaseline: true,
    deleteWeightRecords: async () => events.push('delete'),
    reconcileDates: async () => events.push('reconcile'),
    saveState: async state => events.push(`save:${state.changesToken}`),
  });

  assert.deepEqual(events, ['baseline', 'save:token-after-repair']);
  assert.equal(result.state.changesToken, 'token-after-repair');
});


test('baseline record indexing deduplicates overlapping record reads', () => {
  const index = indexHealthConnectRecords([
    {
      recordType: 'SleepSession',
      startTime: '2026-08-25T22:30:00-04:00',
      endTime: '2026-08-26T06:30:00-04:00',
      metadata: { id: 'sleep-1' },
    },
    {
      recordType: 'SleepSession',
      startTime: '2026-08-25T22:30:00-04:00',
      endTime: '2026-08-26T06:30:00-04:00',
      metadata: { id: 'sleep-1' },
    },
    {
      recordType: 'Weight',
      time: '2026-08-26T07:15:00-04:00',
      metadata: { id: 'weight-1' },
    },
  ]);

  assert.deepEqual(index, {
    'sleep-1': {
      recordType: 'SleepSession',
      dates: ['2026-08-25', '2026-08-26'],
    },
    'weight-1': {
      recordType: 'Weight',
      dates: ['2026-08-26'],
    },
  });
});


test('valid persisted state uses incremental changes without rebootstrap', async () => {
  const events = [];

  const result = await runHealthConnectChangeSync({
    currentState: { version: 1, changesToken: 'token-1', records: {} },
    fetchInitialPage: async () => {
      events.push('mint');
      throw new Error('must not mint');
    },
    reconcileBaseline: async () => {
      events.push('baseline');
      return {};
    },
    fetchPage: async token => {
      events.push(`fetch:${token}`);
      return {
        upsertionChanges: [],
        deletionChanges: [],
        nextChangesToken: 'token-2',
        changesTokenExpired: false,
        hasMore: false,
      };
    },
    deleteWeightRecords: async () => {},
    reconcileDates: async () => {},
    saveState: async state => events.push(`save:${state.changesToken}`),
  });

  assert.deepEqual(events, ['fetch:token-1', 'save:token-2']);
  assert.equal(result.state.changesToken, 'token-2');
});


test('bootstrap continues through additional change pages', async () => {
  const saved = [];
  let fetches = 0;

  const result = await bootstrapHealthConnectChangeSync({
    fetchInitialPage: async () => ({
      upsertionChanges: [],
      deletionChanges: [],
      nextChangesToken: 'token-1',
      changesTokenExpired: false,
      hasMore: true,
    }),
    reconcileBaseline: async () => ({}),
    fetchPage: async token => {
      fetches += 1;
      assert.equal(token, 'token-1');
      return {
        upsertionChanges: [],
        deletionChanges: [],
        nextChangesToken: 'token-2',
        changesTokenExpired: false,
        hasMore: false,
      };
    },
    reconcileDates: async () => {},
    deleteWeightRecords: async () => {},
    saveState: async state => saved.push(state.changesToken),
  });

  assert.equal(fetches, 1);
  assert.deepEqual(saved, ['token-1', 'token-2']);
  assert.equal(result.pages, 2);
  assert.equal(result.state.changesToken, 'token-2');
});


test('forced repair ignores the persisted token and bootstraps a replacement state', async () => {
  const events = [];

  const result = await runHealthConnectChangeSync({
    currentState: { version: 1, changesToken: 'expired-token', records: {} },
    forceBootstrap: true,
    fetchInitialPage: async () => {
      events.push('mint');
      return {
        upsertionChanges: [],
        deletionChanges: [],
        nextChangesToken: 'fresh-token',
        changesTokenExpired: false,
        hasMore: false,
      };
    },
    reconcileBaseline: async () => {
      events.push('repair');
      return {};
    },
    fetchPage: async token => {
      events.push(`stale:${token}`);
      throw new Error('must not read the expired token');
    },
    reconcileDates: async () => {},
    deleteWeightRecords: async () => {},
    saveState: async state => events.push(`save:${state.changesToken}`),
  });

  assert.deepEqual(events, ['mint', 'repair', 'save:fresh-token']);
  assert.equal(result.state.changesToken, 'fresh-token');
});


test('weight repair payload retains only Health Connect weight identities', () => {
  assert.deepEqual(buildHealthConnectWeightReconcilePayload(
    {
      'weight-2': { recordType: 'Weight', dates: ['2026-08-22'] },
      'steps-1': { recordType: 'Steps', dates: ['2026-08-21'] },
      'weight-1': { recordType: 'Weight', dates: ['2026-08-21'] },
    },
    '2026-08-21T04:00:00.000Z',
    '2026-08-23T04:00:00.000Z',
    2,
  ), {
    startTime: '2026-08-21T04:00:00.000Z',
    endTime: '2026-08-23T04:00:00.000Z',
    observedRecordCount: 2,
    sourceRecordIds: [
      'health-connect:weight:weight-1',
      'health-connect:weight:weight-2',
    ],
  });
});


test('raw weight baselines are indexed with the Weight discriminator', () => {
  const index = indexHealthConnectWeightRecords([{
    metadata: { id: 'renpho-weight-1' },
    time: '2026-08-26T07:00:00-04:00',
  }]);

  assert.deepEqual(index, {
    'renpho-weight-1': {
      recordType: 'Weight',
      dates: ['2026-08-26'],
    },
  });
  assert.deepEqual(buildHealthConnectWeightReconcilePayload(
    index,
    '2026-08-26T04:00:00.000Z',
    '2026-08-27T04:00:00.000Z',
    1,
  ).sourceRecordIds, ['health-connect:weight:renpho-weight-1']);
});


test('read-record baselines are stamped and survive a durable state round trip', () => {
  const records = stampHealthConnectRecordType('Weight', [{
    metadata: { id: 'renpho-weight-1' },
    time: '2026-08-26T07:00:00-04:00',
  }]);
  const state = {
    version: 1,
    changesToken: 'token-1',
    records: indexHealthConnectRecords(records),
  };

  assert.deepEqual(parseHealthConnectSyncState(JSON.stringify(state)), state);
});


test('an observed weight without an id cannot authorize destructive reconciliation', () => {
  const identified = {
    metadata: { id: 'renpho-weight-1' },
    time: '2026-08-26T07:00:00-04:00',
  };
  const prepared = prepareHealthConnectWeightReconciliation(
    [identified, {
      metadata: {},
      time: '2026-08-26T07:01:00-04:00',
    }],
    '2026-08-26T04:00:00.000Z',
    '2026-08-27T04:00:00.000Z',
  );

  assert.deepEqual(prepared.records, [identified]);
  assert.deepEqual(prepared.payload, {
    startTime: '2026-08-26T04:00:00.000Z',
    endTime: '2026-08-27T04:00:00.000Z',
    observedRecordCount: 2,
    sourceRecordIds: ['health-connect:weight:renpho-weight-1'],
  });
});


test('repair-required foreground sync retries once with a bounded authoritative repair', async () => {
  const calls = [];
  const result = await healthConnectChangeSync.runHealthConnectRepairFallback(
    { repairIfRequired: true, days: 2 },
    async options => {
      calls.push(options);
      if (calls.length === 1) throw new HealthConnectRepairRequiredError();
      return 'repaired';
    },
  );

  assert.equal(result, 'repaired');
  assert.deepEqual(calls, [
    { repairIfRequired: true, days: 2 },
    { repairIfRequired: false, repair: true, days: 90 },
  ]);
});


test('serial task runner queues repair behind an active automatic sync', async () => {
  const events = [];
  let releaseAutomatic;
  const automaticGate = new Promise(resolve => { releaseAutomatic = resolve; });
  const runSerially = createSerialTaskRunner(async name => {
    events.push(`start:${name}`);
    if (name === 'automatic') await automaticGate;
    events.push(`finish:${name}`);
    return name;
  });

  const automatic = runSerially('automatic');
  await Promise.resolve();
  const repair = runSerially('repair');
  await Promise.resolve();

  assert.deepEqual(events, ['start:automatic']);
  releaseAutomatic();
  assert.deepEqual(await Promise.all([automatic, repair]), ['automatic', 'repair']);
  assert.deepEqual(events, [
    'start:automatic',
    'finish:automatic',
    'start:repair',
    'finish:repair',
  ]);
});
