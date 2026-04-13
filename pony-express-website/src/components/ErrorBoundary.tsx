import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-8">
          <div className="glass-card p-8 max-w-md w-full text-center">
            <h1 className="font-display font-bold text-2xl mb-4">Something went wrong</h1>
            <p className="text-sm mb-6" style={{ color: "oklch(1 0 0 / 50%)" }}>
              {this.state.error?.message ?? "An unexpected error occurred."}
            </p>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="px-6 py-2 rounded-full text-sm font-medium"
              style={{ background: "oklch(0.45 0.15 25)", color: "oklch(0.92 0.05 80)" }}
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
