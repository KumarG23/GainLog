export interface HeartRatePoint { time: string; beatsPerMinute: number }

// Platform resolution chooses .native on Android and .web in browsers.
export declare function readCardioHeartRate(start: Date, end: Date): Promise<HeartRatePoint[]>;
