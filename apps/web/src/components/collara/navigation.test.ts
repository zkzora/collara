import { describe, expect, it } from "vitest";
import { breadcrumbsFor } from "./navigation";

describe("breadcrumbsFor", () => {
  it("labels the overview and sidebar sections", () => {
    expect(breadcrumbsFor("/app")).toEqual([{ label: "Overview" }]);
    expect(breadcrumbsFor("/app/cases/CL-001/evidence")).toEqual([
      { label: "Cases", href: "/app/cases" },
      { label: "CL-001", mono: true },
    ]);
    expect(breadcrumbsFor("/app/governance/registry")).toEqual([{ label: "Governance" }]);
  });

  it("uses page titles for workspace pages without a sidebar entry", () => {
    expect(breadcrumbsFor("/app/access")).toEqual([{ label: "Sharing and access" }]);
    expect(breadcrumbsFor("/app/notifications")).toEqual([{ label: "Notifications" }]);
  });

  it("keeps reviews and reports under their parent sections", () => {
    expect(breadcrumbsFor("/app/reviews/REV-001/assessment")[0]).toEqual({ label: "Cases", href: "/app/cases" });
    expect(breadcrumbsFor("/app/reports")).toEqual([{ label: "Audit" }]);
  });
});
