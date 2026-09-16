import Link from "next/link";
import { SITE } from "@/lib/site";

export function SiteFooter() {
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
    </footer>
  );
}
