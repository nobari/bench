import type { NextConfig } from "next";
import { movedRedirects } from "./lib/tools/moved";

const nextConfig: NextConfig = {
  // Tools and categories that moved keep their old URLs working (see lib/tools/moved.ts).
  async redirects() {
    return movedRedirects();
  },
};

export default nextConfig;
