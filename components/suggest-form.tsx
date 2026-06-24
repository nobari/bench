"use client";

import { useActionState } from "react";
import { ArrowUpRight, CheckCircle2, Loader, Send } from "lucide-react";
import { suggestTool, type SuggestState } from "@/app/actions/suggest";
import { CATEGORIES } from "@/lib/tools/categories";

const initial: SuggestState = { status: "idle" };

export function SuggestForm() {
  const [state, formAction, pending] = useActionState(suggestTool, initial);

  if (state.status === "success") {
    const link = state.url ?? state.fallbackUrl;
    return (
      <div className="panel registered p-8 text-center">
        <CheckCircle2 size={28} className="mx-auto text-positive" />
        <h2 className="mt-4 font-display text-xl font-bold text-ink">
          {state.url ? "Suggestion received" : "One last step"}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
          {state.message}
        </p>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex h-10 items-center gap-2 rounded-[var(--radius)] border border-edge px-4 font-mono text-sm text-ink transition-colors hover:border-signal hover:text-signal"
          >
            {state.url ? "View on GitHub" : "Open prefilled issue"}
            <ArrowUpRight size={15} />
          </a>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="panel registered space-y-5 p-6 sm:p-8">
      {/* honeypot */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="pointer-events-none absolute left-[-9999px] h-0 w-0 opacity-0"
      />

      <Field label="Tool name" error={state.fieldErrors?.title}>
        <input
          name="title"
          required
          placeholder="e.g. Cron expression explainer"
          className="input"
        />
      </Field>

      <Field label="Category" hint="optional">
        <select name="category" defaultValue="" className="input">
          <option value="">No preference</option>
          {CATEGORIES.map((c) => (
            <option key={c.slug} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="What should it do?" error={state.fieldErrors?.description}>
        <textarea
          name="description"
          required
          rows={5}
          placeholder="Describe the tool, the inputs and outputs, and when you'd reach for it."
          className="input resize-y"
        />
      </Field>

      <Field label="Your email" hint="optional — only if you want a reply" error={state.fieldErrors?.email}>
        <input name="email" type="email" placeholder="you@example.com" className="input" />
      </Field>

      {state.status === "error" && state.message && (
        <p className="font-mono text-xs text-danger">{state.message}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius)] bg-signal px-5 font-mono text-sm font-semibold text-[#070806] transition-[filter] hover:brightness-110 disabled:opacity-50"
      >
        {pending ? (
          <>
            <Loader size={16} className="animate-spin" /> Sending…
          </>
        ) : (
          <>
            <Send size={15} /> Submit suggestion
          </>
        )}
      </button>
    </form>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between">
        <span className="readout">{label}</span>
        {hint && <span className="font-mono text-[10px] text-faint">{hint}</span>}
      </span>
      {children}
      {error && <span className="mt-1 block font-mono text-xs text-danger">{error}</span>}
    </label>
  );
}
