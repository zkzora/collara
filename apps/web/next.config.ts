import type { NextConfig } from "next";

const privateNoStore = [{ key: "Cache-Control", value: "private, no-store" }];

const nextConfig: NextConfig = {
  // Separate build dirs (e.g. NEXT_DIST_DIR=.next-landing) let parallel builds coexist.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@collara/domain", "@collara/api-client"],
  async headers() {
    return [
      { source: "/app/:path*", headers: privateNoStore },
      { source: "/login", headers: privateNoStore },
    ];
  },
};

export default nextConfig;
