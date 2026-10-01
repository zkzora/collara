# Collara web/API stack: pinned version matrix and setup research

- **As of:** 2026-10-01, about 16:20 to 17:00 UTC. Registry data came from `npm view` (npm 11.13.0 on Node 24.16.0, Windows 11).
- **Scope:** web (Next.js App Router), UI (Tailwind v4 + shadcn), client data, Fastify API, Drizzle/PostgreSQL, OIDC, S3-compatible storage, testing, lint, and tooling for the Collara pnpm monorepo.
- **Out of scope here:** Canton, Daml, the ledger client and BitSafe Decentralization Manager. Other notes cover them. Port choices below must still be checked against the Canton LocalNet port map.

**Evidence legend:**
- **[RUN]** Executed on this machine during this research. Logs are in the scratchpad, see section 16.
- **[READ]** Taken from official docs or registry metadata. The URL is cited.
- **[INFERRED]** My reasoning. Not verified.

---

## 0. TL;DR: decisions

| Area | Decision | Why (short) |
|---|---|---|
| Node.js | **Node 24 LTS, pin 24.21.0** (machine has 24.16.0, upgrade recommended). `engines.node: ">=24.15.0 <25"` | 24 is Active LTS until 2026-10-20, then Maintenance until 2028-04-30. jsdom 30 needs `^24.15.0`. 24.16.0 misses two security releases (24.17.0, 24.18.1). [READ] |
| Package manager | **pnpm 11** (`packageManager: "pnpm@11.28.2"`, the `latest-11` tag; machine has 11.13.0 and works). Stay off pnpm 12 for now. | pnpm 12 (Rust rewrite, 12.0.0 on 2026-08-26) changed lockfile and engine semantics. pnpm 11 is what the brief assumes. [READ] |
| Next.js | **next 16.3.8** + **react/react-dom 19.3.0** | Built and served successfully here, including Turbopack, TypeScript 6 and Tailwind 4. [RUN] |
| TypeScript | **typescript 6.0.3** (not 7.0.2) | TS 7 ships **no JS API**, and typescript-eslint 8.71 requires `typescript >=4.8.4 <6.1.0`. TS 6 also turns `baseUrl` into an error, so write tsconfig in TS-7-ready form now. [RUN/READ] |
| Styling | **tailwindcss 4.3.3 + @tailwindcss/postcss 4.3.3**, CSS-first, `@theme inline` tokens, dark-first | Verified build. [RUN] |
| shadcn | **CLI shadcn@4.21.0** with **Base UI** (`-b base`, style `base-nova` or another `base-*`) | Base UI has been shadcn's default since 2026-07-02. Radix is still supported. [READ/RUN] |
| Primitives | **@base-ui/react 1.8.0**. Radix fallback: `radix-ui 1.6.7`. | See section 6.3. |
| Class utils | **cn 0.4.0** (shadcn ≥ Sept 2026 imports `cn` from `"cn"`) + **class-variance-authority 0.7.1** + **tw-animate-css 1.4.0** | The generated components import it directly [RUN]. Fallback is `clsx 2.1.1` + `tailwind-merge 3.7.0`. |
| Server state | **@tanstack/react-query 5.104.0** (+ devtools 5.104.0) | |
| Tables | **@tanstack/react-table 9.2.4** (v9 API: `useTable`, `tableFeatures`) | v8 has had no release since 2025-04. shadcn's own site uses `^9.0.0`. [READ/RUN] |
| Forms | **react-hook-form 7.89.0 + @hookform/resolvers 5.9.1 + zod 4.6.5** | Resolvers peer is `zod ^3.25.0 \|\| ^4.0.0`. Verified. [RUN] |
| Icons, dates, charts, animation | **lucide-react 1.49.0**, **date-fns 4.4.0**, **recharts 3.10.1** (+ `react-is 19.3.0`), **motion 13.4.6** | motion 13.5.0 is less than 24 h old. |
| API | **fastify 5.12.5** + `@fastify/*` majors that declare `fastify: '5.x'` + **fastify-type-provider-zod 7.0.0** (needs zod ≥ 4.2 semantics, peer `zod >=4.1.5`) | Verified validation, serialization and OpenAPI generation. [RUN] |
| Sessions | **@fastify/session 11.1.3** + **@fastify/cookie 11.1.2** with a PostgreSQL-backed store, cookie `__Host-collara_sid` | Server-side, revocable sessions. Tokens never reach the browser. |
| DB | **drizzle-orm 0.45.3 + drizzle-kit 0.31.11 + pg 8.23.1 (+ @types/pg 8.23.1)**. Tests can use **@electric-sql/pglite 0.5.8** (embeds **PostgreSQL 18.3**). | 1.0 is still RC. WSL has PostgreSQL 16.14. [RUN] |
| OIDC | **openid-client 6.8.8** (+ **jose 6.2.12**). Authorization Code + PKCE (S256) verified against Keycloak. | [RUN] |
| Local IdP | **Keycloak 26.7.5** zip on **Java 21** (`kc.bat start-dev --import-realm`) | Verified on this machine: started in about 27 s and imported the realm. 26.8.0 came out today, so wait for 26.8.1. [RUN] |
| Object storage | **SeaweedFS 4.48** (`weed.exe mini`, native Windows binary), image `chrislusf/seaweedfs:4.48` | **MinIO community is dead**: repo archived, Windows binary returns HTTP 410, Docker Hub repo gone. Verified that SeaweedFS keeps objects private and serves presigned PUT/GET. [RUN] |
| S3 SDK | **@aws-sdk/client-s3 + @aws-sdk/s3-request-presigner 3.1143.0**, with `forcePathStyle: true` and `requestChecksumCalculation/responseChecksumValidation: "WHEN_REQUIRED"` | 3.1144.0 is less than 24 h old. [RUN] |
| Same-origin `/api` | **Route Handler proxy** `app/api/[...path]/route.ts` (runtime-configurable, streams large bodies). Alternative: `next.config.ts` rewrites, but they are baked at build time and cap request bodies at 10 MB unless configured. | Both measured. [RUN] |
| Tests | **vitest 5.0.3 + vite 8.3.1 + @vitejs/plugin-react 6.1.1 + jsdom 30.1.1 + @testing-library/react 16.3.3 / dom 10.4.2 / user-event 14.6.7 / jest-dom 7.0.1**, **@playwright/test 1.63.0** | Verified. [RUN] |
| Lint | **ESLint 9.39.5 + eslint-config-next 16.3.8 + typescript-eslint 8.71.0** (flat config) | ESLint 9 is EOL as of 2026-08-06, but eslint-config-next's bundled plugins **crash or break peers on ESLint 10**. Verified both. [RUN] |
| Money | **decimal.js 10.6.0**. Decimal strings on the wire, `numeric(p,s)` in PostgreSQL. | Drizzle returns `numeric` as a string. [RUN] |
| Env loading | Node built-in `--env-file-if-exists` / `process.loadEnvFile()`. **Do not add dotenv.** | dotenv 18 shipped 5 patch releases in 2 weeks. [READ] |
| HTTP client | Use the built-in `fetch` (Node 24 bundles undici 7.25.0). Add `undici@7.30.0` only if a custom `Agent`/mTLS is needed for Canton. | undici 8 is a different major (needs Node ≥ 22.19). [RUN/READ] |
| OpenAPI types | **openapi-typescript 7.13.0 + openapi-fetch 0.17.0** (peer `typescript ^5.x`, works with TS 6) | Verified generating types from the Fastify spec. [RUN] |

---

## 1. Runtime: Node.js LTS status (Oct 2026)

Source: `https://raw.githubusercontent.com/nodejs/Release/main/schedule.json` and `https://nodejs.org/dist/index.json` [READ, fetched 2026-10-01].

| Line | Status on 2026-10-01 | Key dates | Latest |
|---|---|---|---|
| **24 "Krypton"** | **Active LTS** | LTS since 2025-10-28. **Maintenance from 2026-10-20**. EOL 2028-04-30. | **v24.21.0** (2026-09-07). Bundles npm 11.19.0 and OpenSSL 3.5.8. |
| 22 "Jod" | Maintenance LTS | Maintenance since 2025-10-21. EOL 2027-04-30. | v22.23.3 (2026-09-23) |
| 26 | Current. **Becomes LTS 2026-10-28.** | Maintenance 2027-10-20. EOL 2029-04-30. | v26.10.0 (2026-09-21) |
| 20 | **EOL 2026-04-30** | n/a | v20.20.2 |
| 25 | EOL 2026-06-01 | n/a | n/a |

- **Installed Node is 24.16.0** (2026-05-21). Security releases since then: **24.17.0** (2026-06-17) and **24.18.1** (2026-07-28). **Recommendation: install 24.21.0.** Commit `.node-version` / `.nvmrc` = `24.21.0` and set `"engines": { "node": ">=24.15.0 <25" }`.
- **Why 24 and not 26:** jsdom 30 (`^22.22.2 || ^24.15.0 || >=26.0.0`), vitest 5 (`^22.12.0 || ^24.0.0 || >=26.0.0`), undici 8 (`>=22.19.0`) and ESLint 10 (`>=24`) all accept 24. 26 is not LTS until 2026-10-28. Plan to move to 26 after its first LTS patch. [INFERRED]
- Installed Node 24.16.0 reports `undici 7.25.0` and `openssl 3.5.6` (`process.versions`). [RUN]

## 2. pnpm 11 workspace specifics

Sources: `https://pnpm.io/blog/releases/11.0`, raw docs `https://raw.githubusercontent.com/pnpm/pnpm.io/main/docs/settings/{build,dependency-resolution,cli}.md`, `https://pnpm.io/catalogs`, `https://pnpm.io/cli/approve-builds` [READ].

**Release facts:**
- pnpm 11.0.0 was published 2026-04-28. The `latest-11` tag is **11.28.2**. The `next-11` tag is 11.28.3 (2026-09-30).
- **pnpm 12.0.0** was published 2026-08-26. npm `latest` now points to **12.8.1**. pnpm 12 is "a rewrite of pnpm in Rust" with breaking changes: `--no-frozen-lockfile` syntax, cyclic-dependency re-resolution ("a one-time lockfile diff"), stricter `engineStrict`, and errors on unknown `pnpm-workspace.yaml` keys. **Recommendation:** pin pnpm 11 via `"packageManager": "pnpm@11.28.2"` and revisit 12 later. pnpm 11's `pmOnFail` defaults to `download`, so pnpm fetches the declared version automatically.
- pnpm 11 requires **Node 22+** (`pnpm@11.28.3` engines `>=22.13`) and is pure ESM.

**Breaking config changes in v11 (quoted):**
- "pnpm no longer reads non-auth settings from `.npmrc`". `.npmrc` is auth and registry only. Everything else goes in **`pnpm-workspace.yaml`** (or the global `~/.config/pnpm/config.yaml`). "The `pnpm` field in `package.json` is no longer read." Environment variables use the `pnpm_config_*` prefix.
- **`allowBuilds`** replaces `onlyBuiltDependencies`, `onlyBuiltDependenciesFile`, `neverBuiltDependencies`, `ignoredBuiltDependencies` and `ignoreDepScripts`, which are all removed. It is a map of `pattern: true|false`. Version-specific keys are allowed, for example `nx@21.6.4 || 21.6.5: true`.
- **`strictDepBuilds` defaults to `true`**: "the installation will exit with a non-zero exit code if any dependencies have unreviewed build scripts". The error code is `ERR_PNPM_IGNORED_BUILDS`. "During install, dependencies with ignored builds that are not yet listed in `allowBuilds` are automatically added to `pnpm-workspace.yaml` with a placeholder value".
- **`pnpm approve-builds`** is interactive. `--all` approves everything pending. Packages can be passed as arguments: `pnpm approve-builds esbuild fsevents !core-js` (the `!` denies). It writes `allowBuilds` entries.
- **`minimumReleaseAge` defaults to `1440` minutes (1 day)** since v11. The built-in default is **non-strict**: it falls back to an immature version if nothing else matches. **If you set it explicitly, `minimumReleaseAgeStrict` becomes `true`** and resolution fails instead. Escape hatch: `minimumReleaseAgeExclude: ['pkg', 'pkg@1.2.3']`.
  - **Practical consequence:** pin versions at least 24 h old. That is why this matrix uses motion 13.4.6 (not 13.5.0), @aws-sdk 3.1143.0 (not 3.1144.0), vite 8.3.1, globals 17.12.0 and shadcn 4.21.0 (4.21.1 was published 2026-10-01).
- Other v11 defaults: `blockExoticSubdeps: true`, `verifyDepsBeforeRun: install`. `pmOnFail` replaces `managePackageManagerVersions` and `packageManagerStrict*` and `COREPACK_ENABLE_STRICT`. The store is now a SQLite `index.db`. New commands: `pnpm ci`, `pnpm clean`, `pnpm sbom`, **`pnpm peers check`**, `pnpm with <version>`.
- Lockfile: pnpm 11.13.0 wrote `lockfileVersion: '9.0'`. [RUN]

**Catalogs** (default and named):

```yaml
catalog:           # referenced as "catalog:" or "catalog:default"
  react: 19.3.0
catalogs:          # referenced as "catalog:<name>"
  legacy:
    react: 18.3.1
```

- `catalogMode`: `manual` (default), `strict` or `prefer`. It controls `pnpm add`.
- `catalogPrune` (old spelling `cleanupUnusedCatalogs`) removes unused entries.
- `catalog:` is replaced with the real range on `pnpm pack`/`pnpm publish`.

**Build scripts seen for this stack.** Install on Windows ran exactly these postinstalls [RUN]:
- `esbuild` (three copies: 0.18.20 via drizzle-kit's `@esbuild-kit/esm-loader`, 0.25.12 via drizzle-kit, 0.28.2 via tsx)
- `unrs-resolver` (via eslint-config-next → eslint-import-resolver-typescript)

These have **no** install scripts in the pinned versions: `sharp` 0.35.5 (uses `@img/sharp-win32-x64` prebuilt), `@tailwindcss/oxide`, `lightningcss`, `sodium-native` 5.1.0 (only if `@fastify/secure-session` is used), `@playwright/test`, `next`, `drizzle-kit`, `tsx`, `@electric-sql/pglite`.

**Verified `allowBuilds`** (install exit 0, `pnpm peers check`: "No peer dependency issues found") [RUN]:

```yaml
allowBuilds:
  esbuild: true
  unrs-resolver: true
  sharp: true        # harmless, shadcn's Next template also lists it
```

The shadcn 4.21.0 Next template wrote `allowBuilds: { sharp: true, unrs-resolver: true, msw: false }`. [RUN]

## 3. Pinned version matrix

Release timestamps come from `npm view <pkg>@<ver> time`. "Peers" lists only **required** peers (the count of optional peers is in parentheses). Engines are from `engines.node`. All pins are at least 24 h old as of 2026-10-01 16:21 UTC, so they pass pnpm 11's default `minimumReleaseAge`.

### 3.1 Web core and UI

| Package | Pin | Released (UTC) | Latest (date) if newer | Required peers | Engines | Notes |
|---|---|---|---|---|---|---|
| next | **16.3.8** | 2026-09-30 16:07 | n/a | react/react-dom `^18.2.0 \|\| 19.0.0-rc-… \|\| ^19.0.0` (+4 optional: sass, @playwright/test, @opentelemetry/api, babel-plugin-react-compiler) | node >=20.9.0 | `backport` tag 15.5.27, `canary` 16.4.0-canary.55. Build OK with Turbopack. [RUN] |
| react | **19.3.0** | 2026-09-09 17:21 | n/a | — | — | create-next-app 16.3.8 asks for `react ^19`. The shadcn template pins 19.2.8, a conservative fallback. |
| react-dom | **19.3.0** | 2026-09-09 17:17 | n/a | react ^19.3.0 | — | |
| @types/react | **19.3.0** | 2026-09-09 18:08 | n/a | — | — | |
| @types/react-dom | **19.3.0** | 2026-09-09 18:07 | n/a | @types/react ^19.3.0 | — | |
| typescript | **6.0.3** | 2026-04-16 23:38 | 7.0.2 (2026-07-08) | — | node >=14.17 | See section 9. |
| @types/node | **24.19.0** | 2026-09-25 22:09 | 26.6.3 | — | — | Match the Node 24 runtime. The 24.x line jumped from 24.13.6 to 24.19.0. |
| tailwindcss | **4.3.3** | 2026-07-16 12:03 | n/a | — | — | `v3-lts` tag 3.4.19 |
| @tailwindcss/postcss | **4.3.3** | 2026-07-16 12:03 | n/a | — | — | Depends on `postcss ^8.5.16` |
| postcss | **8.5.28** | 2026-09-03 15:13 | n/a | — | — | Declare it explicitly, as Tailwind's Next guide does. |
| shadcn (CLI + `shadcn/tailwind.css`) | **4.21.0** | 2026-09-04 05:34 | 4.21.1 (2026-10-01) | — | node >=20.18.1 | It is also a runtime **dependency** because globals.css imports `shadcn/tailwind.css`. `shadcn eject` inlines it. |
| @base-ui/react | **1.8.0** | 2026-09-04 08:52 | n/a | react/react-dom `^17 \|\| ^18 \|\| ^19` (+3 optional: date-fns ^4, @date-fns/tz ^1.2, @types/react) | node >=14 | 1.0.0 was 2025-12-11. The old package `@base-ui-components/react` is **deprecated**: "Package was renamed to @base-ui/react". |
| radix-ui (fallback only) | 1.6.7 | 2026-07-24 23:51 | n/a | react/react-dom `^16.8 … ^19` | — | Unified package. `next` tag 1.7.0-rc.* |
| class-variance-authority | **0.7.1** | 2024-11-26 | n/a | — | — | Stable but quiet. Still used by the shadcn registry. |
| cn | **0.4.0** | 2026-09-22 10:43 | n/a | — | node >=20 | Replaces clsx + tailwind-merge. 0.x, first released 2026-09-01. See section 6.4. |
| clsx (fallback) | 2.1.1 | 2024-04-23 | n/a | — | node >=6 | Only if you reject `cn` |
| tailwind-merge (fallback) | 3.7.0 | 2026-09-12 | n/a | — | — | v3 means Tailwind v4 |
| tw-animate-css | **1.4.0** | 2025-09-24 | n/a | — | — | Imported in CSS: `@import "tw-animate-css";` |
| lucide-react | **1.49.0** | 2026-09-29 22:20 | n/a | react `^16.5.1 … ^19.0.0` | — | Went 0.x → 1.0.0 on 2026-03-23. Weekly minors. |
| next-themes (optional) | 0.4.6 | 2025-03-11 | n/a | react/react-dom `… ^19` | — | Not needed for fixed dark-first. Only needed if you add a light/dark toggle. |

### 3.2 Client data, forms, utilities

| Package | Pin | Released (UTC) | Latest | Required peers | Engines | Notes |
|---|---|---|---|---|---|---|
| @tanstack/react-query | **5.104.0** | 2026-09-26 03:56 | n/a | react ^18 \|\| ^19 | — | Depends on `@tanstack/query-core 5.104.0` |
| @tanstack/react-query-devtools | **5.104.0** | 2026-09-26 03:58 | n/a | react, @types/react, `@tanstack/react-query ^5.104.0` | — | Pin it to exactly the react-query version. |
| @tanstack/react-table | **9.2.4** | 2026-08-28 17:48 | n/a | react >=18 | node >=20 | **v9 API** (9.0.0 on 2026-08-04). Last v8 release: 8.21.3 (2025-04-14). |
| react-hook-form | **7.89.0** | 2026-09-26 00:59 | n/a | react `^16.8.0 … ^19` | node >=18 | `beta` 8.0.0-beta.4. Stay on 7. |
| @hookform/resolvers | **5.9.1** | 2026-08-17 07:36 | n/a | react-hook-form ^7.55.0 (+24 optional incl. **zod `^3.25.0 \|\| ^4.0.0`**) | — | `import { zodResolver } from '@hookform/resolvers/zod'` |
| zod | **4.6.5** | 2026-09-13 23:25 | n/a | — | — | 4.0.0 was 2025-07-09. **4.2.0** (2025-12-15) added `.encode()/.decode()`, which fastify-type-provider-zod 7 relies on. |
| date-fns | **4.4.0** | 2026-05-29 23:23 | n/a | — | — | `next` tag 5.0.0-alpha.0. Base UI has an optional peer on date-fns ^4. |
| recharts | **3.10.1** | 2026-07-25 15:23 | n/a | react, **react-is**, react-dom (`^16.8 … ^19`) | node >=18 | **You must add `react-is@19.3.0`** to match React. |
| react-is | **19.3.0** | 2026-09-09 | n/a | — | — | Peer for recharts |
| motion | **13.4.6** | 2026-09-29 12:53 | 13.5.0 (2026-10-01) | — (react/react-dom optional) | — | `import { motion } from "motion/react"`. Depends on `framer-motion ^13.4.6`. |
| decimal.js | **10.6.0** | 2025-07-06 | n/a | — | — | Money math |
| big.js (alternative) | 7.0.1 | 2025-04-21 | n/a | — | node * | Smaller, fewer features |

### 3.3 API (Fastify)

All `@fastify/*` plugins below declare `fastify: '5.x'` in their `fastify-plugin` metadata. I grepped this from each tarball [RUN]. None declare npm peers. Fastify 6 is only at `6.0.0-alpha.4`.

| Package | Pin | Released (UTC) | Notes |
|---|---|---|---|
| fastify | **5.12.5** | 2026-09-16 07:37 | Dependencies include `pino ^9.14.0 \|\| ^10.1.0`. Tags: `four` 4.29.1, `next` 6.0.0-alpha.4. |
| fastify-plugin | **6.0.0** | 2026-06-09 | Every plugin below depends on `^6.0.0` |
| @fastify/cookie | **11.1.2** | 2026-07-15 | Depends on `cookie ^2.0.0` |
| @fastify/session | **11.1.3** | 2026-09-14 | Server-side session. Store API is express-session compatible. Default MemoryStore is "not ... used in a production environment because it will leak memory". |
| @fastify/secure-session (alternative) | 8.4.0 | 2026-09-22 | Stateless libsodium-encrypted cookie. Depends on `sodium-native ^5.0.1`. Not recommended (no server-side revocation, 4 KB cookie limit). |
| @fastify/swagger | **9.9.1** | 2026-09-30 16:03 | Produced OpenAPI **3.0.3** by default [RUN]. Set `openapi.openapi: '3.1.0'` if wanted. |
| @fastify/swagger-ui | **6.1.1** | 2026-07-28 | 6.0.0 was 2026-06-09. Depends on `@fastify/static ^10.1.0`. Check CSP interplay with helmet (`staticCSP`). |
| @fastify/multipart | **10.1.2** | 2026-09-22 | Set `limits.fileSize` / `files` |
| @fastify/helmet | **13.1.1** | 2026-08-19 | Depends on `helmet ^8.0.0` |
| @fastify/rate-limit | **11.2.0** | 2026-07-29 | 11.0.0 was 2026-06-09 |
| @fastify/csrf-protection | **8.0.1** | 2026-08-02 | Use `sessionPlugin: '@fastify/session'` |
| @fastify/cors | 11.3.0 | 2026-07-08 | **Not needed** with same-origin `/api`. Leave it out. |
| fastify-type-provider-zod | **7.0.0** | 2026-06-24 | **Peers: `@fastify/swagger >=9.5.1`, `fastify ^5.5.0`, `openapi-types ^12.1.3`, `zod >=4.1.5`.** README table: "<=4.x → zod v3; >=5.x <7.x → v4; >=7.x → v4.2+". "Starting from v7, this library uses Zod's `.encode()` / `.decode()` APIs introduced in Zod 4.2 … response serialization is now based on `z.output<T>` instead of `z.input<T>`." The README imports `z` from `'zod/v4'`, but plain `'zod'` works with zod 4.6.5 [RUN]. |
| openapi-types | **12.1.3** | 2023-05-24 | Required peer of the type provider |

### 3.4 Data, auth, storage, logging, utilities

| Package | Pin | Released (UTC) | Latest | Engines | Notes |
|---|---|---|---|---|---|
| drizzle-orm | **0.45.3** | 2026-09-21 10:06 | `latest`. 1.0 is still at `rc` 1.0.0-rc.4 / rc.5-*. | — | Optional peers include `pg >=8`, `postgres >=3`, `@electric-sql/pglite >=0.2.0`. Stay on 0.45.x until 1.0 GA. |
| drizzle-kit | **0.31.11** | 2026-09-21 10:06 | n/a | — | Depends on `esbuild ^0.25.4` and `@esbuild-kit/esm-loader` (pulls esbuild 0.18), which need allowBuilds. |
| drizzle-zod (optional) | 0.8.3 | 2025-08-06 | n/a | — | Peer `zod ^3.25.0 \|\| ^4.0.0`. Moves into drizzle-orm in 1.0. Prefer hand-written domain Zod schemas. |
| pg | **8.23.1** | 2026-09-30 15:39 | n/a | node >= 16 | Optional peer `pg-native`. Do not use it. |
| @types/pg | **8.23.1** | 2026-08-17 | n/a | — | |
| postgres (postgres.js, alternative) | 3.4.9 | 2026-04-05 | n/a | node >=12 | Fine, but `pg` is more widely used with Drizzle and pairs with `connect-pg-simple`. |
| @electric-sql/pglite | **0.5.8** | 2026-08-26 | n/a | — | **Embeds PostgreSQL 18.3** (`select version()` → `PostgreSQL 18.3 (PGlite 0.5.8) on wasm32-unknown-emscripten`) [RUN]. Works with `drizzle-orm/pglite`. |
| connect-pg-simple (option) | 10.0.0 | 2024-09-13 | n/a | node `^18.18.0 \|\| ^20.9.0 \|\| >=22.0.0` | Ready-made PostgreSQL store for express-session-compatible APIs. Alternatively write a small Drizzle store. |
| openid-client | **6.8.8** | 2026-09-05 | n/a | — | ESM-only v6 API, see section 10 |
| jose | **6.2.12** | 2026-09-05 | n/a | — | |
| oidc-provider (test IdP option) | 9.12.2 | 2026-09-05 | n/a | — | In-process Node OIDC provider for tests |
| @aws-sdk/client-s3 | **3.1143.0** | 2026-09-29 19:05 | 3.1144.0 (2026-09-30 19:02, <24 h) | node >=20 | Daily releases. Any recent version works. Pin exactly. |
| @aws-sdk/s3-request-presigner | **3.1143.0** | 2026-09-29 19:05 | 3.1144.0 | node >=20 | Must equal the client-s3 version |
| pino | **10.3.1** | 2026-02-09 | n/a | — | Fastify accepts `^9.14.0 \|\| ^10.1.0` |
| pino-pretty (dev) | 13.1.3 | 2025-12-01 | n/a | — | |
| undici (only if needed) | 7.30.0 | 2026-09-25 | 8.11.2 | node >=20.18.1 (v8: >=22.19.0) | Node 24 bundles undici **7.25.0**. Keep the same major if you pass an undici `Agent` as `dispatcher` to global fetch. [INFERRED] |
| dotenv (avoid) | 18.0.5 | 2026-09-30 | n/a | — | 18.0.0 → 18.0.5 in 13 days (new fast parser). Use Node `--env-file-if-exists`. |
| tsx | **4.23.15** | 2026-09-20 | n/a | node >=18 | Depends on `esbuild ~0.28.0`. Dev runner for api/worker/scripts. |
| openapi-typescript | **7.13.0** | 2026-02-11 | n/a | — | Peer `typescript ^5.x`. **Works with TS 6.0.3** [RUN]. Silence with `peerDependencyRules.allowedVersions`. |
| openapi-fetch | **0.17.0** | 2026-02-11 | n/a | — | Typed fetch over openapi-typescript output. Useful for the Canton JSON Ledger API OpenAPI. |

### 3.5 Testing, lint, formatting

| Package | Pin | Released (UTC) | Latest | Required peers | Engines | Notes |
|---|---|---|---|---|---|---|
| vitest | **5.0.3** | 2026-09-30 11:30 | n/a | **vite `^6.4.0 \|\| ^7.0.0 \|\| ^8.0.0` (not optional, add vite explicitly)** | node `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` | 5.0.0 was 2026-09-03. Tags `V4` 4.1.11, `V3` 3.2.7. |
| @vitest/coverage-v8 | 5.0.3 | 2026-09-30 | n/a | vitest 5.0.3 (exact) | — | |
| vite | **8.3.1** | 2026-09-24 | 8.3.2 (2026-10-01) | — | node `^20.19.0 \|\| >=22.12.0` | **Native `resolve.tsconfigPaths: true`** (in Vite 8 types: "Enable tsconfig paths resolution"). vite-tsconfig-paths is not needed. |
| @vitejs/plugin-react | **6.1.1** | 2026-08-28 | n/a | vite ^8.0.0 | node `^20.19.0 \|\| >=22.12.0` | |
| @testing-library/react | **16.3.3** | 2026-08-27 | n/a | react/react-dom ^18 \|\| ^19, `@testing-library/dom ^10.0.0` | node >=18 | Add `@testing-library/dom` explicitly |
| @testing-library/dom | **10.4.2** | 2026-09-13 | n/a | — | node >=18 | |
| @testing-library/user-event | **14.6.7** | 2026-09-02 | n/a | @testing-library/dom >=7.21.4 | — | |
| @testing-library/jest-dom | **7.0.1** | 2026-08-09 | n/a | `@testing-library/dom >=10 <11` (vitest optional) | **node >=22** | `import "@testing-library/jest-dom/vitest"` |
| jsdom | **30.1.1** | 2026-09-22 | n/a | — | **node `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0`** | Requires Node 24.15 or later |
| happy-dom (alternative) | 20.14.5 | 2026-09-12 | n/a | — | node >=20 | |
| @playwright/test | **1.63.0** | 2026-09-04 | n/a | — | node >=20 | Install browsers with `pnpm exec playwright install chromium`. Not a postinstall. |
| @next/playwright (optional) | 16.3.8 | 2026-09-30 | n/a | @playwright/test >=1.0.0 (optional) | — | `instant()` helper for Instant Navigations tests |
| eslint | **9.39.5** | 2026-07-10 | 10.11.0 (2026-09-18) | — | node `^18.18.0 \|\| ^20.9.0 \|\| >=21.1.0` | **npm-deprecated:** "This version is no longer supported." **EOL 2026-08-06.** See section 13. |
| @eslint/js | 9.39.5 | 2026-07-10 | 10.0.1 | — | — | Only if you compose your own config |
| typescript-eslint | **8.71.0** | 2026-09-28 | n/a | **eslint `^8.57.0 \|\| ^9.0.0 \|\| ^10.0.0`; typescript `>=4.8.4 <6.1.0`** | — | This is the constraint that rules out TS 7 |
| eslint-config-next | **16.3.8** | 2026-09-30 15:59 | n/a | eslint >=9.0.0 | — | Depends on eslint-plugin-react ^7.37.0, eslint-plugin-import ^2.32.0, eslint-plugin-jsx-a11y ^6.10.0, eslint-plugin-react-hooks ^7.0.0, typescript-eslint ^8.46.0, @next/eslint-plugin-next 16.3.8, eslint-import-resolver-typescript ^3.5.2, globals 16.4.0 |
| @next/eslint-plugin-next | 16.3.8 | 2026-09-30 | n/a | — | — | Usable standalone (ESLint 10 path) |
| eslint-plugin-react-hooks | 7.1.1 | 2026-04-17 | n/a | eslint `… ^9.0.0 \|\| ^10.0.0` | node >=18 | Includes React Compiler rules such as `react-hooks/set-state-in-effect` [RUN] |
| eslint-plugin-react | 7.37.5 | 2025-04-03 | n/a | eslint `… ^9.7` | — | **Crashes on ESLint 10** [RUN] |
| eslint-plugin-jsx-a11y | 6.10.2 | 2024-10-26 | n/a | eslint `… ^9` | — | Works on ESLint 10 in a test with all rules on [RUN], but the peer range excludes 10 |
| globals | 17.12.0 | 2026-09-01 | 17.13.0 (2026-10-01) | — | node >=18 | |
| prettier (optional) | 3.9.9 | 2026-09-23 | n/a | — | — | The shadcn template adds it with `prettier-plugin-tailwindcss` |
| prettier-plugin-tailwindcss | 0.8.1 | 2026-07-15 | n/a | prettier ^3.0 | node >=20.19 | The template sets `"tailwindStylesheet": "app/globals.css", "tailwindFunctions": ["cn","cva"]` |

### 3.6 Non-npm components (local infrastructure)

| Component | Pin | Released | Windows-native? | Container image | Notes |
|---|---|---|---|---|---|
| Java (for Keycloak) | Temurin **21.0.12.1** (installed) | 2026-08-18 | yes | n/a | Keycloak supports OpenJDK 17/21/25 |
| Keycloak | **26.7.5** (`keycloak-26.7.5.zip`, sha1 `4aaddef6c5a3f29d51b7d46ad0ac70086e6f3210`) | 2026-09-30 | **yes, verified** | `quay.io/keycloak/keycloak:26.7.5` (anonymous pull OK [RUN]) or `keycloak/keycloak:26.7.5` on Docker Hub | 26.8.0 was released 2026-10-01 (OID4VCI, SCIM, stateless multi-cluster) |
| SeaweedFS | **4.48** (`windows_amd64.zip`, md5 `01b750286b6b15411be5e4e76e7831e6`) | 2026-09-28 | **yes, verified** | `chrislusf/seaweedfs:4.48` | Apache-2.0 |
| PostgreSQL (dev) | WSL Ubuntu **16.14** (installed) | n/a | WSL | `postgres:16.15-alpine` for compose parity (18.6 also available) | PGlite tests run PostgreSQL 18.3 |

---

## 4. Compatibility findings and gotchas (most important first)

1. **TypeScript 7 is incompatible with the lint toolchain.** `typescript@7.0.2`'s `exports` contain only `"."` → `./lib/version.cjs` plus `./unstable/*`. There is no `typescript.js` compiler API. The TS 7.0 announcement says: "TypeScript 7.0 does not ship with an API. We expect TypeScript 7.1 to ship with a new (and different) API". typescript-eslint 8.71.0 peers `typescript >=4.8.4 <6.1.0`. **Pin `typescript@6.0.3`.** Next 16.3 can optionally type-check with TS 7 ("`next build` can use TypeScript 7 for type checking", https://nextjs.org/blog/next-16-3). Microsoft's official dual-install recipe is in section 9.
2. **TS 6.0 errors on deprecated options.** Verified [RUN]: `error TS5101: Option 'baseUrl' is deprecated and will stop functioning in TypeScript 7.0. Specify compilerOption '"ignoreDeprecations": "6.0"' to silence this error.` The same applies to `moduleResolution=node10` and `target=ES5` (TS5107). **The shadcn docs examples still show `"baseUrl": "."`. Do not copy that.** `paths` works without `baseUrl`. The tsconfig the shadcn CLI actually generates has no `baseUrl` [RUN].
3. **ESLint 10 vs eslint-config-next.** Under eslint 10.11.0, `eslint-config-next/core-web-vitals` crashes: `TypeError: Error while loading rule 'react/display-name': contextOrFilename.getFilename is not a function` (eslint-plugin-react 7.37.5) [RUN]. Adding `settings: { react: { version: "19.3" } }` avoids that crash. But enabling more eslint-plugin-react rules then crashes with `react/forward-ref-uses-ref: context.getSourceCode is not a function` [RUN]. `pnpm peers check` reports unmet `eslint` peers for eslint-plugin-import, jsx-a11y and react. eslint-config-next canary 16.4.0-canary.55 has the same dependency set. **Decision: ESLint 9.39.5** (section 13).
4. **Next rewrites cap request bodies at 10 MB, even without `proxy.ts`.** A 12 MB POST to `/api/upload` via `rewrites()` failed with HTTP 500. The log said `Request body exceeded 10MB for /api/upload. Only the first 10MB will be available unless configured.` and then `Failed to proxy … Error: socket hang up` [RUN]. It works after setting `experimental: { proxyClientMaxBodySize: "60mb" }`. The docs label that option experimental [READ]. The Route Handler proxy streamed 12 MB and 50 MB with no config [RUN].
5. **Next rewrites are resolved at build time.** Built with `API_INTERNAL_ORIGIN=http://127.0.0.1:4555`, `.next/routes-manifest.json` contains `"destination": "http://127.0.0.1:4555/api/:path*"` [RUN]. Changing the env var at `next start` has no effect, so one image cannot be promoted across environments. The Route Handler proxy reads `process.env` per request (built with 4000, started with 4555, reached 4555) [RUN].
6. **Rewrites do not add `X-Forwarded-For`.** The upstream saw `x-forwarded-host: localhost:3555`, `host: 127.0.0.1:4555`, **`x-forwarded-for` absent** [RUN]. Fastify `@fastify/rate-limit` keyed by IP would then treat all users as one client. The Route Handler path forwarded `x-forwarded-for: ::1` [RUN]. Key rate limits by session or user, and set Fastify `trustProxy` to the web tier's address.
7. **undici fetch rejects the `Expect` header.** A naive Route Handler proxy that copies every request header failed on large curl uploads with `NotSupportedError: expect header not supported` / `UND_ERR_NOT_SUPPORTED` [RUN]. Strip `expect` along with the hop-by-hop headers (fixed version in section 7.3).
8. **pnpm 11 `minimumReleaseAge` (1 day) and same-day releases.** Exact pins younger than 24 h either fall back (default) or **fail** (if you set `minimumReleaseAge` explicitly, strict mode turns on). Choose versions at least 1 day old, or use `minimumReleaseAgeExclude: ['pkg@x.y.z']`.
9. **MinIO is not usable.** Repo archived ("THIS REPOSITORY IS NO LONGER MAINTAINED"). `https://dl.min.io/server/minio/release/windows-amd64/minio.exe` returns **HTTP 410 Gone**. Docker Hub `minio/minio` and `minio/mc` return 404 [RUN]. See section 11.
10. **AWS SDK checksums against non-AWS S3.** Set `requestChecksumCalculation: "WHEN_REQUIRED"` and `responseChecksumValidation: "WHEN_REQUIRED"` with `forcePathStyle: true`. Put/presigned PUT/presigned GET all worked against SeaweedFS with these settings [RUN]. I did not test default settings. The rationale (SDK ≥ 3.729 default CRC checks break some S3 clones) is [INFERRED/known community issue].
11. **PGlite runs PostgreSQL 18.3, but dev DB is 16.14.** Use PGlite for fast unit tests only. Run integration and migration tests against the real PostgreSQL 16 in WSL (or compose `postgres:16.15-alpine`) so migration behavior matches.
12. **vitest 5 needs an explicit `vite` devDependency.** The peer is not optional, and vitest 5's own dependencies don't include vite.
13. **jsdom 30 requires Node ≥ 24.15.0** on the 24 line. CI images must not use an older 24.x.
14. **recharts needs `react-is`.** Add `react-is@19.3.0` (same version as react).
15. **Next 16.3 `next dev` writes `AGENTS.md`.** It writes and keeps a managed block in the app directory ("This block is written and re-added by `next dev`"). The shadcn template also creates `AGENTS.md` and `CLAUDE.md`. Commit them or accept them. Removing them only recreates the diff [READ/RUN].
16. **Cold-start test timeouts on Windows.** The first vitest run of the API suite (fastify + swagger + PGlite WASM init) exceeded the default 5 s timeout. A warm rerun took 5.2 s total [RUN]. Set `testTimeout: 30_000` for integration-style suites.

---

## 5. Next.js 16.3 App Router requirements and decisions

Sources: https://nextjs.org/docs/app/guides/upgrading/version-16 (doc `version: 16.3.7`, lastUpdated 2026-08-25) and https://nextjs.org/blog/next-16-3 (published "August 3rd 2026") [READ].

- **Minimums:** "Node.js 20.9+" and "TypeScript 5+ | Minimum version now `5.1.0`". Browsers: "Chrome 111+, Edge 111+, Firefox 111+, Safari 16.4+".
- **React:** "The App Router in Next.js 16 uses the latest React Canary release, which includes the newly released React 19.2 features". The `react`/`react-dom` peer is `^18.2.0 || ^19.0.0`. With react 19.3.0 installed, the build passed [RUN].
- **Turbopack is the default:** "Starting with Next.js 16, Turbopack is stable and used by default with `next dev` and `next build`". `--webpack` opts out. A custom `webpack` config makes `next build` **fail** unless you pass `--webpack`. `experimental.turbopack` moved to top-level `turbopack`. The filesystem cache is on by default for dev and build. 16.3 adds dev memory eviction ("up to 90% less RAM").
- **`next.config.ts`** is supported ("✓ Running next.config.ts took 203ms") [RUN].
- **`middleware.ts` → `proxy.ts`:** "The `middleware` filename is deprecated, and has been renamed to `proxy`". The exported function is `export function proxy(request)`. "The `edge` runtime is NOT supported in `proxy`. The `proxy` runtime is `nodejs`, and it cannot be configured." `skipMiddlewareUrlNormalize` becomes `skipProxyUrlNormalize`. Codemod: `pnpm dlx @next/codemod@canary upgrade latest`.
  - **Collara guidance:** if you add `proxy.ts` (for example an auth redirect for `/app/*`), set `config.matcher` to exclude `/api` and static assets. When proxy is used, "Next.js automatically clones the request body and buffers it in memory", up to `proxyClientMaxBodySize` (default **10 MB**). Past that, "only the partial body will be available" and "The request will **not** fail". That would silently truncate uploads.
- **Async request APIs:** "Starting with Next.js 16, synchronous access is fully removed." This covers `cookies()`, `headers()`, `draftMode()`, `params` and `searchParams`, all `await`ed. Use the `PageProps<'/route/[id]'>` / `LayoutProps` / `RouteContext` helpers. `next typegen` generates them, and `next build` writes them to `.next/types`.
- **Caching:**
  - Without Cache Components (the default, `cacheComponents` off): "By default, `fetch` requests are not cached". GET Route Handlers are dynamic by default.
  - `revalidateTag(tag, profile)` now **requires** a second argument such as `'max'`. `updateTag` (Server Actions only, read-your-writes) and `refresh()` are new. `cacheLife`/`cacheTag` are stable (no `unstable_`).
  - `experimental.dynamicIO`/`useCache` were removed in favor of top-level **`cacheComponents: true`** (PPR + `'use cache'`). 16.3 adds `partialPrefetching: true`, and "The behaviors behind Instant Navigations will become the default in a future major version".
  - **Decision for Collara: leave `cacheComponents` off for the MVP.** [INFERRED] All private data goes through the Fastify API (client-side TanStack Query, or server-side `fetch` with `cache: 'no-store'`). Public pages are static. Cache Components adds Suspense and `'use cache'` discipline, and a wrong `'use cache'` on a cookie-reading path is a cross-user leak risk. Revisit after the MVP.
- **Measured response headers** [RUN, `next start`]:
  - Static `/`: `Cache-Control: s-maxage=31536000`, `x-nextjs-cache: HIT`, `x-nextjs-prerender: 1`.
  - Dynamic page that awaits `cookies()`: `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`.
  - `headers()` in next.config can override a route's header. Verified `private, no-store` on `/app/:path*`.
- **Removed in 16:** `next lint` ("Use Biome or ESLint directly. `next build` no longer runs linting."), the `eslint` key in next.config, AMP, `serverRuntimeConfig`/`publicRuntimeConfig` (use env and `connection()`), and `devIndicators.appIsrStatus/buildActivity*`.
- **Other 16.x changes:**
  - Parallel route slots need `default.js`.
  - `next/image` defaults: `minimumCacheTTL` is 4 h, `qualities` is `[75]`, local IPs are blocked, `maximumRedirects` is 3.
  - `next dev` output moved to `.next/dev`, with a lockfile that prevents concurrent `next dev`/`next build` on the same project. The scroll-behavior override changed.
  - `reactCompiler: true` is stable but off by default. It needs `babel-plugin-react-compiler@1.0.0`. 16.3 has an experimental Rust compiler (`experimental.turbopackRustReactCompiler`).
  - 16.3 adds `catchError` from `next/error`, `import.meta.glob`, `next/root-params`, and experimental `experimental.useOffline` with `useOffline` from `next/offline`.
- **Workspace packages:** `transpilePackages: ["@collara/domain"]` with a package that exports `./src/index.ts` built fine under Turbopack [RUN].

---

## 6. Tailwind v4 + shadcn (Base UI) setup

### 6.1 Tailwind v4 in Next (CSS-first)

From https://tailwindcss.com/docs/installation/framework-guides/nextjs ("Tailwind CSS v4.3") [READ], verified [RUN]:

```js
// postcss.config.mjs
const config = { plugins: { "@tailwindcss/postcss": {} } };
export default config;
```

```css
/* app/globals.css */
@import "tailwindcss";
```

- There is no `tailwind.config.*`. In shadcn `components.json`, `tailwind.config` must be `""`: "For Tailwind CSS v4, leave this blank."
- **Monorepo source detection.** Tailwind v4 automatically ignores "Files in your `.gitignore` file", "Files in the `node_modules` directory", binaries, CSS and lockfiles. If the CSS entry lives in `packages/ui` but classes are used in `apps/web` (or the reverse), register sources explicitly relative to the stylesheet: `@source "../../../apps/web";` (adjust the path). Use `@source not "…"` to exclude, and `@import "tailwindcss" source(none);` to disable auto-detection (https://tailwindcss.com/docs/detecting-classes-in-source-files) [READ].

### 6.2 What `shadcn init` generates today

I ran `pnpm dlx shadcn@4.21.0 init -t next -b base -p nova -n webprobe --no-monorepo -y` [RUN].

CLI options (`shadcn init --help`, 4.21.0) [RUN]:
- `-t, --template <template>`: `next, start, vite, react-router, laravel, astro`
- `-b, --base <base>`: "the component library to use. (base, radix, aria)"
- `--monorepo` / `--no-monorepo`
- `-p, --preset [name]`
- `-d, --defaults`: "use default configuration: --template=next --preset=base-nova"
- `--css-variables` (default true)
- `--rtl`, `--pointer`, `--reinstall`

Other commands: `apply`, `add` (with `--dry-run`/`--diff`/`--view`), `docs`, `view`, `search|list`, `migrate`, **`eject`** ("inline shadcn/tailwind.css and remove the shadcn dependency"), `info`, `build`, `mcp`, `preset`, `registry`.

> Without `-p`, `init` stops at an interactive preset prompt (Nova, Vega, Maia, Lyra, Mira, Luma, Sera, Rhea, Custom) even with `CI=1 -y`. Always pass `-p`.

**Generated `components.json`** (verbatim) [RUN]:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "base-nova",
  "rsc": true,
  "tsx": true,
  "tailwind": { "config": "", "css": "app/globals.css", "baseColor": "neutral", "cssVariables": true, "prefix": "" },
  "iconLibrary": "lucide",
  "rtl": false,
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui", "lib": "@/lib", "hooks": "@/hooks" },
  "menuColor": "default",
  "menuAccent": "subtle",
  "registries": {}
}
```

- The schema (https://ui.shadcn.com/schema.json) allows these `style` values: `default`, `new-york`, and `{radix,base,aria}-{vega,nova,maia,lyra,mira,luma,sera,rhea}`.
- `style`, `baseColor` and `cssVariables` "cannot be changed after initialization".
- `baseColor` is one of `neutral | stone | zinc | mauve | olive | mist | taupe`.

**Generated dependencies** [RUN]:
- dependencies: `@base-ui/react ^1.8.0`, `class-variance-authority ^0.7.1`, `cn ^0.4.0`, `lucide-react ^1.49.0`, `next 16.3.6`, `next-themes ^0.4.6`, `react 19.2.8`, `react-dom 19.2.8`, `shadcn ^4.21.0`, `tw-animate-css ^1.4.0`
- devDependencies: `@tailwindcss/postcss ^4`, `tailwindcss ^4`, `typescript ^5`, `eslint ^9`, `eslint-config-next 16.3.6`, `prettier`, `prettier-plugin-tailwindcss`
- `lib/utils.ts` is just `export { cn } from "cn"`
- `components/ui/button.tsx` imports `Button as ButtonPrimitive` from `"@base-ui/react/button"`, `cva` from `class-variance-authority`, and `cn` from `"cn"`
- `app/layout.tsx` uses `next/font/google` Geist/Geist_Mono with `variable: '--font-sans'`. Collara should switch to `next/font/local` with the approved prototype fonts, so builds don't depend on Google Fonts at build time [INFERRED].
- `globals.css` starts with:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));
```

It then defines `@theme inline { --color-*: var(--*) … --radius-* … --font-sans … }`, `:root { …oklch light tokens… }`, `.dark { …dark tokens… }`, and `@layer base { * { @apply border-border outline-ring/50; } body { @apply bg-background text-foreground; } html { @apply font-sans; } }`.
- `shadcn/tailwind.css` holds shared custom variants (`data-open:`, `data-closed:`), accordion keyframes and RTL fixes (changelog 2026-05-31).

**Monorepo (Collara layout).** Per https://ui.shadcn.com/docs/monorepo [READ]:
- **Every workspace that runs the CLI needs its own `components.json`**, with the same `style`, `iconLibrary` and `baseColor`.
- `apps/web/components.json` points `tailwind.css` at `../../packages/ui/src/styles/globals.css` and uses aliases `"ui": "@collara/ui/components"` and `"utils": "@collara/ui/lib/utils"`.
- `packages/ui/components.json` uses its own aliases. Expose files through `packages/ui/package.json` `exports`: `"./globals.css"`, `"./components/*": "./src/components/*.tsx"`, `"./lib/*": "./src/lib/*.ts"`, `"./hooks/*": "./src/hooks/*.ts"`.
- Run `shadcn add` **from `apps/web`**. The CLI puts primitives in `packages/ui` and fixes imports.
- `shadcn init --monorepo` scaffolds a **Turborepo** with `@workspace/*` names. **Do not use that scaffold.** Lay out `packages/ui` by hand to keep tooling small and use `@collara/*` names [INFERRED].

### 6.3 Primitive base: Base UI (recommended) vs Radix vs React Aria

Facts [READ]:
- **2026-07-02:** "Starting today, **Base UI is the default component library in shadcn/ui**". Base UI was then "at 1.6.0 with 6M+ weekly downloads", and "Projects created on shadcn/create now pick Base UI over Radix 2 to 1".
- "**Radix is not being deprecated.** … every update and new component will ship for both libraries (unless a component only exists in Base UI)". Radix stays "one flag away: `npx shadcn init -b radix`".
- The docs default to the Base UI tab. Migration differences include "`asChild` is now `render`".
- **2026-07-17:** React Aria became a first-class base (`--base aria`) across all eight styles.
- Releases: @base-ui/react 1.8.0 (2026-09-04), roughly monthly. radix-ui 1.6.7 (2026-07-24) with 1.7.0 RCs in July.

**Recommendation: Base UI (`-b base`).**
- Collara is a new React codebase migrating from plain HTML, so there is no Radix code to protect.
- It is shadcn's default and the docs' default path, so it gets the most attention for new components.
- It is stable (≥1.0 since 2025-12) and actively released.
- Use one base consistently, as the brief requires. Never mix `@base-ui/react` and `radix-ui` primitives.
- Pick a style once (`base-nova` is the default and best-documented). Collara's look comes from its own tokens.
- **Fallback:** if a required component exists only in Radix's ecosystem, or the team knows Radix's `asChild` API much better, `-b radix` with `radix-ui@1.6.7` is fully supported. Decide **before** `init` (style cannot change later).

### 6.4 `cn` package vs clsx + tailwind-merge

- **2026-09-03 changelog:** "**Every shadcn component now imports `cn` from the `cn` package.**" "`npx shadcn init` installs `cn` and generates a one-line `lib/utils.ts`." Existing projects can run `npx shadcn@latest migrate cn`.
- The README says it is a "drop-in replacement for `twMerge(clsx(...))`", "zero dependencies", "26 KB minified", and "`cn` produces the same output as tailwind-merge for every input. We verify this with 356,000 differential tests."
- Custom theme groups use `createCn({ extend: { classGroups: { "font-size": [{ text: ["hero"] }] } } })` from `cn/config`. Collara needs this if it adds custom font-size tokens such as `text-caption`. Otherwise they are treated as text-color classes and wrongly merged [READ].
- **Risk:** cn is 0.x (0.2.0 on 2026-09-01 → 0.4.0 on 2026-09-22) and maintained by shadcn and aidenybai.
- **Recommendation:** accept `cn@0.4.0` (exact pin), because registry components import it directly and rewriting imports on every `shadcn add` causes friction. Keep `lib/utils.ts` as the single re-export point. Fallback: `clsx@2.1.1` + `tailwind-merge@3.7.0`, plus a post-`add` codemod that replaces `from "cn"`.

### 6.5 Dark-first design-token system

Use shadcn's token contract (`background`/`foreground`, `primary`/`primary-foreground`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, `chart-1..5`, `sidebar-*`, `radius`) so that copied components keep working. Then add Collara semantic tokens. The pattern below compiled and rendered in the verification app [RUN]:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));

/* Dark-first: dark palette is the default. Light is an opt-in override. */
:root {
  --radius: 0.5rem;
  --background: oklch(0.16 0.01 260);
  --foreground: oklch(0.96 0 0);
  --primary: oklch(0.72 0.12 250);
  --primary-foreground: oklch(0.16 0.01 260);
  --muted: oklch(0.24 0.01 260);
  --muted-foreground: oklch(0.7 0.01 260);
  --border: oklch(1 0 0 / 10%);
  --ring: oklch(0.72 0.12 250);
  /* Collara semantic status tokens (separate states per brief) */
  --status-attested: oklch(0.75 0.14 155);
  color-scheme: dark;
}
.light { /* same token names, light values */ color-scheme: light; }

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  /* … one --color-* line per token … */
  --color-status-attested: var(--status-attested);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
}
@layer base { * { @apply border-border outline-ring/50; } body { @apply bg-background text-foreground; } }
```

- Put `<html lang="en" className="dark">` in the root layout. That keeps `dark:` variants in copied shadcn components active, needs no JS, and avoids a flash or hydration warning.
- Add `next-themes@0.4.6` only if a light-mode toggle becomes a requirement. Then use `attribute="class"`, `defaultTheme="dark"`, `enableSystem={false}`, and `suppressHydrationWarning` on `<html>`.
- [INFERRED] Keep the shadcn generator's `:root` (light) / `.dark` split if you want minimal diff noise when re-adding components. Then just ship `class="dark"` permanently. Either way, define **one** source of truth in `packages/ui/src/styles/globals.css`.
- Add separate semantic tokens for the brief's separate states (evidence state, verification validity, lender review, proposal, pledge): for example `--status-pending`, `--status-attested`, `--status-expired`, `--status-blocked`, `--status-locked`, `--status-released`, each with a `-foreground` pair. Expose them via `@theme inline` so `bg-status-locked` and `text-status-locked-foreground` exist.
- Never encode meaning with color alone. Pair every token with a label or icon for accessibility [INFERRED].

---

## 7. Same-origin `/api` routing to Fastify, and private caching

### 7.1 Options compared (all measured on this machine)

| | `next.config.ts` `rewrites()` (external) | Route Handler proxy `app/api/[...path]/route.ts` | Reverse proxy in front (Caddy/nginx) |
|---|---|---|---|
| Upstream origin | **Frozen at build time** in `routes-manifest.json` [RUN] | **Read at request time** [RUN] | Proxy config |
| Body > 10 MB | **500** unless `experimental.proxyClientMaxBodySize` is raised [RUN] | Streams 12 MB and 50 MB OK [RUN] | OK |
| Cookies → upstream | Forwarded [RUN] | Forwarded (copy headers) [RUN] | Forwarded |
| `Set-Cookie` ← upstream | Passed through [RUN] | Passed through via `getSetCookie()` [RUN] | Passed through |
| `X-Forwarded-For` | **Not added** (absent upstream) [RUN] | Present (`::1`) [RUN] | Configurable |
| `Cache-Control` from API | Passed through [RUN] | Passed through, default `private, no-store` added [RUN] | Passed through |
| Extra hop cost | Next's internal proxy | One `fetch` per request inside Next | None for Next |
| Local Windows dev | Simple | Simple | Extra binary |

**Recommendation:** Route Handler proxy at `apps/web/app/api/[...path]/route.ts`.
- Origin comes from `API_INTERNAL_ORIGIN`.
- Strip hop-by-hop headers **and `expect`**.
- Add `cache: 'no-store'`, `redirect: 'manual'`, and `duplex: 'half'` for bodies.
- Force `Cache-Control: private, no-store` when the API omits it.
- **Do not also define a `/api` rewrite.** `beforeFiles` rewrites run before app routes and would shadow the handler.
- Keep the Fastify routes under `/api/*` as well, so paths match one-to-one.
- For large evidence files, prefer **presigned PUT directly to object storage** (to a `quarantine/` prefix) after an API authorization check. Then call a finalize endpoint so the API hashes and validates the object. The browser never streams big files through Next [INFERRED, consistent with the brief's quarantine requirement].
- In production you may put a reverse proxy (Caddy, nginx or the platform's router) in front and route `/api/*` straight to Fastify. The Route Handler then becomes the dev and fallback path [INFERRED].

### 7.2 Making sure private responses are never shared-cached

1. **Fastify sets the policy on every authenticated response.** Use `Cache-Control: private, no-store` and `Vary: Cookie`, applied as an `onSend` hook for `/api/*` except public endpoints. Next passes these through [RUN].
2. **Next pages under `/app/*` (workspace)** read `cookies()`, so they are dynamic by default and get `private, no-cache, no-store, max-age=0, must-revalidate` [RUN]. Belt and braces: `headers()` in next.config sets `Cache-Control: private, no-store` on `/app/:path*` [RUN]. Optionally add `export const dynamic = 'force-dynamic'` in the workspace layout [READ].
3. **Server-side `fetch` in Server Components** to the API: always pass `{ cache: 'no-store' }` and forward the session cookie explicitly. Never wrap it in `'use cache'`/`unstable_cache`. Default `fetch` is not cached in 16.x, but be explicit [READ].
4. **Public marketing pages are static** (`s-maxage=31536000`) [RUN]. Make sure no public page reads cookies or private data.
5. **CDN rule** [INFERRED]: never cache `/api/*` or `/app/*`, and respect `private`/`no-store`.
6. **TanStack Query scoping** [INFERRED best practice]:
   - Create the `QueryClient` inside a client provider with `useState(() => new QueryClient(...))` [RUN]. Never create it at module scope on the server.
   - Prefix every query key with the auth scope, for example `['org', orgId, 'case', caseId]`.
   - Remount the provider with `key={sessionId}` on login or org switch. On logout, call `queryClient.clear()` before redirecting.
   - Keep `staleTime` modest. Never persist the cache to localStorage for private data.

### 7.3 Verified Route Handler proxy (as tested; harden before production)

```ts
// apps/web/app/api/[...path]/route.ts
import type { NextRequest } from "next/server";
const HOP_BY_HOP = new Set(["connection","keep-alive","transfer-encoding","upgrade","host","content-length","expect"]);

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const origin = process.env.API_INTERNAL_ORIGIN ?? "http://127.0.0.1:4000";
  const target = new URL(`/api/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`, origin);
  const headers = new Headers();
  req.headers.forEach((v, k) => { if (!HOP_BY_HOP.has(k)) headers.set(k, v); });
  headers.set("x-forwarded-host", req.headers.get("host") ?? "");
  headers.set("x-forwarded-proto", req.nextUrl.protocol.replace(":", ""));
  const hasBody = !["GET", "HEAD"].includes(req.method);
  const upstream = await fetch(target, {
    method: req.method, headers, body: hasBody ? req.body : undefined,
    // @ts-expect-error -- Node fetch requires duplex for streamed request bodies
    duplex: hasBody ? "half" : undefined, redirect: "manual", cache: "no-store",
  });
  const out = new Headers();
  upstream.headers.forEach((v, k) => { if (!HOP_BY_HOP.has(k) && k !== "set-cookie" && k !== "content-encoding") out.set(k, v); });
  for (const c of upstream.headers.getSetCookie()) out.append("set-cookie", c);
  if (!out.has("cache-control")) out.set("cache-control", "private, no-store");
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
export const GET = forward, POST = forward, PUT = forward, PATCH = forward, DELETE = forward;
```

**Hardening TODO** [INFERRED]:
- Set `x-forwarded-for` deliberately: append the client IP, and do not trust an inbound header blindly.
- Add a timeout via `AbortSignal.timeout()`.
- Map upstream connection errors to a 502 JSON error that the UI's network-error state understands.
- Never forward `authorization` from the browser.

---

## 8. Fastify API recipe (verified pieces)

Verified with `app.inject` [RUN]:
- zod v4 validation (400 on bad body)
- typed params and body
- response serialization
- `Cache-Control` passthrough
- swagger spec containing `/api/cases/{caseId}/proposals`

```ts
import Fastify from "fastify";
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
const app = Fastify({ logger: { level: "info", redact: ["req.headers.cookie", "req.headers.authorization"] } })
  .withTypeProvider<ZodTypeProvider>();
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);
await app.register(helmet);                         // review CSP for swagger-ui
await app.register(rateLimit, { max: 100, timeWindow: "1 minute" /* keyGenerator: session/user id */ });
await app.register(cookie);
await app.register(session, {
  secret: process.env.SESSION_SECRET!,              // >= 32 chars
  cookieName: "__Host-collara_sid",
  cookie: { secure: true, httpOnly: true, sameSite: "lax", path: "/" },
  saveUninitialized: false,
  store: pgSessionStore,                            // Drizzle store or connect-pg-simple
});
await app.register(csrf, { sessionPlugin: "@fastify/session" });
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 1 } });
await app.register(swagger, { openapi: { info: { title: "Collara API", version: "0.1.0" } }, transform: jsonSchemaTransform });
await app.register(swaggerUi, { routePrefix: "/api/docs" });
```

- Augment the session type with `declare module "fastify" { interface Session { userId?: string; pkceVerifier?: string } }` [RUN].
- **`__Host-` cookies need `Secure`.** Browsers accept `Secure` cookies on `http://localhost`, but not on other http hosts [INFERRED, browser behavior]. Run local dev on `localhost`.
- Error handler: use `hasZodFastifySchemaValidationErrors(err)` / `isResponseSerializationError(err)` from the type provider to return redacted 400/500 payloads [READ].
- **OpenAPI → typed client.** Dump `app.swagger()` to `openapi.json`, then run `openapi-typescript openapi.json -o src/generated/api.d.ts` [RUN, 33 ms]. Because Collara shares Zod schemas in `packages/domain`, the web client can also use `z.infer` directly. Generated types mainly help external consumers and the Canton JSON API.

---

## 9. TypeScript configuration (TS 6 now, TS 7-ready)

- **Pin `typescript@6.0.3`** across all workspaces through the catalog.
- **Rules that keep you TS 7-ready** (TS 7 removes `baseUrl`, `moduleResolution node/node10/classic`, `target es5`, `downlevelIteration`, `module amd/umd/systemjs/none`; TS 7 defaults `strict: true`, `module: esnext`, `types: []`, `noUncheckedSideEffectImports: true`, `rootDir: ./`) [READ, https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/]:
  - no `baseUrl`
  - `moduleResolution: "bundler"` for web and packages
  - explicit `"types": [...]`
  - `strict: true`
  - `verbatimModuleSyntax: true`
  - `isolatedModules: true`
- **Base config used in verification** (passed `tsc` and `next build`) [RUN]:

```json
{ "compilerOptions": { "target": "ES2023", "lib": ["ES2023"], "module": "esnext", "moduleResolution": "bundler",
  "strict": true, "noUncheckedIndexedAccess": true, "verbatimModuleSyntax": true, "isolatedModules": true,
  "skipLibCheck": true, "resolveJsonModule": true, "esModuleInterop": true, "types": [] } }
```

- Web adds `"lib": ["dom","dom.iterable","ES2023"]`, `"jsx": "react-jsx"`, `"noEmit": true`, `"incremental": true`, `"types": ["node"]`, `"plugins": [{"name":"next"}]`, `"paths": {"@/*": ["./*"]}`, and includes `.next/types/**/*.ts` and `.next/dev/types/**/*.ts`.
- API and worker extend the base with `"types": ["node"]`. Run them via `tsx` in dev.
- **Production build of api/worker** [INFERRED, not verified]: either `tsc` emit with `module/moduleResolution: nodenext` (requires `.js` suffixes on relative imports) or bundle with esbuild/tsdown. Node 24 type-stripping is an option for scripts, but it needs explicit `.ts` import extensions and no enums or parameter properties.
- **Optional TS 7 type-check speedup** (Microsoft's documented alias recipe; I did not run it). `tsc` then runs TS 7, and `tsc6` plus the `typescript` import give tools TS 6:

```json
"devDependencies": {
  "@typescript/native": "npm:typescript@^7.0.2",
  "typescript": "npm:@typescript/typescript6@^6.0.2"
}
```

  Note that `@typescript/typescript6@6.0.2` (2026-07-06) is a separate package from `typescript@6.0.3`. Next 16.3 can use TS 7 for `next build` type checking (`useTypeScriptCli`). **Not recommended for the MVP.** Keep a single TS.

## 10. OIDC: openid-client v6 + Keycloak

### 10.1 openid-client v6 API (verified end-to-end against Keycloak 26.7.5) [RUN]

```ts
import * as client from "openid-client";
// HTTP issuer allowed ONLY for local dev:
const config = await client.discovery(new URL(process.env.OIDC_ISSUER!), process.env.OIDC_CLIENT_ID!,
  process.env.OIDC_CLIENT_SECRET!, undefined, { execute: [client.allowInsecureRequests] });
// /api/auth/login
const code_verifier = client.randomPKCECodeVerifier();
const code_challenge = await client.calculatePKCECodeChallenge(code_verifier);
const state = client.randomState();            // store verifier+state(+nonce) in the server session
const url = client.buildAuthorizationUrl(config, { redirect_uri, scope: "openid email profile",
  code_challenge, code_challenge_method: "S256", state });
// /api/auth/callback
const tokens = await client.authorizationCodeGrant(config, new URL(currentUrl),
  { pkceCodeVerifier: code_verifier, expectedState: state });
const claims = tokens.claims();                 // id_token claims (sub, email, ...)
// logout
const endSession = client.buildEndSessionUrl(config, { id_token_hint: tokens.id_token!, post_logout_redirect_uri });
```

Results:
- `supportsPKCE: true`
- Simulated login POST → 302 with `code`
- `token_type: bearer`, `email: lender-a@demo.test`
- Redeeming the same code a second time with a wrong verifier was rejected (`ResponseBodyError`). That test does not isolate PKCE enforcement from code reuse.

Notes:
- v6 is ESM-only. Exported helpers include `discovery`, `buildAuthorizationUrl`, `authorizationCodeGrant`, `refreshTokenGrant`, `fetchUserInfo`, `buildEndSessionUrl`, `tokenRevocation`, `allowInsecureRequests`, `randomPKCECodeVerifier`, `calculatePKCECodeChallenge`, `randomState`, `randomNonce`, and `ClientSecretPost`/`ClientSecretBasic`/`PrivateKeyJwt`/`None` (from `build/index.d.ts` [RUN]).
- **Never** enable `allowInsecureRequests` outside `NODE_ENV=development`.
- Bind the app session to Collara's own user/org/party mapping. Keep IdP tokens server-side only. The brief separates the app login session from ledger authorization.

### 10.2 Keycloak

- **Versions** (GitHub releases API) [READ]: **26.8.0** (2026-10-01, today: OID4VCI preview, SCIM API, stateless multi-cluster, token-exchange delegation), **26.7.5** (2026-09-30), 26.7.4 (09-16). **Pin 26.7.5 now.** Move to 26.8.x after its first patch.
- **Java:** "Supported Configurations" lists "OpenJDK 17 (LTS)", "OpenJDK 21 (LTS)" and "OpenJDK 25 (LTS)", recommending 25 for production. 26.6.0 added Java 25 support, and "The server container image continues to use OpenJDK 21". The getting-started page says "Make sure you have OpenJDK 25 installed", but 21 is supported and **works** [RUN]. Windows bare-metal is listed as supported. Supported PostgreSQL versions: 14–18.
- **Verified on this machine** [RUN]: `keycloak-26.7.5.zip` (sha1 matches) on Temurin 21.0.12.1. In Git Bash: `cmd //c "bin\\kc.bat start-dev --http-port=18080 --http-management-port=19000 --import-realm"` with env `KC_BOOTSTRAP_ADMIN_USERNAME`, `KC_BOOTSTRAP_ADMIN_PASSWORD` and `COLLARA_OIDC_CLIENT_SECRET`. Log: `Importing from directory …\data\import`, `Full model import requested. Strategy: IGNORE_EXISTING`, `Realm 'collara' imported`, `Keycloak 26.7.5 on JVM (powered by Quarkus 3.33.4) started in 26.583s. Listening on: http://localhost:18080`. Harmless warnings: deprecated features `identity-brokering-api:v1, twitter-broker:v1`, and a dbus transport info line.
- **PowerShell equivalent** [INFERRED]:

```powershell
$env:KC_BOOTSTRAP_ADMIN_USERNAME = "admin"; $env:KC_BOOTSTRAP_ADMIN_PASSWORD = "<dev-only>"
$env:COLLARA_OIDC_CLIENT_SECRET = "<dev-only>"
& .\.tools\keycloak-26.7.5\bin\kc.bat start-dev --http-port=8081 --http-management-port=9001 --import-realm
```

  Pick ports that don't clash with Canton LocalNet or SeaweedFS. The defaults are 8080 HTTP and 9000 management.
- **Realm import rules** (https://www.keycloak.org/server/importExport) [READ]:
  - `--import-realm` reads `data/import/*.json` ("Only regular files using the `.json` extension are read … sub-directories are ignored").
  - File naming: `<realm-name>-realm.json` (also `<realm>-users-<n>.json`).
  - "If a realm already exists, the import operation is bypassed".
  - Offline commands: `kc.bat import --file <file>` / `--dir <dir> --override true|false` and `kc.bat export --dir|--file`. All nodes must be stopped first.
  - **`${ENV_VAR}` placeholders are substituted** (verified: `"secret": "${COLLARA_OIDC_CLIENT_SECRET}"` worked) [RUN].
- **Bootstrap admin:** `--bootstrap-admin-username/--bootstrap-admin-password` or env `KC_BOOTSTRAP_ADMIN_USERNAME`/`KC_BOOTSTRAP_ADMIN_PASSWORD` (first start only). Or `kc.bat bootstrap-admin user --username tmpadm --password:env PASS_VAR` [READ].
- **Minimal realm JSON that imported and completed the flow** [RUN]:

```json
{ "realm": "collara", "enabled": true, "sslRequired": "external", "registrationAllowed": false,
  "accessTokenLifespan": 300, "ssoSessionIdleTimeout": 1800,
  "roles": { "realm": [ {"name":"lender"}, {"name":"borrower"}, {"name":"verifier"}, {"name":"auditor"} ] },
  "clients": [ { "clientId": "collara-api", "enabled": true, "protocol": "openid-connect",
    "publicClient": false, "clientAuthenticatorType": "client-secret", "secret": "${COLLARA_OIDC_CLIENT_SECRET}",
    "standardFlowEnabled": true, "directAccessGrantsEnabled": false, "implicitFlowEnabled": false,
    "redirectUris": ["http://localhost:3000/api/auth/callback"], "webOrigins": ["http://localhost:3000"],
    "attributes": { "pkce.code.challenge.method": "S256", "post.logout.redirect.uris": "http://localhost:3000/" } } ],
  "users": [ { "username": "lender-a@demo.test", "email": "lender-a@demo.test", "firstName": "Demo", "lastName": "Lender A",
    "enabled": true, "emailVerified": true,
    "credentials": [ { "type": "password", "value": "demo-only-password", "temporary": false } ],
    "realmRoles": ["lender"] } ] }
```

  Org membership, role and party mapping should live in Collara's DB, not in IdP roles, per the brief ("derives authority from trusted configuration and grants") [INFERRED].
- **Lighter alternatives** [READ registry/GitHub, not run]:
  - **oidc-provider 9.12.2** (panva, MIT, Node): in-process provider for **automated tests**. No Java needed.
  - Ory Hydra v26.2.0 has Windows zips but needs your own login/consent app.
  - Dex v2.45.1 publishes **no** release binaries (container or source only).
  - navikt mock-oauth2-server 6.0.4 has no release binaries (container or Maven).
  - **Recommendation:** Keycloak for dev and demo (it runs natively here, and Canton/Splice LocalNet setups also use Keycloak, so check compatibility in the Canton notes). Use `oidc-provider` only for fast CI auth tests if needed.

---

## 11. Object storage without Docker on Windows

### 11.1 MinIO community status [RUN + READ]

- GitHub `minio/minio`: **archived = true**, last push 2026-04-24, license AGPL-3.0. README: "**THIS REPOSITORY IS NO LONGER MAINTAINED.**" It points to proprietary "AIStor Free" and "AIStor Enterprise".
- Last GitHub release: `RELEASE.2025-10-15T17-29-55Z`.
- `https://dl.min.io/server/minio/release/windows-amd64/minio.exe` returns **HTTP 410 Gone** [RUN].
- Docker Hub `minio/minio` and `minio/mc` repositories return **404**. The registry token request is unauthorized, which suggests the repo no longer exists [RUN].
- Third-party timeline [READ, secondary sources: glukhov.org, madewithlove.com, gigazine, byteiota]:
  - May 2025: admin console stripped from community edition
  - Oct 2025: images and binaries stopped
  - 2025-12-03: "maintenance mode"
  - 2026-02-12: "no longer maintained"
  - Repo archived (April 2026)
  - Docker Hub repos deleted (reported 2026-09-11)
- **Conclusion:** do not base Collara dev or CI on MinIO. The brief's "Local development may use MinIO" is superseded. Record this in the ADR.

### 11.2 Alternatives

| Option | License | Latest | Windows native binary | Container | Notes |
|---|---|---|---|---|---|
| **SeaweedFS** | Apache-2.0 | **4.48** (2026-09-28). Very active (35k★, pushed today). | **Yes**: `windows_amd64.zip` (47 MB → `weed.exe` 153 MB). **Verified.** | `chrislusf/seaweedfs:4.48` | `weed mini` = master+volume+filer+S3+WebDAV+Iceberg+Admin UI in one process. Upstream says `weed mini` "is fine for single-node production, such as an S3 gateway that issues presigned URLs". |
| RustFS | Apache-2.0 | **1.0.0** (2026-09-16, first stable). 1.0.1 previews daily. | Yes: `rustfs-windows-x86_64-v1.0.0.zip` (105 MB) | `rustfs/rustfs` | MinIO-like UX. Very new as a stable release. Second choice. |
| Garage (Deuxfleurs) | **AGPL-3.0** | v2.4.1 (2026-09-08) | **No** (Linux musl binaries; Windows URL 404) | `dxflrs/garage:v2.4.1` | Would need WSL2. Needs layout and key setup steps. |
| Versity Gateway | Apache-2.0 | v1.8.0 (2026-09-04) | Zips exist for Windows | n/a | S3 → POSIX gateway. Windows support for its xattr-based posix backend unverified [INFERRED risk]. |
| Ceph RGW | LGPL | n/a | No | Heavy | Too heavy for local dev |
| LocalStack | n/a | Repo **archived 2026-03-23** ("Consolidation into the Unified LocalStack Image") | No (Docker) | Requires account/plan per README | Not suitable |
| Adobe S3Mock | Apache-2.0 | 5.2.3 (2026-09-19). `s3mock-5.2.3-exec.jar` on Maven Central. Runs on Java 17+. | Via Java | `adobe/s3mock` | README: "**Presigned URLs**: Accepted but not validated (expiration, signature, HTTP verb not checked)". **Unsuitable** for testing private-access semantics. |

### 11.3 Recommendation: SeaweedFS 4.48

Verified run on Windows 11 [RUN]:

```powershell
$env:AWS_ACCESS_KEY_ID = "collara-dev"; $env:AWS_SECRET_ACCESS_KEY = "<dev-only-secret>"
& .\.tools\seaweedfs\weed.exe mini -dir=.\.data\s3 -ip=127.0.0.1 -ip.bind=127.0.0.1 -bucket=collara-evidence -admin.ui=false
```

- Binding to 127.0.0.1 avoids a Windows Firewall prompt [INFERRED].
- Startup took about 1 s. Ports: S3 **8333**, master 9333, volume 9340, filer 8888, WebDAV 7333, Iceberg 8181, Lance 9101. gRPC ports are typically +10000 [INFERRED].
- Smoke test results using @aws-sdk 3.1143.0, `forcePathStyle`, `WHEN_REQUIRED` checksums [RUN]:
  - `HeadBucket` OK
  - `PutObject` OK
  - **anonymous GET → 403**
  - presigned GET → 200 with body
  - presigned PUT → 200
  - `GetBucketPolicy` → `NoSuchBucketPolicy` (private by default)
- Drop the `AWS_*` env vars to run **without auth**. Never do that, or the bucket becomes public.
- Bucket creation uses `-bucket=` or the `S3_BUCKET` env var. `-s3.config=<s3.json>` / `-s3.iam` give per-identity least-privilege keys (one key for the API, a read-only one for the worker's export job). I did not test this [READ flags from `weed mini -h`].
- **Compose** (for CI or Linux devs, not runnable here; untested) [INFERRED from README]:

```yaml
services:
  s3:
    image: chrislusf/seaweedfs:4.48
    ports: ["127.0.0.1:8333:8333"]
    environment: { AWS_ACCESS_KEY_ID: collara-dev, AWS_SECRET_ACCESS_KEY: ${S3_DEV_SECRET}, S3_BUCKET: collara-evidence }
    volumes: ["s3data:/data"]
  keycloak:
    image: quay.io/keycloak/keycloak:26.7.5
    command: ["start-dev", "--import-realm"]
    environment: { KC_BOOTSTRAP_ADMIN_USERNAME: admin, KC_BOOTSTRAP_ADMIN_PASSWORD: ${KC_ADMIN_PW}, COLLARA_OIDC_CLIENT_SECRET: ${OIDC_SECRET} }
    volumes: ["./infra/keycloak:/opt/keycloak/data/import:ro"]
    ports: ["127.0.0.1:8081:8080"]
  postgres:
    image: postgres:16.15-alpine
volumes: { s3data: {} }
```

- **AWS SDK client config** (verified):

```ts
new S3Client({ region: "us-east-1", endpoint: process.env.S3_ENDPOINT, forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
  requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
```

---

## 12. Database layer notes

- **Drizzle 0.45.3 + drizzle-kit 0.31.11 + pg 8.23.1.** Use `drizzle-orm/node-postgres` in api/worker and `drizzle-kit generate` + `drizzle-kit migrate` for versioned SQL migrations.
- `numeric({ precision: 18, scale: 2 })` round-trips as the **string** `"100000.10"` (PGlite test) [RUN]. Keep money as strings end to end and use decimal.js for arithmetic.
  - Daml `Numeric 10` / `Decimal` is also string-encoded in the JSON Ledger API [INFERRED; verify in the Canton notes].
  - Store currency explicitly. Keep valuation and principal as separate columns, per the brief.
- **PGlite 0.5.8 for tests:** `new PGlite()` + `drizzle({ client })` from `drizzle-orm/pglite` works [RUN]. It is PostgreSQL 18.3 in WASM, single connection, in-process. Good for repository and unit tests. Do not use it for migration-compatibility checks against PostgreSQL 16.
- **WSL PostgreSQL 16.14** cluster `16/main` is online on port 5432 [RUN, read-only check]. Reaching it from Windows (WSL localhost forwarding, `listen_addresses`, `pg_hba.conf`) is covered elsewhere [not verified here].
- **Session store:** use `connect-pg-simple@10.0.0` (express-session compatible; @fastify/session states stores are "Compatible with stores from express-session") or a 40-line Drizzle store implementing `get/set/destroy`.

## 13. Lint decision (ESLint 9 vs 10)

- **Facts:**
  - https://eslint.org/version-support: "ESLint v9.x reached end-of-life on 2026-08-06 and is no longer maintained". v10.x is "Current" (first release 2026-02-06). npm marks 9.39.5 deprecated.
  - The Next docs (doc version 16.3.8) still show `pnpm add -D eslint eslint-config-next` with flat config and don't mention ESLint 10.
- **Verified:**
  - ESLint **9.39.5** + eslint-config-next 16.3.8 (`core-web-vitals` + `typescript`) lints the app cleanly, with no peer issues [RUN].
  - ESLint **10.11.0** + eslint-config-next crashes without the `settings.react.version` workaround. With the workaround, the recommended rules run but non-recommended react rules crash, and peers are unmet [RUN].
  - A **lean ESLint 10 config** (`@eslint/js` 10.0.1 + typescript-eslint 8.71.0 + `@next/eslint-plugin-next` 16.3.8 recommended + core-web-vitals + `eslint-plugin-react-hooks` 7.1.1 + `eslint-plugin-jsx-a11y` 6.10.2 with **all** rules on) ran without crashes [RUN]. jsx-a11y still has an unmet peer.
- **Decision for the MVP: ESLint 9.39.5 + eslint-config-next 16.3.8 + typescript-eslint 8.71.0.** It is the combination Next.js ships and documents, and lint is dev-only so EOL exposure is minimal.
  - Re-evaluate when eslint-config-next moves to ESLint-10-compatible plugins.
  - If the team wants a supported linter now, use the lean ESLint 10 config and add `peerDependencyRules.allowedVersions: { "eslint-plugin-jsx-a11y>eslint": "10" }`. That config drops eslint-plugin-react rules such as `react/jsx-key`.
- **Verified flat config** for the web app [RUN]:

```js
// apps/web/eslint.config.mjs
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
export default defineConfig([...nextVitals, ...nextTs, globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"])]);
```

- For non-Next packages, use `typescript-eslint` configs (`tseslint.configs.recommended`). In a monorepo root config, set `settings: { next: { rootDir: "apps/web/" } }` if `@next/eslint-plugin-next` runs from the root [READ].
- React Compiler lint rules ship via eslint-plugin-react-hooks 7 (`react-hooks/set-state-in-effect` fired on test code) [RUN]. `reactCompiler: true` in next.config is optional and off by default.

## 14. Testing recipe (verified)

```ts
// apps/web/vitest.config.mts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },        // Vite 8 native
  test: { environment: "jsdom", setupFiles: ["./vitest.setup.ts"], include: ["**/*.test.tsx"] },
});
// apps/web/vitest.setup.ts
import "@testing-library/jest-dom/vitest";
```

- The verified component test rendered a Base UI `Button`, an RHF + zodResolver form, a TanStack Table v9 `useTable` table, motion, and date-fns, and typed via `userEvent.setup()`. 1/1 passed (about 43 s cold on Windows, mostly jsdom environment setup) [RUN].
- API tests use `app.inject()`. 3/3 passed [RUN].
- Playwright 1.63.0: run `pnpm exec playwright install chromium` once. Use the `webServer` config to start Next (and the API). `@next/playwright` `instant()` is optional.

## 15. Workspace files (templates)

**`pnpm-workspace.yaml`** (verified install with pnpm 11.13.0: 1064 packages resolved, `pnpm peers check` → "No peer dependency issues found") [RUN]:

```yaml
packages:
  - apps/*
  - packages/*

minimumReleaseAge: 1440        # explicit → strict; pins must be >= 1 day old
catalogMode: strict

allowBuilds:
  esbuild: true
  unrs-resolver: true
  sharp: true

peerDependencyRules:
  allowedVersions:
    openapi-typescript>typescript: "6"

catalog:
  next: 16.3.8
  react: 19.3.0
  react-dom: 19.3.0
  "@types/react": 19.3.0
  "@types/react-dom": 19.3.0
  typescript: 6.0.3
  "@types/node": 24.19.0
  tailwindcss: 4.3.3
  "@tailwindcss/postcss": 4.3.3
  postcss: 8.5.28
  shadcn: 4.21.0
  "@base-ui/react": 1.8.0
  class-variance-authority: 0.7.1
  cn: 0.4.0
  tw-animate-css: 1.4.0
  lucide-react: 1.49.0
  "@tanstack/react-query": 5.104.0
  "@tanstack/react-query-devtools": 5.104.0
  "@tanstack/react-table": 9.2.4
  react-hook-form: 7.89.0
  "@hookform/resolvers": 5.9.1
  zod: 4.6.5
  date-fns: 4.4.0
  recharts: 3.10.1
  react-is: 19.3.0
  motion: 13.4.6
  fastify: 5.12.5
  fastify-plugin: 6.0.0
  "@fastify/cookie": 11.1.2
  "@fastify/session": 11.1.3
  "@fastify/swagger": 9.9.1
  "@fastify/swagger-ui": 6.1.1
  "@fastify/multipart": 10.1.2
  "@fastify/helmet": 13.1.1
  "@fastify/rate-limit": 11.2.0
  "@fastify/csrf-protection": 8.0.1
  fastify-type-provider-zod: 7.0.0
  openapi-types: 12.1.3
  drizzle-orm: 0.45.3
  drizzle-kit: 0.31.11
  pg: 8.23.1
  "@types/pg": 8.23.1
  "@electric-sql/pglite": 0.5.8
  openid-client: 6.8.8
  jose: 6.2.12
  "@aws-sdk/client-s3": 3.1143.0
  "@aws-sdk/s3-request-presigner": 3.1143.0
  pino: 10.3.1
  pino-pretty: 13.1.3
  decimal.js: 10.6.0
  vitest: 5.0.3
  vite: 8.3.1
  "@vitejs/plugin-react": 6.1.1
  "@testing-library/react": 16.3.3
  "@testing-library/dom": 10.4.2
  "@testing-library/user-event": 14.6.7
  "@testing-library/jest-dom": 7.0.1
  jsdom: 30.1.1
  "@playwright/test": 1.63.0
  eslint: 9.39.5
  "@eslint/js": 9.39.5
  typescript-eslint: 8.71.0
  eslint-config-next: 16.3.8
  globals: 17.12.0
  tsx: 4.23.15
  openapi-typescript: 7.13.0
  openapi-fetch: 0.17.0
```

Not in the verified install but recommended additions: `connect-pg-simple: 10.0.0`, `@vitest/coverage-v8: 5.0.3`, and optionally `prettier: 3.9.9` / `prettier-plugin-tailwindcss: 0.8.1`.

**Root `package.json` essentials:**

```json
{ "private": true, "type": "module", "packageManager": "pnpm@11.28.2",
  "engines": { "node": ">=24.15.0 <25" } }
```

The verification used `"packageManager": "pnpm@11.13.0"` to match the installed binary. pnpm 11's default `pmOnFail: download` fetches the declared version automatically.

**Scripts** (PowerShell-safe, no Bash-only syntax) [INFERRED]:
- `"dev:api": "tsx watch --env-file-if-exists=.env src/server.ts"`
- `"typecheck": "tsc -p tsconfig.json --noEmit"`
- `"lint": "eslint ."`
- `"test": "vitest run"`
- Use `pnpm -r --parallel run dev` or `pnpm --filter @collara/web dev`. Avoid `&&` chains that assume POSIX in docs aimed at PowerShell 5.1 (no `&&` there).

## 16. Verification log (what I actually ran)

All under the scratchpad `C:\Users\Pongo\AppData\Local\Temp\claude\c--Collara\6be7fb37-03a3-41a1-87a9-09a38da10a1f\scratchpad\`. Nothing was written to `C:\Collara\Collara Website\` or Documents/Downloads.

1. `npm view` metadata for every package. Raw JSON is in `npm/{web,client,server,data,tooling}.json`. Matrix rows were built by `matrix.mjs`.
2. `verify/` pnpm 11.13.0 workspace with the catalog above.
   - `pnpm install` → OK (1m45s). `pnpm peers check` → "No peer dependency issues found".
3. `apps/web`:
   - `next build` (Next 16.3.8, Turbopack, TS 6.0.3) → "✓ Compiled successfully", "Finished TypeScript", routes `/` static and `/app` dynamic.
   - `next start` header and rewrite tests (sections 4, 5 and 7).
   - Route Handler proxy test with 12 MB and 50 MB bodies.
   - `eslint .` (9.39.5) → exit 0.
   - `vitest run` (jsdom) → 1 passed.
4. `apps/api`:
   - `tsc -p` → exit 0. `packages/domain` `tsc` → exit 0.
   - `vitest run` → 3 passed: Fastify + zod provider + swagger, Drizzle on PGlite (PostgreSQL 18.3), openid-client PKCE helpers + jose + S3 presign.
   - `openapi-typescript` generation OK.
5. `eslint10/`: ESLint 10.11.0 with eslint-config-next → crash. Workaround and lean config results are in section 13.
6. `seaweed/`: SeaweedFS 4.48 `weed.exe mini` on Windows → S3 smoke test (section 11.3). Process stopped afterwards.
7. `kc/`: Keycloak 26.7.5 zip on Java 21 → realm import + full openid-client 6.8.8 Authorization Code + PKCE flow (section 10). Process stopped afterwards.
8. `probe/webprobe`: `shadcn@4.21.0 init -t next -b base -p nova` → inspected generated files (section 6.2).
9. TS 6 deprecation probe (`baseUrl`, `node10`, `ES5`) → TS5101/TS5107 errors.

## 17. Open questions and risks

1. **ESLint EOL vs Next compatibility:** the team must accept ESLint 9 (EOL) or the lean ESLint 10 config (unmet jsx-a11y peer, no eslint-plugin-react).
2. **`cn` 0.x maturity:** fast-moving package now on shadcn's critical path. Pin it exactly and watch for 1.0.
3. **TanStack Table v9 is two months old (9.0.0 on 2026-08-04).** Most community examples are v8. Use the v9 docs (https://tanstack.com/table/latest/docs/framework/react/guide/migrating.md). `useLegacyTable` exists as a deprecated bridge.
4. **Keycloak and Canton LocalNet:** Splice/Canton LocalNet ships its own Keycloak and port map (see the Canton research notes). Decide whether Collara reuses that realm or runs a separate one, and assign non-conflicting ports (8080/9000 defaults, SeaweedFS 8333/8888/9333/9340/7333/8181/9101).
5. **SeaweedFS IAM:** `-s3.config` identities and actions for least-privilege API/worker keys are untested. Also untested: object lock/versioning (if wanted for evidence immutability) and SSE.
6. **Next 16.3 `proxyClientMaxBodySize`** is experimental. The Route Handler proxy avoids depending on it. Never let `proxy.ts` match `/api`.
7. **React 19.3.0 vs the 19.2.x line:** Next's own templates ask for `^19`, and shadcn's template pins 19.2.8. The build passed on 19.3.0. If a library misbehaves, fall back to 19.2.8 for react, react-dom and react-is together.
8. **Node 26 LTS** arrives 2026-10-28. Plan an upgrade window. All chosen tools already accept 26.
9. **pnpm 12:** postpone. The lockfile will churn once on upgrade.
10. **AWS SDK checksum defaults:** I verified the `WHEN_REQUIRED` config works. I did not test whether the SDK defaults would break SeaweedFS.

## 18. Sources

- Next.js 16 upgrade guide: https://nextjs.org/docs/app/guides/upgrading/version-16
- Next.js 16.3 blog: https://nextjs.org/blog/next-16-3
- Next.js docs:
  - rewrites: https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites
  - proxyClientMaxBodySize: https://nextjs.org/docs/app/api-reference/config/next-config-js/proxyClientMaxBodySize
  - caching (previous model): https://nextjs.org/docs/app/guides/caching-without-cache-components
  - ESLint: https://nextjs.org/docs/app/api-reference/config/eslint
- TypeScript 7.0 announcement: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- pnpm:
  - 11.0 release: https://pnpm.io/blog/releases/11.0
  - 12.0 release: https://pnpm.io/blog/releases/12.0
  - settings source: https://github.com/pnpm/pnpm.io/tree/main/docs/settings
  - catalogs: https://pnpm.io/catalogs
  - approve-builds: https://pnpm.io/cli/approve-builds
- Node release schedule: https://github.com/nodejs/Release/blob/main/schedule.json and https://nodejs.org/dist/index.json
- ESLint version support: https://eslint.org/version-support
- shadcn:
  - CLI: https://ui.shadcn.com/docs/cli
  - Next install: https://ui.shadcn.com/docs/installation/next
  - components.json: https://ui.shadcn.com/docs/components-json
  - theming: https://ui.shadcn.com/docs/theming
  - monorepo: https://ui.shadcn.com/docs/monorepo
  - schema: https://ui.shadcn.com/schema.json
  - changelog sources: https://github.com/shadcn-ui/ui/tree/main/apps/v4/content/docs/changelog (2026-07-base-ui-default, 2026-07-react-aria, 2026-09-cn, 2026-05-shadcn-eject, 2026-03-cli-v4, 2026-02-radix-ui)
- cn package README: `npm view cn readme` / https://github.com/shadcn-ui/cn
- Tailwind CSS:
  - Next install: https://tailwindcss.com/docs/installation/framework-guides/nextjs
  - source detection: https://tailwindcss.com/docs/detecting-classes-in-source-files
- TanStack Table v9 migration: https://tanstack.com/table/latest/docs/framework/react/guide/migrating.md
- fastify-type-provider-zod README (npm tarball 7.0.0)
- @hookform/resolvers README (5.9.1)
- openid-client README and typings (6.8.8)
- Keycloak:
  - releases: https://github.com/keycloak/keycloak/releases
  - getting started: https://www.keycloak.org/getting-started/getting-started-zip
  - supported configurations: https://www.keycloak.org/server/supported-configurations
  - import/export: https://www.keycloak.org/server/importExport
  - bootstrap admin: https://www.keycloak.org/server/bootstrap-admin-recovery
- MinIO: https://github.com/minio/minio (archived README). Secondary sources: https://www.glukhov.org/data-infrastructure/object-storage/minio-dead/ and https://madewithlove.com/blog/thanks-for-all-the-buckets/
- SeaweedFS: https://github.com/seaweedfs/seaweedfs (README Quick Start, releases 4.48)
- RustFS: https://github.com/rustfs/rustfs/releases
- Garage: https://garagehq.deuxfleurs.fr/download/ and https://git.deuxfleurs.fr/Deuxfleurs/garage
- LocalStack (archived README): https://github.com/localstack/localstack
- Adobe S3Mock: https://github.com/adobe/S3Mock
