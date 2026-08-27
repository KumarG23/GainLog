import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const theme = source('../constants/theme.ts');
const log = source('../app/(tabs)/index.tsx');
const history = source('../app/(tabs)/history.tsx');
const stats = source('../app/(tabs)/stats.tsx');
const health = source('../app/(tabs)/health.tsx');
const trends = source('../app/trends.tsx');
const settings = source('../app/settings.tsx');
const session = source('../app/session/[id].tsx');

test('visual system raises muted-text contrast and exposes subtle surface tokens', () => {
  assert.match(theme, /textMuted: '#8E8E93'/);
  assert.match(theme, /surfaceRaised:/);
  assert.match(theme, /borderSubtle:/);
});

test('Log gives the suggested template a distinct today treatment', () => {
  assert.match(log, /Today's workout/);
  assert.match(log, /suggested && styles\.planCardSuggested/);
  assert.match(log, /planScrollRef/);
  assert.match(log, /scrollTo\(\{ x:/);
});

test('Stats features the top three exercises and compacts the remaining list', () => {
  assert.match(stats, /CompactStatRow/);
  assert.match(stats, /index < 3/);
});

test('Health separates daily, coaching, and management hierarchy', () => {
  assert.match(health, /Daily dashboard/);
  assert.match(health, /Coaching & reviews/);
  assert.match(health, /Tracking & goals/);
});

test('Settings prioritizes sync and discloses recovery actions separately', () => {
  assert.match(settings, /formatSyncTimestamp/);
  assert.match(settings, /showRecoveryTools/);
  assert.match(settings, /Recovery tools/);
  assert.match(settings, /accessibilityState=\{\{ expanded: showRecoveryTools \}\}/);
  assert.match(settings, /aria-expanded=\{showRecoveryTools\}/);
  assert.match(settings, /destructiveButton/);
  assert.match(settings, /Platform\.OS !== 'android' && styles\.buttonDisabled/);
  assert.match(settings, /Platform\.OS !== 'android' && styles\.platformUnavailableButton/);
});

test('Trends emphasizes the primary summary without adding another control row', () => {
  assert.match(trends, /summaryCardEmphasis/);
});

test('History presents session metrics as a deliberate grid', () => {
  assert.match(history, /cardStatsGrid/);
});

test('Session deletion is accessible but visually quiet', () => {
  assert.match(session, /accessibilityLabel="Delete workout session"/);
  assert.match(session, /style=\{styles\.deleteButton\}/);
  assert.match(session, /deleteButton:\s*\{[\s\S]*?width: 44,[\s\S]*?height: 44,/);
  assert.match(session, /name="trash-outline" size=\{18\} color=\{Colors\.textMuted\}/);
});
