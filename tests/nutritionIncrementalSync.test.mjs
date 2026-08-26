import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcileFullNutritionRepair,
  reconcileIncrementalNutrition,
} from '../utils/healthConnectNutrition.ts';

const meal = {
  id: 'meal-1',
  date: '2026-08-26T08:00:00-04:00',
  meal: 'breakfast',
  name: 'Breakfast',
  calories: 432,
  proteinG: 46,
  carbsG: 41,
  fatG: 15,
  fiberG: 23.2,
};

test('first automatic sync bootstraps only the bounded recent window', async () => {
  const calls = [];
  let savedCursor = null;
  const result = await reconcileIncrementalNutrition({
    currentCursor: null,
    today: '2026-08-26',
    fetchBootstrap: async since => {
      calls.push(['bootstrap', since]);
      return { entries: [meal], latestCursor: 7 };
    },
    fetchPage: async () => {
      throw new Error('bootstrap should establish the current high-water cursor');
    },
    applyUpserts: async upserts => calls.push(['upserts', upserts]),
    applyDeletes: async ids => calls.push(['deletes', ids]),
    saveCursor: async cursor => { savedCursor = cursor; },
  });

  assert.equal(savedCursor, 7);
  assert.equal(result.bootstrapped, true);
  assert.equal(result.written, 1);
  assert.equal(result.deleted, 0);
  assert.deepEqual(calls[0], ['bootstrap', '2026-08-20']);
  assert.equal(calls[1][1][0].entry.id, 'meal-1');
  assert.ok(calls[1][1][0].clientRecordVersion > Date.now());
});

test('automatic sync pages through only events newer than the durable cursor', async () => {
  const requested = [];
  const saved = [];
  const written = [];
  const deleted = [];
  const result = await reconcileIncrementalNutrition({
    currentCursor: 7,
    today: '2026-08-26',
    fetchBootstrap: async () => { throw new Error('unexpected bootstrap'); },
    fetchPage: async cursor => {
      requested.push(cursor);
      if (cursor === 7) return {
        events: [{ cursor: 8, operation: 'upsert', entryId: meal.id, entry: meal }],
        nextCursor: 8,
        latestCursor: 9,
        hasMore: true,
      };
      return {
        events: [{ cursor: 9, operation: 'delete', entryId: 'meal-old', entry: null }],
        nextCursor: 9,
        latestCursor: 9,
        hasMore: false,
      };
    },
    applyUpserts: async upserts => written.push(...upserts),
    applyDeletes: async ids => deleted.push(...ids),
    saveCursor: async cursor => saved.push(cursor),
  });

  assert.deepEqual(requested, [7, 8]);
  assert.deepEqual(saved, [8, 9]);
  assert.equal(written.length, 1);
  assert.deepEqual(deleted, ['meal-old']);
  assert.deepEqual(result, { bootstrapped: false, written: 1, deleted: 1, cursor: 9 });
});

test('failed Health Connect writes never advance the durable cursor', async () => {
  const saved = [];
  await assert.rejects(
    reconcileIncrementalNutrition({
      currentCursor: 12,
      today: '2026-08-26',
      fetchBootstrap: async () => { throw new Error('unexpected bootstrap'); },
      fetchPage: async () => ({
        events: [{ cursor: 13, operation: 'upsert', entryId: meal.id, entry: meal }],
        nextCursor: 13,
        latestCursor: 13,
        hasMore: false,
      }),
      applyUpserts: async () => { throw new Error('Health Connect unavailable'); },
      applyDeletes: async () => {},
      saveCursor: async cursor => saved.push(cursor),
    }),
    /Health Connect unavailable/,
  );
  assert.deepEqual(saved, []);
});

test('full repair replays pending tombstones before advancing the cursor', async () => {
  const deleted = [];
  const saved = [];
  const upserts = [];
  const requested = [];
  const result = await reconcileFullNutritionRepair({
    currentCursor: 7,
    today: '2026-08-26',
    fetchBootstrap: async since => {
      assert.equal(since, '0001-01-01');
      return { entries: [meal], latestCursor: 9 };
    },
    fetchPage: async cursor => {
      requested.push(cursor);
      return {
        events: [
          { cursor: 8, operation: 'delete', entryId: 'meal-deleted', entry: null },
          { cursor: 9, operation: 'upsert', entryId: meal.id, entry: meal },
        ],
        nextCursor: 9,
        latestCursor: 9,
        hasMore: false,
      };
    },
    applyUpserts: async values => { upserts.push(values); },
    applyDeletes: async values => { deleted.push(...values); },
    saveCursor: async cursor => { saved.push(cursor); },
  });

  assert.deepEqual(requested, [7]);
  assert.deepEqual(deleted, ['meal-deleted']);
  assert.deepEqual(saved, [9]);
  assert.equal(upserts[0][0].clientRecordVersion, 9_000_000_000_009);
  assert.deepEqual(result, {
    snapshotWritten: 1,
    replayedUpserts: 1,
    deleted: 1,
    cursor: 9,
  });
});
