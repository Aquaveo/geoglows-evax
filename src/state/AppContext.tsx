import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ForecastResult } from '../data/rfs';
import type { LeadBuckets, RpThresholds, TimeSeries } from '../lib/types';
import type { ReachMetadata } from '../data/reachMetadata';
import type { PerLeadDistribution } from '../plots/distributionVsLead';

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
  forecasts: Map<string, ForecastResult>;
  setForecasts: (m: Map<string, ForecastResult>) => void;

  forecastProgress: { done: number; total: number } | null;
  setForecastProgress: (p: { done: number; total: number } | null) => void;

  selectedDate: string | null;
  setSelectedDate: (d: string | null) => void;

  // Metric phase
  leadBuckets: LeadBuckets | null;
  setLeadBuckets: (b: LeadBuckets | null) => void;

  mccDistribution: PerLeadDistribution | null;
  setMccDistribution: (d: PerLeadDistribution | null) => void;

  hssDistribution: PerLeadDistribution | null;
  setHssDistribution: (d: PerLeadDistribution | null) => void;

  /** Maximum observed return period exceeded during the event (0 if none). */
  eventReturnPeriod: number | null;
  setEventReturnPeriod: (n: number | null) => void;
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
  const [forecasts, setForecasts] = useState<Map<string, ForecastResult>>(new Map());
  const [forecastProgress, setForecastProgress] = useState<{ done: number; total: number } | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [leadBuckets, setLeadBuckets] = useState<LeadBuckets | null>(null);
  const [mccDistribution, setMccDistribution] = useState<PerLeadDistribution | null>(null);
  const [hssDistribution, setHssDistribution] = useState<PerLeadDistribution | null>(null);
  const [eventReturnPeriod, setEventReturnPeriod] = useState<number | null>(null);

  const value = useMemo<AppState>(
    () => ({
      riverId, setRiverId,
      reach, setReach,
      retro, setRetro,
      simRp, setSimRp,
      eventData, setEventData,
      historicalData, setHistoricalData,
      obsRp, setObsRp,
      forecasts, setForecasts,
      forecastProgress, setForecastProgress,
      selectedDate, setSelectedDate,
      leadBuckets, setLeadBuckets,
      mccDistribution, setMccDistribution,
      hssDistribution, setHssDistribution,
      eventReturnPeriod, setEventReturnPeriod,
    }),
    [riverId, reach, retro, simRp, eventData, historicalData, obsRp, forecasts, forecastProgress, selectedDate, leadBuckets, mccDistribution, hssDistribution, eventReturnPeriod],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
}
