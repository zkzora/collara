import { describe, expect, it } from "vitest";
import { fixture } from "./__fixtures__";
import { create, createAndExercise, deduplication, exercise, parseTemplateId, rights, templateId, templateRefOf } from "./commands";
import { normalizeActiveContract, normalizeTransaction, normalizeUpdate } from "./events";

describe("template ids and command builders", () => {
  it("builds package-name template ids", () => {
    expect(templateId("collara-contracts", "Collara.Control", "AssetControl")).toBe(
      "#collara-contracts:Collara.Control:AssetControl",
    );
    expect(() => templateId("collara contracts", "M", "T")).toThrow(RangeError);
    expect(parseTemplateId("395aa0a6:It:Notice")).toEqual({
      packageRef: "395aa0a6",
      byPackageName: false,
      moduleName: "It",
      entityName: "Notice",
    });
    expect(templateRefOf({ templateId: "395aa0a6:It:Notice", packageName: "collara-canton-it" })).toBe(
      "#collara-canton-it:It:Notice",
    );
  });

  it("builds JSON API commands", () => {
    const t = templateId("collara-canton-it", "It", "Token");
    expect(create(t, { label: "x" })).toEqual({ CreateCommand: { templateId: t, createArguments: { label: "x" } } });
    expect(exercise(t, "00ab", "Consume")).toEqual({
      ExerciseCommand: { templateId: t, contractId: "00ab", choice: "Consume", choiceArgument: {} },
    });
    expect(createAndExercise(t, {}, "Consume")).toHaveProperty("CreateAndExerciseCommand.choice", "Consume");
    expect(deduplication.duration(3600)).toEqual({ DeduplicationDuration: { value: { seconds: 3600, nanos: 0 } } });
    expect(rights.canActAs("P::1220ab")).toEqual({ kind: { CanActAs: { value: { party: "P::1220ab" } } } });
  });
});

describe("normalizers (recorded responses)", () => {
  it("normalizes a submit-and-wait-for-transaction response", () => {
    const body = fixture("submit-and-wait-for-transaction") as { transaction: unknown };
    const tx = normalizeTransaction(body.transaction);
    expect(tx.commandId).toBe("fx-create");
    expect(tx.events).toHaveLength(1);
    const [event] = tx.events;
    expect(event).toMatchObject({ kind: "created", templateRef: "#collara-canton-it:It:Notice", packageName: "collara-canton-it" });
    if (event?.kind !== "created") throw new Error("expected a created event");
    expect(event.signatories).toHaveLength(1);
    expect(event.observers).toHaveLength(1);
    expect(event.createdEventBlob).toBeUndefined();
  });

  it("normalizes ACS_DELTA updates with the observer as the only witness", () => {
    const updates = (fixture("updates-acs-delta-observer") as unknown[]).map(normalizeUpdate);
    const events = updates.flatMap((u) => (u.kind === "transaction" ? u.transaction.events : []));
    expect(events.map((e) => e.kind)).toEqual(["created", "archived"]);
    const observer = events[0]?.kind === "created" ? (events[0].createArgument as { audience: string[] }).audience[0] : "";
    for (const event of events) expect(event.witnessParties).toEqual([observer]);
    for (const u of updates) if (u.kind === "transaction") expect(u.transaction.commandId).toBe("");
  });

  it("normalizes LEDGER_EFFECTS updates including the consuming exercise", () => {
    const updates = (fixture("updates-ledger-effects-observer") as unknown[]).map(normalizeUpdate);
    const events = updates.flatMap((u) => (u.kind === "transaction" ? u.transaction.events : []));
    expect(events.map((e) => e.kind)).toEqual(["created", "exercised"]);
    expect(events[1]).toMatchObject({ kind: "exercised", choice: "Withdraw", consuming: true });
  });

  it("normalizes checkpoints and unknown update kinds", () => {
    expect(normalizeUpdate({ update: { OffsetCheckpoint: { value: { offset: 50, synchronizerTimes: [] } } } })).toEqual({
      kind: "checkpoint",
      offset: 50,
    });
    expect(normalizeUpdate({ update: { TopologyTransaction: { value: { offset: 7 } } } })).toEqual({
      kind: "other",
      type: "TopologyTransaction",
      offset: 7,
    });
  });

  it("normalizes an active-contracts page entry", () => {
    const page = fixture("active-contracts-page") as { activeContracts: unknown[] };
    const contract = normalizeActiveContract(page.activeContracts[0]);
    expect(contract?.event.templateRef).toBe("#collara-canton-it:It:Notice");
    expect(contract?.reassignmentCounter).toBe(0);
    expect(normalizeActiveContract({ contractEntry: { JsEmpty: {} } })).toBeUndefined();
  });
});
