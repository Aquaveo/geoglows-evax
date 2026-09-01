import { useMemo, useState, type ReactNode } from 'react';
import type { ForecastResult } from '../data/rfs';
import type { LeadBuckets, RpThresholds, TimeSeries } from '../lib/types';
import type { ReachMetadata } from '../data/reachMetadata';
import type { PerLeadDistribution } from '../plots/distributionVsLead';
import type { CrpsPerLead } from '../lib/metrics/crps';
import { Ctx, type AppState, type CrossingDetection } from './appState';

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

