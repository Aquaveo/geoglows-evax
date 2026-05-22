// Ambient types for the `riverforecastsystem` npm package (v0.0.3).
// The package ships no .d.ts, so we type the public surface ourselves.
// Source of truth: https://github.com/river-forecast-system/npmjs-riverforecastsystem/

declare module 'riverforecastsystem' {
  export type Resolution = 'hourly' | 'daily' | 'monthly' | 'yearly';

  export interface RetrospectiveArgs {
    riverId?: number;
    idx?: number;
    resolution?: Resolution;
    baseUrl?: string;
  }
  export interface RetrospectiveResult {
    time: Date[];
    discharge: number[];
  }

  export interface ReturnPeriodsArgs {
    riverId?: number;
    idx?: number;
    baseUrl?: string;
  }
  /** Keys are return-period years (2, 5, 10, 25, 50, 100); values are discharge m³/s. */
  export type ReturnPeriodsResult = Record<number, number>;

  export interface ForecastArgs {
    riverId?: number;
    idx?: number;
    /** Initialization date as YYYYMMDD. */
    date: string;
    baseUrl?: string;
  }
  export interface ForecastStats {
    min: number[];
    p20: number[];
    p25: number[];
    median: number[];
    p75: number[];
    p80: number[];
    max: number[];
    average: number[];
  }
  export interface ForecastResult {
    time: Date[];
    /** Shape: [51 members][nTimesteps]. */
    discharge: number[][];
    stats: ForecastStats;
  }

  export const v2: {
    retrospective(args: RetrospectiveArgs): Promise<RetrospectiveResult>;
    returnPeriods(args: ReturnPeriodsArgs): Promise<ReturnPeriodsResult>;
    forecast(args: ForecastArgs): Promise<ForecastResult>;
  };

  const rfs: { v2: typeof v2 };
  export default rfs;
}
