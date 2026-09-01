import type { TimeSeries } from '../types';

const DAY_MS = 24 * 3600 * 1000;

/** Day of year, 0-based. */
export function dayOfYear(d: Date): number {
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor((day - yearStart) / DAY_MS);
}

/**
 * Calendar days within ±`windowDays` of any day the event covers.
 *
 * Shared by both climatological references in this app, which is the point. CRPS
 * restricted its reference by season and argued why in its own docblock; RPS
 * built its reference from every month of the record and never read a timestamp.
 * The same app therefore made two different claims about what a fair baseline
 * is. Extracting the rule means the two cannot drift again.
 *
 * Why it matters: a whole-record reference is asked to predict a wet-season flood
 * using the dry season's flow distribution, which it will always lose. Skill
 * measured against it partly rewards the forecast for knowing what month it is.
 *
 * 366 slots and modular wrapping, so an event spanning New Year keeps both sides
 * of the boundary and a leap day is never dropped.
 */
export function seasonMask(eventData: TimeSeries, windowDays = 15): boolean[] {
  const inSeason = new Array<boolean>(366).fill(false);
  for (const t of eventData.time) {
    const c = dayOfYear(t);
    for (let k = -windowDays; k <= windowDays; k++) {
      inSeason[(((c + k) % 366) + 366) % 366] = true;
    }
  }
  return inSeason;
}

/** The record's finite values whose calendar day falls in the event's season. */
export function seasonalValues(
  record: TimeSeries,
  eventData: TimeSeries,
  windowDays = 15,
): number[] {
  if (record.time.length === 0 || eventData.time.length === 0) return [];
  const inSeason = seasonMask(eventData, windowDays);
  const out: number[] = [];
  for (let i = 0; i < record.time.length; i++) {
    const v = record.values[i];
    if (!Number.isFinite(v)) continue;
    if (!inSeason[dayOfYear(record.time[i])]) continue;
    out.push(v);
  }
  return out;
}
