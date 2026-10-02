"use client";

import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useSession } from "@/lib/session";
import { ModeBanner } from "./mode-banner";
import { Sidebar } from "./sidebar";
import { WorkspaceHeader } from "./workspace-header";

/**
 * Workspace frame (prototype shell, L26–L84): mode banner, 232px sidebar (a focus-trapped drawer
 * below 900px), 52px header and a scrolling <main>. Uses 100dvh so mobile browser chrome fits.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { me, mode } = useSession();
  const pathname = usePathname();
  const [drawer, setDrawer] = useState<{ open: boolean; path: string }>({ open: false, path: pathname });
  // Navigating closes the drawer (derived instead of an effect).
  const drawerOpen = drawer.open && drawer.path === pathname;
  const setDrawerOpen = (open: boolean) => setDrawer({ open, path: pathname });

  return (
    <div data-surface="app" className="flex h-dvh flex-col bg-surface-page text-[14px] text-fg">
      <a
        href="#workspace-main"
        className="sr-only z-50 rounded-md bg-fg px-3 py-2 text-on-primary focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <ModeBanner mode={mode} viewingAs={`${me.org.name} · ${me.roleLabels[0] ?? me.user.displayName}`} />
      <div className="flex min-h-0 flex-1">
        <aside aria-label="Sidebar" className="hidden w-[232px] flex-none border-r border-line-subtle app:block">
          <Sidebar />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <WorkspaceHeader menuOpen={drawerOpen} onMenuToggle={() => setDrawerOpen(!drawerOpen)} />
          <main id="workspace-main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
            <div className="mx-auto w-full max-w-[1240px] px-4 pt-4 pb-10 app:mx-0 app:px-7 app:pt-6">{children}</div>
          </main>
        </div>
      </div>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent id="workspace-drawer" side="left" className="w-[280px] max-w-[85vw] gap-0 border-line bg-surface-nav p-0 app:hidden">
          <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
          <SheetDescription className="sr-only">Sections, saved views and the demo persona.</SheetDescription>
          <Sidebar onNavigate={() => setDrawerOpen(false)} showSync />
        </SheetContent>
      </Sheet>
    </div>
  );
}
