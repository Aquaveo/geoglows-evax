import { parseStartDate } from './leadBuckets';
import type { TimeSeries } from './types';

const DAY_MS = 24 * 3600 * 1000;

/**
 * Where in a run's horizon we want the observed crest to land, in days.
 *
 * Not 0, and not the far end. A run initialized on the crest shows it at the very
 * left edge with nothing leading up to it; a run that only just reaches it shows
 * it at the right edge with the rise cut off. A few days in puts the rise, the
 * crest and some recession all on screen, and keeps the run recent enough to
 * carry real skill.
 */
const TARGET_LEAD_DAYS = 5;

/**
 * Which forecast initialization to open the Forecast tab on.
 *
 * Runs are fetched from `eventStart − INIT_LOOKBACK_DAYS` through `eventEnd`, so
 * the two obvious defaults are both wrong: the newest run is initialized on the
 * event's last day and its whole horizon lies AFTER the event, and the oldest
 * reaches the event only at the very end of its horizon. Either one opens the tab
 * on a plot where nothing appears to happen.
 *
 * With observations loaded this picks a run that actually forecast the crest,
 * preferring one with the crest a few days into its horizon. Without them it
 * falls back to the middle initialization, which is the best guess available when
 * the crest's location is unknown.
 */
export function pickDefaultRun(
  sortedKeys: string[],
  observed: TimeSeries | null | undefined,
  maxLead = 15,
): string | null {
  if (sortedKeys.length === 0) return null;
  const middle = sortedKeys[Math.floor((sortedKeys.length - 1) / 2)];

  const peak = peakTime(observed);
  if (peak == null) return middle;

  const horizonMs = maxLead * DAY_MS;
  const target = peak - TARGET_LEAD_DAYS * DAY_MS;

  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const key of sortedKeys) {
    const t0 = parseStartDate(key)?.getTime();
    if (t0 == null) continue;
    // Only runs whose horizon actually contains the crest are candidates —
    // showing the event is the entire point.
    if (peak < t0 || peak > t0 + horizonMs) continue;
    const distance = Math.abs(t0 - target);
    // `<` not `<=`, so ties keep the EARLIER run: more of the rise is in view.
    if (distance < bestDistance) {
      bestDistance = distance;
      best = key;
    }
  }

  // No run forecast the crest at all — nothing better to offer than the middle.
  return best ?? middle;
}

/** Timestamp of the largest finite observed value, or null. */
function peakTime(observed: TimeSeries | null | undefined): number | null {
  if (!observed || observed.time.length === 0) return null;
  let bestT: number | null = null;
  let bestV = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < observed.time.length; i++) {
    const v = observed.values[i];
    // `>` keeps the FIRST of a flat-topped crest, matching how the timing
    // metrics resolve the same tie.
    if (Number.isFinite(v) && v > bestV) {
      bestV = v;
      bestT = observed.time[i].getTime();
    }
  }
  return bestT;
}
