import { expect, test } from "@playwright/test";
import { TOOLS } from "../lib/tools/registry";
import { CATEGORIES } from "../lib/tools/categories";
import { MOVED_CATEGORIES, MOVED_TOOLS } from "../lib/tools/moved";

const origin = "https://bench.bozmoz.com";
const paths = [
  "/",
  "/suggest",
  "/about",
  ...CATEGORIES.map((c) => `/${c.slug}`),
  ...TOOLS.map((t) => `/${t.category}/${t.slug}`),
];
const canonical = (path: string) => origin + (path === "/" ? "" : path);

test("all sitemap pages are indexable, discoverable and useful without JavaScript", async ({
  browser,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Full crawl runs once; mobile has separate rendering checks.",
  );
  test.setTimeout(180_000);
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const xml = await sitemap.text();
  const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
  expect(urls.sort()).toEqual(paths.map((p) => origin + p).sort());
  expect(xml).not.toContain("<lastmod>");
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const titles = new Set<string>();
  const descriptions = new Set<string>();
  for (const path of paths) {
    const response = await page.goto(`http://localhost:3011${path}`);
    expect(response?.status(), path).toBe(200);
    expect(response?.headers()["x-robots-tag"] || "", path).not.toContain(
      "noindex",
    );
    await expect(page.locator('meta[name="robots"]')).not.toHaveAttribute(
      "content",
      /noindex/,
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      canonical(path),
    );
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toBeVisible();
    titles.add(await page.title());
    descriptions.add(
      (await page.locator('meta[name="description"]').getAttribute("content"))!,
    );
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      "content",
      canonical(path),
    );
    await expect(
      page.locator('meta[property="og:image"]').first(),
    ).toHaveAttribute("content", /opengraph-image/);
    for (const raw of await page
      .locator('script[type="application/ld+json"]')
      .allTextContents()) {
      const data = JSON.parse(raw);
      expect(data["@context"]).toBe("https://schema.org");
      expect(data.potentialAction).toBeUndefined();
      if (data["@type"] === "BreadcrumbList")
        expect(data.itemListElement.at(-1).item).toBe(origin + path);
    }
    if (path === "/") {
      const links = await page
        .locator("a[href]")
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")));
      for (const target of paths.filter((p) => p !== "/"))
        expect(links, target).toContain(target);
    }
    if (TOOLS.some((t) => `/${t.category}/${t.slug}` === path)) {
      await expect(page.locator("noscript p")).toBeVisible();
      expect(await page.locator("noscript p").textContent()).toContain(
        "Enable JavaScript",
      );
      await expect(
        page.getByRole("heading", { name: "How it works", exact: true }),
      ).toBeVisible();
    }
  }
  expect(titles.size).toBe(paths.length);
  expect(descriptions.size).toBe(paths.length);
  await context.close();
});

test("embeds and utility endpoints expose noindex without robots blocking", async ({
  request,
}) => {
  const robots = await request.get("/robots.txt");
  expect(await robots.text()).toContain("Allow: /");
  expect(await robots.text()).not.toContain("Disallow:");
  expect(await robots.text()).toContain(`${origin}/sitemap.xml`);
  for (const path of [
    "/embed/json/viewer",
    "/s/invalid!",
    "/embed/s/invalid!",
    "/api/shorten",
  ]) {
    const r = await request.get(path, { maxRedirects: 0 });
    expect(r.headers()["x-robots-tag"], path).toContain("noindex");
  }
  const embed = await request.get("/embed/json/viewer");
  expect(await embed.text()).toMatch(
    /name="robots" content="noindex, nofollow"/,
  );
});

test("moved URLs retain permanent redirects; unknown routes return real 404s", async ({
  request,
}) => {
  for (const { from, to } of [...MOVED_TOOLS, ...MOVED_CATEGORIES]) {
    const r = await request.get(`/${from}?audit=1`, { maxRedirects: 0 });
    expect(r.status()).toBe(308);
    expect(r.headers().location).toBe(`/${to}?audit=1`);
  }
  for (const path of [
    "/not-a-category",
    "/json/not-a-tool",
    "/embed/json/not-a-tool",
  ]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
  const r = await request.get("/json/viewer?input=example&utm_source=audit");
  expect(await r.text()).toContain(
    `<link rel="canonical" href="${origin}/json/viewer"`,
  );
  const image = await request.get("/opengraph-image");
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toContain("image/png");
});

test("representative pages render and navigate on desktop and mobile", async ({
  page,
}) => {
  await page.route("**/*google-analytics.com/**", (r) => r.abort());
  await page.route("**/*googletagmanager.com/**", (r) => r.abort());
  for (const path of ["/", "/json", "/json/viewer", "/about"]) {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      path,
    ).toBe(true);
  }
  await page.goto("/json/viewer");
  await page.getByRole("link", { name: "All tools", exact: true }).click();
  await expect(page).toHaveURL("http://localhost:3011/");
});
