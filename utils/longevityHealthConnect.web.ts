export async function hasBloodPressureReadAccess(): Promise<boolean> { return false; }
export async function syncRecentBloodPressure(): Promise<number> { return 0; }
export async function importBloodPressure(): Promise<number> { throw new Error('Health Connect is available on Android only.'); }
export async function writeBloodPressure(): Promise<void> { throw new Error('Health Connect is available on Android only.'); }
