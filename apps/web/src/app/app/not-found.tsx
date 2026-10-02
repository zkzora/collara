import Link from "next/link";
import { ErrorState } from "@/components/collara/error-state";
import { buttonVariants } from "@/components/ui/button";

export default function WorkspaceNotFound() {
  return (
    <ErrorState
      kind="not-found"
      action={
        <Link href="/app" className={buttonVariants({ variant: "outline" })}>
          Back to overview
        </Link>
      }
    />
  );
}
