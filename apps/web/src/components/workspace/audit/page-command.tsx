"use client";

import type { CaseDetail, CommandStatus as CommandStatusValue } from "@collara/domain";
import { createContext, useContext, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { CommandStatus } from "@/components/collara/command-status";
import { useCommandProgress } from "@/lib/commands";
import { useSession } from "@/lib/session";
import { ActionDialog } from "../action-dialog";
import { CaseWorkspaceContext } from "../case/case-context";

interface PageCommandValue {
  readonly command: CommandStatusValue | null;
  track(command: CommandStatusValue): void;
}

const PageCommandContext = createContext<PageCommandValue | null>(null);

/**
 * Keeps the latest action's command lifecycle visible on a record page (the toast is transient).
 * With a case `detail`, it also provides the case workspace context, so Part A dialogs that report
 * to the case header (e.g. AssessmentDialog) report here.
 */
export function PageCommands({ detail, children }: { detail?: CaseDetail | null; children: ReactNode }) {
  const [command, setCommand] = useState<CommandStatusValue | null>(null);
  const value = useMemo<PageCommandValue>(() => ({ command, track: setCommand }), [command]);
  const workspace = useMemo(() => (detail ? { detail, trackCommand: setCommand } : null), [detail]);
  const content = <PageCommandContext value={value}>{children}</PageCommandContext>;
  return workspace ? <CaseWorkspaceContext value={workspace}>{content}</CaseWorkspaceContext> : content;
}

export function usePageCommand(): ((command: CommandStatusValue) => void) | null {
  return useContext(PageCommandContext)?.track ?? null;
}

/** Inline lifecycle of the latest tracked command (polled until it settles). */
export function PageCommandStatus({ className }: { className?: string }) {
  const { mode } = useSession();
  const live = useCommandProgress(useContext(PageCommandContext)?.command ?? null);
  return <CommandStatus mode={mode} command={live} className={className} />;
}

/** ActionDialog that also reports its command to the surrounding PageCommands. */
export function TrackedActionDialog<TPayload>(props: ComponentProps<typeof ActionDialog<TPayload>>) {
  const track = usePageCommand();
  const { onSuccess } = props;
  return (
    <ActionDialog
      {...props}
      onSuccess={(command) => {
        track?.(command);
        onSuccess?.(command);
      }}
    />
  );
}
