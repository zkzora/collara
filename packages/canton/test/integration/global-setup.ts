import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = fileURLToPath(new URL("../../", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

function runNode(script: string): void {
  const result = spawnSync(process.execPath, [script], { cwd: REPO_ROOT, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${script} exited with code ${result.status}`);
}

async function isReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/readyz`, { signal: AbortSignal.timeout(3_000) });
    await response.text();
    return response.status === 200;
  } catch {
    return false;
  }
}

/** Builds the test DAR and makes sure a ledger is running; stops it afterwards if it started it. */
export default async function setup(): Promise<(() => void) | undefined> {
  if (process.env.CANTON_IT !== "1") return undefined;
  runNode(`${PACKAGE_DIR}scripts/build-it-dar.mjs`);

  const url = process.env.CANTON_JSON_API_URL ?? "http://127.0.0.1:7575";
  if (await isReady(url)) {
    console.info(`[canton-it] reusing the ledger at ${url}`);
    return undefined;
  }
  if (process.env.CANTON_JSON_API_URL) throw new Error(`${url}/readyz is not 200`);
  console.info("[canton-it] starting the sandbox with scripts/localnet/up.mjs");
  runNode(`${REPO_ROOT}scripts/localnet/up.mjs`);
  return () => {
    if (process.env.CANTON_IT_KEEP === "1") return;
    runNode(`${REPO_ROOT}scripts/localnet/down.mjs`);
  };
}
