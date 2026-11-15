import { absoluteUrl } from "@/lib/site";
import { USERSCRIPT_FILE, userscriptSource } from "@/lib/tools/media/instagram";

/**
 * The Instagram Video Downloader's userscript, as a file a userscript manager offers to install
 * (it recognises the `.user.js` ending). Written once at build time: no request runs any code.
 */
export const dynamic = "force-static";

export function GET() {
  const body = userscriptSource(absoluteUrl("/media/instagram-video"), absoluteUrl(`/userscripts/${USERSCRIPT_FILE}`));
  return new Response(body, {
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
