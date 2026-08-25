import { useState } from 'react';
import { AppProvider } from './state/AppContext';
import { OverviewTab } from './components/OverviewTab';
import { SetupTab } from './components/SetupTab';
import { ForecastTab } from './components/ForecastTab';
import { MetricsTab } from './components/MetricsTab';
import { RetrospectiveTab } from './components/RetrospectiveTab';
import { ErrorBoundary } from './components/ErrorBoundary';
import './App.css';

type TabId = 'overview' | 'setup' | 'forecast' | 'metrics' | 'retrospective';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'setup', label: 'Setup' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'metrics', label: 'Metrics' },
  // Last, and named for the record rather than the event: it answers a different
  // question from the three tabs before it, on a sample thousands of times larger.
  { id: 'retrospective', label: 'Long record' },
];

function App() {
  const [tab, setTab] = useState<TabId>('overview');
  return (
    <AppProvider>
      <main style={{ maxWidth: 1800, margin: '0 auto', padding: '1.5rem 2rem' }}>
        <header style={{ marginBottom: '1rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.4rem' }}>GEOGLOWS Evaluation App</h1>
          <p style={{ color: '#666', margin: '0.25rem 0 0' }}>
            Verify RFS forecasts for a single river and event, and the model's long-record skill at that reach.
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
        {tab === 'retrospective' && (
          <ErrorBoundary label="Long record">
            <RetrospectiveTab />
          </ErrorBoundary>
        )}
      </main>
    </AppProvider>
  );
}

export default App;
