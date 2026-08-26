import { describe, expect, it } from 'vitest';
import { parseDischargeCsv } from '../../src/lib/ingest/parseCsv';

const csv = (rows: string) => `datetime,discharge\n${rows}`;

describe('parseDischargeCsv clamped-negative count', () => {
  it('counts negatives it clamps, and distinguishes them from genuine zeros', async () => {
    // A perennial river with a sensor fault: the -2.5 becomes 0, and that
    // manufactured zero is what flips the bias correction low-flow branch.
    const faulty = await parseDischargeCsv(
      csv('2024-01-01,12\n2024-01-02,-2.5\n2024-01-03,15'),
    );
    expect(faulty.series.values).toEqual([12, 0, 15]);
    expect(faulty.clampedNegatives).toBe(1);

    // An intermittent river that really does run dry: same stored values, but
    // nothing was manufactured, so the zero is an observation.
    const dry = await parseDischargeCsv(csv('2024-01-01,12\n2024-01-02,0\n2024-01-03,15'));
    expect(dry.series.values).toEqual([12, 0, 15]);
    expect(dry.clampedNegatives).toBe(0);
  });

  it('reports zero when nothing was clamped', async () => {
    const r = await parseDischargeCsv(csv('2024-01-01,1\n2024-01-02,2'));
    expect(r.clampedNegatives).toBe(0);
  });

  it('counts every clamped row, not just the first', async () => {
    const r = await parseDischargeCsv(
      csv('2024-01-01,-1\n2024-01-02,-9\n2024-01-03,3\n2024-01-04,-0.1'),
    );
    expect(r.clampedNegatives).toBe(3);
    expect(r.series.values).toEqual([0, 0, 3, 0]);
  });
});
