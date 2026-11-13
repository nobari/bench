import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { normalizeObscure, type ObscureArea } from "../lib/tools/video/obscure";
import { deserialize, serialize, newProject, NEUTRAL_GRADE, NEUTRAL_TRANSFORM, planExport, splitClip, type Clip } from "../lib/tools/video/project";

const area: ObscureArea = { id: "area", kind: "black", x: 0.25, y: 0.25, w: 0.5, h: 0.5, strength: 0.05 };
test("obscured clips survive saving and splitting and require rendering", () => {
  const project = newProject();
  const clip: Clip = { id: "clip", media: "source", in: 0, out: 10, transform: NEUTRAL_TRANSFORM, grade: NEUTRAL_GRADE, gainDb: 0, muted: false, obscure: [area] };
  project.clips = [clip];
  expect(deserialize(serialize(project))?.clips[0].obscure).toEqual([area]);
  expect(splitClip(project.clips, clip.id, 5).map((c) => c.obscure)).toEqual([[area], [area]]);
  expect(planExport(project).every((span) => span.kind === "encode" && span.reasons.includes("obscured areas"))).toBe(true);
  expect(normalizeObscure([{ ...area, x: 0.9, w: 1 }, { ...area, x: NaN }])).toEqual([{ ...area, x: 0.9, w: 1 - 0.9 }]);
});

test("effects change only their rectangle and do not leak into the next frame", async ({ page }) => {
  const code = ts.transpileModule(readFileSync("lib/tools/video/obscure.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  await page.addScriptTag({ content: `var exports = {}; ${code}; window.Obscurer = exports.Obscurer;` });
  const result = await page.evaluate((area) => {
    const source = new OffscreenCanvas(100, 100);
    const ctx = source.getContext("2d")!;
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, 100, 100);
    ctx.fillStyle = "black"; ctx.fillRect(50, 0, 50, 100);
    const renderer = new (window as unknown as { Obscurer: new (w: number, h: number) => { draw: (s: OffscreenCanvas, a: ObscureArea[]) => OffscreenCanvas } }).Obscurer(100, 100);
    const pixel = (canvas: OffscreenCanvas, x: number, y: number) => canvas.getContext("2d")!.getImageData(x, y, 1, 1).data[0];
    return (["black", "pixelate", "blur"] as const).map((kind) => {
      const frame = renderer.draw(source, [{ ...area, kind, strength: 0.1 }]);
      return { kind, inside: pixel(frame, 49, 50), outside: pixel(frame, 10, 50), cleared: pixel(renderer.draw(source, []), 49, 50) };
    });
  }, area);
  for (const row of result) {
    expect(row.outside, row.kind).toBe(255);
    expect(row.inside, row.kind).toBeLessThan(255);
    expect(row.cleared, row.kind).toBe(255);
  }
});
