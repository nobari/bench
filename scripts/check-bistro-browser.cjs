const { chromium } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const base = process.env.BISTRO_QA_URL || "http://localhost:3013/bistro";
  const go = async (q = "") => {
    await page.goto(base + q);
    await page.locator(".bistro").waitFor();
  };
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const q of [
      "",
      "?view=recipes",
      "?view=recipes&recipe=book-white-bread-manual-functions-20",
      "?view=help",
      "?view=my-baking",
    ]) {
      await go(q);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `overflow ${width} ${q}`,
      );
    }
    await page.screenshot({
      path: `/tmp/bistro-reviewed-${width}.png`,
      fullPage: true,
    });
  }
  await go("?view=recipes");
  await page.getByLabel("Guided recipes only").check();
  assert.equal(await page.locator(".b-recipe-card").count(), 249);
  await page.getByLabel("Search recipes").fill("starter");
  assert.ok((await page.locator(".b-recipe-card").count()) > 0);
  await page.getByLabel("Clear recipe search").click();
  await page
    .getByRole("button", { name: "External oven", exact: true })
    .click();
  assert.ok((await page.locator(".b-recipe-card").count()) > 10);
  await go("?view=recipes&recipe=manual-cocoa-rice-flour-cake");
  assert.ok(
    await page
      .getByRole("button", { name: /Guided checklist under review/ })
      .isDisabled(),
  );
  for (const id of [
    "manual-pain-de-mie",
    "manual-brioche",
    "book-pizza-19",
    "book-white-bread-manual-functions-20",
    "manual-amazake-lemon-soda",
  ]) {
    await go("?view=recipes&recipe=" + id);
    await page
      .getByRole("button", { name: "Start guided baking", exact: true })
      .click();
    await page.locator(".b-current-step").waitFor();
    assert.ok(await page.locator(".b-step-nav button").last().isDisabled());
    await page.getByRole("button", { name: "I’m ready", exact: true }).click();
    assert.ok(
      await page
        .getByRole("button", { name: "Ingredients are ready", exact: true })
        .isDisabled(),
    );
    const checks = page.locator(".b-current-step input[type=checkbox]");
    for (let i = 0; i < (await checks.count()); i++)
      await checks.nth(i).check();
    const count = await checks.count();
    await page.reload();
    await page
      .getByRole("button", { name: "Ingredients are ready", exact: true })
      .waitFor();
    assert.equal(
      await page.locator(".b-current-step input:checked").count(),
      count,
    );
    await page
      .getByRole("button", { name: "Ingredients are ready", exact: true })
      .click();
    let guard = 0;
    while (
      await page
        .getByRole("button", { name: "I’ve completed this step", exact: true })
        .count()
    ) {
      assert.ok(++guard < 40);
      await page
        .getByRole("button", { name: "I’ve completed this step", exact: true })
        .click();
    }
    await page
      .getByRole("button", { name: "I’ve finished this bake", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "My Baking", exact: true })
      .waitFor();
  }
  const notes = page.locator("textarea").first();
  await notes.fill("QA note: kept separately from original instructions.");
  await page.reload();
  assert.equal(
    await page.locator("textarea").first().inputValue(),
    "QA note: kept separately from original instructions.",
  );
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles("/tmp/bistro-reviewed-375.png");
  await page
    .getByRole("button", { name: "Remove photo", exact: true })
    .waitFor();
  await page.reload();
  await page.getByRole("img", { name: /Your result:/ }).waitFor();
  await page.getByRole("button", { name: "Remove photo", exact: true }).click();
  assert.equal(
    await page.getByRole("img", { name: /Your result:/ }).count(),
    0,
  );
  await page
    .getByRole("button", { name: /Delete .* entry/ })
    .first()
    .click();
  const modal = page.getByRole("alertdialog");
  await modal.waitFor();
  assert.equal(
    await page.evaluate(() => document.activeElement.textContent),
    "Keep it",
  );
  await page.keyboard.press("Shift+Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement.textContent),
    "Delete",
  );
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement.textContent),
    "Keep it",
  );
  await page.keyboard.press("Escape");
  assert.equal(await modal.count(), 0);
  await page
    .getByRole("button", { name: /Delete .* entry/ })
    .first()
    .click();
  await modal.getByRole("button", { name: "Delete", exact: true }).click();
  assert.equal(await page.locator(".b-history-entry").count(), 4);
  await go("?view=recipes&recipe=manual-pain-de-mie");
  await page
    .getByRole("button", { name: /Save recipe|Favorite pain/ })
    .count()
    .then(async (n) => {
      if (n)
        await page
          .getByRole("button", { name: /Save recipe|Favorite pain/ })
          .first()
          .click();
    });
  await go("?view=recipes");
  await page
    .getByRole("button", { name: "Favorite Pain de mie", exact: true })
    .click();
  await page.reload();
  assert.ok(
    await page
      .getByRole("button", { name: "Unfavorite Pain de mie", exact: true })
      .count(),
  );
  await go("?view=recipes&recipe=manual-pain-de-mie");
  await page
    .getByRole("button", { name: "Start guided baking", exact: true })
    .click();
  await go("?view=recipes&recipe=manual-brioche");
  await page
    .getByRole("button", { name: "Start guided baking", exact: true })
    .click();
  await page.getByRole("alertdialog").waitFor();
  await page.getByRole("button", { name: "Keep it", exact: true }).click();
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    "/tmp/bistro-qa-result.json",
    JSON.stringify(
      {
        passed: true,
        widths: [375, 768, 1024, 1440],
        completedFlows: 5,
        historyNotes: true,
        photoUploadReloadDelete: true,
        modalKeyboard: true,
        filters: true,
        blockedRecipe: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log("Browser QA passed");
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
