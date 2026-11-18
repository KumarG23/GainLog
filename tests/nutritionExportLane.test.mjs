import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('meal saves and deletes export through the cursor-versioned sync lane', () => {
  const context = read('../context/HealthContext.tsx');
  assert.doesNotMatch(context, /writeNutritionEntryToHealthConnect|deleteNutritionEntryFromHealthConnect/);
  assert.equal(context.match(/await exportNutritionChangesToHealthConnect\(\);/g)?.length, 2);
});

test('no Health Connect meal write uses a wall-clock version', () => {
  // Date.now() versions (~1.7e12) are lower than cursor versions (9e12 + cursor), so
  // Health Connect silently ignored edits written after an automatic sync.
  const bridge = read('../utils/healthConnectNutritionBridge.native.ts');
  assert.doesNotMatch(bridge, /Date\.now\(\)/);
  const lane = read('../utils/healthConnectNutritionAutoSync.native.ts');
  assert.match(lane, /createSerialTaskRunner/);
  assert.match(lane, /export async function exportNutritionChangesToHealthConnect/);
});
