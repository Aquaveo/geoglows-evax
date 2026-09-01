/**
 * Shared app state: the context object, its type, and the hook that reads it.
 *
 * Split out of AppContext.tsx so that file exports ONLY the provider component.
 * Vite's react-refresh plugin can hot-reload a module whose every export is a
 * component; one that also exports a hook or a type falls back to a full reload
 * and drops all state on each edit — which is what
 * react-refresh/only-export-components was reporting.
 *
 * AppState is exported now because the provider lives in another file and needs
 * it. It was previously module-private.
 */
import { createContext, useContext } from 'react';
import type { ForecastResult } from '../data/rfs';
import type { LeadBuckets, RpThresholds, TimeSeries } from '../lib/types';
import type { ReachMetadata } from '../data/reachMetadata';
import type { PerLeadDistribution } from '../plots/distributionVsLead';
import type { CrpsPerLead } from '../lib/metrics/crps';

export interface AppState {
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

export const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
}
