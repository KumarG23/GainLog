import assert from 'node:assert/strict';
import test from 'node:test';
import { refreshIndependentDomains } from '../utils/domainRefresh.ts';

test('one failed refresh domain does not discard successful domain data', async () => {
  const applied = [], errors = [];
  const aggregate = await refreshIndependentDomains([
    { name: 'nutrition', run: async () => { applied.push(['meal']); }, setError: value => errors.push(['nutrition', value]) },
    { name: 'health', run: async () => { throw new Error('health unavailable'); }, setError: value => errors.push(['health', value]) },
  ]);
  assert.deepEqual(applied, [['meal']]);
  assert.deepEqual(errors, [['nutrition', null], ['health', 'health unavailable']]);
  assert.equal(aggregate, 'health unavailable');
});
