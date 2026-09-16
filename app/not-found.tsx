import Link from "next/link";

export default function NotFound() {
  return (
    <div className="px-4 py-6 sm:px-5 lg:px-8 lg:py-8">
      <div className="max-w-prose">
        <h1 className="text-[22px] font-semibold text-ink">Page not found</h1>
        <p className="mt-2 text-[14px] text-muted">
          There is no tool at this address. It may have moved, or the link is out of date.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex h-9 items-center rounded-[var(--radius-sm)] bg-accent px-3.5 text-[13.5px] font-medium text-on-accent hover:bg-[var(--color-accent-hover)]"
        >
          Browse all tools
        </Link>
      </div>
    </div>
  );
}
