import { Component, ErrorInfo, ReactNode } from "react";

/**
 * A safety net: if part of the window fails to draw, show what happened with a way back instead
 * of a blank window (and write it to the log, for Help › Report a Problem).
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Picaluma window error:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash">
        <div className="crash-box">
          <h3>Something went wrong</h3>
          <p>Picaluma couldn't draw this screen. Your pictures and edits are safe.</p>
          <pre>{String(error.message || error)}</pre>
          <div className="foot">
            <button className="tbtn default" onClick={() => this.setState({ error: null })}>
              Try Again
            </button>
            <button className="tbtn" onClick={() => location.reload()}>
              Reload Picaluma
            </button>
          </div>
        </div>
      </div>
    );
  }
}
