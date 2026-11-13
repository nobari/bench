/** Rectangles in the final output frame, independent of preview/export resolution. */
export interface ObscureArea {
  id: string;
  kind: "blur" | "pixelate" | "black";
  x: number;
  y: number;
  w: number;
  h: number;
  /** Blur radius or pixel size as a fraction of the shorter frame dimension. */
  strength: number;
}

export function normalizeObscure(value: unknown): ObscureArea[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((a) => {
    if (!a || typeof a.id !== "string" || !["blur", "pixelate", "black"].includes(a.kind) ||
      ![a.x, a.y, a.w, a.h, a.strength].every((n) => typeof n === "number" && Number.isFinite(n))) return [];
    const x = Math.max(0, Math.min(0.99, a.x)), y = Math.max(0, Math.min(0.99, a.y));
    return [{ id: a.id, kind: a.kind, x, y, w: Math.max(0.01, Math.min(1 - x, a.w)), h: Math.max(0.01, Math.min(1 - y, a.h)), strength: Math.max(0.005, Math.min(0.1, a.strength)) }];
  });
}

/** Reuses scratch canvases while playing and exporting; never alters the input. */
export class Obscurer {
  private output: OffscreenCanvas;
  private pixels = new OffscreenCanvas(1, 1);
  constructor(width: number, height: number) {
    this.output = new OffscreenCanvas(width, height);
  }
  draw(source: OffscreenCanvas, areas: ObscureArea[] | undefined): OffscreenCanvas {
    if (!areas?.length) return source;
    const { width, height } = this.output;
    const ctx = this.output.getContext("2d")!;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0);
    for (const area of areas) {
      const x = Math.floor(area.x * width), y = Math.floor(area.y * height);
      const w = Math.ceil((area.x + area.w) * width) - x, h = Math.ceil((area.y + area.h) * height) - y;
      const size = Math.max(1, area.strength * Math.min(width, height));
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      if (area.kind === "black") {
        ctx.fillStyle = "#000";
        ctx.fillRect(x, y, w, h);
      } else if (area.kind === "pixelate") {
        this.pixels.width = Math.max(1, Math.ceil(w / size));
        this.pixels.height = Math.max(1, Math.ceil(h / size));
        this.pixels.getContext("2d")!.drawImage(this.output, x, y, w, h, 0, 0, this.pixels.width, this.pixels.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.pixels, x, y, w, h);
      } else {
        // Use the already obscured image so overlapping areas cannot reveal an earlier cover.
        ctx.filter = `blur(${size}px)`;
        ctx.drawImage(this.output, 0, 0);
      }
      ctx.restore();
    }
    return this.output;
  }
}
