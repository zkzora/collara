import { errorMessage, isApiError } from "@collara/api-client";
import { COMMAND_COPY, ERROR_COPY } from "@collara/domain";
import { FileQuestionIcon, KeyRoundIcon, LockIcon, RefreshCwIcon, TriangleAlertIcon, WifiOffIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ErrorKind = "unavailable" | "forbidden" | "expired-session" | "network-error" | "not-found" | "unknown";

/**
 * Titles for states that have no approved copy yet are INFERRED (need copy approval). Unavailable
 * uses the approved copy and never says whether the record exists.
 */
const TITLES: Readonly<Record<ErrorKind, string>> = {
  unavailable: ERROR_COPY.UNAVAILABLE,
  forbidden: "This action is not permitted for your role.",
  "expired-session": "Your session has ended.",
  "network-error": "The Collara service could not be reached.",
  "not-found": "This page does not exist.",
  unknown: "Something went wrong while loading this view.",
};

export function errorKind(error: unknown): ErrorKind {
  if (!isApiError(error)) return "unknown";
  switch (error.code) {
    case "unavailable":
      return "unavailable";
    case "forbidden":
      return "forbidden";
    case "unauthenticated":
      return "expired-session";
    case "network_error":
    case "upstream_unavailable":
    case "ledger_unavailable":
    case "rate_limited":
      return "network-error";
    default:
      return "unknown";
  }
}

function detailFor(kind: ErrorKind, error: unknown): string | null {
  switch (kind) {
    case "unavailable":
    case "not-found":
      return null;
    case "forbidden":
      return errorMessage(error ?? null) === ERROR_COPY.UNAVAILABLE ? ERROR_COPY.FORBIDDEN : errorMessage(error);
    case "expired-session":
      return "Sign in again to continue.";
    case "network-error":
      return isApiError(error) && error.code === "ledger_unavailable"
        ? COMMAND_COPY.LEDGER_UNAVAILABLE
        : "Check your connection and try again. Nothing was changed.";
    case "unknown":
      return isApiError(error) ? errorMessage(error) : null;
  }
}

/** Page or panel level failure: forbidden, expired session, network error, unavailable, not found. */
export function ErrorState({
  error,
  kind: kindOverride,
  onRetry,
  action,
  className,
}: {
  error?: unknown;
  kind?: ErrorKind;
  onRetry?: () => void;
  /** Extra navigation, e.g. a link back to the queue. */
  action?: ReactNode;
  className?: string;
}) {
  const kind = kindOverride ?? errorKind(error);
  const Icon = {
    unavailable: LockIcon,
    forbidden: LockIcon,
    "expired-session": KeyRoundIcon,
    "network-error": WifiOffIcon,
    "not-found": FileQuestionIcon,
    unknown: TriangleAlertIcon,
  }[kind];
  const detail = detailFor(kind, error);
  const retryable = kind === "network-error" || kind === "unknown";
  return (
    <div
      role="alert"
      data-error-kind={kind}
      className={cn("flex flex-col items-start gap-3 rounded-lg border border-line bg-surface-1 px-5 py-6", className)}
    >
      <Icon aria-hidden="true" className="size-5 text-fg-subtle" />
      <div className="flex flex-col gap-1">
        <h2 className="text-[15px] font-medium text-fg">{TITLES[kind]}</h2>
        {detail ? <p className="max-w-[65ch] text-[13.5px] text-fg-muted">{detail}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {kind === "expired-session" ? (
          <Link href="/login" className={buttonVariants()}>
            Sign in
          </Link>
        ) : null}
        {retryable && onRetry ? (
          <Button variant="outline" onClick={onRetry}>
            <RefreshCwIcon aria-hidden="true" />
            Try again
          </Button>
        ) : null}
        {action}
      </div>
    </div>
  );
}
