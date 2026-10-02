import { redirect } from "next/navigation";

/** Events is the default Audit section at `/app/audit`. */
export default function AuditEventsAliasPage() {
  redirect("/app/audit");
}
