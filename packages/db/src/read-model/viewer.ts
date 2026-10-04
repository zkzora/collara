// The read model's viewer: derived server-side from session → membership → mandate → party binding (the API's
// ResolvedActor). Never built from anything the browser sends.

export interface ReadViewer {
  /** The organization the session acts for. */
  readonly orgId: string;
  /**
   * Parties whose projected contracts the viewer may read: the organization's business party, the governance
   * seat party of a seat mandate, and the governance party for seat holders (ResolvedActor.parties.readAs).
   * Empty → the viewer sees no ledger data at all.
   */
  readonly readableParties: readonly string[];
  readonly roles?: readonly string[];
  readonly mandates?: readonly { readonly code: string; readonly seat?: number }[];
}

export interface ReadOptions {
  /** Read time for computed states (expiry); default now. */
  readonly now?: Date;
  /** Restrict to these participant sources (default: all). */
  readonly sources?: readonly string[];
  /** party_bindings environment (default: currentLedgerEnvironment(), i.e. "LOCALNET" unless COLLARA_MODE=DEVNET). */
  readonly environment?: string;
}

/** Builds a viewer from the API's resolved actor shape ({ orgId, roles, mandates, parties: { readAs } }). */
export function readViewerOf(actor: {
  readonly orgId: string;
  readonly roles?: readonly string[];
  readonly mandates?: readonly { readonly code: string; readonly seat?: number }[];
  readonly parties: { readonly readAs: readonly string[] };
}): ReadViewer {
  return {
    orgId: actor.orgId,
    readableParties: [...actor.parties.readAs],
    ...(actor.roles ? { roles: actor.roles } : {}),
    ...(actor.mandates ? { mandates: actor.mandates } : {}),
  };
}
