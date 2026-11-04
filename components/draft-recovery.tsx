"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  DRAFT_EVENT,
  deleteDraft,
  listDrafts,
  type DraftEntry,
} from "@/lib/draft-catalog";

export function DraftRecovery() {
  const [drafts, setDrafts] = useState<DraftEntry[]>([]);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void listDrafts()
        .then((v) => {
          if (active) setDrafts(v);
        })
        .catch(() => {
          if (active)
            setError(
              "Browser storage is unavailable; saved work cannot be listed.",
            );
        });
    };
    refresh();
    window.addEventListener(DRAFT_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      active = false;
      window.removeEventListener(DRAFT_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  const remove = async (id: string) => {
    setBusy(true);
    try {
      await deleteDraft(id);
      setDrafts(await listDrafts());
      setDeleting(null);
      setError("");
    } catch {
      setError("Could not remove this saved entry. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  if (!drafts.length && !error) return null;
  return (
    <section
      aria-label="Resume your work"
      className="mt-5 rounded-[var(--radius)] border border-edge p-4"
    >
      <h2 className="text-sm font-semibold">Resume your work</h2>
      <p className="mt-1 text-xs text-muted">
        Saved on this device. Clearing browser data can remove drafts. Export
        important work. Wallets and passwords are excluded.
      </p>
      <ul className="mt-3 divide-y divide-edge">
        {drafts.map((d) => (
          <li
            key={d.id}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div>
              <Link
                href={d.path}
                className="text-sm font-medium text-accent hover:underline"
              >
                Resume {d.title}
              </Link>
              <p className="mt-1 text-xs text-muted">{d.detail}</p>
              <p className="mt-1 text-xs text-faint">
                {d.savedAt
                  ? `Saved ${new Date(d.savedAt).toLocaleString()}`
                  : "Saved before timestamps were recorded"}
              </p>
            </div>
            {deleting === d.id ? (
              <div className="text-xs">
                <p className="mb-2">
                  {d.id === "video"
                    ? "Forget this entry? Your files on disk will stay."
                    : "Delete this browser draft? This cannot be undone."}
                </p>
                <button
                  disabled={busy}
                  onClick={() => void remove(d.id)}
                  className="mr-3 text-danger"
                >
                  {busy ? "Removing…" : "Confirm removal"}
                </button>
                <button disabled={busy} onClick={() => setDeleting(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setDeleting(d.id)}
                className="text-xs text-muted hover:text-danger"
              >
                {d.id === "video" ? "Forget entry" : "Delete draft"}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
