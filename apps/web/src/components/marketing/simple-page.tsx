import type { ReactNode } from "react";
import { Container, Eyebrow } from "./primitives";

/** Narrow text page (legal placeholders, demo gate). */
export function SimplePage({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <Container className="pt-[clamp(56px,7vw,96px)] pb-[clamp(80px,10vw,140px)]">
      <div className="flex max-w-[680px] flex-col">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-4 text-[clamp(28px,3.6vw,46px)] leading-[1.08] font-medium tracking-[-0.03em] text-balance">
          {title}
        </h1>
        <div className="mt-6 flex flex-col gap-4 text-[17px] leading-[1.6] text-pretty text-fg-muted">{children}</div>
      </div>
    </Container>
  );
}
