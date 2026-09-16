import { NextResponse } from "next/server";
import { CODE_RE } from "@/lib/tools/web/shortlink";
import { resolveShortLink, storageConfigured } from "@/lib/server/shortlinks";

export const dynamic = "force-dynamic";

/** `/s/<code>` → 302 to the stored destination, or back to the tool if unknown. */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;

  let target: string | null = null;
  if (CODE_RE.test(code) && storageConfigured()) {
    try {
      target = await resolveShortLink(code);
    } catch (e) {
      console.error("shortlink resolve failed", e);
    }
  }

  if (!target) {
    const back = new URL(`/web/short-url?missing=${encodeURIComponent(code)}`, req.url);
    return NextResponse.redirect(back, { status: 302, headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.redirect(target, {
    status: 302,
    headers: {
      // Short CDN cache keeps popular links cheap; an evicted link lingers a few minutes at most.
      "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
