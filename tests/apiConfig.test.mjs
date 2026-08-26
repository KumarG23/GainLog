import test from 'node:test';
import assert from 'node:assert/strict';

test('release-safe default API URL uses the production Tailscale HTTPS endpoint', async () => {
  const previousApiUrl = process.env.EXPO_PUBLIC_API_URL;
  delete process.env.EXPO_PUBLIC_API_URL;

  try {
    const { API_URL } = await import('../constants/api.ts?fallback-test');
    assert.equal(API_URL, 'https://gainlog-api.tailc88c35.ts.net');
  } finally {
    if (previousApiUrl === undefined) {
      delete process.env.EXPO_PUBLIC_API_URL;
    } else {
      process.env.EXPO_PUBLIC_API_URL = previousApiUrl;
    }
  }
});
