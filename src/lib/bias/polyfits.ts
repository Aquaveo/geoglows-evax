import { Blosc } from 'numcodecs';
import { cacheKey, readCache, writeCache } from '../../data/cache';
import type { RiverPolyfits } from './polyfitTypes';

export type { MonthPolyfit, RiverPolyfits } from './polyfitTypes';

/**
 * Per-river, per-month polynomial transformers published by the GEOGLOWS
 * programme. Anonymous S3, and the bucket serves
 * `Access-Control-Allow-Origin: *`, so a browser can read it directly.
 */
const ZARR_BASE = 'https://geoglows-v2.s3.amazonaws.com/transformers/polyfits.zarr';
/** Rivers per chunk along the first axis, from the store's .zarray metadata. */
const RIVER_CHUNK = 5000;
const MONTHS = 12;
const DEGREES = 8;


const blosc = Blosc.fromConfig({ id: 'blosc' });

async function fetchChunk(path: string): Promise<Uint8Array> {
  const res = await fetch(`${ZARR_BASE}/${path}`);
  if (!res.ok) throw new Error(`polyfits: ${path} returned HTTP ${res.status}`);
  return blosc.decode(new Uint8Array(await res.arrayBuffer()));
}

/**
 * A copy whose byteOffset is zero, when the decoded bytes are a view partway
 * into a larger buffer.
 *
 * Float64Array and BigInt64Array REQUIRE an 8-byte-aligned start offset and
 * throw RangeError otherwise. A decoder is free to return a view at any offset,
 * so reading its output directly is a latent crash that only fires on whichever
 * chunk happens to land misaligned.
 */
function aligned(bytes: Uint8Array, bytesPerElement: number): Uint8Array {
  if (bytes.byteOffset % bytesPerElement === 0) return bytes;
  return new Uint8Array(bytes);
}

/**
 * Position of `riverId` in the store's river axis.
 *
 * The river_id coordinate is one 3.3 MB chunk covering all 6.8 million rivers,
 * so this is the expensive part of a cold lookup. It is deliberately not cached:
 * the *result* of the whole lookup is 216 numbers and is cached instead, so this
 * runs at most once per river rather than once per session.
 */
async function findRiverIndex(riverId: number): Promise<number> {
  const bytes = aligned(await fetchChunk('river_id/0'), 8);
  const ids = new BigInt64Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 8);
  const target = BigInt(riverId);
  // The coordinate is sorted ascending, verified against the published store.
  let lo = 0;
  let hi = ids.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = ids[mid];
    if (v === target) return mid;
    if (v < target) lo = mid + 1;
    else hi = mid - 1;
  }
  throw new Error(`River ${riverId} is not in the polyfits table`);
}

/**
 * Transformer coefficients for one river, fetched from the published zarr store
 * and cached in IndexedDB.
 *
 * A cold fetch costs about 8 MB across four chunks; a warm one costs nothing,
 * because only the 216 resulting numbers are stored rather than any of the
 * chunks they came from.
 */
export async function getPolyfits(riverId: number): Promise<RiverPolyfits> {
  const key = cacheKey({ riverId, type: 'polyfit' });
  const cached = await readCache<RiverPolyfits>(key);
  if (cached) return cached;

  const index = await findRiverIndex(riverId);
  const chunk = Math.floor(index / RIVER_CHUNK);
  const offset = index % RIVER_CHUNK;

  const [rawQtop, rawPtoq, rawQrange] = await Promise.all([
    fetchChunk(`QtoP/${chunk}.0.0`),
    fetchChunk(`PtoQ/${chunk}.0.0`),
    fetchChunk(`Qrange/${chunk}.0.0`),
  ]);
  const qtopBytes = aligned(rawQtop, 8);
  const ptoqBytes = aligned(rawPtoq, 8);
  const qrangeBytes = aligned(rawQrange, 4);

  // C-order [river, month, degree]; Qrange is float32, the other two float64.
  const qtop = new Float64Array(qtopBytes.buffer, qtopBytes.byteOffset, qtopBytes.byteLength / 8);
  const ptoq = new Float64Array(ptoqBytes.buffer, ptoqBytes.byteOffset, ptoqBytes.byteLength / 8);
  const qrange = new Float32Array(
    qrangeBytes.buffer,
    qrangeBytes.byteOffset,
    qrangeBytes.byteLength / 4,
  );

  const out: RiverPolyfits = {};
  for (let m = 0; m < MONTHS; m++) {
    const cBase = offset * MONTHS * DEGREES + m * DEGREES;
    const rBase = offset * MONTHS * 2 + m * 2;
    out[m + 1] = {
      qrange: [qrange[rBase], qrange[rBase + 1]],
      qtop: Array.from(qtop.slice(cBase, cBase + DEGREES)),
      ptoq: Array.from(ptoq.slice(cBase, cBase + DEGREES)),
    };
  }

  await writeCache(key, out);
  return out;
}
