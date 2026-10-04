import { fileURLToPath } from "node:url";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema";

/**
 * Path relative to this module, resolved at run time. A literal `new URL("…", import.meta.url)` makes bundlers (the
 * embedded API inside Next) try to ship the target file, so the relative path is passed in as a value.
 */
function besideModule(relative: string): string {
  return fileURLToPath(new URL(relative, import.meta.url));
}

export type Schema = typeof schema;
/** Driver-independent Drizzle database (node-postgres in the API/worker, PGlite in tests). */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
/** A transaction handle has the same query surface as the database. */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface DbHandle {
  readonly kind: "pg" | "pglite";
  readonly db: Db;
  /** Applies the committed SQL migrations (idempotent). Tests may pass a copy of the folder cut at a migration. */
  migrate(options?: { migrationsFolder?: string }): Promise<void>;
  /** Cheap liveness probe (`select 1`). */
  ping(): Promise<void>;
  close(): Promise<void>;
}

/** packages/db/migrations (committed output of `drizzle-kit generate`). */
export const MIGRATIONS_FOLDER = besideModule("../migrations");

export interface PgOptions {
  /** postgres://user:pass@host:5432/db */
  readonly url: string;
  readonly max?: number;
  readonly applicationName?: string;
}

/** PostgreSQL through a node-postgres Pool (API and worker). */
export function createPgDatabase({ url, max = 10, applicationName = "collara" }: PgOptions): DbHandle {
  const pool = new pg.Pool({
    connectionString: url,
    max,
    application_name: applicationName,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  // An idle client error (e.g. the server restarted) must not crash the process; the next query reconnects.
  pool.on("error", () => {});
  const db = drizzlePg({ client: pool, schema });
  return {
    kind: "pg",
    db,
    migrate: (options) => migratePg(db, { migrationsFolder: options?.migrationsFolder ?? MIGRATIONS_FOLDER }),
    ping: async () => {
      await pool.query("select 1");
    },
    close: () => pool.end(),
  };
}

/**
 * In-process PGlite (PostgreSQL 18 compiled to WASM) for hermetic tests. Same schema, applied through the
 * same committed migrations. Single connection: not for the API and worker together.
 */
export async function createPgliteDatabase(options: { migrate?: boolean } = {}): Promise<DbHandle> {
  // Dev-only dependency: loaded lazily so production code never imports it.
  const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
  ]);
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const handle: DbHandle = {
    kind: "pglite",
    db,
    migrate: (migrateOptions) => migrate(db, { migrationsFolder: migrateOptions?.migrationsFolder ?? MIGRATIONS_FOLDER }),
    ping: async () => {
      await client.query("select 1");
    },
    close: () => client.close(),
  };
  if (options.migrate ?? true) await handle.migrate();
  return handle;
}
