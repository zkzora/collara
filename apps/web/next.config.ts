import { resolve } from "node:path";
import type { NextConfig } from "next";

const privateNoStore = [{ key: "Cache-Control", value: "private, no-store" }];

// Container builds only (apps/web/Dockerfile): NEXT_OUTPUT=standalone emits .next/standalone with the traced
// node_modules subset, traced from the monorepo root (the build runs in apps/web). Unset, the config is
// exactly the regular `next build` / `next start` setup.
const standalone = process.env.NEXT_OUTPUT === "standalone";

const nextConfig: NextConfig = {
  // Separate build dirs (e.g. NEXT_DIST_DIR=.next-landing) let parallel builds coexist.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  ...(standalone ? { output: "standalone", outputFileTracingRoot: resolve(process.cwd(), "../..") } : {}),
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
