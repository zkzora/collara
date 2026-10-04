// DEVNET preflight (scripts/devnet/preflight.mjs). Never prints a secret: only versions, statuses, hashes, ids and
// rights. Without credentials it runs the public checks (node, readyz/livez, version, OpenAPI hash, OIDC discovery);
// with a stored credential it also checks the ledger user, its rights, the connected synchronizers and whether each
// package of the upload manifest is present and vetted.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { LedgerClient, type LedgerTokenProvider } from "@collara/canton";
import { matchParties, matchProblems, rightsToParties } from "./bindings";

export type CheckStatus = "ok" | "warn" | "fail" | "skip";
export interface PreflightCheck {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
}

export const EXPECTED_CANTON_VERSION = "3.5.19";
export const COMMITTED_OPENAPI = fileURLToPath(new URL("../../../../packages/canton/openapi/canton-3.5.19.yaml", import.meta.url));
export const UPLOAD_MANIFEST = fileURLToPath(new URL("../../../../docs/devnet/upload-manifest.json", import.meta.url));

export interface ManifestEntry {
  readonly order: number;
  readonly file: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly mainPackageId: string;
  readonly name: string;
  readonly version: string;
  readonly embeds: readonly { name: string; version: string; packageId: string }[];
}

export async function readUploadManifest(path = UPLOAD_MANIFEST): Promise<ManifestEntry[]> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as { dars?: ManifestEntry[] };
  return parsed.dars ?? [];
}

/** Every package id the Collara commands need on the participant (main ids plus their non-SDK dependencies). */
export function requiredPackages(manifest: readonly ManifestEntry[]): { name: string; version: string; packageId: string }[] {
  const byId = new Map<string, { name: string; version: string; packageId: string }>();
  for (const dar of manifest) {
    byId.set(dar.mainPackageId, { name: dar.name, version: dar.version, packageId: dar.mainPackageId });
    for (const p of dar.embeds) byId.set(p.packageId, p);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

async function get(url: string, timeoutMs = 15_000): Promise<{ status: number; text: string } | { error: string }> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { status: response.status, text: await response.text() };
  } catch (error) {
    return { error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 160) : "network error" };
  }
}

export interface PublicPreflightInput {
  readonly jsonApiUrl: string;
  readonly issuer: string;
  readonly tokenEndpoint?: string | undefined;
  readonly jwksUri?: string | undefined;
}

/** Checks that need no credential. */
export async function publicChecks(input: PublicPreflightInput): Promise<PreflightCheck[]> {
  const checks: PreflightCheck[] = [];
  const base = input.jsonApiUrl.replace(/\/+$/, "");
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  checks.push({
    name: "node",
    status: major === 24 && minor >= 15 ? "ok" : "fail",
    detail: `Node ${process.versions.node} (needs >=24.15 <25)`,
  });

  for (const path of ["/readyz", "/livez"]) {
    const r = await get(`${base}${path}`);
    checks.push(
      "error" in r
        ? { name: `GET ${path}`, status: "fail", detail: r.error }
        : { name: `GET ${path}`, status: r.status === 200 ? "ok" : path === "/livez" ? "warn" : "fail", detail: `HTTP ${r.status} ${r.text.replace(/\s+/g, " ").trim().slice(0, 60)}` },
    );
  }

  const version = await get(`${base}/v2/version`);
  if ("error" in version) {
    checks.push({ name: "GET /v2/version", status: "fail", detail: version.error });
  } else {
    let v = "";
    try {
      v = (JSON.parse(version.text) as { version?: string }).version ?? "";
    } catch {
      v = "";
    }
    checks.push({ name: "GET /v2/version", status: v === EXPECTED_CANTON_VERSION ? "ok" : "fail", detail: `Canton ${v || "unknown"} (expected ${EXPECTED_CANTON_VERSION})` });
  }

  const committed = sha256(await readFile(COMMITTED_OPENAPI));
  let openapi: { bytes: Uint8Array } | { error: string };
  try {
    const response = await fetch(`${base}/docs/openapi`, { signal: AbortSignal.timeout(30_000) });
    openapi = response.ok ? { bytes: new Uint8Array(await response.arrayBuffer()) } : { error: `HTTP ${response.status}` };
  } catch (error) {
    openapi = { error: error instanceof Error ? error.name : "network error" };
  }
  if ("error" in openapi) {
    checks.push({ name: "GET /docs/openapi", status: "fail", detail: openapi.error });
  } else {
    // Byte for byte: the typed client is generated from the committed spec.
    const remote = sha256(openapi.bytes);
    checks.push({
      name: "OpenAPI vs committed spec",
      status: remote === committed ? "ok" : "fail",
      detail: `sha256 ${remote.slice(0, 16)}… ${remote === committed ? "=" : "≠"} committed canton-3.5.19.yaml ${committed.slice(0, 16)}…`,
    });
  }

  const issuer = input.issuer.replace(/\/+$/, "");
  const discovery = await get(`${issuer}/.well-known/openid-configuration`);
  if ("error" in discovery || discovery.status !== 200) {
    checks.push({ name: "OIDC discovery", status: "fail", detail: "error" in discovery ? discovery.error : `HTTP ${discovery.status}` });
  } else {
    const d = JSON.parse(discovery.text) as { issuer?: string; token_endpoint?: string; jwks_uri?: string; grant_types_supported?: string[]; scopes_supported?: string[] };
    const tokenEndpoint = input.tokenEndpoint ?? `${issuer}/protocol/openid-connect/token`;
    const jwksUri = input.jwksUri ?? `${issuer}/protocol/openid-connect/certs`;
    const problems = [
      d.issuer !== input.issuer ? `issuer is ${d.issuer}` : "",
      d.token_endpoint !== tokenEndpoint ? `token_endpoint is ${d.token_endpoint}` : "",
      d.jwks_uri !== jwksUri ? `jwks_uri is ${d.jwks_uri}` : "",
      !d.grant_types_supported?.includes("password") ? "no password grant" : "",
      !d.grant_types_supported?.includes("refresh_token") ? "no refresh_token grant" : "",
      !d.scopes_supported?.includes("daml_ledger_api") ? "no daml_ledger_api scope" : "",
      !d.scopes_supported?.includes("offline_access") ? "no offline_access scope" : "",
    ].filter(Boolean);
    checks.push({
      name: "OIDC discovery",
      status: problems.length ? "fail" : "ok",
      detail: problems.length ? problems.join("; ") : "issuer, token endpoint, JWKS, password + refresh_token grants, daml_ledger_api + offline_access scopes",
    });
    const jwks = await get(jwksUri);
    if ("error" in jwks || jwks.status !== 200) {
      checks.push({ name: "OIDC JWKS", status: "fail", detail: "error" in jwks ? jwks.error : `HTTP ${jwks.status}` });
    } else {
      const keys = (JSON.parse(jwks.text) as { keys?: { use?: string; alg?: string }[] }).keys ?? [];
      const signing = keys.filter((k) => k.use !== "enc");
      checks.push({ name: "OIDC JWKS", status: signing.length ? "ok" : "fail", detail: `${signing.length} signing key(s): ${[...new Set(signing.map((k) => k.alg ?? "?"))].join(", ")}` });
    }
  }
  return checks;
}

export interface AuthenticatedPreflightInput {
  readonly jsonApiUrl: string;
  readonly ledgerUserId: string;
  readonly tokenProvider: LedgerTokenProvider;
  readonly manifest: readonly ManifestEntry[];
}

/** Checks with the tenant's token (read-only GETs and list calls; nothing is created, uploaded or submitted). */
export async function authenticatedChecks(input: AuthenticatedPreflightInput): Promise<{ checks: PreflightCheck[]; rightsTable: string[] }> {
  const checks: PreflightCheck[] = [];
  const rightsTable: string[] = [];
  const client = new LedgerClient({ baseUrl: input.jsonApiUrl, tokenProvider: input.tokenProvider, timeoutMs: 30_000 });
  const step = async (name: string, run: () => Promise<PreflightCheck | PreflightCheck[]>) => {
    try {
      const result = await run();
      checks.push(...(Array.isArray(result) ? result : [result]));
    } catch (error) {
      checks.push({ name, status: "fail", detail: (error instanceof Error ? error.message : String(error)).slice(0, 300) });
    }
  };

  await step("ledger user", async () => {
    const user = await client.authenticatedUser();
    return {
      name: "ledger user",
      status: user.id === input.ledgerUserId ? "ok" : "fail",
      detail: `authenticated as ${user.id}${user.primaryParty ? `, primary party ${user.primaryParty}` : ""}${user.id === input.ledgerUserId ? "" : ` (DEVNET_LEDGER_USER_ID is ${input.ledgerUserId})`}`,
    };
  });

  await step("rights", async () => {
    const rights = rightsToParties(await client.listUserRights(input.ledgerUserId));
    for (const party of [...new Set([...rights.actAs, ...rights.readAs])].sort()) {
      rightsTable.push(`${rights.actAs.includes(party) ? "CanActAs " : "         "} ${rights.readAs.includes(party) ? "CanReadAs" : "         "}  ${party}`);
    }
    const match = matchParties(rights);
    const problems = matchProblems(match);
    return [
      { name: "rights", status: rights.actAs.length ? "ok" : "fail", detail: `${rights.actAs.length} party(ies) with CanActAs, ${rights.readAs.length} with CanReadAs` },
      {
        name: "Collara parties",
        status: problems ? "warn" : "ok",
        detail: problems ? `${Object.keys(match.matched).length}/11 matched; ${problems.split("\n").length} problem(s) (import-bindings lists them)` : "all 11 Collara hints matched, each with CanActAs",
      },
    ];
  });

  let participantId = "";
  await step("participant", async () => {
    participantId = await client.participantId();
    return { name: "participant", status: "ok", detail: participantId };
  });

  await step("connected synchronizers", async () => {
    const synchronizers = await client.connectedSynchronizers();
    return {
      name: "connected synchronizers",
      status: synchronizers.length ? "ok" : "fail",
      detail: synchronizers.length ? synchronizers.map((s) => `${s.synchronizerAlias} ${s.synchronizerId}${s.permission ? ` (${s.permission})` : ""}`).join("; ") : "none",
    };
  });

  await step("packages", async () => {
    const required = requiredPackages(input.manifest);
    const known = new Set(await client.listPackages());
    const vetted = await client.vettedPackages({ packageIds: required.map((p) => p.packageId), ...(participantId ? { participantIds: [participantId] } : {}) });
    const vettedIds = new Set(vetted.flatMap((v) => v.packages.map((p) => p.packageId)));
    return required.map((p) => {
      const present = known.has(p.packageId);
      const isVetted = vettedIds.has(p.packageId);
      return {
        name: `package ${p.name} ${p.version}`,
        status: present && isVetted ? "ok" : "fail",
        detail: `${p.packageId.slice(0, 16)}… ${present ? "present" : "NOT present"}, ${isVetted ? "vetted" : "NOT vetted"} on this participant`,
      } satisfies PreflightCheck;
    });
  });
  return { checks, rightsTable };
}

export function formatChecks(checks: readonly PreflightCheck[]): string {
  const mark: Record<CheckStatus, string> = { ok: "ok  ", warn: "WARN", fail: "FAIL", skip: "skip" };
  return checks.map((c) => `  ${mark[c.status]}  ${c.name.padEnd(36)} ${c.detail}`).join("\n");
}
