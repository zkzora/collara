// Selection → grant planning for verification evidence grants (pure parts of ./grants.ts and the download rule in
// ../sharing/evidence-access.ts). The LocalNet flow is covered by test/localnet/verifier-evidence.it.test.ts.
import { VERIFICATION_GRANT_PURPOSE, verificationGrantRef, verificationGrantRequestRef } from "@collara/domain";
import { describe, expect, it } from "vitest";
import type { Payload } from "../../ledger/contracts";
import { coverageOf } from "../sharing/evidence-access";
import { DEFAULT_VERIFICATION_GRANT_DAYS, exactKey, planVerificationGrant, verificationGrantExpiry } from "./grants";

const OWNER = "DemoManufacturer::1220feed";
const DEALER = "DemoCNCDealer::1220feed";
const OTHER_DEALER = "OtherDealer::1220feed";
const VERIFIER = "DemoVerifier::1220feed";
const OTHER_VERIFIER = "OtherVerifier::1220feed";
const NOW = new Date("2026-10-02T12:00:00Z");
const DAY = 86_400_000;

const entry = (docRef: string, docVersion: number, source: string) => ({ docRef, docVersion, sha256: `sha-${docRef.toLowerCase()}-v${docVersion}`, source });
const ENTRIES = [entry("DOC-001", 1, DEALER), entry("DOC-002", 1, OWNER), entry("DOC-003", 2, OWNER), entry("DOC-004", 1, OWNER), entry("DOC-006", 1, OTHER_DEALER)];

describe("planVerificationGrant", () => {
  it("grants exactly the selected owner documents at the manifest's version and hash, never the rest of the package", () => {
    const plan = planVerificationGrant({ entries: ENTRIES, selection: ["DOC-003", "DOC-002"], ownerParty: OWNER, caseRef: "CL-001", dealerWithheld: new Set() });
    expect(plan.owner).toEqual([
      { docRef: "DOC-002", docVersion: 1, sha256: "sha-doc-002-v1", source: OWNER },
      { docRef: "DOC-003", docVersion: 2, sha256: "sha-doc-003-v2", source: OWNER },
    ]);
    expect(plan.dealers).toEqual([]);
    expect(plan.withheld).toEqual([]);
    expect(plan.missing).toEqual([]);
  });

  it("requests dealer documents from their dealer (one consent request per dealer), for a case-linked request only", () => {
    const plan = planVerificationGrant({ entries: ENTRIES, selection: ["DOC-001", "DOC-002", "DOC-006"], ownerParty: OWNER, caseRef: "CL-001", dealerWithheld: new Set() });
    expect(plan.owner.map((d) => d.docRef)).toEqual(["DOC-002"]);
    expect(plan.dealers).toEqual([
      { dealer: DEALER, documents: [{ docRef: "DOC-001", docVersion: 1, sha256: "sha-doc-001-v1", source: DEALER }] },
      { dealer: OTHER_DEALER, documents: [{ docRef: "DOC-006", docVersion: 1, sha256: "sha-doc-006-v1", source: OTHER_DEALER }] },
    ]);
    expect(plan.withheld).toEqual([]);
    // An asset-level request has no invited dealer: dealer documents are withheld.
    const assetLevel = planVerificationGrant({ entries: ENTRIES, selection: ["DOC-001", "DOC-002"], ownerParty: OWNER, caseRef: null, dealerWithheld: new Set() });
    expect(assetLevel.dealers).toEqual([]);
    expect(assetLevel.withheld).toEqual(["DOC-001"]);
  });

  it("withholds a dealer document whose contribution of that exact version withholds verification use", () => {
    const withheld = new Set([exactKey(entry("DOC-001", 1, DEALER))]);
    const plan = planVerificationGrant({ entries: ENTRIES, selection: ["DOC-001", "DOC-006"], ownerParty: OWNER, caseRef: "CL-001", dealerWithheld: withheld });
    expect(plan.dealers.map((d) => d.dealer)).toEqual([OTHER_DEALER]);
    expect(plan.withheld).toEqual(["DOC-001"]);
    // A veto recorded for another version (or hash) does not carry over.
    const other = planVerificationGrant({ entries: ENTRIES, selection: ["DOC-001"], ownerParty: OWNER, caseRef: "CL-001", dealerWithheld: new Set([exactKey({ docRef: "DOC-001", docVersion: 1, sha256: "other" })]) });
    expect(other.dealers.map((d) => d.dealer)).toEqual([DEALER]);
    expect(other.withheld).toEqual([]);
  });

  it("reports documents that are not in the manifest and ignores duplicates", () => {
    const plan = planVerificationGrant({ entries: ENTRIES, selection: ["DOC-002", "DOC-002", "DOC-999"], ownerParty: OWNER, caseRef: "CL-001", dealerWithheld: new Set() });
    expect(plan.owner.map((d) => d.docRef)).toEqual(["DOC-002"]);
    expect(plan.missing).toEqual(["DOC-999"]);
  });
});

describe("grant reference and expiry", () => {
  it("binds a grant to its request and evidence version", () => {
    expect(verificationGrantRef("VR-002", 3)).toBe("VR-002-G3");
    expect(verificationGrantRef("VR-002", 3, 1)).toBe("VR-002-G3-D1");
    expect(verificationGrantRequestRef("VR-002-G3")).toBe("VR-002");
    expect(verificationGrantRequestRef("VR-002-G3-D1")).toBe("VR-002");
    expect(verificationGrantRequestRef("AG-004")).toBeNull();
  });

  it("expires at the request's due date, else after the documented default", () => {
    const due = new Date(NOW.getTime() + 10 * DAY).toISOString();
    expect(verificationGrantExpiry(due, NOW).toISOString()).toBe(due);
    expect(verificationGrantExpiry(null, NOW).getTime()).toBe(NOW.getTime() + DEFAULT_VERIFICATION_GRANT_DAYS * DAY);
    // A due date already passed (a late resubmission) does not produce an expired grant.
    expect(verificationGrantExpiry(new Date(NOW.getTime() - DAY).toISOString(), NOW).getTime()).toBe(NOW.getTime() + DEFAULT_VERIFICATION_GRANT_DAYS * DAY);
  });
});

describe("download coverage (coverageOf)", () => {
  const anchor = (version: number) => ({ packageRef: "PKG-001", manifestVersion: version, manifestHash: `hash-v${version}` });
  const share = (over: Partial<Payload<"PackageShare">> = {}): Payload<"PackageShare"> => ({
    owner: OWNER,
    consenters: [],
    recipient: VERIFIER,
    shareRef: verificationGrantRef("VR-002", 3),
    purpose: VERIFICATION_GRANT_PURPOSE,
    caseRef: "CL-001",
    evidence: anchor(3),
    documents: [
      { docRef: "DOC-002", docVersion: 1, sha256: "sha-doc-002-v1", source: OWNER },
      { docRef: "DOC-003", docVersion: 2, sha256: "sha-doc-003-v2", source: OWNER },
    ],
    permission: "VIEW_DOWNLOAD",
    expiresAt: new Date(NOW.getTime() + 10 * DAY).toISOString(),
    ...over,
  });
  const request = (over: Partial<Payload<"VerificationRequest">> = {}): Payload<"VerificationRequest"> => ({
    owner: OWNER,
    verifier: VERIFIER,
    registrar: "CollaraRegistrar::1220feed",
    namespace: "collara-localnet",
    requestRef: "VR-002",
    assetId: "ASSET-DEMO-001",
    passportVersion: 1,
    caseRef: "CL-001",
    evidence: anchor(3),
    equipmentScope: "CNC_MACHINERY",
    checklist: ["Photos"],
    dueBy: null,
    status: "IN_REVIEW",
    version: 2,
    changeNote: "",
    ...over,
  });
  const cover = (input: Partial<Parameters<typeof coverageOf>[0]>) =>
    coverageOf({ party: VERIFIER, roles: ["VERIFIER"], docRef: "DOC-003", now: NOW, shares: [share()], openRequests: [request()], ...input });

  it("covers the exact granted version for the assigned verifier while its request is open on that evidence version", () => {
    expect(cover({})).toEqual([{ version: 2, sha256: "sha-doc-003-v2", permission: "VIEW_DOWNLOAD" }]);
    expect(cover({ docRef: "DOC-004" })).toEqual([]);
  });

  it("refuses another verifier, a non-verifier role, an expired grant and a grant without its open request", () => {
    expect(cover({ party: OTHER_VERIFIER })).toEqual([]);
    expect(cover({ shares: [share({ recipient: OTHER_VERIFIER })] })).toEqual([]);
    expect(cover({ roles: ["LENDER_APPROVER"] })).toEqual([]);
    expect(cover({ shares: [share({ expiresAt: new Date(NOW.getTime() - 1).toISOString() })] })).toEqual([]);
    // Attested, declined or cancelled: the request is no longer active.
    expect(cover({ openRequests: [] })).toEqual([]);
    // Resubmitted: the open request points at a newer evidence version than the grant.
    expect(cover({ openRequests: [request({ evidence: anchor(4) })] })).toEqual([]);
    // The grant reference names another request; or the request has another owner.
    expect(cover({ shares: [share({ shareRef: verificationGrantRef("VR-009", 3) })] })).toEqual([]);
    expect(cover({ openRequests: [request({ owner: "Someone::1220feed" })] })).toEqual([]);
  });

  it("leaves lender shares as they were (recipient, expiry, documents)", () => {
    const lender = "DemoLenderA::1220feed";
    const lenderShare = share({ recipient: lender, purpose: "LENDER_REVIEW", shareRef: "AG-002" });
    expect(cover({ party: lender, roles: ["LENDER_ANALYST"], shares: [lenderShare], openRequests: [] })).toEqual([{ version: 2, sha256: "sha-doc-003-v2", permission: "VIEW_DOWNLOAD" }]);
  });
});
