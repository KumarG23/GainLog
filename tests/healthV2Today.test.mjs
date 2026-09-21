import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import './healthspan.test.mjs';
import { buildTodayFocus, formatConfidence, formatDuration, healthV2Tone, isHealthV2TodayEnabled } from '../utils/healthV2Today.ts';
// Tests must not depend on the flags exported in a developer's build shell.
const savedFlags = [process.env.EXPO_PUBLIC_GAINLOG_V2_TODAY, process.env.EXPO_PUBLIC_GAINLOG_V2_SHELL];
delete process.env.EXPO_PUBLIC_GAINLOG_V2_TODAY;
delete process.env.EXPO_PUBLIC_GAINLOG_V2_SHELL;
after(() => {
  ['EXPO_PUBLIC_GAINLOG_V2_TODAY', 'EXPO_PUBLIC_GAINLOG_V2_SHELL'].forEach((key, i) => {
    if (savedFlags[i] === undefined) delete process.env[key]; else process.env[key] = savedFlags[i];
  });
});
test('V2 Today feature flag is explicit and disabled by default', () => {
  assert.equal(isHealthV2TodayEnabled(undefined), false);
  assert.equal(isHealthV2TodayEnabled('0'), false);
  assert.equal(isHealthV2TodayEnabled('true'), false);
  assert.equal(isHealthV2TodayEnabled('1'), true);
});
test('V2 Today formatting keeps missing data explicit', () => {
  assert.equal(formatDuration(undefined), 'Unavailable');
  assert.equal(formatDuration(468), '7h 48m');
  assert.equal(formatConfidence(0), 'No confidence');
  assert.equal(formatConfidence(0.5), 'Partial confidence');
  assert.equal(formatConfidence(0.9), 'High confidence');
});
test('state tones preserve domain meaning', () => {
  assert.equal(healthV2Tone('recovery', 'high'), 'positive');
  assert.equal(healthV2Tone('sleep', 'high'), 'positive');
  assert.equal(healthV2Tone('load', 'high'), 'caution');
  assert.equal(healthV2Tone('stress', 'high'), 'alert');
  assert.equal(healthV2Tone('recovery', 'unavailable'), 'muted');
});
test('Today focus interprets state without pretending to predict training', () => {
  assert.equal(buildTodayFocus({ recoveryState: 'high', stressState: 'moderate' }), 'Recovery signals are strong this morning. Physiological activation remains a retrospective view, not a readiness command.');
  assert.equal(buildTodayFocus({ recoveryState: 'unavailable', stressState: 'warming_up' }), 'Recovery is unavailable because the required signals are incomplete. Physiological activation is still building a personal baseline.');
});
test('full V2 shell restores the old Health route as weight and goal tools', () => {
  process.env.EXPO_PUBLIC_GAINLOG_V2_SHELL = '1';
  try { assert.equal(isHealthV2TodayEnabled('1'), false); } finally { delete process.env.EXPO_PUBLIC_GAINLOG_V2_SHELL; }
});
