import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; resetKey?: string }
interface State { error: Error | null; resetKey?: string }

/**
 * Without this, an error while drawing any screen leaves the whole app blank. It shows what happened in
 * place of the broken part; with `resetKey` set to the screen's address, moving elsewhere tries again.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps({ resetKey }: Props, state: State) {
    return resetKey === state.resetKey ? null : { error: null, resetKey };
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty" role="alert">
        <h2>This screen could not be shown</h2>
        <p>{this.state.error.message}</p>
        <p className="hint">Nothing in your logbook has been deleted. Go to another screen, or reload the app. Do not clear site data.</p>
        <button type="button" className="btn tonal" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}
