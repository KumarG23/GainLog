import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appConfig = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
const healthScreen = readFileSync(new URL('../app/(tabs)/health.tsx', import.meta.url), 'utf8');
const nativeSync = readFileSync(new URL('../utils/healthConnectSync.native.ts', import.meta.url), 'utf8');


test('Android declares Health Connect history access for explicit repair', () => {
  assert.ok(
    appConfig.expo.android.permissions.includes(
      'android.permission.health.READ_HEALTH_DATA_HISTORY',
    ),
  );
});


test('Health screen exposes the bounded Health Connect repair action', () => {
  assert.match(healthScreen, /repairHealthConnect/);
  assert.match(healthScreen, /Repair imported history/);
  assert.match(healthScreen, /accessibilityLabel="Repair imported Health Connect history"/);
});


test('repair validates history access through reads instead of the incomplete grant result', () => {
  assert.doesNotMatch(nativeSync, /grantedPermissions/);
});


test('all native Health Connect sync entry points share one serial queue', () => {
  assert.match(
    nativeSync,
    /createSerialTaskRunner\(syncHealthConnectUnsafe\)/,
  );
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
