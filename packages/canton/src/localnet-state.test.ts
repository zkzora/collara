import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadLocalnetState, localnetParty } from "./localnet-state";

// Written by scripts/localnet/bootstrap.mjs against a 1-participant sandbox.
const RECORDED = fileURLToPath(new URL("./__fixtures__/localnet-state.json", import.meta.url));

describe("LocalNet bootstrap state", () => {
  it("validates the state written by bootstrap.mjs", async () => {
    const state = await loadLocalnetState(RECORDED);
    expect(state?.topology).toBe("sandbox-1-participant");
    expect(Object.keys(state?.parties ?? {})).toHaveLength(11);
    expect(state?.users.find((u) => u.role === "projector")?.readAs).toHaveLength(11);
    expect(state?.users.find((u) => u.id === "borrower-svc")).toMatchObject({ role: "org", party: "DemoManufacturer" });
    expect(JSON.stringify(state)).not.toMatch(/secret/i);
  });

  it("resolves a party hint to its user, participant and endpoint", async () => {
    const state = (await loadLocalnetState(RECORDED))!;
    const borrower = localnetParty(state, "DemoManufacturer");
    expect(borrower).toMatchObject({ userId: "borrower-svc", jsonApiUrl: "http://127.0.0.1:7575", participantId: state.participantId });
    expect(borrower.party).toMatch(/^DemoManufacturer::1220/);
    expect(() => localnetParty(state, "Nobody")).toThrow(/not in the LocalNet state/);
  });

  it("returns null when bootstrap has not run", async () => {
    expect(await loadLocalnetState(fileURLToPath(new URL("./__fixtures__/missing.json", import.meta.url)))).toBeNull();
  });
});
