// PostgreSQL session store for @fastify/session (express-session compatible callback API).
// Rows are keyed by SHA-256(session id), so a leaked row cannot be replayed as a cookie.
import { sessions, type Db } from "@collara/db";
import type { Session } from "fastify";
import { eq, lt } from "drizzle-orm";
import { sha256Hex } from "./commands";

type Callback = (error?: unknown) => void;
type SessionCallback = (error: unknown, session?: Session | null) => void;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export class PgSessionStore {
  constructor(
    private readonly db: Db,
    private readonly ttlSeconds: number,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  set(sessionId: string, session: Session, callback: Callback): void {
    // JSON round trip: the cookie object serializes through its toJSON(); symbols are dropped.
    const data = JSON.parse(JSON.stringify(session)) as Record<string, unknown>;
    const cookieExpires = session.cookie?.expires;
    const expiresAt =
      cookieExpires instanceof Date && !Number.isNaN(cookieExpires.getTime())
        ? cookieExpires
        : new Date(this.clock().getTime() + this.ttlSeconds * 1000);
    const row = {
      id: sha256Hex(sessionId),
      userId: asString(data.userId),
      activeOrgId: asString(data.activeOrgId),
      personaId: asString(data.personaId),
      isDemo: data.authMethod === "demo",
      data,
      expiresAt,
      updatedAt: this.clock(),
    };
    this.db
      .insert(sessions)
      .values(row)
      .onConflictDoUpdate({
        target: sessions.id,
        set: {
          userId: row.userId,
          activeOrgId: row.activeOrgId,
          personaId: row.personaId,
          isDemo: row.isDemo,
          data: row.data,
          expiresAt: row.expiresAt,
          updatedAt: row.updatedAt,
        },
      })
      .then(() => callback(), callback);
  }

  get(sessionId: string, callback: SessionCallback): void {
    const id = sha256Hex(sessionId);
    this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1)
      .then(async ([row]) => {
        if (!row) return callback(null, null);
        if (row.expiresAt.getTime() <= this.clock().getTime()) {
          await this.db.delete(sessions).where(eq(sessions.id, id));
          return callback(null, null);
        }
        callback(null, row.data as Session);
      })
      .catch((error: unknown) => callback(error));
  }

  destroy(sessionId: string, callback: Callback): void {
    this.db
      .delete(sessions)
      .where(eq(sessions.id, sha256Hex(sessionId)))
      .then(() => callback(), callback);
  }

  /** Deletes expired rows; returns how many were removed. */
  async prune(): Promise<number> {
    const removed = await this.db.delete(sessions).where(lt(sessions.expiresAt, this.clock())).returning({ id: sessions.id });
    return removed.length;
  }
}
