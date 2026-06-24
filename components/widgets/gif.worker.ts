/// <reference lib="webworker" />
import { GIFEncoder, quantize, applyPalette } from "gifenc";

interface EncodeMessage {
  frames: ArrayBuffer[]; // RGBA buffers, one per frame
  width: number;
  height: number;
  delay: number; // ms per frame
  maxColors: number;
  repeat: number; // 0 = loop forever, -1 = play once
}

self.onmessage = (e: MessageEvent<EncodeMessage>) => {
  const { frames, width, height, delay, maxColors, repeat } = e.data;
  try {
    const gif = GIFEncoder();
    for (let i = 0; i < frames.length; i++) {
      const rgba = new Uint8Array(frames[i]);
      const palette = quantize(rgba, maxColors);
      const index = applyPalette(rgba, palette);
      gif.writeFrame(index, width, height, {
        palette,
        delay,
        repeat: i === 0 ? repeat : undefined,
      });
      (self as DedicatedWorkerGlobalScope).postMessage({
        type: "progress",
        value: (i + 1) / frames.length,
      });
    }
    gif.finish();
    const bytes = gif.bytes();
    (self as DedicatedWorkerGlobalScope).postMessage(
      { type: "done", bytes },
      [bytes.buffer],
    );
  } catch (err) {
    (self as DedicatedWorkerGlobalScope).postMessage({
      type: "error",
      message: err instanceof Error ? err.message : "Encoding failed",
    });
  }
};
