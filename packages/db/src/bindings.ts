// Imports organization ↔ party bindings, ledger users and ledger sources from the LocalNet bootstrap
// state (.local/localnet/state.json, written by scripts/localnet/bootstrap.mjs). Party ids change on every
// sandbox start, so this runs after each bootstrap; superseded bindings are revoked, never reused.
import { DEMO_ORGANIZATIONS } from "@collara/domain";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { Db } from "./client";
import { ledgerSources, ledgerUsers, mandates, partyBindings } from "./schema";

/**
 * The subset of the bootstrap state this import needs. Callers validate the file with
 * LocalnetStateSchema from @collara/canton (Zod) before passing it here; LocalnetState is assignable.
 */
export interface LocalnetBindingSource {
  readonly topology: string;
  readonly participants: Readonly<Record<string, { readonly jsonApiUrl: string; readonly participantId: string }>>;
  readonly parties: Readonly<Record<string, { readonly party: string; readonly participant: string; readonly user: string }>>;
  readonly users: readonly {
    readonly id: string;
    readonly participant: string;
    readonly role: "org" | "projector" | "admin" | "tenant";
    readonly party?: string;
    readonly primaryParty?: string;
    readonly actAs: readonly string[];
    readonly readAs: readonly string[];
  }[];
}

/** party_bindings / ledger_users environment of each ledger mode. */
export type LedgerEnvironment = "LOCALNET" | "DEVNET";

/**
 * The ledger environment of this process, from COLLARA_MODE (DEVNET → "DEVNET", anything else → "LOCALNET").
 * DEVNET runs on its own database, so its bindings never mix with LocalNet's; the column keeps them apart anyway.
 */
export function currentLedgerEnvironment(env: NodeJS.ProcessEnv = process.env): LedgerEnvironment {
  return env.COLLARA_MODE?.trim() === "DEVNET" ? "DEVNET" : "LOCALNET";
}

/** Party hints that are not an organization's business party. */
export const GOVERNANCE_PARTY_HINT = "CollaraGovernance";
const SEAT_HINT = /^GovSeat([123])$/;

export interface BindingImportSummary {
  bindings: number;
  revoked: number;
  ledgerUsers: number;
  sources: { source: string; participantId: string; reset: boolean }[];
  /** Party hints in the state file that map to no organization (reported, not imported). */
  unmatchedHints: string[];
}

export async function importLocalnetState(
  db: Db,
  state: LocalnetBindingSource,
  options: { environment?: string; now?: Date } = {},
): Promise<BindingImportSummary> {
  const environment = options.environment ?? currentLedgerEnvironment();
  const now = options.now ?? new Date();
  const orgByHint = new Map(Object.values(DEMO_ORGANIZATIONS).map((org) => [org.partyHint, org.id]));

  return db.transaction(async (tx) => {
    // Seat → organization comes from the mandates table (the DB is the authority for who holds a seat).
    const seatRows = await tx
      .select({ orgId: mandates.orgId, seat: mandates.seat })
      .from(mandates)
      .where(and(eq(mandates.code, "GOVERNANCE_SEAT"), eq(mandates.state, "ACTIVE")));
    const orgBySeat = new Map(seatRows.map((row) => [row.seat, row.orgId]));

    const unmatchedHints: string[] = [];
    const bindingRows: (typeof partyBindings.$inferInsert)[] = [];
    for (const [hint, entry] of Object.entries(state.parties)) {
      const participant = state.participants[entry.participant];
      if (!participant) throw new Error(`party ${hint} refers to unknown participant ${entry.participant}`);
      const base = { partyId: entry.party, partyHint: hint, source: entry.participant, participantId: participant.participantId, environment };
      const seat = SEAT_HINT.exec(hint)?.[1];
      const seatOrg = seat ? orgBySeat.get(Number(seat)) : undefined;
      if (seat && seatOrg) {
        bindingRows.push({ ...base, orgId: seatOrg, kind: "governance-member", governanceSeat: Number(seat) });
      } else if (hint === GOVERNANCE_PARTY_HINT) {
        bindingRows.push({ ...base, orgId: "collara", kind: "governance", governanceSeat: null });
      } else if (orgByHint.has(hint)) {
        bindingRows.push({ ...base, orgId: orgByHint.get(hint) ?? hint, kind: "business", governanceSeat: null });
      } else {
        unmatchedHints.push(hint);
      }
    }

    const partyIds = bindingRows.map((row) => row.partyId);
    const revoked = await tx
      .update(partyBindings)
      .set({ state: "REVOKED", revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(partyBindings.environment, environment),
          eq(partyBindings.state, "ACTIVE"),
          partyIds.length ? notInArray(partyBindings.partyId, partyIds) : undefined,
        ),
      )
      .returning({ id: partyBindings.id });
    if (bindingRows.length) {
      await tx
        .insert(partyBindings)
        .values(bindingRows.map((row) => ({ ...row, state: "ACTIVE", updatedAt: now })))
        .onConflictDoUpdate({
          target: [partyBindings.environment, partyBindings.partyId],
          set: {
            orgId: sql`excluded.org_id`,
            kind: sql`excluded.kind`,
            governanceSeat: sql`excluded.governance_seat`,
            partyHint: sql`excluded.party_hint`,
            source: sql`excluded.source`,
            participantId: sql`excluded.participant_id`,
            state: "ACTIVE",
            revokedAt: null,
            updatedAt: now,
          },
        });
    }

    // Ledger users are derived data: replace them wholesale for this environment.
    await tx.delete(ledgerUsers).where(eq(ledgerUsers.environment, environment));
    const orgByParty = new Map(bindingRows.filter((b) => b.kind !== "governance").map((b) => [b.partyId, b.orgId]));
    const userRows = state.users.map((user) => {
      const partyId = user.party ? state.parties[user.party]?.party : user.primaryParty;
      return {
        orgId: user.role === "org" && partyId ? (orgByParty.get(partyId) ?? null) : null,
        ledgerUserId: user.id,
        source: user.participant,
        role: user.role,
        primaryParty: user.primaryParty ?? partyId ?? null,
        actAs: [...user.actAs],
        readAs: [...user.readAs],
        environment,
        updatedAt: now,
      };
    });
    if (userRows.length) await tx.insert(ledgerUsers).values(userRows);

    // Ledger sources: a changed participant id means the sandbox was reset. The worker must not mix
    // histories, so the source is flagged instead of silently re-pointed.
    const existing = await tx
      .select()
      .from(ledgerSources)
      .where(inArray(ledgerSources.source, Object.keys(state.participants)));
    const sources: BindingImportSummary["sources"] = [];
    for (const [source, participant] of Object.entries(state.participants)) {
      const prior = existing.find((row) => row.source === source);
      const reset = !!prior && prior.participantId !== participant.participantId;
      sources.push({ source, participantId: participant.participantId, reset });
      if (!prior) {
        await tx.insert(ledgerSources).values({ source, participantId: participant.participantId, jsonApiUrl: participant.jsonApiUrl });
      } else if (reset) {
        await tx
          .update(ledgerSources)
          .set({
            participantId: participant.participantId,
            jsonApiUrl: participant.jsonApiUrl,
            status: "RESET_DETECTED",
            resetDetectedAt: now,
            resetReason: `participant changed from ${prior.participantId} to ${participant.participantId}`,
            updatedAt: now,
          })
          .where(eq(ledgerSources.source, source));
      } else if (prior.jsonApiUrl !== participant.jsonApiUrl) {
        await tx.update(ledgerSources).set({ jsonApiUrl: participant.jsonApiUrl, updatedAt: now }).where(eq(ledgerSources.source, source));
      }
    }

    return { bindings: bindingRows.length, revoked: revoked.length, ledgerUsers: userRows.length, sources, unmatchedHints };
  });
}
