"use client";

import { ENVIRONMENT_CHIPS, MODE_BANNERS, type OrgType } from "@collara/domain";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { DefinitionList } from "@/components/collara/definition-list";
import { LoadingState } from "@/components/collara/loading-state";
import { PageHeader } from "@/components/collara/page-header";
import { Panel } from "@/components/collara/panel";
import { TableRegion, TD, TR } from "@/components/workspace/audit/table-region";
import { useCollara } from "@/lib/collara-client";
import { useSession } from "@/lib/session";

const ORG_TYPE_LABELS: Readonly<Record<OrgType, string>> = {
  OPERATOR: "Collara operator",
  BORROWER: "Borrower / equipment owner",
  DEALER: "Equipment dealer",
  VERIFIER: "Verifier",
  LENDER: "Lender",
  AUDITOR: "Auditor",
};

/** Members of the viewer's organization from the demo directory (demo sessions only). */
function Members() {
  const { client, mode } = useCollara();
  const { me, keys } = useSession();
  const personas = useQuery({ queryKey: keys.demoPersonas(), queryFn: ({ signal }) => client.demo.personas({ signal }), retry: false });
  if (personas.isPending) return <LoadingState variant="inline" label="Loading members…" />;
  if (personas.isError) return <p className="text-[13px] text-fg-muted">The member directory is not available in this environment.</p>;
  const members = personas.data.filter((p) => p.org.id === me.org.id);
  return (
    <TableRegion label={`Members · ${me.org.name}${mode === "UI_MOCK" ? " (demo directory)" : ""}`} head={["Member", "Roles", "Mandates"]} minWidth="min-w-[560px]">
      {members.map((m) => (
        <tr key={m.id} className={TR}>
          <td className={TD}>
            {m.displayName}
            {m.id === me.personaId ? <span className="ml-2 text-[11px] text-highlight-strong">you</span> : null}
            {m.title ? <span className="block text-[12px] text-fg-subtle">{m.title}</span> : null}
          </td>
          <td className={TD}>{m.roleLabels.join(", ")}</td>
          <td className={`${TD} text-fg-muted`}>{m.mandateLabels.join(", ") || "—"}</td>
        </tr>
      ))}
    </TableRegion>
  );
}

/** Workspace Settings (S §9.19, minimal): organization, membership and mandates, read-only. */
export function SettingsView() {
  const { me, mode } = useSession();
  return (
    <div className="flex flex-col gap-[18px]">
      <PageHeader title="Settings" description={`Workspace settings for ${me.org.name}. Read-only in this MVP.`} />
      <div className="grid grid-cols-1 items-start gap-3.5 app:grid-cols-2">
        <Panel title="Organization">
          <DefinitionList
            termWidth="md"
            items={[
              { term: "Name", description: me.org.name },
              { term: "Organization type", description: ORG_TYPE_LABELS[me.org.type] },
              { term: "Environment", description: `${ENVIRONMENT_CHIPS[mode]} · ${MODE_BANNERS[mode]}` },
            ]}
          />
        </Panel>
        <Panel title="Your membership">
          <DefinitionList
            termWidth="md"
            items={[
              { term: "Name", description: [me.user.displayName, me.user.title].filter(Boolean).join(" · ") },
              { term: "Email", description: <span className="font-mono text-[12.5px]">{me.user.email}</span> },
              { term: "Roles", description: me.roleLabels.join(", ") },
              { term: "Mandates", description: me.mandates.map((m) => m.label).join(", ") || "None" },
              { term: "Governance seat", description: me.governanceSeat ? `Seat ${me.governanceSeat}` : "None" },
            ]}
          />
        </Panel>
      </div>
      <section aria-labelledby="settings-members" className="flex flex-col gap-2">
        <h2 id="settings-members" className="text-[14px] font-medium text-fg">
          Members and mandates
        </h2>
        <Members />
      </section>
      <div className="flex flex-col gap-1.5 text-[12px] leading-relaxed text-fg-subtle">
        <p>Team and mandate management is not available in this MVP; the demo uses seeded roles. Signing keys, participant tokens and credentials are never shown here.</p>
        <p>
          Sharing and audit grants across your cases are listed under{" "}
          <Link href="/app/access" className="text-fg-muted underline underline-offset-4 hover:text-fg">
            Sharing and access
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
