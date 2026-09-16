import { NextResponse } from "next/server";
import { shortUrlFor, validateLongUrl, type ShortenResponse } from "@/lib/tools/web/shortlink";
import { createShortLink, maintainStore, storageConfigured } from "@/lib/server/shortlinks";
import { getBaseUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

/* Best-effort per-IP limiter; instances are reused under Fluid Compute so this
   catches casual abuse without needing a database. */
const WINDOW_MS = 10 * 60_000;
const MAX_PER_WINDOW = 30;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

function requestOrigin(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  return host ? `${proto}://${host}` : getBaseUrl();
}

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  if (!storageConfigured())
    return NextResponse.json(
      { error: "Link storage isn't configured on this deployment." },
      { status: 503, headers: NO_STORE },
    );

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "anon";
  if (rateLimited(ip))
    return NextResponse.json(
      { error: "Too many links from this address — try again in a few minutes." },
      { status: 429, headers: NO_STORE },
    );

  let raw = "";
  try {
    const body = (await req.json()) as { url?: unknown };
    raw = typeof body?.url === "string" ? body.url : "";
  } catch {
    return NextResponse.json({ error: "Send JSON like { \"url\": \"https://…\" }." }, { status: 400, headers: NO_STORE });
  }

  const v = validateLongUrl(raw);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400, headers: NO_STORE });

  try {
    const { code, reused } = await createShortLink(v.value);
    let store: ShortenResponse["store"];
    try {
      store = await maintainStore();
    } catch (e) {
      console.error("shortlink maintenance failed", e);
    }
    const res: ShortenResponse = { code, shortUrl: shortUrlFor(requestOrigin(req), code), reused, store };
    return NextResponse.json(res, { headers: NO_STORE });
  } catch (e) {
    console.error("shortlink create failed", e);
    return NextResponse.json(
      { error: "Couldn't save the link right now — try again in a moment." },
      { status: 502, headers: NO_STORE },
    );
  }
}
