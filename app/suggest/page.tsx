import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { SuggestForm } from "@/components/suggest-form";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Suggest a Tool",
  description:
    "Missing a utility on Bench? Suggest a new tool and it may get built. Submissions become public GitHub issues.",
  alternates: { canonical: "/suggest" },
};

export default function SuggestPage() {
  return (
    <div className="px-4 py-5 sm:px-5 lg:px-8">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[12.5px] text-muted">
        <Link href="/" className="hover:text-ink">
          All tools
        </Link>
        <ChevronRight size={12} className="text-faint" />
        <span className="text-ink">Suggest a tool</span>
      </nav>

      <div className="mt-2 max-w-2xl">
        <h1 className="text-[22px] font-semibold text-ink">Suggest a tool</h1>
        <p className="mt-1.5 text-[14px] text-muted">
          Tell us what {SITE.name} is missing and what it should do. Suggestions are filed as public
          GitHub issues you can follow; the useful ones get built.
        </p>
      </div>

      <div className="mt-6 max-w-2xl">
        <SuggestForm />
      </div>
    </div>
  );
}
