import { useState } from 'react';
import { AppProvider } from './state/AppContext';
import { OverviewTab } from './components/OverviewTab';
import { SetupTab } from './components/SetupTab';
import { ForecastTab } from './components/ForecastTab';
import { MetricsTab } from './components/MetricsTab';
import { FloodCheckTab } from './components/FloodCheckTab';
import { ErrorBoundary } from './components/ErrorBoundary';
import './App.css';

type TabId = 'overview' | 'setup' | 'forecast' | 'metrics' | 'floodcheck';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'setup', label: 'Setup' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'floodcheck', label: 'Flood check' },
];

function App() {
  const [tab, setTab] = useState<TabId>('overview');
  return (
    <AppProvider>
      {/*
        1120, not 1800.
        At 1800 a section box stretched the full screen while the prose inside it
        wrapped at its reading measure of 46rem — text filling 43% of its own
        container, which reads as a broken layout rather than a text column. The
        plots are all width:100%, so they simply follow. 1120 puts prose at about
        70% of the box, which is what a normal document column looks like.
      */}
      <main style={{ maxWidth: 1120, margin: '0 auto', padding: '1.5rem 2rem' }}>
        <header style={{ marginBottom: '1rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.4rem' }}>GEOGLOWS Evaluation App</h1>
          <p style={{ color: '#666', margin: '0.25rem 0 0' }}>
            Verify RFS forecasts for a single river and event.
          </p>
        </header>

        <nav style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid #ccc', marginBottom: '1.25rem' }}>
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding: '0.5rem 1rem',
                  background: active ? '#fff' : 'transparent',
                  border: '1px solid #ccc',
                  borderBottom: active ? '1px solid #fff' : '1px solid #ccc',
                  borderTopLeftRadius: 6,
                  borderTopRightRadius: 6,
                  marginBottom: -1,
                  cursor: 'pointer',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {t.label}
              </button>
            );
          })}
        </nav>

        {tab === 'overview' && <OverviewTab />}
        {tab === 'setup' && <SetupTab />}
        {tab === 'forecast' && <ForecastTab />}
        {tab === 'metrics' && (
          <ErrorBoundary label="Metrics">
            <MetricsTab />
          </ErrorBoundary>
        )}
        {tab === 'floodcheck' && (
          <ErrorBoundary label="Flood check">
            <FloodCheckTab />
          </ErrorBoundary>
        )}
      </main>
    </AppProvider>
  );
}

export default App;
