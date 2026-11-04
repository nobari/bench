"use client";
import { Component, Fragment, type ReactNode } from "react";
export class ToolErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; attempt: number }
> {
  state = { failed: false, attempt: 0 };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div role="alert" className="panel p-6">
          <h2 className="text-base font-semibold">
            This tool couldn’t continue
          </h2>
          <p className="mt-2 text-sm text-muted">
            Try opening it again. Unsaved input may need to be re-entered;
            existing saved drafts remain on this device.
          </p>
          <button
            className="mt-4 rounded bg-accent px-4 py-2 text-sm text-on-accent"
            onClick={() =>
              this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }))
            }
          >
            Try again
          </button>
          <button
            className="ml-3 text-sm text-muted"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </div>
      );
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}
