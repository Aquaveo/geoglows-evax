import { describe, expect, it } from 'vitest';
import { parseAsUtc, detectDateOrder, parseDischargeCsv } from '../../src/lib/ingest/parseCsv';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

describe('slash-formatted dates', () => {
  it('parses the Excel default, which used to be rejected outright', () => {
    // "8/1/1977 0:00" became "8/1/1977T0:00Z" under the ISO path — not a date —
    // so every row was skipped and the whole file was refused.
    expect(iso(parseAsUtc('8/1/1977 0:00', 'mdy'))).toBe('1977-08-01T00:00:00.000Z');
    expect(iso(parseAsUtc('8/1/1977', 'mdy'))).toBe('1977-08-01T00:00:00.000Z');
    expect(iso(parseAsUtc('08/01/1977 13:45:30', 'mdy'))).toBe('1977-08-01T13:45:30.000Z');
  });

  it('reads the same string the other way round when the file says D/M', () => {
    expect(iso(parseAsUtc('8/1/1977', 'mdy'))).toBe('1977-08-01T00:00:00.000Z');
    expect(iso(parseAsUtc('8/1/1977', 'dmy'))).toBe('1977-01-08T00:00:00.000Z');
  });

  it('lets a value above 12 override the file-level order', () => {
    // 25 cannot be a month whatever the header says.
    expect(iso(parseAsUtc('25/12/1977', 'mdy'))).toBe('1977-12-25T00:00:00.000Z');
  });

  it('rejects impossible dates instead of rolling them over', () => {
    // Date.UTC(1977, 3, 31) silently becomes 1 May.
    expect(parseAsUtc('4/31/1977', 'mdy')).toBeNull();
    expect(parseAsUtc('2/30/1977', 'mdy')).toBeNull();
    expect(parseAsUtc('13/1/1977', 'mdy')).not.toBeNull(); // 13 > 12 -> read as D/M
    expect(iso(parseAsUtc('13/1/1977', 'mdy'))).toBe('1977-01-13T00:00:00.000Z');
    expect(parseAsUtc('8/1/1977 25:00', 'mdy')).toBeNull();
  });

  it('still parses every ISO form it did before', () => {
    expect(iso(parseAsUtc('1977-08-01'))).toBe('1977-08-01T00:00:00.000Z');
    expect(iso(parseAsUtc('1977-08-01 06:00'))).toBe('1977-08-01T06:00:00.000Z');
    expect(iso(parseAsUtc('1977-08-01T06:00:00Z'))).toBe('1977-08-01T06:00:00.000Z');
    expect(iso(parseAsUtc('1977-08-01T06:00:00+02:00'))).toBe('1977-08-01T04:00:00.000Z');
  });
});

describe('detectDateOrder decides from the whole file', () => {
  it('settles on D/M when some first component exceeds 12', () => {
    const d = detectDateOrder(['1/2/1977', '25/12/1977', '3/4/1977']);
    expect(d.order).toBe('dmy');
    expect(d.ambiguous).toBe(false);
  });

  it('settles on M/D when some second component exceeds 12', () => {
    const d = detectDateOrder(['1/2/1977', '12/25/1977']);
    expect(d.order).toBe('mdy');
    expect(d.ambiguous).toBe(false);
  });

  it('flags a file that cannot be settled either way', () => {
    // Month-starts only: every row reads as both.
    const d = detectDateOrder(['8/1/1977', '9/1/1977', '10/1/1977']);
    expect(d.ambiguous).toBe(true);
    expect(d.slashRows).toBe(3);
  });

  it('flags a file that is internally inconsistent', () => {
    const d = detectDateOrder(['25/12/1977', '12/25/1977']);
    expect(d.ambiguous).toBe(true);
  });

  it('reports iso when there are no slash dates at all', () => {
    const d = detectDateOrder(['1977-08-01', '1977-08-02']);
    expect(d.order).toBe('iso');
    expect(d.ambiguous).toBe(false);
    expect(d.slashRows).toBe(0);
  });
});

describe('end to end', () => {
  it('parses a US-style export and reports how it read the dates', async () => {
    const csv = [
      'datetime,discharge',
      '8/1/1977 0:00,0',
      '8/2/1977 0:00,1.5',
      '8/13/1977 0:00,2.5',
    ].join('\n');
    const r = await parseDischargeCsv(csv);
    expect(r.series.time).toHaveLength(3);
    expect(r.series.time[0].toISOString()).toBe('1977-08-01T00:00:00.000Z');
    expect(r.series.time[2].toISOString()).toBe('1977-08-13T00:00:00.000Z');
    expect(r.dateOrder).toBe('mdy');
    expect(r.dateOrderAmbiguous).toBe(false);
    expect(r.skipped).toBe(0);
  });

  it('parses an unambiguous D/M export the other way round', async () => {
    const csv = ['datetime,discharge', '25/12/1977 0:00,3', '26/12/1977 0:00,4'].join('\n');
    const r = await parseDischargeCsv(csv);
    expect(r.dateOrder).toBe('dmy');
    expect(r.series.time[0].toISOString()).toBe('1977-12-25T00:00:00.000Z');
  });

  it('still parses, but flags, a file nothing can disambiguate', async () => {
    const csv = ['datetime,discharge', '8/1/1977,1', '9/1/1977,2'].join('\n');
    const r = await parseDischargeCsv(csv);
    expect(r.series.time).toHaveLength(2);
    expect(r.dateOrderAmbiguous).toBe(true);
  });
});
