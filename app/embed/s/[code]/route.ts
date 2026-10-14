import { NextResponse } from "next/server";
import { CODE_RE } from "@/lib/tools/web/shortlink";
import { resolveShortLink, storageConfigured } from "@/lib/server/shortlinks";

export const dynamic = "force-dynamic";

/** `/embed/s/<code>` → 302 to the embed page of the stored destination, state and all. */
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
  const back = new URL(`/web/short-url?missing=${encodeURIComponent(code)}`, req.url);
  if (!target) return NextResponse.redirect(back, { status: 302, headers: { "Cache-Control": "no-store" } });
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return NextResponse.redirect(back, { status: 302, headers: { "Cache-Control": "no-store" } });
  }
  if (!/^\/[a-z0-9-]+\/[a-z0-9-]+\/?$/.test(url.pathname)) return NextResponse.redirect(back, { status: 302, headers: { "Cache-Control": "no-store" } });
  const embed = new URL(req.url);
  embed.pathname = `/embed${url.pathname.replace(/\/$/, "")}`;
  embed.search = url.search;
  embed.hash = url.hash;
  return NextResponse.redirect(embed, {
    status: 302,
    headers: { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600", "X-Robots-Tag": "noindex, nofollow" },
  });
}
