/**
 * Instagram video links — the pure half of the Instagram Video Downloader.
 *
 * Instagram answers an anonymous request for a post with an error page, so nothing here (or anywhere
 * in Bench) fetches a post from a server. The post's own page, opened in a browser that is signed
 * in, carries the data the player uses: a media object with `video_versions` (MP4 files with sound)
 * and a DASH manifest (sharper video-only files plus the sound on its own). That page reaches this
 * module one of two ways:
 *
 *   • the bookmarklet (`bookmarkletSource`), run on the post, picks the media object out of the page
 *     and opens Bench with a compact copy in the URL hash (`encodeHandoff` / `decodeHandoff`), or
 *   • the page's source, pasted into the tool (`findMediaInHtml`).
 *
 * Both end in `readMedia`, which turns the compact copy into the list of files to show. Addresses
 * are only accepted on Instagram's own file hosts, because a hash is something anyone can write.
 */

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/* ───────────────────────── the link ───────────────────────── */

export type IgLinkKind = "p" | "reel" | "tv";
export interface IgLink {
  code: string;
  kind: IgLinkKind;
  /** The canonical address of the post. */
  url: string;
}

const CODE = "[A-Za-z0-9_-]{5,40}";
const HOSTS = new Set(["instagram.com", "www.instagram.com", "m.instagram.com", "instagr.am", "www.instagr.am"]);

/** The shortcode in a path like /reel/<code>/, /reels/<code>/, /p/<code>/, /tv/<code>/ or /<user>/reel/<code>/. */
export function codeFromPath(path: string): { code: string; kind: IgLinkKind } | null {
  const m = new RegExp(`^/(?:[A-Za-z0-9._]+/)?(p|reels?|tv)/(${CODE})(?:/|$)`).exec(path);
  if (!m) return null;
  return { code: m[2], kind: m[1] === "p" ? "p" : m[1] === "tv" ? "tv" : "reel" };
}

export function parseInstagramLink(raw: string): Result<IgLink> {
  const text = raw.trim();
  if (!text) return { ok: false, error: "Paste the link of an Instagram reel or post." };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, error: "That is not a web address." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "That is not a web address." };
  if (!HOSTS.has(url.hostname.toLowerCase()))
    return { ok: false, error: "That is not an instagram.com link." };
  const path = url.pathname.replace(/\/{2,}/g, "/");
  if (/^\/share\//.test(path))
    return {
      ok: false,
      error: "A share link only redirects. Open it in your browser and copy the address it lands on (…/reel/… or …/p/…).",
    };
  if (/^\/stories\//.test(path)) return { ok: false, error: "Stories are not supported — only reels, posts and videos." };
  const found = codeFromPath(path);
  if (!found)
    return { ok: false, error: "No reel or post in that link. It should look like instagram.com/reel/…/ or instagram.com/p/…/." };
  return { ok: true, value: { ...found, url: `https://www.instagram.com/${found.kind}/${found.code}/` } };
}

/* ───────────────────────── the compact copy ───────────────────────── */

/** What the bookmarklet sends: the fields of Instagram's media object this tool reads, under short names. */
export interface SlimMedia {
  /** shortcode */
  c?: string;
  /** owner's username */
  u?: string;
  /** caption */
  t?: string;
  /** duration in seconds */
  d?: number;
  w?: number;
  h?: number;
  /** poster image */
  i?: string;
  /** files with sound: [url, width, height] */
  v?: [string, number?, number?][];
  /** DASH manifest (XML) */
  m?: string;
  /** the other items of a carousel post */
  k?: SlimMedia[];
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Has this media object (either of Instagram's two shapes) a video, itself or in its carousel? */
function hasVideo(o: Json): boolean {
  if (Array.isArray(o.video_versions) && o.video_versions.length) return true;
  if (str(o.video_url)) return true;
  if (Array.isArray(o.carousel_media) && o.carousel_media.some((k) => isObj(k) && hasVideo(k))) return true;
  const side = isObj(o.edge_sidecar_to_children) ? o.edge_sidecar_to_children.edges : null;
  return Array.isArray(side) && side.some((e) => isObj(e) && isObj(e.node) && hasVideo(e.node));
}

const codeOf = (o: Json): string | undefined => str(o.code) ?? str(o.shortcode);
const looksLikeMedia = (o: Json): boolean =>
  !!codeOf(o) && ("video_versions" in o || "video_url" in o || "image_versions2" in o || "display_url" in o);

/**
 * The media object for `code` anywhere inside a parsed JSON value; one with a video wins over one
 * without (the same post appears several times in a page, not always in full). Without a code, the
 * first media object that has a video.
 */
export function findMedia(root: unknown, code?: string): Json | null {
  let fallback: Json | null = null;
  const walk = (o: unknown, depth: number): Json | null => {
    if (!o || typeof o !== "object" || depth > 60) return null;
    if (isObj(o) && looksLikeMedia(o) && (!code || codeOf(o) === code)) {
      if (hasVideo(o)) return o;
      if (code && !fallback) fallback = o;
    }
    for (const v of Object.values(o as Json)) {
      const hit = walk(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  return walk(root, 0) ?? fallback;
}

/** Instagram's media object (the app shape or the older GraphQL shape) as the compact copy. */
export function slimMedia(o: Json): SlimMedia {
  const out: SlimMedia = {};
  const code = codeOf(o);
  if (code) out.c = code;
  const user = isObj(o.user) ? str(o.user.username) : isObj(o.owner) ? str(o.owner.username) : undefined;
  if (user) out.u = user;
  let caption = isObj(o.caption) ? str(o.caption.text) : undefined;
  if (!caption && isObj(o.edge_media_to_caption) && Array.isArray(o.edge_media_to_caption.edges)) {
    const first = o.edge_media_to_caption.edges[0];
    if (isObj(first) && isObj(first.node)) caption = str(first.node.text);
  }
  if (caption) out.t = caption.slice(0, 300);
  const d = num(o.video_duration);
  if (d) out.d = d;
  const dims = isObj(o.dimensions) ? o.dimensions : null;
  const w = num(o.original_width) ?? (dims ? num(dims.width) : undefined);
  const h = num(o.original_height) ?? (dims ? num(dims.height) : undefined);
  if (w) out.w = w;
  if (h) out.h = h;
  const candidates = isObj(o.image_versions2) && Array.isArray(o.image_versions2.candidates) ? o.image_versions2.candidates : [];
  const poster = (isObj(candidates[0]) ? str(candidates[0].url) : undefined) ?? str(o.display_url);
  if (poster) out.i = poster;
  const v: [string, number?, number?][] = [];
  if (Array.isArray(o.video_versions))
    for (const f of o.video_versions) if (isObj(f) && str(f.url)) v.push([f.url as string, num(f.width), num(f.height)]);
  if (str(o.video_url)) v.push([o.video_url as string, w, h]);
  if (v.length) out.v = v;
  const m = str(o.video_dash_manifest);
  if (m) out.m = m;
  const kids: Json[] = [];
  if (Array.isArray(o.carousel_media)) for (const k of o.carousel_media) if (isObj(k)) kids.push(k);
  const side = isObj(o.edge_sidecar_to_children) ? o.edge_sidecar_to_children.edges : null;
  if (Array.isArray(side)) for (const e of side) if (isObj(e) && isObj(e.node)) kids.push(e.node);
  if (kids.length) out.k = kids.map(slimMedia);
  return out;
}

/* ───────────────────────── page source ───────────────────────── */

/**
 * The media object in a saved or pasted Instagram page: the page keeps its data in
 * `<script type="application/json">` blocks. `code` narrows it to one post; without it the first
 * post with a video is taken (the page's own).
 */
export function findMediaInHtml(html: string, code?: string): Result<SlimMedia> {
  if (!/<script/i.test(html)) return { ok: false, error: "That is not a page's source — it has no script blocks." };
  const blocks = html.matchAll(/<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi);
  let sawPost = false;
  let fallback: Json | null = null;
  for (const b of blocks) {
    const text = b[1];
    if (!text.includes("video_versions") && !text.includes("video_url") && !(code && text.includes(code))) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    const hit = findMedia(parsed, code);
    if (!hit) continue;
    sawPost = true;
    if (hasVideo(hit)) return { ok: true, value: slimMedia(hit) };
    fallback ??= hit;
  }
  if (fallback) return { ok: true, value: slimMedia(fallback) };
  if (/^Content-Type:\s*multipart\/related/im.test(html.slice(0, 2000)))
    return {
      ok: false,
      error: "This is a single-file save (.mhtml), and no video data could be read from it. Save the page as “Webpage, HTML Only” instead, or copy its source.",
    };
  if (/"pageID":"httpErrorPage"/.test(html) || /LoginAndSignupPage|"loginPage"/.test(html))
    return {
      ok: false,
      error: "This is the page Instagram shows a visitor who is not signed in — it has no video in it. Copy the source while signed in.",
    };
  return {
    ok: false,
    error: sawPost || !code
      ? "No video found in this source. Copy the source of the reel's own page (View page source), while signed in."
      : `The post ${code} is not in this source. Copy the source of that post's own page (View page source), while signed in.`,
  };
}

/* ───────────────────────── the files ───────────────────────── */

export type IgFileKind = "video" | "video-only" | "audio-only";
export interface IgFile {
  url: string;
  kind: IgFileKind;
  width?: number;
  height?: number;
  /** bits per second, from the manifest */
  bitrate?: number;
  /** bytes, from the manifest */
  size?: number;
  /** e.g. "vp09.00.31.08", "avc1.64001f", "mp4a.40.5" */
  codecs?: string;
  /** when Instagram's signature on the address runs out (ms since 1970) */
  expires?: number;
}
export interface IgItem {
  files: IgFile[];
  poster?: string;
  width?: number;
  height?: number;
  duration?: number;
}
export interface IgMedia {
  code?: string;
  user?: string;
  caption?: string;
  /** One per video: a single reel has one, a carousel one per video in it. */
  items: IgItem[];
  /** Carousel entries that are photos, left out. */
  photos: number;
}

/** Instagram and Facebook's file hosts — the only places a file address may point. */
export function isInstagramFileUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  const h = u.hostname.toLowerCase();
  return h.endsWith(".cdninstagram.com") || h.endsWith(".fbcdn.net");
}

/** When the signature on a file address runs out: its `oe` parameter is the time in hex seconds. */
export function expiryOf(url: string): number | undefined {
  try {
    const oe = new URL(url).searchParams.get("oe");
    if (!oe || !/^[0-9a-f]{6,9}$/i.test(oe)) return undefined;
    return parseInt(oe, 16) * 1000;
  } catch {
    return undefined;
  }
}

const unxml = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|apos|#(\d+)|#x([0-9a-f]+));/gi, (_, n: string, dec?: string, hex?: string) =>
    dec ? String.fromCodePoint(+dec) : hex ? String.fromCodePoint(parseInt(hex, 16)) : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[n.toLowerCase()],
  );

/** The files a DASH manifest lists: each Representation is one whole file (video without sound, or the sound). */
export function parseDashManifest(xml: string): IgFile[] {
  const out: IgFile[] = [];
  for (const set of xml.matchAll(/<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet>/g)) {
    const setType = /\bcontentType="([^"]*)"/.exec(set[1])?.[1] ?? "";
    for (const rep of set[2].matchAll(/<Representation\b([^>]*)>([\s\S]*?)<\/Representation>/g)) {
      const attr = (name: string) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(rep[1])?.[1];
      const base = /<BaseURL>([\s\S]*?)<\/BaseURL>/.exec(rep[2])?.[1];
      if (!base) continue;
      const url = unxml(base.trim());
      if (!isInstagramFileUrl(url)) continue;
      const mime = attr("mimeType") ?? "";
      const audio = mime.startsWith("audio/") || setType === "audio";
      const int = (v?: string) => (v && /^\d+$/.test(v) ? +v : undefined);
      out.push({
        url,
        kind: audio ? "audio-only" : "video-only",
        width: int(attr("width")),
        height: int(attr("height")),
        bitrate: int(attr("bandwidth")),
        size: int(attr("FBContentLength")),
        codecs: attr("codecs"),
        expires: expiryOf(url),
      });
    }
  }
  return out;
}

function readItem(s: SlimMedia): IgItem | null {
  const files: IgFile[] = [];
  const seen = new Set<string>();
  if (Array.isArray(s.v))
    for (const entry of s.v) {
      if (!Array.isArray(entry)) continue;
      const [url, w, h] = entry;
      if (typeof url !== "string" || !isInstagramFileUrl(url)) continue;
      // Instagram lists the same file three times under different "types".
      const key = new URL(url).pathname;
      if (seen.has(key)) continue;
      seen.add(key);
      files.push({ url, kind: "video", width: num(w), height: num(h), expires: expiryOf(url) });
    }
  files.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  if (typeof s.m === "string") {
    const dash = parseDashManifest(s.m);
    const video = dash.filter((f) => f.kind === "video-only").sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bitrate ?? 0) - (a.bitrate ?? 0));
    const audio = dash.filter((f) => f.kind === "audio-only").sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
    files.push(...video, ...audio);
  }
  if (!files.length) return null;
  const poster = typeof s.i === "string" && isInstagramFileUrl(s.i) ? s.i : undefined;
  return { files, poster, width: num(s.w), height: num(s.h), duration: num(s.d) };
}

/** The compact copy as the list of files to show. Fails when there is no video, or no address on Instagram's hosts. */
export function readMedia(s: unknown): Result<IgMedia> {
  if (!isObj(s)) return { ok: false, error: "Nothing readable came from the page." };
  const slim = s as SlimMedia;
  const items: IgItem[] = [];
  let photos = 0;
  const own = readItem(slim);
  if (own) items.push(own);
  if (Array.isArray(slim.k))
    for (const k of slim.k.slice(0, 20)) {
      const item = isObj(k) ? readItem(k as SlimMedia) : null;
      if (item) items.push(item);
      else photos++;
    }
  if (!items.length)
    return {
      ok: false,
      error: photos || slim.i ? "This post has no video — only photos." : "No video address was found for this post.",
    };
  const code = typeof slim.c === "string" && new RegExp(`^${CODE}$`).test(slim.c) ? slim.c : undefined;
  const user = typeof slim.u === "string" && /^[A-Za-z0-9._]{1,30}$/.test(slim.u) ? slim.u : undefined;
  const caption = typeof slim.t === "string" ? slim.t.slice(0, 300) : undefined;
  return { ok: true, value: { code, user, caption, items, photos } };
}

/** A file name for a download: instagram-<user>-<code>[-n][-1080p][-video|-audio].mp4 / .m4a */
export function fileNameFor(media: IgMedia, itemIndex: number, file: IgFile): string {
  const parts = ["instagram"];
  if (media.user) parts.push(media.user.replace(/[^A-Za-z0-9._-]/g, ""));
  if (media.code) parts.push(media.code);
  if (media.items.length > 1) parts.push(String(itemIndex + 1));
  if (file.height && file.kind !== "audio-only") parts.push(`${Math.min(file.width ?? file.height, file.height)}p`);
  if (file.kind === "video-only") parts.push("video-only");
  return `${parts.join("-")}.${file.kind === "audio-only" ? "m4a" : "mp4"}`;
}

/** "1080p", "720p" — by the short side, as Instagram labels it. */
export function qualityLabel(file: IgFile): string {
  if (file.kind === "audio-only") return file.bitrate ? `${Math.round(file.bitrate / 1000)} kbps` : "Audio";
  if (!file.width || !file.height) return "Video";
  return `${Math.min(file.width, file.height)}p`;
}

/** "VP9", "H.264", "AV1", "HEVC", "AAC" from a codecs string. */
export function codecName(codecs?: string): string | undefined {
  if (!codecs) return undefined;
  const c = codecs.toLowerCase();
  if (c.startsWith("vp09") || c.startsWith("vp9")) return "VP9";
  if (c.startsWith("avc1") || c.startsWith("avc3")) return "H.264";
  if (c.startsWith("av01")) return "AV1";
  if (c.startsWith("hvc1") || c.startsWith("hev1")) return "HEVC";
  if (c.startsWith("mp4a")) return "AAC";
  if (c.startsWith("opus")) return "Opus";
  return codecs;
}

/* ───────────────────────── the hand-off ───────────────────────── */

export const HANDOFF_KEY = "ig";
/** Longest hand-off accepted (characters of base64). */
export const MAX_HANDOFF = 400_000;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(b64: string): string {
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** The compact copy as the URL hash value the tool reads (`#ig=<this>`). */
export function encodeHandoff(slim: SlimMedia): string {
  return toBase64Url(JSON.stringify(slim));
}

/**
 * Why a reader on the page found nothing, by the code it reports. The bookmark and the button say
 * this on Instagram's page themselves; the iPhone Shortcut cannot, so it opens the tool with
 * `#igerr=<code>` and the tool says it. Only these fixed texts are ever shown for that hash.
 */
export const HANDOFF_ERRORS: Record<string, string> = {
  site: "That was run on a page that is not instagram.com. Open the reel in the browser first.",
  post: "That page is not a reel or a post. Open the reel itself (its address has /reel/ or /p/ in it), then try again.",
  nodata: "Instagram's page had no video data for this post. Check that you are signed in to Instagram in this browser, reload the reel and try again.",
  fetch: "The reel's page could not be read. Reload it and try again.",
  photo: "This post has no video — only photos.",
};

/** Reads `#ig=…` or `#igerr=…` (with or without the #). Null when the hash holds no hand-off. */
export function decodeHandoff(hash: string): Result<IgMedia> | null {
  const failed = new RegExp(`(?:^|[#&])${HANDOFF_KEY}err=([a-z]{1,12})(?:&|$)`).exec(hash);
  if (failed) return { ok: false, error: Object.hasOwn(HANDOFF_ERRORS, failed[1]) ? HANDOFF_ERRORS[failed[1]] : HANDOFF_ERRORS.fetch };
  const m = new RegExp(`(?:^|[#&])${HANDOFF_KEY}=([A-Za-z0-9_-]+)`).exec(hash);
  if (!m) return null;
  if (m[1].length > MAX_HANDOFF) return { ok: false, error: "The data from the page is too large to read." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(m[1]));
  } catch {
    return { ok: false, error: "The data from the page is damaged — run the bookmark on the reel again." };
  }
  return readMedia(parsed);
}

/* ───────────────────────── the readers that run on Instagram's page ───────────────────────── */

const POST_PATH = "^\\/(?:[A-Za-z0-9._]+\\/)?(?:p|reels?|tv)\\/([A-Za-z0-9_-]{5,40})";

/**
 * The shared half of every reader: plain ES5 that, on an Instagram post in the visitor's own
 * browser, finds the post's media object in the page's data and builds the tool's address with a
 * compact copy of it in the hash. It defines `run(ok, fail)`: `ok(url, hasVideo)` gets that
 * address, `fail(code)` one of the HANDOFF_ERRORS codes; plus `show` and `bad`, the usual pair
 * (open the tool, or say why not in a small notice on the page).
 *
 * Nothing but the visitor's browser talks to Instagram, and the hash never reaches a server. When
 * the page was reached by scrolling (its data is for an earlier reel) the page's address is loaded
 * once more, the way a reload would, and read from that. That request must say it accepts HTML:
 * measured on a reel, the default any-type request gets a 630 kB page without the media data, the
 * HTML one the 748 kB page a navigation gets, with it.
 *
 * It mirrors `findMedia` + `slimMedia` above, because it must stand alone; the tests run both on
 * the same page and compare. Every line ends a statement: the bookmark joins them into one line.
 */
function readerCore(toolUrl: string): string {
  return `var T=${JSON.stringify(toolUrl)},P=/${POST_PATH}/;
function say(t,href){var d=document.getElementById('bench-ig');if(!d){d=document.createElement('div');d.id='bench-ig';d.style.cssText='position:fixed;z-index:2147483647;left:50%;top:16px;transform:translateX(-50%);max-width:90vw;padding:10px 14px;border-radius:8px;background:#111;color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 24px rgba(0,0,0,.4)';document.body.appendChild(d)}d.textContent=t+' ';if(href){var a=document.createElement('a');a.href=href;a.target='_blank';a.rel='noopener';a.textContent='Open Bench';a.style.cssText='color:#8cf;text-decoration:underline';d.appendChild(a)}clearTimeout(d._t);d._t=setTimeout(function(){d.remove()},href?20000:6000)}
function S(v){return typeof v=='string'&&v?v:void 0}
function O(v){return!!v&&typeof v=='object'&&!Array.isArray(v)}
function code(o){return S(o.code)||S(o.shortcode)}
function kids(o){var r=[],i,a=o.carousel_media,e=O(o.edge_sidecar_to_children)?o.edge_sidecar_to_children.edges:null;if(Array.isArray(a))for(i=0;i<a.length;i++)if(O(a[i]))r.push(a[i]);if(Array.isArray(e))for(i=0;i<e.length;i++)if(O(e[i])&&O(e[i].node))r.push(e[i].node);return r}
function vid(o){if(Array.isArray(o.video_versions)&&o.video_versions.length)return true;if(S(o.video_url))return true;var k=kids(o),i;for(i=0;i<k.length;i++)if(vid(k[i]))return true;return false}
function slim(o){var s={},c=code(o),u=O(o.user)?S(o.user.username):O(o.owner)?S(o.owner.username):void 0,t=O(o.caption)?S(o.caption.text):void 0,e=O(o.edge_media_to_caption)?o.edge_media_to_caption.edges:null,D=O(o.dimensions)?o.dimensions:null,w=o.original_width||(D?D.width:void 0),h=o.original_height||(D?D.height:void 0),I=O(o.image_versions2)&&Array.isArray(o.image_versions2.candidates)?o.image_versions2.candidates:[],p=(O(I[0])?S(I[0].url):void 0)||S(o.display_url),v=[],i,f,k=kids(o);if(c)s.c=c;if(u)s.u=u;if(!t&&Array.isArray(e)&&O(e[0])&&O(e[0].node))t=S(e[0].node.text);if(t)s.t=t.slice(0,300);if(typeof o.video_duration=='number'&&o.video_duration)s.d=o.video_duration;if(typeof w=='number'&&w)s.w=w;if(typeof h=='number'&&h)s.h=h;if(p)s.i=p;if(Array.isArray(o.video_versions))for(i=0;i<o.video_versions.length;i++){f=o.video_versions[i];if(O(f)&&S(f.url))v.push([f.url,f.width,f.height])}if(S(o.video_url))v.push([o.video_url,s.w,s.h]);if(v.length)s.v=v;if(S(o.video_dash_manifest))s.m=o.video_dash_manifest;if(k.length)s.k=k.map(slim);return s}
function b64(s){var b=new TextEncoder().encode(s),o='',i;for(i=0;i<b.length;i+=32768)o+=String.fromCharCode.apply(null,b.subarray(i,i+32768));return btoa(o).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'')}
function link(o){var s=slim(o),p=b64(JSON.stringify(s));if(p.length>300000){delete s.m;if(s.k)s.k.forEach(function(x){delete x.m});p=b64(JSON.stringify(s))}return T+'#${HANDOFF_KEY}='+p}
function run(ok,fail){if(!/(^|\\.)instagram\\.com$/.test(location.hostname)){fail('site');return}var M=location.pathname.match(P);if(!M){fail('post');return}var C=M[1],fb=null,hit;function find(o,d){if(!o||typeof o!='object'||d>60)return null;if(O(o)&&code(o)===C&&('video_versions'in o||'video_url'in o||'image_versions2'in o||'display_url'in o)){if(vid(o))return o;if(!fb)fb=o}for(var k in o){var r=find(o[k],d+1);if(r)return r}return null}function scan(doc){var a=doc.querySelectorAll('script[type="application/json"]'),i,t,r;for(i=0;i<a.length;i++){t=a[i].textContent||'';if(t.indexOf(C)<0)continue;try{r=find(JSON.parse(t),0)}catch(x){r=null}if(r)return r}return null}hit=scan(document);if(hit){ok(link(hit),true);return}say('Bench: reading this reel…');fetch(location.href,{credentials:'include',headers:{Accept:'text/html,application/xhtml+xml'}}).then(function(r){return r.text()}).then(function(t){hit=scan(new DOMParser().parseFromString(t,'text/html'))||fb;if(hit)ok(link(hit),vid(hit));else fail('nodata')},function(){fail('fetch')})}
var E={site:'Bench: use this on an Instagram reel or post.',post:'Bench: open a reel or a post first, then try again.',nodata:'Bench: no video data on this page. Reload the page and try again.',fetch:'Bench: could not read this page. Reload it and try again.',photo:'Bench: this post has no video.'};
function bad(c){say(E[c]||E.fetch)}
function show(url,v){if(!v){bad('photo');return}if(/Android|iPhone|iPad|iPod|Mobi/.test(navigator.userAgent)){say('Bench: video found, opening it…');location.href=url;return}var w=window.open(url,'_blank');if(w)say('Bench: video found — opened in a new tab.');else say('Bench: the new tab was blocked.',url)}`;
}

/**
 * The bookmarklet: a `javascript:` address that runs the reader on the page it is clicked on. On a
 * computer the tool opens in a new tab (a link is offered when the browser blocks that); on a phone
 * it opens in the same tab, where nothing can block it and Back returns to the reel.
 */
export function bookmarkletSource(toolUrl: string): string {
  const js = `(function(){${readerCore(toolUrl)}run(show,bad)})()`;
  return `javascript:${encodeURIComponent(js.replace(/\n/g, ""))}`;
}

export const USERSCRIPT_VERSION = "1.0.0";
/** The file name a userscript manager recognises as something to install. */
export const USERSCRIPT_FILE = "bench-instagram-video.user.js";

/**
 * The same reader as a userscript (Tampermonkey, Violentmonkey, the Userscripts app for Safari):
 * installed once, it keeps a "Get video" button on every reel and post, so nothing has to be
 * clicked in the bookmarks. Instagram changes pages without loading them, so the button follows
 * the address by looking at it now and then.
 */
export function userscriptSource(toolUrl: string, scriptUrl: string): string {
  return `// ==UserScript==
// @name         Bench: Get Instagram video
// @namespace    ${new URL(toolUrl).origin}
// @version      ${USERSCRIPT_VERSION}
// @description  Adds a "Get video" button to Instagram reels and posts. It reads the video's file addresses from the page you are looking at and opens them in Bench. Nothing is sent to a server.
// @match        https://www.instagram.com/*
// @grant        none
// @run-at       document-idle
// @noframes
// @homepageURL  ${toolUrl}
// @downloadURL  ${scriptUrl}
// @updateURL    ${scriptUrl}
// ==/UserScript==
(function(){
if(window.top!==window.self)return;
${readerCore(toolUrl)}
function btn(){var on=P.test(location.pathname),b=document.getElementById('bench-ig-btn');if(on&&!b&&document.body){b=document.createElement('button');b.id='bench-ig-btn';b.type='button';b.textContent='Get video';b.title='Open this video in Bench';b.style.cssText='position:fixed;z-index:2147483646;right:16px;top:72px;padding:9px 14px;border:1px solid rgba(255,255,255,.35);border-radius:999px;background:#111;color:#fff;font:600 13px/1 system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.35);cursor:pointer';b.onclick=function(){run(show,bad)};document.body.appendChild(b)}else if(!on&&b)b.remove()}
btn();
setInterval(btn,800);
})();
`;
}

/**
 * The reader for an iPhone Shortcut's "Run JavaScript on Web Page" action, which runs a script on
 * the page shared from Safari and waits for it to call `completion(result)`. The result is the
 * tool's address, with the video in the hash or the reason there is none, for the Shortcut's next
 * action (Open URLs) to open.
 */
export function shortcutSource(toolUrl: string): string {
  return `(function(){
${readerCore(toolUrl)}
run(function(u,v){completion(v?u:T+'#${HANDOFF_KEY}err=photo')},function(c){completion(T+'#${HANDOFF_KEY}err='+c)});
})();`;
}

