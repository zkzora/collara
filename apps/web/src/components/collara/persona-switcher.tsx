"use client";

import { errorMessage } from "@collara/api-client";
import { DEMO_PERSONAS, orgName, PERSONA_IDS, PersonaIdSchema, ROLE_LABELS, ROLE_SHORT_LABELS, type DemoPersona, type PersonaId } from "@collara/domain";
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

/** UI_MOCK personas come from the domain fixtures; LOCALNET lists what the API offers. */
export function mockPersonaOptions({ short = false }: { short?: boolean } = {}): PersonaOption[] {
  return PERSONA_IDS.map((id) => {
    const persona = DEMO_PERSONAS[id];
    const roles = persona.roles.filter((role) => role !== "GOVERNANCE_MEMBER");
    const label = short
      ? `${persona.displayName} · ${roles.map((role) => ROLE_SHORT_LABELS[role]).join(", ")}`
      : `${persona.displayName} — ${roles.map((role) => ROLE_LABELS[role]).join(", ")}`;
    return { id, orgName: orgName(persona.orgId), label };
  });
}

function fromDemoPersona(persona: DemoPersona): PersonaOption {
  return { id: persona.id, orgName: persona.org.name, label: `${persona.displayName} — ${persona.roleLabels.join(", ")}` };
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

  const options = mode === "UI_MOCK" ? mockPersonaOptions({ short: true }) : (remote.data ?? []).map(fromDemoPersona);
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
