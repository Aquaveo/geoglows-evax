/**
 * One reading measure for every prose block in the app.
 *
 * Shared rather than per-file because it drifted three times. It was applied to
 * some named styles and not others, never to inline `<p style={{…}}>` elements,
 * and not at all in OverviewTab — so two paragraphs inside one box wrapped at
 * different widths, which reads as a broken layout rather than a text column.
 *
 * Deliberately NOT applied to plots, tables or the section boxes themselves:
 * those need the full content width, and it is the page container (App.tsx) that
 * keeps them to a sane size.
 */
export const PROSE_MAX = '46rem';
