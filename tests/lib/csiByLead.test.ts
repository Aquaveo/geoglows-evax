import { describe, expect, it } from 'vitest';
import { csiByLead } from '../../src/lib/metrics/csiByLead';
import { computeCsi } from '../../src/lib/metrics/csi';
import { buildContingencyMatrix } from '../../src/lib/metrics/contingency';
import { memberSeries } from '../../src/lib/leadBuckets';
import type { LeadBuckets, TimeSeries } from '../../src/lib/types';

const obsRp = { 2: 100, 5: 200, 10: 300, 25: 400, 50: 500, 100: 600 };
// Deliberately lower than obsRp: the dual-threshold design classifies forecasts
// against the SIMULATED scale.
const simRp = { 2: 50, 5: 100, 10: 150, 25: 200, 50: 250, 100: 300 };

const day = (d: number) => new Date(Date.UTC(2025, 6, d));
const ts = (vals: number[], from = 1): TimeSeries => ({
  time: vals.map((_, i) => day(from + i)),
  values: vals,
});

/** buckets[lead] = rows of [member] values at the given days. */
function buckets(spec: Record<number, { days: number[]; members: number[][] }>): LeadBuckets {
  const out = {} as LeadBuckets;
  for (const [lead, s] of Object.entries(spec)) {
    out[Number(lead)] = { time: s.days.map(day), members: s.members };
  }
  return out;
}

describe('csiByLead', () => {
  it('returns null when the observations never crossed the lowest threshold', () => {
    // eventRp 0 means one category, so there is no exceedance to score anywhere.
    const r = csiByLead(buckets({ 1: { days: [1], members: [[10, 10]] } }), ts([10]), obsRp, simRp, 0, 1, 2);
    expect(r).toBeNull();
  });

  it('emits one series per threshold category, capped at eventRp', () => {
    const obs = ts([10, 350, 20]);
    const r = csiByLead(
      buckets({ 1: { days: [1, 2, 3], members: [[10, 10], [400, 400], [20, 20]] } }),
      obs, obsRp, simRp, 10, 1, 2,
    )!;
    // eventRp 10 -> categories [0,2,5,10] -> 3 dichotomisations.
    expect(r.thresholds.map((t) => t.category)).toEqual([1, 2, 3]);
    expect(r.thresholds.map((t) => t.label)).toEqual(['2–5yr', '5–10yr', '≥10yr']);
  });

  it('agrees with computeCsi on every threshold of the pooled matrix it built', () => {
    const obs = ts([10, 350, 20, 250]);
    const b = buckets({
      2: { days: [1, 2, 3, 4], members: [[10, 12], [400, 60], [20, 18], [220, 210]] },
    });
    const r = csiByLead(b, obs, obsRp, simRp, 10, 2, 2)!;
    // Rebuild the pool independently and check the reported CSI came from it.
    const K = 4;
    const pooled = Array.from({ length: K }, () => new Array<number>(K).fill(0));
    for (let m = 0; m < 2; m++) {
      const cm = buildContingencyMatrix(memberSeries(b[2], m), obs, obsRp, simRp, 10);
      for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) pooled[i][j] += cm.matrix[i][j];
    }
    const leadIdx = r.leads.indexOf(2);
    for (const s of r.thresholds) {
      const ref = computeCsi(pooled, s.category);
      // Includes the degenerate case: both are NaN there, since the two now
      // share one convention and one implementation.
      if (Number.isNaN(ref)) expect(Number.isNaN(s.csi[leadIdx])).toBe(true);
      else expect(s.csi[leadIdx]).toBeCloseTo(ref, 12);
    }
  });

  it('keeps hits/false alarms/misses consistent with CSI, POD and FAR', () => {
    const obs = ts([10, 350, 20, 250]);
    const r = csiByLead(
      buckets({ 1: { days: [1, 2, 3, 4], members: [[10, 12], [400, 60], [20, 18], [220, 210]] } }),
      obs, obsRp, simRp, 10, 1, 2,
    )!;
    const i = r.leads.indexOf(1);
    for (const s of r.thresholds) {
      const a = s.hits[i], b = s.falseAlarms[i], c = s.misses[i];
      if (a + b + c > 0) expect(s.csi[i]).toBeCloseTo(a / (a + b + c), 12);
      if (a + c > 0) expect(s.pod[i]).toBeCloseTo(a / (a + c), 12);
      if (a + b > 0) expect(s.far[i]).toBeCloseTo(b / (a + b), 12);
    }
  });

  it('classifies observations against obsRp and forecasts against simRp', () => {
    // 120 is above obsRp[2]=100, so the observation IS an exceedance.
    // A forecast of 60 is above simRp[2]=50, so it IS a forecast exceedance —
    // even though 60 is below the OBSERVED 2-year threshold. Sharing one
    // threshold would score this a miss; the dual-threshold design scores a hit.
    const r = csiByLead(
      buckets({ 1: { days: [1], members: [[60]] } }),
      ts([120]), obsRp, simRp, 2, 1, 1,
    )!;
    const i = r.leads.indexOf(1);
    expect(r.thresholds[0].hits[i]).toBe(1);
    expect(r.thresholds[0].misses[i]).toBe(0);
    expect(r.thresholds[0].csi[i]).toBe(1);
  });

  it('counts DISTINCT exceedance timesteps, not pooled member-timesteps', () => {
    // Two members over two exceedance days: the pooled hit count is 4, but the
    // honest sample size is 2 days. Reporting 4 would overstate the evidence
    // exactly where it is thinnest.
    const obs = ts([350, 360]);
    const r = csiByLead(
      buckets({ 1: { days: [1, 2], members: [[400, 400], [400, 400]] } }),
      obs, obsRp, simRp, 10, 1, 2,
    )!;
    const i = r.leads.indexOf(1);
    expect(r.thresholds[0].hits[i]).toBe(4);
    expect(r.thresholds[0].eventSteps[i]).toBe(2);
  });

  it('deduplicates a valid time that appears twice in one lead bucket', () => {
    // A lead bucket pools across start dates and can carry the same valid time
    // more than once. Counting it twice would inflate the sample size.
    const obs = ts([350, 360]);
    const r = csiByLead(
      buckets({ 3: { days: [1, 1, 2], members: [[400], [400], [400]] } }),
      obs, obsRp, simRp, 10, 3, 1,
    )!;
    expect(r.thresholds[0].eventSteps[r.leads.indexOf(3)]).toBe(2);
  });

  it('reports NaN, not 0, where nothing was observed or forecast at a level', () => {
    // Observed peak reaches the 25-year level, so categories run to 25yr, but
    // nothing at all happens at the top level in THIS lead.
    const obs = ts([10, 20]);
    const r = csiByLead(
      buckets({ 5: { days: [1, 2], members: [[10], [20]] } }),
      obs, obsRp, simRp, 25, 5, 1,
    )!;
    const i = r.leads.indexOf(5);
    for (const s of r.thresholds) {
      expect(s.hits[i] + s.falseAlarms[i] + s.misses[i]).toBe(0);
      expect(Number.isNaN(s.csi[i])).toBe(true);
    }
  });

  it('covers every lead from 0 to maxLead even where a bucket is absent', () => {
    const r = csiByLead(
      buckets({ 2: { days: [1], members: [[400]] } }),
      ts([350]), obsRp, simRp, 10, 4, 1,
    )!;
    expect(r.leads).toEqual([0, 1, 2, 3, 4]);
    // An absent bucket contributes no cells, so CSI is undefined there.
    expect(Number.isNaN(r.thresholds[0].csi[0])).toBe(true);
    expect(r.thresholds[0].csi[2]).toBe(1);
  });

  it('is unchanged by padding the record with quiet days — the whole reason it is here', () => {
    const days = [1, 2, 3];
    const mem = [[10], [400], [20]];
    const short = csiByLead(buckets({ 1: { days, members: mem } }), ts([10, 350, 20]),
      obsRp, simRp, 10, 1, 1)!;
    // 60 extra quiet days on both sides: nothing forecast, nothing observed, so
    // only correct negatives are added.
    const padDays = Array.from({ length: 60 }, (_, i) => 10 + i);
    const padded = csiByLead(
      buckets({ 1: { days: [...days, ...padDays], members: [...mem, ...padDays.map(() => [5])] } }),
      { time: [...days, ...padDays].map(day), values: [10, 350, 20, ...padDays.map(() => 5)] },
      obsRp, simRp, 10, 1, 1,
    )!;
    const i = short.leads.indexOf(1);
    for (let k = 0; k < short.thresholds.length; k++) {
      const a = short.thresholds[k].csi[i];
      const b = padded.thresholds[k].csi[i];
      if (Number.isFinite(a)) expect(b).toBeCloseTo(a, 12);
    }
  });
});
