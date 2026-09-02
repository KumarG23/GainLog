import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { requestWorkoutInsight } from '../utils/workoutInsight.ts';

const logScreen = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');

const coachInsight = {
  headline: 'Recovery session complete',
  verdict: 'The easy cardio session matched its recovery purpose.',
  wins: ['Completed 45 minutes at an easy effort.'],
  nextAction: {
    title: 'Follow the next template',
    detail: 'Begin the next strength session conservatively.',
  },
  question: 'How did this feel?',
  confidence: 'high',
};

test('requestWorkoutInsight recovers a persisted coach card after the POST response is lost', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    if (calls.length === 1) {
      throw new TypeError('Network request failed');
    }
    return new Response(JSON.stringify({
      id: 'session-1',
      date: '2026-09-02T07:13:12-04:00',
      durationMinutes: 45,
      exercises: [],
      insight: 'Persisted legacy insight',
      coachInsight,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const result = await requestWorkoutInsight(
    'https://gainlog-api.example',
    'session-1',
    fetchImpl,
  );

  assert.deepEqual(result, {
    insight: 'Persisted legacy insight',
    coachInsight,
  });
  assert.deepEqual(calls, [
    {
      url: 'https://gainlog-api.example/workouts/session-1/insight',
      method: 'POST',
    },
    {
      url: 'https://gainlog-api.example/workouts/session-1',
      method: 'GET',
    },
  ]);
});

test('Log screen uses the reconciled workout-insight request', () => {
  assert.match(logScreen, /import \{ requestWorkoutInsight \} from '\.\.\/\.\.\/utils\/workoutInsight';/);
  assert.match(logScreen, /requestWorkoutInsight\(API_URL, session\.id\)/);
  assert.doesNotMatch(logScreen, /fetch\(`\$\{API_URL\}\/workouts\/\$\{session\.id\}\/insight`/);
});

test('requestWorkoutInsight does not mask an explicit coach HTTP failure with a stale card', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    if (calls.length === 1) {
      return new Response('Coach unavailable', { status: 503 });
    }
    return new Response(JSON.stringify({
      id: 'session-1',
      date: '2026-09-02T07:13:12-04:00',
      durationMinutes: 45,
      exercises: [],
      insight: 'Stale legacy insight',
      coachInsight,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  await assert.rejects(
    requestWorkoutInsight('https://gainlog-api.example', 'session-1', fetchImpl),
    /insight request failed \(503\)/,
  );
  assert.equal(calls.length, 1);
});
