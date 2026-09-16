import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { TOOLS } from "@/lib/tools/registry";

export const metadata: Metadata = {
  title: "About",
  description: `About ${SITE.name} — a fast, private, browser-based toolkit for everyday text, data, image and file tasks.`,
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <div className="px-4 py-6 sm:px-5 lg:px-8 lg:py-8">
      <div className="max-w-prose space-y-8 text-[14px] leading-relaxed text-muted">
        <div>
          <h1 className="text-[22px] font-semibold text-ink">About {SITE.name}</h1>
          <p className="mt-3">
            {SITE.name} is a collection of {TOOLS.length} small utilities you reach for during a normal
            working day: encode or decode text, inspect JSON, hash a string, convert a date, resize an
            image, unpack an archive, shorten a link. Open the tool, do the task, get back to work.
          </p>
        </div>

        <section>
          <h2 className="text-[15px] font-semibold text-ink">How it works</h2>
          <p className="mt-2">
            Every tool runs in your browser. Your text, files and images are processed on your device
            and never uploaded — the pages are static and there is no account, no quota and no tracking of
            what you paste. The one exception is the{" "}
            <Link href="/web/short-url" className="text-accent hover:underline">
              URL shortener
            </Link>
            , which has to store the destination on a server; it says so on its page. Page views are
            counted anonymously with Google Analytics — without query strings, so your inputs never reach
            it, and not at all for browsers that send Do Not Track or Global Privacy Control.
          </p>
          <p className="mt-2">
            The state of a tool lives in its URL, so the Share button on any page gives you a link that
            reopens the same input and settings. Long links are shortened automatically.
          </p>
        </section>

        <section>
          <h2 className="text-[15px] font-semibold text-ink">Open source</h2>
          <p className="mt-2">
            The code is on{" "}
            <a
              href={SITE.links.github}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              GitHub
            </a>{" "}
            under the MIT license. Adding a tool is a small, well-documented change — contributions and{" "}
            <Link href="/suggest" className="text-accent hover:underline">
              suggestions
            </Link>{" "}
            are welcome.
          </p>
        </section>
      </div>
    </div>
  );
}
