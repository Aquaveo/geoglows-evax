import { useRef, useState } from 'react';
import type { TimeSeries } from '../lib/types';
import { parseDischargeCsv } from '../lib/ingest/parseCsv';
import { fetchCsvText } from '../lib/ingest/fetchCsv';

interface CsvUploaderProps {
  label: string;
  onParsed: (
    s: TimeSeries,
    meta: {
      fileName: string;
      skipped: number;
      clampedNegatives: number;
      timeColumn: string;
      valueColumn: string;
    },
  ) => void;
}

/**
 * A discharge CSV from a local file or a URL.
 *
 * Both paths run through the same parser, so column detection and the skipped
 * count behave identically however the data arrived. The URL path exists because
 * these files often already live in an S3 bucket and downloading them only to
 * re-upload is pointless — but it works only where the host sets CORS, which is
 * stated up front rather than discovered through a failure.
 */
export function CsvUploader({ label, onParsed }: CsvUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [source, setSource] = useState<'file' | 'url'>('file');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  function accept(
    series: TimeSeries,
    name: string,
    timeColumn: string,
    valueColumn: string,
    skipped: number,
    clampedNegatives: number,
  ) {
    onParsed(series, { fileName: name, skipped, clampedNegatives, timeColumn, valueColumn });
    setFailed(false);
    setStatus(
      `${name}: ${series.time.length.toLocaleString()} rows (cols: ${timeColumn}, ${valueColumn}` +
        (skipped > 0 ? `; skipped ${skipped}` : '') +
        (clampedNegatives > 0 ? `; ${clampedNegatives} negative reading${clampedNegatives === 1 ? '' : 's'} clamped to 0` : '') +
        ')',
    );
  }

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus(`Parsing ${file.name}…`);
    setFailed(false);
    try {
      const { series, timeColumn, valueColumn, skipped, clampedNegatives } =
        await parseDischargeCsv(file);
      accept(series, file.name, timeColumn, valueColumn, skipped, clampedNegatives);
    } catch (err) {
      setFailed(true);
      setStatus(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadUrl() {
    setBusy(true);
    setFailed(false);
    setStatus('Fetching…');
    try {
      const { text, bytes } = await fetchCsvText(url);
      const { series, timeColumn, valueColumn, skipped, clampedNegatives } =
        await parseDischargeCsv(text);
      // Name it by the object key, not the whole URL — a presigned URL carries a
      // signature that should not be pinned to the screen.
      const name = url.split('?')[0].split('/').pop() || 'remote.csv';
      accept(
        series,
        `${name} (${(bytes / 1024).toFixed(0)} KB)`,
        timeColumn,
        valueColumn,
        skipped,
        clampedNegatives,
      );
    } catch (err) {
      setFailed(true);
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginBottom: '0.9rem' }}>
      <label style={{ display: 'block', fontWeight: 500, marginBottom: '0.3rem' }}>{label}</label>
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.4rem' }}>
        {(
          [
            ['file', 'Local file'],
            ['url', 'From a URL'],
          ] as const
        ).map(([k, l]) => (
          <label key={k} style={{ fontSize: '0.85rem', cursor: 'pointer', color: '#444' }}>
            <input
              type="radio"
              checked={source === k}
              onChange={() => {
                setSource(k);
                setStatus(null);
                setFailed(false);
              }}
              style={{ marginRight: '0.3rem' }}
            />
            {l}
          </label>
        ))}
      </div>

      {source === 'file' ? (
        <input ref={inputRef} type="file" accept=".csv,text/csv" onChange={onChange} />
      ) : (
        <>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://bucket.s3.amazonaws.com/path/gauge.csv"
              style={{ flex: '1 1 380px', padding: '0.3rem 0.45rem', fontSize: '0.9rem' }}
            />
            <button onClick={loadUrl} disabled={busy || !url.trim()} style={btn}>
              {busy ? 'Fetching…' : 'Fetch'}
            </button>
          </div>
          <div style={notice}>
            <div style={noticeHead}>Before you paste a URL — two things must be true</div>
            <ol style={noticeList}>
              <li>
                <strong>The host must allow browser requests.</strong> It has to send an{' '}
                <code>Access-Control-Allow-Origin</code> header, and nothing this page can do
                works around that. AWS Open Data buckets normally do —{' '}
                <code>geoglows-v2</code> and <code>noaa-nwm-pds</code> both send{' '}
                <code>*</code>. Buckets in a private account normally do not, unless someone has
                added a CORS rule.
              </li>
              <li>
                <strong>If the object is private, use a presigned URL.</strong> Generate one with{' '}
                <code>aws s3 presign</code> or the console and paste it whole — the signature
                travels in the URL, so no keys are entered here.{' '}
                <em>
                  A presigned URL does not remove the first requirement: signing satisfies S3,
                  while CORS is enforced by the browser, so a private bucket needs both.
                </em>
              </li>
            </ol>
            <div style={noticeFoot}>
              A blocked request looks identical to the host being down — the browser hides the
              reason — so if the fetch fails and the URL is definitely right, CORS is the likely
              cause. Downloading the file and switching to <strong>Local file</strong> always
              works.
            </div>
          </div>
        </>
      )}

      {status && (
        <div
          style={{
            fontSize: '0.85rem',
            marginTop: '0.35rem',
            color: failed ? '#7f1d1d' : '#555',
            background: failed ? '#fef2f2' : 'transparent',
            border: failed ? '1px solid #fca5a5' : 'none',
            borderRadius: failed ? 4 : 0,
            padding: failed ? '0.5rem 0.65rem' : 0,
            lineHeight: 1.55,
          }}
        >
          {status}
        </div>
      )}
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: '0.3rem 0.8rem',
  fontSize: '0.9rem',
  cursor: 'pointer',
};
const notice: React.CSSProperties = {
  marginTop: '0.5rem',
  padding: '0.7rem 0.9rem',
  border: '1px solid #bfdbfe',
  background: '#eff6ff',
  borderRadius: 6,
  fontSize: '0.85rem',
  lineHeight: 1.6,
  color: '#1e3a5f',
  maxWidth: '78ch',
};
const noticeHead: React.CSSProperties = { fontWeight: 600, marginBottom: '0.35rem' };
const noticeList: React.CSSProperties = {
  margin: '0 0 0.4rem',
  paddingLeft: '1.3rem',
  display: 'grid',
  gap: '0.4rem',
};
const noticeFoot: React.CSSProperties = {
  borderTop: '1px solid #bfdbfe',
  paddingTop: '0.45rem',
  color: '#33507a',
};
