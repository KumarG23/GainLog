import type { CoachInsight, WorkoutSession } from '../types/workout';

export interface WorkoutInsightResponse {
  insight: string;
  coachInsight: CoachInsight;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function persistedInsight(session: WorkoutSession): WorkoutInsightResponse | null {
  if (!session.insight || !session.coachInsight) return null;
  return {
    insight: session.insight,
    coachInsight: session.coachInsight,
  };
}

async function reconcilePersistedInsight(
  sessionUrl: string,
  fetchImpl: FetchLike,
): Promise<WorkoutInsightResponse | null> {
  try {
    const response = await fetchImpl(sessionUrl);
    if (!response.ok) return null;
    return persistedInsight(await response.json() as WorkoutSession);
  } catch {
    return null;
  }
}

export async function requestWorkoutInsight(
  apiUrl: string,
  sessionId: string,
  fetchImpl: FetchLike = fetch,
): Promise<WorkoutInsightResponse> {
  const sessionUrl = `${apiUrl}/workouts/${encodeURIComponent(sessionId)}`;
  let response: Response;

  try {
    response = await fetchImpl(`${sessionUrl}/insight`, { method: 'POST' });
  } catch (postError) {
    const recovered = await reconcilePersistedInsight(sessionUrl, fetchImpl);
    if (recovered) return recovered;
    throw postError;
  }

  if (!response.ok) {
    throw new Error(`insight request failed (${response.status})`);
  }

  try {
    return await response.json() as WorkoutInsightResponse;
  } catch (responseError) {
    const recovered = await reconcilePersistedInsight(sessionUrl, fetchImpl);
    if (recovered) return recovered;
    throw responseError;
  }
}
