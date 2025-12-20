"use client";

import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  handleCopy = async (): Promise<void> => {
    if (!this.state.error) return;
    const payload = JSON.stringify({ name: this.state.error.name, message: this.state.error.message, stack: this.state.error.stack }, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      // clipboard unavailable; silent
    }
  };

  handleReset = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <section className="surface" role="alert">
          <p className="eyebrow">Something broke</p>
          <h2>Simulation could not complete.</h2>
          <pre className="error-detail">{this.state.error.message}</pre>
          <div className="surface-heading-actions">
            <button type="button" onClick={this.handleCopy}>Copy diagnostics</button>
            <button type="button" className="button-primary" onClick={this.handleReset}>Try again</button>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}
