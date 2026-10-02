"use client";

import { errorMessage } from "@collara/api-client";
import {
  DEMO_PERSONAS,
  orderRoles,
  orgName,
  PERSONA_IDS,
  PersonaIdSchema,
  ROLE_LABELS,
  ROLE_SHORT_LABELS,
  type DemoPersona,
  type PersonaId,
  type Role,
} from "@collara/domain";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useCollara } from "@/lib/collara-client";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export interface PersonaOption {
  readonly id: PersonaId;
  readonly label: string;
  readonly orgName: string;
}

/**
 * "Morgan Hale · Approver" (short, the sidebar select) or "Morgan Hale — Lender Approver" (the login list). The
 * governance seat is a mandate shown elsewhere; the business role names the persona.
 */
export function personaLabel(displayName: string, roles: readonly Role[], { short = false }: { short?: boolean } = {}): string {
  const business = orderRoles(roles).filter((role) => role !== "GOVERNANCE_MEMBER");
  const shown = business.length > 0 ? business : orderRoles(roles);
  return short
    ? `${displayName} · ${shown.map((role) => ROLE_SHORT_LABELS[role]).join(", ")}`
    : `${displayName} — ${shown.map((role) => ROLE_LABELS[role]).join(", ")}`;
}

/** UI_MOCK personas come from the domain fixtures; LOCALNET lists what the API offers. */
export function mockPersonaOptions({ short = false }: { short?: boolean } = {}): PersonaOption[] {
  return PERSONA_IDS.map((id) => {
    const persona = DEMO_PERSONAS[id];
    return { id, orgName: orgName(persona.orgId), label: personaLabel(persona.displayName, persona.roles, { short }) };
  });
}

const ROLE_BY_LABEL = new Map(Object.entries(ROLE_LABELS).map(([role, label]) => [label, role as Role]));

/** An API persona (seeded in LOCALNET) with the same labels as UI_MOCK. */
export function demoPersonaOption(persona: DemoPersona, { short = false }: { short?: boolean } = {}): PersonaOption {
  const roles = persona.roleLabels.map((label) => ROLE_BY_LABEL.get(label)).filter((role): role is Role => role !== undefined);
  const label = roles.length > 0 ? personaLabel(persona.displayName, roles, { short }) : `${persona.displayName} — ${persona.roleLabels.join(", ")}`;
  return { id: persona.id, orgName: persona.org.name, label };
}

function groupByOrg(options: readonly PersonaOption[]): [string, PersonaOption[]][] {
  const groups = new Map<string, PersonaOption[]>();
  for (const option of options) groups.set(option.orgName, [...(groups.get(option.orgName) ?? []), option]);
  return [...groups.entries()];
}

/**
 * Labelled selector for the isolated synthetic demo only (S §8.2): UI_MOCK switches the in-memory
 * persona; LOCALNET creates a demo session through the API when demo sessions are enabled, and
 * renders nothing otherwise. Every switch clears the query cache (lib/collara-client).
 */
export function PersonaSwitcher({ className, onSwitched }: { className?: string; onSwitched?: (personaId: PersonaId) => void }) {
  const id = useId();
  const { mode, client, switchPersona } = useCollara();
  const { me } = useSession();
  const [switching, setSwitching] = useState(false);

  const remote = useQuery({
    queryKey: ["demo", "personas"],
    queryFn: ({ signal }) => client.demo.personas({ signal }),
    enabled: mode === "LOCALNET",
    staleTime: Infinity,
    retry: false,
  });

  const options = mode === "UI_MOCK" ? mockPersonaOptions({ short: true }) : (remote.data ?? []).map((p) => demoPersonaOption(p, { short: true }));
  const selectedLabel = options.find((option) => option.id === me.personaId)?.label;
  if (mode === "LOCALNET" && (remote.isError || options.length === 0)) return null;

  async function change(value: string) {
    const parsed = PersonaIdSchema.safeParse(value);
    if (!parsed.success || parsed.data === me.personaId) return;
    setSwitching(true);
    try {
      await switchPersona(parsed.data);
      onSwitched?.(parsed.data);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[11.5px] text-fg-subtle">
        Demo persona (synthetic)
      </label>
      <select
        id={id}
        value={me.personaId ?? ""}
        title={selectedLabel}
        disabled={switching}
        aria-busy={switching}
        onChange={(event) => void change(event.target.value)}
        className="h-8 w-full min-w-0 rounded-md border border-line-control bg-surface-sunken px-2 text-[12.5px] text-fg outline-none hover:border-line-hover focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
      >
        {me.personaId ? null : (
          <option value="" disabled>
            Choose a demo persona
          </option>
        )}
        {groupByOrg(options).map(([org, group]) => (
          <optgroup key={org} label={org}>
            {group.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
