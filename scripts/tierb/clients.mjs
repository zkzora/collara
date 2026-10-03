// Minimal HTTP clients for Tier B: the three DM nodes (REST, --insecure so any bearer is accepted) and the three
// participants' JSON Ledger API v2. Both are reached from Windows through WSL localhost forwarding.
import { createHmac, randomUUID } from "node:crypto";
import { NODES } from "./lib.mjs";

export const HMAC_SECRET = process.env.TIERB_HMAC_SECRET || "collara-tierb-dev-secret";
export const HMAC_AUDIENCE = process.env.TIERB_HMAC_AUDIENCE || "https://collara.local/tierb-ledger-api";
/** Participant admin user (canton `additional-admin-user-id`), also the DM nodes' Canton token subject. */
export const ADMIN_USER = "ledger-api-user";

const b64url = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

/** HS256 token for the unsafe HMAC auth service (dev only). Short-lived. */
export function ledgerToken(sub = ADMIN_USER, ttlSeconds = 240) {
  // Backdated: the WSL clock can trail Windows by a second, and Canton rejects a token "used before" its iat.
  const now = Math.floor(Date.now() / 1000) - 30;
  const head = b64url({ alg: "HS256", typ: "JWT" });
  const body = b64url({ aud: HMAC_AUDIENCE, sub, iat: now, exp: now + 30 + ttlSeconds });
  const sig = createHmac("sha256", HMAC_SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

export const node = (name) => {
  const n = NODES.find((x) => x.name === name);
  if (!n) throw new Error(`unknown node ${name}`);
  return n;
};

async function request(url, opts = {}) {
  // WSL localhost forwarding can take a few seconds to pick up a freshly bound port: retry connection errors only.
  for (let attempt = 1; ; attempt++) {
    try {
      return await requestOnce(url, opts);
    } catch (e) {
      const code = e?.cause?.code;
      if (attempt >= (opts.retries ?? 15) || !["ECONNREFUSED", "ECONNRESET", "UND_ERR_SOCKET"].includes(code)) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function requestOnce(url, { method = "GET", body, token, timeoutMs = 120_000 } = {}) {
  const started = Date.now();
  const res = await fetch(url, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { ok: res.ok, status: res.status, json, text, ms: Date.now() - started, method, url };
}

/** DM REST call. In --insecure mode any bearer works; one is sent anyway, like a real client. */
export function dm(name, method, path, body, opts = {}) {
  return request(`http://127.0.0.1:${node(name).dmHttp}${path}`, { method, body, token: "collara-tierb-insecure", ...opts });
}

/** Throws with the response text when a call fails. */
export function must(res, what) {
  if (!res.ok) {
    const err = new Error(`${what} failed: HTTP ${res.status} ${res.text.slice(0, 2000)}`);
    err.response = res;
    throw err;
  }
  return res.json;
}

export function ledger(name, method, path, body, { user = ADMIN_USER, ...opts } = {}) {
  return request(`http://127.0.0.1:${node(name).json}${path}`, { method, body, token: ledgerToken(user), ...opts });
}

export const tpl = (pkg, mod, entity) => `#${pkg}:${mod}:${entity}`;

export function eventFormat(parties, templateIds) {
  const cumulative = templateIds?.length
    ? templateIds.map((templateId) => ({ identifierFilter: { TemplateFilter: { value: { templateId, includeCreatedEventBlob: false } } } }))
    : [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }];
  return { filtersByParty: Object.fromEntries(parties.map((p) => [p, { cumulative }])), verbose: false };
}

/**
 * submit-and-wait-for-transaction (LEDGER_EFFECTS shape, so exercised events are included). Returns the raw
 * response; callers decide whether a failure is expected.
 */
export function submit(name, { actAs, readAs = [], commands, user = ADMIN_USER, commandId = randomUUID(), timeoutMs = 300_000 }) {
  return ledger(
    name,
    "POST",
    "/v2/commands/submit-and-wait-for-transaction",
    {
      commands: { commandId, userId: user, actAs, readAs, commands },
      transactionFormat: { transactionShape: "TRANSACTION_SHAPE_LEDGER_EFFECTS", eventFormat: eventFormat([...actAs, ...readAs]) },
    },
    { user, timeoutMs },
  );
}

export async function ledgerEnd(name) {
  return must(await ledger(name, "GET", "/v2/state/ledger-end"), "ledger-end").offset;
}

/** Active contracts of `templateIds` visible to `parties` on participant `name`. */
export async function acs(name, parties, templateIds) {
  const activeAtOffset = await ledgerEnd(name);
  const out = [];
  let pageToken;
  do {
    const page = must(
      await ledger(name, "POST", "/v2/state/active-contracts-page", {
        activeAtOffset,
        eventFormat: eventFormat(parties, templateIds),
        maxPageSize: 500,
        ...(pageToken ? { pageToken } : {}),
      }),
      "active-contracts-page",
    );
    for (const entry of page.activeContracts ?? []) {
      const ev = entry?.contractEntry?.JsActiveContract?.createdEvent;
      if (ev) out.push(ev);
    }
    pageToken = page.nextPageToken || undefined;
  } while (pageToken);
  return { activeAtOffset, contracts: out };
}

/** Created and exercised events of a LEDGER_EFFECTS transaction, flattened. */
export function eventsOf(tx) {
  const created = [];
  const exercised = [];
  for (const e of tx?.events ?? []) {
    if (e.CreatedEvent) created.push(e.CreatedEvent);
    if (e.ExercisedEvent) exercised.push(e.ExercisedEvent);
  }
  return { created, exercised };
}

/** Compact receipt of a ledger transaction. */
export function txReceipt(tx) {
  const { created, exercised } = eventsOf(tx);
  return {
    updateId: tx?.updateId,
    offset: tx?.offset,
    synchronizerId: tx?.synchronizerId,
    effectiveAt: tx?.effectiveAt,
    created: created.map((c) => ({ contractId: c.contractId, templateId: c.templateId, signatories: c.signatories })),
    exercised: exercised.map((x) => ({ contractId: x.contractId, templateId: x.templateId, choice: x.choice, actingParties: x.actingParties, consuming: x.consuming })),
  };
}

/** Error code and message of a failed JSON API call (Canton error envelope). */
export function errorOf(res) {
  const j = res.json ?? {};
  return { httpStatus: res.status, code: j.code, cause: j.cause ?? j.errors?.join?.("; "), grpcCodeValue: j.grpcCodeValue, raw: j.code ? undefined : res.text.slice(0, 800) };
}

/**
 * Asynchronous submission with a definitive outcome: POST /v2/commands/async/submit, then poll the user's command
 * completions until this command's completion arrives. Used where submit-and-wait would hit the JSON API's HTTP
 * request timeout (~20 s) before Canton's mediator decides (participant response timeout, ~30 s).
 */
export async function submitWithOutcome(name, { actAs, readAs = [], commands, user = ADMIN_USER, commandId = randomUUID(), waitMs = 180_000 }) {
  const begin = await ledgerEnd(name);
  const started = Date.now();
  const sub = await ledger(name, "POST", "/v2/commands/async/submit", { commandId, userId: user, actAs, readAs, commands }, { user });
  if (!sub.ok) return { accepted: false, phase: "submission", error: errorOf(sub), ms: Date.now() - started, commandId };
  while (Date.now() - started < waitMs) {
    const raw = await ledger(name, "POST", "/v2/commands/command-completions?limit=200&stream_idle_timeout_ms=1000", { parties: actAs, beginExclusive: begin }, { user });
    for (const item of (raw.ok ? raw.json : []) ?? []) {
      const c = item?.completionResponse?.Completion?.value;
      if (c?.commandId === commandId) {
        const code = c.status?.code ?? 0;
        return { accepted: code === 0, phase: "completion", commandId, updateId: c.updateId || undefined, offset: c.offset, status: { code, message: c.status?.message ?? "" }, ms: Date.now() - started };
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { accepted: false, phase: "no-completion", commandId, ms: Date.now() - started };
}
