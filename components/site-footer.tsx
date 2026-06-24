import Link from "next/link";
import { CATEGORIES } from "@/lib/tools/categories";
import { SITE } from "@/lib/site";
import { GithubMark } from "@/components/icons";

export function SiteFooter() {
  return (
    <footer className="relative z-[2] mt-24 border-t border-edge bg-base-2">
      <div className="mx-auto max-w-[1240px] px-4 py-12 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-display text-base font-extrabold tracking-tight text-ink">
                {SITE.wordmark}
              </span>
              <span aria-hidden className="h-3 w-[3px] translate-y-[1px] bg-signal" />
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted">
              {SITE.tagline}. Every tool runs entirely in your browser — no
              uploads, no tracking, no limits.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <a
                href={SITE.links.github}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub"
                className="text-muted transition-colors hover:text-ink"
              >
                <GithubMark className="h-5 w-5" />
              </a>
            </div>
          </div>

          <nav aria-label="Tool categories">
            <p className="readout mb-3">Categories</p>
            <ul className="space-y-2">
              {CATEGORIES.slice(0, 4).map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/${c.slug}`}
                    className="text-sm text-muted transition-colors hover:text-ink"
                  >
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="More categories and links">
            <p className="readout mb-3">More</p>
            <ul className="space-y-2">
              {CATEGORIES.slice(4).map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/${c.slug}`}
                    className="text-sm text-muted transition-colors hover:text-ink"
                  >
                    {c.name}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href="/suggest"
                  className="text-sm text-signal-dim transition-colors hover:text-signal"
                >
                  Suggest a tool →
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-edge pt-6 font-mono text-xs text-faint sm:flex-row sm:items-center sm:justify-between">
          <span>
            © {new Date().getFullYear()} {SITE.name}. Built for the browser.
          </span>
          <span className="tabular">100% client-side · 0 bytes uploaded</span>
        </div>
      </div>
    </footer>
  );
}
