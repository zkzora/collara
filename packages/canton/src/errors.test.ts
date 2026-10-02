import { describe, expect, it } from "vitest";
import { errorFixture } from "./__fixtures__";
import { classifyLedgerError, LedgerError } from "./errors";

const classify = (name: string) => classifyLedgerError(errorFixture(name));

describe("classifyLedgerError with recorded Canton 3.5.19 responses", () => {
  it("DUPLICATE_COMMAND with accepted:true is a committed duplicate", () => {
    const info = classify("duplicate-command");
    expect(info).toMatchObject({
      kind: "DUPLICATE_COMMAND",
      commandState: "COMMITTED",
      definite: true,
      retryable: false,
      code: "DUPLICATE_COMMAND",
      httpStatus: 409,
      grpcCode: 6,
      errorCategory: 10,
      duplicate: { accepted: true, completionOffset: 55 },
      serverDefiniteAnswer: true,
    });
    expect(info.duplicate?.existingSubmissionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("DUPLICATE_COMMAND without acceptance is still unknown", () => {
    const recorded = errorFixture("duplicate-command");
    const body = structuredClone(recorded.body) as { context: Record<string, string> };
    body.context.accepted = "false";
    expect(classifyLedgerError({ status: 409, body })).toMatchObject({
      kind: "DUPLICATE_COMMAND",
      commandState: "UNKNOWN_OUTCOME",
      definite: false,
      retryable: true,
      duplicate: { accepted: false },
    });
  });

  it("LOCAL_VERDICT_LOCKED_CONTRACTS is a retryable rejection with retryInfo", () => {
    expect(classify("locked-contracts")).toMatchObject({
      kind: "LOCKED_CONTRACTS",
      commandState: "REJECTED",
      definite: true,
      retryable: true,
      retryAfterMs: 1000,
      httpStatus: 409,
      serverDefiniteAnswer: false,
    });
  });

  it("CONTRACT_NOT_FOUND is a definite rejection", () => {
    expect(classify("contract-not-found")).toMatchObject({
      kind: "CONTRACT_NOT_FOUND",
      commandState: "REJECTED",
      definite: true,
      retryable: false,
      httpStatus: 404,
      grpcCode: 5,
    });
  });

  it("DAML_AUTHORIZATION_ERROR is a definite rejection", () => {
    expect(classify("daml-authorization-error")).toMatchObject({
      kind: "AUTHORIZATION",
      commandState: "REJECTED",
      definite: true,
      retryable: false,
      httpStatus: 400,
      errorCategory: 8,
    });
  });

  it("redacted 403 bodies are PERMISSION_DENIED and FAILED", () => {
    for (const name of ["permission-denied-act-as", "permission-denied-read-as"]) {
      const info = classify(name);
      expect(info).toMatchObject({ kind: "PERMISSION_DENIED", commandState: "FAILED", definite: true, retryable: false });
      expect(info.code).toBe("NA");
      expect(info.errorCategory).toBeUndefined();
    }
  });

  it("redacted 401 bodies are UNAUTHENTICATED and FAILED", () => {
    for (const name of ["unauthenticated-no-token", "unauthenticated-bad-signature", "unauthenticated-lifetime-too-long"]) {
      expect(classify(name)).toMatchObject({ kind: "UNAUTHENTICATED", commandState: "FAILED", definite: true });
    }
  });

  it("Daml failures (ensure/assert) are FAILED_PRECONDITION rejections", () => {
    expect(classify("precondition-failed")).toMatchObject({
      kind: "FAILED_PRECONDITION",
      commandState: "REJECTED",
      code: "DAML_FAILURE",
      definite: true,
    });
  });

  it("unknown templates, users and packages are NOT_FOUND", () => {
    expect(classify("invalid-template")).toMatchObject({ kind: "NOT_FOUND", code: "TEMPLATES_OR_INTERFACES_NOT_FOUND" });
    expect(classify("user-not-found")).toMatchObject({ kind: "NOT_FOUND", code: "USER_NOT_FOUND" });
    expect(classify("package-names-not-found")).toMatchObject({ kind: "NOT_FOUND", code: "PACKAGE_NAMES_NOT_FOUND", commandState: "REJECTED" });
  });

  it("invalid arguments, including plain-text 400 bodies, are INVALID_ARGUMENT rejections", () => {
    expect(classify("invalid-argument-payload")).toMatchObject({ kind: "INVALID_ARGUMENT", commandState: "REJECTED" });
    expect(classify("party-already-exists")).toMatchObject({ kind: "INVALID_ARGUMENT", code: "INVALID_ARGUMENT" });
    expect(classify("invalid-argument-numeric-type")).toMatchObject({ kind: "INVALID_ARGUMENT", commandState: "REJECTED" });
    expect(classify("command-preprocessing-failed")).toMatchObject({
      kind: "INVALID_ARGUMENT",
      code: "COMMAND_PREPROCESSING_FAILED",
      definite: true,
    });
    const malformed = classify("malformed-body");
    expect(malformed).toMatchObject({ kind: "INVALID_ARGUMENT", commandState: "REJECTED", httpStatus: 400 });
    expect(malformed.code).toBeUndefined();
  });

  it("internal errors (some payload decoding failures) are an unknown outcome and are not blindly retried", () => {
    expect(classify("internal-error-int-as-number")).toMatchObject({
      kind: "UNKNOWN",
      commandState: "UNKNOWN_OUTCOME",
      definite: false,
      retryable: false,
      httpStatus: 500,
      code: "LEDGER_API_INTERNAL_ERROR",
      errorCategory: 4,
    });
  });

  it("gateway errors without a Canton body are an unknown outcome", () => {
    expect(classifyLedgerError({ status: 503, body: "Service Unavailable" })).toMatchObject({
      kind: "UNAVAILABLE",
      commandState: "UNKNOWN_OUTCOME",
      retryable: true,
    });
    expect(classifyLedgerError({ status: 504, body: "" })).toMatchObject({ kind: "TIMEOUT", commandState: "UNKNOWN_OUTCOME" });
  });
});

describe("classifyLedgerError with thrown errors", () => {
  it("a timeout is UNKNOWN_OUTCOME, never a failure", () => {
    const error = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    expect(classifyLedgerError({ error })).toMatchObject({
      kind: "TIMEOUT",
      commandState: "UNKNOWN_OUTCOME",
      definite: false,
      retryable: true,
    });
  });

  it("connection refused means the ledger never received the request", () => {
    const error = new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
    expect(classifyLedgerError({ error })).toMatchObject({
      kind: "UNAVAILABLE",
      commandState: "FAILED",
      definite: true,
      retryable: true,
    });
  });

  it("a reset connection may have delivered the request", () => {
    const error = new TypeError("fetch failed", { cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }) });
    expect(classifyLedgerError({ error })).toMatchObject({ kind: "UNAVAILABLE", commandState: "UNKNOWN_OUTCOME", definite: false });
  });
});

describe("LedgerError", () => {
  it("carries the classification and a readable message", () => {
    const error = new LedgerError("submitAndWait", classify("contract-not-found"));
    expect(error.kind).toBe("CONTRACT_NOT_FOUND");
    expect(error.message).toMatch(/^submitAndWait: CONTRACT_NOT_FOUND: Contract could not be found/);
    expect(error).toBeInstanceOf(Error);
  });
});
