// Roles (S §3, 9 roles), mandates, demo organizations and personas (synthesis §1.3).
// A web account is not a Canton party; authority is derived server-side from
// membership → mandate → party binding. These are synthetic demo identities only.
import { z } from "zod";

export const ROLES = [
  "BORROWER",
  "DEALER",
  "VERIFIER",
  "LENDER_ANALYST",
  "LENDER_APPROVER",
  "AUDITOR",
  "ORG_ADMIN",
  "OPERATOR",
  "GOVERNANCE_MEMBER",
] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

/** Exact role labels (S §3). */
export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  BORROWER: "Borrower / Asset Owner",
  DEALER: "Dealer Contributor",
  VERIFIER: "Verifier",
  LENDER_ANALYST: "Lender Analyst",
  LENDER_APPROVER: "Lender Approver",
  AUDITOR: "Auditor",
  ORG_ADMIN: "Organization Admin",
  OPERATOR: "Collara Operator",
  GOVERNANCE_MEMBER: "Governance Member",
};

/** Short labels used in "Demo Lender A · Analyst" style actor lines. */
export const ROLE_SHORT_LABELS: Readonly<Record<Role, string>> = {
  BORROWER: "Borrower",
  DEALER: "Contributor",
  VERIFIER: "Verifier",
  LENDER_ANALYST: "Analyst",
  LENDER_APPROVER: "Approver",
  AUDITOR: "Auditor",
  ORG_ADMIN: "Org admin",
  OPERATOR: "Operator",
  GOVERNANCE_MEMBER: "Governance member",
};

export const ORG_TYPES = ["OPERATOR", "BORROWER", "DEALER", "VERIFIER", "LENDER", "AUDITOR"] as const;
export const OrgTypeSchema = z.enum(ORG_TYPES);
export type OrgType = z.infer<typeof OrgTypeSchema>;

export const OrgIdSchema = z.string().min(1).max(64);
export type OrgId = z.infer<typeof OrgIdSchema>;

export interface Organization {
  readonly id: OrgId;
  readonly name: string;
  readonly type: OrgType;
  /** Party id hint used by the LOCALNET seed; real party ids change on every sandbox restart. */
  readonly partyHint: string;
}

export const DEMO_ORG_IDS = {
  collara: "collara",
  manufacturer: "demo-manufacturer",
  dealer: "demo-cnc-dealer",
  verifier: "demo-verifier",
  lenderA: "demo-lender-a",
  lenderB: "demo-lender-b",
  auditor: "demo-auditor",
  // Borrowers of the prototype's extra queue rows (P-Dash §4.1).
  tooling: "demo-tooling",
  machining: "demo-machining",
  fabrication: "demo-fabrication",
} as const;

const ORG_LIST: readonly Organization[] = [
  { id: DEMO_ORG_IDS.collara, name: "Collara Registry (demo)", type: "OPERATOR", partyHint: "CollaraRegistrar" },
  { id: DEMO_ORG_IDS.manufacturer, name: "Demo Manufacturer", type: "BORROWER", partyHint: "DemoManufacturer" },
  { id: DEMO_ORG_IDS.dealer, name: "Demo CNC Dealer", type: "DEALER", partyHint: "DemoCNCDealer" },
  { id: DEMO_ORG_IDS.verifier, name: "Demo Verifier", type: "VERIFIER", partyHint: "DemoVerifier" },
  { id: DEMO_ORG_IDS.lenderA, name: "Demo Lender A", type: "LENDER", partyHint: "DemoLenderA" },
  { id: DEMO_ORG_IDS.lenderB, name: "Demo Lender B", type: "LENDER", partyHint: "DemoLenderB" },
  { id: DEMO_ORG_IDS.auditor, name: "Demo Auditor", type: "AUDITOR", partyHint: "DemoAuditor" },
  { id: DEMO_ORG_IDS.tooling, name: "Demo Tooling Inc", type: "BORROWER", partyHint: "DemoToolingInc" },
  { id: DEMO_ORG_IDS.machining, name: "Demo Machining Co", type: "BORROWER", partyHint: "DemoMachiningCo" },
  { id: DEMO_ORG_IDS.fabrication, name: "Demo Fabrication LLC", type: "BORROWER", partyHint: "DemoFabricationLLC" },
];

export const DEMO_ORGANIZATIONS: Readonly<Record<string, Organization>> = Object.fromEntries(
  ORG_LIST.map((org) => [org.id, org]),
);

export function orgName(orgId: OrgId): string {
  return DEMO_ORGANIZATIONS[orgId]?.name ?? orgId;
}

// --- Mandates ---------------------------------------------------------------------------------

export const MANDATE_CODES = ["BORROWER", "ANALYST", "APPROVER", "AUDIT_LEAD", "ORG_ADMIN", "GOVERNANCE_SEAT"] as const;
export const MandateCodeSchema = z.enum(MANDATE_CODES);
export type MandateCode = z.infer<typeof MandateCodeSchema>;

export const GOVERNANCE_SEATS = [1, 2, 3] as const;
export const GovernanceSeatSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type GovernanceSeat = z.infer<typeof GovernanceSeatSchema>;

export const MandateSchema = z.object({
  code: MandateCodeSchema,
  label: z.string(),
  seat: GovernanceSeatSchema.optional(),
});
export type Mandate = z.infer<typeof MandateSchema>;

export const MANDATE_LABELS: Readonly<Record<MandateCode, string>> = {
  BORROWER: "Borrower mandate",
  ANALYST: "Analyst mandate",
  APPROVER: "Approver mandate",
  AUDIT_LEAD: "Audit lead mandate",
  ORG_ADMIN: "Organization admin mandate",
  GOVERNANCE_SEAT: "Governance seat",
};

export function mandate(code: MandateCode, seat?: GovernanceSeat): Mandate {
  return seat === undefined
    ? { code, label: MANDATE_LABELS[code] }
    : { code, label: `${MANDATE_LABELS[code]} ${seat}`, seat };
}

// --- Actor (the authenticated viewer, derived server-side) -------------------------------------

export const ActorSchema = z.object({
  userId: z.string().min(1),
  orgId: OrgIdSchema,
  roles: z.array(RoleSchema).min(1),
  mandates: z.array(MandateSchema),
});
export type Actor = z.infer<typeof ActorSchema>;

export function hasRole(actor: Actor, role: Role): boolean {
  return actor.roles.includes(role);
}

export function hasMandate(actor: Actor, code: MandateCode): boolean {
  return actor.mandates.some((m) => m.code === code);
}

export function governanceSeatOf(actor: Actor): GovernanceSeat | null {
  return actor.mandates.find((m) => m.code === "GOVERNANCE_SEAT")?.seat ?? null;
}

// --- Demo personas (synthesis §1.3.3; only Dana Reyes and Morgan Hale are named in sources) ---

export const PERSONA_IDS = [
  "manufacturer-owner",
  "manufacturer-admin",
  "dealer-contributor",
  "verifier-inspector",
  "lender-a-analyst",
  "lender-a-approver",
  "lender-b-approver",
  "auditor",
  "operator",
] as const;
export const PersonaIdSchema = z.enum(PERSONA_IDS);
export type PersonaId = z.infer<typeof PersonaIdSchema>;

export interface Persona {
  readonly id: PersonaId;
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly title: string | null;
  readonly orgId: OrgId;
  readonly roles: readonly Role[];
  readonly mandates: readonly Mandate[];
}

/** MP #2: the lender view is the default demo persona; the prototype defaulted to the approver. */
export const DEFAULT_PERSONA_ID: PersonaId = "lender-a-approver";

const PERSONA_LIST: readonly Persona[] = [
  {
    id: "manufacturer-owner",
    userId: "user-manufacturer-owner",
    email: "manufacturer.owner@demo.test",
    displayName: "Plant manager",
    title: null,
    orgId: DEMO_ORG_IDS.manufacturer,
    roles: ["BORROWER"],
    mandates: [mandate("BORROWER")],
  },
  {
    id: "manufacturer-admin",
    userId: "user-manufacturer-admin",
    email: "manufacturer.admin@demo.test",
    displayName: "Organization admin",
    title: null,
    orgId: DEMO_ORG_IDS.manufacturer,
    roles: ["ORG_ADMIN"],
    mandates: [mandate("ORG_ADMIN")],
  },
  {
    id: "dealer-contributor",
    userId: "user-dealer-contributor",
    email: "dealer.contributor@demo.test",
    displayName: "Sales desk",
    title: null,
    orgId: DEMO_ORG_IDS.dealer,
    roles: ["DEALER"],
    mandates: [],
  },
  {
    id: "verifier-inspector",
    userId: "user-verifier-inspector",
    email: "verifier.inspector@demo.test",
    displayName: "Inspector",
    title: null,
    orgId: DEMO_ORG_IDS.verifier,
    roles: ["VERIFIER"],
    mandates: [],
  },
  {
    id: "lender-a-analyst",
    userId: "user-lender-a-analyst",
    email: "lender-a.analyst@demo.test",
    displayName: "Dana Reyes",
    title: null,
    orgId: DEMO_ORG_IDS.lenderA,
    roles: ["LENDER_ANALYST"],
    mandates: [mandate("ANALYST")],
  },
  {
    id: "lender-a-approver",
    userId: "user-lender-a-approver",
    email: "lender-a.approver@demo.test",
    displayName: "Morgan Hale",
    title: "Head of Credit",
    orgId: DEMO_ORG_IDS.lenderA,
    roles: ["LENDER_APPROVER", "GOVERNANCE_MEMBER"],
    mandates: [mandate("APPROVER"), mandate("GOVERNANCE_SEAT", 1)],
  },
  {
    id: "lender-b-approver",
    userId: "user-lender-b-approver",
    email: "lender-b.approver@demo.test",
    displayName: "Lender B approver",
    title: null,
    orgId: DEMO_ORG_IDS.lenderB,
    roles: ["LENDER_APPROVER", "GOVERNANCE_MEMBER"],
    mandates: [mandate("APPROVER"), mandate("GOVERNANCE_SEAT", 2)],
  },
  {
    id: "auditor",
    userId: "user-auditor",
    email: "auditor@demo.test",
    displayName: "Audit lead",
    title: null,
    orgId: DEMO_ORG_IDS.auditor,
    roles: ["AUDITOR", "GOVERNANCE_MEMBER"],
    mandates: [mandate("AUDIT_LEAD"), mandate("GOVERNANCE_SEAT", 3)],
  },
  {
    id: "operator",
    userId: "user-operator",
    email: "operator@collara.test",
    displayName: "Collara operator",
    title: null,
    orgId: DEMO_ORG_IDS.collara,
    roles: ["OPERATOR"],
    mandates: [],
  },
];

export const DEMO_PERSONAS: Readonly<Record<PersonaId, Persona>> = Object.fromEntries(
  PERSONA_LIST.map((persona) => [persona.id, persona]),
) as Record<PersonaId, Persona>;

export function personaActor(id: PersonaId): Actor {
  const persona = DEMO_PERSONAS[id];
  return { userId: persona.userId, orgId: persona.orgId, roles: [...persona.roles], mandates: [...persona.mandates] };
}

export function personaByUserId(userId: string): Persona | undefined {
  return PERSONA_LIST.find((persona) => persona.userId === userId);
}

/** "Demo Lender A · Approver" */
export function actorLine(orgId: OrgId, role: Role | null): string {
  return role ? `${orgName(orgId)} · ${ROLE_SHORT_LABELS[role]}` : orgName(orgId);
}

/** The role that best describes an actor in a given lender/borrower context (approver wins). */
export function primaryRole(actor: Actor): Role {
  const order: readonly Role[] = [
    "LENDER_APPROVER",
    "LENDER_ANALYST",
    "BORROWER",
    "DEALER",
    "VERIFIER",
    "AUDITOR",
    "ORG_ADMIN",
    "OPERATOR",
    "GOVERNANCE_MEMBER",
  ];
  return order.find((role) => actor.roles.includes(role)) ?? actor.roles[0] ?? "BORROWER";
}
