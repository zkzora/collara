// Capability status for /docs (capability table + legend), Settings › integrations and Governance.
// One typed config (synthesis §1.1, CR-45). An item flips to IMPLEMENTED only after verification
// against the running system; values below are honest as of 2026-10-02 (build in progress).
import { z } from "zod";
import type { BadgeTone } from "./states";

export const CAPABILITY_STATUSES = ["UI_MOCKUP", "SPECIFIED", "PLANNED", "IMPLEMENTED", "NOT_AVAILABLE"] as const;
export const CapabilityStatusSchema = z.enum(CAPABILITY_STATUSES);
export type CapabilityStatus = z.infer<typeof CapabilityStatusSchema>;

/** Chip labels and legend descriptions (P-Docs §3.3, verbatim). */
export const CAPABILITY_STATUS_META: Readonly<
  Record<CapabilityStatus, { label: string; description: string; tone: BadgeTone }>
> = {
  UI_MOCKUP: { label: "UI mockup", description: "Clickable design in this project", tone: "neutral" },
  SPECIFIED: { label: "Specified", description: "Defined in the spec, no code", tone: "info" },
  PLANNED: { label: "Planned", description: "Later phase, may change", tone: "warning" },
  // Legend text stays true only while nothing is IMPLEMENTED; replace it with approved copy first.
  IMPLEMENTED: { label: "Implemented", description: "None at this time", tone: "success" },
  // Not in the P-Docs legend; reuses the P-Docs "Where" text for the setup row (needs copy approval).
  NOT_AVAILABLE: { label: "Not available", description: "Added only after a verified implementation", tone: "neutral" },
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

export const CAPABILITIES: readonly Capability[] = [
  {
    id: "landing",
    label: "Landing page",
    statuses: ["UI_MOCKUP"],
    where: { text: "", link: { label: "Landing", href: "/" } },
  },
  {
    id: "workspace",
    label:
      "Lender workspace: overview, case queue, case workspace, asset passport, collateral review, pledge and release, audit center",
    statuses: ["UI_MOCKUP"],
    where: { text: "", link: { label: "Workspace", href: "/app" } },
  },
  {
    id: "daml-model",
    label: "Daml contract model: passport, evidence package, verification, assessment, proposal, pledge control",
    statuses: ["SPECIFIED"],
    where: { text: "Specification · ", link: { label: "Workflow", href: "#workflow" } },
  },
  {
    id: "roles",
    label: "Roles, mandates, and scoped disclosure",
    statuses: ["SPECIFIED"],
    where: { text: "Specification · ", link: { label: "Roles & permissions", href: "#roles" } },
  },
  {
    id: "localnet-demo",
    label: "LocalNet demo with access-denial and authorization tests",
    statuses: ["PLANNED"],
    where: { text: "Scenario defined · ", link: { label: "Synthetic demo scenario", href: "#demo" } },
  },
  {
    id: "governance",
    label: "BitSafe governance for the verifier registry",
    statuses: ["PLANNED", "UI_MOCKUP"],
    where: { text: "Simulation in the workspace · ", link: { label: "Planned BitSafe governance", href: "#governance" } },
  },
  {
    id: "dm-integration",
    label: "Decentralization Manager integration",
    statuses: ["PLANNED"],
    where: { text: "Not connected" },
  },
  {
    id: "setup",
    label: "Setup instructions, API reference, test commands",
    statuses: ["NOT_AVAILABLE"],
    where: { text: "Added only after a verified implementation · ", link: { label: "Setup, API & tests", href: "#setup" } },
  },
];

export function capabilityById(id: string): Capability | undefined {
  return CAPABILITIES.find((capability) => capability.id === id);
}

export function hasImplementedCapability(): boolean {
  return CAPABILITIES.some((capability) => capability.statuses.includes("IMPLEMENTED"));
}
