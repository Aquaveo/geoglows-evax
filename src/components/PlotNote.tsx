import type { ReactNode } from 'react';

/**
 * Short interpretation caption rendered under a plot. Says what the reader
 * should conclude from the shapes on screen, not what the axes are.
 */
export function PlotNote({ children }: { children: ReactNode }) {
  return (
    // Full width, matching blockIntro and the Setup-tab notes. A `ch`-based cap
    // reads as a cropped ribbon under a full-width plot.
    <p style={{ marginTop: '0.6rem', color: '#555', fontSize: '0.9rem', lineHeight: 1.6 }}>
      <strong>Reading the plot:</strong> {children}
    </p>
  );
}
