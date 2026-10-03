// TanStack Query keys, always prefixed with the session scope so cached data never crosses
// users, organizations or demo personas (WEB §7.2). Clear the QueryClient on logout/persona switch.
import type { AccessGrantQuery, AuditEventQuery, CaseListQuery, ConsentRequestQuery, PageQuery, PersonaId, PledgeListQuery } from "@collara/domain";

/** "{userId}:{orgId}" for real sessions, "mock:{personaId}" in UI_MOCK. */
export function sessionScope(session: { readonly userId: string; readonly orgId: string } | { readonly personaId: PersonaId }): string {
  return "personaId" in session ? `mock:${session.personaId}` : `${session.userId}:${session.orgId}`;
}

type Params = PageQuery | CaseListQuery | AuditEventQuery | PledgeListQuery | AccessGrantQuery | ConsentRequestQuery | undefined;

/** Drops undefined values so equivalent queries share a key. */
function clean(params: Params): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params ?? {}).filter(([, value]) => value !== undefined));
}

export function createQueryKeys(scope: string) {
  const root = [scope] as const;
  return {
    all: root,
    me: () => [scope, "me"] as const,
    demoPersonas: () => [scope, "demo", "personas"] as const,
    cases: {
      all: () => [scope, "cases"] as const,
      list: (query?: CaseListQuery) => [scope, "cases", "list", clean(query)] as const,
      detail: (caseId: string) => [scope, "cases", "detail", caseId] as const,
      evidence: (caseId: string) => [scope, "cases", "detail", caseId, "evidence"] as const,
    },
    assets: {
      all: () => [scope, "assets"] as const,
      list: (query?: PageQuery) => [scope, "assets", "list", clean(query)] as const,
      detail: (assetRef: string) => [scope, "assets", "detail", assetRef] as const,
      evidence: (assetRef: string) => [scope, "assets", "detail", assetRef, "evidence"] as const,
    },
    evidence: {
      detail: (evidenceId: string) => [scope, "evidence", evidenceId] as const,
    },
    verifications: {
      all: () => [scope, "verifications"] as const,
      list: (query?: PageQuery) => [scope, "verifications", "list", clean(query)] as const,
      detail: (ref: string) => [scope, "verifications", "detail", ref] as const,
    },
    attestations: {
      detail: (ref: string) => [scope, "attestations", ref] as const,
    },
    reviews: {
      all: () => [scope, "reviews"] as const,
      list: (query?: PageQuery) => [scope, "reviews", "list", clean(query)] as const,
      detail: (ref: string) => [scope, "reviews", "detail", ref] as const,
    },
    proposals: {
      detail: (ref: string) => [scope, "proposals", ref] as const,
    },
    pledges: {
      all: () => [scope, "pledges"] as const,
      list: (query?: PledgeListQuery) => [scope, "pledges", "list", clean(query)] as const,
      detail: (ref: string) => [scope, "pledges", "detail", ref] as const,
    },
    releaseRequests: {
      detail: (ref: string) => [scope, "release-requests", ref] as const,
    },
    accessGrants: {
      list: (query?: AccessGrantQuery) => [scope, "access-grants", clean(query)] as const,
    },
    consentRequests: {
      list: (query?: ConsentRequestQuery) => [scope, "consent-requests", clean(query)] as const,
    },
    audit: {
      events: (query?: AuditEventQuery) => [scope, "audit", "events", clean(query)] as const,
    },
    reports: {
      list: (query?: PageQuery) => [scope, "reports", clean(query)] as const,
    },
    verifiers: () => [scope, "verifiers"] as const,
    directory: (kind: "lenders" | "dealers") => [scope, "directory", kind] as const,
    overview: () => [scope, "overview"] as const,
    governance: {
      all: () => [scope, "governance"] as const,
      state: () => [scope, "governance", "state"] as const,
      proposals: () => [scope, "governance", "proposals"] as const,
      proposal: (ref: string) => [scope, "governance", "proposals", ref] as const,
    },
    command: (commandId: string) => [scope, "commands", commandId] as const,
    health: () => [scope, "system", "health"] as const,
  };
}

export type QueryKeys = ReturnType<typeof createQueryKeys>;
