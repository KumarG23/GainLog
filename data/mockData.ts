import { WorkoutSession } from '../types/workout';

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

export const MOCK_SESSIONS: WorkoutSession[] = [
  {
    id: 'mock-session-1',
    date: daysAgo(2),
    durationMinutes: 68,
    avgHeartRate: 144,
    activeCalories: 495,
    notes: 'Felt strong. Hit a PR on bench — 107.5 lbs × 3!',
    exercises: [
      {
        id: 'mock-ex-1-1',
        name: 'Bench Press',
        sets: [
          { id: 'mock-s-1-1-1', weight: 60, reps: 10 },
          { id: 'mock-s-1-1-2', weight: 80, reps: 8 },
          { id: 'mock-s-1-1-3', weight: 100, reps: 5 },
          { id: 'mock-s-1-1-4', weight: 107.5, reps: 3 },
        ],
      },
      {
        id: 'mock-ex-1-2',
        name: 'Incline DB Press',
        sets: [
          { id: 'mock-s-1-2-1', weight: 32, reps: 12 },
          { id: 'mock-s-1-2-2', weight: 36, reps: 10 },
          { id: 'mock-s-1-2-3', weight: 36, reps: 9 },
        ],
      },
      {
        id: 'mock-ex-1-3',
        name: 'Cable Fly',
        sets: [
          { id: 'mock-s-1-3-1', weight: 15, reps: 15 },
          { id: 'mock-s-1-3-2', weight: 15, reps: 15 },
          { id: 'mock-s-1-3-3', weight: 17.5, reps: 12 },
        ],
      },
      {
        id: 'mock-ex-1-4',
        name: 'Tricep Pushdown',
        sets: [
          { id: 'mock-s-1-4-1', weight: 25, reps: 15 },
          { id: 'mock-s-1-4-2', weight: 27.5, reps: 12 },
          { id: 'mock-s-1-4-3', weight: 27.5, reps: 11 },
        ],
      },
    ],
  },
  {
    id: 'mock-session-2',
    date: daysAgo(5),
    durationMinutes: 58,
    avgHeartRate: 151,
    activeCalories: 430,
    exercises: [
      {
        id: 'mock-ex-2-1',
        name: 'Squat',
        sets: [
          { id: 'mock-s-2-1-1', weight: 60, reps: 10 },
          { id: 'mock-s-2-1-2', weight: 100, reps: 5 },
          { id: 'mock-s-2-1-3', weight: 122.5, reps: 5 },
          { id: 'mock-s-2-1-4', weight: 122.5, reps: 5 },
          { id: 'mock-s-2-1-5', weight: 122.5, reps: 4 },
        ],
      },
      {
        id: 'mock-ex-2-2',
        name: 'Romanian Deadlift',
        sets: [
          { id: 'mock-s-2-2-1', weight: 80, reps: 10 },
          { id: 'mock-s-2-2-2', weight: 92.5, reps: 8 },
          { id: 'mock-s-2-2-3', weight: 92.5, reps: 8 },
        ],
      },
      {
        id: 'mock-ex-2-3',
        name: 'Leg Press',
        sets: [
          { id: 'mock-s-2-3-1', weight: 160, reps: 15 },
          { id: 'mock-s-2-3-2', weight: 180, reps: 12 },
          { id: 'mock-s-2-3-3', weight: 195, reps: 10 },
        ],
      },
      {
        id: 'mock-ex-2-4',
        name: 'Leg Curl',
        sets: [
          { id: 'mock-s-2-4-1', weight: 40, reps: 12 },
          { id: 'mock-s-2-4-2', weight: 45, reps: 10 },
          { id: 'mock-s-2-4-3', weight: 45, reps: 10 },
        ],
      },
    ],
  },
  {
    id: 'mock-session-3',
    date: daysAgo(8),
    durationMinutes: 74,
    activeCalories: 545,
    notes: 'Pull day. Added Kroc rows at the end. Back was pumped.',
    exercises: [
      {
        id: 'mock-ex-3-1',
        name: 'Deadlift',
        sets: [
          { id: 'mock-s-3-1-1', weight: 100, reps: 5 },
          { id: 'mock-s-3-1-2', weight: 140, reps: 3 },
          { id: 'mock-s-3-1-3', weight: 162.5, reps: 3 },
          { id: 'mock-s-3-1-4', weight: 162.5, reps: 2 },
        ],
      },
      {
        id: 'mock-ex-3-2',
        name: 'Pull-ups',
        sets: [
          { id: 'mock-s-3-2-1', weight: 0, reps: 10 },
          { id: 'mock-s-3-2-2', weight: 0, reps: 9 },
          { id: 'mock-s-3-2-3', weight: 0, reps: 8 },
        ],
      },
      {
        id: 'mock-ex-3-3',
        name: 'Barbell Row',
        sets: [
          { id: 'mock-s-3-3-1', weight: 70, reps: 10 },
          { id: 'mock-s-3-3-2', weight: 82.5, reps: 8 },
          { id: 'mock-s-3-3-3', weight: 82.5, reps: 8 },
          { id: 'mock-s-3-3-4', weight: 82.5, reps: 7 },
        ],
      },
      {
        id: 'mock-ex-3-4',
        name: 'Kroc Rows',
        sets: [
          { id: 'mock-s-3-4-1', weight: 42.5, reps: 20 },
          { id: 'mock-s-3-4-2', weight: 42.5, reps: 17 },
        ],
      },
      {
        id: 'mock-ex-3-5',
        name: 'Face Pull',
        sets: [
          { id: 'mock-s-3-5-1', weight: 17.5, reps: 20 },
          { id: 'mock-s-3-5-2', weight: 17.5, reps: 20 },
          { id: 'mock-s-3-5-3', weight: 20, reps: 15 },
        ],
      },
    ],
  },
];
