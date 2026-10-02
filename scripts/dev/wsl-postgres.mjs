#!/usr/bin/env node
// Development PostgreSQL 16 inside WSL2 Ubuntu, reached from Windows on 127.0.0.1:5432 through
// WSL localhost forwarding (synthesis R-07). Windows only.
//
//   node scripts/dev/wsl-postgres.mjs up       keep WSL running, ensure role + databases, verify, print DATABASE_URL
//   node scripts/dev/wsl-postgres.mjs status   exit 0 when 127.0.0.1:5432 accepts connections
//   node scripts/dev/wsl-postgres.mjs stop     stop the keepalive (WSL then shuts the distro down when idle)
//
// WSL stops an idle distro, so `up` starts a detached `wsl -d <distro> --exec sleep infinity`
// keepalive (pid in .local/wsl/keepalive.pid.json). It only ever creates the `collara` role and the
// `collara` / `collara_test` databases when they are missing; it never drops, alters or touches
// anything else in the cluster. Set COLLARA_WSL_DISTRO to use a distro other than "Ubuntu".
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  IS_WINDOWS,
  LOCAL_DIR,
  env,
  fail,
  parseCommand,
  requireFromWorkspace,
  runningService,
  spawnDetached,
  stopService,
  tcpOpen,
  waitFor,
  writeJson,
} from "../infra/lib.mjs";

const DISTRO = env("COLLARA_WSL_DISTRO", "Ubuntu");
const KEEPALIVE_MARKER = "sleep infinity";
const PID_FILE = join(LOCAL_DIR, "wsl", "keepalive.pid.json");
const HOST = "127.0.0.1";
const PORT = 5432;
// Dev-only credentials for a loopback database holding synthetic data (also in CLAUDE.md).
const ROLE = "collara";
const PASSWORD = "collara_dev";
const DATABASES = ["collara", "collara_test"];
const urlFor = (database) => `postgres://${ROLE}:${PASSWORD}@${HOST}:${PORT}/${database}`;
// WSL_UTF8 makes wsl.exe print UTF-8 instead of UTF-16 (affects `wsl -l`).
const WSL_ENV = { ...process.env, WSL_UTF8: "1" };

if (!IS_WINDOWS) fail("this script manages PostgreSQL inside WSL and only runs on Windows. Elsewhere use infra/compose/compose.yaml or a local PostgreSQL 16.");

function wsl(args, { user, input } = {}) {
  return spawnSync("wsl.exe", ["-d", DISTRO, ...(user ? ["-u", user] : []), "--cd", "/tmp", "--exec", ...args], {
    encoding: "utf8",
    env: WSL_ENV,
    input,
    windowsHide: true,
    timeout: 120_000,
  });
}

/** Runs a bash script as root inside the distro; exits on failure. */
function rootScript(script, what) {
  const result = wsl(["bash", "-s"], { user: "root", input: script });
  if (result.status !== 0) {
    fail(`${what} failed (exit ${result.status ?? result.error?.message}):\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function distroState() {
  const result = spawnSync("wsl.exe", ["-l", "-v"], { encoding: "utf8", env: WSL_ENV, windowsHide: true });
  const line = result.stdout
    ?.split(/\r?\n/)
    .map((l) => l.replace(/^\*/, "").trim().split(/\s+/))
    .find(([name]) => name === DISTRO);
  return line ? line[1] : null;
}

function ensureKeepalive() {
  const running = runningService(PID_FILE, KEEPALIVE_MARKER);
  if (running) {
    console.log(`WSL keepalive already running (pid ${running.pid})`);
    return;
  }
  const child = spawnDetached("wsl.exe", ["-d", DISTRO, "--exec", "sleep", "infinity"], {
    logFile: join(LOCAL_DIR, "wsl", "keepalive.log"),
    env: WSL_ENV,
  });
  writeJson(PID_FILE, { pid: child.pid, distro: DISTRO, startedAt: new Date().toISOString() });
  console.log(`WSL keepalive started (pid ${child.pid}, distro ${DISTRO})`);
}

const ENSURE_CLUSTER = `
set -eu
line=$(pg_lsclusters --no-header | awk '$3 == ${PORT}')
if [ -z "$line" ]; then echo "no PostgreSQL cluster listens on port ${PORT}" >&2; exit 3; fi
set -- $line
if [ "$4" != "online" ]; then pg_ctlcluster "$1" "$2" start; fi
echo "PostgreSQL cluster $1/$2 online on port ${PORT}"
`;

// Create-if-missing only. Role and database names are fixed constants above.
const ENSURE_ROLE_AND_DATABASES = `
set -eu
q() { sudo -u postgres psql -X -v ON_ERROR_STOP=1 -At -c "$1"; }
if [ -z "$(q "select 1 from pg_roles where rolname = '${ROLE}'")" ]; then
  q "create role ${ROLE} login createdb password '${PASSWORD}'" >/dev/null
  echo "created role ${ROLE}"
else
  echo "role ${ROLE} exists (left unchanged)"
fi
for db in ${DATABASES.join(" ")}; do
  if [ -z "$(q "select 1 from pg_database where datname = '$db'")" ]; then
    sudo -u postgres createdb -O ${ROLE} "$db"
    echo "created database $db"
  else
    echo "database $db exists (left unchanged)"
  fi
done
`;

/** Logs in from Windows with the dev credentials when `pg` is installed in packages/db. */
async function queryCheck() {
  const pg = requireFromWorkspace("packages/db", "pg");
  if (!pg) {
    console.log("pg is not installed in packages/db (run `pnpm install`); skipped the login check");
    return true;
  }
  let ok = true;
  for (const database of DATABASES) {
    const client = new pg.Client({ connectionString: urlFor(database), connectionTimeoutMillis: 10_000 });
    try {
      await client.connect();
      const { rows } = await client.query(
        "select current_user as usr, current_database() as db, current_setting('server_version') as version",
      );
      console.log(`login ok from Windows: ${rows[0].usr}@${rows[0].db} (PostgreSQL ${rows[0].version})`);
    } catch (error) {
      ok = false;
      console.error(`login as ${ROLE} to ${database} failed: ${error.message}`);
    } finally {
      await client.end().catch(() => {});
    }
  }
  return ok;
}

async function up() {
  if (!distroState()) fail(`WSL distro "${DISTRO}" not found (wsl -l -v). Set COLLARA_WSL_DISTRO.`);
  ensureKeepalive();
  console.log(rootScript(ENSURE_CLUSTER, "starting the PostgreSQL cluster"));
  console.log(rootScript(ENSURE_ROLE_AND_DATABASES, "ensuring the role and databases"));
  const reachable = await waitFor(() => tcpOpen(HOST, PORT), { timeoutMs: 60_000 });
  if (!reachable) {
    fail(
      `${HOST}:${PORT} is not reachable from Windows. Check that WSL localhost forwarding is on ` +
        "(default; `localhostForwarding` in %UserProfile%\\.wslconfig) and that PostgreSQL listens on more than the WSL loopback.",
    );
  }
  console.log(`${HOST}:${PORT} accepts TCP connections from Windows`);
  if (!(await queryCheck())) process.exit(1);
  console.log("");
  console.log(`DATABASE_URL=${urlFor("collara")}`);
  console.log(`TEST_DATABASE_URL=${urlFor("collara_test")}`);
}

async function status() {
  const keepalive = runningService(PID_FILE, KEEPALIVE_MARKER);
  console.log(`keepalive  ${keepalive ? `running (pid ${keepalive.pid}, since ${keepalive.startedAt})` : "not running"}`);
  console.log(`distro     ${DISTRO}: ${distroState() ?? "not found"}`);
  const open = await tcpOpen(HOST, PORT);
  console.log(`${HOST}:${PORT}  ${open ? "accepting connections" : "not reachable"}`);
  if (!open || !(await queryCheck())) process.exitCode = 1;
}

async function stop() {
  await stopService(PID_FILE, KEEPALIVE_MARKER, "WSL keepalive");
  console.log(`WSL shuts "${DISTRO}" down once nothing else runs in it (not forced; other WSL sessions are left alone).`);
}

const { command } = parseCommand(process.argv.slice(2), ["up", "status", "stop"], "up");
await { up, status, stop }[command]();
