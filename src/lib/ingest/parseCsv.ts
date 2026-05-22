import Papa from 'papaparse';
import type { TimeSeries } from '../types';

export interface CsvParseResult {
  series: TimeSeries;
  /** Name of the datetime column we used (first column). */
  timeColumn: string;
  /** Name of the discharge column we used (second column). */
  valueColumn: string;
  /** Rows skipped because of unparseable datetime or non-numeric value. */
  skipped: number;
}

/**
 * Parse a CSV uploaded by the user. Expects:
 *   col 0 = datetime (ISO 8601 or anything `new Date()` can parse, assumed UTC)
 *   col 1 = discharge (m³/s)
 *
 * Negative values are clipped to 0 (notebook does this everywhere).
 */
export async function parseDischargeCsv(file: File): Promise<CsvParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (result) => {
        if (result.errors.length > 0) {
          console.warn('CSV parse errors:', result.errors);
        }
        const fields = result.meta.fields ?? [];
        if (fields.length < 2) {
          reject(new Error('CSV must have at least 2 columns (datetime, discharge).'));
          return;
        }
        const [timeColumn, valueColumn] = fields;

        const time: Date[] = [];
        const values: number[] = [];
        let skipped = 0;

        for (const row of result.data) {
          const tRaw = row[timeColumn];
          const vRaw = row[valueColumn];
          if (!tRaw || vRaw == null || vRaw === '') {
            skipped++;
            continue;
          }
          const d = parseAsUtc(tRaw);
          const n = Number(vRaw);
          if (!d || !Number.isFinite(n)) {
            skipped++;
            continue;
          }
          time.push(d);
          values.push(n < 0 ? 0 : n);
        }

        if (time.length === 0) {
          reject(new Error('CSV had no parseable (datetime, discharge) rows.'));
          return;
        }
        resolve({ series: { time, values }, timeColumn, valueColumn, skipped });
      },
      error: (err) => reject(err),
    });
  });
}

/**
 * Parse a datetime string as UTC.
 * - If the string includes 'Z' or an explicit tz offset, honor it.
 * - Otherwise, treat naive timestamps as UTC (project policy: uploads must be UTC).
 */
export function parseAsUtc(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  // Naive: parse as UTC by appending Z if it looks ISO-ish.
  const isoLike = trimmed.replace(' ', 'T');
  const d = new Date(/T/.test(isoLike) ? `${isoLike}Z` : `${isoLike}T00:00:00Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}
