import { useState } from 'react';
import { AppProvider } from './state/AppContext';
import { SetupTab } from './components/SetupTab';
import { ForecastTab } from './components/ForecastTab';
import { MetricsTab } from './components/MetricsTab';
import './App.css';

type TabId = 'setup' | 'forecast' | 'metrics';

const TABS: { id: TabId; label: string }[] = [
  { id: 'setup', label: 'Setup' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'metrics', label: 'Metrics' },
];

function App() {
  const [tab, setTab] = useState<TabId>('setup');
  return (
    <AppProvider>
      <main style={{ maxWidth: 1800, margin: '0 auto', padding: '1.5rem 2rem' }}>
        <header style={{ marginBottom: '1rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.4rem' }}>GEOGLOWS Evaluation App</h1>
          <p style={{ color: '#666', margin: '0.25rem 0 0' }}>
            Verify GEOGLOWS RFS forecasts for a single river and event.
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

        {tab === 'setup' && <SetupTab />}
        {tab === 'forecast' && <ForecastTab />}
        {tab === 'metrics' && <MetricsTab />}
      </main>
    </AppProvider>
  );
}

export default App;
