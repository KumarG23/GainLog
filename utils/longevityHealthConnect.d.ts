export declare function importBloodPressure(): Promise<number>;
export declare function writeBloodPressure(readings: { time: string; systolic: number; diastolic: number; arm: string; position: string }[]): Promise<void>;
