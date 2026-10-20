import { ImageResponse } from "next/og";

export const alt =
  "Bench — everyday browser tools for text, data, media and the web";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        padding: 72,
        background: "#141416",
        color: "#fafafa",
      }}
    >
      <div style={{ display: "flex", fontSize: 32, color: "#aac77b" }}>
        bench.bozmoz.com
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", fontSize: 100, fontWeight: 700 }}>
          Bench
        </div>
        <div style={{ display: "flex", fontSize: 40, maxWidth: 1000 }}>
          Everyday browser tools for text, data, media and the web.
        </div>
      </div>
      <div style={{ display: "flex", fontSize: 24, color: "#c4c4c8" }}>
        Open source. Built for everyday work.
      </div>
    </div>,
    size,
  );
}
