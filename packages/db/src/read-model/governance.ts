// Governance facts (verifier registry and DM governed actions, Tier A) from the viewer's stakeholder view.
// Seat holders read the governance party (readAs), so they see GovernanceRules, proposals, confirmations and
// execution results; the registrar sees the registry and accreditations as operator; verifiers and lenders in
// the config directory see only the registrar's VerifierStatusMirror contracts.
import type { GovernanceFacts, GovernanceProposalFacts, GovernanceSeat, VerifierFacts } from "@collara/domain";
import { T } from "../projection/templates";
import { decode, str } from "./decode";
import type { LedgerView, PartyDirectory, VisibleContract } from "./ledger-view";

const byOffset = (a: VisibleContract, b: VisibleContract) => a.createdOffset - b.createdOffset || a.createdNodeId - b.createdNodeId;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Display refs: governed proposals are numbered GP-001, GP-002, … in creation order (bootstrap = GP-000). */
const gpRef = (n: number) => `GP-${String(n).padStart(3, "0")}`;

export function buildGovernance(view: LedgerView, parties: PartyDirectory): GovernanceFacts | null {
  const of = (template: string) => view.contracts.filter((c) => c.templateRef === template).sort(byOffset);
  const rulesContracts = of(T.GovernanceRules);
  const registries = of(T.VerifierRegistry);
  const accreditations = of(T.VerifierAccreditation);
  const mirrors = of(T.VerifierStatusMirror);
  if (rulesContracts.length === 0 && registries.length === 0 && accreditations.length === 0 && mirrors.length === 0) return null;

  const rulesContract = rulesContracts.filter((c) => !c.archived).at(-1) ?? rulesContracts.at(-1);
  const rules = rulesContract ? decode.rules(rulesContract.payload) : null;
  const seats = (rules?.members ?? [])
    .map((member) => ({ member, seat: parties.seatOf(member) }))
    .filter((x): x is { member: string; seat: GovernanceSeat } => x.seat !== null)
    .sort((a, b) => a.seat - b.seat)
    .map(({ member, seat }) => ({
      seat,
      orgId: parties.orgIdOf(member),
      memberRef: parties.hintOf(member),
      mandateLabel: `Governance seat ${seat}`,
      since: rulesContract?.createdAt ?? "",
    }));
  const seatOf = (party: string): GovernanceSeat | null => parties.seatOf(party);

  const registry = registries.filter((c) => !c.archived).at(-1) ?? registries.at(-1);
  const registryVersion = registry ? decode.registry(registry.payload).version : Math.max(0, ...mirrors.map((m) => decode.mirror(m.payload).registryVersion));

  // Verifiers: governance-signed accreditations when visible, else the registrar's mirrors.
  const verifiers = new Map<string, VerifierFacts>();
  const latestAccreditation = new Map<string, VisibleContract>();
  for (const c of accreditations) {
    const ref = str(c.payload.verifierRef);
    const prev = latestAccreditation.get(ref);
    if (!prev || (!c.archived && (prev.archived || c.createdOffset > prev.createdOffset))) latestAccreditation.set(ref, c);
  }
  for (const [ref, c] of latestAccreditation) {
    const a = decode.accreditation(c.payload);
    verifiers.set(ref, {
      ref,
      orgName: a.orgName,
      orgId: parties.orgOf(a.verifier),
      scope: a.scope.join(", "),
      status: a.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE",
      since: c.createdAt,
      via: a.registryVersion === 0 ? "genesis" : `registry v${a.registryVersion}`,
    });
  }
  for (const c of mirrors.filter((m) => !m.archived)) {
    const m = decode.mirror(c.payload);
    if (verifiers.has(m.verifierRef)) continue;
    const orgId = parties.orgOf(m.verifier);
    verifiers.set(m.verifierRef, {
      ref: m.verifierRef,
      orgName: orgId ?? parties.hintOf(m.verifier),
      orgId,
      scope: "",
      status: m.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE",
      since: c.createdAt,
      via: m.sourceRef || `registry v${m.registryVersion}`,
    });
  }

  // Governed proposals (Add / Suspend). Confirmations and execution come from DM contracts in the same view.
  const confirmations = of(T.GovernanceConfirmation);
  const results = of(T.GovernanceExecutionResult);
  const governed = [...of(T.AddVerifierProposal), ...of(T.SuspendVerifierProposal)].sort(byOffset);
  const proposals: GovernanceProposalFacts[] = governed.map((c, i) => {
    const p = decode.governanceProposal(c.payload);
    const isAdd = c.templateRef === T.AddVerifierProposal;
    const target = isAdd
      ? { verifierRef: p.verifierRef ?? "", orgName: p.orgName ?? "", scope: p.scope.join(", ") }
      : (() => {
          const acc = accreditations.find((a) => a.contractId === p.accreditationCid);
          const decoded = acc ? decode.accreditation(acc.payload) : null;
          const fromVerifier = [...verifiers.values()].find((v) => v.orgId !== null && v.orgId === parties.orgOf(p.verifier));
          return {
            verifierRef: decoded?.verifierRef ?? fromVerifier?.ref ?? "",
            orgName: decoded?.orgName ?? fromVerifier?.orgName ?? parties.hintOf(p.verifier),
            scope: decoded?.scope.join(", ") ?? fromVerifier?.scope ?? "",
          };
        })();
    const executed = c.archived && c.archived.choice !== "GovernableAction_ProposerCancel" ? c.archived : null;
    const cancelled = c.archived?.choice === "GovernableAction_ProposerCancel" ? c.archived : null;
    const result = executed ? results.find((r) => r.createdUpdateId === executed.updateId) : undefined;
    return {
      ref: gpRef(i + 1),
      type: isAdd ? "ADD_VERIFIER" : "SUSPEND_VERIFIER",
      target,
      proposerSeat: seatOf(p.proposer) ?? 1,
      rationale: p.reason,
      effect: isAdd ? `${target.verifierRef || "The verifier"} is added to the registry as ACTIVE.` : `${target.verifierRef || "The verifier"} is set to SUSPENDED.`,
      openedAt: c.createdAt,
      deadlineAt: p.proposalDeadline,
      expectedRegistryVersion: p.expectedVersion,
      confirmations: confirmations
        .filter((x) => str(x.payload.actionProposalCid) === c.contractId)
        .flatMap((x) => {
          const seat = seatOf(str(x.payload.confirmer));
          return seat ? [{ seat, confirmedAt: x.createdAt }] : [];
        }),
      executedAt: executed?.at ?? null,
      executedBySeat: result ? seatOf(str(result.payload.executor)) : null,
      cancelledAt: cancelled?.at ?? null,
    };
  });

  const deadlines = governed.map((c) => Date.parse(str(c.payload.proposalDeadline)) - Date.parse(c.createdAt)).filter((ms) => ms > 0);
  return {
    integration: rules ? "PARTIAL_TIER_A" : "UNAVAILABLE",
    threshold: rules?.threshold ?? 2,
    seats,
    registryVersion,
    proposalDeadlineDays: deadlines.length ? Math.max(1, Math.round((deadlines.at(-1) ?? DAY) / DAY)) : 14,
    // Exact (possibly fractional) hours: the DM default is 30 minutes.
    confirmationTimeoutHours: rules?.timeoutMs ? rules.timeoutMs / HOUR : 0.5,
    verifiers: [...verifiers.values()].sort((a, b) => a.ref.localeCompare(b.ref)),
    proposals,
  };
}
