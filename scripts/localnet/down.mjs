#!/usr/bin/env node
// Stops the sandbox started by up.mjs (kills the dpm -> java process tree).
//
//   node scripts/localnet/down.mjs
//
// The ledger is in memory, so all contracts, parties and users are gone afterwards.
// .local/localnet/state.json is kept; bootstrap.mjs detects the new participant id and re-seeds.
import {
  FILES,
  PORTS,
  fail,
  isMain,
  isPortOpen,
  isProcessAlive,
  killTree,
  readJson,
  removeFile,
  sleep,
} from "./lib.mjs";

export async function down() {
  const record = readJson(FILES.pid);
  if (!record) {
    if (await isPortOpen(PORTS.sandbox.jsonApi)) {
      console.log(
        `no pid file, but port ${PORTS.sandbox.jsonApi} is in use by a process up.mjs did not start; leaving it running`,
      );
      return false;
    }
    console.log("sandbox is not running");
    return false;
  }
  if (isProcessAlive(record.pid)) {
    killTree(record.pid);
    for (let i = 0; i < 40 && isProcessAlive(record.pid); i++) await sleep(250);
    if (isProcessAlive(record.pid)) throw new Error(`could not stop pid ${record.pid}`);
    console.log(`stopped sandbox (pid ${record.pid})`);
  } else {
    console.log(`sandbox pid ${record.pid} was not running; cleaning up`);
  }
  removeFile(FILES.pid);
  removeFile(FILES.ports);
  return true;
}

if (isMain(import.meta.url)) {
  try {
    await down();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
