import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { test } from "node:test";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const recipes = JSON.parse(
  readFileSync(new URL("../lib/bistro/recipes.json", import.meta.url)),
);
const guided = recipes.filter((r) => !r.referenceOnly && !r.reviewRequired);
test("every unavailable flow has an explicit source issue", () => {
  for (const r of recipes.filter((r) => r.referenceOnly || r.reviewRequired)) {
    assert.equal(r.reviewRequired, true, r.id);
    assert.ok(r.verificationNotes?.length, r.id);
    assert.equal(r.steps.length, 0, r.id);
  }
});
test("reviewed flows distinguish initial ingredients, late additions and separate preparation", () => {
  for (const r of guided) {
    for (const i of r.ingredients)
      assert.notEqual(i.placement, "See recipe instructions", r.id);
    if (r.program === "Manual")
      assert.ok(
        r.ingredients.every((i) => i.placement !== "Yeast dispenser"),
        r.id,
      );
  }
  const byId = (id) => recipes.find((r) => r.id === id);
  assert.ok(
    byId(
      "manual-prepared-natural-yeast-starter-50-g-dry-starter",
    ).ingredients.every((i) => i.placement === "Starter container"),
  );
  assert.match(
    byId("manual-sweet-bean-paste").ingredients[1].placement,
    /Saucepan only/,
  );
  assert.ok(
    byId("book-baguette-style-bread-26")
      .ingredients.filter((i) => /Salt|yeast/.test(i.name))
      .every((i) => i.placement.includes("after initial kneading")),
  );
  assert.ok(
    byId("book-plain-bagels-31").ingredients.every(
      (i) => !/cheese/i.test(i.name),
    ),
  );
  assert.equal(byId("manual-amazake-lemon-soda").machineRequired, false);
});
test("catalog retains 270 unique entries and 249 reviewed flows", () => {
  assert.equal(recipes.length, 270);
  assert.equal(new Set(recipes.map((r) => r.id)).size, 270);
  assert.equal(guided.length, 249);
  for (const r of guided) {
    assert.ok(r.ingredients.length);
    assert.ok(r.steps.length);
  }
});
test("every catalog image and source resolves locally", () => {
  for (const r of recipes) {
    if (r.image)
      assert.ok(
        existsSync(new URL("../public" + r.image, import.meta.url)),
        r.image,
      );
    for (const s of [r.source, ...(r.extraSources || [])]) {
      assert.ok(
        existsSync(
          new URL(
            "../public/bistro/sources/" + s.document + ".pdf",
            import.meta.url,
          ),
        ),
      );
      assert.ok(Number.isInteger(s.pdfPage) && s.pdfPage > 0);
    }
  }
});
function storage() {
  const data = new Map();
  const testModule = { exports: {} };
  const require = createRequire(
    new URL("../lib/bistro/storage.ts", import.meta.url),
  );
  const code = ts.transpileModule(
    readFileSync(new URL("../lib/bistro/storage.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    },
  ).outputText;
  vm.runInNewContext(code, {
    module: testModule,
    exports: testModule.exports,
    require,
    localStorage: {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => data.set(k, v),
    },
  });
  return { api: testModule.exports, data };
}
test("saved favorites and notes survive a round trip", () => {
  const { api } = storage();
  const value = api.emptyPersonal();
  value.favorites = [guided[0].id];
  value.history = [
    {
      id: "bake",
      recipeId: guided[0].id,
      completedAt: "2026-11-04",
      notes: "My personal note",
    },
  ];
  api.writePersonal(value);
  assert.equal(JSON.stringify(api.readPersonal()), JSON.stringify(value));
});
test("changed workflows discard stale step confirmations", () => {
  const { api } = storage();
  const value = api.emptyPersonal();
  value.session = {
    id: "session",
    recipeId: guided[0].id,
    startedAt: "2026-11-04",
    updatedAt: "2026-11-04",
    flowVersion: "old",
    step: 2,
    weighed: [0],
    confirmed: [0, 1],
  };
  api.writePersonal(value);
  const session = api.readPersonal().session;
  assert.equal(session.step, 0);
  assert.equal(session.confirmed.length, 0);
  assert.equal(session.weighed.length, 0);
});
test("corrupt or unreviewed sessions are rejected without overwriting storage", () => {
  const { api, data } = storage();
  for (const raw of [
    "{broken",
    JSON.stringify({
      ...api.emptyPersonal(),
      session: {
        id: "s",
        recipeId: recipes.find((r) => r.referenceOnly).id,
        startedAt: "x",
        updatedAt: "x",
        step: 0,
        weighed: [],
        confirmed: [],
      },
    }),
  ]) {
    data.set(api.STORAGE_KEY, raw);
    assert.throws(() => api.readPersonal());
    assert.equal(data.get(api.STORAGE_KEY), raw);
  }
});
