import Link from "next/link";
import { SITE } from "@/lib/site";
import { CopyButton } from "@/components/copy-button";
import pkg from "@/package.json";

export function SiteFooter() {
  // Baked in at build time on Vercel: which release this page is.
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  const version = `v${pkg.version}`;
  return (
    <footer className="mt-16 border-t border-edge px-5 py-6 text-[13px] text-muted lg:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl">
          {SITE.name} is open source. Every tool runs in your browser; only the{" "}
          <Link href="/web/short-url" className="text-ink underline decoration-edge-bright underline-offset-2 hover:decoration-ink">
            URL shortener
          </Link>{" "}
          stores anything on a server.
        </p>
        <nav aria-label="Site" className="flex items-center gap-4">
          {sha ? (
            <a
              href={`${SITE.links.github}/commit/${process.env.VERCEL_GIT_COMMIT_SHA}`}
              target="_blank"
              rel="noopener noreferrer"
              title={`Release ${version} · commit ${sha}`}
              className="font-mono text-[12px] text-faint hover:text-ink"
            >
              {version} · {sha}
            </a>
          ) : (
            <span title="Release" className="font-mono text-[12px] text-faint">
              {version}
            </span>
          )}
          <Link href="/about" className="hover:text-ink">
            About
          </Link>
          <Link href="/suggest" className="hover:text-ink">
            Suggest a tool
          </Link>
          <a href={SITE.links.github} target="_blank" rel="noopener noreferrer" className="hover:text-ink">
            GitHub
          </a>
        </nav>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-edge pt-4 text-[12.5px] text-faint">
        <span>If {SITE.name} saves you time, you can support it with bitcoin:</span>
        <code className="break-all font-mono text-[12px] text-muted" title="Bitcoin address">
          {SITE.support.bitcoin}
        </code>
        <CopyButton value={SITE.support.bitcoin} label="Copy address" className="h-6 px-2 text-[11px]" />
      </div>
    </footer>
  );
}
