import { Linking } from 'react-native';
import { API_URL } from '../constants/api';

export interface GoogleHealthStatus {
  connected: boolean;
  configured: boolean;
  lastSuccessAt?: string;
  lastAttemptAt?: string;
  lastError?: string;
  lastSyncCount: number;
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error('Google Health request failed.');
  return response.json() as Promise<T>;
}

export async function getGoogleHealthStatus(): Promise<GoogleHealthStatus> {
  return readJson<GoogleHealthStatus>(await fetch(`${API_URL}/integrations/google-health/status`));
}

export async function beginGoogleHealthConnection(): Promise<void> {
  await Linking.openURL(`${API_URL}/integrations/google-health/oauth/start`);
}

export interface GoogleHealthSyncResult {
  syncedDays: number;
  startDate: string;
  endDate: string;
}

export async function syncGoogleHealth(): Promise<GoogleHealthSyncResult> {
  const response = await fetch(`${API_URL}/integrations/google-health/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  return readJson<GoogleHealthSyncResult>(response);
}

export async function disconnectGoogleHealth(): Promise<void> {
  const response = await fetch(`${API_URL}/integrations/google-health/connection`, { method: 'DELETE' });
  if (!response.ok && response.status !== 204) throw new Error('Google Health disconnect failed.');
}
