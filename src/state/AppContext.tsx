import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ForecastResult } from '../data/rfs';
import type { LeadBuckets, RpThresholds, TimeSeries } from '../lib/types';
import type { ReachMetadata } from '../data/reachMetadata';
import type { PerLeadDistribution } from '../plots/kgeVsLead';

interface AppState {
  // Inputs
  riverId: number | null;
  setRiverId: (n: number | null) => void;

  reach: ReachMetadata | null;
  setReach: (r: ReachMetadata | null) => void;

  retro: TimeSeries | null;
  setRetro: (s: TimeSeries | null) => void;

  simRp: RpThresholds | null;
  setSimRp: (r: RpThresholds | null) => void;

  eventData: TimeSeries | null;
  setEventData: (s: TimeSeries | null) => void;

  historicalData: TimeSeries | null;
  setHistoricalData: (s: TimeSeries | null) => void;

  obsRp: RpThresholds | null;
  setObsRp: (r: RpThresholds | null) => void;

  // Forecast phase
  /** Event window start, 'YYYY-MM-DD' (UTC). Drives the forecast download range. */
  eventStart: string | null;
  setEventStart: (d: string | null) => void;

  /** Event window end, 'YYYY-MM-DD' (UTC). */
  eventEnd: string | null;
  setEventEnd: (d: string | null) => void;

  forecasts: Map<string, ForecastResult>;
  setForecasts: (m: Map<string, ForecastResult>) => void;

  forecastProgress: { done: number; total: number } | null;
  setForecastProgress: (p: { done: number; total: number } | null) => void;

  selectedInitDate: string | null;
  setSelectedInitDate: (d: string | null) => void;

  // Metric phase
  leadBuckets: LeadBuckets | null;
  setLeadBuckets: (b: LeadBuckets | null) => void;

  kgeDistribution: PerLeadDistribution | null;
  setKgeDistribution: (d: PerLeadDistribution | null) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [riverId, setRiverId] = useState<number | null>(null);
  const [reach, setReach] = useState<ReachMetadata | null>(null);
  const [retro, setRetro] = useState<TimeSeries | null>(null);
  const [simRp, setSimRp] = useState<RpThresholds | null>(null);
  const [eventData, setEventData] = useState<TimeSeries | null>(null);
  const [historicalData, setHistoricalData] = useState<TimeSeries | null>(null);
  const [obsRp, setObsRp] = useState<RpThresholds | null>(null);
  const [eventStart, setEventStart] = useState<string | null>(null);
  const [eventEnd, setEventEnd] = useState<string | null>(null);
  const [forecasts, setForecasts] = useState<Map<string, ForecastResult>>(new Map());
  const [forecastProgress, setForecastProgress] = useState<{ done: number; total: number } | null>(null);
  const [selectedInitDate, setSelectedInitDate] = useState<string | null>(null);
  const [leadBuckets, setLeadBuckets] = useState<LeadBuckets | null>(null);
  const [kgeDistribution, setKgeDistribution] = useState<PerLeadDistribution | null>(null);

  const value = useMemo<AppState>(
    () => ({
      riverId, setRiverId,
      reach, setReach,
      retro, setRetro,
      simRp, setSimRp,
      eventData, setEventData,
      historicalData, setHistoricalData,
      obsRp, setObsRp,
      eventStart, setEventStart,
      eventEnd, setEventEnd,
      forecasts, setForecasts,
      forecastProgress, setForecastProgress,
      selectedInitDate, setSelectedInitDate,
      leadBuckets, setLeadBuckets,
      kgeDistribution, setKgeDistribution,
    }),
    [riverId, reach, retro, simRp, eventData, historicalData, obsRp, eventStart, eventEnd, forecasts, forecastProgress, selectedInitDate, leadBuckets, kgeDistribution],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
}
