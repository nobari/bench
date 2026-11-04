"use client";
export function ClipboardFallback({
  value,
  onClose,
}: {
  value: string;
  onClose: () => void;
}) {
  return (
    <div className="mt-2 w-full min-w-0 rounded border border-edge bg-surface p-3 text-left">
      <p role="alert" className="text-xs text-danger">
        Clipboard access failed. Select the text below and copy it manually.
      </p>
      <textarea
        aria-label="Text to copy manually"
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className="mt-2 block h-20 w-full min-w-0 rounded border border-edge bg-base p-2 font-mono text-xs text-ink"
      />
      <button
        type="button"
        onClick={onClose}
        className="mt-2 text-xs text-muted"
      >
        Dismiss
      </button>
    </div>
  );
}
