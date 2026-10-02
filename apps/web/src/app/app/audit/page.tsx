import { CaseRefSchema, EventKindSchema } from "@collara/domain";
import type { Metadata } from "next";
import { z } from "zod";
import { AuditEvents } from "@/components/workspace/audit/audit-events";

export const metadata: Metadata = { title: "Audit events" };

const DateSchema = z.iso.date();
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const pick = <T,>(schema: z.ZodType<T>, value: string | string[] | undefined): T | undefined => {
  const parsed = schema.safeParse(first(value));
  return parsed.success ? parsed.data : undefined;
};

/** `/app/audit?caseId=&kind=&from=&to=` — filters live in the URL (S §9.17). */
export default async function AuditEventsPage({ searchParams }: PageProps<"/app/audit">) {
  const params = await searchParams;
  return (
    <AuditEvents
      filters={{
        caseId: pick(CaseRefSchema, params.caseId),
        kind: pick(EventKindSchema, params.kind),
        from: pick(DateSchema, params.from),
        to: pick(DateSchema, params.to),
      }}
    />
  );
}
