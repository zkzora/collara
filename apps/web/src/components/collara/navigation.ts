import type { NavKey, SavedView } from "@collara/domain";
import {
  BriefcaseIcon,
  ClipboardCheckIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  LockIcon,
  PackageIcon,
  ScrollTextIcon,
  SettingsIcon,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  readonly key: NavKey;
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
  /** Extra path prefixes that keep this item active (detail pages outside its own prefix). */
  readonly alsoActiveFor?: readonly string[];
}

/** Workspace sections (S §8.1). Which ones a viewer sees comes from `Me.navigation` (server). */
export const NAV_ITEMS: Readonly<Record<NavKey, NavItem>> = {
  overview: { key: "overview", label: "Overview", href: "/app", icon: LayoutDashboardIcon },
  cases: { key: "cases", label: "Cases", href: "/app/cases", icon: BriefcaseIcon, alsoActiveFor: ["/app/reviews"] },
  assets: { key: "assets", label: "Assets", href: "/app/assets", icon: PackageIcon },
  verifications: { key: "verifications", label: "Verifications", href: "/app/verifications", icon: ClipboardCheckIcon },
  pledges: { key: "pledges", label: "Pledges", href: "/app/pledges", icon: LockIcon },
  audit: { key: "audit", label: "Audit", href: "/app/audit", icon: ScrollTextIcon, alsoActiveFor: ["/app/reports"] },
  governance: { key: "governance", label: "Governance", href: "/app/governance", icon: LandmarkIcon },
  settings: { key: "settings", label: "Settings", href: "/app/settings", icon: SettingsIcon },
};

export function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/app") return pathname === "/app";
  const within = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  return within(item.href) || (item.alsoActiveFor ?? []).some(within);
}

/** Saved views listed under Cases in the sidebar (prototype order). */
export const SIDEBAR_SAVED_VIEWS: readonly SavedView[] = ["ready-for-review", "needs-evidence", "awaiting-approval", "release-requests"];

export function casesHref(view: SavedView): string {
  return view === "all" ? "/app/cases" : `/app/cases?view=${view}`;
}

export interface Crumb {
  readonly label: string;
  readonly href?: string;
  readonly mono?: boolean;
}

/** Second-level segments that are section tabs, not record ids. */
const SECTION_TABS = new Set(["registry", "proposals", "members", "events", "exports", "team", "integrations"]);

/** Workspace pages without a sidebar entry; labels match their page titles. */
const OTHER_SECTIONS: Readonly<Record<string, string>> = {
  access: "Sharing and access",
  notifications: "Notifications",
};

/** "/app/cases/CL-001/evidence" → Cases / CL-001. Unknown sections fall back to their nav label. */
export function breadcrumbsFor(pathname: string): Crumb[] {
  const [, , section, record] = pathname.split("/");
  if (!section) return [{ label: NAV_ITEMS.overview.label }];
  const item = Object.values(NAV_ITEMS).find((nav) => isNavActive(nav, `/app/${section}`));
  const other = OTHER_SECTIONS[section];
  const root: Crumb = item
    ? { label: item.label, href: item.href }
    : other
      ? { label: other, href: `/app/${section}` }
      : { label: section };
  if (!record || SECTION_TABS.has(record)) return [{ label: root.label }];
  if (record === "new") return [root, { label: "New" }];
  return [root, { label: decodeURIComponent(record), mono: true }];
}
