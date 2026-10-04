import { resolve } from "node:path";
import type { NextConfig } from "next";

const privateNoStore = [{ key: "Cache-Control", value: "private, no-store" }];

// Container builds only (apps/web/Dockerfile): NEXT_OUTPUT=standalone emits .next/standalone with the traced
// node_modules subset, traced from the monorepo root (the build runs in apps/web). Unset, the config is
// exactly the regular `next build` / `next start` setup.
const standalone = process.env.NEXT_OUTPUT === "standalone";

// DEVNET_CREDENTIAL_KEY (the server-side key of the stored ledger refresh token) must never be inlined into a browser
// bundle: refuse to build or start when any NEXT_PUBLIC_* variable names it or carries its value.
const credentialKey = process.env.DEVNET_CREDENTIAL_KEY?.trim();
const leakedKeyVars = Object.entries(process.env)
  .filter(([name, value]) => name.startsWith("NEXT_PUBLIC_") && (/CREDENTIAL_KEY/i.test(name) || (!!credentialKey && credentialKey.length >= 40 && !!value?.includes(credentialKey))))
  .map(([name]) => name);
if (leakedKeyVars.length) throw new Error(`refusing to build: ${leakedKeyVars.join(", ")} must not carry DEVNET_CREDENTIAL_KEY (server-only secret)`);

const nextConfig: NextConfig = {
  // Separate build dirs (e.g. NEXT_DIST_DIR=.next-landing) let parallel builds coexist.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  ...(standalone ? { output: "standalone", outputFileTracingRoot: resolve(process.cwd(), "../..") } : {}),
  poweredByHeader: false,
  reactStrictMode: true,
  // @collara/api and @collara/worker (and their server-only workspace deps) are loaded only by the embedded API
  // (API_MODE=embedded, src/server/embedded-api.ts); internal packages ship TypeScript source.
  transpilePackages: ["@collara/domain", "@collara/api-client", "@collara/api", "@collara/worker", "@collara/db", "@collara/canton"],
  async headers() {
    return [
      { source: "/app/:path*", headers: privateNoStore },
      { source: "/login", headers: privateNoStore },
    ];
  },
};

export default nextConfig;
