// Options every workflow route module receives (see index.ts).
import type { AppServices } from "../../app";
import type { CollaraMode } from "../../config";
import type { WorkflowServices } from "../../workflow";

export interface WorkflowRouteOptions {
  /** db, commands, projections (read model), storage, ledger gateway, clock. */
  readonly services: AppServices;
  /** Ledger write path: runner (run/sequence), registrar service, ACS reads, actor resolution. */
  readonly workflow: WorkflowServices;
  readonly mode: CollaraMode;
}
