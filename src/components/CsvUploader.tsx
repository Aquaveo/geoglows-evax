import { useRef, useState } from 'react';
import type { TimeSeries } from '../lib/types';
import { parseDischargeCsv } from '../lib/ingest/parseCsv';

interface CsvUploaderProps {
  label: string;
  onParsed: (s: TimeSeries, meta: { fileName: string; skipped: number; timeColumn: string; valueColumn: string }) => void;
}

export function CsvUploader({ label, onParsed }: CsvUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus(`Parsing ${file.name}…`);
    try {
      const { series, timeColumn, valueColumn, skipped } = await parseDischargeCsv(file);
      onParsed(series, { fileName: file.name, skipped, timeColumn, valueColumn });
      setStatus(
        `${file.name}: ${series.time.length} rows (cols: ${timeColumn}, ${valueColumn}` +
          (skipped > 0 ? `; skipped ${skipped})` : ')'),
      );
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <label style={{ display: 'block', fontWeight: 500, marginBottom: '0.25rem' }}>{label}</label>
      <input ref={inputRef} type="file" accept=".csv,text/csv" onChange={onChange} />
      {status && <div style={{ fontSize: '0.85rem', color: '#555', marginTop: '0.25rem' }}>{status}</div>}
    </div>
  );
}
