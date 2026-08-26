import { describe, expect, it } from 'vitest';
import { categoryOf, climatologyFromRecord, rpsByLead, rpsOne } from '../../src/lib/metrics/rps';
import { thresholdScores } from '../../src/lib/metrics/thresholdScores';

describe('rpsOne', () => {
  const sharp = (k: number, K: number) => Array.from({ length: K }, (_, i) => (i === k ? 1 : 0));

  it('penalises by DISTANCE, which is what MCC and HSS cannot do', () => {
    // Observed category 3; a confident forecast that is 1, 2 or 3 categories low.
    expect(rpsOne(sharp(3, 4), 3)).toBeCloseTo(0, 12);
    expect(rpsOne(sharp(2, 4), 3)).toBeCloseTo(1, 12);
    expect(rpsOne(sharp(1, 4), 3)).toBeCloseTo(2, 12);
    expect(rpsOne(sharp(0, 4), 3)).toBeCloseTo(3, 12);
  });

  it('rewards hedging toward the truth over confident error', () => {
    const confidentWrong = rpsOne(sharp(0, 4), 2);
    const spreadNearTruth = rpsOne([0, 0.25, 0.5, 0.25], 2);
    expect(spreadNearTruth).toBeLessThan(confidentWrong);
  });

  it('is zero only for a confident, correct forecast', () => {
    expect(rpsOne(sharp(1, 3), 1)).toBeCloseTo(0, 12);
    expect(rpsOne([0.34, 0.33, 0.33], 1)).toBeGreaterThan(0);
  });
});

describe('categoryOf', () => {
  it('returns 0 below the lowest threshold and K for the highest', () => {
    const t = [10, 20, 30];
    expect(categoryOf(5, t)).toBe(0);
    expect(categoryOf(10, t)).toBe(1);
    expect(categoryOf(25, t)).toBe(2);
    expect(categoryOf(1000, t)).toBe(3);
  });

  it('treats the threshold itself as being in the higher category', () => {
    expect(categoryOf(20, [10, 20, 30])).toBe(2);
  });
});

describe('climatologyFromRecord', () => {
  it('reflects the observed frequencies', () => {
    const values = [...Array(90).fill(1), ...Array(9).fill(15), ...Array(1).fill(25)];
    const c = climatologyFromRecord(
      { time: values.map(() => new Date()), values },
      [10, 20],
    );
    expect(c[0]).toBeGreaterThan(0.85);
    expect(c[2]).toBeLessThan(0.05);
    expect(c.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('never assigns zero to an unseen category', () => {
    // A reference of exactly zero is infinitely confident, and RPSS becomes
    // undefined the first time that category actually occurs.
    const values = Array(200).fill(1);
    const c = climatologyFromRecord({ time: values.map(() => new Date()), values }, [10, 20]);
    expect(c[1]).toBeGreaterThan(0);
    expect(c[2]).toBeGreaterThan(0);
  });
});

describe('thresholdScores', () => {
  const labels = ['<2yr', '2-5yr', '5-10yr', '>=10yr'];
  const m = [
    [820, 40, 6, 1],
    [55, 48, 12, 3],
    [9, 14, 21, 6],
    [2, 4, 9, 15],
  ];

  it('produces one row per threshold, not one number', () => {
    const rows = thresholdScores(m, labels);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.label)).toEqual(['2-5yr', '5-10yr', '>=10yr']);
  });

  it('is exactly invariant to padding with correct negatives', () => {
    const padded = m.map((row) => [...row]);
    padded[0][0] += 100_000;
    const a = thresholdScores(m, labels);
    const b = thresholdScores(padded, labels);
    for (let i = 0; i < a.length; i++) {
      expect(b[i].pod).toBeCloseTo(a[i].pod, 12);
      expect(b[i].far).toBeCloseTo(a[i].far, 12);
      expect(b[i].csi).toBeCloseTo(a[i].csi, 12);
      expect(b[i].frequencyBias).toBeCloseTo(a[i].frequencyBias, 12);
    }
    // Only the correct-negative count itself changes.
    expect(b[0].correctNegatives).toBe(a[0].correctNegatives + 100_000);
  });

  it('fingerprints systematic under-prediction with bias below 1 decaying to 0', () => {
    const low = [
      [860, 7, 0, 0],
      [100, 18, 0, 0],
      [38, 10, 2, 0],
      [20, 7, 3, 0],
    ];
    const rows = thresholdScores(low, labels);
    expect(rows.every((r) => r.frequencyBias < 1)).toBe(true);
    // Never issued the top category at all.
    expect(rows[rows.length - 1].frequencyBias).toBe(0);
  });

  it('counts the four cells consistently', () => {
    const rows = thresholdScores(m, labels);
    const total = m.flat().reduce((a, b) => a + b, 0);
    for (const r of rows) {
      expect(r.hits + r.falseAlarms + r.misses + r.correctNegatives).toBe(total);
    }
  });
});

describe('RPSS on a near-miss event — the degenerate-reference guard', () => {
  // The audit's A1: when nothing in the scored window crosses even the lowest
  // threshold, the climatological reference is right by default, its RPS
  // collapses toward zero, and 1 - rps/rpsClim explodes. Measured on a real
  // near-miss: rpsClim 8.7e-6, RPSS -2266 to -3421, which then set the panel
  // axis and crushed every other bar to under 0.1% of the plot height.
  const THR = 233.1;
  const day = (d: number) => new Date(Date.UTC(2025, 6, d));
  const obsThr = [THR];
  const simThr = [THR];

  /** 20 days peaking at 92% of the 2-year threshold — a near miss. */
  const peakAt = (frac: number) => ({
    time: Array.from({ length: 20 }, (_, i) => day(1 + i)),
    values: Array.from({ length: 20 }, (_, i) =>
      20 + (THR * frac - 20) * Math.exp(-((i - 10) ** 2) / 8),
    ),
  });
  // A long, mostly quiet record, so climatology puts nearly all mass below 2yr.
  const record = {
    time: Array.from({ length: 4000 }, (_, i) => new Date(Date.UTC(2000, 0, 1) + i * 86400000)),
    values: Array.from({ length: 4000 }, (_, i) => (i % 700 === 0 ? THR * 1.4 : 30 + (i % 17))),
  };
  const clim = climatologyFromRecord(record, obsThr);

  const bucketsFor = (obs: { time: Date[]; values: number[] }) => {
    const b: Record<number, { time: Date[]; members: number[][] }> = {};
    for (let lead = 0; lead <= 3; lead++) {
      b[lead] = {
        time: obs.time,
        // Members spread around the observation — a real forecast, not a perfect one.
        members: obs.values.map((v) =>
          Array.from({ length: 51 }, (_, m) => v * (0.6 + (m % 11) * 0.09)),
        ),
      };
    }
    return b;
  };

  it('confirms the reference really is near-perfect on a quiet window', () => {
    // This is the mechanism, not an assumption: climatology assigns almost all
    // its mass to "below 2yr", and that is what happened at every timestep.
    expect(clim[0]).toBeGreaterThan(0.99);
    expect(rpsOne(clim, 0)).toBeLessThan(1e-3);
  });

  it('scores RPS but declines RPSS, instead of emitting a huge negative', () => {
    const near = peakAt(0.92);
    const res = rpsByLead(bucketsFor(near), near, obsThr, simThr, clim, {
      maxLead: 3,
      minPairs: 5,
    });
    for (let i = 0; i < res.leads.length; i++) {
      expect(res.exceedances[i]).toBe(0);
      // RPS is a proper score and still stands on its own.
      expect(Number.isFinite(res.rps[i])).toBe(true);
      expect(Number.isNaN(res.rpss[i])).toBe(true);
      expect(res.rpssSkipped[i]).toMatch(/no observed exceedance/);
      // The lead is NOT marked wholly unscored — RPS was scored.
      expect(res.skipped[i]).toBeNull();
    }
  });

  it('leaves RPSS finite and readable once the event crosses the threshold', () => {
    const real = peakAt(1.6);
    const res = rpsByLead(bucketsFor(real), real, obsThr, simThr, clim, {
      maxLead: 3,
      minPairs: 5,
    });
    expect(res.exceedances[0]).toBeGreaterThan(0);
    expect(Number.isFinite(res.rpss[0])).toBe(true);
    expect(res.rpssSkipped[0]).toBeNull();
    // In a readable range rather than the thousands.
    expect(res.rpss[0]).toBeGreaterThan(-20);
  });
});
