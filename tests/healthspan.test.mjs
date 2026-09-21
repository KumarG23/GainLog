import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { compareCompleteDays, daysEnding, durationLabel, entryDay, finite, goalLabel, greeting, healthObservations, isHealthspanUIEnabled, nutritionOnDay, progressFraction, shiftDay, sparklineGeometry, trainingWeek, validTodayPayload } from '../utils/healthspan.ts';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('UI is explicitly enabled and independent of the old one-tab rollout', () => {
  for (const value of [undefined, '0', 'true', '']) assert.equal(isHealthspanUIEnabled(value), false);
  assert.equal(isHealthspanUIEnabled('1'), true);
  assert.match(source('../utils/healthV2Today.ts'), /EXPO_PUBLIC_GAINLOG_V2_UI !== '1'/);
});
test('formatting does not confuse missing, observed zero, or 60-minute rollover', () => {
  assert.equal(finite(null), false); assert.equal(finite(0), true); assert.equal(finite(NaN), false);
  assert.equal(durationLabel(119.9), '2h 0m'); assert.equal(durationLabel(null), '—'); assert.equal(durationLabel(0), '0h 0m');
  assert.equal(greeting(18), 'Good evening'); assert.equal(greeting(13), 'Good afternoon');
});
test('civil dates handle month and DST boundaries without subtracting milliseconds', () => {
  assert.equal(shiftDay('2026-03-09', -1), '2026-03-08');
  assert.equal(shiftDay('2026-01-01', -1), '2025-12-31');
  assert.equal(entryDay('2026-09-21T02:00:00Z'), '2026-09-20');
});
test('trend comparison excludes today, deduplicates dates and preserves observed zero', () => {
  const points = daysEnding('2026-04-19', 35).map(date => ({ date, value: 10, source: 'one' }));
  points.push({ date: '2026-04-20', value: 999 }, { date: '2026-04-19', value: 0, source: 'one' });
  const window = compareCompleteDays(points, '2026-04-20');
  assert.equal(window.observed, 7); assert.equal(window.baselineObserved, 28);
  assert.equal(window.recent, 60 / 7); assert.equal(window.baseline, 10);
  assert.equal(window.points.length, 28);
});
test('sparse windows and source transitions withhold comparative direction', () => {
  assert.equal(compareCompleteDays([{ date: '2026-04-19', value: 10 }], '2026-04-20').delta, null);
  const points = daysEnding('2026-04-19', 35).map((date, i) => ({ date, value: 10, source: i < 28 ? 'a' : 'b' }));
  assert.equal(compareCompleteDays(points, '2026-04-20').mixedSources, true);
  assert.equal(compareCompleteDays(points, '2026-04-20').delta, null);
});
test('sparklines break rather than bridge unobserved days', () => {
  const chart = sparklineGeometry([{ date: '2026-04-17', value: 0 }, { date: '2026-04-19', value: 20 }], '2026-04-19', 3);
  assert.equal((chart.path.match(/M/g) ?? []).length, 2); assert.equal(chart.path.includes('L'), false);
  assert.equal(chart.dots.length, 2);
});
test('nutrition is deduplicated and absent entries are explicit', () => {
  const meal = { id: 'synthetic-meal', date: '2026-04-19T12:00:00-04:00', calories: 400, proteinG: 25, carbsG: 30, fatG: 10, fiberG: 5 };
  assert.equal(nutritionOnDay([meal, meal], '2026-04-19').totals.calories, 400);
  assert.equal(nutritionOnDay([], '2026-04-19').rows.length, 0);
  assert.equal(progressFraction(100), null);
  assert.equal(progressFraction(30, { minimumValue: 20, maximumValue: 40 }), 1);
  assert.equal(goalLabel({ minimumValue: 20, maximumValue: 40, unit: 'g' }), '20–40 g');
});
test('training week excludes future sessions and distinguishes future dates', () => {
  const sessions = [{ id: 'past', date: '2026-04-13', durationMinutes: 30 }, { id: 'future', date: '2026-04-18', durationMinutes: 60 }];
  const week = trainingWeek(sessions, '2026-04-15');
  assert.equal(week.start, '2026-04-13'); assert.equal(week.rows.length, 1); assert.equal(week.minutes, 30);
  assert.equal(week.days.filter(day => day.future).length, 4);
});
test('Today rejects malformed payloads and never accepts another date', () => {
  const domain = { score: null, state: 'unavailable', confidence: 0, components: {} };
  const data = { date: '2026-04-20', version: 'test', provenance: 'synthetic', recovery: domain, sleep: domain, load: { ...domain, loadPoints: null }, stress: { ...domain, baselineReady: false, baselineDays: 0, expectedMinutes: 600, observedHeartRateMinutes: 0, scoredMinutes: 0, segments: [] } };
  assert.equal(validTodayPayload(data, '2026-04-20'), true);
  assert.equal(validTodayPayload(data, '2026-04-21'), false);
  assert.equal(validTodayPayload({ ...data, recovery: { ...domain, score: 101 } }, data.date), false);
  assert.equal(validTodayPayload({ ...data, sleep: { ...domain, components: { duration: null } } }, data.date), false);
  assert.equal(validTodayPayload({ ...data, stress: { ...data.stress, segments: [{ startMinute: -1, state: 'low', score: 1, confidence: 1 }] } }, data.date), false);
});
test('five-tab shell preserves editors, never makes Today the workout editor', () => {
  const layout = source('../app/(tabs)/_layout.tsx');
  for (const name of ['index', 'healthspan', 'train', 'fuel', 'progress', 'workout', 'nutrition', 'health', 'history', 'stats']) assert.match(layout, new RegExp(`name="${name}"`));
  assert.match(source('../app/(tabs)/index.tsx'), /isHealthspanUIEnabled\(\) \? <TodayScreen \/> : <WorkoutScreen \/>/);
  assert.match(source('../app/(tabs)/workout.tsx'), /Today's workout/);
  assert.match(source('../components/healthspan/UI.tsx'), /BUILD YOUR HEALTHSPAN/);
});
test('stress is contextual, explicitly non-live, with a full-day time axis', () => {
  const stress = source('../components/healthspan/StressTimeline.tsx');
  assert.match(stress, /Retrospective physiological activation/);
  assert.match(stress, /not a live reading/);
  assert.match(stress, /'00:00', '06:00', '12:00', '18:00', '24:00'/);
  assert.match(stress, /baseline_unavailable/); assert.match(stress, /context_unavailable/);
});

test('a corrected missing metric does not resurrect an older same-day value', () => {
  const rows = [{ date: '2026-04-19', updatedAt: '2026-04-19T10:00:00Z', hrvMs: 25 }, { date: '2026-04-19', updatedAt: '2026-04-19T11:00:00Z', hrvMs: null }];
  assert.deepEqual(healthObservations(rows, 'hrvMs'), []);
});

test('native preview config preserves identifiers and keeps old icons when disabled', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const configure = require('../app.config.js');
  const base = JSON.parse(source('../app.json')).expo;
  const previous = process.env.EXPO_PUBLIC_GAINLOG_V2_UI;
  try {
    delete process.env.EXPO_PUBLIC_GAINLOG_V2_UI;
    assert.equal(configure({ config: base }), base);
    process.env.EXPO_PUBLIC_GAINLOG_V2_UI = '1';
    const v2 = configure({ config: base });
    assert.equal(v2.android.package, base.android.package);
    assert.deepEqual(v2.android.permissions, base.android.permissions);
    assert.equal(v2.ios.bundleIdentifier, base.ios.bundleIdentifier);
    assert.equal(v2.android.versionCode, base.android.versionCode);
    assert.match(v2.icon, /baseline-icon/);
    for (const name of ['baseline-icon', 'baseline-foreground', 'baseline-monochrome']) {
      const png = readFileSync(new URL(`../assets/images/${name}.png`, import.meta.url));
      assert.equal(png.readUInt32BE(16), 1024); assert.equal(png.readUInt32BE(20), 1024);
    }
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_GAINLOG_V2_UI; else process.env.EXPO_PUBLIC_GAINLOG_V2_UI = previous;
  }
});

test('brand rasterizer is deterministic and exports transparent adaptive assets', async () => {
  const { createRequire } = await import('node:module');
  const { inflateSync } = await import('node:zlib');
  const { renderIcon } = createRequire(import.meta.url)('../scripts/brand-assets.cjs');
  const bytes = renderIcon(64, 'foreground');
  assert.deepEqual(bytes, renderIcon(64, 'foreground'));
  assert.equal(bytes.readUInt32BE(16), 64);
  let offset = 8, compressed;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.subarray(offset + 4, offset + 8).toString() === 'IDAT') compressed = bytes.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
  }
  const pixels = inflateSync(compressed);
  assert.equal(pixels[4], 0); // Top-left alpha: transparent outside the glyph.
  assert.throws(() => renderIcon(0));
});
