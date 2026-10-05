import { describe, expect, it } from "vitest";
import { connectionState, shortenParty } from "./canton-connection";

describe("Canton connection state", () => {
  it("recognizes a server-bound DevNet party", () => {
    expect(connectionState("DEVNET", { network: "DEVNET", partyId: "tenant-DemoLenderA::1220abc" })).toBe("connected");
  });

  it("does not treat a party on another environment as connected", () => {
    expect(connectionState("DEVNET", { network: "LOCALNET", partyId: "DemoLenderA::1220abc" })).toBe("wrong-network");
  });

  it("keeps mock and unbound identities explicit", () => {
    expect(connectionState("UI_MOCK", { network: "UI_MOCK", partyId: null })).toBe("mock");
    expect(connectionState("DEVNET", { network: "DEVNET", partyId: null })).toBe("not-connected");
    expect(shortenParty(null)).toBe("Not connected");
  });
});
