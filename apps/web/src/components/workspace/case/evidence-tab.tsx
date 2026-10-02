"use client";

import { errorMessage } from "@collara/api-client";
import { BOUNDARY_COPY, type EvidenceDocument } from "@collara/domain";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorState } from "@/components/collara/error-state";
import { EvidenceList } from "@/components/collara/evidence-list";
import { LoadingState } from "@/components/collara/loading-state";
import { useCollara } from "@/lib/collara-client";
import { useCaseEvidence } from "@/lib/queries";
import { useCaseWorkspace } from "./case-context";

/** Opens a short-lived link issued after the server-side access check (never a stored URL). */
function openDownload(url: string, fileName: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener";
  // data: links (UI_MOCK placeholders) cannot be opened as a page; save them instead.
  if (url.startsWith("data:")) anchor.download = fileName;
  else anchor.target = "_blank";
  anchor.click();
}

export function EvidenceTab() {
  const { detail } = useCaseWorkspace();
  const { client } = useCollara();
  const evidence = useCaseEvidence(detail.caseId);
  const [downloading, setDownloading] = useState<string | null>(null);

  async function download(doc: EvidenceDocument) {
    setDownloading(doc.id);
    try {
      const link = await client.evidence.download(doc.id);
      openDownload(link.url, `${doc.id}-v${doc.version}`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {evidence.isError ? (
        <ErrorState error={evidence.error} onRetry={() => void evidence.refetch()} />
      ) : evidence.isPending ? (
        <LoadingState variant="table" rows={5} label="Loading evidence…" />
      ) : (
        <EvidenceList
          documents={evidence.data}
          caption={`Evidence documents · ${detail.caseId}${detail.references.package ? ` · ${detail.references.package.ref} v${detail.references.package.version}` : ""}`}
          onDownload={(doc) => void download(doc)}
          downloadingId={downloading}
        />
      )}
      <p className="text-[12px] leading-relaxed text-fg-subtle">{BOUNDARY_COPY.HASH_MATCH}</p>
      <p className="text-[12px] leading-relaxed text-fg-subtle">{BOUNDARY_COPY.NOT_SCANNED}</p>
    </div>
  );
}
