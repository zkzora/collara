// Capability status for /docs (capability table + legend), Settings › integrations and Governance.
// One typed config (synthesis §1.1, CR-45). An item flips to IMPLEMENTED only after verification
// against the running system. Values below follow what was actually run on the authoring machine
// (docs/verification.md, 2026-10-02): a Canton 3.5.19 `dpm sandbox` with one participant, synthetic data.
import { z } from "zod";
import type { BadgeTone } from "./states";

export const CAPABILITY_STATUSES = ["UI_MOCKUP", "SPECIFIED", "PLANNED", "IMPLEMENTED", "NOT_AVAILABLE"] as const;
export const CapabilityStatusSchema = z.enum(CAPABILITY_STATUSES);
export type CapabilityStatus = z.infer<typeof CapabilityStatusSchema>;

/** Chip labels and legend descriptions (P-Docs §3.3, verbatim except where marked INFERRED). */
export const CAPABILITY_STATUS_META: Readonly<
  Record<CapabilityStatus, { label: string; description: string; tone: BadgeTone }>
> = {
  UI_MOCKUP: { label: "UI mockup", description: "Clickable design in this project", tone: "neutral" },
  SPECIFIED: { label: "Specified", description: "Defined in the spec, no code", tone: "info" },
  PLANNED: { label: "Planned", description: "Later phase, may change", tone: "warning" },
  // INFERRED copy (pending approval). Replaces the P-Docs "None at this time", which became false once
  // items were verified on the local sandbox.
  IMPLEMENTED: { label: "Implemented", description: "Built and tested locally, synthetic data", tone: "success" },
  // Not in the P-Docs legend and not used by any row today. INFERRED copy (pending approval).
  NOT_AVAILABLE: { label: "Not available", description: "Not available in this build", tone: "neutral" },
};

export interface CapabilityLink {
  readonly label: string;
  readonly href: string;
}

export interface Capability {
  readonly id: string;
  /** Verbatim capability names from the P-Docs capability table. */
  readonly label: string;
  readonly statuses: readonly CapabilityStatus[];
  /** "Where" column: a prefix plus an optional link. */
  readonly where: { readonly text: string; readonly link?: CapabilityLink };
}

// Capability labels are P-Docs verbatim. Every non-empty `where.text` below and the link label
// "BitSafe governance" are INFERRED copy (pending approval); they state the scope that was verified.
export const CAPABILITIES: readonly Capability[] = [
  {
    id: "landing",
    label: "Landing page",
    statuses: ["IMPLEMENTED"],
    where: { text: "", link: { label: "Landing", href: "/" } },
  },
  {
    id: "workspace",
    label:
      "Lender workspace: overview, case queue, case workspace, asset passport, collateral review, pledge and release, audit center",
    // Two modes: LOCALNET (real ledger commands) and UI_MOCK (browser-local simulation).
    statuses: ["IMPLEMENTED", "UI_MOCKUP"],
    where: { text: "LocalNet and UI mockup modes · ", link: { label: "Workspace", href: "/app" } },
  },
  {
    id: "daml-model",
    label: "Daml contract model: passport, evidence package, verification, assessment, proposal, pledge control",
    statuses: ["IMPLEMENTED"],
    where: { text: "60 Daml Script tests · ", link: { label: "Workflow", href: "#workflow" } },
  },
  {
    id: "roles",
    label: "Roles, mandates, and scoped disclosure",
    // Mandates are enforced by the API (off-ledger); ledger-level isolation across participants is untested.
    statuses: ["IMPLEMENTED"],
    where: { text: "Tested on one participant only · ", link: { label: "Roles & permissions", href: "#roles" } },
  },
  {
    id: "localnet-demo",
    label: "LocalNet demo with access-denial and authorization tests",
    statuses: ["IMPLEMENTED"],
    where: {
      text: "Canton 3.5.19 sandbox, one participant, not Splice LocalNet · ",
      link: { label: "Synthetic demo scenario", href: "#demo" },
    },
  },
  {
    id: "governance",
    label: "BitSafe governance for the verifier registry",
    // Tier A implemented (one local participant); Tier B (DM nodes, decentralized party) not attempted.
    statuses: ["IMPLEMENTED", "PLANNED"],
    where: { text: "Tier A on one participant; Tier B planned · ", link: { label: "BitSafe governance", href: "#governance" } },
  },
  {
    // statuses[0] also feeds GovernanceState.integration.capability (presenters.ts).
    id: "dm-integration",
    label: "Decentralization Manager integration",
    statuses: ["PLANNED"],
    where: { text: "DM governance contracts used in Tier A; DM nodes not connected" },
  },
  {
    id: "setup",
    label: "Setup instructions, API reference, test commands",
    statuses: ["IMPLEMENTED"],
    where: { text: "In the source repository · ", link: { label: "Setup, API & tests", href: "#setup" } },
  },
];

export function capabilityById(id: string): Capability | undefined {
  return CAPABILITIES.find((capability) => capability.id === id);
}

export function hasImplementedCapability(): boolean {
  return CAPABILITIES.some((capability) => capability.statuses.includes("IMPLEMENTED"));
}
