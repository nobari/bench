import { pageMetadata } from "@/lib/seo";
import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { TOOLS } from "@/lib/tools/registry";

export const metadata: Metadata = pageMetadata(
  "About Bench",
  "How Bench works: browser-based utilities, sharing, online services and open-source development.",
  "/about",
);

export default function AboutPage() {
  return (
    <div className="px-4 py-6 sm:px-5 lg:px-8 lg:py-8">
      <div className="max-w-prose space-y-8 text-[14px] leading-relaxed text-muted">
        <div>
          <h1 className="text-[22px] font-semibold text-ink">
            About {SITE.name}
          </h1>
          <p className="mt-3">
            {SITE.name} is a collection of {TOOLS.length} small utilities you
            reach for during a normal working day: encode or decode text,
            inspect JSON, hash a string, convert a date, resize an image, unpack
            an archive, shorten a link. Open the tool, do the task, get back to
            work.
          </p>
        </div>

        <section>
          <h2 className="text-[15px] font-semibold text-ink">How it works</h2>
          <p className="mt-2">
            Most tools process text, files and images locally in your browser.
            Network features are exceptions: the URL shortener stores
            destinations on a server, wallet network lookups and broadcasts
            contact the selected provider, and suggestions are published as
            GitHub issues. Analytics and performance services receive usage
            data; the Google Analytics integration strips query strings and
            fragments from page views and respects Do Not Track and Global
            Privacy Control.
          </p>
          <p className="mt-2">
            The state of a tool lives in its URL, so the Share button on any
            page gives you a link that reopens the same input and settings. Long
            links are shortened automatically, which stores the complete
            destination URL, including any input encoded in it, on the server.
            Only share content you intend recipients to see.
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
            under the MIT license. Adding a tool is a small, well-documented
            change — contributions and{" "}
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
