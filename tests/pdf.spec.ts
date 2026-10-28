import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * PDF Studio end to end on the bundled sample: it opens, the panels fill, a note and a reply are written through
 * pdf-lib, a highlight with a comment through pdf.js's editor, a form field is filled, Save downloads a file whose
 * annotations and values are read back with pdf.js, and the Organise tab deletes and restores a page.
 */

type PdfJs = typeof import("pdfjs-dist");

async function readAnnotations(path: string) {
  const pdfjs: PdfJs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" });
  const doc = await task.promise;
  const out: { page: number; subtype: string; contents: string; author: string; fieldName?: string; fieldValue?: unknown; inReplyTo: string | null }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    for (const a of (await page.getAnnotations({ intent: "any" })) as Record<string, unknown>[]) {
      out.push({
        page: i,
        subtype: String(a.subtype ?? ""),
        contents: ((a.contentsObj as { str?: string } | undefined)?.str ?? "") as string,
        author: ((a.titleObj as { str?: string } | undefined)?.str ?? "") as string,
        fieldName: a.fieldName as string | undefined,
        fieldValue: a.fieldValue,
        inReplyTo: (a.inReplyTo as string | null) ?? null,
      });
    }
  }
  const numPages = doc.numPages;
  await task.destroy();
  return { annots: out, numPages };
}

async function openSample(page: Page) {
  await page.goto("/files/pdf?sample=1");
  await page.waitForSelector("[data-pdf-studio] .pdfViewer .page", { timeout: 60_000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-pdf-studio] .pdfViewer canvas").length >= 1, null, { timeout: 60_000 });
  await expect(page.locator(".pdfViewer .page")).toHaveCount(6);
}

test("the sample opens and its panels fill", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The editor needs a desktop viewport.");
  page.on("dialog", (d) => d.accept());
  await openSample(page);
  await expect(page.locator("[data-page-input]")).toHaveValue("1");
  await page.click('[data-sidebar-tab="outline"]');
  await expect(page.locator("[data-outline-item]")).toHaveCount(5);
  await page.click('[data-sidebar-tab="attachments"]');
  await expect(page.locator('[data-attachment="reading-notes.txt"]')).toBeVisible();
  await page.click('[data-sidebar-tab="comments"]');
  await expect(page.locator("[data-comment-item]")).toHaveCount(5);
  await expect(page.locator("[data-comment-item]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.commentKind))).resolves.toEqual(["note", "highlight", "strikeout", "underline", "shape"]);
  await page.locator("[data-comment-item]").nth(1).click();
  await expect(page.locator("[data-page-input]")).toHaveValue("2");
});

test("comments, a note, a highlight and a form value survive Save", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The editor needs a desktop viewport.");
  test.setTimeout(240_000);
  page.on("dialog", (d) => d.accept());
  await openSample(page);
  await page.click('[data-sidebar-tab="comments"]');
  await expect(page.locator("[data-comment-item]")).toHaveCount(5);
  await page.fill("[data-comment-author]", "Tester");

  // a reply through pdf-lib (the document reloads)
  const highlight = page.locator("[data-comment-item]").nth(1);
  await highlight.click();
  await highlight.locator("[data-comment-reply-button]").click();
  await page.fill("[data-comment-composer] textarea", "Reply from the test");
  await page.click("[data-composer-submit]");
  await expect(page.locator("[data-comment-reply]")).toHaveCount(2, { timeout: 30_000 });

  // a sticky note with the Note tool
  await page.click('[data-tool-button="note"]');
  const first = page.locator('.pdfViewer .page[data-page-number="1"]');
  await first.scrollIntoViewIfNeeded();
  const box = (await first.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.3);
  await page.fill("[data-note-text]", "A note from the test");
  await page.click("[data-note-save]");
  await expect(page.locator("[data-comment-item]")).toHaveCount(6, { timeout: 30_000 });

  // a highlight with a comment through pdf.js's editor
  await page.click('[data-tool-button="highlight"]');
  const span = page.locator('.pdfViewer .page[data-page-number="2"] .textLayer span').filter({ hasText: /Comments are annotations/ }).first();
  await span.scrollIntoViewIfNeeded();
  const tb = (await span.boundingBox())!;
  await page.mouse.move(tb.x + 2, tb.y + tb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + tb.width * 0.6, tb.y + tb.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForSelector(".annotationEditorLayer .highlightEditor", { timeout: 10_000 });
  await page.click(".editToolbar button.comment");
  await page.fill("[data-comment-dialog-text]", "Comment on the new highlight");
  await page.click("[data-comment-dialog-save]");
  await expect(page.locator("[data-live-comment]")).toHaveCount(1);

  // a form value (page 3 must be in view for pdf.js to build its annotation layer)
  await page.click('[data-tool-button="select"]');
  await page.fill("[data-page-input]", "3");
  await page.press("[data-page-input]", "Enter");
  const field = page.locator('.pdfViewer .page[data-page-number="3"] .annotationLayer input').first();
  await field.waitFor({ timeout: 30_000 });
  await field.fill("Grace Hopper");
  await field.press("Tab");

  // save → download → read back
  await page.evaluate(() => {
    (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined;
  });
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.click("[data-save]")]);
  const path = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(path);
  const saved = await readAnnotations(path);
  expect(saved.numPages).toBe(6);
  expect(saved.annots.some((a) => a.subtype === "Highlight" && a.contents === "Comment on the new highlight" && a.author === "Tester")).toBe(true);
  expect(saved.annots.some((a) => a.subtype === "Text" && a.contents === "A note from the test")).toBe(true);
  expect(saved.annots.some((a) => a.subtype === "Text" && a.contents === "Reply from the test" && a.inReplyTo)).toBe(true);
  expect(saved.annots.some((a) => a.fieldName === "name" && a.fieldValue === "Grace Hopper")).toBe(true);
  await expect(page.locator("[data-live-comment]")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator("[data-comment-item]")).toHaveCount(7);
});

test("the Organise tab deletes a page and undo restores it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The editor needs a desktop viewport.");
  test.setTimeout(120_000);
  page.on("dialog", (d) => d.accept());
  await openSample(page);
  await page.click('[data-sidebar-tab="organise"]');
  await page.locator('[data-page-tile="6"] [role="checkbox"]').click();
  await page.click("[data-pages-delete]");
  await expect(page.locator(".pdfViewer .page")).toHaveCount(5, { timeout: 30_000 });
  await page.click("[data-undo]");
  await expect(page.locator(".pdfViewer .page")).toHaveCount(6, { timeout: 30_000 });
});
