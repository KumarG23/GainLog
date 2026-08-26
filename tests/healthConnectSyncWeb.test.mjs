import test from 'node:test';
import assert from 'node:assert/strict';

import { repairHealthConnect } from '../utils/healthConnectSync.web.ts';


test('Health Connect repair fails safely outside Android', async () => {
  await assert.rejects(
    repairHealthConnect(),
    /available only in the Android GainLog app/,
  );
});
