#!/usr/bin/env node
// Reports whether the local ledger is running, ready and bootstrapped.
//
//   node scripts/localnet/status.mjs [--json]
//
// Exit code 0 when every participant is ready, 1 otherwise.
import { parseArgs } from "node:util";
import {
  ADMIN_USER,
  FILES,
  PORTS,
  api,
  isMain,
  isProcessAlive,
  isReady,
  jsonApiUrl,
  mintToken,
  participantsFromPorts,
  readJson,
  readPortsFile,
} from "./lib.mjs";

export async function status() {
  const record = readJson(FILES.pid);
  const ports = readPortsFile();
  const participants = ports
    ? participantsFromPorts(ports)
    : [{ name: "sandbox", jsonApiUrl: jsonApiUrl(PORTS.sandbox.jsonApi) }];
  const state = readJson(FILES.state);

  const report = {
    process: record ? { pid: record.pid, alive: isProcessAlive(record.pid), startedAt: record.startedAt } : null,
    participants: [],
    bootstrap: "not bootstrapped",
  };
  for (const p of participants) {
    const entry = { name: p.name, jsonApiUrl: p.jsonApiUrl, ready: await isReady(p.jsonApiUrl) };
    if (entry.ready) {
      const token = mintToken(ADMIN_USER, 60);
      try {
        entry.version = (await api(p.jsonApiUrl, "GET", "/v2/version")).body?.version;
        entry.participantId = (await api(p.jsonApiUrl, "GET", "/v2/parties/participant-id", { token })).body?.participantId;
        entry.ledgerEnd = (await api(p.jsonApiUrl, "GET", "/v2/state/ledger-end", { token })).body?.offset ?? 0;
      } catch (error) {
        entry.error = error instanceof Error ? error.message : String(error);
      }
    }
    report.participants.push(entry);
  }

  if (state && !report.participants.every((p) => p.participantId)) {
    report.bootstrap = `unknown (ledger not ready); last bootstrap at ${state.bootstrappedAt}`;
  } else if (state) {
    const stale = report.participants.some(
      (p) => p.participantId && state.participants?.[p.name]?.participantId !== p.participantId,
    );
    report.bootstrap = stale ? "stale (ledger was reset; run bootstrap.mjs)" : `bootstrapped at ${state.bootstrappedAt}`;
  }
  report.ready = report.participants.length > 0 && report.participants.every((p) => p.ready);
  return report;
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { json: { type: "boolean", default: false } } });
  const report = await status();
  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const proc = report.process;
    console.log(`process:   ${proc ? `pid ${proc.pid} (${proc.alive ? "alive" : "not running"}), started ${proc.startedAt}` : "no pid file"}`);
    for (const p of report.participants) {
      const details = p.ready
        ? `ready, Canton ${p.version ?? "?"}, ${p.participantId ?? "?"}, ledger end ${p.ledgerEnd ?? "?"}`
        : "not ready";
      console.log(`${p.name.padEnd(13)} ${p.jsonApiUrl}  ${details}${p.error ? ` (${p.error})` : ""}`);
    }
    console.log(`bootstrap: ${report.bootstrap}`);
  }
  process.exitCode = report.ready ? 0 : 1;
}
