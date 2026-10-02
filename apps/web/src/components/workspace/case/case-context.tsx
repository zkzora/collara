"use client";

import type { CaseDetail, CommandStatus, Me } from "@collara/domain";
import { createContext, useContext } from "react";

export interface CaseWorkspaceValue {
  readonly detail: CaseDetail;
  /** Shows a command's lifecycle under the case header (it outlives the dialog and its button). */
  trackCommand(command: CommandStatus): void;
}

export const CaseWorkspaceContext = createContext<CaseWorkspaceValue | null>(null);

export function useCaseWorkspace(): CaseWorkspaceValue {
  const value = useContext(CaseWorkspaceContext);
  if (!value) throw new Error("useCaseWorkspace must be used inside the case workspace layout.");
  return value;
}

export function useOptionalCaseWorkspace(): CaseWorkspaceValue | null {
  return useContext(CaseWorkspaceContext);
}

/** "Demo Lender A · Lender Approver" for the confirmation facts box. */
export function actingParty(me: Me): string {
  return `${me.org.name} · ${me.roleLabels[0] ?? me.user.displayName}`;
}
