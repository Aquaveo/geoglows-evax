import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ForecastResult } from '../data/rfs';
import type { LeadBuckets, RpThresholds, TimeSeries } from '../lib/types';
import type { ReachMetadata } from '../data/reachMetadata';
import type { PerLeadDistribution } from '../plots/distributionVsLead';
import type { CrpsPerLead } from '../lib/metrics/crps';

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
  /**
   * Negative readings clamped to 0 when the historical CSV was parsed.
   *
   * Upload metadata rather than a computed result, but it has to reach the bias
   * banner: a zero in the record means opposite things on an intermittent river
   * (a real reading) and a perennial one (a clamped sensor fault), and the
   * correction's low-flow behaviour turns on exactly that.
   */
  historicalClampedNegatives: number;
  setHistoricalData: (s: TimeSeries | null) => void;
  setHistoricalClampedNegatives: (n: number) => void;

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

  peakTimingDistribution: PerLeadDistribution | null;
  setPeakTimingDistribution: (d: PerLeadDistribution | null) => void;

  /** Per-RP distribution of Δt crossing across ensemble members. */
  crossingDistributions: Record<number, PerLeadDistribution> | null;
  setCrossingDistributions: (d: Record<number, PerLeadDistribution> | null) => void;

  /** Per-RP detection counts per lead day. */
  crossingDetections: Record<number, CrossingDetection> | null;
  setCrossingDetections: (d: Record<number, CrossingDetection> | null) => void;

  /** Maximum observed return period exceeded during the event (0 if none). */
  eventReturnPeriod: number | null;
  setEventReturnPeriod: (n: number | null) => void;

  /** Mean CRPS / MAE component / Spread per lead day (scalar per lead). */
  crpsResults: CrpsPerLead | null;
  setCrpsResults: (r: CrpsPerLead | null) => void;
}

export interface CrossingDetection {
  leads: number[];
  /** Members that crossed both obs and fcst thresholds (Δt computed). */
  nCrossed: number[];
  /** Members where obs crossed but fcst did not. */
  nObsOnly: number[];
  /** Members where neither crossed (obs below threshold for the window). */
  nNoObs: number[];
  /** Total member count contributing to this lead (typically MEMBER_COUNT). */
  nTotal: number[];
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [riverId, setRiverId] = useState<number | null>(null);
  const [reach, setReach] = useState<ReachMetadata | null>(null);
  const [retro, setRetro] = useState<TimeSeries | null>(null);
  const [simRp, setSimRp] = useState<RpThresholds | null>(null);
  const [eventData, setEventData] = useState<TimeSeries | null>(null);
  const [historicalData, setHistoricalData] = useState<TimeSeries | null>(null);
  const [historicalClampedNegatives, setHistoricalClampedNegatives] = useState(0);
  const [obsRp, setObsRp] = useState<RpThresholds | null>(null);
  const [forecasts, setForecasts] = useState<Map<string, ForecastResult>>(new Map());
  const [forecastProgress, setForecastProgress] = useState<{ done: number; total: number } | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [leadBuckets, setLeadBuckets] = useState<LeadBuckets | null>(null);
  const [mccDistribution, setMccDistribution] = useState<PerLeadDistribution | null>(null);
  const [hssDistribution, setHssDistribution] = useState<PerLeadDistribution | null>(null);
  const [peakTimingDistribution, setPeakTimingDistribution] = useState<PerLeadDistribution | null>(null);
  const [crossingDistributions, setCrossingDistributions] = useState<
    Record<number, PerLeadDistribution> | null
  >(null);
  const [crossingDetections, setCrossingDetections] = useState<
    Record<number, CrossingDetection> | null
  >(null);
  const [eventReturnPeriod, setEventReturnPeriod] = useState<number | null>(null);
  const [crpsResults, setCrpsResults] = useState<CrpsPerLead | null>(null);

  const value = useMemo<AppState>(
    () => ({
      riverId, setRiverId,
      reach, setReach,
      retro, setRetro,
      simRp, setSimRp,
      eventData, setEventData,
      historicalData, setHistoricalData,
      historicalClampedNegatives, setHistoricalClampedNegatives,
      obsRp, setObsRp,
      forecasts, setForecasts,
      forecastProgress, setForecastProgress,
      selectedDate, setSelectedDate,
      leadBuckets, setLeadBuckets,
      mccDistribution, setMccDistribution,
      hssDistribution, setHssDistribution,
      peakTimingDistribution, setPeakTimingDistribution,
      crossingDistributions, setCrossingDistributions,
      crossingDetections, setCrossingDetections,
      eventReturnPeriod, setEventReturnPeriod,
      crpsResults, setCrpsResults,
    }),
    [riverId, reach, retro, simRp, eventData, historicalData, historicalClampedNegatives, obsRp, forecasts, forecastProgress, selectedDate, leadBuckets, mccDistribution, hssDistribution, peakTimingDistribution, crossingDistributions, crossingDetections, eventReturnPeriod, crpsResults],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
}
