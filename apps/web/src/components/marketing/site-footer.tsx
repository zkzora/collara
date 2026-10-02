import Link from "next/link";
import { isPublicDemoLive } from "./runtime";
import { BrandLink, Container } from "./primitives";

const FOOTER_DISCLAIMER =
  "Collara is in development. It is not a lender, custodian, legal lien registry, or provider of guaranteed financing.";

/** Footer per synthesis §1.2.1. `Demo` appears only while the public demo gate is on (CR-04). */
export async function SiteFooter({ note }: { note?: string }) {
  const demoLive = await isPublicDemoLive();
  const columns: { title: string; links: { label: string; href: string }[] }[] = [
    {
      title: "Product",
      links: [
        { label: "Product", href: "/#product" },
        { label: "Workflow", href: "/#workflow" },
        { label: "For Lenders", href: "/#for-lenders" },
        ...(demoLive ? [{ label: "Demo", href: "/demo" }] : []),
      ],
    },
    {
      title: "Resources",
      links: [
        { label: "Docs", href: "/docs" },
        { label: "Why Canton", href: "/#why-canton" },
      ],
    },
    { title: "Contact", links: [{ label: "Request a pilot", href: "/pilot" }] },
    {
      title: "Legal",
      links: [
        { label: "Privacy", href: "/privacy" },
        { label: "Terms", href: "/terms" },
      ],
    },
  ];

  return (
    <footer className="border-t border-white/7 pt-14 pb-10">
      <Container>
        <div className="grid gap-8 xs:grid-cols-2 site:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]">
          <div className="flex max-w-[300px] flex-col gap-3.5">
            <BrandLink size="footer" />
            <p className="m-0 text-[14px] leading-[1.6] text-fg-muted">
              Private equipment evidence and collateral workflows. Starting with used CNC financing.
            </p>
          </div>
          {columns.map((column) => (
            <div key={column.title} className="flex flex-col gap-2.5 text-[14px]">
              <h2 className="mb-1 font-mono text-[11px] font-normal tracking-[0.08em] text-fg-subtle uppercase">
                {column.title}
              </h2>
              <ul className="flex flex-col gap-2.5">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="rounded-sm text-fg-muted hover:text-fg">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-12 border-t border-white/7 pt-6 text-[13px] leading-[1.6] text-fg-subtle">
          {note ? `${FOOTER_DISCLAIMER} ${note}` : FOOTER_DISCLAIMER}
        </p>
      </Container>
    </footer>
  );
}
