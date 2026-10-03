#!/usr/bin/env node
// Bootstraps the running local ledger: uploads DARs, allocates parties, creates least-privilege
// ledger users and writes .local/localnet/state.json. Safe to run repeatedly; when the sandbox
// was restarted (new participant id) it re-bootstraps from scratch.
//
//   node scripts/localnet/bootstrap.mjs [--prefix <p>] [--dar <file>]... [--config <file>] [--json-api-url <url>]
//
// --prefix <p> isolates a namespace on the shared sandbox: party hints "<p>-DemoManufacturer", ledger
// users "<p>-borrower-svc" (also "<p>-projector-svc", "<p>-collara-admin"), Collara namespace
// "collara-localnet-<p>" and state file .local/localnet/state-<p>.json. The state file keys parties
// by their logical hint ("DemoManufacturer"), so consumers do not need to know the prefix.
// Without --prefix everything is unchanged (the defaults are reserved for the final demo).
//
// Default DARs: every *.dar under daml/collara/**/.daml/dist/ except the packages listed in
// localnet.config.json `dars.excludePackages` (the test and script packages depend on daml-script
// and are never uploaded), plus `dars.extra` (the vendored DM governance-core-v1 DAR).
// Uses the participant_admin token; tokens are never printed.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  ADMIN_USER,
  CONFIG_FILES,
  PORTS,
  REPO_ROOT,
  api,
  authSettings,
  fail,
  inspectDar,
  isMain,
  isReady,
  jsonApiUrl,
  mintToken,
  namespaceFor,
  normalizePrefix,
  participantsFromPorts,
  prefixed,
  readJson,
  readPortsFile,
  sleep,
  stateFileFor,
  topologyName,
  writeJsonAtomic,
} from "./lib.mjs";

const STATE_VERSION = 1;
const adminToken = () => mintToken(ADMIN_USER, 120);

export async function bootstrap({ dars, configPath, jsonApiUrl: urlOverride, prefix: rawPrefix, log = console.log } = {}) {
  const prefix = normalizePrefix(rawPrefix);
  const config = withPrefix(loadConfig(configPath ?? CONFIG_FILES.localnet), prefix);
  const stateFile = stateFileFor(prefix);
  if (prefix) log(`prefix ${prefix}: parties ${prefixed(prefix, "<Hint>")}, users ${prefixed(prefix, "<user>")}, state ${relative(REPO_ROOT, stateFile)}`);
  const participants = await resolveParticipants(urlOverride);
  const multi = participants.length > 1;

  for (const p of participants) {
    p.version = (await api(p.jsonApiUrl, "GET", "/v2/version")).body?.version;
    p.participantId = (await api(p.jsonApiUrl, "GET", "/v2/parties/participant-id", { token: adminToken() })).body
      ?.participantId;
    if (!p.participantId) throw new Error(`${p.jsonApiUrl}: no participant id returned`);
  }

  const previous = readJson(stateFile);
  const changed = participants.filter((p) => previous?.participants?.[p.name]?.participantId !== p.participantId);
  if (!previous) {
    log("no previous state: bootstrapping");
  } else if (changed.length > 0) {
    for (const p of changed) {
      log(`ledger reset detected on ${p.name}: participant id ${previous.participants?.[p.name]?.participantId ?? "(none)"} -> ${p.participantId}`);
    }
    log("re-bootstrapping from scratch (party ids, users and offsets from the previous run are invalid)");
  } else {
    log("same ledger as the previous bootstrap: verifying idempotently");
  }

  const packages = await uploadDars(participants, dars?.length ? dars.map((d) => resolve(d)) : findDefaultDars(config), log);
  const placement = placementFor(config, participants);
  const parties = await allocateParties(participants, config, placement, log);
  warnReadAsAcrossParticipants(config, parties, log);
  if (multi) await waitForTopology(participants, parties);
  const users = await ensureUsers(participants, config, parties, log);

  const primary = participants[0];
  // The namespace is kept across runs on the same ledger (a seed may have moved it with
  // --force-new-namespace); a reset ledger starts again from the default.
  const sameLedger = !!previous && changed.length === 0;
  const state = {
    version: STATE_VERSION,
    prefix: prefix || null,
    namespace: (sameLedger && typeof previous.namespace === "string" && previous.namespace) || namespaceFor(prefix),
    bootstrappedAt: new Date().toISOString(),
    topology: topologyName(participants.length),
    cantonVersion: primary.version,
    audience: authSettings().audience,
    jsonApiUrl: primary.jsonApiUrl,
    participantId: primary.participantId,
    participants: {},
    parties,
    users,
    packages,
  };
  for (const p of participants) {
    const end = await api(p.jsonApiUrl, "GET", "/v2/state/ledger-end", { token: adminToken() });
    state.participants[p.name] = {
      jsonApiUrl: p.jsonApiUrl,
      participantId: p.participantId,
      ledgerEndAtBootstrap: end.body?.offset ?? 0,
    };
  }
  writeJsonAtomic(stateFile, state);
  log(`wrote ${relative(REPO_ROOT, stateFile)} (${Object.keys(parties).length} parties, ${users.length} users, ${packages.length} DARs)`);
  return state;
}

function loadConfig(path) {
  const config = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(config.parties) || config.parties.length === 0) throw new Error(`${path}: "parties" must be a non-empty array`);
  const hints = new Set();
  const users = new Set([config.projectorUser, config.adminUser]);
  for (const party of config.parties) {
    if (!/^[A-Za-z0-9_-]+$/.test(party.hint ?? "")) throw new Error(`${path}: invalid party hint ${JSON.stringify(party.hint)}`);
    if (!/^[A-Za-z0-9@^$.!`\-#+'~_|:]{1,128}$/.test(party.user ?? "")) throw new Error(`${path}: invalid user id for ${party.hint}`);
    if (hints.has(party.hint) || users.has(party.user)) throw new Error(`${path}: duplicate hint or user for ${party.hint}`);
    hints.add(party.hint);
    users.add(party.user);
  }
  for (const party of config.parties) {
    for (const extra of party.readAs ?? []) {
      if (!hints.has(extra)) throw new Error(`${path}: ${party.hint} readAs unknown party ${extra}`);
    }
  }
  for (const [count, placement] of Object.entries(config.placements ?? {})) {
    if (count.startsWith("$")) continue;
    if (!/^\d+$/.test(count) || typeof placement !== "object" || placement === null) throw new Error(`${path}: placements.${count} must map party hints to participants`);
    for (const hint of hints) {
      if (typeof placement[hint] !== "string") throw new Error(`${path}: placements.${count} has no participant for ${hint}`);
    }
    for (const hint of Object.keys(placement)) {
      if (!hint.startsWith("$") && !hints.has(hint)) throw new Error(`${path}: placements.${count} names unknown party ${hint}`);
    }
  }
  return config;
}

/**
 * Applies an isolation prefix: `hint` stays the logical hint (the key in state.parties), `ledgerHint`
 * is the party id hint allocated on the ledger, and every ledger user id is prefixed.
 */
function withPrefix(config, prefix) {
  return {
    ...config,
    projectorUser: prefixed(prefix, config.projectorUser),
    adminUser: prefixed(prefix, config.adminUser),
    parties: config.parties.map((party) => ({ ...party, ledgerHint: prefixed(prefix, party.hint), user: prefixed(prefix, party.user) })),
  };
}

/**
 * The participants to bootstrap: --json-api-url (one participant) wins; otherwise every participant of the running
 * sandbox (ports file). CANTON_JSON_API_URL (usually set in .env for the API) applies only when the ports file lists
 * at most one participant, so a multi-participant sandbox is never bootstrapped as a single node.
 */
async function resolveParticipants(urlOverride) {
  let participants;
  const ports = readPortsFile();
  const fromPorts = ports ? participantsFromPorts(ports) : [];
  const override = urlOverride ?? (fromPorts.length > 1 ? undefined : process.env.CANTON_JSON_API_URL);
  if (override) {
    participants = [{ name: "", jsonApiUrl: override.replace(/\/+$/, "") }];
  } else {
    participants = fromPorts.length > 0 ? fromPorts : [{ name: "sandbox", jsonApiUrl: jsonApiUrl(PORTS.sandbox.jsonApi) }];
  }
  const deadline = Date.now() + 60_000;
  for (const p of participants) {
    while (!(await isReady(p.jsonApiUrl))) {
      if (Date.now() > deadline) throw new Error(`${p.jsonApiUrl}/readyz is not 200; start the ledger with up.mjs`);
      await sleep(1000);
    }
  }
  if (override) {
    const id = (await api(participants[0].jsonApiUrl, "GET", "/v2/parties/participant-id", { token: adminToken() })).body
      ?.participantId;
    participants[0].name = String(id ?? "sandbox").split("::")[0];
  }
  return participants;
}

function findDefaultDars(config) {
  const root = resolve(REPO_ROOT, config.dars?.root ?? "daml/collara");
  const exclude = new Set(config.dars?.excludePackages ?? []);
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "package-database") walk(full);
      } else if (entry.name.endsWith(".dar") && /[\\/]\.daml[\\/]dist$/.test(dir)) {
        found.push(full);
      }
    }
  };
  walk(root);
  // One DAR per package name, the highest version: a stale build output of an older, upgrade-incompatible version
  // (e.g. collara-contracts 0.1.0 next to 0.2.0) must never be vetted next to the current one (daml-model.md D15).
  const latest = new Map();
  for (const file of found) {
    const { name, version } = inspectDar(file);
    if (exclude.has(name)) continue;
    const current = latest.get(name);
    if (!current || compareVersions(version, current.version) > 0) latest.set(name, { file, version });
  }
  const skipped = found.filter((file) => !exclude.has(inspectDar(file).name) && latest.get(inspectDar(file).name)?.file !== file);
  for (const file of skipped) console.warn(`warning: skipping ${relative(REPO_ROOT, file)} (an older version of a package with a newer DAR)`);
  const extra = (config.dars?.extra ?? []).map((file) => resolve(REPO_ROOT, file));
  return [...[...latest.values()].map((d) => d.file).sort(), ...extra];
}

/** Compares dotted numeric versions ("0.10.0" > "0.2.0"). */
function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

async function uploadDars(participants, files, log) {
  if (files.length === 0) {
    log("warning: no DARs to upload (build them with `dpm build --all` in daml/collara, or pass --dar)");
  }
  const packages = [];
  for (const file of files) {
    const dar = inspectDar(file);
    for (const p of participants) {
      const status = await api(p.jsonApiUrl, "GET", `/v2/packages/${dar.mainPackageId}/status`, {
        token: adminToken(),
        allow: [404],
      });
      if (status.body?.packageStatus === "PACKAGE_STATUS_REGISTERED") {
        log(`dar ${dar.name}-${dar.version} already on ${p.name}`);
        continue;
      }
      await api(p.jsonApiUrl, "POST", "/v2/dars?vetAllPackages=true", {
        token: adminToken(),
        body: dar.buffer,
        timeoutMs: 180_000,
      });
      log(`dar ${dar.name}-${dar.version} uploaded to ${p.name} (package ${dar.mainPackageId.slice(0, 12)}…)`);
    }
    packages.push({
      file: relative(REPO_ROOT, file).replaceAll("\\", "/"),
      name: dar.name,
      version: dar.version,
      mainPackageId: dar.mainPackageId,
      sha256: dar.sha256,
    });
  }
  return packages;
}

async function listParties(p) {
  const all = [];
  let pageToken = "";
  do {
    const query = new URLSearchParams({ pageSize: "1000", ...(pageToken ? { pageToken } : {}) });
    const page = (await api(p.jsonApiUrl, "GET", `/v2/parties?${query}`, { token: adminToken() })).body;
    all.push(...(page?.partyDetails ?? []));
    pageToken = page?.nextPageToken ?? "";
  } while (pageToken);
  return all;
}

/**
 * Participant of each party hint. One participant: all on it. Several: `placements["<count>"]` of the config
 * when it exists (e.g. the 5-participant privacy topology), else each party's `participant` field (the
 * original 3-participant proposal), else "sandbox".
 */
function placementFor(config, participants) {
  const names = new Set(participants.map((p) => p.name));
  const placement = {};
  if (participants.length === 1) {
    for (const entry of config.parties) placement[entry.hint] = participants[0].name;
    return placement;
  }
  const byCount = config.placements?.[String(participants.length)];
  for (const entry of config.parties) {
    const host = byCount?.[entry.hint] ?? entry.participant ?? "sandbox";
    if (!names.has(host)) throw new Error(`party ${entry.hint}: participant ${host} is not running`);
    placement[entry.hint] = host;
  }
  return placement;
}

/** A user that reads as a party hosted on another participant gets nothing for that party there. */
function warnReadAsAcrossParticipants(config, parties, log) {
  for (const entry of config.parties) {
    for (const extra of entry.readAs ?? []) {
      const own = parties[entry.hint].participant;
      const other = parties[extra].participant;
      if (own !== other) log(`warning: ${entry.hint} (${own}) reads as ${extra}, which is hosted on ${other}: that party's contracts are not on ${own}`);
    }
  }
}

async function allocateParties(participants, config, placement, log) {
  const byName = new Map(participants.map((p) => [p.name, p]));
  const existing = new Map();
  for (const p of participants) existing.set(p.name, await listParties(p));
  const parties = {};
  for (const entry of config.parties) {
    const host = placement[entry.hint];
    const p = byName.get(host);
    if (!p) throw new Error(`party ${entry.hint}: participant ${host} is not running`);
    let party = existing
      .get(host)
      .find((d) => d.isLocal && d.party.startsWith(`${entry.ledgerHint}::`))?.party;
    if (party) {
      log(`party ${entry.ledgerHint} exists on ${host}`);
    } else {
      const response = await api(p.jsonApiUrl, "POST", "/v2/parties", {
        token: adminToken(),
        body: { partyIdHint: entry.ledgerHint, identityProviderId: "" },
      });
      party = response.body?.partyDetails?.party;
      if (!party) throw new Error(`party ${entry.ledgerHint}: allocation returned no party id`);
      log(`party ${entry.ledgerHint} allocated on ${host}`);
    }
    parties[entry.hint] = { party, participant: host, user: entry.user };
  }
  return parties;
}

/** With several participants, waits until every participant knows every party (topology propagation). */
async function waitForTopology(participants, parties) {
  const deadline = Date.now() + 30_000;
  for (const p of participants) {
    for (const { party } of Object.values(parties)) {
      for (;;) {
        const response = await api(p.jsonApiUrl, "GET", `/v2/parties/${encodeURIComponent(party)}`, {
          token: adminToken(),
          allow: [404],
        });
        if ((response.body?.partyDetails ?? []).some((d) => d.party === party)) break;
        if (Date.now() > deadline) throw new Error(`${p.name} does not know party ${party} after 30 s`);
        await sleep(500);
      }
    }
  }
}

const canActAs = (party) => ({ kind: { CanActAs: { value: { party } } } });
const canReadAs = (party) => ({ kind: { CanReadAs: { value: { party } } } });
const participantAdmin = () => ({ kind: { ParticipantAdmin: { value: {} } } });
const rightKey = (right) => {
  const [name, body] = Object.entries(right?.kind ?? {})[0] ?? ["?", {}];
  return `${name}:${body?.value?.party ?? ""}`;
};

async function ensureUsers(participants, config, parties, log) {
  const byName = new Map(participants.map((p) => [p.name, p]));
  const users = [];
  for (const entry of config.parties) {
    const { party, participant } = parties[entry.hint];
    const readAs = [party, ...(entry.readAs ?? []).map((hint) => parties[hint].party)];
    const rights = [canActAs(party), ...readAs.map(canReadAs)];
    await ensureUser(byName.get(participant), { id: entry.user, primaryParty: party, rights }, log);
    users.push({ id: entry.user, participant, role: "org", party: entry.hint, primaryParty: party, actAs: [party], readAs });
  }
  for (const p of participants) {
    const hosted = Object.values(parties)
      .filter((x) => x.participant === p.name)
      .map((x) => x.party);
    await ensureUser(p, { id: config.projectorUser, rights: hosted.map(canReadAs) }, log);
    users.push({ id: config.projectorUser, participant: p.name, role: "projector", actAs: [], readAs: hosted });
    await ensureUser(p, { id: config.adminUser, rights: [participantAdmin()] }, log);
    users.push({ id: config.adminUser, participant: p.name, role: "admin", participantAdmin: true, actAs: [], readAs: [] });
  }
  return users;
}

async function ensureUser(p, { id, primaryParty = "", rights }, log) {
  const path = `/v2/users/${encodeURIComponent(id)}`;
  const existing = await api(p.jsonApiUrl, "GET", path, { token: adminToken(), allow: [404] });
  if (existing.status === 404) {
    await api(p.jsonApiUrl, "POST", "/v2/users", {
      token: adminToken(),
      body: { user: { id, primaryParty, isDeactivated: false, identityProviderId: "" }, rights },
    });
    log(`user ${id} created on ${p.name} (${rights.length} rights)`);
    return;
  }
  if ((existing.body?.user?.primaryParty ?? "") !== primaryParty) {
    log(`warning: user ${id} on ${p.name} has primary party ${existing.body?.user?.primaryParty}; expected ${primaryParty}`);
  }
  const current = (await api(p.jsonApiUrl, "GET", `${path}/rights`, { token: adminToken() })).body?.rights ?? [];
  const wanted = new Set(rights.map(rightKey));
  const have = new Set(current.map(rightKey));
  const missing = rights.filter((r) => !have.has(rightKey(r)));
  const extra = current.filter((r) => !wanted.has(rightKey(r)));
  if (missing.length > 0) {
    await api(p.jsonApiUrl, "POST", `${path}/rights`, {
      token: adminToken(),
      body: { userId: id, rights: missing, identityProviderId: "" },
    });
  }
  if (extra.length > 0) {
    await api(p.jsonApiUrl, "PATCH", `${path}/rights`, {
      token: adminToken(),
      body: { userId: id, rights: extra, identityProviderId: "" },
    });
  }
  log(`user ${id} on ${p.name}: ${missing.length} right(s) granted, ${extra.length} revoked`);
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      dar: { type: "string", multiple: true },
      config: { type: "string" },
      "json-api-url": { type: "string" },
      prefix: { type: "string" },
    },
  });
  try {
    await bootstrap({ dars: values.dar, configPath: values.config, jsonApiUrl: values["json-api-url"], prefix: values.prefix });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
