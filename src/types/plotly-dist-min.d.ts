// plotly.js-dist-min ships the same runtime API as plotly.js but no .d.ts.
// Forward the types from @types/plotly.js so we can typecheck cleanly while
// still bundling the smaller dist.
declare module 'plotly.js-dist-min' {
  export * from 'plotly.js';
  import type * as Plotly from 'plotly.js';
  const _default: typeof Plotly;
  export default _default;
}
