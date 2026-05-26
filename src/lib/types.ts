/** Parallel-array time series. UTC throughout. */
export interface TimeSeries {
  time: Date[];
  values: number[];
}

/** Return-period thresholds in m³/s, keyed by RP year (2, 5, 10, 25, 50, 100). */
export type RpThresholds = Record<number, number>;

/** All forecast values that fall in a specific lead-day bucket, pooled across start dates. */
export interface LeadBucket {
  /** Timestamps for each row; may contain duplicates from different start dates. */
  time: Date[];
  /** Shape: [T rows][51 members]. */
  members: number[][];
}

export type LeadBuckets = Record<number, LeadBucket>;

export const RP_LEVELS = [2, 5, 10, 25, 50, 100] as const;
