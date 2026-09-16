import { SITE, absoluteUrl } from "@/lib/site";
import type { FaqItem, ToolDef } from "@/lib/tools/types";

/**
 * JSON-LD builders. Rendered into pages as <script type="application/ld+json">
 * to help search engines and AI answer engines (GEO) understand the content.
 */

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE.name,
    url: absoluteUrl("/"),
    description: SITE.description,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: absoluteUrl("/?q={search_term_string}"),
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export function toolItemListJsonLd(tools: ToolDef[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${SITE.name} tools`,
    itemListElement: tools.map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: absoluteUrl(`/${t.category}/${t.slug}`),
      name: t.title,
    })),
  };
}

export function softwareAppJsonLd(tool: ToolDef) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: tool.title,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Any (web browser)",
    url: absoluteUrl(`/${tool.category}/${tool.slug}`),
    description: tool.description,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    isAccessibleForFree: true,
    browserRequirements: "Requires JavaScript.",
    publisher: { "@type": "Organization", name: SITE.name },
  };
}

export function breadcrumbJsonLd(
  crumbs: { name: string; path: string }[],
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: absoluteUrl(c.path),
    })),
  };
}

export function faqJsonLd(faq: FaqItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

/** Helper to render a JSON-LD object safely. */
export function jsonLdScript(data: unknown) {
  return {
    __html: JSON.stringify(data).replace(/</g, "\\u003c"),
  };
}
