import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** What failed, for the heading. */
  label: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  stack: string | null;
}

/**
 * Catches a render-time throw and shows the message instead of a blank tab.
 *
 * Without one, a single bad value anywhere in a long tab unmounts the whole
 * React tree and the user sees nothing at all — no clue which section failed or
 * why. The tab is a long list of independent metric blocks, so a failure in one
 * should not take the others down with it.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Also to the console, so the full React stack is available there.
    console.error(`[${this.props.label}]`, error, info.componentStack);
    this.setState({ stack: info.componentStack ?? null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={box}>
        <strong>{this.props.label} could not be rendered.</strong>
        <pre style={pre}>
          {this.state.error.message}
          {this.state.error.stack ? `\n\n${this.state.error.stack}` : ''}
          {this.state.stack ?? ''}
        </pre>
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
          The rest of the tab is unaffected. Copy this text when reporting the problem.
        </p>
      </div>
    );
  }
}

const box: React.CSSProperties = {
  margin: '1rem 0',
  padding: '0.9rem 1.1rem',
  border: '1px solid #fca5a5',
  background: '#fef2f2',
  borderRadius: 6,
  color: '#7f1d1d',
};
const pre: React.CSSProperties = {
  margin: '0.5rem 0 0',
  padding: '0.6rem',
  background: '#fff',
  border: '1px solid #fecaca',
  borderRadius: 4,
  fontSize: '0.75rem',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: 320,
  overflow: 'auto',
};
