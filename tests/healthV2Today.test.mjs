import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTodayFocus,
  formatConfidence,
  formatDuration,
  healthV2Tone,
  isHealthV2TodayEnabled,
} from '../utils/healthV2Today.ts';


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
  assert.equal(
    buildTodayFocus({ recoveryState: 'high', stressState: 'moderate' }),
    'Recovery signals are strong this morning. Physiological activation remains a retrospective view, not a readiness command.',
  );
  assert.equal(
    buildTodayFocus({ recoveryState: 'unavailable', stressState: 'warming_up' }),
    'Recovery is unavailable because the required signals are incomplete. Physiological activation is still building a personal baseline.',
  );
});
