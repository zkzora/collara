"use client";

// Mutation pattern for every workspace action: one idempotency key per intent (reused when the same
// payload is retried), the command lifecycle polled until it settles, and the scoped query cache
// invalidated so views re-read projected state. UI_MOCK commands are simulated and settle at once.
import { randomId } from "@collara/api-client";
import { COMMAND_COPY, MODE_BANNERS, SIMULATED_COPY, type CommandState, type CommandStatus, type RuntimeMode } from "@collara/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useCollara } from "./collara-client";
import { useSession } from "./session";

const SETTLED_STATES: ReadonlySet<CommandState> = new Set(["PROJECTED", "REJECTED", "FAILED"]);
const POLL_INTERVAL_MS = 1500;
const MAX_POLLS = 40;

/** INFERRED copy (needs approval): in-flight wording that does not mention a ledger in UI_MOCK. */
export const PENDING_COPY: Readonly<Record<RuntimeMode, string>> = {
  UI_MOCK: "Recording in the UI mockup…",
  LOCALNET: COMMAND_COPY.SUBMITTED,
};

const STATE_COPY: Partial<Record<CommandState, string>> = {
  PREPARED: COMMAND_COPY.SUBMITTED,
  SUBMITTED: COMMAND_COPY.SUBMITTED,
  PROJECTION_DELAYED: COMMAND_COPY.PROJECTION_DELAYED,
  UNKNOWN_OUTCOME: COMMAND_COPY.UNKNOWN_OUTCOME,
  REJECTED: COMMAND_COPY.STATE_CHANGED,
  FAILED: COMMAND_COPY.LEDGER_UNAVAILABLE,
};

export function isSettled(command: CommandStatus): boolean {
  return command.simulated || SETTLED_STATES.has(command.state);
}

/** True only for a real ledger commit with ledger evidence (an update id). */
export function isLedgerConfirmed(command: CommandStatus): boolean {
  return (
    !command.simulated &&
    command.target === "LEDGER" &&
    !!command.updateId &&
    (command.state === "COMMITTED" || command.state === "PROJECTED")
  );
}

/**
 * The user-facing line for a command. The server message wins, except that `Confirmed on the
 * ledger.` is shown only for a real ledger commit with an update id: never for a simulated
 * (UI_MOCK) command and never without ledger evidence.
 */
export function commandCopy(command: CommandStatus): string {
  if (isLedgerConfirmed(command)) return COMMAND_COPY.COMMITTED;
  const claimsLedger = command.message.trim() === COMMAND_COPY.COMMITTED;
  if (command.simulated) return claimsLedger || !command.message ? SIMULATED_COPY.RECORDED_IN_MOCKUP : command.message;
  if (command.error?.detail && (command.state === "REJECTED" || command.state === "FAILED")) return command.error.detail;
  if (claimsLedger || !command.message) return STATE_COPY[command.state] ?? COMMAND_COPY.SUBMITTED;
  return command.message;
}

export interface CommandHandle<TVars> {
  /** Runs the action. Errors are kept in `error` (and shown by CommandStatus), never thrown. */
  run(vars: TVars): Promise<boolean>;
  /** Latest known lifecycle state (polled until settled). */
  readonly command: CommandStatus | null;
  readonly isPending: boolean;
  readonly error: unknown;
  /** Clears status; the next run starts a new intent with a new idempotency key. */
  reset(): void;
}

export interface CommandOptions<TVars, TResult> {
  onSuccess?: (result: TResult, vars: TVars) => void;
  /** Toast the outcome after the dialog closes (default true). */
  notify?: boolean;
}

/**
 * Follows a command until it settles (PROJECTED, REJECTED or FAILED): polls GET /api/commands/:id
 * and re-reads the scoped cache once it settles. Simulated commands are already settled.
 */
export function useCommandProgress(command: CommandStatus | null): CommandStatus | null {
  const { client } = useCollara();
  const { keys } = useSession();
  const queryClient = useQueryClient();
  const poll = useQuery({
    queryKey: keys.command(command?.commandId ?? ""),
    queryFn: ({ signal }) => client.commands.get(command?.commandId ?? "", { signal }),
    enabled: !!command && !isSettled(command),
    refetchInterval: (query) => (query.state.dataUpdateCount >= MAX_POLLS ? false : POLL_INTERVAL_MS),
  });
  const live = poll.data && poll.data.commandId === command?.commandId ? poll.data : command;
  const settledId = live && live !== command && isSettled(live) ? live.commandId : null;
  useEffect(() => {
    if (settledId) void queryClient.invalidateQueries({ queryKey: keys.all });
  }, [settledId, queryClient, keys]);
  return live;
}

export function useCommand<TVars, TResult extends { command: CommandStatus }>(
  mutationFn: (vars: TVars, options: { idempotencyKey: string }) => Promise<TResult>,
  { onSuccess, notify = true }: CommandOptions<TVars, TResult> = {},
): CommandHandle<TVars> {
  const { keys } = useSession();
  const queryClient = useQueryClient();
  const intent = useRef<{ key: string; fingerprint: string } | null>(null);
  const [command, setCommand] = useState<CommandStatus | null>(null);

  const mutation = useMutation({
    mutationFn: ({ vars, key }: { vars: TVars; key: string }) => mutationFn(vars, { idempotencyKey: key }),
    onSuccess: (result, { vars }) => {
      intent.current = null;
      setCommand(result.command);
      void queryClient.invalidateQueries({ queryKey: keys.all });
      if (notify) announce(result.command);
      onSuccess?.(result, vars);
    },
  });
  const live = useCommandProgress(command);

  const { mutateAsync, reset: resetMutation } = mutation;
  const run = useCallback(
    async (vars: TVars) => {
      const fingerprint = JSON.stringify(vars ?? null);
      // Same payload after a failure → same key (safe retry); a changed payload is a new intent.
      if (!intent.current || intent.current.fingerprint !== fingerprint) intent.current = { key: randomId(), fingerprint };
      setCommand(null);
      try {
        await mutateAsync({ vars, key: intent.current.key });
        return true;
      } catch {
        return false;
      }
    },
    [mutateAsync],
  );

  const reset = useCallback(() => {
    intent.current = null;
    setCommand(null);
    resetMutation();
  }, [resetMutation]);

  return { run, command: live, isPending: mutation.isPending, error: mutation.error, reset };
}

function announce(command: CommandStatus): void {
  const message = commandCopy(command);
  // A simulated command is labelled with the UI_MOCK banner whatever produced it.
  if (command.simulated) toast(message, { description: MODE_BANNERS.UI_MOCK });
  else if (command.state === "REJECTED" || command.state === "FAILED") toast.error(message);
  else if (isLedgerConfirmed(command)) toast.success(message);
  else toast(message);
}
