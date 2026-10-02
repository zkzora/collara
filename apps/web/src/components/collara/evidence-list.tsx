import type { EvidenceDocument } from "@collara/domain";
import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatUtcDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./status-badge";

/**
 * Evidence documents the viewer may see (server-filtered). Integrity is the hash check against the
 * committed reference, not a statement that a document is genuine (see BOUNDARY_COPY.HASH_MATCH).
 * Downloads go through `onDownload`, which asks the server for a short-lived link.
 */
export function EvidenceList({
  documents,
  caption,
  showReview = true,
  onDownload,
  downloadingId,
  className,
}: {
  documents: readonly EvidenceDocument[];
  caption: string;
  showReview?: boolean;
  onDownload?: (document: EvidenceDocument) => void;
  downloadingId?: string | null;
  className?: string;
}) {
  const head = "px-3.5 py-2.5 text-[12px] font-medium whitespace-nowrap text-fg-muted";
  return (
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className={cn("relative overflow-x-auto rounded-lg border border-line bg-surface-1 outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
    >
      <table className="w-full min-w-[900px] border-collapse text-left text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={head}>Document</th>
            <th scope="col" className={head}>Source</th>
            <th scope="col" className={head}>Version</th>
            <th scope="col" className={head}>Uploaded</th>
            <th scope="col" className={head}>Integrity</th>
            {showReview ? <th scope="col" className={head}>Review</th> : null}
            <th scope="col" className={head}>Sharing scope</th>
            {onDownload ? (
              <th scope="col" className={head}>
                <span className="sr-only">Actions</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => (
            <tr key={doc.id} className="border-b border-line-subtle last:border-b-0">
              <td className="px-3.5 py-3">
                <p className="text-fg">{doc.title}</p>
                <p className="text-[12px] text-fg-subtle">
                  <span className="font-mono">{doc.id}</span> · {doc.mediaSummary}
                </p>
              </td>
              <td className="px-3.5 py-3">
                <p>{doc.source.name}</p>
                <p className="text-[12px] text-fg-subtle">{doc.uploadedBy}</p>
              </td>
              <td className="px-3.5 py-3 font-mono whitespace-nowrap">v{doc.version}</td>
              <td className="px-3.5 py-3 font-mono text-[12px] whitespace-nowrap text-fg-muted">
                <time dateTime={doc.uploadedAt}>{formatUtcDate(doc.uploadedAt)}</time>
              </td>
              <td className="px-3.5 py-3 whitespace-nowrap">
                <StatusBadge status={doc.integrity.state} />
              </td>
              {showReview ? (
                <td className="px-3.5 py-3 whitespace-nowrap">
                  <StatusBadge status={doc.review} />
                </td>
              ) : null}
              <td className="px-3.5 py-3 text-[12.5px] text-fg-muted">{doc.sharingScope.length ? doc.sharingScope.join(" · ") : "—"}</td>
              {onDownload ? (
                <td className="px-3.5 py-3 text-right">
                  {doc.canDownload ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={downloadingId === doc.id}
                      onClick={() => onDownload(doc)}
                      aria-label={`Download ${doc.title} v${doc.version}`}
                    >
                      <DownloadIcon aria-hidden="true" />
                      Download
                    </Button>
                  ) : (
                    <span className="text-[12px] text-fg-subtle">
                      <span aria-hidden="true">—</span>
                      <span className="sr-only">Download not permitted</span>
                    </span>
                  )}
                </td>
              ) : null}
            </tr>
          ))}
          {documents.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-4 py-9 text-center text-[13.5px] text-fg-muted">
                No evidence documents are visible to your organization.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
