// Placeholder until the reports builder implements export generation (same file and export name).
import type { ExportJobHandler } from "../registry";

export const exportJobHandler: ExportJobHandler = async () => ({
  state: "FAILED",
  errorMessage: "Export generation not implemented",
});
