import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const readSource = path => existsSync(new URL(path, import.meta.url))
  ? readFileSync(new URL(path, import.meta.url), 'utf8')
  : '';
const rootLayout = readSource('../app/_layout.tsx');
const tabLayout = readSource('../app/(tabs)/_layout.tsx');
const healthScreen = readSource('../app/(tabs)/health.tsx');
const nutritionScreen = readSource('../app/(tabs)/nutrition.tsx');
const settingsScreen = readSource('../app/settings.tsx');
const coordinator = readSource('../components/HealthConnectSyncCoordinator.native.tsx');
const nativeSync = readSource('../utils/healthConnectSync.native.ts');
const changeSync = readSource('../utils/healthConnectChangeSync.ts');


test('Health header exposes an accessible Settings gear backed by a stack route', () => {
  assert.match(tabLayout, /settings-outline/);
  assert.match(tabLayout, /accessibilityLabel="Open settings"/);
  assert.match(tabLayout, /router\.push\('\/settings'/);
  assert.match(rootLayout, /name="settings"/);
});


test('manual integration maintenance lives in Settings instead of dashboard screens', () => {
  assert.match(settingsScreen, /Google Health/);
  assert.match(settingsScreen, /Sync Google Health now/);
  assert.match(settingsScreen, /Health Connect/);
  assert.match(settingsScreen, /Sync Health Connect now/);
  assert.match(settingsScreen, /Repair imported Health Connect history/);
  assert.match(settingsScreen, /Repair all GainLog nutrition in Health Connect/);

  assert.doesNotMatch(healthScreen, /Sync Health Connect now/);
  assert.doesNotMatch(healthScreen, /Sync Google Health now/);
  assert.doesNotMatch(nutritionScreen, /Repair all GainLog nutrition in Health Connect/);
});


test('foreground Health Connect checks force freshness and auto-repair only repair-required cursors', () => {
  assert.match(coordinator, /performAutoSync\(\{ requestPermissions: true, force: true \}\)/);
  assert.match(coordinator, /repairIfRequired: requestPermissions/);
  assert.match(nativeSync, /runHealthConnectRepairFallback/);
  assert.match(changeSync, /options\.repairIfRequired/);
  assert.match(changeSync, /error instanceof HealthConnectRepairRequiredError/);
  assert.match(changeSync, /repair: true/);
});
