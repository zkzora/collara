import { redirect } from "next/navigation";

/** Governance opens on the Verifier Registry (CR-08). */
export default function GovernancePage() {
  redirect("/app/governance/registry");
}
