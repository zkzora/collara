# Prototype reconstruction spec — Collara Dashboard (lender workspace)

Source: `C:\Collara\Collara Website\Collara Dashboard.dc.html` (1,330 lines, 182,204 bytes, read in full), rendered by `C:\Collara\Collara Website\support.js` (generated "dc-runtime", 1,911 lines, skimmed for template semantics). Related: `Collara Mobile Preview.dc.html` (frames this page at 390×844 and labels it **"Workspace · /app"**), logo `assets/collara-mark.png`.
Written 2026-10-01 for the Next.js/React rebuild. Authoritative product brief: `C:\Users\Pongo\Documents\Codex\2026-10-01\oke\outputs\collara-full-stack-master-prompt.md`.

**Convention:** Everything below was read directly from source unless tagged **(INFERRED)**. Line numbers (`L123`) refer to `Collara Dashboard.dc.html`. Copy in `"quotes"` or code spans is verbatim. `·` (U+00B7 middle dot), `→` (U+2192), `—` (em dash) and `…` (U+2026) are literal characters used throughout the copy; keep them.

---

## 0. How the prototype works (runtime and template syntax)

The file is one `<x-dc>` template (L9–L1049) plus one `<script type="text/x-dc" data-dc-script data-props="…">` logic block (L1050–L1328). `support.js` loads React 18.3.1 UMD and @babel/standalone 7.29.0 from unpkg (support.js L1143–L1147), compiles the template into React elements, and renders it against `{...props, ...logic.renderVals()}` (support.js ~L1085).

| Syntax | Meaning (support.js reference) | React rebuild equivalent |
|---|---|---|
| `{{ a.b.c }}` in text or attribute | Dotted-path lookup in the render values. Also supports `===`/`!==`/`==`/`!=` and parentheses (`resolve`, L205–225). An unresolved path renders **empty** and logs a console warning (L569–610) | JSX expression |
| `<sc-if value="{{ x }}">…</sc-if>` | Renders children if truthy. No else branch is used in this file (L646–660) | `{x && …}` |
| `<sc-for list="{{ xs }}" as="n">…</sc-for>` | Maps an array. `$index` is also available (L611–645) | `xs.map(n => …)` |
| `hint-placeholder-count` / `hint-placeholder-val` | Only for streaming skeleton placeholders. **Ignore** | — |
| `style-hover="css"` / `style-focus="css"` | Generates a class with a `:hover`/`:focus` rule. Declarations get `!important` (`collectProps` L428–430, `createPseudoSheet` L1567–1589, `importantify` L1542) | Tailwind `hover:`/`focus-visible:` |
| `onClick="{{ fn }}"` | Binds a React event handler. Lower-case `on*` attributes map through `EVENT_MAP` (L317–358) | `onClick={fn}` |
| `defaultValue="…"` (camelCase attribute) | Kept through `sc-camel-` encoding (L297, L366–383), so it is an **uncontrolled** React input | RHF-controlled field |
| `<helmet>` | Hoisted into `<head>`: title, font links, global `<style>` (L377–378, helmet manager L1366+) | `app/layout.tsx` metadata + globals.css |
| `data-props` JSON | Declares editor "tweaks" (props) with type, default, options and section. They are edited in the dc editor, **not** on the page (see §2.6) | Demo-mode controls or seeded sessions |
| `class Component extends DCLogic` with `state`, `setState`, `renderVals()` | Class-like logic object. `setState(update, cb)` merges shallowly, and the wrapper re-renders (L817–841, L967–972) | Hooks + TanStack Query |
| `data-screen-label="…"` | Editor label for each screen. No runtime effect **(INFERRED)** | Route/page name |

Routing is not real: one `state.screen` string switches between 9 `sc-if` blocks. There is no URL, history or deep link.

---

## 1. Design tokens

### 1.1 Color — surfaces, text and borders (hex as authored; usage counts from a grep of the file)

| Proposed token | Value | Uses | Where |
|---|---|---|---|
| `--bg-app` | `#101116` | 3 | `body` background (L15), shell root (L26), header bg (L61) |
| `--bg-sidebar` | `#0C0D11` | 16 | Sidebar (L34), mobile drawer (L76), search-input bg (L68, L143). Also the **text color of primary buttons** |
| `--bg-surface` | `#16171D` | 69 | Cards, tiles, tables, modal (L1028), `select option` bg (L20) |
| `--bg-surface-raised` | `#1C1D24` | 1 | Toast (L1046) |
| `--bg-inset` | `#0F1014` | 16 | Inputs, textareas, notice boxes, limitation boxes, the modal facts box |
| `--bg-switcher` | `#12131A` (hover `#171821`) | 1+1 | Org switcher button (L36) |
| `--bg-avatar` | `#1E1F27` | 1 | Header avatar circle (L71) |
| `--text-primary` | `#F4F5F7` | 102 | Body text, active nav/tab, primary-button bg, active tab underline |
| `--text-strong` | `#FFFFFF` | 13 | `a:hover` color, hover bg of primary buttons, text on the danger confirm button |
| `--text-secondary` | `#9A9CA6` | 211 | Subtitles, table headers, inactive nav/tab, labels |
| `--text-tertiary` | `#676A75` | 168 | Meta lines, footnotes, key labels in key/value grids, placeholder (L19), disabled text. **Fails AA for small text (3.32:1 on surface)** |
| `--text-quaternary` | `#4E515B` | 2 | Sidebar "Saved views" heading (L45), breadcrumb `/` (L65). **Fails AA (2.45:1)** |
| `--text-quote` | `#C9CBD3` | 2 | Governance rationale (L990), SIMULATION banner body (L818) |
| `--status-neutral` | `#6F727D` | 2 | `C.neu` (L1053), nav "Audit" dot (unused) |
| (unused) | `#B5B5BF` | 1 | Nav "Pledges" dot color (L1289), never rendered |
| `--border-hairline` | `rgba(255,255,255,.08)` | 146 | Card borders, table-header bottom border, search box, tab-row bottom border |
| `--border-row` | `rgba(255,255,255,.06)` | 90 | Table row dividers, inset box borders |
| `--border-subtle` / `--hover-bg` | `rgba(255,255,255,.05)` | 42 | List-row dividers inside cards, hover bg of outline/ghost buttons |
| `--border-shell` / `--nav-active-bg` | `rgba(255,255,255,.07)` | 15 | Sidebar/header dividers, card header dividers, active nav item bg |
| `--border-control` | `rgba(255,255,255,.10)` | 22 | Inputs, filter chips, network chip, ⌘K kbd, notifications/menu buttons |
| `--border-strong` | `rgba(255,255,255,.12)` | 22 | Outline buttons, status pills, modal border (.1), toast border |
| `--border-active-filter` | `rgba(255,255,255,.14)` + bg `.04` | 1+1 | Active filter chip "Case: CL-001 ▾" (L747) |
| `--border-hover` | `rgba(255,255,255,.16)` | 9 | Hover border of stat tiles |
| `--border-focus` | `rgba(255,255,255,.30)` | 5 | `style-focus` border of inputs |
| `--row-hover` | `rgba(255,255,255,.03)` | 11 | Table/list row hover |
| `--nav-hover` | `rgba(255,255,255,.06)` | — | Hover bg of nav items (L42) |
| overlay | `rgba(0,0,0,.6)` drawer · `rgba(0,0,0,.62)` modal | | L75, L1027 |

### 1.2 Color — accents and status (OKLCH as authored, with an approximate sRGB hex computed for fallback)

The script defines one status palette (L1053):
```js
C = { ok: 'oklch(74% 0.13 155)', pend: 'oklch(82% 0.12 75)', neu: '#6F727D', bad: 'oklch(70% 0.17 25)', info: 'oklch(74% 0.1 250)' };
chip(l, k) { return { l, c: this.C[k] || this.C.neu, k }; }
```

| Role | OKLCH | ≈ hex | Alpha variants used | Used for |
|---|---|---|---|---|
| ok / success (green) | `oklch(74% 0.13 155)` | `#5EC386` | — | `C.ok`. Rendered only as hard-coded green text ("Accepted" L353, "Available" L462, "Yes" L533), prereq ✓ circles, and approved vote color/segments |
| pend / warning (amber) | `oklch(82% 0.12 75)` | `#F2B966` | `/.08` NOTE bg, `/.1` demo banner bg, `/.12` INTERNAL tag bg, `/.25` banner borders, `/.3` internal textarea border, `/.6` its focus border | `C.pend`, registry notes (L850, L862) |
| amber text 1 | `oklch(90% 0.08 80)` | `#FAD9A2` | — | Demo banner text (L28), NOTE callout text (L426) |
| amber text 2 | `oklch(82% 0.06 80)` | `#D9C099` | — | Demo banner secondary sentence (L30) |
| amber text 3 | `oklch(88% 0.1 80)` | `#FAD18A` | — | "you" tag (L237, L388), INTERNAL tag text (L560) |
| bad / danger (red) | `oklch(70% 0.17 25)` | `#F66D67` | `/.1` hover bg, `/.4` outline border | `C.bad`, danger confirm bg (L1211), rejected vote color |
| danger text | `oklch(80% 0.14 25)` | `#FF9890` | — | Text of danger outline buttons |
| info (blue) | `oklch(74% 0.1 250)` | `#79B0E8` | `/.08` SIMULATION bg, `/.18` org avatar bg, `/.28` SIMULATION border | `C.info` (nav dots, unused) |
| info text | `oklch(84% 0.08 250)` | `#A3CFFD` | — | Org avatar "LA" text (L37), "SIMULATION" label (L819) |

**Important finding:** the status-badge colors are computed in script (`chip().c`, `docs[].rc`, `checks[].c`, `ev().kc`, `pl.c`, `pl.rrC`, `cs.auditC`, `actions[].c`, `toast.c`, nav `dot`) and **never bound in the template**. Every status cell is `<span style="display:inline-flex;align-items:center;gap:7px">{{ x.l }}</span>`, a flex wrapper with a 7px gap and no dot element. The prototype therefore renders all statuses as plain text. Intended design **(INFERRED)**: a colored dot plus label, with the color from `C[k]`. The rebuild should implement `StatusBadge` = dot/icon + text with these semantics: `ok`=green, `pend`=amber, `bad`=red, `neu`=grey `#6F727D`, `info`=blue.

### 1.3 Typography

- **Fonts** (L13): Google Fonts `Geist:wght@300..800` and `Red Hat Mono:wght@400;500`, `display=swap`. Stacks: `Geist,system-ui,sans-serif` and `'Red Hat Mono',ui-monospace,monospace`. `-webkit-font-smoothing:antialiased`. `button,input,select,textarea{font-family:inherit}`. Rebuild with `next/font` (Geist is on Google Fonts; the `geist` npm package is an alternative).
- **Weights actually used:** 400 (default), 500 (134 uses; headings, labels, buttons, active nav), 600 (4 uses; "Collara" wordmark, avatar initials).
- **Base size:** 14px on the shell root (L26). Most body copy is 13.5px.
- **Size scale (px, use count):** 10 (3: prereq/completeness marks), 10.5 (3: sidebar section label, ⌘K, INTERNAL tag), 11 (32: mono eyebrows, counts, tech IDs, tags), 11.5 (25: sub-lines, small meta), 12 (170: footnotes, table headers, meta), 12.5 (97: secondary cells, pills, filter chips), 13 (89: table cells, cards), 13.5 (109: body, buttons, nav, tabs), 14 (7: card titles), 15 (2: drawer nav), 15.5 (2: wordmark), 16 (8: card headline / modal title), 18 (1: valuation figure), 22 (9: page H1), 24 (1: principal figure), 26 (9: stat-tile values).
- **Letter-spacing:** H1 `-0.02em` (also stat values), card headlines and wordmark `-0.01em`, mono uppercase eyebrows `.07em`, sidebar "Saved views" `.08em`, banner label `.05em`, SIMULATION label `.06em`, network chip and export caption `.04em`.
- **Line-height:** 1.5 (24 uses), 1.55 (15 uses, long-form notes), 1.45 (3 uses, governance key/value grids). Otherwise normal.
- **Mono (Red Hat Mono) is used for:** all identifiers (CL-…, ASSET-…, ATT-…, PKG-…, FP-…, PL-…, RR-…, GP-…, VER-…, RPT-…, DOC-…), dates/timestamps, ledger offsets and commit hashes, versions (v1, v2), amounts and stat numbers, counts in nav/tabs, model and serial numbers, uppercase eyebrow labels (`text-transform:uppercase`), banner/NOTE/SIMULATION/INTERNAL labels, the `⌘K` kbd, the "LocalNet" network chip, and proposal approval progress ("1 of 3").
- **Eyebrow label pattern:** `font-family:mono; font-size:11px; letter-spacing:.07em; text-transform:uppercase; color:#676A75`. Examples: "Current step", "Prerequisites for pledge activation", "Equipment identity".

### 1.4 Radii, borders, shadows

- **Radii (count):** 10px (63: cards, tiles, tables, toast), 8px (36: primary/secondary buttons, notices, callouts, org switcher), 7px (31: nav items, inputs, filter chips, search, header icon buttons), 6px (9: small buttons, network chip, org avatar, gov state pill), 9px (6: case status mini-tiles, SIMULATION banner), 999px (4: status pills), 50% (4: avatar, prereq circles), 4px (2: kbd, INTERNAL tag), 3px/2px (approval progress segments), 12px (1: modal).
- **Borders:** always 1px solid white-alpha (see §1.1). Active tabs use a 2px bottom border with `margin-bottom:-1px` so it overlaps the row's 1px divider.
- **Shadows (only 2):** modal `0 30px 80px rgba(0,0,0,.6)`; toast `0 16px 40px rgba(0,0,0,.5)`. Cards are flat.

### 1.5 Spacing scale (px)

- Gaps used: 1, 2, 3, 4, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22. The most common are 10 (50 uses), 7 (37: status wrappers), 14 (34: card grids), 8, 12 and 6.
- Paddings: cells `12px 14px` (83) and `10px 14px` (66: headers); card `18px` (27) or `16px`; list rows `10–13px 16px`; card header rows `14px 16px`; content area `24px 28px 40px` (L86), reduced to `16px` below 900px.
- **Recommendation (INFERRED):** keep a 2px half-step scale (2/4/6/8/10/12/14/16/18/20/22/24/28/32/40) as Tailwind spacing tokens rather than snapping to a 4px grid, because the density depends on the 10/14/18 steps.

### 1.6 Layout and sizes

| Element | Value |
|---|---|
| Shell | `display:flex; flex-direction:column; height:100vh` (L26) → demo banner (flex:none) + row (sidebar + main) |
| Sidebar | `width:232px`, `flex:none` (L34) |
| Header | `height:52px; padding:0 20px` (L61) |
| Content scroller | `flex:1; min-height:0; overflow:auto; padding:24px 28px 40px` (L86) |
| Page max width | `max-width:1240px` (all 9 screens). Left-aligned, not centered |
| Page vertical rhythm | `gap:22px` (Overview, Governance, Gov proposal) or `18px` (others) |
| Two-column split | `grid-template-columns:minmax(0,7fr) minmax(0,5fr); gap:14px; align-items:start` (11 uses). Verification tab reverses it (`5fr 7fr`, L287) |
| Detail header | `grid-template-columns:minmax(0,1fr) auto; gap:20px` (class `d-hdr`) |
| Stat tiles | `repeat(5,minmax(0,1fr))` Overview and case tiles; `repeat(4,…)` Governance; `gap:12px` (10px in case) |
| Key/value grids | `130/140/150/160/170px 1fr`, `row-gap 9–10px`, `column-gap 12–14px` |
| Table min-widths | Case queue 980, case evidence 900, sharing 900, exports 900, asset evidence 820, audit 1040, gov registry 1000, gov proposals 1000, members 560. Containers use `overflow-x:auto` |
| Header search | `width:260px; height:32px` (L68). Case-queue search is 240px (L143) |
| Modal | `max-width:520px; padding:22px; gap:14px` (L1028) |
| Mobile drawer | `width:260px` (L76) |
| Control heights | 26 (org avatar/logo), 28 (small buttons, network chip), 30 (saved views), 32 (filter chips, search, header icon buttons, settings), 34 (nav items, primary/secondary buttons), 36 (inputs, side-panel buttons), 38 (tabs), 40 (drawer nav items), 52 (header) |

### 1.7 Breakpoints and responsive rules (L22–23, verbatim)

```css
@media (max-width:900px){.d-side{display:none!important}.d-menu{display:inline-flex!important}.d-hide{display:none!important}.d-g2,.d-g3,.d-g4,.d-hdr{grid-template-columns:1fr!important}.d-pad{padding:16px!important}.d-tiles{grid-template-columns:repeat(2,minmax(0,1fr))!important}.d-wrap{flex-wrap:wrap!important}}
@media (max-width:560px){.d-tiles{grid-template-columns:1fr!important}}
```
- **≤900px:** the sidebar is hidden and the `≡` menu button appears, opening a drawer. The header search and "LocalNet" chip are hidden (`.d-hide`). Every 2-column grid (`.d-g2`, 15 uses) and detail header (`.d-hdr`, 5 uses) stacks to one column. Content padding becomes 16px. Stat tiles use 2 columns. Filter bars (`.d-wrap`) wrap. Tables keep their min-width and scroll horizontally inside their card.
- **≤560px:** stat tiles use 1 column.
- `.d-g3` and `.d-g4` are defined but unused.
- Mobile Preview copy (verbatim): "Both pages reflow below 900px: the landing collapses to a single column with a menu button; the workspace hides the sidebar behind a drawer and lets tables scroll horizontally. Tweaks (demo moment, mandate, technical IDs) apply on the desktop dashboard file."
- Tailwind mapping **(INFERRED)**: use a custom `max-[900px]` breakpoint, or make `lg` = 900px, plus a 560px `xs`.

### 1.8 Motion

- Toast: `@keyframes d-toast{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}`, applied as `animation:d-toast .25s ease-out` (L21, L1046).
- There are no other transitions. Hover states switch instantly. The command lifecycle is faked with timers (1600ms → confirmed; toast cleared at 5200ms; see §5.5).

### 1.9 Iconography and logo

- **Logo:** `assets/collara-mark.png`, a 1254×1254 RGBA PNG (384 KB). It is a white geometric "C" with chevron-cut terminals and an inner split stroke on a transparent background. Shown at 26px with the alt text "Collara" plus the wordmark "Collara" (15.5px/600). **The same mark is reused as every nav-item icon** (14px, `opacity:1` when active, `.45` otherwise; L42, L54). That is a placeholder; replace it with Lucide icons per the brief. The PNG should become an optimized SVG.
- **Unicode glyphs used as icons:** `▾` (org switcher caret, filter dropdowns), `≡` (mobile menu), `⌕` (search), `◔` (notifications), `⌘K` (kbd hint), `→` (navigate/CTA suffix), `←` ("← All proposals"), `✓`/`·` (prereq marks), `/` (breadcrumb separator). Map them to Lucide: ChevronDown, Menu, Search, Bell, ArrowRight, ArrowLeft, Check, Dot/Circle.
- Nav "dot" colors are defined but unrendered (L1289): overview=`pend`, cases=`info`, assets=`ok`, pledges=`#B5B5BF`, audit=`#6F727D`, gov=`info`.

### 1.10 Proposed CSS-variable sheet (INFERRED, derived from the values above)

```css
:root{ /* dark is the only theme in the prototype */
  --bg-app:#101116; --bg-sidebar:#0C0D11; --bg-surface:#16171D; --bg-surface-raised:#1C1D24; --bg-inset:#0F1014;
  --text-1:#F4F5F7; --text-2:#9A9CA6; --text-3:#676A75 /* raise to ≥#80838E for AA */; --text-4:#4E515B /* do not use for text */;
  --line-1:rgb(255 255 255/.06); --line-2:rgb(255 255 255/.08); --line-3:rgb(255 255 255/.12); --line-focus:rgb(255 255 255/.30);
  --ok:oklch(74% .13 155); --pend:oklch(82% .12 75); --bad:oklch(70% .17 25); --bad-text:oklch(80% .14 25); --info:oklch(74% .1 250); --neu:#6F727D;
  --radius-card:10px; --radius-control:8px; --radius-input:7px; --radius-sm:6px; --radius-pill:999px; --radius-modal:12px;
  --font-sans:Geist,system-ui,sans-serif; --font-mono:'Red Hat Mono',ui-monospace,monospace;
}
```

---

## 2. App shell

### 2.1 Structure (L26–L1048)

```
<div shell column 100vh>
  DemoBanner (L28–31)
  <div row flex:1>
    <aside.d-side Sidebar 232px> (L34–58)
    <main flex:1>
      <header WorkspaceHeader 52px> (L61–72)
      MobileNavDrawer (sc-if navOpen, L74–84)
      <div.d-pad scroll container> one of 9 screens (L86–1022)
  ConfirmationDialog (sc-if hasModal, L1026–1043)
  Toast (sc-if hasToast, L1045–1047)
```
`<title>` is "Collara — Workspace (Demo Lender A)" (L11). It is static on every screen.

### 2.2 Demo banner (L28–31)

- Full width, `padding:6px 16px`, centered, wraps, `gap:14px`, 12px. Background `oklch(82% 0.12 75 / .1)`, bottom border `oklch(82% 0.12 75 / .25)`, text `oklch(90% 0.08 80)`.
- Mono label (500, `.05em`): **"Demo data — LocalNet"**
- Text (`oklch(82% 0.06 80)`): **"Synthetic organizations and fixtures. No funds are transferred. Viewing as Demo Lender A · {mandate}."**
- **Conflict with the brief:** the brief requires the mode labels "Synthetic demo data — UI mockup." (UI_MOCK) and "Synthetic demo data — Canton LocalNet." (LOCALNET). The prototype says "LocalNet" even though nothing touches a ledger, which is a mislabel. The rebuild must drive the banner from the runtime mode.

### 2.3 Sidebar (L34–58)

- Container: bg `#0C0D11`, right border `rgba(255,255,255,.07)`, flex column.
- **Brand row** (L35): mark 26px + "Collara" (15.5px/600/-0.01em), `padding:16px 16px 12px`, gap 9.
- **Org/role switcher** (L36–39). A `<button>` with **no onClick and no menu**, so it is decorative. `margin:0 10px 12px; padding:9px 10px; radius 8; border .08; bg #12131A; hover #171821`. Contents:
  - Avatar tile 26px, radius 6, bg `oklch(74% 0.1 250 / .18)`, text `oklch(84% 0.08 250)`, "LA" 11px/600.
  - "Demo Lender A" (13px/500, ellipsis), then `{mandate}` (11.5px `#9A9CA6`, which is "Lender Approver" or "Lender Analyst").
  - Caret "▾" (11px `#676A75`).
- **Primary nav** (L40–44), built from `navDefs` (L1289). Items are 34px tall, `padding:0 10px`, radius 7, 13.5px/500. Active: bg `rgba(255,255,255,.07)`, text `#F4F5F7`, icon opacity 1. Inactive: transparent, `#9A9CA6`, icon .45. Hover: bg `.06`, text `#F4F5F7`. A right-aligned mono 11px `#676A75` count.

  | Label | key / target | Count shown |
  |---|---|---|
  | Overview | `overview` | (none) |
  | Cases | `cases` (resets view to "All") | `queueAll.length` = **5** |
  | Assets | `asset`, which opens the single passport ASSET-DEMO-001 directly (there is **no assets list**) | **"1"** (static) |
  | Pledges | `pledge`, which opens the single pledge/control detail directly (there is **no pledge list**) | `counts.active` = 1 (Lender review) / 2 (Release review) / 1 after release |
  | Audit | `audit` | (none) |
  | Governance | `gov` | `govCounts.open` = 1 initially |

  The active item is decided by `s.screen === key` only. On the `case` and `review` screens **no nav item is highlighted** (bug; Cases should stay active). The same applies to `govp`, where Governance is not highlighted.
- **"Saved views"** heading (L45): mono 10.5px, `.08em`, uppercase, `#4E515B`, `margin:18px 20px 0`.
- **Saved views** (L46–51): 30px buttons, left indent `padding:0 10px 0 26px`, 13px `#9A9CA6`, hover bg `.05`, each with a mono count:
  - "Ready for review" → Cases filtered to that view, count `counts.review`
  - "Needs evidence" → `counts.evidence`
  - "Awaiting approval" → `counts.approval`
  - "Release requests" → `counts.release`
- Spacer, then a **footer** (L53–57) with top border `.07`:
  - "Settings" button (32px, mark icon at .45 opacity). **No handler.**
  - Row: "LocalNet" | mono "offset 18422" (12px/11px `#9A9CA6`)
  - "Ledger synced · 2026-10-01 14:32:05 UTC" (11.5px `#676A75`)

### 2.4 Workspace header (L61–72)

Left to right:
1. `≡` menu button (class `d-menu`, `display:none` above 900px), 34×34, radius 7, border `.1`, `aria-label="Menu"`, toggles `navOpen`.
2. **Breadcrumb**: the root is a `<button>` (13.5px `#9A9CA6`, hover `#F4F5F7`) that navigates to the root screen. When a leaf exists, `/` (`#4E515B`) is followed by a mono 12.5px `#F4F5F7` leaf. Map (L1291–1292):

   | screen | root label → target | leaf |
   |---|---|---|
   | overview | Overview → overview | — |
   | cases | Cases → cases (view "All") | — |
   | case | Cases → cases | `CL-001` |
   | asset | Assets → asset | `ASSET-DEMO-001` |
   | review | Cases → cases | `CL-001 · Collateral review` |
   | pledge | Pledges → pledge | `{pl.id}`, i.e. `PL-001` or `CONTROL-ASSET-DEMO-001` |
   | audit | Audit → audit | — |
   | gov | Governance → gov | — |
   | govp | Governance → gov | `{gp.id}`, e.g. `GP-004` |
3. Spacer.
4. **Global search** (`d-hide`): 260×32, bg `#0C0D11`, border `.08`, radius 7, glyph `⌕`. Input placeholder **"Search accessible records"** (outline none, unlabeled). Kbd chip **"⌘K"** (mono 10.5, border `.1`, radius 4, `padding:1px 5px`). **Not functional.**
5. **Network chip** (`d-hide`): "LocalNet", 28px, radius 6, border `.1`, mono 11px `.04em` `#9A9CA6`.
6. **Notifications** button: 32×32, glyph `◔`, `aria-label="Notifications"`, hover text `#F4F5F7` bg `.05`. **No handler.**
7. **Avatar**: 32px circle, bg `#1E1F27`, border `.1`, initials `{initials}` (11.5px/600), always **"MH"** (Morgan Hale) even when the mandate is Lender Analyst (Dana Reyes). That is a bug.

### 2.5 Mobile nav drawer (L74–84)

- `sc-if navOpen`. Fixed overlay `inset:0; z-index:60; background:rgba(0,0,0,.6)`. **The whole overlay has `onClick=toggleNav`**, so clicking anywhere inside the panel also closes it (no `stopPropagation`).
- Panel: 260px, bg `#0C0D11`, right border `.08`, `padding:16px 10px`. Contents: brand row, then the same nav list at 40px height and 15px text with **no icons**, then a footer pinned with `margin-top:auto`: "Demo Lender A · {mandate}" + `<br>` + "LocalNet · offset 18422" (12px `#9A9CA6`).
- Saved views, Settings and the org switcher are **not** in the drawer. Any nav click calls `go()`, which also sets `navOpen:false`.

### 2.6 "Tweaks" (demo controls), from `data-props` on L1050

These are props edited in the dc editor's "Demo walkthrough" panel. There is no in-page UI for them.

| Prop | Type / options | Default | Effect |
|---|---|---|---|
| `demoMoment` | enum `'Lender review' \| 'Release review'` | `'Lender review'` | Picks the CL-001 scenario. **Lender review (A):** registered, attested, package shared, lender review in progress, no proposal, control v3 available. This matches the brief's main seed. **Release review (B):** eligible decision recorded 2026-09-18, FP-001 v2 accepted, PL-001 active since 2026-09-22, RR-001 release requested 2026-09-30, awaiting lender decision. Switches `cs`, `pl`, activity, queue tags, overview actions and figures (§5.3) |
| `mandate` | enum `'Lender Approver' \| 'Lender Analyst'` | `'Lender Approver'` | `isApprover`/`isAnalyst` gating (§5.7). Appears in the banner, org switcher, drawer and the dialog "Acting party" |
| `showTechnicalIds` | boolean | `false` | Only shows a mono 11px `#676A75` row under the Case Workspace subtitle (L189): `case:00c4f1…9b2e` · `control:ASSET-DEMO-001#{v3\|v4}` · `attestation:ATT-001` · `package:PKG-001 v2` · `offset:18422` |

Rebuild **(INFERRED, aligned to the brief §9)**: in UI_MOCK mode, expose these as a dev-only "Demo controls" popover or query params. In LOCALNET mode, the scenario comes from seeded ledger state and the mandate from the authenticated demo session ("Role switching uses isolated authorized demo sessions").

---

## 3. Screens

Common page header (list pages): an `h1` (22px/500/-0.02em), then a subtitle `p` (13.5px `#9A9CA6`, `margin-top:6px`), with right-aligned meta (12px `#676A75`) or a CTA, in a flex row (`align-items:flex-end; justify-content:space-between; wrap`).
Common detail header (`d-hdr` grid): `h1` with a mono ID span, " · " and a name, then a **status pill** (`padding:4px 10px; radius 999; border .12; 12.5px`, plain text), and a subtitle `p` (`margin-top:8px`). Actions sit on the right.
Card: `bg #16171D; border 1px rgba(255,255,255,.08); radius 10px`. Body `padding:18px` (or 16). Header row `padding:14px 16px` with `border-bottom .07` and a 13.5–14px/500 title.

### 3.1 Overview (`screen='overview'`, default; L88–129)

- H1 **"Overview"**. Subtitle: **"Work that needs a decision or an action from Demo Lender A. Counts include only records your organization is permitted to see."** Right meta: **"Projected from ledger offset 18422 · 14:32:05 UTC"**.
- **Five stat tiles** (`d-tiles`, `<button>`s; card padding 16, hover border `.16`): label 12.5 `#9A9CA6`, value mono 26px/500, footer 12px `#676A75`.

  | Label | Value | Footer | Click |
  |---|---|---|---|
  | Cases awaiting review | `counts.review` | Open queue → | Cases, view "Ready for review" |
  | Missing evidence | `counts.evidence` | Open queue → | view "Needs evidence" |
  | Decisions awaiting approval | `counts.approval` | Open queue → | view "Awaiting approval" |
  | Active pledges | `counts.active` | Open pledges → | Pledge detail (PL-001 or the control) |
  | Release requests | `counts.release` | Open queue → | view "Release requests" |

  Values: A = 1 / 1 / 1 / 1 / 0. B = 0 / 1 / 1 / 2 / 1.
- **Left card "Needs your action"**, with `{actionCount} items` on the right. Each row is a full-width `<button>` (padding `13px 16px`, row border `.06`, hover `.03`): mono 12px `#9A9CA6` ID, title 13.5px over a sub-line 12px `#676A75`, and right-aligned state text 12px `#9A9CA6` (no badge color is rendered). Rows are built in L1277–1285, in this order:
  1. If GP-004 `canVote`: **GP-004** · "Vote on governance proposal · Add verifier Demo Calibration Lab" · "BitSafe governance · {progress} approvals · UI simulation" · state "Open" → gov proposal. Otherwise, if `canExecute`: "Execute governance proposal · Add verifier Demo Calibration Lab" · "BitSafe governance · threshold met · UI simulation" · "Ready to execute".
  2. In A with no outcome: **CL-001** · "Review evidence package and record assessment" · "PKG-001 v2 · attestation valid · analyst Dana Reyes" · "In review" → Collateral review.
  3. If approved now: **CL-001** · "Issue financing proposal" · "Collateral decision recorded · approver mandate required" · "Eligible" → case.
  4. In B with the release pending: **CL-001** · "Decide release request RR-001" · "External loan completion · requested 2026-09-30 · lock remains active" · "Release requested" → pledge.
  5. Always: **CL-004** · "Approve or reject collateral eligibility" · "Assessment submitted by analyst · policy CP-2026-CNC-01" · "Awaiting approval" → `noop` toast.
  6. Always: **CL-002** · "Waiting on borrower · maintenance log requested" · "No lender action until new evidence version is submitted" · "Needs information" → `noop`.
- **Right column, figures card:**
  - "Recorded financing principal": mono 24px `{principal.amount}` + "USD" (13px Geist `#9A9CA6`).
  - Footnote: "Coverage: {coverage} · Source: accepted proposals, ledger-committed · Not a valuation, balance, or TVL figure."
  - Divider, then "Recorded collateral valuation": mono 18px `{principal.valuation}` + "USD". Footnote "Source: verifier inspection reports · dated per attestation".
  - Values (L1286): in B before release, amount **285,000.00**, coverage **"2 of 2 active pledges reconciled"**, valuation **410,000.00**. Otherwise **180,000.00**, **"1 of 1 active pledge reconciled"**, **260,000.00**. **(INFERRED)** 285k = CL-001 105k + CL-003 180k, and 410k = 150k + 260k.
- **Right column, "Recent committed events"** card. The header has "Audit center →" (a link-button that goes to audit). It lists the first 4 `Committed` events of the reverse-chronological activity (§4.6). Each row shows the event, an actor sub-line and a mono 11px time.

### 3.2 Cases queue (`screen='cases'`; L131–181)

- H1 **"Cases"**. Subtitle **"Cases shared with Demo Lender A. Borrower and pledge columns show only what your organization is authorized to see."** Right: an outline button **"Export accessible records"** (no handler).
- **View tabs** (`caseViews`, L1203–1205). Tab style plus a mono count:
  "All" (5) · "My actions" · "Ready for review" · "Needs evidence" · "Awaiting approval" · "Release requests". Each view filters by a tag in `row.views` (`mine`, `review`, `evidence`, `approval`, `release`).
- **Filter bar** (`d-wrap`): search 240px with placeholder **"Search case ID or asset"** (not functional). Chips **"Stage ▾"**, **"Missing evidence ▾"** and **"Updated ▾"** (no handlers). Right: **"{queueCount} of {queueTotal} accessible cases"**.
- **Table** (min-width 980). Columns: **Case ID** (mono 12.5) · **Asset** (name, then a mono 11.5 `#676A75` asset ID below) · **Borrower** · **Verification** (status) · **Lender review** (status) · **Pledge** (status) · **Next actor** (`#9A9CA6`) · **Last update** (right-aligned, 12.5 `#676A75`). The whole `<tr>` is clickable (`onClick=r.open`). CL-001 opens the case, and the others show the `noop` toast.
- **Empty state** (L177): **"No cases require your action."** (centered, padding 36, 13.5 `#9A9CA6`). It appears inside the table card under the header row.
- Footer note: **"Bulk approval and bulk release are not available. Sensitive decisions are recorded per case."**

### 3.3 Case Workspace (`screen='case'`, CL-001 only; L183–412)

**Header (L185–196)**
- H1: mono **"CL-001"** + " · Used CNC financing" + stage pill `{cs.stage.l}`.
- Subtitle: "CNC machining center · DEMO-CNC-500 · " + **ASSET-DEMO-001** (mono inline button → Asset passport, underline on hover) + " · Borrower: Demo Manufacturer · Selected lender: Demo Lender A".
- Optional technical-ID row (§2.6).
- Right column (aligned end): "Next actor · **{cs.nextActor}**", then a primary button **"{cs.nextAction} →"** (`onClick=cs.nextGo`), then "Ledger synced · offset 18422 · 14:32:05 UTC" (11.5 `#676A75`).

**Five status mini-tiles** (`d-tiles`, radius 9, `padding:12px 14px`, label 11.5 `#676A75`, value 13px): **Evidence** `{cs.st.evidence.l}` · **Verification** · **Lender review** · **Proposal** · **Pledge**. This is how the prototype keeps the five states separate, as the brief requires. Values per scenario are in §5.3.

**Tabs:** Summary · Evidence · Verification · Review · Proposal · Pledge · Sharing · Activity. The default is Summary, and `goCase` always resets to Summary. (The brief lists "Evidence, Verification, Sharing & Access, Review, Proposal, and Activity". The prototype adds Summary and Pledge and labels the access tab "Sharing".)

**Summary tab (L210–250)**. Grid 7/5.
- Card "Current step" (eyebrow): headline `{cs.currentStep}` (16px/500), then a key/value grid 150px|1fr: "Responsible party" → `{cs.nextActor}`, "Permitted next action" → `{cs.nextAction}`, "Blocker" → `{cs.blocker}`.
- Card "Prerequisites for pledge activation" (eyebrow): 5 rows. Each has a 16px circle (1px border and text in color `p.c`) with mark `✓` (done, green) or `·` (pending, amber), a label, and a right sub-text 12px `#9A9CA6`. The rows are in §5.3.
- Card "Participants" (rows `padding:10px 16px`, name left, role right `#9A9CA6`):
  - Demo Manufacturer — "Borrower · asset owner"
  - Demo CNC Dealer — "Dealer · contributor"
  - Demo Verifier — "Verifier · ATT-001 issued"
  - Demo Lender A + **"you"** tag (11px amber `oklch(88% 0.1 80)`) — "Selected lender"
  - Demo Auditor — `{cs.auditorGrant}` ("No grant" / "Scoped grant · CL-001 · to 2026-12-31")
- Card "References" (label left `#9A9CA6`, mono 12px value right):
  - "Asset passport" — "ASSET-DEMO-001 →" (button → asset)
  - "Attestation" — "ATT-001 · valid to 2027-03-10"
  - "Evidence package" — "PKG-001 v2 · 5 documents"
  - "Proposal" — `{cs.proposalRef}`
  - "Pledge" — "{cs.pledgeRef} →" (button → pledge)

**Evidence tab (L252–284)**. A table (min 900) with columns **Document** (name / type sub-line) · **Source** (org / "by" sub-line) · **Version** (mono) · **Uploaded** (mono 12 `#9A9CA6`) · **Integrity** (hard-coded **"Hash verified"** for every row) · **Review** (`d.review`) · **Sharing scope** (12.5 `#9A9CA6`) · *(actions, empty header)*. The actions are a small outline **"Download"** button and a ghost **"Request correction"** button, neither with a handler. The rows come from `docs` (§4.3). Footnote: **"A hash match confirms the file bytes match the committed integrity reference. It does not establish that a document is original, genuine, or legally enforceable. Downloads use short-lived links issued after a server-side access check."**

**Verification tab (L286–309)**. Grid 5/7.
- Left attestation card: mono "ATT-001" with "Valid" on the right. Key/value 130px:
  - Issuer "Demo Verifier (active, assigned)"
  - Outcome "Attestation issued"
  - Inspection method "On-site inspection + document review"
  - Inspected `2026-09-10`
  - Valid until `2027-03-10`
  - Supporting versions "Inspection report v2 · Dealer invoice v1 · Equipment photos v1 · Maintenance log v1"
  - Replacement "None · not superseded or revoked"

  Then an inset Limitations box: **"Limitations."** (in `#F4F5F7`) " Ownership and lien status were reviewed from submitted documents only. No UCC, title, or registry search was performed. Maintenance history verified for Q3 2025 onward."
- Right card "Checked items": grid rows `170px 1fr auto` showing item, finding and status (§4.4). Footnote **"This attestation records the checks listed above. It does not approve financing or establish legal lien priority."**

**Review tab (L311–332)**. Grid 7/5.
- Left: eyebrow "Collateral review · Demo Lender A", headline `{cs.reviewHeadline}`, and a primary **"Open collateral review →"** (→ review screen). Key/value 160px:
  - Analyst "Dana Reyes · Demo Lender A"
  - Approver mandate "Morgan Hale · Head of Credit"
  - Evidence snapshot "PKG-001 v2 · matches attested versions"
  - Assessment `{cs.assessmentState}`
  - Decision `{cs.decisionState}`
- Right: "Scope of this review", with the copy "Eligibility applies to Demo Lender A and case CL-001 only. It does not make the passport eligible elsewhere and it does not promise funding." and "Internal assessment notes and the internal risk view are visible to Demo Lender A only. Feedback shared with the borrower is recorded separately."

**Proposal tab (L334–365)**
- When `cs.hasProposal` (B), grid 7/5:
  - Left: mono "FP-001 · v2" with "Accepted · exact version v2" on the right. Key/value 170px:
    - Lender "Demo Lender A"
    - Borrower "Demo Manufacturer"
    - Case · Asset `CL-001 · ASSET-DEMO-001`
    - Financing reference `LOAN-DEMO-001 (external)`
    - Principal `USD 105,000.00`
    - Term metadata "36 months · metadata only"
    - Proposal expiry `2026-10-05`
    - Legal document reference "Executed financing documents held by Demo Lender A (external)"
    - Authorized approver "Morgan Hale · Demo Lender A"
    - Accepted by "Demo Manufacturer · 2026-09-21 16:40 UTC · committed"
  - Right: "Version history". "v2 · issued 2026-09-20 · expiry corrected" — **Accepted** (green). "v1 · issued 2026-09-19" — "Withdrawn". A note card: **"Accepting this workflow proposal does not itself disburse funds or replace executed financing documents."**
- When `cs.noProposal` (A), **EmptyState**: title "No proposal issued", body **"A financing proposal can be issued by an authorized approver after the collateral decision for this case is recorded. Issuing a proposal creates a workflow record; it does not disburse funds."**, and a **disabled** button **"Issue proposal · requires recorded decision"** (`cursor:not-allowed`, text `#676A75`). It stays disabled even after the decision is approved (bug, §5.9).

**Pledge tab (L367–372)**. A single card: eyebrow "Collateral control · ASSET-DEMO-001", headline `{pl.headline}`, sub `{pl.sub}`, and a primary **"Open pledge detail →"**.

**Sharing tab (L374–397)**. A table (min 900) with columns **Recipient · Purpose · Scope · Permission · Expiry · Status · Consenting parties**:

| Recipient | Purpose | Scope | Permission | Expiry | Status | Consenting parties |
|---|---|---|---|---|---|---|
| Demo Lender A **you** | Lender review | PKG-001 v2 · 5 documents · loan terms | View + download | 2026-12-31 | Active | Demo Manufacturer · Demo CNC Dealer |
| Demo Verifier | Verification scope | Assigned evidence · 4 documents · no loan terms | View | Until attestation issued | Completed | Demo Manufacturer |
| Demo Auditor | Scoped audit | `{cs.auditScope}` ("—" / "CL-001 history · evidence manifest") | `{cs.auditPerm}` ("—" / "View + export") | `{cs.auditExpiry}` ("—" / "2026-12-31") | **`{cs.auditGrant}` (unresolved key, always blank; bug)** | `{cs.auditConsent}` ("—" / "Demo Manufacturer · Demo Lender A") |

Below the table: an outline **"Review package"** (no handler) and a **disabled "Grant access · controller only"**. Footnote **"Loan terms are disclosed only to the borrower and the selected lender. Revoking a grant limits future document access; previously shared copies may still exist."**

**Activity tab (L399–410)**. A card list with rows in a grid `150px minmax(0,1fr) 120px`: mono 11.5 `#676A75` time | event, with the sub-line "{actor} · {state change}" (12px `#9A9CA6`) | kind ("Committed"/"Operational", right-aligned). Footnote **"Committed events are ledger transactions. Operational events are application actions and are not evidence of a state change."**

### 3.4 Asset Passport (`screen='asset'`; L414–505)

- H1: mono "ASSET-DEMO-001" + " · CNC machining center" + pill **"Registered"** (static).
- Subtitle "DEMO-CNC-500 · Serial SYNTH-CNC-001 · Owner claim: Demo Manufacturer (submitted evidence) · Passport version v3".
- Right buttons: outline **"Open case CL-001"** (→ case) and **"Review sharing"** (no handler).
- **NOTE callout** (amber, L426): mono "NOTE", then "Ownership and lien status were reviewed from submitted documents by the verifier. This is not a legal title or lien check."
- Tabs: **Overview** (default) · **Evidence** · **Verification** · **Cases** · **Activity**. The tab does not reset on navigation.
- **Overview tab:**
  - Left card, eyebrow "Equipment identity", then a 2-column field grid (label 12px `#676A75` above the value):

    | Field | Value |
    |---|---|
    | Equipment class | CNC machining center |
    | Manufacturer | Demo Machine Works (synthetic) |
    | Model | `DEMO-CNC-500` |
    | Serial number | `SYNTH-CNC-001` |
    | Year of manufacture | 2019 |
    | Asset ID · namespace | `ASSET-DEMO-001 · collara-localnet` |
    | Owner organization | Demo Manufacturer · claim source: purchase agreement v1, dealer invoice v1 |
    | Location scope | Demo Manufacturer facility · Ohio, US (declared) |
    | Registered | `2026-09-01 08:40 UTC · committed` |
    | Last update | `{assetLastUpdate}`: A "2026-09-12 10:35 UTC · committed", B "2026-09-30 09:12 UTC · committed", released "2026-10-01 14:33 UTC · committed" |

  - Right card, eyebrow "Verification and evidence":
    - Attestation "ATT-001 · valid to 2027-03-10"
    - Scope "Serial, photos, documents, condition, location, maintenance"
    - Evidence validity "5 documents · all hashes verified"
    - Collateral control `{pl.short}`: "Available · v3" / "Active · PL-001" / "Released"
  - Right card, eyebrow "Permitted actions · Demo Lender A":
    - "Open case · Review sharing" — **Available** (green)
    - "Add evidence · Request verification" — "Owner only" (row muted)
    - "Transfer ownership" — "Planned · blocked while locked" (muted)

    This is the prototype's PermissionNotice pattern.
- **Evidence tab:** the same `docs` without the Review column or actions. Columns: Document · Source (org only) · Version · Uploaded · Integrity ("Hash verified") · Sharing scope. Min width 820.
- **Verification tab:** a header row "ATT-001 · Demo Verifier · inspected 2026-09-10 · valid until 2027-03-10" with "Valid · not superseded", then the checks list. Footnote "Limitations: ownership and lien status reviewed from submitted documents only; no UCC, title, or registry search performed."
- **Cases tab:** one button row: mono "CL-001" + "Used CNC financing · Demo Manufacturer → Demo Lender A", and on the right "{cs.stage.l} →". Footnote "Only cases your organization is permitted to see are listed."
- **Activity tab:** the same full `activity` list as the case, including lender-internal events. This is a scoping inconsistency (§5.9).

### 3.5 Collateral Review (`screen='review'`; L507–633)

- H1 "Collateral review · " + mono "CL-001" + pill `{cs.st.review.l}`.
- Subtitle "CNC machining center · DEMO-CNC-500 · ASSET-DEMO-001 · Analyst: Dana Reyes · Approver: Morgan Hale · Evidence snapshot PKG-001 v2".
- Outline button **"Back to case"** (→ case).
- Tabs: **Evidence** · **Verification scope** · **Assessment** (default) · **Decision** · **Activity**.
- **Evidence tab** (7/5):
  - Card "Evidence completeness · policy CP-2026-CNC-01" with 6 rows (circle mark + label + right sub; §4.5).
  - "Snapshot" card (eyebrow): Package `PKG-001 v2` · Matches attested versions **Yes** (green) · Attestation validity "Valid to 2027-03-10" · Stale evidence "None detected". Note: **"If the reviewed evidence changes, this review returns to Needs information until the new version is acknowledged."**
- **Verification scope tab:** header "ATT-001 · Demo Verifier · on-site inspection + document review · 2026-09-10" with "Valid to 2027-03-10", then the checks list. Footnote "Limitations: ownership and lien status reviewed from submitted documents only. No UCC, title, or registry search performed. The attestation does not approve financing or establish legal lien priority."
- **Assessment tab** (7/5). The left card is a form. All fields are uncontrolled `defaultValue`, there is no validation, and nothing is saved:

  | Label | Control | Default |
  |---|---|---|
  | Valuation amount | input (mono) | `150,000.00` |
  | Currency | select USD / EUR | USD |
  | Valuation source | input | "Verifier inspection report v2 · dealer invoice v1" |
  | Valuation date | input (mono, plain text, not a date picker) | `2026-09-10` |
  | Valuation limitations | textarea rows=2 | "Desktop review of dealer invoice; no independent market comparables obtained. Condition per verifier inspection on 2026-09-10." |
  | Internal assessment notes + tag **"INTERNAL · DEMO LENDER A ONLY"** | textarea rows=3, amber border | "Serial matches invoice and photos. Maintenance log gap Q2 2025 noted by verifier; borrower explanation received 2026-09-14. Advance rate under policy CP-2026-CNC-01: 70% of valuation." |
  | Required external checks (read-only rows) | — | "UCC lien search" — "Pending · external"; "Title and ownership confirmation" — "Outside Collara" |
  | Collateral outcome | select: "Needs information" / "Eligible for this case" / "Rejected for this case" | `{cs.outcomeDefault}` |
  | Policy reference | input (mono) | `CP-2026-CNC-01` |

  Action bar (top border, `padding-top:6px`):
  - When the review is open: outline **"Request information"** and **"Save assessment"** (neither has a handler), a spacer, then by mandate:
    - Approver: danger-outline **"Reject for this case"** (→ reject dialog) and primary **"Approve eligibility"** (→ approve dialog).
    - Analyst: primary **"Submit for approval"** (**no handler**).
  - When the review is closed: the text "Assessment recorded with the decision on 2026-09-18. Changes require a new assessment version." The fields remain editable.

  Right column:
  - "Derived figures": Requested principal `USD 105,000.00` · Principal / valuation `70.0%` · Policy maximum `70.0%`. These are static, not computed from the inputs. Note: **"Valuation and principal are separate fields. Neither is summed with other cases or currencies."**
  - A static card: **"Eligible for this lender and case. Financing is not yet active. Eligibility does not make the passport globally eligible or promise funding."** It shows even before a decision (bug).
- **Decision tab:**
  - Open: card (max 720, padding 24) "Decision pending". **"The assessment recommends Eligible for this case under policy CP-2026-CNC-01. A decision requires the approver mandate; the analyst cannot record it."**
    - Approver: buttons **"Approve eligibility"** (primary), **"Reject for this case"** (danger outline), **"Request information"** (outline, no handler).
    - Analyst: inset notice **"Your mandate (Lender Analyst) does not include collateral approval. Submit the assessment for approval by Morgan Hale."**
  - Closed: headline **"Eligible for this lender and case. Financing is not yet active."** It is shown **even after a rejection** (bug). Key/value 160px:
    - Recorded by "Morgan Hale · Lender Approver · Demo Lender A"
    - Recorded `2026-09-18 15:22 UTC · committed`
    - Evidence snapshot "PKG-001 v2 · ATT-001"
    - Policy reference `CP-2026-CNC-01`
    - Commit reference `CA-001 · 7c1d…40ab · offset 18207`

    These values are static from scenario B, so they are wrong after a "just now" decision.
- **Activity tab:** `reviewActivity`, the activity filtered to refs starting `CA-` or `PKG-`. Same row layout as the case Activity tab.

### 3.6 Pledge Detail and Release (`screen='pledge'`; L635–732)

- H1: mono `{pl.id}` + " · Collateral control for ASSET-DEMO-001" + pill `{pl.state}`. The pill shows raw enum casing: "AVAILABLE", "ACTIVE · RELEASE_REQUESTED", "ACTIVE · RELEASE_REJECTED" or "RELEASED".
- Subtitle "Linked case **CL-001** (link) · Registered asset **ASSET-DEMO-001** (link) · Lender authority: Demo Lender A · Approver mandate".
- Right: "Ledger synced · offset 18422" `<br>` "2026-10-01 14:32:05 UTC".
- **Scenario A (`pl.available`)**, grid 7/5:
  - Left: "No active Collara lock". **"Asset control ASSET-DEMO-001 v3 is available. Activation consumes the available control and requires the authorizations below. Two concurrent activations cannot both commit."** Then the same 5 prereq rows as the Summary tab, with top borders.
  - Right: "Lender actions". **"Activation becomes available after the collateral decision is recorded and the borrower accepts an issued proposal. No lender action is available on this control right now."** Key/value 130px: Control `ASSET-DEMO-001 · v3 · AVAILABLE` · Namespace `collara-localnet` · Prior locks "None recorded".
  - There is no "Activate pledge" button anywhere. Pledge activation is not simulated.
- **Scenario B (`pl.locked`)**, grid 7/5:
  - Card, eyebrow "Lock and activation evidence", key/value 170px:
    - Lock state `{pl.lockLine}`
    - Activated `2026-09-22 14:05 UTC · committed`
    - Authorized by "Demo Manufacturer (borrower mandate) · Demo Lender A (approver mandate)"
    - Proposal "FP-001 v2 · accepted 2026-09-21 · USD 105,000.00"
    - Attestation "ATT-001 · valid to 2027-03-10"
    - Evidence snapshot "PKG-001 v2 · matched attested versions at activation"
    - Asset control `ASSET-DEMO-001 v3 → v4 (consumed on activation)`
    - Commit reference `PL-001 · 3f9a…c21e · offset 18310`
  - Card, eyebrow "Release request · RR-001", with `{pl.rrState}` on the right. Key/value:
    - Requested by "Demo Manufacturer · Borrower mandate"
    - Requested `2026-09-30 09:12 UTC · committed`
    - Reason "External loan completion"
    - Borrower note (muted) **"Final payment confirmed by your servicing team on 2026-09-29. Requesting release of the Collara lock."** (the quotes are literal)
    - Servicing reference `LOAN-DEMO-001 · external repayment confirmed (synthetic manual input)`

    Then an inset `{pl.note}`.
  - Right card "Release decision":
    - Pending, approver: **"You hold the approver mandate for Demo Lender A, the designated lender on this lock. Only this authority can release it."**, then stacked 36px buttons **"Authorize release"** (primary), **"Reject release"** (danger outline) and **"Request information"** (outline, no handler). Caveat **"This releases the Collara workflow lock. Any required legal lien termination must be completed separately."**
    - Pending, analyst: notice **"Release requires the designated lender's authorization. Your mandate (Lender Analyst) does not include release approval. Approver: Morgan Hale."** and a full-width outline "Request information" (no handler).
    - Decided: `{pl.decisionLine}` (14px). Key/value 110px: Decided by "Morgan Hale · Lender Approver · Demo Lender A", Recorded `{pl.decidedAt}` ("2026-10-01 14:33 UTC · committed"), Control `{pl.controlAfter}`. Footnote `{pl.afterNote}`.
  - Right card **"What does not release this lock"**: **"A maturity date, an uploaded proof of repayment, case cancellation, or an operator or governance action. Only the designated lender's authorization does."**

### 3.7 Audit Center (`screen='audit'`; L734–806)

- H1 "Audit center". Subtitle **"Scoped projection of committed ledger events and application actions for records Demo Lender A can access."** Primary **"Export case report"** → export dialog.
- Tabs **Events** (default) · **Exports**.
- **Events:**
  - Filter chips (all inert): **"Case: CL-001 ▾"** (active style), **"Event type: All ▾"**, **"Actor: All visible ▾"**, **"2026-09-01 → today ▾"**, **"Committed + operational ▾"**. Right: "{auditCount} events · through offset 18422". The count is 12 in A, 17 in B, plus 1 after a decision.
  - Table (min 1040), columns **Event time (UTC)** · **Reference** · **Event type** · **Authorized actor** · **State change** (mono 11.5) · **Version** · **Commit** · **Status** (= kind).
  - Footnote **"Operational events (uploads, drafts, views) are application actions. Only ledger-committed events change workflow state. Failed or unknown commands never appear as successful lifecycle events."**
- **Exports:**
  - Table (min 900), columns **Report** · **Scope** · **Requested by** · **Generated (UTC)** · **Coverage watermark** · **Checksum** · *(Download)*:

    | Report (sub) | Scope | Requested by | Generated | Watermark | Checksum |
    |---|---|---|---|---|---|
    | RPT-0007 · CL-001 (JSON · schema v0.3) | Own scope · Demo Lender A | Dana Reyes · Analyst | 2026-09-30 14:02:11 | offset 18402 · cutoff 2026-09-30 14:00 | sha256 9b12…e7a0 |
    | RPT-0004 · CL-003 (CSV · schema v0.3) | Own scope · Demo Lender A | Morgan Hale · Approver | 2026-09-24 09:41:57 | offset 18344 · cutoff 2026-09-24 09:40 | sha256 41cc…08d9 |

  - Footnotes: mono caption **"Case workflow report — not a legal title or lien certificate."** and **"This report includes only records available within your access scope. Access is re-evaluated at generation and at download. Reports carry a cut-off, a retention caveat, and a ledger coverage watermark."**
  - The "Download" buttons have no handler. A generated RPT-0008 never appears in the table.

### 3.8 Governance (`screen='gov'`; L808–953)

- Eyebrow **"BitSafe governance · UI simulation"**, then H1 "Governance". Subtitle **"Verifier-registry administration by a three-seat governance set with a 2-of-3 approval threshold. Proposals add or suspend verifiers. Nothing here touches collateral."** Right meta: "Decentralization Manager · not connected" `<br>` "Simulated locally · 3 seats · threshold 2 of 3".
- **SIMULATION callout** (blue): mono "SIMULATION", then **"Votes and execution are recorded locally until the Decentralization Manager integration is implemented. Governance administers the verifier registry only (add, suspend). It never authorizes collateral release; that stays with the lender approver mandate on each pledge."**
- **Four tiles** (button tiles):

  | Label | Value | Footer | Click |
  |---|---|---|---|
  | Active verifiers | `govCounts.active` (2) | "Assignable to verification requests" | → registry tab |
  | Suspended verifiers | (1) | "No new assignments accepted" | → registry tab |
  | Open proposals | (1) | "Open proposals →" | → proposals tab |
  | Approval threshold | "2" + " of 3" (14px `#9A9CA6`) | "Fixed in simulation →" | → members tab |

- Tabs **Verifier registry** (default) · **Proposals** · **Members**.
- **Verifier registry tab:**
  - Table (min 1000), columns **Verifier** · **Registry ID** · **Status** (text color `#F4F5F7` if Active, else `#9A9CA6`) · **Scope** · **Since · via** · **Assignments** · **Attestations** · *(action)*.
  - If an open suspension proposal exists for a verifier, an amber sub-line reads "Suspension proposed · {GP-id} · {n of 3} approvals".
  - Action: small outline **"Propose suspension"** (approver only, Active, and no open suspension).
  - **Pending addition rows** follow, one per open "Add verifier" proposal. The name is muted, with the amber sub "Addition proposed · {GP-id} · {progress} approvals". ID `#676A75`, status "Proposed", scope, "— · {GP-id}", "—", "—", and a small **"Open proposal"** button.
  - Footnote **"Registry changes take effect only when a passed proposal is executed. Suspension blocks new assignments; attestations already issued remain valid and are not reopened by governance."**
- **Proposals tab:**
  - Bar: "{proposalCount} proposals · {open} open · expiry 14 days after opening", then a spacer, then the primary **"Propose verifier"** (approver only, while Demo Metrology Services has no proposal).
  - Table (min 1000), columns **Proposal** · **Type** · **Target** (name + mono target ID) · **Proposed by** · **Opened (UTC)** · **Approvals** (a 72px bar of 3 segments, 5px tall with 2px radius, colored green/red by vote or `rgba(255,255,255,.1)` when pending, plus mono "n of 3") · **State** (`stateLabel`) · "→". Each row is clickable (→ proposal detail).
  - Footnote **"A proposal passes when 2 of 3 seats approve and closes when 2 seats reject. Approval alone does not change the registry; a member must execute the passed proposal."**
- **Members tab** (7/5):
  - Table (min 560), columns **Seat** · **Organization** · **Mandate holder** · **Member since** · **Votes cast** (right-aligned).
  - Card "Decentralization Manager" (eyebrow), key/value 140px:
    - Integration "Not connected · UI simulation"
    - Governance set "3 seats · fixed in simulation"
    - Threshold "2 of 3 approvals · 2 rejections close a proposal"
    - Proposal types "Add verifier · Suspend verifier"
    - Expiry "14 days after opening if not executed"
    - Out of scope "Collateral decisions, financing proposals, pledge activation and release. These remain under lender mandates and are never governed here."

### 3.9 Governance proposal detail (`screen='govp'`; L955–1020)

- Eyebrow "Governance proposal · UI simulation". H1: mono `{gp.id}` + " · {type} · {target}", followed by a state pill (`padding:3px 9px; radius 6; border .1; #9A9CA6`) `{gp.stateLabel}`. Subtitle "Proposed by {proposer} · opened {opened} UTC · expires {expires} UTC". Outline button **"← All proposals"** (→ gov, keeping the last tab).
- Left column, 7fr:
  - **"Approval progress"** card: "{progress} approvals · threshold 2 of 3" on the right. A 3-segment bar (6px tall, radius 3, gap 4). Then one row per seat (grid 60px|1fr): mono "Seat n", org name (with "(you)" for seat 1), the vote ("Approved" green / "Rejected" red / "Pending" `#9A9CA6`) and the mono time.
  - **"Execution"** card: State `{gp.execLine}` · Registry effect `{gp.effect}` · Target "{target} · {targetId}".
  - **"Proposal"** card: Type · Verifier scope · Proposed by · Rationale (`#C9CBD3`).
- Right column, 5fr:
  - Card, eyebrow **"Your seat · Demo Lender A · seat 1"**:
    - If `canVote`: "Approve or reject on behalf of Demo Lender A. Two approvals pass the proposal; two rejections close it.", then **"Approve proposal"** (primary) and **"Reject proposal"** (danger outline).
    - If `canExecute`: "Threshold met. Executing applies the registry change in the simulation. Any seat may execute a passed proposal.", then **"Execute proposal"**.
    - If there is a note, an inset `{gp.note}`.
    - Always: "UI simulation. No Decentralization Manager transaction is submitted. This seat administers the verifier registry only and cannot authorize collateral release."
  - **"Activity"** card: rows with a 128px mono time, then the event and actor.

### 3.10 Confirmation dialogs (L1026–1043; built by `mk()` L1211)

Layout: the overlay (`z 80`, `rgba(0,0,0,.62)`, centered, padding 20) holds a `div role="dialog"` (max 520). It contains, in order:
- Title (16/500)
- Body (13.5 `#9A9CA6`, 1.55)
- A **facts box** (grid 130px|1fr, inset bg) with three rows: "Acting party" → "Demo Lender A · {mandate}", "Record" → mono `{record}`, "Effect" → `{effect}`
- A caveat (12px `#676A75`)
- Right-aligned buttons: outline **"Cancel"** and the confirm button. The confirm is `#F4F5F7`/`#0C0D11`, or red `oklch(70% 0.17 25)`/`#FFFFFF` when `danger`, and has no hover style.

The prototype has no backdrop-click close, no Escape handling and no focus management.

| Trigger | Title | Body | Record | Effect | Caveat | Confirm | Danger | On confirm |
|---|---|---|---|---|---|---|---|---|
| `openApprove` | Approve collateral eligibility · CL-001 | Records the assessment outcome Eligible for this case for Demo Lender A under policy CP-2026-CNC-01, against evidence snapshot PKG-001 v2 and attestation ATT-001. | CA-001 · assessment v1 | IN_REVIEW → ELIGIBLE (this lender, this case) | Eligible for this lender and case. Financing is not yet active. This does not issue a proposal, disburse funds, or make the passport eligible elsewhere. | Approve eligibility | no | `commit({reviewOutcome:'eligible', reviewTab:'Decision'})` |
| `openReject` | Reject collateral for this case · CL-001 | Records the outcome Rejected for this case. The borrower receives the shared feedback; internal notes stay with Demo Lender A. | CA-001 · assessment v1 | IN_REVIEW → REJECTED (this lender, this case) | Rejection applies to this case only. The asset passport, attestation, and other cases are unaffected. | Reject for this case | yes | `commit({reviewOutcome:'rejected', reviewTab:'Decision'})` |
| `openRelease` | Authorize release of PL-001 | Release request RR-001 from Demo Manufacturer cites external loan completion. Authorizing releases the Collara workflow lock on ASSET-DEMO-001. | PL-001 · RR-001 · control v4 | ACTIVE → RELEASED · control becomes AVAILABLE (v5) | This releases the Collara workflow lock. Any required legal lien termination must be completed separately. | Authorize release | no | `commit({releaseOutcome:'released'})` |
| `openRejectRelease` | Reject release request RR-001 | The collateral lock on ASSET-DEMO-001 remains active. The borrower can reapply with a new reason or evidence. | PL-001 · RR-001 | RELEASE_REQUESTED → RELEASE_REJECTED · lock stays ACTIVE | A rejection is a release-request outcome. It does not change the active lock or the case eligibility. | Reject release | yes | `commit({releaseOutcome:'rejected'})` |
| `openExport` | Export case report · CL-001 | Generates a permission-scoped JSON export of the evidence manifest, attestation scope, review decisions, pledge and release events, and access scope. | RPT-0008 · schema v0.3 | Export job created · cut-off at ledger offset 18422 | Case workflow report — not a legal title or lien certificate. This report includes only records available within your access scope. | Generate export | no | `commit({auditTab:'Exports'}, 'Export completed. Access is re-checked at download.')` |
| gov `approve` | Approve {id} | "Records your approval as seat 1 (Demo Lender A) for {type lower-cased} · {target}. " + (approvals+1 ≥ 2 ? "This reaches the 2-of-3 threshold; any seat can then execute." : "{n} more approval is needed after yours.") | {id} · seat 1 | "Approvals a → a+1 of 3" + (" · threshold met") | govCaveat | Approve proposal | no | `govVotes[id]='Approved'` |
| gov `reject` | Reject {id} | "Records your rejection as seat 1 (Demo Lender A). " + (rej+1 > 1 ? "This closes the proposal; the threshold can no longer be reached." : "The proposal stays open until a second seat rejects or two seats approve.") | {id} · seat 1 | "Rejections r → r+1 of 3" + (" · proposal closes") | govCaveat | Reject proposal | yes | `govVotes[id]='Rejected'` |
| gov `execute` | Execute {id} | "Applies the passed proposal to the verifier registry: {effect}" | {id} · {targetId} | Add: "{target} → ACTIVE"; Suspend: "{targetId} ACTIVE → SUSPENDED" | govCaveat | Execute proposal | no | `govExec[id]=true`, toast "Executed in the governance simulation. Registry updated." |
| `openPropose` (add/suspend) | "Propose verifier · {org}" / "Propose suspension · {org}" | Add: "Opens an Add verifier proposal for {org} ({scope}). "; Suspend: "Opens a Suspend verifier proposal for {id} · {org}. " + "Your approval as seat 1 is recorded with the proposal; one more approval reaches threshold." | {nextGpId} · {r.id} | New proposal · Open · 1 of 3 approvals | govCaveat | Open proposal | no | prepend `newProposal()` to `govNew`, toast "Proposal opened in the governance simulation." |

`govCaveat` = "UI simulation. No Decentralization Manager transaction is submitted. Governance administers the verifier registry only; it cannot authorize collateral release."

### 3.11 Toast / command status (L1045–1047, `commit()` L1060–1065)

- Fixed `right:20px; bottom:20px; z 90`, bg `#1C1D24`, border `.12`, radius 10, `padding:11px 14px`, 13.5px, slide-up animation. Plain text with no icon. The toast color `c` is unused.
- Copy:
  - Default pending: **"Submitted. Waiting for ledger confirmation."**
  - Default done: **"Confirmed on the ledger."**
  - Governance pending: **"Submitting to the simulated governance set…"**
  - Governance done: **"Recorded in the governance simulation."**
  - Execute: **"Executed in the governance simulation. Registry updated."**
  - Propose: **"Proposal opened in the governance simulation."**
  - Export: **"Export completed. Access is re-checked at download."**
  - Unmodeled record (`noop`, auto-hides after 3.2s): **"This record is unavailable in the demo walkthrough. Only CL-001 is fully modelled."**

---

## 4. Fixture data (verbatim)

### 4.1 Organizations and people

| Entity | Role in prototype |
|---|---|
| Demo Lender A | Viewing org ("you"), selected lender on CL-001, governance seat 1 (Approver mandate). Avatar "LA" |
| Morgan Hale | Demo Lender A, Lender Approver; "Head of Credit" (L320). Header initials "MH" |
| Dana Reyes | Demo Lender A, Lender Analyst |
| Demo Manufacturer | Borrower / asset owner on CL-001 (also the CL-005 borrower). Staff refs "Plant manager", "Finance" |
| Demo CNC Dealer | Dealer / contributor. Staff ref "Sales desk" |
| Demo Verifier | Verifier VER-001 (genesis), issued ATT-001. Staff ref "Verifier seat 1" |
| Demo Auditor | Scoped-audit grantee (only after release), governance seat 3 ("Audit lead mandate") |
| Demo Lender B | Governance seat 2 (Approver mandate), proposer of GP-004. Not a CL-001 participant |
| Demo Tooling Inc / Demo Machining Co / Demo Fabrication LLC | Borrowers on CL-004 / CL-002 / CL-003 |
| Demo Machine Works (synthetic) | Equipment manufacturer of ASSET-DEMO-001 |
| Demo Inspection Partners (VER-002), Demo Field Audit Co (VER-003), Demo Calibration Lab (VER-004 reserved), Demo Metrology Services (VER-005 reserved) | Verifier registry entities |

### 4.2 Case queue rows (`queueAll`, L1192–1202; order as listed)

| ID | Asset (name · model) | Asset ID | Borrower | Verification | Lender review | Pledge | Next actor | Last update | View tags |
|---|---|---|---|---|---|---|---|---|---|
| CL-001 | CNC machining center · DEMO-CNC-500 | ASSET-DEMO-001 | Demo Manufacturer | Attested (ok) | `reviewChip` | `pledgeChip` | `cs.nextActor` | "2h ago" (A) / "1d ago" (B) / "just now" after any decision | §5.3 |
| CL-004 | CNC machining center · DEMO-CNC-500 | ASSET-DEMO-004 | Demo Tooling Inc | Attested (ok) | Awaiting approval (pend) | Available (neu) | Demo Lender A · Approver | 5h ago | mine, approval |
| CL-002 | CNC vertical mill · DEMO-CNC-320 | ASSET-DEMO-002 | Demo Machining Co | Changes requested (pend) | Needs information (pend) | Available (neu) | Demo Machining Co · Borrower | 1d ago | evidence |
| CL-003 | CNC turning center · DEMO-CNC-200 | ASSET-DEMO-003 | Demo Fabrication LLC | Attested (ok) | Eligible (ok) | Active (ok) | — · Monitoring | 3d ago | — |
| CL-005 | CNC machining center · DEMO-CNC-500 | ASSET-DEMO-005 | Demo Manufacturer | Attested (ok) | Eligible (ok) | Released (neu) | — · Closed | 2w ago | — |

### 4.3 Evidence documents (`docs`, L1138–1144). Package **PKG-001 v2**, 5 documents.

| Name | Type | Source org | By | Version | Uploaded | Review (color) | Sharing scope |
|---|---|---|---|---|---|---|---|
| Inspection report | PDF · 4 pages | Demo Verifier | Verifier seat 1 | v2 | 2026-09-08 | Attested (ok) | PKG-001 · Demo Lender A |
| Dealer invoice | PDF · 1 page | Demo CNC Dealer | Sales desk | v1 | 2026-09-02 | Reviewed (ok) | PKG-001 · Demo Lender A · Demo Verifier |
| Equipment photos | JPEG · 6 files | Demo Manufacturer | Plant manager | v1 | 2026-09-01 | Reviewed (ok) | PKG-001 · Demo Lender A · Demo Verifier |
| Maintenance log | PDF · 12 pages | Demo Manufacturer | Plant manager | v1 | 2026-09-03 | Reviewed · gap noted (pend) | PKG-001 · Demo Lender A · Demo Verifier |
| Purchase agreement | PDF · 6 pages | Demo Manufacturer | Finance | v1 | 2026-09-01 | Reviewed (ok) | PKG-001 · Demo Lender A |

Integrity is "Hash verified" for all rows (hard-coded).

### 4.4 Verification checks (`checks`, L1145–1153). Attestation ATT-001 by Demo Verifier, inspected 2026-09-10, valid until 2027-03-10.

| Item | Finding | Status (color) |
|---|---|---|
| Serial consistency | SYNTH-CNC-001 matches dealer invoice and nameplate photo | Checked (ok) |
| Photos | 6 photos reviewed · nameplate, spindle, control panel, table, enclosure, site | Checked (ok) |
| Document consistency | Invoice, purchase agreement and photos consistent | Checked (ok) |
| Inspected condition | Operational · minor wear on spindle housing · 4,120 h | Checked (ok) |
| Location evidence | Site visit · Demo Manufacturer facility, Ohio | Checked (ok) |
| Maintenance evidence | Log reviewed · gap Q2 2025 · borrower explanation attached | Checked · noted (pend) |
| Ownership / lien | Purchase agreement and invoice reviewed · no registry search | Reviewed documents (neu) |

### 4.5 Evidence completeness (policy CP-2026-CNC-01; L1154–1157)

| Label | Mark / color | Right |
|---|---|---|
| Inspection report · attested | ✓ ok | v2 · ATT-001 |
| Dealer invoice | ✓ ok | v1 |
| Equipment photos | ✓ ok | v1 · 6 files |
| Maintenance log | ✓ **pend** | v1 · gap noted |
| Purchase agreement | ✓ ok | v1 |
| Insurance certificate | · neu | Not required · policy |

### 4.6 Activity / audit events (`ev(t, ref, e, a, chg, ver, commit, kind)`, L1160–1188). Displayed newest-first.

| # | Time (UTC) | Ref | Event | Actor | State change | Version | Commit | Kind |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-09-01 08:40 | ASSET-DEMO-001 | Passport registered | Demo Manufacturer · Owner | DRAFT → REGISTERED | passport v1 | 19ee…02c4 · 18011 | Committed |
| 2 | 2026-09-01 09:05 | DOC-001, DOC-002 | Evidence uploaded · Equipment photos, Purchase agreement | Demo Manufacturer · Owner | — | v1 | — | Operational |
| 3 | 2026-09-02 11:20 | DOC-003 | Evidence uploaded · Dealer invoice | Demo CNC Dealer · Contributor | — | v1 | — | Operational |
| 4 | 2026-09-03 10:00 | VR-001 | Verification requested | Demo Manufacturer · Owner | — → REQUESTED | scope v1 | 2b71…8e10 · 18042 | Committed |
| 5 | 2026-09-04 08:15 | VR-001 | Assignment accepted | Demo Verifier | REQUESTED → IN_REVIEW | — | 5d20…1af3 · 18058 | Committed |
| 6 | 2026-09-06 16:30 | VR-001 | Changes requested · spindle photos and maintenance log | Demo Verifier | IN_REVIEW → CHANGES_REQUESTED | — | 77a9…c0d2 · 18090 | Committed |
| 7 | 2026-09-08 09:48 | DOC-004 | Evidence version added · Inspection report v2 | Demo Verifier | — | v1 → v2 | — | Operational |
| 8 | 2026-09-10 17:02 | ATT-001 | Attestation issued | Demo Verifier | IN_REVIEW → ATTESTED | evidence v2 | 9c4e…77b1 · 18131 | Committed |
| 9 | 2026-09-12 10:10 | CL-001 | Case created | Demo Manufacturer · Borrower | — → DRAFT | case v1 | a01f…3d9e · 18160 | Committed |
| 10 | 2026-09-12 10:35 | PKG-001 | Package shared with Demo Lender A · 5 documents | Demo Manufacturer + Demo CNC Dealer (consent) | NOT_SUBMITTED → SUBMITTED | package v2 | b8c2…5f77 · 18162 | Committed |
| 11 | 2026-09-13 09:00 | CA-001 | Review started | Demo Lender A · Analyst | SUBMITTED → IN_REVIEW | — | c3d0…9a12 · 18175 | Committed |
| A12 | 2026-10-01 12:30 | CA-001 | Assessment draft saved | Demo Lender A · Analyst | — | draft | — | Operational |
| B12 | 2026-09-18 15:22 | CA-001 | Collateral decision recorded · Eligible for this case | Demo Lender A · Approver | IN_REVIEW → ELIGIBLE | assessment v1 | 7c1d…40ab · 18207 | Committed |
| B13 | 2026-09-19 11:05 | FP-001 | Proposal issued | Demo Lender A · Approver | DRAFT → ISSUED | v1 | e5f6…22c8 · 18231 | Committed |
| B14 | 2026-09-20 08:50 | FP-001 | Proposal withdrawn and reissued · expiry corrected | Demo Lender A · Approver | ISSUED → WITHDRAWN · ISSUED | v1 → v2 | f00a…61d3 · 18240 | Committed |
| B15 | 2026-09-21 16:40 | FP-001 | Proposal accepted · exact version | Demo Manufacturer · Borrower | ISSUED → ACCEPTED | v2 | 11b7…9e4c · 18266 | Committed |
| B16 | 2026-09-22 14:05 | PL-001 | Pledge activated | Demo Manufacturer + Demo Lender A | AVAILABLE → ACTIVE | control v3 → v4 | 3f9a…c21e · 18310 | Committed |
| B17 | 2026-09-30 09:12 | RR-001 | Release requested · external loan completion | Demo Manufacturer · Borrower | ACTIVE → RELEASE_REQUESTED | — | 6ad8…0b3f · 18402 | Committed |
| out | 2026-10-01 14:33 | RR-001 | Release authorized | Demo Lender A · Approver | RELEASE_REQUESTED → RELEASED | control v4 → v5 | 8e2b…d410 · 18423 | Committed |
| out | 2026-10-01 14:33 | RR-001 | Release rejected · lock remains active | Demo Lender A · Approver | RELEASE_REQUESTED → RELEASE_REJECTED | — | 8e2b…d410 · 18423 | Committed |
| out | 2026-10-01 14:33 | CA-001 | Collateral decision recorded · Eligible for this case | Demo Lender A · Approver | IN_REVIEW → ELIGIBLE | assessment v1 | 8e2b…d410 · 18423 | Committed |
| out | 2026-10-01 14:33 | CA-001 | Collateral decision recorded · Rejected for this case | Demo Lender A · Approver | IN_REVIEW → REJECTED | assessment v1 | 8e2b…d410 · 18423 | Committed |

Rows 1–11 are always present. A12 is added in Lender review, B12–B17 in Release review, and an "out" row once its matching outcome is set. The `kind` "Pending" color is defined but never produced.

**Identifier vocabulary** (useful for domain types):
- `CL-` case, `ASSET-DEMO-` asset/passport, `DOC-` document, `PKG-` evidence package, `VR-` verification request, `ATT-` attestation
- `CA-` collateral assessment, `FP-` financing proposal, `PL-` pledge/lock, `RR-` release request, `RPT-` report
- `GP-` governance proposal, `VER-` verifier registry entry, `CP-2026-CNC-01` credit policy, `LOAN-DEMO-001` external loan ref
- Namespace `collara-localnet`. Control versions `v3 → v4 → v5`. Ledger offsets ~18011–18423.

**State vocabulary seen:**
- Passport: DRAFT, REGISTERED
- Verification: REQUESTED, IN_REVIEW, CHANGES_REQUESTED, ATTESTED
- Case: DRAFT
- Package: NOT_SUBMITTED, SUBMITTED
- Assessment: IN_REVIEW, ELIGIBLE, REJECTED
- Proposal: DRAFT, ISSUED, WITHDRAWN, ACCEPTED
- Control/pledge: AVAILABLE, ACTIVE, RELEASE_REQUESTED, RELEASE_REJECTED, RELEASED
- Registry: ACTIVE, SUSPENDED

### 4.7 Financing and valuation figures

- CL-001: valuation **USD 150,000.00** (2026-09-10). Requested/proposal principal **USD 105,000.00**. Ratio **70.0%** = policy maximum ("Advance rate under policy CP-2026-CNC-01: 70% of valuation"). Term "36 months · metadata only". FP-001 v2 expiry 2026-10-05.
- Overview totals are given in §3.1.
- **Conflict with the brief §9:** "Illustrative valuation: USD 150,000; requested principal: USD 100,000." The prototype uses **105,000** (70%). One of them must be chosen; the brief is authoritative, so use 100,000 (≈66.7%) unless product decides otherwise.

### 4.8 Governance fixtures (L1212–1271)

- Seats: **1** Demo Lender A (you, "Approver mandate"), **2** Demo Lender B ("Approver mandate"), **3** Demo Auditor ("Audit lead mandate"). All "2026-08-01 · genesis". Threshold `THRESH = 2`. A proposal is rejected when `rejections > seats − THRESH` (i.e. ≥ 2).

| ID | Type | Target / targetId | Scope | Proposer | Opened → Expires | Votes (seat: vote, time) | Executed | Derived state |
|---|---|---|---|---|---|---|---|---|
| GP-004 | Add verifier | Demo Calibration Lab / VER-004 (reserved) | Industrial equipment inspection · calibration | Demo Lender B | 2026-09-28 10:14 → 2026-10-12 10:14 | 2: Approved 2026-09-28 10:14 | — | Open · 1 of 3 approvals |
| GP-003 | Suspend verifier | Demo Inspection Partners / VER-002 | Industrial equipment inspection | Demo Auditor | 2026-09-20 09:30 → 2026-10-04 09:30 | 3: Approved 09-20 09:30; 1: Rejected 09-21 15:02; 2: Rejected 09-22 08:45 | — (closed 2026-09-22 08:45) | Rejected · 2 of 3 |
| GP-002 | Suspend verifier | Demo Field Audit Co / VER-003 | Site audit · asset location | Demo Lender A | 2026-09-12 14:00 → 2026-09-26 14:00 | 1: Approved 09-12 14:00; 2: Approved 09-15 11:20 | Demo Lender B, 2026-09-15 11:21 | Executed · 2026-09-15 11:21 |
| GP-001 | Add verifier | Demo Inspection Partners / VER-002 | Industrial equipment inspection | Demo Lender A | 2026-08-20 09:00 → 2026-09-03 09:00 | 1: Approved 08-20 09:00; 3: Approved 08-21 10:05 | Demo Lender A, 2026-08-21 10:06 | Executed · 2026-08-21 10:06 |

Rationales and effects (verbatim):
- **GP-004** — "Second inspection capacity for CNC equipment in the Midwest region. Onboarding checklist complete; sample inspection reviewed by Demo Lender B." / "Demo Calibration Lab is added to the registry as ACTIVE and becomes assignable to verification requests."
- **GP-003** — "Late response on a sample re-inspection request. Two seats judged the issue operational rather than a competence or integrity concern." / "None. VER-002 remains ACTIVE."
- **GP-002** — "Inspector accreditation lapsed on 2026-09-10. Suspension until renewed accreditation is filed." / "VER-003 set to SUSPENDED. Existing attestations remain valid; no new assignments can be accepted."
- **GP-001** — "First registry expansion after LocalNet genesis. Onboarding checklist and sample inspection reviewed." / "VER-002 added as ACTIVE."

Registry (`regBase`):

| ID | Org | Status | Since · via | Scope | Assignments | Attestations |
|---|---|---|---|---|---|---|
| VER-001 | Demo Verifier | Active | 2026-08-01 · genesis | Industrial equipment inspection | 1 active · VR-001 | 1 · ATT-001 |
| VER-002 | Demo Inspection Partners | Active | 2026-08-21 · GP-001 | Industrial equipment inspection | 0 | 0 |
| VER-003 | Demo Field Audit Co | Suspended | 2026-09-15 · GP-002 | Site audit · asset location | 0 | 0 |

- Add candidate for "Propose verifier": `{ id: 'VER-005 (reserved)', org: 'Demo Metrology Services', scope: 'Dimensional metrology · CNC equipment' }`.
- New proposals get IDs `'GP-00' + (5 + govNew.length)`, opened "just now", expiring "2026-10-15 14:33", and are pre-approved by seat 1.
  - Add rationale: "Proposed by Demo Lender A from the governance screen. Onboarding checklist attached for review by the other seats."
  - Suspend rationale: "Proposed by Demo Lender A from the verifier registry. Operational review requested; reason attached for the other seats."
- Initial "Votes cast": seat 1 = 3, seat 2 = 3, seat 3 = 2.

### 4.9 Constants shown in chrome

- Ledger offset **18422**
- Synced **2026-10-01 14:32:05 UTC**
- Network **LocalNet**
- Simulated decisions at **2026-10-01 14:33 UTC**, offset **18423**

---

## 5. Interaction and state logic

### 5.1 State (L1052)

```js
state = { screen: 'overview', caseTab: 'Summary', assetTab: 'Overview', reviewTab: 'Assessment', auditTab: 'Events',
  caseView: 'All', navOpen: false, modal: null, toast: null, releaseOutcome: null, reviewOutcome: null,
  govTab: 'Verifier registry', govProposal: 'GP-004', govVotes: {}, govExec: {}, govNew: [] };
```
- `screen` takes one of `overview | cases | case | asset | review | pledge | audit | gov | govp`.
- `go(screen, extra)` sets `{screen, navOpen:false, ...extra}`. Tab states persist across screens. Only `goCase` resets `caseTab` to Summary. `goCases(view)` sets `caseView`.
- `tabs(list, cur, key)` creates `{label, select, color, border}`. `is(list, cur)` creates a boolean map keyed by the **first word** of each label (so 'Verifier registry' → `Verifier` and 'Verification scope' → `Verification`; the latter is patched with `.Scope`).
- `reviewOutcome` is `null | 'eligible' | 'rejected'` (only used in moment A). `releaseOutcome` is `null | 'released' | 'rejected'` (only used in moment B). State is **not** reset when the moment tweak changes.

### 5.2 Derived flags (L1070–1079)

`B = demoMoment==='Release review'`; `released = B && releaseOutcome==='released'`; `rejected = B && releaseOutcome==='rejected'`; `approvedNow = !B && reviewOutcome==='eligible'`; `rejectedNow = !B && reviewOutcome==='rejected'`; `reviewClosed = B || approvedNow || rejectedNow`; `isApprover = mandate==='Lender Approver'`.

### 5.3 CL-001 state matrix (6 reachable scenarios)

Scenario names: **A0** Lender review (initial) · **A+** approved now · **A−** rejected now · **B0** Release review (initial) · **Bx** release rejected · **Br** released.

| Field | A0 | A+ | A− | B0 | Bx | Br |
|---|---|---|---|---|---|---|
| stage pill | Lender review (pend) | Proposal (pend) | Rejected (bad) | Release review (pend) | Release review (pend) ⚠ | Closed · released (neu) |
| st.evidence | Complete · 5 documents (ok) | = | = | = | = | = |
| st.verification | Attested · valid to 2027-03-10 (ok) | = | = | = | = | = |
| st.review | In review (pend) | Eligible for this case (ok) | Rejected for this case (bad) | Eligible for this case (ok) | = | = |
| st.proposal | Not issued (neu) | Not issued | Not issued | Accepted · v2 (ok) | = | = |
| st.pledge | Available · no lock (neu) | = | = | Active · release requested (pend) | Active · release rejected (ok) | Released (neu) |
| nextActor | Demo Lender A · Analyst | Demo Lender A · Approver | Demo Lender A · Analyst ⚠ | Demo Lender A · Approver | = ⚠ | — |
| nextAction (button) | Open collateral review | Issue proposal | Open collateral review ⚠ | Decide release request | = ⚠ | Export case history |
| nextGo | → review | → caseTab Proposal (dead end) | → review | → pledge | → pledge | → audit |
| currentStep | Lender review of the shared evidence package PKG-001 v2. | Collateral decision recorded. Proposal can be issued by the approver. | (A0 text) ⚠ | Lender decision on release request RR-001. | = ⚠ | Lock released. Case can be closed after dependency check. |
| blocker | Assessment not yet submitted for approval | Proposal not yet issued | (A0 text) ⚠ | None · awaiting approver decision | = ⚠ | None |
| assessmentState | Draft saved 2026-10-01 12:30 UTC | Recorded · v1 | Recorded · v1 | Recorded · v1 | = | = |
| decisionState | Pending approver mandate | Eligible · recorded just now | Rejected for this case · just now | Eligible · recorded 2026-09-18 | = | = |
| proposalRef | Not issued | Not issued | Not issued | FP-001 v2 · accepted | = | = |
| pledgeRef | Control v3 · available | = | = | PL-001 · active | = | PL-001 · released |
| auditorGrant | No grant | = | = | = | = | Scoped grant · CL-001 · to 2026-12-31 |
| outcomeDefault | Needs information | Eligible for this case | Rejected for this case | Eligible for this case | = | = |
| controlVersion (tech IDs) | v3 | v3 | v3 | v4 | v4 | v4 ⚠ (should be v5) |
| queue tags | mine, review | mine | — | mine, release | mine | — |
| queue "Last update" | 2h ago | just now | just now | 1d ago | just now | just now |

Prerequisites for pledge activation (`prereq(l, done, sub)`; ✓/ok when done, ·/pend otherwise):

| Prereq | A0 / A− | A+ | B* |
|---|---|---|---|
| Lender-authorized collateral decision | · Pending approver (⚠ even after rejection) | ✓ CA-001 · just now | ✓ CA-001 · 2026-09-18 |
| Proposal issued and accepted (exact version) | · Not issued | · Not issued | ✓ FP-001 v2 · 2026-09-21 |
| Attestation valid at activation | ✓ ATT-001 · to 2027-03-10 | ✓ | ✓ |
| Evidence snapshot matches attested versions | ✓ PKG-001 v2 | ✓ | ✓ |
| Asset control available (no active lock) | ✓ ASSET-DEMO-001 v3 | ✓ | · Consumed 2026-09-22 |

Pledge object `pl` (L1120–1135): see §3.6. The headline and sub for **Bx** stay "Active lock · release requested" / "The collateral lock remains active while the request is reviewed." ⚠

### 5.4 Overview counts (L1208)

`counts.review/evidence/approval/release` = number of queue rows tagged with that tag. `counts.active` = rows whose pledge label starts with "Active". The "My actions" view = rows tagged `mine`.

### 5.5 Simulated command lifecycle (`commit(after, doneText, pendingText)`, L1060–1065)

1. Close the modal and show the pending toast ("Submitted. Waiting for ledger confirmation.").
2. After **1600 ms**, merge `after` into state and show the done toast ("Confirmed on the ledger.").
3. After **5200 ms**, clear the toast.

Both timers are stored in `this._t1`/`this._t2`, and **a second commit within 1.6s cancels the first commit's state change** (lost update). `after` objects are built from the `s` captured at render time (stale-closure risk for `govVotes`/`govExec`/`govNew`). Nothing is idempotent and there is no failure path: every action "succeeds". In the rebuild, map this to the brief's PREPARED → SUBMITTED → COMMITTED → PROJECTED lifecycle with rejected, unknown-outcome and projection-delayed states (`CommandStatus`).

### 5.6 Action catalogue

| UI action | Where | Who | Simulated? | Effect |
|---|---|---|---|---|
| Approve eligibility | Review › Assessment / Decision | Approver | yes (dialog → commit) | A0 → A+. Switches to the Decision tab |
| Reject for this case | Review › Assessment / Decision | Approver | yes | A0 → A−. Decision tab |
| Submit for approval | Review › Assessment | Analyst | **no handler** | — |
| Request information / Save assessment | Review | both | **no handler** | — |
| Issue proposal | Case › Proposal | — | **not implemented** (button always disabled) | — |
| Borrower acceptance / Activate pledge | — | — | **not implemented** (B scenario is pre-baked) | — |
| Request release | — | (borrower) | **not implemented** (RR-001 pre-baked) | — |
| Authorize release | Pledge | Approver | yes | B0 → Br |
| Reject release | Pledge | Approver | yes | B0 → Bx |
| Export case report | Audit | both | yes | Toast, and the Exports tab opens. No new row |
| Download / Request correction / Review package / Export accessible records / Review sharing | various | — | **no handler** | — |
| Grant access | Sharing | — | disabled ("controller only") | — |
| Filters / searches / ⌘K / notifications / settings / org switcher | shell, queue, audit | — | **inert** | — |
| Click CL-002…CL-005 rows or actions | Overview, Cases | — | `noop` toast | — |
| Approve / Reject governance proposal | Gov proposal | Approver, Open, not yet voted | yes | `govVotes[id]` |
| Execute governance proposal | Gov proposal | Approver, Threshold met | yes | `govExec[id]`; registry adds an Active verifier or suspends the target |
| Propose verifier (Demo Metrology Services) | Gov › Proposals | Approver, once | yes | New GP-005, pre-approved by seat 1 |
| Propose suspension | Gov › Registry row | Approver, Active verifier, no open suspension | yes | New GP-00n |

### 5.7 Governance engine (L1223–1250)

For each proposal (new ones first, then GP-004…GP-001):
1. `votes` = fixture votes, with seat 1 overridden by `govVotes[id]` (timestamped "just now").
2. `executed` = fixture value, or `['Demo Lender A','just now']` if `govExec[id]`.
3. `status` = `Executed` if executed. Otherwise `Rejected` if rejections > 1. Otherwise `Threshold met` if approvals ≥ 2. Otherwise `Open`. `open` = Open or Threshold met.
4. `stateLabel`: "Executed · {time}" | "Rejected · {n} of 3" | "Threshold met · ready to execute" | "Open · {n} of 3 approvals".
5. `members[]`: seat, org (+ " (you)"), vote (Approved/Rejected/Pending), time or "—", color, and bar segment color.
6. `canVote` = approver && Open && seat 1 has no vote. `canExecute` = approver && Threshold met.
7. `execLine`: "Executed · {who} · {when}" | "Not executed · any seat may execute" | "Not executed · proposal closed" | "Not executed · {n} more approval(s) needed".
8. `note`:
   - Analyst: "The governance seat for Demo Lender A is held by the approver mandate. Your mandate can view proposals but cannot vote or execute."
   - Executed: "Executed by {who} at {when}. The registry change is applied in the simulation."
   - Rejected: "Closed. {n} of 3 seats rejected, so the 2-of-3 threshold cannot be reached."
   - Seat 1 voted while still open: "Your vote: {vote}. Awaiting {pending orgs joined by ' and '}."
9. `activity`: "Proposal opened" (by the proposer), then "Approval recorded"/"Rejection recorded" ("{org} · seat n"), then "Proposal closed · threshold unreachable" (Governance set, if a `closed` time exists), then "Executed · registry updated". Sorted ascending with "just now" last, then reversed.

**Simulation limits:** seats 2 and 3 never vote, so self-created proposals (pre-approved by seat 1) and a GP-004 rejected by seat 1 stay Open forever. Only GP-004 (approve → threshold met → execute) completes the loop.

### 5.8 Role/mandate visibility rules implemented

| Surface | Lender Approver | Lender Analyst |
|---|---|---|
| Review › Assessment action bar | Reject for this case, Approve eligibility | Submit for approval (inert) |
| Review › Decision (open) | Approve / Reject / Request information | Notice: "Your mandate (Lender Analyst) does not include collateral approval. Submit the assessment for approval by Morgan Hale." |
| Pledge › Release decision (pending) | Authorize / Reject / Request information + mandate text | Notice "Release requires the designated lender's authorization. Your mandate (Lender Analyst) does not include release approval. Approver: Morgan Hale." + Request information |
| Governance vote / execute / propose / suspend | allowed per state | hidden. Note explains the seat is held by the approver mandate |
| Overview GP-004 action row | shown (vote or execute) | hidden |
| Banner, org switcher, drawer footer, dialog "Acting party" | "Lender Approver" | "Lender Analyst" |

Not role-aware (inconsistencies):
- Avatar initials "MH".
- The CL-004 "Approve or reject collateral eligibility" action shows for the analyst.
- CL-004 "Next actor: Demo Lender A · Approver" and the CL-001 "Review evidence package…" action both show to the approver.
- The case `nextActor` in A0 is "Analyst" even when the approver is viewing.
- Org-level visibility (Lender B / verifier / borrower / auditor views) is **not** modeled at all. The page is lender-only. The brief requires borrower, verifier and auditor views.

### 5.9 Bugs and inconsistencies (fix or consciously decide in the rebuild)

1. **Status colors never render** (§1.2). All badges are plain text.
2. **`{{ cs.auditGrant }}` is unresolved** (L390; the script defines `auditorGrant`). The Sharing › Demo Auditor › Status cell is always blank.
3. **Issue-proposal dead end:** after approval, the CTA "Issue proposal →" opens the Proposal tab, whose only button is permanently disabled ("Issue proposal · requires recorded decision"), even though the decision is now recorded.
4. **No path between moments:** proposal issue, borrower acceptance, pledge activation and release request are not interactive. Scenario B is a separate pre-baked fixture. The brief's walkthrough needs all of them.
5. **Stale text after release rejection (Bx):**
   - The stage still reads "Release review".
   - nextAction is still "Decide release request", and currentStep/blocker still say "awaiting approver decision".
   - The pledge headline/sub still say "release requested".
   - The CL-001 queue row keeps the `mine` tag.
6. **Stale text after collateral rejection (A−):**
   - currentStep, blocker, nextAction and nextActor still show the A0 (in-review) values.
   - The decision prereq says "Pending approver".
   - The **Decision tab headline says "Eligible for this lender and case…"**.
   - The closed-review message cites "2026-09-18" and commit "7c1d…40ab · offset 18207" (scenario B values) for decisions made "just now" (14:33, commit 8e2b…d410 · 18423).
7. The Assessment right-hand card always states "Eligible for this lender and case…", even while pending or after rejection. The "Decision pending" copy says the assessment "recommends Eligible for this case" while the outcome select defaults to "Needs information". The derived figures are static, and the form stays editable after the review closes.
8. `controlVersion` is not v5 after release. The tech-ID row shows `#v4`.
9. Overview figures **sum principal and valuation across cases** (285,000 / 410,000), contradicting the Review screen copy "Neither is summed with other cases or currencies". Decide whether portfolio totals are allowed (and per-currency).
10. "Ledger synced · offset 18422 · 14:32:05" is static everywhere. After a simulated commit at offset 18423, the UI still claims sync through 18422 (no projection-delay modeling).
11. Pledge nav/tile goes to a single detail page. There is no pledges list, and "Assets" also has no list. In scenario A the "pledge" page is the `CONTROL-ASSET-DEMO-001` control, with a breadcrumb leaf "CONTROL-ASSET-DEMO-001" and raw-enum pill casing ("AVAILABLE", "ACTIVE · RELEASE_REQUESTED"), inconsistent with the sentence-case chips elsewhere.
12. The active nav item is lost on the `case`, `review` and `govp` screens.
13. Clicking inside the mobile drawer panel closes it (event bubbling). The drawer omits saved views and settings.
14. Asset › Activity shows the full case activity, including lender-internal events ("Assessment draft saved", collateral decision). A passport-level feed should be scoped to asset/passport/verification/control events.
15. **Fixture inconsistencies:**
    - Verification event chain goes IN_REVIEW → CHANGES_REQUESTED (09-06), then "IN_REVIEW → ATTESTED" (09-10), missing a return to IN_REVIEW.
    - No upload events for the maintenance log (DOC-005?) or inspection report v1.
    - The verifier's checks say it reviewed the purchase agreement, but the verifier sharing grant is "4 documents · no loan terms" and the purchase agreement's scope excludes Demo Verifier.
    - "Verifier seat 1" as an uploader name collides with governance "seat" terminology.
    - RPT-0007's watermark (offset 18402, 2026-09-30) also shows in scenario A, where CL-001 has no events past 18175.
    - Principal 105,000 conflicts with the brief's 100,000.
16. `nextGpId()` builds `'GP-00' + n`, giving "GP-0010" at n=10 (string concat). The proposal "expires" value is a hard-coded date, not opened+14d.
17. Governance simulation can deadlock (§5.7), and a GP-004 rejection by seat 1 leaves it Open.
18. `commit()` lost-update and stale-closure issues (§5.5). The confirm button is not disabled after click.
19. Static `<title>` for every screen. There are no URLs, so there is no back-button support or deep-linking.
20. The demo banner claims "LocalNet" while everything is client-side (see the brief's mode labels). The toast "Confirmed on the ledger." claims ledger confirmation for a UI simulation. **The rebuild must not show ledger-confirmed copy in UI_MOCK mode** (brief §5: "Do not silently fall back… to simulated success").

---

## 6. Component inventory: prototype fragments → target primitives

| Target primitive | Prototype source | Props / variants to support | Notes |
|---|---|---|---|
| **AppShell** | L26–L48, L1026–1047 | `mode` (UI_MOCK / LOCALNET) for the banner, org, mandate, sync status | Use `100dvh` and a `<main>` landmark. Hosts the banner, sidebar, header, drawer, dialog portal and toaster |
| DemoModeBanner (extra) | L28–31 | label, message, mode | Text per brief: "Synthetic demo data — UI mockup." / "…— Canton LocalNet." |
| **Sidebar** | L34–58 | navItems {label, href, icon, count, active-match}, savedViews, footer sync status | Use Lucide icons. Keep the 232px width, 34px items and mono counts. Active state by route prefix (fix bug 12). Render as `<nav aria-label>` with `aria-current` |
| OrgSwitcher (extra) | L36–39 | org name, initials, mandate, menu of memberships | Make it a real menu (Radix DropdownMenu). In demo mode it switches the isolated demo session |
| SyncStatus / LedgerSyncIndicator (extra) | L55–56, L92, L194, L642 | network, offset, syncedAt, state (synced / syncing / delayed) | One shared component fed by the projection checkpoint. Also covers the "committed-but-syncing" state |
| **WorkspaceHeader** | L61–72 | breadcrumbs, search, network chip, notifications, user menu | Breadcrumbs as `<nav aria-label="Breadcrumb">` with `<ol>`. Search becomes a labeled combobox or ⌘K command palette (or drop the hint). Initials come from the session user |
| MobileNavDrawer (extra) | L74–84 | open state | Radix Dialog/Sheet with focus trap, Esc, and `aria-expanded` on the trigger |
| **PageHeader** | L90–93, L133–136, L736–739, L810–817 (list); L185–196, L416–425, L509–515, L637–643, L957–964 (detail) | title, mono id, status, subtitle, meta, actions, eyebrow | Two variants: `list` and `detail` (detail adds a status pill, a next-actor block and sync meta) |
| StatTile / KpiTile (extra) | L95–99, L823–826 (large, clickable); L198–202 (mini) | label, value (mono), footer, href | Make the big tile a link, not a button containing divs |
| **CaseTable** | L137–178 (+ view tabs, filters, empty state) | columns (Case ID, Asset+ID, Borrower, Verification, Lender review, Pledge, Next actor, Last update), saved views with counts, search/filters, row link | TanStack Table. Each row has a real `<a>` to `/app/cases/CL-001`. Counts come from the server (same permission filter) |
| **StatusBadge** | `chip()` L1054 + pills L187/L418/L511/L639 + every status cell | `tone`: ok / pend / bad / neu / info; `variant`: dot-text (cells) / pill (headers); label | Always text plus a dot/icon, never color alone. Map states to tones via the tables in §4/§5.3. Use sentence-case labels and keep raw enums for tech-ID mode |
| **CaseTimeline** | L399–409 (case activity), L497–502 (asset), L625–630 (review), L120–125 (recent), L1011–1016 (gov) | events {t, ref, event, actor, stateChange, version, commit, kind}, compact / full | Distinguish Committed vs Operational (and Pending/Unknown for commands). Use an ordered `<ol>` with `<time>` |
| AuditEventTable (extra) | L755–782 | the 8 columns from §3.7, filters | Shares the event DTO with CaseTimeline |
| **EvidenceList** | L252–283 (case, with review + actions), L470–481 (asset), L521–528 (completeness checklist) | docs {name, type, org, by, version, uploaded, integrity, review, scope}, `showReview`, `showActions` | Download goes through a server-authorized short-lived URL. Keep the integrity disclaimer copy |
| CompletenessChecklist / PrereqChecklist (extra) | L224–228, L651–653, L525–527 | items {label, state: done / pending / na, detail} | Replace the ✓/· glyphs with an icon plus sr-only state text |
| VerificationChecks + AttestationCard (extra) | L288–307, L483–489, L542–548 | attestation meta, checks, limitations | |
| **PermissionNotice** | L609, L710 (mandate notices), L459–466 (permitted actions), L326–330 (scope), L1240 (gov note), L394 (disabled "controller only"), L179 | `reason` (mandate / org / scope / simulation), message, approver name | Use for forbidden states too. Disabled actions should explain why (aria-describedby) |
| **CommandStatus** | Toast L1045–1047 + `commit()` L1060–1065 | commandId, status (prepared / submitted / committed / projected / rejected / unknown / projection-delayed), message | Inline per action, plus a toast (`role="status"`). Never "Confirmed on the ledger" without ledger evidence |
| **ConfirmationDialog** | L1026–1043 + `mk()` L1211; catalogue in §3.10 | title, body, facts {actingParty, record, effect}, caveat, confirmLabel, `danger`, onConfirm (mutation) | Radix AlertDialog with focus trap, Esc, labelled/described-by, loading state while submitting, and the confirm disabled once submitted |
| **EmptyState** | L177 ("No cases require your action."), L359–363 ("No proposal issued" + disabled CTA), L648 ("No active Collara lock") | title, body, action | |
| **ErrorState** | *(none in prototype; the only analogue is the `noop` toast L1195)* | kind (forbidden / expired-session / network / not-found / projection-delayed), retry | New design. Required by brief §5 |
| Card / Panel, SectionEyebrow, KeyValueList (extra) | `#16171D` cards; eyebrow pattern; label/value grids (130–170px) | | KeyValueList renders a `<dl>` |
| Tabs (extra) | L137–141, L204–208, L427–431, L516–520, L740–744, L828–832 | items, counts, active | Radix Tabs with roving focus, or route segments for case tabs (`/app/cases/[id]/evidence`) |
| FilterBar / FilterChip (extra) | L142–149, L746–753 | | Real filters bound to URL search params |
| Callout (NOTE / SIMULATION / INTERNAL tag / "you" tag) | L426, L818–821, L560, L237 | tone: warning / info | |
| ActionList "Needs your action" (extra) | L102–110 | | |
| FiguresCard (extra) | L112–119 | | Decide on portfolio-sum semantics (bug 9) |
| AssessmentForm (extra) | L552–588 | RHF + Zod; valuation (decimal string + currency), source, date (date input), limitations, internal notes, external checks, outcome, policy | Derived figures computed from the form |
| ProposalCard + VersionHistory (extra) | L337–355 | | |
| PledgeLockCard, ReleaseRequestCard, ReleaseDecisionPanel (extra) | L671–727 | | |
| Governance: RegistryTable, ProposalsTable, ApprovalProgress, SeatVoteList, SeatsTable, DecentralizationManagerCard (extra) | L834–1016 | | ApprovalProgress is a `role="img"` or meter with a text alternative |
| ParticipantsList, ReferencesList, SharingGrantsTable (extra) | L232–247, L376–392 | | |
| TechnicalIds (extra) | L189 | | Dev/demo toggle |

---

## 7. Accessibility issues to fix in the rebuild

Measured with WCAG 2.x contrast formulas (OKLCH converted to sRGB):

1. **Low-contrast text:**
   - `#676A75` is 3.32:1 on surface `#16171D`, 3.50 on app bg and 3.11 on toast. It is used 168 times at 11–12.5px (meta, footnotes, key labels, disabled text, placeholder). **Fails 1.4.3 (needs 4.5:1).** Lighten to about `#8A8D98` or larger.
   - `#4E515B` (sidebar "Saved views", breadcrumb "/") is 2.45:1. Fails.
   - `#6F727D` (neutral status) is 3.73:1 on surface. Fails for text; acceptable only for dots or icons with a text label.
   - Passing pairs: `#9A9CA6` is 6.5–7.1:1, `#F4F5F7` is about 16–17.8:1, and the accent text colors are 8–14:1.
2. **Danger confirm button:** white on `oklch(70% 0.17 25)` is **2.88:1** (fails). Use dark text or a darker red.
3. **Non-text contrast (1.4.11):**
   - Input borders (`rgba(255,255,255,.1)` on `#0F1014`) are about 1.2:1 against the surface. Card and control borders are 1.17–1.42:1.
   - The focus border `.3` is only 2.07:1 against the unfocused border.
   - Approval-progress empty segments are 1.32:1.

   Form fields need ≥3:1 boundaries or other affordances.
4. **Focus visibility (2.4.7):**
   - Inputs, textareas and selects set `outline:none`. The only cue is a subtle border change, and the **header and queue search inputs have no focus style at all**.
   - No component defines a focus-visible ring. Buttons rely on browser defaults on a dark UI.

   Add a consistent `focus-visible` ring (e.g. 2px `#F4F5F7`/info at 2px offset).
5. **Non-semantic interactive rows (2.1.1):** case-queue rows (L164) and governance proposal rows (L898) are `<tr onClick>`, which is not focusable or keyboard-operable. Use a link in the first cell (or a row-link pattern with a real `<a>`).
6. **Buttons used for navigation:**
   - Nav items, saved views, breadcrumb root, stat tiles, "Audit center →", ID links (ASSET-DEMO-001, CL-001) and reference rows are `<button>`s that change "pages". They should be `<a href>` (Next `Link`) so open-in-new-tab, history and screen-reader semantics work.
   - Stat tiles nest `<div>`s inside `<button>` (invalid phrasing content).
7. **Missing names and labels:**
   - The search inputs have only placeholders ("Search accessible records", "Search case ID or asset") and no `<label>`/`aria-label`.
   - The `⌕` and `▾` glyphs are not `aria-hidden`.
   - Empty `<th>` for action columns (L264, L795, L845, L894) has no sr-only label.
   - Arrow glyphs in labels ("Open queue →", "← All proposals") are read as "right arrow"; wrap them in `aria-hidden`.
   - The `◔` notifications button has an aria-label but no function.
8. **Tabs:** they are plain buttons with no `role="tablist"/"tab"/"tabpanel"`, `aria-selected` or arrow-key support. The active tab is conveyed only by color and underline.
9. **Navigation state:** no `aria-current="page"` on nav or breadcrumb. No skip link to main content. No `lang` on `<html>`. The document `<title>` never changes per screen (2.4.2).
10. **Dialog (L1026–1043):**
    - `role="dialog"` without `aria-modal`, `aria-labelledby` or `aria-describedby`.
    - No initial focus, focus trap, Esc-to-close or focus return.
    - Background content stays reachable.

    Use Radix AlertDialog.
11. **Mobile drawer:**
    - Not a dialog; no focus trap or Esc.
    - The menu button lacks `aria-expanded`/`aria-controls`.
    - Clicking inside the panel closes it.
12. **Live feedback:** the toast has no `role="status"`/`aria-live`. It auto-dismisses after 5.2s or 3.2s (2.2.1), which may be too fast. Command results should also persist inline.
13. **Color-only meaning (1.4.1):**
    - Prereq/completeness marks rely on a colored circle plus `✓`/`·`, and "·" carries no meaning for screen readers.
    - Vote states and governance progress segments are color-only.
    - The intended status dots must always carry text.

    Add sr-only state text ("Done", "Pending", "Not required").
14. **Disabled controls:** "Issue proposal · requires recorded decision" and "Grant access · controller only" use `disabled`, so they are unfocusable and the reason is only in the label. Prefer `aria-disabled` with a focusable explanation (PermissionNotice).
15. **Structure:**
    - Card titles ("Needs your action", "Participants", "Release decision"…) are `<div>`/`<span>`, not headings. Use `h2`/`h3` under each page `h1`.
    - Key/value grids should be `<dl>`.
    - Tables lack `<caption>` and `scope="col"`.
    - Lists of rows should be `<ul>`/`<ol>`.
16. **Forms:**
    - The "Required external checks" group is a text node, not a fieldset/legend.
    - The valuation date is a free-text input.
    - The amount has no `inputmode="decimal"` or format help.
    - The INTERNAL tag sits inside the label text, so it is read as part of the name. Prefer `aria-describedby`.
    - There is no error messaging or `aria-invalid`.
17. **Small text:** 10–11px mono uppercase labels (sidebar heading, kbd, INTERNAL tag, tech IDs) at low contrast. Raise to 11–12px with AA color.
18. **Motion and viewport:** `height:100vh` with an inner scroller hurts mobile browser UI (use `dvh`). The scroll container is not focusable for keyboard scrolling. Respect `prefers-reduced-motion` for the toast animation.
19. **Hidden functionality on mobile:** the header search is removed below 900px with no alternative entry point.

---

## 8. Conflicts with the brief and rebuild recommendations (summary)

1. **Mode labels:** the prototype says "Demo data — LocalNet". The brief requires "Synthetic demo data — UI mockup." / "Synthetic demo data — Canton LocalNet." and forbids simulated success in LOCALNET mode.
2. **Principal:** 105,000.00 in the prototype vs USD 100,000 in the brief. The valuation of 150,000 matches.
3. **Case tabs:** the prototype has Summary, Evidence, Verification, Review, Proposal, Pledge, Sharing and Activity. The brief names "Sharing & Access". Suggestion **(INFERRED)**: keep Summary and Pledge, and rename Sharing to "Sharing & access".
4. **Roles:** the prototype only models the Demo Lender A approver and analyst. The brief needs borrower, verifier, dealer (within case/evidence), auditor and Lender B (forbidden) views.
5. **Walkthrough gaps:** issue proposal, borrower acceptance, pledge activation and release request are absent. Only approve/reject eligibility, authorize/reject release, export and governance votes are simulated.
6. **Governance:** the seat set (Demo Lender A, Demo Lender B, Demo Auditor) is a product decision to confirm against the Decentralization Manager setup (brief: "three eligible members"). The "UI simulation" labeling is already compliant with brief §8's honesty rule and should stay until the real integration lands.
7. **Missing states** (brief §5): loading, forbidden, expired session, network error, pending command, delayed projection. Only "empty" exists in the prototype.
8. **Suggested routes** (INFERRED; "Workspace · /app" comes from the Mobile Preview):
   - `/app` (Overview)
   - `/app/cases?view=…`
   - `/app/cases/[caseId]/(summary|evidence|verification|review|proposal|pledge|sharing|activity)`
   - `/app/cases/[caseId]/review/(evidence|scope|assessment|decision|activity)`
   - `/app/assets/[assetId]/(overview|evidence|verification|cases|activity)`
   - `/app/pledges/[pledgeId]`
   - `/app/audit` and `/app/audit/exports`
   - `/app/governance/(registry|proposals|members)` and `/app/governance/proposals/[gpId]`

   Add list pages for assets and pledges.
