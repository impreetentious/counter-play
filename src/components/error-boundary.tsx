"use client";

import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  copyStatus: "idle" | "ok" | "fail";
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, copyStatus: "idle" };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error, copyStatus: "idle" };
  }

  handleCopy = async (): Promise<void> => {
    if (!this.state.error) return;
    const payload = JSON.stringify(
      { name: this.state.error.name, message: this.state.error.message, stack: this.state.error.stack },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(payload);
      this.setState({ copyStatus: "ok" });
    } catch {
      this.setState({ copyStatus: "fail" });
    }
  };

  handleReset = (): void => {
    this.setState({ error: null, copyStatus: "idle" });
  };

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <section className="surface" role="alert">
          <p className="eyebrow">Something broke</p>
          <h2>This surface could not render.</h2>
          <p className="surface-summary">
            The workspace recovered without losing your scenario. Copy the diagnostics if you want to keep a trace, then try again or switch surfaces.
          </p>
          <pre className="error-detail">{this.state.error.message}</pre>
          <div className="surface-heading-actions">
            <button type="button" onClick={this.handleCopy}>Copy diagnostics</button>
            <button type="button" className="button-primary" onClick={this.handleReset}>Try again</button>
          </div>
          {this.state.copyStatus === "ok" ? <p className="share-status ok" role="status">Diagnostics copied.</p> : null}
          {this.state.copyStatus === "fail" ? (
            <p className="share-status error" role="status">
              Clipboard blocked — select the message above and copy manually.
            </p>
          ) : null}
        </section>
      );
    }
    return this.props.children;
  }
}
