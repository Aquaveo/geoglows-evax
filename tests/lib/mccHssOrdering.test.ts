import { describe, expect, it } from 'vitest';
import { computeMcc } from '../../src/lib/metrics/mcc';
import { computeHss } from '../../src/lib/metrics/hss';

/**
 * The Overview tells readers that "MCC much lower than HSS" cannot indicate
 * skill earned on normal flow rather than the extreme, because the two scores'
 * order is fixed by sign. That claim was quoted with a figure — "across 60,000
 * contingency matrices" — from a sweep that no longer exists anywhere in the
 * repo, which makes it an assertion rather than a result. This is the sweep,
 * pinned, so the page can cite something reproducible.
 *
 * Deterministic LCG rather than Math.random, so a failure is reproducible.
 */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function sweep(trials: number) {
  const rand = lcg(20260827);
  let checked = 0;
  let mccBelowHssWhileBothPositive = 0;
  let orderViolations = 0;
  const mccs: number[] = [];
  const hsss: number[] = [];
  for (let t = 0; t < trials; t++) {
    const K = 2 + Math.floor(rand() * 4); // 2..5 categories
    const m: number[][] = Array.from({ length: K }, () => new Array<number>(K).fill(0));
    // Mass concentrated near the diagonal some of the time, scattered otherwise,
    // so the sweep covers better-than-chance and worse-than-chance alike.
    const cells = 6 + Math.floor(rand() * 40);
    for (let c = 0; c < cells; c++) {
      const i = Math.floor(rand() * K);
      const j = rand() < 0.5 ? i : Math.floor(rand() * K);
      m[i][j] += 1 + Math.floor(rand() * 30);
    }
    const mcc = computeMcc(m);
    const hss = computeHss(m);
    if (!Number.isFinite(mcc) || !Number.isFinite(hss)) continue;
    checked += 1;
    mccs.push(mcc);
    hsss.push(hss);
    // Claim: better than chance => MCC >= HSS; worse than chance => MCC <= HSS.
    const tol = 1e-12;
    if (hss > tol && mcc < hss - tol) {
      orderViolations += 1;
      mccBelowHssWhileBothPositive += mcc > 0 ? 1 : 0;
    }
    if (hss < -tol && mcc > hss + tol) orderViolations += 1;
  }
  // Pearson correlation between the two scores over the same sweep. The page
  // tells readers their agreement is arithmetic rather than corroboration, and
  // quoted a figure for it that was not pinned anywhere.
  const n = mccs.length;
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const mMcc = mean(mccs);
  const mHss = mean(hsss);
  let cov = 0;
  let vM = 0;
  let vH = 0;
  for (let i = 0; i < n; i++) {
    const dm = mccs[i] - mMcc;
    const dh = hsss[i] - mHss;
    cov += dm * dh;
    vM += dm * dm;
    vH += dh * dh;
  }
  const correlation = cov / Math.sqrt(vM * vH);
  return { checked, orderViolations, mccBelowHssWhileBothPositive, correlation };
}

describe('MCC and HSS order is fixed by sign', () => {
  it('holds across a deterministic sweep', () => {
    const r = sweep(60000);
    if (r.checked < 1000 || r.orderViolations > 0) {
      throw new Error(
        `SWEEP scored=${r.checked} violations=${r.orderViolations} ` +
          `mccBelowHssBothPositive=${r.mccBelowHssWhileBothPositive} ` +
          `correlation=${r.correlation.toFixed(4)}`,
      );
    }
    expect(r.checked).toBeGreaterThan(1000);
    expect(r.orderViolations).toBe(0);
    expect(r.mccBelowHssWhileBothPositive).toBe(0);
    // Quoted on the categorical-scores chart as 0.994, so pin it to that. The
    // sweep is deterministic, so this is exact up to the rounding shown; if the
    // sweep's construction ever changes, the page's figure has to change with it.
    expect(r.correlation).toBeCloseTo(0.994, 3);
  });
});
