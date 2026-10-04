import {
  BOUNDARY_COPY,
  CAPABILITIES,
  CAPABILITY_STATUS_META,
  EVIDENCE,
  buildScenario,
  capabilityById,
  clock,
  formatMoney,
  money,
  passCount,
  type CapabilityStatus,
} from "@collara/domain";
import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  DocsCard,
  DocsH2,
  DocsLead,
  DocsList,
  DocsSection,
  InlineLink,
  KeyValues,
  StatusChip,
  TableRegion,
  tbody,
  th,
} from "./docs-ui";
import { PermissionMatrix } from "./permission-matrix";

// /docs content. Prototype copy (proto-landing-docs.md §3) verbatim, except where the synthesis
// resolves a conflict: capability status and chips come from the domain config (CR-45), the matrix
// from the domain policy (CR-21), principal USD 100,000.00 (CR-12), seed-relative dates (§1.6),
// governance semantics without reject votes (CR-28), and #setup lists no unverified commands.
// Status statements follow what was actually run: counts, dates and scopes come from EVIDENCE
// (@collara/domain, packages/domain/src/evidence.ts), never from literals here. Copy written for the
// post-pre-build state is marked INFERRED (pending approval) where it appears.

export const DOCS_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "workflow", label: "Workflow" },
  { id: "roles", label: "Roles & permissions" },
  { id: "demo", label: "Synthetic demo scenario" },
  // INFERRED label (was "Planned BitSafe governance"; Tier A is implemented).
  { id: "governance", label: "BitSafe governance" },
  { id: "setup", label: "Setup, API & tests" },
] as const;

const LEGEND_STATUSES: readonly CapabilityStatus[] = ["UI_MOCKUP", "SPECIFIED", "PLANNED", "IMPLEMENTED"];

function statusesOf(capabilityId: string): readonly CapabilityStatus[] {
  return capabilityById(capabilityId)?.statuses ?? [];
}

function Chips({ statuses, labels = {} }: { statuses: readonly CapabilityStatus[]; labels?: Partial<Record<CapabilityStatus, string>> }) {
  return (
    <>
      {statuses.map((status) => (
        <StatusChip key={status} status={status} label={labels[status]} />
      ))}
    </>
  );
}

/** Full-width status strip: the approved pre-build text, or the local-demo scope once items are implemented. */
export function DocsStatusBanner({ prebuild }: { prebuild: boolean }) {
  return (
    <div className="border-b border-highlight/25 bg-highlight/8">
      <div className="mx-auto flex max-w-[1120px] flex-wrap items-baseline gap-x-3.5 gap-y-1 px-5 py-[9px] text-[12.5px] site:px-8">
        <span className="font-mono text-[11px] font-medium tracking-[0.06em] text-[oklch(90%_0.08_80)] uppercase">
          {/* INFERRED label (pending approval) for the non-pre-build state. */}
          {prebuild ? "Pre-build" : "Local demo"}
        </span>
        <span className="text-[oklch(84%_0.06_80)]">
          {prebuild
            ? "This documentation describes a specification and interactive UI mockups. No running implementation, deployed contracts, API, or test suite exists yet."
            : // INFERRED copy (pending approval).
              `Synthetic data only. The LocalNet demo runs on one machine, against a Canton 3.5.19 sandbox with one participant. Only the web app is deployed, as a UI mockup on ${EVIDENCE.deployment.web.host}; the API, ledger and database are not, and nothing is deployed to a Canton Network. Nothing here is production-ready.`}
        </span>
      </div>
    </div>
  );
}

export function DocsSidebar() {
  return (
    <nav
      aria-label="Documentation sections"
      className="flex flex-row flex-wrap gap-x-3.5 gap-y-1 border-b border-white/7 pb-5 text-[14px] site:sticky site:top-[88px] site:flex-col site:flex-nowrap site:gap-0.5 site:border-b-0 site:pb-0"
    >
      <p className="mb-2 basis-full font-mono site:basis-auto text-[11px] tracking-[0.08em] text-fg-subtle uppercase">Docs · v0.1 draft</p>
      <ul className="contents">
        {DOCS_SECTIONS.map((section) => (
          <li key={section.id}>
            <a href={`#${section.id}`} className="inline-block rounded-sm py-1.5 text-fg-muted hover:text-fg">
              {section.label}
            </a>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex basis-full flex-col gap-2 site:basis-auto border-t border-white/7 pt-[18px] text-[12.5px] text-fg-muted site:mt-[22px]">
        <p className="font-mono text-[11px] tracking-[0.08em] text-fg-subtle uppercase">Status labels</p>
        <dl className="flex flex-col gap-2">
          {LEGEND_STATUSES.map((status) => (
            <div key={status} className="flex items-center gap-2">
              <dt>
                <StatusChip status={status} />
              </dt>
              <dd>{CAPABILITY_STATUS_META[status].description}</dd>
            </div>
          ))}
        </dl>
      </div>
    </nav>
  );
}

// INFERRED copy (pending approval): the local-demo status card. Every count, date and scope comes from EVIDENCE.
const E = EVIDENCE;

const RUN = [
  `${E.damlTests.passed} Daml Script tests of the contract model: invariants, attack attempts and contract visibility`,
  `LocalNet integration tests through the API on the sandbox with one participant: ${passCount(E.localnetIntegration)} in ${E.localnetIntegration.files} files, including an adversarial sweep over ${E.localnetIntegration.adversarialRoutes} routes, before the contract change that closed the revocation race; after it, the activation tests pass ${passCount(E.localnetIntegration.afterContracts020.activationSuites)} and the full suite has not yet been re-run with document storage`,
  `A LocalNet browser walkthrough of CL-001 from a clean start: ${passCount(E.cleanStartBrowser)} tests`,
  `Witness-level privacy on ${E.privacy.participants} participants: ${passCount(E.privacy.tests)} tests and ${passCount(E.privacy.checks)} checks, in ${E.privacy.runs} runs. All participants ran on one machine under one operator, so this does not show isolation between independent operators.`,
  `Tier A governance (Decentralization Manager governance contracts, ${E.governance.tierA.localnet.threshold.required} of ${E.governance.tierA.localnet.threshold.of} seats, no decentralized party) on the sandbox with one participant: ${passCount(E.governance.tierA.localnet.integrationTests)} integration tests. The workspace uses it.`,
  `Tier B governance with ${E.governance.tierB.localnet.nodes} Decentralization Manager nodes and a decentralized governance party, run by scripts on a separate local topology under one operator: ${passCount(E.governance.tierB.localnet.scriptedChecks)} checks. The workspace does not use it.`,
  `${E.unitTests.total} unit tests (commit ${E.unitTests.commit})`,
  `CI on GitHub Actions passed (run ${E.ci.runId}, commit ${E.ci.commit}): typecheck, lint, unit tests and build; Playwright in UI mockup mode (${E.ci.playwrightUiMock.passed} passed); the Daml build and tests`,
] as const;

const RUN_DATES = [
  E.damlTests.date,
  E.localnetIntegration.date,
  E.cleanStartBrowser.date,
  E.privacy.date,
  E.governance.tierA.localnet.date,
  E.governance.tierB.localnet.date,
  E.unitTests.date,
  E.ci.date,
].sort();
const RUN_PERIOD = RUN_DATES[0] === RUN_DATES.at(-1) ? RUN_DATES[0] : `${RUN_DATES[0]} to ${RUN_DATES.at(-1)}`;

const DEPLOYMENT = [
  `Deployed: the web app in UI mockup mode, on ${E.deployment.web.host} (${E.deployment.web.date}). It holds synthetic data in the browser only.`,
  "Not deployed: the API, the worker, PostgreSQL, document storage and the Canton ledger. Nothing is deployed to a Canton Network.",
  `Canton DevNet: ${E.devnet.status}. Governance there would be Tier A only (${E.governance.tierA.devnet.status}); Tier B on DevNet: ${E.governance.tierB.devnet.status}.`,
] as const;

const NOT_VERIFIED = [
  "Independent operators: the privacy and Tier B runs each had one operator for every node",
  "Tier B governance in the workspace: the API and UI still use Tier A",
  "Docker Compose and the container images",
  "Keycloak sign-in through a browser, and Secure cookies over HTTPS",
  "Ledger authentication with JWKS tokens for a real participant",
  "Persistence across sandbox restarts: the sandbox keeps ledger state in memory",
] as const;

function RepoPath({ children }: { children: string }) {
  return <code className="font-mono text-[12.5px] text-fg-soft">{children}</code>;
}

function ProjectStatusCard() {
  return (
    <DocsCard filled titleAs="h2" title="Project status: local demo build">
      <p className="text-[14px] leading-[1.6] text-fg-muted">
        Everything uses synthetic data. The public site and the workspace are one web app, and the workspace has two
        modes. In UI mockup mode, state is projected locally in the browser and no ledger transaction is submitted;
        it is the only mode deployed publicly. In LocalNet mode, actions are Daml commands submitted through the API
        to a Canton 3.5.19 sandbox with one participant, with a projection worker, PostgreSQL and private evidence
        storage; it runs only on the authoring machine. That sandbox is not Splice LocalNet, and nothing is deployed
        to a Canton Network. Nothing on this page is a claim of production readiness or a security assurance.
      </p>
      <h3 className="mt-2 text-[13.5px] font-medium">What was run ({RUN_PERIOD})</h3>
      <DocsList small items={RUN} />
      <h3 className="mt-2 text-[13.5px] font-medium">Deployment</h3>
      <DocsList small items={DEPLOYMENT} />
      <h3 className="mt-2 text-[13.5px] font-medium">Not verified</h3>
      <DocsList small items={NOT_VERIFIED} />
      <p className="mt-2 text-[13.5px] leading-[1.6] text-fg-muted">
        Details, including runs that could not complete, are in <RepoPath>docs/verification.md</RepoPath>,{" "}
        <RepoPath>docs/privacy-verification.md</RepoPath>, <RepoPath>docs/governance-tier-b.md</RepoPath> and{" "}
        <RepoPath>docs/limitations.md</RepoPath> in the Collara source repository.
      </p>
    </DocsCard>
  );
}

export function OverviewSection({ prebuild }: { prebuild: boolean }) {
  return (
    <DocsSection
      id="overview"
      kicker="01 · Overview"
      chips={prebuild ? <StatusChip status="SPECIFIED" /> : <Chips statuses={statusesOf("workspace")} />}
    >
      <h1
        id="overview-title"
        className="text-[clamp(28px,3.4vw,38px)] leading-[1.15] font-medium tracking-[-0.025em] text-pretty"
      >
        Collara documentation
      </h1>
      <DocsLead strong>
        Collara is a private coordination workspace for used CNC equipment financing. It links an equipment passport
        with its evidence, verification scope, lender decision, and collateral workflow, and discloses each record only
        to the counterparties named on it.{" "}
        {prebuild
          ? "It is being designed as Daml workflows on Canton."
          : // INFERRED sentence (pending approval), replacing "It is being designed as Daml workflows on Canton."
            "It is built as Daml workflows on Canton and runs today as a local demo with synthetic data."}
      </DocsLead>
      {prebuild ? (
        <DocsCard filled titleAs="h2" title="Project status: pre-build">
          <p className="text-[14px] leading-[1.6] text-fg-muted">
            What exists today is a product specification and three interactive UI mockups: the landing page, the lender
            workspace, and a governance simulation inside that workspace. The mockups project state locally in the
            browser. There are no deployed contracts, no ledger, no API, and no test suite. Nothing on this page
            describes working software.
          </p>
        </DocsCard>
      ) : (
        <ProjectStatusCard />
      )}
      <div className="grid gap-3.5 site:grid-cols-2">
        <DocsCard titleAs="h2" title="What Collara coordinates">
          <DocsList
            items={[
              "Equipment passport and document versions",
              "Verification requests and scoped attestations",
              "Evidence packages shared with a named lender",
              "Lender assessment and collateral decision",
              "Pledge activation, release request, and release decision",
              "Permission-scoped case history and exports",
            ]}
          />
        </DocsCard>
        <DocsCard titleAs="h2" title="What Collara is not">
          <DocsList
            items={[
              "Not a lender; credit decisions and funding stay with the lender",
              "Not a custodian and not a legal lien registry",
              "An attestation is not proof of legal ownership",
              "A Collara record does not verify pledges made outside Collara",
              "Cash settlement and MainNet wallet payments are outside the initial scope",
            ]}
          />
        </DocsCard>
      </div>
      <div className="flex flex-col gap-2.5">
        <h2 className="text-[14px] font-medium">Capability status</h2>
        <TableRegion label="Capability status" minWidth="min-w-[560px]">
          <caption className="sr-only">Capability status</caption>
          <thead>
            <tr>
              <th scope="col" className={th}>
                Capability
              </th>
              <th scope="col" className={th}>
                Status
              </th>
              <th scope="col" className={th}>
                Where
              </th>
            </tr>
          </thead>
          <tbody className={tbody}>
            {CAPABILITIES.map((capability) => (
              <tr key={capability.id}>
                <td className="px-3.5 py-[11px] text-[14px]">{capability.label}</td>
                <td className="px-3.5 py-[11px]">
                  <span className="flex flex-nowrap gap-1.5">
                    <Chips statuses={capability.statuses} />
                  </span>
                </td>
                <td className="px-3.5 py-[11px] text-[13px] text-fg-muted">
                  {capability.where.text}
                  {capability.where.link ? (
                    <InlineLink href={capability.where.link.href}>{capability.where.link.label}</InlineLink>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </TableRegion>
      </div>
    </DocsSection>
  );
}

const WORKFLOW_ROWS: readonly { step: string; who: string; records: string; states: readonly string[] }[] = [
  {
    step: "Register the equipment",
    who: "Equipment owner",
    records: "Passport, equipment identifier, ownership evidence, document versions",
    states: ["DRAFT → REGISTERED"],
  },
  {
    step: "Request verification",
    who: "Owner assigns an accepted verifier; verifier reviews and may request changes",
    records:
      "Verification request with defined scope; attestation listing checked items, evidence versions, limitations, and validity",
    states: ["REQUESTED → IN_REVIEW", "→ CHANGES_REQUESTED", "→ ATTESTED"],
  },
  {
    step: "Share with the lender",
    who: "Owner, with the dealer's consent for contributed records",
    records: "Evidence package addressed to one named lender; unrelated records stay outside the package",
    states: ["NOT_SUBMITTED → SUBMITTED"],
  },
  {
    step: "Record review and pledge",
    who: "Lender analyst records the assessment; lender approver records the collateral decision and issues the proposal; owner accepts; pledge activates with both authorizations",
    records:
      "Collateral assessment (per lender, per case), financing proposal (versioned), pledge on the asset's canonical control",
    states: ["IN_REVIEW → ELIGIBLE | REJECTED", "DRAFT → ISSUED → ACCEPTED | WITHDRAWN", "AVAILABLE → ACTIVE"],
  },
  {
    step: "Request and authorize release",
    who: "Owner requests with a reason; the approver mandate of the lender named on the lock decides",
    records: "Release request and decision on the active pledge",
    states: ["ACTIVE → RELEASE_REQUESTED", "→ RELEASED | RELEASE_REJECTED"],
  },
  {
    step: "Export the case history",
    who: "Any participant, within their access scope",
    records: "Case workflow report with cut-off, ledger coverage watermark, retention caveat, and checksum",
    states: ["Export job · no state change"],
  },
];

export function WorkflowDocsSection() {
  return (
    <DocsSection id="workflow" kicker="02 · Workflow" chips={<Chips statuses={statusesOf("daml-model")} />}>
      <DocsH2 id="workflow-title">From equipment evidence to authorized release</DocsH2>
      <DocsLead>
        Six steps, each ending in a committed workflow state. Operational events such as uploads, drafts, and views are
        application actions and do not change workflow state. Failed or unknown commands never appear as successful
        lifecycle events.
      </DocsLead>
      <TableRegion label="Workflow steps" minWidth="min-w-[640px]">
        <caption className="sr-only">Workflow steps, actors, records and committed states</caption>
        <thead>
          <tr>
            {["Step", "Who acts", "Records", "Committed states"].map((label) => (
              <th key={label} scope="col" className={th}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={tbody}>
          {WORKFLOW_ROWS.map((row, index) => (
            <tr key={row.step} className="align-top">
              <th scope="row" className="px-3.5 py-3 text-[14px] font-normal">
                <span className="mr-2 font-mono text-[12px] text-fg-subtle">{String(index + 1).padStart(2, "0")}</span>
                {row.step}
              </th>
              <td className="px-3.5 py-3 text-[13.5px] text-fg-muted">{row.who}</td>
              <td className="px-3.5 py-3 text-[13.5px] text-fg-muted">{row.records}</td>
              <td className="px-3.5 py-3 font-mono text-[12px] leading-[1.6]">
                {row.states.map((line, i) => (
                  <Fragment key={line}>
                    {i > 0 ? <br /> : null}
                    {line}
                  </Fragment>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </TableRegion>
      <div className="grid gap-3.5 site:grid-cols-2">
        <DocsCard title="Pledge activation prerequisites (all required)">
          <DocsList
            ordered
            items={[
              "Lender-authorized collateral decision: Eligible for this case",
              "Proposal issued and accepted at the exact version",
              "Attestation valid at activation",
              "Evidence snapshot matches the attested versions",
              "Asset control available: no active lock on the canonical control",
            ]}
          />
        </DocsCard>
        <DocsCard title="Workflow rules">
          <DocsList
            items={[
              "One active lock per registered asset within Collara",
              "Eligibility is recorded per lender and per case; it does not transfer",
              "Only the designated lender's approver mandate can authorize release",
              "A rejected release leaves the lock active; the owner may reapply",
              "Release ends the Collara workflow lock only; legal lien termination is separate",
              "Historical lock records are retained after release",
            ]}
          />
        </DocsCard>
      </div>
      <Callout>
        Boundary. Credit decisions, disbursement, legal filings, and enforcement remain with the lender and its existing
        processes. The workflow blocks a second active lock for the same registered asset within Collara; it does not
        detect pledges made outside the system or guarantee that duplicate registrations of a physical asset cannot
        occur.
      </Callout>
    </DocsSection>
  );
}

function Callout({ tone = "neutral", children }: { tone?: "neutral" | "info"; children: ReactNode }) {
  return (
    <p
      className={cn(
        "rounded-md border px-4 py-3.5 text-[13.5px] leading-[1.6]",
        tone === "info" ? "border-info/28 bg-info/8 text-fg-soft" : "border-line-subtle bg-surface-sunken text-fg-muted",
      )}
    >
      {children}
    </p>
  );
}

const ROLE_CARDS = [
  {
    title: "Equipment owner",
    mandate: "Borrower mandate",
    body: "Registers the passport, submits evidence, requests verification, approves sharing, accepts the proposal, co-authorizes activation, and requests release.",
  },
  {
    title: "Dealer",
    mandate: "Contributor",
    body: "Contributes equipment records to an invited case and consents when those records are shared onward.",
  },
  {
    title: "Verifier",
    mandate: "Registry member",
    body: "Accepts an assignment, requests changes, and issues an attestation with an explicit scope. Cannot approve financing or establish legal lien priority.",
  },
  {
    title: "Lender analyst",
    mandate: "Lender · Analyst mandate",
    body: "Works the review queue, opens shared evidence, drafts and submits the assessment, and requests exports. Cannot record decisions.",
  },
  {
    title: "Lender approver",
    mandate: "Lender · Approver mandate",
    // INFERRED edit (pending approval): "(planned)" removed after the seat; Tier A governance is implemented.
    body: "Records the collateral decision, issues or withdraws proposals, co-authorizes activation, and authorizes or rejects release. Holds the organization's governance seat.",
  },
  {
    title: "Auditor",
    mandate: "Scoped grant",
    body: "Inspects and exports the records covered by a grant that names the case, the permission, the expiry, and the consenting parties.",
  },
] as const;

export function RolesSection() {
  return (
    <DocsSection id="roles" kicker="03 · Roles & permissions" chips={<Chips statuses={statusesOf("roles")} />}>
      <DocsH2 id="roles-title">Different participants, different permissions</DocsH2>
      <DocsLead>
        Participation does not grant access to every document, every loan term, or every case. Responsibilities are
        expressed as mandates in the workflow, not only as interface controls. Access is re-evaluated when a report is
        generated and again when it is downloaded.
      </DocsLead>
      <ul className="grid gap-3.5 site:grid-cols-3">
        {ROLE_CARDS.map((role) => (
          <li key={role.title} className="flex flex-col gap-1.5 rounded-[10px] border border-line px-5 py-[18px]">
            <h3 className="text-[14px] font-medium">{role.title}</h3>
            <p className="font-mono text-[11px] text-fg-subtle">{role.mandate}</p>
            <p className="mt-1 text-[13.5px] leading-[1.6] text-fg-muted">{role.body}</p>
          </li>
        ))}
      </ul>
      <PermissionMatrix />
    </DocsSection>
  );
}

/** Prototype scenario anchors (UTC); shifted relative to now exactly like the domain fixtures. */
const TIMELINE = [
  ["2026-09-01T08:40:00Z", "ASSET-DEMO-001", "Passport registered", "Demo Manufacturer · Owner", "DRAFT → REGISTERED"],
  ["2026-09-03T10:00:00Z", "VR-001", "Verification requested", "Demo Manufacturer · Owner", "— → REQUESTED"],
  ["2026-09-04T08:15:00Z", "VR-001", "Assignment accepted", "Demo Verifier", "REQUESTED → IN_REVIEW"],
  ["2026-09-06T16:30:00Z", "VR-001", "Changes requested: spindle photos and maintenance log", "Demo Verifier", "IN_REVIEW → CHANGES_REQUESTED"],
  // CR-47: the prototype omitted the resubmission that returns the request to review.
  ["2026-09-08T10:15:00Z", "VR-001", "New evidence version submitted for verification", "Demo Manufacturer · Owner", "CHANGES_REQUESTED → IN_REVIEW"],
  ["2026-09-10T17:02:00Z", "ATT-001", "Attestation issued against evidence v2", "Demo Verifier", "IN_REVIEW → ATTESTED"],
  ["2026-09-12T10:10:00Z", "CL-001", "Case created", "Demo Manufacturer · Borrower", "— → DRAFT"],
  ["2026-09-12T10:35:00Z", "PKG-001", "Package shared with Demo Lender A (5 documents, dealer consent)", "Demo Manufacturer + Demo CNC Dealer", "NOT_SUBMITTED → SUBMITTED"],
  ["2026-09-13T12:00:00Z", "CA-001", "Review started", "Demo Lender A · Analyst", "SUBMITTED → IN_REVIEW"],
  ["2026-09-18T12:00:00Z", "CA-001", "Collateral decision recorded: Eligible for this case", "Demo Lender A · Approver", "IN_REVIEW → ELIGIBLE"],
  ["2026-09-19T12:00:00Z", "FP-001", "Proposal issued (v1)", "Demo Lender A · Approver", "DRAFT → ISSUED"],
  ["2026-09-20T12:00:00Z", "FP-001", "Proposal withdrawn and reissued, expiry corrected (v2)", "Demo Lender A · Approver", "ISSUED → WITHDRAWN · ISSUED"],
  ["2026-09-21T12:00:00Z", "FP-001", "Proposal accepted at exact version v2", "Demo Manufacturer · Borrower", "ISSUED → ACCEPTED"],
  ["2026-09-22T12:00:00Z", "PL-001", "Pledge activated", "Demo Manufacturer + Demo Lender A", "AVAILABLE → ACTIVE"],
  ["2026-09-30T12:00:00Z", "RR-001", "Release requested: external loan completion", "Demo Manufacturer · Borrower", "ACTIVE → RELEASE_REQUESTED"],
] as const;

const mono = "font-mono";

export function DemoSection({ now }: { now: Date }) {
  const c = clock(now);
  const day = (prototypeIso: string) => c.at(prototypeIso).slice(0, 10);
  const principal = formatMoney(money("100000.00", "USD"));
  const valuation = formatMoney(money("150000.00", "USD"));
  return (
    <DocsSection
      id="demo"
      kicker="04 · Synthetic demo scenario"
      chips={
        <>
          {/* "LocalNet demo" is an INFERRED chip label (pending approval). */}
          <Chips
            statuses={statusesOf("localnet-demo")}
            labels={{ PLANNED: "LocalNet demo planned", IMPLEMENTED: "LocalNet demo" }}
          />
          {statusesOf("workspace").includes("UI_MOCKUP") ? <StatusChip status="UI_MOCKUP" /> : null}
        </>
      }
    >
      <DocsH2 id="demo-title">One case, CL-001, modelled end to end</DocsH2>
      <DocsLead>
        All organizations, people, documents, and amounts are synthetic. No funds are transferred.{" "}
        {/* INFERRED (pending approval), replacing the pre-build "Today the scenario runs as a local projection…". */}
        The scenario runs in two modes. In UI mockup mode it is a local projection inside the workspace. In LocalNet
        mode it is seeded as committed Daml contracts on a local Canton 3.5.19 sandbox with one participant, and checked
        by access-denial and authorization tests.
      </DocsLead>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(360px,100%),1fr))] gap-3.5">
        <DocsCard title="Organizations" className="gap-0">
          <KeyValues
            rows={[
              ["Demo Manufacturer", "Equipment owner · borrower mandate"],
              ["Demo CNC Dealer", "Dealer · contributor"],
              ["Demo Verifier", "Verifier · VER-001, active"],
              ["Demo Lender A", "Lender · the workspace viewpoint (analyst and approver mandates)"],
              ["Demo Lender B", "Second lender · governance seat only"],
              ["Demo Auditor", "Auditor · scoped grant after release"],
            ]}
          />
        </DocsCard>
        <DocsCard title="Fixtures" className="gap-0">
          <KeyValues
            rows={[
              ["Asset", "ASSET-DEMO-001 · CNC machining center DEMO-CNC-500 · serial SYNTH-CNC-001"],
              ["Case", "CL-001 · used CNC financing · policy CP-2026-CNC-01"],
              [
                "Evidence package",
                "PKG-001 v2 · 5 documents: inspection report v2, dealer invoice, equipment photos (6), maintenance summary, purchase agreement",
              ],
              ["Attestation", `ATT-001 · issued by Demo Verifier · 7 checked items · valid to ${day("2027-03-10T23:59:59Z")}`],
              ["Assessment", "CA-001 · Demo Lender A · per lender, per case"],
              ["Proposal", `FP-001 v2 · ${principal} · valuation illustrative at ${valuation}`],
              ["Pledge", "PL-001 on control v3 → v4 · release request RR-001, reason: external loan completion"],
            ]}
          />
        </DocsCard>
      </div>
      <div className="flex flex-col gap-2.5">
        <h3 className="text-[14px] font-medium">Two demo moments</h3>
        <div className="grid gap-3.5 site:grid-cols-2">
          <DocsCard filled>
            <p className="font-mono text-[11px] tracking-[0.06em] text-fg-subtle uppercase">Moment A · Lender review</p>
            <p className="text-[13.5px] leading-[1.6] text-fg-muted">
              PKG-001 v2 is shared and ATT-001 is valid. CA-001 is in review with a saved analyst draft. The approver
              mandate records Eligible for this case or Rejected for this case. Eligible unlocks proposal issuance;
              nothing is disbursed.
            </p>
          </DocsCard>
          <DocsCard filled>
            <p className="font-mono text-[11px] tracking-[0.06em] text-fg-subtle uppercase">Moment B · Release review</p>
            <p className="text-[13.5px] leading-[1.6] text-fg-muted">
              FP-001 v2 was accepted and PL-001 activated on {day("2026-09-22T12:00:00Z")}. Demo Manufacturer requested
              release on {day("2026-09-30T12:00:00Z")}. The approver mandate authorizes release (control becomes
              AVAILABLE at v5) or rejects it (lock stays ACTIVE). After release, Demo Auditor holds a scoped grant to
              CL-001 until {day("2026-12-31T23:59:59Z")}.
            </p>
          </DocsCard>
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <h3 className="text-[14px] font-medium">Committed events in the scenario</h3>
        <TableRegion label="Committed events in the scenario" minWidth="min-w-[700px]">
          <caption className="sr-only">Committed events in the scenario</caption>
          <thead>
            <tr>
              {["Date (UTC)", "Reference", "Event", "Actor", "State change"].map((label) => (
                <th key={label} scope="col" className={cn(th, "whitespace-nowrap")}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={tbody}>
            {TIMELINE.map(([at, ref, event, actor, change]) => (
              <tr key={`${at}-${ref}`} className="align-top">
                <td className={cn(mono, "px-3.5 py-2.5 text-[11.5px] whitespace-nowrap text-fg-muted")}>{day(at)}</td>
                <td className={cn(mono, "px-3.5 py-2.5 text-[11.5px] whitespace-nowrap")}>{ref}</td>
                <td className="px-3.5 py-2.5 text-[13.5px]">{event}</td>
                <td className="px-3.5 py-2.5 text-[13.5px] text-fg-muted">{actor}</td>
                <td className={cn(mono, "px-3.5 py-2.5 text-[11.5px] text-fg-muted")}>{change}</td>
              </tr>
            ))}
          </tbody>
        </TableRegion>
        <p className="text-[13px] leading-[1.6] text-fg-subtle">
          Events after {day("2026-09-13T12:00:00Z")} belong to Moment B. Dates are relative to when the synthetic data
          is seeded.
        </p>
      </div>
      <div className="grid gap-3.5 site:grid-cols-2">
        {/* "Known limits of UI mockup mode" is an INFERRED title (was "Known limits of the mockup"). */}
        <DocsCard title="Known limits of UI mockup mode" className="py-4">
          <DocsList
            small
            items={[
              "Ledger offsets, commit hashes, checksums, and timestamps are illustrative values, not outputs of a ledger.",
              "Person names in the workspace (analyst, approver) are placeholders.",
              "State changes are local to the browser session and reset on reload.",
            ]}
          />
        </DocsCard>
        {/* INFERRED copy (pending approval); see docs/limitations.md. */}
        <DocsCard title="Known limits of LocalNet mode" className="py-4">
          <DocsList
            small
            items={[
              "One participant hosts every organization's party, so its operator sees every transaction. It is not a privacy boundary.",
              "Ledger state is held in memory and is lost when the sandbox restarts.",
              "Analyst and approver mandates are enforced by the API; the ledger sees only the organization's party.",
              "Revocation of an attestation is checked by the API before pledge activation, not by the ledger at activation.",
            ]}
          />
        </DocsCard>
      </div>
    </DocsSection>
  );
}

/** Tier A confirmation timeout on the sandbox (`actionConfirmationTimeout`, apps/api/src/seed/localnet.ts). */
const LOCALNET_CONFIRMATION_TIMEOUT = "30 minutes";

function TitleWithChip({ title, status }: { title: string; status: CapabilityStatus }) {
  return (
    <span className="flex flex-wrap items-center gap-2.5">
      {title} <StatusChip status={status} />
    </span>
  );
}

export function GovernanceSection({ now }: { now: Date }) {
  const gov = buildScenario({ now, profile: "clean-start" }).governance;
  const deadlineDays = gov.proposalDeadlineDays;
  const mockConfirmationDays = Math.round(gov.confirmationTimeoutHours / 24);
  return (
    <DocsSection
      id="governance"
      // INFERRED kicker and chip labels "Tier A implemented" / "Tier B integration planned" (pending approval).
      kicker="05 · BitSafe governance"
      chips={
        <>
          <Chips
            statuses={statusesOf("governance")}
            labels={{ IMPLEMENTED: "Tier A implemented", PLANNED: "Tier B integration planned" }}
          />
          <StatusChip status="UI_MOCKUP" label="UI simulation" />
        </>
      }
    >
      <DocsH2 id="governance-title">Verifier-registry administration by a governance set</DocsH2>
      <DocsLead>
        The BitSafe governance module is intended to decide which verifiers can be assigned to verification requests, so
        that no single operator adds or suspends a verifier.{" "}
        {/* INFERRED (pending approval) from here, replacing "It is a planned capability. The workspace contains…". */}
        Tier A is implemented: Decentralization Manager governance contracts with three seats and a 2-of-3 threshold, on
        one local participant run by one operator, so it does not yet meet that aim. Tier B, a decentralized governance
        party on Decentralization Manager nodes, has been exercised only by scripts on a separate local three-node
        topology run by one operator ({passCount(EVIDENCE.governance.tierB.localnet.scriptedChecks)} checks passed); the
        workspace does not use it. Neither tier has run on Canton DevNet: there, governance would be Tier A only, and
        Tier B was not attempted because the shared DevNet participant cannot host decentralized parties. In UI mockup
        mode, the workspace simulates governance in the browser.
      </DocsLead>
      <Callout tone="info">{BOUNDARY_COPY.GOVERNANCE_SCOPE}</Callout>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(360px,100%),1fr))] items-start gap-3.5">
        {/* INFERRED title and rows "Rules contract", "Seat parties", "Expiry", "Suspension effect", "Trust limit"
            (pending approval). The suspension row states Collara.Config REQUIRE_ACTIVE_VERIFIER as checked in
            Collara.Verification (issuance, assignment) and Collara.Control (Control_Activate). */}
        <DocsCard title="Design (Tier A)" className="gap-0">
          <KeyValues
            rows={[
              ["Rules contract", "Decentralization Manager v1.12.0 GovernanceRules, on one local Canton participant"],
              ["Governance set", "Three seats: Demo Lender A, Demo Lender B, Demo Auditor"],
              ["Seat holder", "The organization's approver mandate (audit lead mandate for the auditor seat)"],
              ["Seat parties", "One member party and ledger user per seat, never the organization's business party"],
              ["Proposal types", "Add verifier · Suspend verifier"],
              [
                "Threshold",
                `${gov.threshold} of ${gov.seats.length} seat confirmations make a proposal executable; seats confirm only (there is no reject vote) and the proposer may withdraw`,
              ],
              ["Execution", "A separate step after threshold, by any seat. Registry changes apply only on execution."],
              [
                "Expiry",
                `${deadlineDays} days after opening if not executed; each confirmation lapses after ${LOCALNET_CONFIRMATION_TIMEOUT} on the local sandbox (${mockConfirmationDays} days in UI mockup mode)`,
              ],
              [
                "Suspension effect",
                "The verifier can no longer accept assignments or issue attestations; the ledger checks this at commit. Attestations already issued are not revoked or reopened. Under the default policy, REQUIRE_ACTIVE_VERIFIER, they cannot back a new pledge activation: activation checks the verifier status that the registrar publishes, which can lag the governed suspension. Active pledges are not affected.",
              ],
              [
                "Trust limit",
                "One operator runs every seat. The governance party is an ordinary local party: whoever holds its credential could sign registry changes without the seat quorum.",
              ],
            ]}
          />
        </DocsCard>
        <div className="flex flex-col gap-3.5">
          {/* INFERRED title and items (pending approval); evidence: docs/governance.md §2. */}
          <DocsCard title={<TitleWithChip title="In LocalNet mode (Tier A)" status="IMPLEMENTED" />}>
            <DocsList
              small
              items={[
                "Proposals, confirmations and execution as committed contracts, each seat acting as its own party",
                "Proposal deadline and confirmation expiry enforced on the ledger",
                "Registry check when the owner requests verification (API) and when the verifier accepts or attests (ledger)",
                "Re-adding a suspended verifier through an Add verifier proposal",
                "Tested through the API and on the ledger: one confirmation cannot execute, a seat cannot count twice, a stale proposal fails, and users without a seat get 404",
              ]}
            />
          </DocsCard>
          {/* "Simulated in UI mockup mode" is an INFERRED title (was "Simulated in the workspace today"). */}
          <DocsCard title={<TitleWithChip title="Simulated in UI mockup mode" status="UI_MOCKUP" />}>
            <DocsList
              small
              items={[
                "Verifier registry with active and suspended entries",
                "Proposal list covering open, ready-to-execute, executed, withdrawn, and stale states",
                "Proposal detail with per-seat confirmation progress and execution state",
                "Confirm, execute, withdraw, and propose actions, recorded locally",
              ]}
            />
          </DocsCard>
          {/* Items other than "Seat key management and membership changes" are INFERRED (pending approval). */}
          <DocsCard title={<TitleWithChip title="Pending implementation" status="PLANNED" />}>
            <DocsList
              small
              items={[
                "Tier B in the workspace: Decentralization Manager nodes and a decentralized governance party (exercised by scripts on a local three-node topology only)",
                "Independent operators, one participant node per seat holder",
                "Seat key management and membership changes",
                "Governance procedures: who may hold a seat, rotation and disputes (not yet specified)",
              ]}
            />
          </DocsCard>
        </div>
      </div>
    </DocsSection>
  );
}

// INFERRED copy (pending approval): the whole #setup section below except the kicker. The page itself still
// lists no commands (synthesis §1.2: only verified commands, and those live in the repository documents).
const REPO_DOCS: readonly { title: string; path: string; body: string }[] = [
  {
    title: "Setup",
    path: "docs/setup.md",
    body: "Local bring-up of PostgreSQL, SeaweedFS evidence storage, Keycloak, the Canton sandbox, the projection worker, the API and the web app in LocalNet mode. Its Docker Compose section is untested.",
  },
  {
    title: "API reference",
    path: "docs/api.md",
    body: "The OpenAPI document, authentication, CSRF protection, idempotency, responses of ledger-backed actions and the error shape.",
  },
  {
    title: "Tests",
    path: "docs/verification.md",
    body: "What was run and what was observed: unit, Daml Script, LocalNet integration and adversarial tests, Playwright in both modes, and the scripted Tier B governance run. It also lists what was not verified.",
  },
  {
    title: "Demo script",
    path: "docs/demo.md",
    body: "CL-001 step by step for each persona, in LocalNet and UI mockup modes, with negative checks.",
  },
];

const MORE_REPO_DOCS = [
  "README.md",
  "docs/limitations.md",
  "docs/governance.md",
  "docs/governance-tier-b.md",
  "docs/privacy-verification.md",
] as const;

export function SetupSection() {
  return (
    <DocsSection id="setup" kicker="06 · Setup, API reference & tests" chips={<Chips statuses={statusesOf("setup")} />}>
      <DocsH2 id="setup-title">In the source repository, written from local runs</DocsH2>
      <DocsLead>
        Setup instructions, the API reference and the test record are kept in the Collara source repository, not on
        this page. They were written from commands run on one Windows 11 machine against a Canton 3.5.19 sandbox (one
        participant; five for the privacy check), not Splice LocalNet, with synthetic data only. Each one states what was not verified. None of
        them is a production deployment guide or a security assurance.
      </DocsLead>
      <ul className="grid gap-3.5 site:grid-cols-2">
        {REPO_DOCS.map((doc) => (
          <li key={doc.path} className="flex flex-col gap-1.5 rounded-[10px] border border-line px-5 py-[18px]">
            <h3 className="text-[14px] font-medium">{doc.title}</h3>
            <p>
              <RepoPath>{doc.path}</RepoPath>
            </p>
            <p className="text-[13px] leading-[1.6] text-fg-muted">{doc.body}</p>
          </li>
        ))}
      </ul>
      <p className="max-w-[680px] text-[13.5px] leading-[1.6] text-fg-muted">
        UI mockup mode needs only the web app. Its actions are recorded in the browser, and no ledger transaction is
        submitted. Also in the repository:{" "}
        {MORE_REPO_DOCS.map((path, index) => (
          <Fragment key={path}>
            {index > 0 ? ", " : null}
            <RepoPath>{path}</RepoPath>
          </Fragment>
        ))}
        .
      </p>
    </DocsSection>
  );
}
