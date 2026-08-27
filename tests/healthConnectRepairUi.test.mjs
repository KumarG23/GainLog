import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appConfig = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
const settingsScreen = readFileSync(new URL('../app/settings.tsx', import.meta.url), 'utf8');
const nativeSync = readFileSync(new URL('../utils/healthConnectSync.native.ts', import.meta.url), 'utf8');
const changeSync = readFileSync(new URL('../utils/healthConnectChangeSync.ts', import.meta.url), 'utf8');


test('Android declares Health Connect history access for explicit repair', () => {
  assert.ok(
    appConfig.expo.android.permissions.includes(
      'android.permission.health.READ_HEALTH_DATA_HISTORY',
    ),
  );
});


test('Settings exposes the bounded Health Connect repair action', () => {
  assert.match(settingsScreen, /repairHealthConnect/);
  assert.match(settingsScreen, /Repair imported history/);
  assert.match(settingsScreen, /accessibilityLabel="Repair imported Health Connect history"/);
});


test('repair validates history access through reads instead of the incomplete grant result', () => {
  assert.doesNotMatch(nativeSync, /grantedPermissions/);
});


test('all native Health Connect sync entry points share one serial queue', () => {
  assert.match(
    nativeSync,
    /const runHealthConnectSyncSerially = createSerialTaskRunner\(/,
  );
  assert.match(nativeSync, /return runHealthConnectSyncSerially\(options\)/);
  assert.match(nativeSync, /runHealthConnectRepairFallback/);
  assert.match(changeSync, /error instanceof HealthConnectRepairRequiredError/);
  assert.match(changeSync, /days: 90/);
  assert.match(changeSync, /repairIfRequired: false/);
});


test('initial native bootstrap checks server ownership before minting a token', () => {
  assert.match(
    nativeSync,
    /!options\.repair && rawState === null && healthConnectInitialBootstrapRequiresRepair/,
  );
  assert.match(nativeSync, /throw new HealthConnectRepairRequiredError\(\)/);
});


test('native repair marks its authoritative baseline as tombstone-complete', () => {
  assert.match(
    nativeSync,
    /allowUnknownTombstonesAfterBaseline: options\.repair/,
  );
});
