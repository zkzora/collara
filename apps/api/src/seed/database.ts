// Database preparation for the LocalNet seed and the integration harness: create the database if it does
// not exist, apply the committed migrations, seed the demo identities and import the party bindings of a
// bootstrap state file. Idempotent.
import { createPgDatabase, importLocalnetState, seedDemoIdentities, type BindingImportSummary, type DbHandle } from "@collara/db";
import pg from "pg";
import type { LedgerState } from "../ledger/state";
import { ensureSystemUsers } from "../workflow/actors";

const DB_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/** Creates the database named in `url` when it does not exist (needs CREATEDB). Returns true when created. */
export async function ensureDatabase(url: string): Promise<boolean> {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.replace(/^\//, ""));
  if (!DB_NAME.test(name)) throw new Error(`refusing to create database ${JSON.stringify(name)}: use lower-case letters, digits and _`);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString(), connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    const exists = await client.query("select 1 from pg_database where datname = $1", [name]);
    if (exists.rowCount) return false;
    await client.query(`create database "${name}"`);
    return true;
  } finally {
    await client.end();
  }
}

/** Drops a database created for a test run (refuses the shared ones). */
export async function dropDatabase(url: string): Promise<void> {
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (!DB_NAME.test(name) || ["collara", "collara_test", "postgres"].includes(name)) throw new Error(`refusing to drop ${name}`);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString(), connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    await client.query(`drop database if exists "${name}" with (force)`);
  } finally {
    await client.end();
  }
}

export interface PreparedDatabase {
  readonly handle: DbHandle;
  readonly created: boolean;
  readonly bindings: BindingImportSummary;
}

/** ensureDatabase → migrate → demo identities → system users → party bindings from the state file. */
export async function prepareDatabase(url: string, state: LedgerState, options: { applicationName?: string; environment?: string } = {}): Promise<PreparedDatabase> {
  const created = await ensureDatabase(url);
  const handle = createPgDatabase({ url, max: 5, applicationName: options.applicationName ?? "collara-seed" });
  try {
    await handle.migrate();
    await seedDemoIdentities(handle.db);
    await ensureSystemUsers(handle.db);
    const bindings = await importLocalnetState(handle.db, state, options.environment ? { environment: options.environment } : {});
    return { handle, created, bindings };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
