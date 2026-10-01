# Migration map — HTML prototype → Next.js application

The prototype in `Collara Website/` is preserved unchanged (baseline commit). It was rendered by a generated "dc-runtime" (`support.js`): `<x-dc>` templates with inline styles, a `data-dc-script` block holding all state, `style-hover` attributes and global handlers. Nothing is reused at runtime; each page is re-implemented as React components and real routes.

Detailed reconstruction notes: `docs/_research/proto-landing-docs.md` (Landing, Docs, Mobile preview) and `docs/_research/proto-dashboard.md` (workspace). Reconciled routes and copy precedence: `docs/_research/synthesis.md` §1.

## Pages and routes

| Prototype | Target route(s) | Rendering | Notes |
|---|---|---|---|
| `Collara Landing.dc.html` | `/` (`app/(marketing)/page.tsx`) | Server Components; mobile menu + FAQ accordion as small Client Components (or native `<details>`) | Approved copy verbatim; pre-demo CTA variant by default; principal corrected to USD 100,000.00; `Demo data — LocalNet` chip retired. `Sign in` → `/login`. |
| Landing `#pilot` section | `/pilot` (form) + landing section linking to it | Server page + Client form (RHF + Zod) | Fields and copy from system spec §6.1. Success only after `POST /api/pilot-requests` persists (UI_MOCK: simulated, labelled). |
| `Collara Docs.dc.html` | `/docs` | Server Components | Anchors `#overview #workflow #roles #demo #governance #setup` kept stable. Capability table driven by one typed `capabilityStatus` config. Permission matrix rendered from `@collara/domain` policy. `#setup` lists only verified commands. |
| `Collara Mobile Preview.dc.html` | — (dev aid only) | — | Replaced by responsive layouts verified with Playwright at 390×844 and desktop. |
| Footer legal links | `/privacy`, `/terms` | Server | Legal text is a blocking business input; pages state that the policy is pending legal review rather than inventing text. |
| Header `Sign in` | `/login` | Server + Client | OIDC (Keycloak) in LOCALNET; demo persona sessions only when enabled. |
| `Collara Dashboard.dc.html` (single page, `screen` state) | `/app/**` | Dynamic, `private, no-store`; Client Components with TanStack Query | Split into real routes below. Demo "tweaks" become a labelled demo persona switcher. |

## Dashboard screens → workspace routes

| Prototype `screen` | Route | Primary components |
|---|---|---|
| `overview` | `/app` | `PageHeader`, action queue, per-currency recorded totals (or `Not available`), `CaseTable` (compact) |
| `cases` | `/app/cases?view=…` | `CaseTable` (TanStack Table), saved views, server-scoped counts |
| `case` (CL-001) | `/app/cases/[caseId]/{summary,evidence,verification,sharing,review,proposal,pledge,activity}` | Case header with next actor / next action / blockers / data source / last sync; `EvidenceList`, `CaseTimeline`, `PermissionNotice`, `CommandStatus`, `ConfirmationDialog` |
| `asset` | `/app/assets/[assetId]/{overview,evidence,verification,cases,activity}` (+ `/app/assets`, `/app/assets/new`) | Passport facts (`<dl>`), evidence, attestation validity, control status |
| `review` | `/app/reviews/[reviewId]` (+ `/app/reviews`) | Assessment form, decision (approver only), shared feedback vs internal notes |
| (proposal inside review/case) | `/app/cases/[caseId]/proposal` | Proposal draft/issue (lender), accept/decline exact version (borrower), activation authorization |
| `pledge` | `/app/pledges/[pledgeId]` (+ `/app/pledges`) | Lock facts, release request (borrower), authorize/reject (designated lender approver) |
| `audit` | `/app/audit/{events,exports}` | Scoped event table, export jobs with cutoff/watermark/checksum |
| `gov`, `govp` | `/app/governance/{registry,proposals,members}`, `/app/governance/[proposalId]` | Verifier registry, governed actions with real confirmation counts and integration-status badge |
| Confirmation dialogs (`mk()`) | `ConfirmationDialog` (Base UI dialog) | Focus-trapped, labelled, consequence copy verbatim |
| Toast / `commit()` | `CommandStatus` | Reflects the real command lifecycle; UI_MOCK never says "Confirmed on the ledger." |
| Demo banner | `ModeBanner` | Mode-driven text (`UI_MOCK` / `LOCALNET`) |

## Interaction changes

- Global handlers, `style-hover` and DOM mutation → React state, event props and CSS `:hover`/`:focus-visible`.
- Clickable `div` rows → links or buttons; tabs → accessible tab components bound to URL segments; dialogs → focus-trapped modal primitives.
- Inline styles → Tailwind utilities over CSS-variable tokens (`marketing` and `app` scopes). Contrast raised to WCAG AA where the prototype failed (synthesis CR-34).
- Fixture state (`queueAll`, `docs`, `checks`, `ev(...)`, governance fixtures) → `@collara/domain` fixtures with seed-relative dates (no hard-coded expiries).
- Role-based visibility implemented in templates → server-computed `allowedActions` and server-side field omission (LOCALNET), mirrored by the same presenter functions in UI_MOCK.

## Assets

- `assets/collara-mark.png` (white mark) → `apps/web/public/brand/collara-mark.png` plus derived favicon/app icons. An SVG redraw is recommended (AI-generated source; see synthesis R-18).
- Fonts: Geist + Red Hat Mono via `next/font/google` (self-hosted at build time).
