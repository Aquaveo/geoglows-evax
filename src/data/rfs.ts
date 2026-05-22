import rfs, {
  type ForecastResult,
  type RetrospectiveResult,
  type ReturnPeriodsResult,
} from 'riverforecastsystem';

export type { ForecastResult, RetrospectiveResult, ReturnPeriodsResult };

export function fetchRetrospective(riverId: number, resolution: 'hourly' | 'daily' | 'monthly' | 'yearly' = 'daily') {
  return rfs.v2.retrospective({ riverId, resolution });
}

export function fetchReturnPeriods(riverId: number) {
  return rfs.v2.returnPeriods({ riverId });
}

/** date as YYYYMMDD (no separators). */
export function fetchForecast(riverId: number, date: string) {
  return rfs.v2.forecast({ riverId, date });
}

/**
 * Fetch forecasts for a list of dates with bounded concurrency.
 * `onProgress` reports completed/total as each finishes.
 */
export async function fetchForecasts(
  riverId: number,
  dates: string[],
  concurrency = 4,
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, ForecastResult>> {
  const results = new Map<string, ForecastResult>();
  let done = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < dates.length) {
      const i = cursor++;
      const date = dates[i];
      try {
        const r = await fetchForecast(riverId, date);
        results.set(date, r);
      } catch (e) {
        console.warn(`forecast fetch failed for ${date}:`, e);
      }
      done++;
      onProgress?.(done, dates.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, dates.length) }, worker));
  return results;
}
