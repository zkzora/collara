"use client";

import { PlusIcon } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { newCaseHref } from "./queries";

/** `Create case` (S §9.2 / §9.6). Render it only where the server allows it (session roles or `allowedActions`). */
export function CreateCaseLink({ assetRef, variant = "default", className }: { assetRef?: string; variant?: "default" | "outline"; className?: string }) {
  return (
    <Link href={newCaseHref(assetRef)} className={cn(buttonVariants({ variant }), className)}>
      <PlusIcon aria-hidden="true" />
      Create case
    </Link>
  );
}
