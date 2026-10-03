#!/usr/bin/env node
// Stops every Tier B process inside WSL (DM nodes, then Canton) and the Tier B WSL keepalive. State is in-memory,
// so the topology (decentralized party, contracts) is discarded; receipts under .local/tierb/receipts stay.
//   node scripts/tierb/down.mjs
import { join } from "node:path";
import { stopService } from "../infra/lib.mjs";
import { TIERB_DIR, fail, writeState, wslScript } from "./lib.mjs";

const result = wslScript("infra/tierb/ctl.sh", { args: ["down"], timeoutMs: 120_000 });
await stopService(join(TIERB_DIR, "keepalive.pid.json"), "sleep infinity", "Tier B WSL keepalive");
writeState({ stoppedAt: new Date().toISOString(), governance: undefined });
if (result.status !== 0) fail(`tierb down failed (exit ${result.status})`);
