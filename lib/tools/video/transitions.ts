import type { TransitionKind } from "./project";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Frame = CanvasImageSource;
type Scratch = OffscreenCanvas | HTMLCanvasElement;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Smoothstep: gentle in and out, so nothing snaps. */
const ease = (p: number) => {
  const x = clamp01(p);
  return x * x * (3 - 2 * x);
};
/** Eased progress across the sub-range [a, b] of the window. */
const between = (p: number, a: number, b: number) => ease((p - a) / (b - a));

function drawScaled(ctx: Ctx, img: Frame, w: number, h: number, s: number) {
  const sw = w * s, sh = h * s;
  ctx.drawImage(img, (w - sw) / 2, (h - sh) / 2, sw, sh);
}

/**
 * Composite the outgoing and incoming frames at progress p ∈ [0, 1) of a
 * transition. Both frames are already graded and output-sized. `scratch` is
 * a same-sized canvas used for soft masks; without it the wipe has a hard edge.
 */
export function drawTransition(ctx: Ctx, outgoing: Frame, incoming: Frame, w: number, h: number, kind: TransitionKind, p: number, scratch?: Scratch) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";
  switch (kind) {
    case "dissolve":
      ctx.drawImage(outgoing, 0, 0, w, h);
      ctx.globalAlpha = ease(p);
      ctx.drawImage(incoming, 0, 0, w, h);
      break;
    case "dipBlack":
    case "dipWhite": {
      if (p < 0.5) {
        ctx.drawImage(outgoing, 0, 0, w, h);
        ctx.globalAlpha = ease(p * 2);
      } else {
        ctx.drawImage(incoming, 0, 0, w, h);
        ctx.globalAlpha = 1 - ease((p - 0.5) * 2);
      }
      ctx.fillStyle = kind === "dipBlack" ? "#000" : "#fff";
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case "zoom": {
      // The outgoing shot accelerates into the cut; the incoming one arrives close and settles.
      const e = ease(p);
      drawScaled(ctx, outgoing, w, h, 1 + 0.35 * e);
      ctx.globalAlpha = between(p, 0.3, 0.7);
      drawScaled(ctx, incoming, w, h, 1.35 - 0.35 * e);
      break;
    }
    case "blur": {
      const px = Math.sin(p * Math.PI) * h * 0.03;
      ctx.filter = px > 0.5 ? `blur(${px.toFixed(1)}px)` : "none";
      const s = 1 + (px * 2) / h; // overscan hides the blurred edges
      drawScaled(ctx, outgoing, w, h, s);
      ctx.globalAlpha = between(p, 0.35, 0.65);
      drawScaled(ctx, incoming, w, h, s);
      break;
    }
    case "wipe": {
      ctx.drawImage(outgoing, 0, 0, w, h);
      const soft = w * 0.12, edge = -soft + ease(p) * (w + soft);
      const sc = scratch?.getContext("2d") as Ctx | null | undefined;
      if (sc) {
        sc.save();
        sc.globalCompositeOperation = "source-over";
        sc.globalAlpha = 1;
        sc.clearRect(0, 0, w, h);
        sc.drawImage(incoming, 0, 0, w, h);
        const g = sc.createLinearGradient(edge, 0, edge + soft, 0);
        g.addColorStop(0, "rgba(0,0,0,1)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        sc.globalCompositeOperation = "destination-in";
        sc.fillStyle = g;
        sc.fillRect(0, 0, w, h);
        sc.restore();
        ctx.drawImage(scratch!, 0, 0, w, h);
      } else {
        ctx.beginPath();
        ctx.rect(0, 0, Math.max(0, edge + soft / 2), h);
        ctx.clip();
        ctx.drawImage(incoming, 0, 0, w, h);
      }
      break;
    }
    case "push": {
      const e = ease(p);
      ctx.drawImage(outgoing, -w * e, 0, w, h);
      ctx.drawImage(incoming, w * (1 - e), 0, w, h);
      break;
    }
    default:
      ctx.drawImage(p < 0.5 ? outgoing : incoming, 0, 0, w, h);
  }
  ctx.restore();
}
