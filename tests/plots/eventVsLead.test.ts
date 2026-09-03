import { describe, expect, it } from 'vitest';
import { eventVsLeadFigure, type LeadSeries } from '../../src/plots/eventVsLead';
import type { TimeSeries } from '../../src/lib/types';

const T0 = Date.UTC(2026, 0, 9);
const SIM_RP = { 2: 511, 5: 1344, 10: 1895, 25: 2592, 50: 3109, 100: 3622 };

const series = (n: number, f: (i: number) => number): TimeSeries => ({
  time: Array.from({ length: n }, (_, i) => new Date(T0 + i * 3 * 3600 * 1000)),
  values: Array.from({ length: n }, (_, i) => f(i)),
});
const EVENT = series(24, (i) => 300 + i * 50);
const LEADS: LeadSeries[] = [1, 5, 15].map((lead) => ({ lead, series: series(24, (i) => 300 + i * 40) }));

const nameOf = (f: ReturnType<typeof eventVsLeadFigure>, pred: (n: string) => boolean) =>
  f.data.map((t) => String((t as { name?: string }).name)).find(pred);

describe('eventVsLeadFigure reference label', () => {
  /**
   * The flood-check tab has no uploaded observations and uses the model's own
   * retrospective as the reference. That is a hindcast, not a measurement, so
   * the trace must not be called "Observed" — the label is the claim.
   */
  it('names the reference trace from eventLabel, in both the name and the hover', () => {
    const f = eventVsLeadFigure(EVENT, LEADS, {
      statLabel: 'Ensemble median',
      maxLead: 15,
      simRp: SIM_RP,
      eventLabel: 'Retrospective (model hindcast)',
    });
    const ref = f.data.find(
      (t) => (t as { name?: string }).name === 'Retrospective (model hindcast)',
    ) as { hovertemplate?: string } | undefined;
    expect(ref).toBeDefined();
    expect(ref!.hovertemplate).toContain('Retrospective (model hindcast)');
    expect(ref!.hovertemplate).not.toContain('Observed');
    expect(nameOf(f, (n) => n.includes('Observed'))).toBeUndefined();
  });

  it('still says Observed when no label is given, so the Forecast tab is unchanged', () => {
    const f = eventVsLeadFigure(EVENT, LEADS, { statLabel: 'Ensemble median', maxLead: 15 });
    const ref = f.data.find((t) => (t as { name?: string }).name === 'Observed (event)') as
      | { hovertemplate?: string }
      | undefined;
    expect(ref).toBeDefined();
    expect(ref!.hovertemplate).toContain('Observed');
  });

  it('gives every lead a legend entry and draws only the requested ones', () => {
    const f = eventVsLeadFigure(EVENT, LEADS, {
      statLabel: 'Ensemble median',
      maxLead: 15,
      visibleLeads: [5],
    });
    const leadTraces = f.data.filter((t) =>
      String((t as { name?: string }).name).startsWith('Lead '),
    ) as Array<{ name: string; visible?: string | boolean }>;
    expect(leadTraces.map((t) => t.name)).toEqual(['Lead 1 d', 'Lead 5 d', 'Lead 15 d']);
    expect(leadTraces.filter((t) => t.visible !== 'legendonly').map((t) => t.name)).toEqual([
      'Lead 5 d',
    ]);
  });

  it('renders the reference alone when no lead series survive the window', () => {
    const f = eventVsLeadFigure(EVENT, [], {
      statLabel: 'Ensemble median',
      maxLead: 15,
      eventLabel: 'Retrospective (model hindcast)',
    });
    expect(nameOf(f, (n) => n.startsWith('Lead '))).toBeUndefined();
    expect(nameOf(f, (n) => n.includes('Retrospective'))).toBeDefined();
  });
});
