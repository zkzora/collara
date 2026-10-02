import { dataSources, type DataSource } from "@collara/domain";
import { StatusBadge } from "./status-badge";

/** `Ledger-committed` vs `Application record` provenance of what the page shows (MP L93). */
export function DataSourceBadge({ source, className }: { source: DataSource; className?: string }) {
  return (
    <span className={className}>
      <span className="text-fg-subtle">Data source · </span>
      <StatusBadge status={dataSources.badge(source)} />
    </span>
  );
}
