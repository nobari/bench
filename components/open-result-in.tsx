"use client";
import { useState } from "react";
import { createHandoff, type HandoffTarget } from "@/lib/tool-handoff";
import { SHARE_SYNC_EVENT } from "@/components/share-button";
import { writeShareStateToUrl } from "@/lib/share-state";
const LABELS: Record<HandoffTarget, string> = {
  json: "JSON Viewer",
  schema: "JSON Schema",
  text: "Base64 / Text",
};
export function OpenResultIn({
  value,
  targets,
}: {
  value: string;
  targets: HandoffTarget[];
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const validJson = (() => {
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  })();
  const available = targets.filter((t) => t === "text" || validJson);
  if (!value || !available.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <label className="flex items-center gap-2 text-muted">
        Open result in
        <select
          aria-label="Open result in"
          value=""
          disabled={busy}
          onChange={(e) => {
            const target = e.target.value as HandoffTarget;
            if (!available.includes(target)) return;
            try {
              // Preserve the source in its own history entry, without invoking the online shortener.
              window.dispatchEvent(new CustomEvent(SHARE_SYNC_EVENT));
              writeShareStateToUrl();
              const path = createHandoff(target, value);
              setBusy(true);
              window.location.assign(path);
            } catch {
              setError(
                "Could not transfer this result. Browser storage may be full or unavailable; copy the result instead.",
              );
              setBusy(false);
            }
          }}
          className="h-9 max-w-full rounded border border-edge bg-surface px-2 text-ink"
        >
          <option value="">Choose tool…</option>
          {available.map((t) => (
            <option key={t} value={t}>
              {LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
