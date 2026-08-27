import assert from 'node:assert/strict';
import test from 'node:test';

import { formatSyncTimestamp } from '../utils/settingsDisplay.ts';

test('sync timestamps render in local human language instead of raw ISO', () => {
  assert.equal(
    formatSyncTimestamp('2026-08-27T16:16:24.706879+00:00', new Date('2026-08-27T13:00:00-04:00')),
    'Today, 12:16 PM',
  );
});

test('invalid sync timestamps fail soft', () => {
  assert.equal(formatSyncTimestamp('not-a-date', new Date('2026-08-27T13:00:00-04:00')), 'Unknown');
});
