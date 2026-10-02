// Public navigation (synthesis §1.2.1, approved labels verbatim). There is no top-nav Demo item.

export interface NavLink {
  readonly label: string;
  readonly href: string;
  /** Page key for aria-current. */
  readonly page?: MarketingPageKey;
}

export type MarketingPageKey = "home" | "docs" | "pilot" | "privacy" | "terms" | "demo";

export const PRIMARY_NAV: readonly NavLink[] = [
  { label: "Product", href: "/#product" },
  { label: "Workflow", href: "/#workflow" },
  { label: "For Lenders", href: "/#for-lenders" },
  { label: "Why Canton", href: "/#why-canton" },
  { label: "Docs", href: "/docs", page: "docs" },
];

export const SIGN_IN: NavLink = { label: "Sign in", href: "/login" };
export const REQUEST_PILOT: NavLink = { label: "Request a pilot", href: "/pilot", page: "pilot" };
