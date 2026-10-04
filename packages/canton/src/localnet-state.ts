import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * Schema of .local/localnet/state.json, written by scripts/localnet/bootstrap.mjs.
 * Party ids change on every sandbox start; consumers must compare `participantId` with the
 * running participant (LedgerClient.participantId()) and treat a mismatch as a ledger reset.
 */
export const LocalnetStateSchema = z.object({
  version: z.literal(1),
  bootstrappedAt: z.string(),
  /** devnet-shared-participant: .local/devnet/state.json, written by scripts/devnet/import-bindings.mjs. */
  topology: z.enum(["sandbox-1-participant", "sandbox-3-participants", "sandbox-5-participants", "devnet-shared-participant"]),
  cantonVersion: z.string().optional(),
  /** Token audience the participants expect (the HMAC secret is never stored here). */
  audience: z.string(),
  /** JSON API of the first participant ("sandbox"). */
  jsonApiUrl: z.url(),
  participantId: z.string(),
  participants: z.record(
    z.string(),
    z.object({ jsonApiUrl: z.url(), participantId: z.string(), ledgerEndAtBootstrap: z.number() }),
  ),
  /** Keyed by party hint, e.g. "DemoManufacturer". */
  parties: z.record(z.string(), z.object({ party: z.string(), participant: z.string(), user: z.string() })),
  users: z.array(
    z.object({
      id: z.string(),
      participant: z.string(),
      /** tenant: DEVNET's single ledger user, acting for every project party (a privileged operator credential). */
      role: z.enum(["org", "projector", "admin", "tenant"]),
      party: z.string().optional(),
      primaryParty: z.string().optional(),
      actAs: z.array(z.string()),
      readAs: z.array(z.string()),
      participantAdmin: z.boolean().optional(),
    }),
  ),
  packages: z.array(
    z.object({ file: z.string(), name: z.string(), version: z.string(), mainPackageId: z.string(), sha256: z.string() }),
  ),
});
export type LocalnetState = z.infer<typeof LocalnetStateSchema>;

/** <repo>/.local/localnet/state.json (override with COLLARA_LOCALNET_STATE). */
export function defaultLocalnetStatePath(): string {
  return process.env.COLLARA_LOCALNET_STATE ?? fileURLToPath(new URL("../../../.local/localnet/state.json", import.meta.url));
}

/** Reads and validates the bootstrap state; returns null when the file does not exist. */
export async function loadLocalnetState(path = defaultLocalnetStatePath()): Promise<LocalnetState | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return LocalnetStateSchema.parse(JSON.parse(text));
}

export interface LocalnetPartyRef {
  party: string;
  userId: string;
  jsonApiUrl: string;
  /** Participant id at bootstrap; if the running participant reports another id, the ledger was reset. */
  participantId: string;
}

/** Party id, ledger user and hosting participant for a party hint, e.g. "DemoManufacturer". */
export function localnetParty(state: LocalnetState, hint: string): LocalnetPartyRef {
  const entry = state.parties[hint];
  const participant = entry ? state.participants[entry.participant] : undefined;
  if (!entry || !participant) throw new Error(`party ${hint} is not in the LocalNet state`);
  return { party: entry.party, userId: entry.user, jsonApiUrl: participant.jsonApiUrl, participantId: participant.participantId };
}

/** <repo>/.local/devnet/state.json (override with COLLARA_DEVNET_STATE). DEVNET never reads the LocalNet state. */
export function defaultDevnetStatePath(): string {
  return process.env.COLLARA_DEVNET_STATE ?? fileURLToPath(new URL("../../../.local/devnet/state.json", import.meta.url));
}

/** True for a path that names a LocalNet state file (.local/localnet/state*.json); DEVNET refuses those. */
export function isLocalnetStatePath(path: string): boolean {
  return /(^|[\\/])\.local[\\/]localnet[\\/]state[^\\/]*\.json$/i.test(path.trim());
}
