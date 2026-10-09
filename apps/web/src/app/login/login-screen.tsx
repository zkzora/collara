"use client";

import { errorMessage } from "@collara/api-client";
import { DEFAULT_PERSONA_ID, type PersonaId, type RuntimeMode } from "@collara/domain";
import { useQuery } from "@tanstack/react-query";
import { LogInIcon } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { LoadingState } from "@/components/collara/loading-state";
import { ModeBanner } from "@/components/collara/mode-banner";
import { demoPersonaOption, mockPersonaOptions, type PersonaOption } from "@/components/collara/persona-switcher";
import { Button, buttonVariants } from "@/components/ui/button";
import { CollaraClientProvider, readStoredPersona, useCollara } from "@/lib/collara-client";
import { cn } from "@/lib/utils";

const HEADING = "Sign in to your Collara workspace.";

function PersonaPicker({ options, onContinue }: { options: readonly PersonaOption[]; onContinue: (personaId: PersonaId) => Promise<void> }) {
  const [selected, setSelected] = useState<PersonaId>(() => readStoredPersona() ?? DEFAULT_PERSONA_ID);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onContinue(selected);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  const groups = new Map<string, PersonaOption[]>();
  for (const option of options) groups.set(option.orgName, [...(groups.get(option.orgName) ?? []), option]);

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-[13px] font-medium text-fg">Demo persona (synthetic)</legend>
        {[...groups.entries()].map(([org, group]) => (
          <div key={org} className="flex flex-col gap-1">
            <p className="text-[11.5px] text-fg-subtle">{org}</p>
            {group.map((option) => (
              <label
                key={option.id}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-[13px] transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring",
                  selected === option.id ? "border-line-hover bg-selected text-fg" : "border-line text-fg-muted hover:bg-hover",
                )}
              >
                <input
                  type="radio"
                  name="persona"
                  value={option.id}
                  checked={selected === option.id}
                  onChange={() => setSelected(option.id)}
                  className="size-3.5 accent-[var(--fg)]"
                />
                {option.label}
              </label>
            ))}
          </div>
        ))}
      </fieldset>
      {error ? (
        <p role="alert" className="text-[13px] text-danger-strong">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending} className="h-9 self-start px-4">
        {pending ? "Opening workspace…" : "Continue to workspace"}
      </Button>
    </form>
  );
}

function LoginBody({ mode }: { mode: RuntimeMode }) {
  const router = useRouter();
  const { client, switchPersona } = useCollara();
  const demo = useQuery({
    queryKey: ["demo", "personas"],
    queryFn: ({ signal }) => client.demo.personas({ signal }),
    // DEVNET asks too: the API answers 404 unless the local recording personas are on (recording-personas.ts).
    enabled: mode === "LOCALNET" || mode === "DEVNET",
    staleTime: Infinity,
    retry: false,
  });

  async function enter(personaId: PersonaId) {
    await switchPersona(personaId);
    router.push("/app");
  }

  if (mode === "UI_MOCK") {
    return (
      <>
        <p className="text-[13.5px] leading-relaxed text-fg-muted">
          This build runs as a UI mockup. There is no sign-in: choose a synthetic demo persona to explore the workspace. Data stays in
          this browser tab and nothing is submitted to a ledger.
        </p>
        <PersonaPicker options={mockPersonaOptions()} onContinue={enter} />
      </>
    );
  }

  const remote = (demo.data ?? []).map((p) => demoPersonaOption(p));
  return (
    <>
      <p className="text-[13.5px] leading-relaxed text-fg-muted">Access is by invitation during the pilot.</p>
      {/* A full navigation: the API starts the OIDC flow and sets an HttpOnly session cookie. */}
      <a href="/api/auth/login" className={cn(buttonVariants({ size: "lg" }), "h-9 self-start px-4")}>
        <LogInIcon aria-hidden="true" />
        Connect Canton account
      </a>
      {mode === "DEVNET" ? (
        <p className="text-[12px] leading-relaxed text-fg-subtle">
          First-time DevNet users must complete participant onboarding in the{" "}
          <a href="https://wallet.validator.hackcanton-01.devnet.naas.noders.services" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-fg">
            Canton Wallet
          </a>
          . The wallet provisions the Canton party; Collara still derives roles and mandates from the signed-in organization.
        </p>
      ) : null}
      {demo.isPending ? <LoadingState variant="inline" label="Checking demo sessions…" /> : null}
      {remote.length > 0 ? (
        <div className="mt-2 flex flex-col gap-3 border-t border-line-subtle pt-5">
          <p className="text-[12.5px] text-fg-muted">Demo environment only: open an isolated demo session for a seeded persona.</p>
          <PersonaPicker options={remote} onContinue={enter} />
        </div>
      ) : null}
    </>
  );
}

/** /login: OIDC in LOCALNET/DEVNET (plus demo sessions when the API enables them); persona choice in UI_MOCK. */
export function LoginScreen({ mode }: { mode: RuntimeMode }) {
  return (
    <div data-surface="app" className="flex min-h-dvh flex-col bg-surface-page text-fg">
      <ModeBanner mode={mode} />
      <main className="flex flex-1 items-start justify-center px-4 py-10 xs:items-center">
        <div className="flex w-full max-w-[480px] flex-col gap-5 rounded-xl border border-line bg-surface-1 p-6 xs:p-8">
          <div className="flex items-center gap-2.5">
            <Image src="/brand/collara-mark.png" alt="" width={26} height={26} className="size-[26px]" />
            <span className="text-[15.5px] font-semibold tracking-[-0.01em]">Collara</span>
          </div>
          <h1 className="text-[22px] leading-tight font-medium tracking-[-0.02em]">{HEADING}</h1>
          <CollaraClientProvider mode={mode} fallback={<LoadingState variant="inline" label="Loading…" />}>
            <LoginBody mode={mode} />
          </CollaraClientProvider>
        </div>
      </main>
    </div>
  );
}
