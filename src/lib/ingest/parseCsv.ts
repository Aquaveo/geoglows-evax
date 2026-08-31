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
  /**
   * Negative readings clamped up to 0.
   *
   * Counted because downstream this is indistinguishable from a genuine zero
   * flow, and the two mean opposite things. An intermittent river really does
   * read 0 and its record should contain zeros; a perennial one reads negative
   * only from backwater, ice or a drifting sensor, and clamping manufactures a
   * zero that was never observed. Bias correction is sensitive to the difference
   * — a single value in the record's lowest bin changes how every below-range
   * forecast is mapped — so the count has to survive parsing.
   */
  clampedNegatives: number;
  /** How slash-formatted dates were read, and whether that had to be assumed. */
  dateOrder: DateOrder;
  /**
   * True when the file uses slash dates that could be read either way round.
   *
   * The series is still returned — refusing a whole upload over an ambiguity the
   * user can resolve by looking at it would be worse — but the caller must say
   * so, because a record read the wrong way round is silently wrong rather than
   * visibly broken.
   */
  dateOrderAmbiguous: boolean;
}

/**
 * Parse a CSV uploaded by the user. Expects:
 *   col 0 = datetime (ISO 8601 or anything `new Date()` can parse, assumed UTC)
 *   col 1 = discharge (m³/s)
 *
 * Negative values are clipped to 0 (notebook does this everywhere).
 */
/**
 * Accepts a File or raw CSV text, so an uploaded file and a fetched URL share
 * one parser and therefore one set of column-detection rules. Papa handles both
 * input types; only the type signature needed widening.
 */
export async function parseDischargeCsv(input: File | string): Promise<CsvParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(input as never, {
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

        // Whole-file detection before parsing any row: one row cannot settle
        // M/D against D/M, and a per-row guess would read the same file two
        // different ways depending on where the days happened to exceed 12.
        const detection = detectDateOrder(result.data.map((r) => r[timeColumn] ?? ''));

        const time: Date[] = [];
        const values: number[] = [];
        let skipped = 0;
        let clampedNegatives = 0;

        for (const row of result.data) {
          const tRaw = row[timeColumn];
          const vRaw = row[valueColumn];
          if (!tRaw || vRaw == null || vRaw === '') {
            skipped++;
            continue;
          }
          const d = parseAsUtc(tRaw, detection.order);
          const n = Number(vRaw);
          if (!d || !Number.isFinite(n)) {
            skipped++;
            continue;
          }
          time.push(d);
          if (n < 0) clampedNegatives += 1;
          values.push(n < 0 ? 0 : n);
        }

        if (time.length === 0) {
          reject(
            new Error(
              'CSV had no parseable (datetime, discharge) rows. The first column must be a ' +
                'date — ISO (1977-08-01, or 1977-08-01 06:00) or slash-formatted ' +
                '(8/1/1977, 8/1/1977 06:00) — and the second a number.',
            ),
          );
          return;
        }
        resolve({
          series: { time, values },
          timeColumn,
          valueColumn,
          skipped,
          clampedNegatives,
          dateOrder: detection.order,
          dateOrderAmbiguous: detection.ambiguous,
        });
      },
      error: (err) => reject(err),
    });
  });
}

/** Which way round a slash-formatted date reads. */
export type DateOrder = 'iso' | 'mdy' | 'dmy';

export interface DateOrderDetection {
  order: DateOrder;
  /**
   * True when every slash date in the file could be read either way, so the
   * order was assumed rather than determined.
   *
   * This has to be surfaced. 8/1/1977 is 1 August in the US convention and 8
   * January in most of the rest of the world, and a whole record read the wrong
   * way round is not obviously wrong — it just silently misdates every value,
   * shifts the season a climatology is built from, and moves the event window.
   * Guessing quietly is the one thing that must not happen here.
   */
  ambiguous: boolean;
  /** Slash-formatted rows seen, for reporting. */
  slashRows: number;
}

const SLASH = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*$/;

/**
 * Work out whether slash dates in a file are M/D/Y or D/M/Y, by looking at all
 * of them rather than at the first one.
 *
 * A value above 12 in either position settles it: 25/12/1977 can only be D/M,
 * 12/25/1977 can only be M/D. A file whose days never exceed 12 — a record of
 * month-starts, or a short window early in the month — cannot be settled at all,
 * and the caller is told so rather than the parser picking silently.
 *
 * Excel writes the host machine's locale, so the same spreadsheet exports
 * differently on different computers. That is exactly why this is detected from
 * the data instead of configured.
 */
export function detectDateOrder(rawDates: readonly string[]): DateOrderDetection {
  let firstOver12 = false;
  let secondOver12 = false;
  let slashRows = 0;

  for (const raw of rawDates) {
    const m = SLASH.exec((raw ?? '').trim());
    if (!m) continue;
    slashRows += 1;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12) firstOver12 = true;
    if (b > 12) secondOver12 = true;
  }

  if (slashRows === 0) return { order: 'iso', ambiguous: false, slashRows: 0 };

  // Both over 12 somewhere means the file is internally inconsistent — neither
  // reading works for every row. Reported as ambiguous so the caller can refuse.
  if (firstOver12 && secondOver12) return { order: 'mdy', ambiguous: true, slashRows };
  if (firstOver12) return { order: 'dmy', ambiguous: false, slashRows };
  if (secondOver12) return { order: 'mdy', ambiguous: false, slashRows };
  // Nothing above 12 anywhere: unresolvable. Default to M/D/Y, which is what
  // Excel writes on a US locale and what the app has seen in practice, but the
  // flag says it was a guess.
  return { order: 'mdy', ambiguous: true, slashRows };
}

/**
 * Parse a datetime string as UTC.
 * - If the string includes 'Z' or an explicit tz offset, honor it.
 * - Otherwise, treat naive timestamps as UTC (project policy: uploads must be UTC).
 * - Slash dates (M/D/YYYY or D/M/YYYY) are read using `order`, which the caller
 *   determines from the whole file. Excel exports these by default and the ISO
 *   path below cannot parse them: "8/1/1977 0:00" becomes "8/1/1977T0:00Z",
 *   which is not a date, so every row was skipped and the file was rejected
 *   with a message that did not mention dates.
 */
export function parseAsUtc(raw: string, order: DateOrder = 'iso'): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const slash = SLASH.exec(trimmed);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const year = Number(slash[3]);
    // A component above 12 can only be the day, whatever `order` says — so a
    // stray 25/12 in an M/D file still lands on the right date.
    const dmy = order === 'dmy' || a > 12;
    const month = dmy ? b : a;
    const day = dmy ? a : b;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const hh = slash[4] ? Number(slash[4]) : 0;
    const mm = slash[5] ? Number(slash[5]) : 0;
    const ss = slash[6] ? Number(slash[6]) : 0;
    if (hh > 23 || mm > 59 || ss > 59) return null;
    const d = new Date(Date.UTC(year, month - 1, day, hh, mm, ss));
    // Date.UTC rolls 31 April over into May; reject rather than silently move it.
    if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
    return d;
  }

  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  // Naive: parse as UTC by appending Z if it looks ISO-ish.
  const isoLike = trimmed.replace(' ', 'T');
  const d = new Date(/T/.test(isoLike) ? `${isoLike}Z` : `${isoLike}T00:00:00Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}
