import rfs, {
  type ForecastResult,
  type RetrospectiveResult,
  type ReturnPeriodsResult,
} from 'riverforecastsystem';
import { cacheKey, readCache, writeCache } from './cache';

export type { ForecastResult, RetrospectiveResult, ReturnPeriodsResult };

export async function getAndCacheRetrospective(
  riverId: number,
  resolution: 'hourly' | 'daily' | 'monthly' | 'yearly' = 'daily',
): Promise<RetrospectiveResult> {
  // Resolution is part of the key so hourly/daily/etc. don't collide.
  const key = `${cacheKey({ riverId, type: 'retro' })}_${resolution}`;
  const cached = await readCache<RetrospectiveResult>(key);
  if (cached) return cached;
  const data = await rfs.v2.retrospective({ riverId, resolution });
  await writeCache(key, data);
  return data;
}

export async function getAndCacheReturnPeriods(
  riverId: number,
): Promise<ReturnPeriodsResult> {
  const key = cacheKey({ riverId, type: 'retper' });
  const cached = await readCache<ReturnPeriodsResult>(key);
  if (cached) return cached;
  const data = await rfs.v2.returnPeriods({ riverId });
  await writeCache(key, data);
  return data;
}

/** date as YYYYMMDD (no separators). */
export async function getAndCacheForecast(
  riverId: number,
  date: string,
): Promise<ForecastResult> {
  const key = cacheKey({ riverId, type: 'forecast', date });
  const cached = await readCache<ForecastResult>(key);
  if (cached) return cached;
  const data = await rfs.v2.forecast({ riverId, date });
  await writeCache(key, data);
  return data;
}

/**
 * Fetch forecasts for a list of dates with bounded concurrency.
 * Each date is served from IndexedDB when cached, otherwise fetched and saved.
 * `onProgress` reports completed/total as each finishes.
 *
 * The returned Map iterates in `dates` order, NOT completion order. Downstream
 * code (`reorganizeByLead` → every metric) depends on chronological ordering,
 * and with concurrent workers a cached date resolves while an uncached
 * neighbour is still in flight, so insertion order is otherwise scrambled.
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
        const r = await getAndCacheForecast(riverId, date);
        results.set(date, r);
      } catch (e) {
        console.warn(`forecast fetch failed for ${date}:`, e);
      }
      done++;
      onProgress?.(done, dates.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, dates.length) }, worker));

  // Re-key in `dates` order. Failed fetches were never set, so they drop out.
  const ordered = new Map<string, ForecastResult>();
  for (const date of dates) {
    const r = results.get(date);
    if (r) ordered.set(date, r);
  }
  return ordered;
}
