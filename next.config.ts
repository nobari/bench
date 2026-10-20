import type { NextConfig } from "next";
import { movedRedirects } from "./lib/tools/moved";

const nextConfig: NextConfig = {
  async headers() {
    const noindex = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];
    return [
      ...(process.env.VERCEL_ENV === "preview"
        ? [{ source: "/:path*", headers: noindex }]
        : []),
      ...["/embed/:path*", "/s/:path*", "/api/:path*"].map((source) => ({
        source,
        headers: noindex,
      })),
    ];
  },
  // Tools and categories that moved keep their old URLs working (see lib/tools/moved.ts).
  async redirects() {
    return movedRedirects();
  },
};

export default nextConfig;
