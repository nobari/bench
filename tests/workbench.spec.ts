import { expect, test } from "@playwright/test";
import { TOOLS } from "../lib/tools/registry";
import { searchTools } from "../lib/tools/search";

test("search handles task phrases, transpositions and mixed exact/typo words", () => {
  for (const [query, path] of [
    ["mermiad", "web/mermaid"],
    ["json veiwer", "json/viewer"],
    ["make pdf smaller", "files/pdf-compress"],
    ["compare two texts", "web/diff"],
    ["base64", "text/base64"],
  ]) {
    const result = searchTools(TOOLS, query)[0]?.tool;
    expect(result && `${result.category}/${result.slug}`, query).toBe(path);
  }
});

test("favorites and recents persist without recording tool input", async ({
  page,
}) => {
  await page.goto("/text/base64?i=private-input");
  await page.getByRole("button", { name: "Favorite", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Favorited", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.goto("/");
  const personal = page.getByRole("region", { name: "Your tools" });
  await expect(
    personal.getByRole("link", { name: "Base64", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("bench:personal-tools:v1")),
  ).not.toContain("private-input");
  await page.keyboard.press("Control+k");
  await expect(
    page.getByRole("dialog").getByText("Favorites", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await personal
    .getByRole("button", { name: "Remove Base64 from favorites" })
    .click();
  await personal.getByRole("button", { name: "Clear recent" }).click();
  await expect(
    personal.getByRole("link", { name: "Base64", exact: true }),
  ).toHaveCount(0);
});

test("Base64 to JSON to inferred schema is local, reloadable and preserves original", async ({
  page,
}) => {
  const sample = '{"name":"Bench","count":3}';
  const encoded = Buffer.from(sample).toString("base64");
  const shortenRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/shorten")) shortenRequests.push(r.url());
  });
  page.on("dialog", (d) => d.accept());
  await page.goto(
    `/text/base64?t=base64-decode&i=${encodeURIComponent(encoded)}`,
  );
  await page
    .getByRole("combobox", { name: "Open result in" })
    .selectOption("json");
  await expect(page).toHaveURL(/\/json\/viewer/);
  await expect(page.getByRole("status")).toContainText(
    "Result received locally",
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Copy result", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("combobox", { name: "Open result in" })
    .selectOption("schema");
  await expect(page).toHaveURL(/\/json\/schema/);
  await expect(page.locator("[data-generated-schema]")).toContainText(
    '"count"',
  );
  await expect(page.locator("[data-generated-schema]")).toContainText(
    '"integer"',
  );
  await page.reload();
  await expect(page.locator("[data-generated-schema]")).toContainText(
    '"count"',
  );
  await page.goBack();
  await page.goBack();
  await expect(
    page.getByPlaceholder("Paste or type your text here…"),
  ).toHaveValue(encoded);
  expect(shortenRequests).toEqual([]);
});

test("existing drafts can be resumed and deleted without touching unrelated storage", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem(
      "bench:markdown:draft",
      "# Recovery test\nKeep my draft",
    );
    localStorage.setItem("bench:draft-time:markdown", String(Date.now()));
    localStorage.setItem("unrelated-test-data", "keep-me");
  });
  await page.reload();
  await page
    .getByRole("link", { name: "Resume Markdown", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "# Start writing…", exact: true }),
  ).toHaveValue(/Recovery test/);
  await page.goto("/");
  const drafts = page.getByRole("region", { name: "Resume your work" });
  await drafts
    .getByRole("button", { name: "Delete draft", exact: true })
    .click();
  await drafts.getByRole("button", { name: "Confirm removal" }).click();
  await expect(
    page.getByRole("link", { name: "Resume Markdown", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("bench:markdown:draft")),
  ).toBeNull();
  expect(
    await page.evaluate(() => localStorage.getItem("unrelated-test-data")),
  ).toBe("keep-me");
});

test("clipboard rejection offers a usable manual fallback", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    }),
  );
  await page.goto("/text/base64?i=Bench");
  await page.getByRole("button", { name: "Copy result", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Clipboard access failed" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Text to copy manually" }),
  ).toHaveValue("QmVuY2g=");
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await page.getByRole("button", { name: "Share link", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Text to copy manually" }),
  ).toHaveValue(/\/text\/base64/);
});

test("unavailable storage and stale transfers produce useful feedback", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error("unavailable");
    };
  });
  await page.goto("/json/viewer?handoff=missing");
  await expect(page.getByRole("status")).toContainText("transfer expired");
  await page.getByRole("button", { name: "Favorite", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Favorites could not be saved" }),
  ).toBeVisible();
});

test("homepage and tool actions fit the viewport", async ({
  page,
}, testInfo) => {
  for (const path of ["/", "/text/base64?i=Bench"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    if (path !== "/") await expect(page.getByRole("button", { name: "Copy result", exact: true })).toBeEnabled();
    await page.screenshot({
      path: `/tmp/bench-${path === "/" ? "home" : "tool"}-${testInfo.project.name}.png`,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  }
});

test("PDF drafts and video shortcuts delete only their own recovery data", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const put = (name: string, store: string, key: string, value: unknown) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(store);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(store, "readwrite");
          tx.objectStore(store).put(value, key);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    await put("bench-pdf", "kv", "autosave", {
      name: "working-copy.pdf",
      bytes: new ArrayBuffer(4),
      savedAt: Date.now(),
      dirty: true,
      handle: null,
    });
    await put("bench-pdf", "kv", "signatures", ["unrelated-signature"]);
    const root = await navigator.storage.getDirectory();
    const file = await root.getFileHandle("project.autosave.json", {
      create: true,
    });
    const writer = await file.createWritable();
    await writer.write("keep project on disk");
    await writer.close();
    await put("bench-video", "handles", "lastFolder", root);
    localStorage.setItem(
      "bench:video:recovery",
      JSON.stringify({ savedAt: Date.now() }),
    );
  });
  await page.reload();
  const pdf = page
    .getByRole("listitem")
    .filter({
      has: page.getByRole("link", { name: "Resume PDF Studio", exact: true }),
    });
  await expect(pdf).toContainText("working-copy.pdf");
  await pdf.getByRole("button", { name: "Delete draft" }).click();
  await pdf.getByRole("button", { name: "Confirm removal" }).click();
  await expect(pdf).toHaveCount(0);
  const video = page
    .getByRole("listitem")
    .filter({
      has: page.getByRole("link", { name: "Resume Video editor", exact: true }),
    });
  await video.getByRole("button", { name: "Forget entry" }).click();
  await video.getByRole("button", { name: "Confirm removal" }).click();
  await expect(video).toHaveCount(0);
  expect(
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      return (
        await (await root.getFileHandle("project.autosave.json")).getFile()
      ).text();
    }),
  ).toBe("keep project on disk");
});

test("a broken tool shows recovery controls and reload recovers", async ({
  page,
}) => {
  await page.route("**/_next/static/chunks/*.js", async (route) => {
    const response = await route.fetch();
    const code = await response.text();
    if (code.includes('" Valid JSON"')) {
      await route.fulfill({
        response,
        headers: { ...response.headers(), "cache-control": "no-store" },
        body: code.replace(
          '" Valid JSON"',
          '(()=>{throw new Error("Injected tool render failure")})()',
        ),
      });
    } else await route.fulfill({ response });
  });
  await page.goto("/json/viewer?i=%7B%22ok%22%3Atrue%7D");
  await expect(
    page.getByRole("heading", { name: "This tool couldn’t continue" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Try again", exact: true }),
  ).toBeVisible();
  await page.unroute("**/_next/static/chunks/*.js");
  await page.getByRole("button", { name: "Reload page", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Copy result", exact: true }),
  ).toBeEnabled();
});
