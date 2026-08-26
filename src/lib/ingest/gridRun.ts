import type { ForecastRun } from '../types';
import { aggregateBucket, type Aggregation } from './grid';

/**
 * Put every member of one run onto a shared set of grid bins.
 *
 * The obvious implementation — grid each member separately with
 * `aggregateSeries`, then reuse member 0's timestamps for all of them — is
 * wrong, and quietly so. `aggregateSeries` DROPS a bin containing no finite
 * value, so a member with a gap comes back shorter than member 0 and its values
 * line up against the wrong timestamps: everything after the gap slides one grid
 * step earlier. Nothing is missing and every value is real, they are simply
 * attached to the wrong days.
 *
 * Measured: a member identical to the observations but missing one day scored
 * KGE' 0.8384 instead of 1.0000, and the damage grows with how sharp the
 * hydrograph is — sliding a flood peak a day off the observations is a large
 * error, so it bites hardest on exactly the events being verified.
 *
 * It also has a second failure. When member 0 is itself entirely absent its
 * timestamp array is empty, so the whole run reports no data even when every
 * other member is present.
 *
 * `aggregateBucket` avoids both: it grids all members together against one set
 * of bins and pads an absent member with NaN rather than dropping the row, so
 * positions keep their meaning. `alignTimes` then drops the NaN pair downstream,
 * and the member is scored on the days it does have. `skillByLead` already went
 * through this path; the per-run views did not.
 */
export function gridRun(
  run: ForecastRun,
  stepMs: number,
  how: Aggregation = 'mean',
): { time: Date[]; discharge: number[][] } | null {
  const memberCount = run.discharge.length;
  if (memberCount === 0 || run.time.length === 0) return null;

  // aggregateBucket wants [timestep][member]; a run stores [member][timestep].
  const members = run.time.map((_, i) => {
    const row = new Array<number>(memberCount);
    for (let m = 0; m < memberCount; m++) row[m] = run.discharge[m]?.[i] ?? Number.NaN;
    return row;
  });

  const gridded = aggregateBucket({ time: run.time, members }, stepMs, how);
  return {
    time: gridded.time,
    discharge: Array.from({ length: memberCount }, (_, m) =>
      gridded.members.map((row) => row[m]),
    ),
  };
}
