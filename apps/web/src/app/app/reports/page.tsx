import { redirect } from "next/navigation";

/** Export history lives in the Audit Center (S L130: "may be a tab in Audit"). */
export default function ReportsPage() {
  redirect("/app/audit/exports");
}
