# Collara prototype: Landing, Docs, Mobile Preview reconstruction spec

Researched 2026-10-01. Target: Next.js App Router Server Components (Tailwind + CSS-variable tokens), per the master brief at `C:\Users\Pongo\Documents\Codex\2026-10-01\oke\outputs\collara-full-stack-master-prompt.md` (section 5, line 82: "1. Landing, Docs, and Request a Pilot." is priority 1).

## Sources and how to read this file

| Source | Size / lines | Read? |
|---|---|---|
| `C:\Collara\Collara Website\Collara Landing.dc.html` | 50,413 B, 325 lines | Entire file |
| `C:\Collara\Collara Website\Collara Docs.dc.html` | 60,659 B, 394 lines | Entire file |
| `C:\Collara\Collara Website\Collara Mobile Preview.dc.html` | 3,224 B, 40 lines | Entire file |
| `C:\Collara\Collara Website\support.js` | 69,150 B | Skimmed: template compiler, `style-*` pseudo classes, `sc-if`/`sc-for`, helmet |
| `C:\Collara\Collara Website\assets\collara-mark.png` | 1254x1254 RGBA, 384,138 B | Viewed |
| `C:\Collara\Collara Website\uploads\*` | design references | Viewed (see section 8) |
| `C:\Collara\Collara Website\Collara Dashboard.dc.html` | lines 1-60 only | Only to compare tokens |
| `C:\Collara\docs\_research\inputs\Collara Website Content Specification.txt` | older Indonesian copy | Read, used only to flag conflicts |

Conventions:
- **[READ]** means taken directly from the source, with line numbers.
- **[INFERRED]** means my interpretation or recommendation. It is not in the source.
- Copy inside `"..."` or code blocks is verbatim. The source uses these special characters, which must be kept: `—` (em dash), `→`, `·`, `×`, `≡`, `✓`, `|`, `&amp;` (shown as `&`).
- Line references point into the `.dc.html` files.

---

## 0. Prototype runtime primer (what the template syntax means)

[READ, support.js] The `.dc.html` files run on a small React-based runtime ("dc-runtime"). `support.js` loads `window.React`, parses the markup between `<x-dc>…</x-dc>`, and runs the `class Component extends DCLogic` found in `<script type="text/x-dc" data-dc-script>`.

| Prototype construct | Meaning (support.js) | Next.js translation [INFERRED] |
|---|---|---|
| `<helmet>…</helmet>` | Rewritten to `<sc-helmet>` (support.js:377-378) and injected into `<head>`: title, meta, font links, the page `<style>` | `export const metadata` + `app/(marketing)/layout.tsx` + `globals.css`; fonts via `next/font` |
| `style-hover="css"` | Builds a generated class `.scpN:hover{css !important}` (support.js:1567-1588, `createPseudoSheet`; `importantify`) | Tailwind `hover:` utilities, or CSS-module `:hover` rules |
| `{{ expr }}` | Interpolation from `renderVals()` (support.js:401-412 `compileAttr`) | JSX expressions |
| `<sc-if value="{{ x }}">` | Conditional render (support.js:646-659) | `{x && …}` |
| `<sc-for list="{{ arr }}" as="r">` | List render (support.js:611-645) | `arr.map(r => …)` |
| `hint-placeholder-*` | Streaming placeholders only | Ignore |
| `onClick="{{ fn }}"` | React onClick | Client component handler |
| `open="{{ true }}"` on `<details>` | Sets the React prop `open`, so the item starts expanded | `<details open>` |
| `class="l-…"` / `class="o-…"` | Plain classes, used only as hooks for the media queries in the helmet `<style>` | Tailwind responsive variants |

Everything else is inline `style="…"`. **There is no inline SVG on any of the three pages** (grep `<svg` = 0). The only image is `assets/collara-mark.png`.

The only client-side state is `menuOpen` (mobile menu) on both Landing (lines 309-322) and Docs (337-391). Docs also computes the permissions `matrix` and the `timeline` table in JS. Both are static data and are reproduced verbatim below. In Next.js the whole page can be a Server Component, with one small `'use client'` `MobileMenu` island. The FAQ uses native `<details>`, so it needs no JS.

---

## 1. Design tokens

### 1.1 Global base (Landing lines 18-25; Docs lines 16-21, identical except Docs adds `table{border-collapse:collapse}` and has no `summary`/`details` rules)

```css
html{scroll-behavior:smooth}
body{margin:0;background:#08090A;color:#F7F8F8;font-family:Geist,system-ui,sans-serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
*{box-sizing:border-box}
a{color:#F7F8F8;text-decoration:none}a:hover{color:#FFFFFF}
button{font-family:inherit}
summary{list-style:none}summary::-webkit-details-marker{display:none}   /* landing only */
details[open] .l-plus{transform:rotate(45deg)}                         /* landing only */
details[open] .l-sum{color:#F7F8F8}                                    /* landing only */
table{border-collapse:collapse}                                        /* docs only */
```
The page root wrapper is `<div id="top" style="min-height:100vh;background:#08090A;color:#F7F8F8;font-family:Geist,system-ui,sans-serif;overflow-x:clip">` (Landing line 30, Docs line 26).

Theme is dark-only. There is no light theme.

### 1.2 Fonts [READ]

```
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300..800&family=Red+Hat+Mono:wght@400;500&display=swap" rel="stylesheet">
```
- **Geist**, a variable font with weights 300-800. Weights actually used: 300 (the FAQ "+" glyph), 400 (default), 500 (headings, buttons, card titles; 51 uses per page), 600 (the "Collara" wordmark text). Fallback: `system-ui, sans-serif`.
- **Red Hat Mono**, weights 400 and 500. Fallback stack: `'Red Hat Mono',ui-monospace,monospace`. Used for eyebrows, numerals, IDs, status chips, and state names.
- The Mobile Preview page loads only `Geist:wght@400;500;600`.
- [INFERRED] In Next.js, use `next/font/google` (`Geist`, `Red_Hat_Mono` with `weight: ['400','500']`), or the `geist` npm package, so fonts are self-hosted. That avoids a third-party request, which is better for privacy and CSP. Expose them as `--font-sans` and `--font-mono`.

### 1.3 Color tokens: Landing and Docs (marketing palette) [READ, counts from grep]

Contrast ratios are computed (WCAG 2.x) against `#08090A` and `#0E0F11`. oklch hex values are computed sRGB fallbacks [INFERRED]. Keep the oklch originals as primary values.

| Proposed token | Value | Hex fallback | Used for | Contrast on #08090A / #0E0F11 |
|---|---|---|---|---|
| `--bg` | `#08090A` | | page background, step-circle fill, Why-Canton card bg, primary button text | — |
| `--bg-header` | `rgba(8,9,10,.72)` + `backdrop-filter:blur(14px)` | | sticky header | — |
| `--surface` | `#0E0F11` | | cards, preview window, Why-Canton band bg, participants strip, pilot card | — |
| `--surface-2` | `#111214` | | evidence rows inside hero preview | — |
| `--surface-docs` | `#0F1013` | | Docs filled callouts ("Project status", "Boundary.", demo moments) | — |
| `--fg` | `#F7F8F8` | | primary text, primary button bg | 18.73 / 18.02 |
| `--fg-hover` | `#FFFFFF` | | link hover, primary button hover bg | — |
| `--fg-faq-closed` | `#D0D1D4` | | closed FAQ summary text | 13.05 |
| `--fg-docs` | `#C9CBD3` | | Docs lead paragraph, KV values, inline-link color, "UI mockup" chip text | 12.30 |
| `--fg-muted` | `#9C9DA1` | | body copy, nav links, table headers | 7.36 / 7.08 |
| `--fg-subtle` | `#62666D` | | fine print, eyebrows (mono), numerals, footer legal, labels | **3.45 / 3.32 (fails AA for small text)** |
| `--fg-faint` | `#3E3E44` | | breadcrumb "/" separator in preview | 1.88 |
| `--fg-matrix-no` | `#3A3D44` | | "—" (not permitted) in Docs matrix | **1.83** |
| `--accent` (amber) | `oklch(82% 0.12 75)` | `#F2B966` | section eyebrows, glows, step 01 ring, stage pill | 11.30 |
| `--accent-hi` (amber light) | `oklch(88% 0.1 80)` | `#FAD18A` | step 01 numeral, "Illustrative demo case" chip text, pilot step numbers, "Planned" chip text | 13.81 |
| `--accent-banner` | `oklch(90% 0.08 80)` | `#FAD9A2` | Docs pre-build banner (label) | 14.72 |
| `--accent-banner-body` | `oklch(84% 0.06 80)` | `#DFC79F` | Docs pre-build banner (sentence) | 12.15 |
| `--success` (green) | `oklch(74% 0.13 155)` | `#5EC386` | "Attested" text, step-06 ring, connector-line end | 9.13 |
| `--success-hi` | `oklch(80% 0.12 155)` | `#7AD59C` | step 06 numeral, "Implemented" chip text | 11.22 |
| `--info` (blue) | `oklch(74% 0.1 250)` | `#79B0E8` | "Specified" chip border, governance callout | 8.72 |
| `--info-hi` | `oklch(84% 0.08 250)` | `#A3CFFD` | "Specified" chip text | 12.24 |

Alpha variants used [READ]:
- Amber: `/ .08` (stage pill bg; docs banner bg), `/ .1` (final-CTA glow), `/ .12` (hero chip bg), `/ .13` (hero preview glow), `/ .25` (docs banner bottom border), `/ .35` (stage pill border), `/ .45` (Planned chip border), `/ .5` (connector start), `/ .6` (step-01 ring).
- Green: `/ .45` (Implemented chip border), `/ .5` (connector end), `/ .6` (step-06 ring).
- Blue: `/ .08` (governance callout bg), `/ .28` (governance callout border), `/ .45` (Specified chip border).

### 1.4 Hairlines and borders (white alpha) [READ]

| Value | Landing uses | Docs uses |
|---|---|---|
| `rgba(255,255,255,.015)` | gradient on preview right pane (`linear-gradient(180deg, rgba(255,255,255,.015), transparent)`) | — |
| `rgba(255,255,255,.025)` | card hover inset glow | — |
| `rgba(255,255,255,.05)` | hover bg (ghost, secondary, menu items); preview inset top highlight | hover bg |
| `rgba(255,255,255,.06)` | card hover inset top highlight | table row dividers (54x), boundary callout border |
| `rgba(255,255,255,.07)` | header bottom border, section dividers, preview internal dividers, footer borders, Participants column dividers | header border, mobile sidebar divider, legend divider |
| `rgba(255,255,255,.08)` | card borders (default), FAQ dividers, problem grid top rule | card/table borders, table header rule |
| `rgba(255,255,255,.09)` | hero preview window border | — |
| `rgba(255,255,255,.1)` | hero eyebrow pill border, menu button border, Boundary tag, "Demo data" chip | menu button |
| `rgba(255,255,255,.12)` | mobile "Sign in" outline | "Not available" chip, mobile Sign in |
| `rgba(255,255,255,.14)` | secondary button border, FAQ "+" circle border, dashed evidence placeholder | dashed placeholder cards |
| `rgba(255,255,255,.16)` | card hover border | — |
| `rgba(255,255,255,.18)` | step 02-05 ring | "UI mockup" chip border |
| `rgba(255,255,255,.2)` | — | inline link underline (`border-bottom`) |
| `rgba(255,255,255,.22)` | secondary button hover border | — |

### 1.5 Radii [READ]

- Landing: `999px` (pills), `50%` (step circles, FAQ "+"), `14px` (hero preview window), `12px` (cards, participants strip, pilot card), `9px` (large buttons), `8px` (header buttons, nav items, evidence rows, dashed placeholder), `6px` (preview chips), `4px` ("Boundary" tag).
- Docs: `10px` (cards and table wrappers), `8px` (inline callouts, header buttons), `5px` (status chips).
- Proposed scale [INFERRED]: `--radius-xs:4px; --radius-chip:5px; --radius-sm:6px; --radius-md:8px; --radius-btn:9px; --radius-card-docs:10px; --radius-card:12px; --radius-window:14px; --radius-pill:999px`.

### 1.6 Shadows, glows, gradients [READ]

- Hero preview window: `box-shadow:0 40px 100px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.05)`.
- Card hover (all landing cards): `border-color:rgba(255,255,255,.16); box-shadow:inset 0 0 60px rgba(255,255,255,.025), inset 0 1px 0 rgba(255,255,255,.06)`, with `transition:border-color .2s,box-shadow .2s`.
- Hero top glow (line 64): `position:absolute;inset:0 0 auto 0;height:520px;background:radial-gradient(55% 50% at 50% 0%, rgba(255,255,255,.06), transparent 70%);pointer-events:none`.
- Hero preview amber glow (line 78): `position:absolute;left:15%;right:15%;top:-60px;height:300px;background:radial-gradient(50% 60% at 50% 30%, oklch(82% 0.12 75 / .13), transparent 70%)`.
- Final-CTA amber glow (line 280): `position:absolute;left:20%;right:20%;bottom:0;height:360px;background:radial-gradient(50% 60% at 50% 100%, oklch(82% 0.12 75 / .1), transparent 70%)`.
- Workflow connector (line 177): `linear-gradient(90deg, oklch(82% 0.12 75 / .5), rgba(255,255,255,.12) 40%, rgba(255,255,255,.12) 60%, oklch(74% 0.13 155 / .5))`.
- Docs uses no box-shadows.

### 1.7 Layout metrics [READ]

- Content max width: **1120px**, centered (`margin:0 auto`). Side padding is **32px** (`.l-pad`), or **20px** at ≤920px.
- Header: sticky, `top:0`, `z-index:50`, inner height **64px**, `gap:24px`, bottom border `rgba(255,255,255,.07)`.
- Landing section rhythm: `padding-top: clamp(80px,10vw,140px)` per section. The hero uses `clamp(72px,10vw,132px)`. The Why-Canton band uses `margin-top: clamp(80px,10vw,140px)` plus `padding: clamp(72px,8vw,110px) 0`. The final CTA uses `padding: clamp(96px,12vw,160px) 0 clamp(80px,10vw,140px)`.
- Section intro block: `max-width:760px`. Eyebrow, then H2 (`margin-top:16px`), then lead (`margin-top:20px`).
- Anchored sections have `scroll-margin-top:64px` (#product, #workflow, #for-lenders, #why-canton). #pilot and #faq do **not**.
- Sticky side columns (For lenders, FAQ): `position:sticky;top:96px` (`.l-stick`).
- Footer: `padding:56px 0 40px`. Legal line `margin-top:48px;padding-top:24px` with top border.
- Docs main container: `padding:56px 32px 96px`. Grid `220px minmax(0,1fr)`, `gap:56px`. Sidebar sticky `top:88px`. Content column `gap:80px` between sections. Each section is flex-column `gap:22px` with `scroll-margin-top:96px`. Card padding is `18px 20px`. Grid gaps are `14px`.

### 1.8 Text styles: Landing [READ]

| Style | Font | Size / line-height / tracking / weight | Color | Notes |
|---|---|---|---|---|
| Wordmark (header) | Geist | 17px / – / -0.01em / 600 | fg | Next to a 30px mark, gap 9px. The footer uses 16px with a 26px mark. |
| Nav link | Geist | 14px | #9C9DA1, hover #F7F8F8 | gap 26px |
| Hero eyebrow pill | Red Hat Mono | 11.5px, ls .07em, UPPERCASE | #9C9DA1 | border .1, radius 999, padding 6px 12px |
| H1 hero | Geist | `clamp(38px,6vw,74px)` / 1.02 / -0.035em / 500 | fg | `text-wrap:balance`, max-width 920, margin-top 28 |
| Hero lead | Geist | `clamp(16px,1.4vw,19px)` / 1.55 | #9C9DA1 | max-width 660, mt 26, `text-wrap:pretty` |
| Hero microcopy | Geist | 13.5px | #62666D | mt 26, then the second line mt 6 |
| Section eyebrow | Red Hat Mono | 11.5px, ls .08em, UPPERCASE | amber `oklch(82% 0.12 75)` | |
| H2 section | Geist | `clamp(28px,3.6vw,46px)` / 1.08 / -0.03em / 500 | fg | balance, mt 16 |
| H2 final CTA | Geist | `clamp(32px,4.4vw,56px)` / 1.04 / -0.035em / 500 | fg | max-width 760, mt 28 |
| Section lead | Geist | 17px / 1.6 | #9C9DA1 | mt 20, pretty |
| H3 card (Problem, Product) | Geist | 17px / – / -0.01em / 500 | fg | |
| H3 card (Lenders, Canton) | Geist | 16.5px / -0.01em / 500 | fg | |
| H3 workflow step | Geist | 15.5px / -0.01em / 500 | fg | |
| Participant title (div) | Geist | 15.5px / 500 | fg | |
| Card body L | Geist | 15px / 1.6 | #9C9DA1 | Problem, Product |
| Card body M | Geist | 14.5px / 1.6 | #9C9DA1 | Lenders, Canton |
| Card body S | Geist | 14px / 1.6 | #9C9DA1 | Workflow, Participants |
| Fine print | Geist | 14px / 1.6 (also 13.5px, 13px) | #62666D | boundary notes, disclaimers |
| Mono index | Red Hat Mono | 12px | #62666D | "01", "Fig. 1" |
| Mono label | Red Hat Mono | 11px, ls .08em, UPPERCASE | #62666D | preview labels, footer column heads |
| FAQ question | Geist | 17px / – / -0.01em / 500 | closed #D0D1D4, open #F7F8F8 | padding 20px 0 |
| FAQ answer | Geist | 15.5px / 1.65 | #9C9DA1 | padding 0 40px 22px 0 |
| Pilot step text | Geist | 16px | fg | number is mono 12px amber-hi |
| Button L primary | Geist | 15px / 500 | #08090A on #F7F8F8 | padding 12px 20px, radius 9, hover bg #FFF, `gap:8px`, `white-space:nowrap` |
| Button M primary | Geist | 15px / 500 | same | padding 11px 18px, radius 9 ("Discuss your workflow", pilot card) |
| Button S primary (header) | Geist | 14px / 500 | same | padding 8px 14px, radius 8 |
| Button L secondary | Geist | 15px | fg, border .14 | padding 12px 20px, radius 9, hover bg .05 and border .22. The arrow "→" is in a span colored #9C9DA1. |
| Ghost (Sign in) | Geist | 14px | #9C9DA1 | padding 8px 12px, radius 8, hover color fg and bg .05 |

### 1.9 Text styles: Docs [READ]

| Style | Spec |
|---|---|
| Section kicker | Red Hat Mono 11px, ls .08em, UPPERCASE, #62666D, e.g. `01 · Overview`. Shown in a row with status chips (gap 12, wraps). |
| Status chip (base) | Red Hat Mono 10.5px, ls .06em, UPPERCASE, `padding:2px 7px;border-radius:5px;border:1px solid …`; in tables also `white-space:nowrap` |
| Chip "UI mockup" / "UI simulation" | border `rgba(255,255,255,.18)`, text `#C9CBD3` |
| Chip "Specified" | border `oklch(74% 0.1 250 / .45)`, text `oklch(84% 0.08 250)` |
| Chip "Planned" / "LocalNet demo planned" | border `oklch(82% 0.12 75 / .45)`, text `oklch(88% 0.1 80)` |
| Chip "Implemented" | border `oklch(74% 0.13 155 / .45)`, text `oklch(80% 0.12 155)` |
| Chip "Not available" | border `rgba(255,255,255,.12)`, text `#9C9DA1` |
| H1 | `clamp(28px,3.4vw,38px)`, 500, ls -0.025em, lh 1.15, pretty |
| H2 | `clamp(24px,2.6vw,30px)`, 500, ls -0.02em, lh 1.2 |
| Lead (overview) | 16px / 1.65, `#C9CBD3`, max-width 680 |
| Lead (other sections) | 15px / 1.65, `#9C9DA1`, max-width 680 |
| Card | `padding:18px 20px;border-radius:10px;border:1px solid rgba(255,255,255,.08)`; title 14px/500; list 14px/1.7 #9C9DA1 `padding-left:18px` (13.5px in demo and governance) |
| Filled card | as above + `background:#0F1013` |
| Role card sub-label | Red Hat Mono 11px #62666D; body 13.5px/1.6 #9C9DA1 `margin-top:4px` |
| Table wrapper | `border:1px solid rgba(255,255,255,.08);border-radius:10px;overflow-x:auto`; table `width:100%` with `min-width` 560/640/760/700 |
| `th` | left (matrix role columns centered), 500, 12px, #9C9DA1, `padding:10px 14px` (matrix role cols `10px 10px`), `border-bottom:1px solid rgba(255,255,255,.08)` |
| `td` | `padding:11px 14px` (capability), `12px 14px` (workflow, `vertical-align:top`), `10px 14px` (matrix, events); `border-bottom:1px solid rgba(255,255,255,.06)` except the last row; first column 14px fg, others 13.5px #9C9DA1 |
| State text | Red Hat Mono 12px (11.5px in events), multi-line with `<br>` and lh 1.6 |
| KV grid (`.o-kv`) | `grid-template-columns:minmax(110px,max-content) minmax(0,1fr);row-gap:8px;column-gap:12px;font-size:13.5px;line-height:1.5`; key #62666D, value #C9CBD3; `margin-top:12px` |
| Inline link | `color:#C9CBD3;border-bottom:1px solid rgba(255,255,255,.2)` |
| Boundary callout | `<p>`: `padding:14px 16px;border-radius:8px;background:#0F1013;border:1px solid rgba(255,255,255,.06);font-size:13.5px;line-height:1.6;color:#9C9DA1` |
| Info callout (blue) | `padding:14px 16px;border-radius:8px;background:oklch(74% 0.1 250 / .08);border:1px solid oklch(74% 0.1 250 / .28);font-size:13.5px;line-height:1.6;color:#C9CBD3` |
| Placeholder card | `border:1px dashed rgba(255,255,255,.14)`, radius 10; title 14/500 #9C9DA1; body 13px/1.6 #62666D |
| Fine print | 13px / 1.6 #62666D |
| Sidebar link | 14px #9C9DA1, `padding:6px 0`, hover #F7F8F8 |

### 1.10 Responsive rules [READ verbatim]

Landing (lines 26-27):
```css
@media (max-width:920px){
 .l-desk{display:none!important} .l-mob{display:flex!important}
 .l-g6{grid-template-columns:repeat(2,minmax(0,1fr))!important} .l-conn{display:none!important}
 .l-g3,.l-g2,.l-g5,.l-prev,.l-foot{grid-template-columns:1fr!important}
 .l-g4{grid-template-columns:repeat(2,minmax(0,1fr))!important}      /* .l-g4 is not used by any element */
 .l-pad{padding-left:20px!important;padding-right:20px!important}
 .l-stick{position:static!important}
 .l-prevl{border-right:none!important;border-bottom:1px solid rgba(255,255,255,.07)!important}
 .l-foot{grid-template-columns:repeat(2,minmax(0,1fr))!important}     /* overrides the 1fr above, so the footer is 2 cols at <=920 */
}
@media (max-width:560px){
 .l-g4,.l-g6,.l-foot{grid-template-columns:1fr!important}
 .l-cta{flex-direction:column!important;align-items:stretch!important}
 .l-cta a{justify-content:center!important}
}
```
Class map: `.l-desk` = desktop nav and header buttons; `.l-mob` = menu button; `.l-g2/.l-g3/.l-g5/.l-g6` = 2/3/5/6-column grids; `.l-conn` = workflow connector line; `.l-prev` = hero preview 2-pane grid; `.l-prevl` = its left pane; `.l-stick` = sticky left columns; `.l-cta` = button rows; `.l-foot` = footer grid.

Docs (lines 22-23):
```css
@media (max-width:920px){
 .l-desk{display:none!important} .l-mob{display:flex!important}
 .l-pad{padding-left:20px!important;padding-right:20px!important}
 .o-grid{grid-template-columns:1fr!important}
 .o-side{position:static!important;flex-direction:row!important;flex-wrap:wrap!important;gap:4px 14px!important;padding-bottom:20px!important;border-bottom:1px solid rgba(255,255,255,.07)}
 .o-g2,.o-g3{grid-template-columns:1fr!important}
 .o-foot{grid-template-columns:repeat(2,minmax(0,1fr))!important}
}
@media (max-width:560px){ .o-foot{grid-template-columns:1fr!important} .o-kv{grid-template-columns:1fr!important;row-gap:2px!important} }
```
Tailwind mapping [INFERRED]: define custom screens `marketing-md: {max: '920px'}` and `sm-max: {max: '560px'}`, or work mobile-first with `min-width:921px` / `561px`. Keep 920 for the marketing pages. The dashboard uses 900 (see 1.11).

### 1.11 Differences vs the dashboard (Dashboard lines 13-22, 26-28) [READ]

| Aspect | Landing / Docs | Dashboard (`Collara Dashboard.dc.html`) |
|---|---|---|
| Page bg | `#08090A` | `#101116` |
| Primary text | `#F7F8F8` | `#F4F5F7` |
| Secondary text | `#9C9DA1` | `#9A9CA6` |
| Tertiary text | `#62666D` | `#676A75` (also `#4E515B` for sidebar section labels) |
| Surfaces | `#0E0F11`, `#111214`, `#0F1013` | sidebar `#0C0D11`; controls `#12131A`, `#16171D`, hover `#171821` |
| Breakpoint | 920px / 560px | 900px / 560px |
| Base font size | browser default (16px) | 14px on root container |
| `text-rendering` | `optimizeLegibility` | not set |
| Demo banner | Docs: amber "Pre-build" strip | amber "Demo data — LocalNet" strip (`/ .1` bg) |
| Same in both | Geist 300..800 + Red Hat Mono 400/500; amber/green/blue oklch accents; white-alpha hairlines `.07/.08`; radius 8 controls | |

The Mobile Preview canvas uses the dashboard palette (`#0B0C0E` bg, `#F4F5F7`, `#9A9CA6`, `#676A75`, device frame `#1A1B20`).

[INFERRED] Recommendation: one `packages/ui` token file with shared semantic names (`--bg`, `--surface`, `--fg`, `--fg-muted`, `--fg-subtle`, `--border`, `--accent`…), and two scopes: `[data-surface="marketing"]` (values above) and `[data-surface="app"]` (dashboard values). Alternatively, consolidate the two near-identical grays. This is a design decision to confirm (see Open questions).

---

## 2. Landing (`/`): section by section

### 2.0 Head / metadata (lines 10-16) [READ]
- `<title>`: `Collara — Private Equipment Collateral Workflows`
- `meta description`: `Coordinate used CNC equipment evidence, lender review, and authorized pledge and release workflows with Collara, built on Canton.`
- `og:title`: `Equipment evidence. Authorized collateral workflows.`
- `og:description`: `A private coordination workspace for lenders, equipment owners, and verifiers.`
- Missing: `lang`, favicon, `og:image`, canonical, twitter card.

### 2.1 Header (lines 32-61)
- `<header>`: sticky, top 0, z 50, bg `rgba(8,9,10,.72)`, blur 14px, bottom border .07. Inner row: max 1120, padding 0 32, height 64, flex space-between, gap 24.
- **Logo link** `href="#top"`: `<img src="assets/collara-mark.png" alt="Collara">` at 30x30, then `<span>` "Collara" (600, 17px, -0.01em). Gap 9.
- **Desktop nav** (`.l-desk`, 14px, gap 26, color #9C9DA1, hover #F7F8F8), in this order:
  1. `Product` → `#product`
  2. `Workflow` → `#workflow`
  3. `For Lenders` → `#for-lenders`
  4. `Why Canton` → `#why-canton`
  5. `Docs` → `Collara Docs.dc.html`
- **Desktop actions** (`.l-desk`, gap 6):
  - `Sign in` → `Collara Dashboard.dc.html` (ghost style)
  - `Request a pilot` → `/pilot` (small primary)
- **Menu button** (`.l-mob`, hidden on desktop): `aria-label="Toggle menu"`. Size 40x40, border 1px `rgba(255,255,255,.1)`, radius 8, transparent, 18px. Glyph `≡` when closed and `×` when open.
- **Mobile panel** (rendered while `menuOpen`, inside the header below the row): `border-top:1px solid rgba(255,255,255,.07);background:#08090A;padding:10px 20px 20px`, flex column, gap 2, 16px. Links (padding 12px 8px, radius 8, hover bg .05, color fg) are the same 5 as the desktop nav, and each calls `closeMenu`. Below them is a column (gap 8, mt 12) with:
  - `Sign in` → Dashboard: outline (`padding:12px;border:1px solid rgba(255,255,255,.12);border-radius:8px;font-size:15px`, centered)
  - `Request a pilot` → `/pilot`: filled (#F7F8F8 bg, #08090A text, 15px/500, centered)

### 2.2 Hero (lines 63-124), no id (page root is `#top`)
Centered column with glow (see 1.6). Content in order:
1. Eyebrow pill: `Private equipment collateral workflows` (rendered uppercase).
2. H1: `Equipment evidence and pledge workflows, coordinated privately.`
3. Lead: `Bring used CNC equipment evidence, verification, and lender review into one coordinated workflow. Share the relevant records with selected counterparties and track who can authorize each pledge and release.`
4. CTA row (`.l-cta`, gap 10, mt 36):
   - Primary L `Request a pilot` → `/pilot`
   - Secondary L `Read the workflow` + `<span style="color:#9C9DA1">→</span>` → `#workflow`
5. `<p>` 13.5px #62666D, mt 26: `Starting with used CNC financing. Built on Canton.`
6. `<p>` 13.5px #62666D, mt 6: `Collara is currently in development. We are seeking equipment-finance design partners.`

**Hero product preview ("Case workspace" mock window)** (lines 77-123). Container max 1120, `margin:72px auto 0`, padding 0 32, with the amber glow behind it. Window: `background:#0E0F11;border:1px solid rgba(255,255,255,.09);border-radius:14px;overflow:hidden` + shadow (1.6).
- **Title bar** (padding 12px 18px, bottom border .07, 12.5px #9C9DA1, flex space-between, wraps):
  - Left: mark 18x18 (`alt=""`), `Case workspace`, `/` (#3E3E44), `CL-001` (mono, fg).
  - Right chips (mono 11px, ls .03em, padding 4px 9px, radius 6):
    - `Demo data — LocalNet`: border `rgba(255,255,255,.1)`
    - `Illustrative demo case`: bg `oklch(82% 0.12 75 / .12)`, text `oklch(88% 0.1 80)`
- **Body grid** `.l-prev`: `grid-template-columns:1.25fr 1fr`.
  - **Left pane** `.l-prevl` (padding 26px 28px 28px, right border .07, column gap 22, left-aligned):
    - Mono label `Case`. Then 21px/500/-0.02em `Used CNC financing · CL-001`. Then 14px #9C9DA1 `CNC machining center · DEMO-CNC-500 · Serial SYNTH-CNC-001`.
    - Row: 13px #62666D `Current stage`, then pill `Awaiting lender review` (padding 5px 10px, radius 999, border `oklch(82% 0.12 75 / .35)`, bg `oklch(82% 0.12 75 / .08)`, 13px fg).
    - KV grid (`110px 1fr`, row-gap 12, col-gap 16, 14px, top border .07, pt 20). Keys are #62666D:
      - `Evidence` → `Inspection report · submitted`
      - `Verification` → `Attestation issued · scope available`
      - `Sharing` → `Shared with selected lender`
    - Footer row (top border .07, pt 20, space-between): 12px #62666D `Next action` over 14px #9C9DA1 `Demo Lender A · Credit analyst`. Right side is a non-interactive `<span>` styled as a primary button: `Review evidence →` (14px/500, padding 9px 14px, radius 8).
  - **Right pane** (padding 26px 28px 28px, column gap 18, bg `linear-gradient(180deg, rgba(255,255,255,.015), transparent)`):
    - Mono label `Evidence package · shared with Demo Lender A`
    - 3 rows (gap 6; each `padding:10px 12px;border:1px solid rgba(255,255,255,.07);border-radius:8px;background:#111214`; title 13.5px; meta 12px #62666D; status 12px right-aligned):
      1. `Inspection report` / `Demo Verifier · v2 · PDF` / `Attested` (green `oklch(74% 0.13 155)`)
      2. `Dealer invoice` / `Demo CNC Dealer · v1 · PDF` / `Hash verified` (#9C9DA1)
      3. `Equipment photos (6)` / `Demo Manufacturer · v1 · JPEG` / `Hash verified` (#9C9DA1)
    - Dashed document placeholder (`flex:1;min-height:96px;border:1px dashed rgba(255,255,255,.14);border-radius:8px`, centered 12px #62666D lh 1.5): `Sample inspection report fixture` `<br>` `Page 1 of 4 · synthetic document`
    - 2-col grid (gap 10, 12.5px): `Valuation (illustrative)` / mono 14px `USD 150,000`; `Requested principal (illustrative)` / mono 14px `USD 105,000`.
  - At ≤920 the panes stack, and the left pane gets a bottom border instead of a right border.

### 2.3 `#product`: "The problem" (lines 126-139)
- Eyebrow `The problem`
- H2 `The documents are digital. The coordination can still be fragmented.`
- Lead `Equipment financing can involve borrower records, dealer documents, inspection reports, and lender systems. When these records are reviewed separately, teams may need repeated follow-ups to confirm which evidence is current and who is responsible for the next step.`
- 3-col grid `.l-g3` (gap 0, mt 56, top border .08). Items have padding `28px 28px 8px 0` (the last item has 0 right padding). Each item is a mono index (12px #62666D), then an H3 (17px, mt 14), then a body paragraph (15px, mt 10):
  1. `01` / `Evidence across counterparties` / `Bring case-specific records together without making every document visible to every participant.`
  2. `02` / `Status without guesswork` / `Track verification, lender review, and pledge status as separate states instead of treating one approval as proof of everything.`
  3. `03` / `Clear authorization` / `Make the responsible party and required authorization explicit before a workflow transition is submitted.`
- Note: the nav label is "Product", but this id sits on "The problem" section. The next section (titled "Product") has no id.

### 2.4 Product (no id) (lines 141-168)
- Eyebrow `Product`
- H2 `One case workspace. Defined responsibilities.`
- Lead `Collara connects an equipment passport with its supporting evidence, verification scope, lender decision, and collateral workflow. Each participant works with the records and actions relevant to their role.`
- 2x2 card grid `.l-g2` (gap 14, mt 48). Cards: bg #0E0F11, border .08, radius 12, padding 26, hover glow. H3 17px; body 15px mt 12:
  1. `Equipment Passport`: `Keep the equipment identifier, submitted ownership evidence, inspection references, and document versions linked to the case.`
  2. `Scoped Evidence Sharing`: `Share a selected evidence package with a named lender or verifier. Keep unrelated records outside that package.`
  3. `Pledge and Release Workflow`: `Record an active collateral lock for a registered asset within Collara and require the designated lender's authorization for release.`
  4. `Case History`: `Review the actors, decisions, evidence versions, and committed workflow transitions available within your access scope.`
- Boundary note (mt 20, 13.5px/1.6 #62666D, flex gap 10): tag `Boundary` (mono 11px, ls .06em, uppercase, padding 2px 6px, border .1, radius 4), then `A Collara record is not a legal lien registration, proof of title, or verification of pledges outside Collara.`

### 2.5 `#workflow` (lines 170-187)
- Eyebrow `Workflow`
- H2 `From equipment evidence to authorized release.`
- 6-col grid `.l-g6` (gap 24, mt 56, relative) with a connector line (see section 6). Each step: column gap 14. Circle is 34x34, radius 50%, bg #08090A, mono 12px. Then H3 15.5px (mt 6), then body 14px/1.6 #9C9DA1:
  1. `01` (ring amber/.6, text amber-hi) `Register the equipment`: `Create a passport and attach case-specific equipment records.`
  2. `02` (ring white .18, text fg) `Request verification`: `Assign an accepted verifier and define what needs to be checked.`
  3. `03` `Share with the lender`: `Provide the selected lender with the approved evidence package.`
  4. `04` `Record review and pledge`: `Capture the lender decision and activate the collateral lock with the required authorizations.`
  5. `05` `Request and authorize release`: `Route a release request to the designated lender and record its decision.`
  6. `06` (ring green/.6, text green-hi) `Export the case history`: `Generate a permission-scoped record of the evidence and workflow.`
- Footnote (mt 48, pt 20, top border .08, 14px #62666D, max 760): `Credit decisions, disbursement, legal filings, and enforcement remain with the lender and its existing processes.`

### 2.6 `#for-lenders` (lines 189-204)
- 2-col grid `minmax(0,5fr) minmax(0,7fr)`, gap 56, align start.
- Left column (sticky top 96):
  - Eyebrow `For lenders`
  - H2 `Start with one credit and documentation team.`
  - Lead `Collara's initial focus is equipment-finance lenders handling used CNC machinery. The first pilot is designed to test one workflow alongside existing origination and servicing systems—not replace the entire lending stack.` (the source has an em dash with no spaces in `systems—not`)
  - Button M primary (mt 28) `Discuss your workflow` + `<span style="color:#62666D">→</span>` → `/pilot`
- Right column: 2x2 cards (padding 24; H3 16.5px; body 14.5px mt 10):
  1. `Review queue`: `See which cases need evidence, verification, or a lender decision.`
  2. `Evidence context`: `Review the source, version, scope, and validity of records before relying on them.`
  3. `Release control`: `Keep release authority with the lender named on the collateral workflow.`
  4. `Pilot measurement`: `Compare follow-up cycles and handling time with the current process.`

### 2.7 Participants (no id) (lines 206-221)
- Eyebrow `Participants`
- H2 `Different participants. Different permissions.`
- 5-col strip `.l-g5` (gap 0, mt 48, border .08, radius 12, overflow hidden, bg #0E0F11). Cells have padding 24px 22px and a right border .07 (except the last). The title is a `div` (15.5px/500), not a heading. Body 14px mt 10:
  1. `Equipment owners`: `Submit equipment evidence, approve sharing, and follow the case's next steps.`
  2. `Dealers`: `Contribute relevant equipment records to an invited case.`
  3. `Verifiers`: `Review assigned evidence and issue an attestation with an explicit scope.`
  4. `Lenders`: `Assess the case, record decisions, and authorize collateral release.`
  5. `Auditors`: `Inspect and export the records covered by their access grant.`
- Note (mt 20, 14px #62666D): `Participation does not grant access to every document, every loan term, or every case.`

### 2.8 `#why-canton` (lines 223-237): full-bleed band
- The band has bg #0E0F11 with top and bottom borders .07 (margin and padding in 1.7).
- Eyebrow `Why Canton`
- H2 `Shared workflow rules without shared access to everything.`
- Lead `Collara is being built with Daml workflows on Canton. Contract permissions define who can participate in a transition and which records are disclosed to the relevant parties.`
- 3 cards (`.l-g3`, gap 14, mt 48). Cards have bg #08090A (inverted against the band), border .08, radius 12, padding 24. Each has a mono label `Fig. N` (12px #62666D), an H3 16.5px (mt 14), and a body 14.5px:
  1. `Fig. 1` `Scoped disclosure`: `Design separate records for equipment evidence and financing terms so their recipients can differ.`
  2. `Fig. 2` `Explicit authorization`: `Express verifier, owner, and lender responsibilities in the workflow rather than relying only on interface controls.`
  3. `Fig. 3` `Recorded transitions`: `Connect case history to committed workflow events instead of treating a clicked button as a completed action.`
- Note (14px #62666D, max 760): `Privacy depends on the implemented contract model and deployment. The LocalNet demo will include access-denial and authorization tests.`

### 2.9 `#pilot` (lines 239-256): see section 4 for details
- 2-col grid `6fr 6fr`, gap 56.
- Left: eyebrow `Pilot`; H2 `Help shape the first used CNC financing pilot.`; lead `We are looking for a lender team willing to map its current evidence and collateral-status workflow. Together, we will define a limited pilot, agree on the required participants, and measure whether coordination improves.`
- Right card (bg #0E0F11, border .08, radius 12, padding 8px 28px). Numbered rows (flex, gap 18, baseline, padding 20px 0, divider .07 except the last). The number is mono 12px amber-hi; the text is 16px:
  1. `Map one current workflow.`
  2. `Test with historical or approved shadow cases.`
  3. `Compare follow-ups, handling time, and onboarding effort.`
- Card footer (padding 8px 0 22px, column gap 14): Button M primary `Request a pilot` → `/pilot`, then 13px #62666D: `A pilot request is not a loan application. Do not submit financial documents through this form.`

### 2.10 `#faq` (lines 258-277)
- 2-col grid `4fr 8fr`, gap 56. The left column is sticky (top 96): eyebrow `FAQ`, H2 `Questions before you start`.
- Right: a list of `<details>` with a top border .08 on the list and a bottom border .08 per item. `<summary class="l-sum">` is flex space-between with gap 16 and padding 20px 0, and contains `<span>question</span>` plus `<span class="l-plus">+</span>` (24px circle, border .14, 16px/300 #9C9DA1, `transition:transform .2s`). The answer `<p>` is described in 1.8.
- The **first item is open by default** (`open="{{ true }}"`).

| # | Question (verbatim) | Answer (verbatim) |
|---|---|---|
| 1 | `Is Collara a lender?` | `No. Collara coordinates equipment evidence and collateral workflow. Financing decisions and funding remain with the lender.` |
| 2 | `What equipment does Collara support first?` | `The initial scope is used CNC machinery. Other equipment categories are outside the first pilot.` |
| 3 | `Does an attestation prove legal ownership?` | `Not automatically. An attestation states what a verifier checked, the evidence used, and its limitations. Legal ownership and lien checks remain separate requirements.` |
| 4 | `Can Collara prevent double pledging?` | `The planned workflow blocks a second active lock for the same registered asset within Collara. It does not detect every pledge outside the system or guarantee that duplicate physical-asset registrations cannot occur.` |
| 5 | `Who can see my documents?` | `Access depends on your case's grants and the implemented contract permissions. Only selected evidence should be disclosed to selected parties. Your hosting provider's access and trust model must also be considered.` |
| 6 | `Can shared information be taken back?` | `Future document access can be limited or revoked according to the workflow. Information already disclosed, downloaded, or stored by a participant cannot be guaranteed to disappear.` |
| 7 | `Does Collara replace our lending system?` | `No. The initial pilot is a coordination layer alongside existing credit, documentation, and servicing processes.` |
| 8 | `Does the demo move money?` | `No. The demo uses synthetic records on LocalNet. Cash settlement and MainNet wallet payments are outside the initial scope.` |

### 2.11 Final CTA (no id) (lines 279-290)
- Centered, with the bottom amber glow.
- Mark image 44x44, `opacity:.9`, `alt=""`.
- H2 (final-CTA style) `Make the next step in the case clear.`
- Lead (17px, max 560) `Explore the equipment evidence workflow, or help us test it with a focused lender team.`
- `.l-cta` row (mt 34): `Request a pilot` → `/pilot` (primary L); `Read the workflow →` → `#workflow` (secondary L).

### 2.12 Footer (lines 292-306)
- Top border .07. Grid `.l-foot`: `minmax(0,1.6fr) repeat(4,minmax(0,1fr))`, gap 32.
- Brand column (max 300, gap 14): logo link `#top` (mark 26px `alt="Collara"`, plus "Collara" 600/16px). Below it, 14px #9C9DA1: `Private equipment evidence and collateral workflows. Starting with used CNC financing.`
- Link columns. Each head is a mono 11px uppercase #62666D label (mb 4). Links are 14px #9C9DA1, hover fg, gap 10:
  - **Product**: `Product` → `#product`, `Workflow` → `#workflow`, `For Lenders` → `#for-lenders`
  - **Resources**: `Docs` → `Collara Docs.dc.html`, `Why Canton` → `#why-canton`
  - **Contact**: `Request a pilot` → `/pilot`
  - **Legal**: `Privacy` → `/privacy`, `Terms` → `/terms`
- Legal line (mt 48, pt 24, top border .07, 13px/1.6 #62666D): `Collara is in development. It is not a lender, custodian, legal lien registry, or provider of guaranteed financing.`

### 2.13 Interactive behaviors (Landing) [READ]
- **Mobile menu**: client state `menuOpen` (lines 309-322). Clicking the button toggles it, and the glyph switches `≡`/`×`. Nav links close the menu on click. The CTA links don't close it, because they navigate away. There is no Escape handling, no outside-click handling, no focus management, no scroll lock, and no `aria-expanded`.
- **FAQ accordion**: native `<details>`. It is not exclusive (several can be open). When open, "+" rotates 45° (so it reads as "×") and the summary text goes from #D0D1D4 to #F7F8F8. Item 1 has an inline `color:#F7F8F8`, so it stays bright even when collapsed (bug; see section 7).
- **Hover**: nav and footer links #9C9DA1 → #F7F8F8. Primary bg → #FFFFFF. Secondary bg .05 and border .22. Ghost "Sign in" color fg and bg .05. Mobile menu item bg .05. Cards: border .16 + inset glow, `transition .2s`. No pressed or focus states are defined.
- **Smooth scrolling** to anchors (`html{scroll-behavior:smooth}`). Sticky header offset is handled by `scroll-margin-top:64px`.
- **Sticky** elements: header; the left columns of #for-lenders and #faq (top 96). They become static at ≤920.
- No animations, carousels, analytics, or forms.

### 2.14 Assets (Landing and Docs)
- `assets/collara-mark.png` [READ]: 1254x1254 RGBA, 384,138 bytes. It is a near-white (`#FDFDFD`) stylized "C" monogram on a transparent background. The C is cut by two thin diagonal and horizontal channels into three stacked bands, and the terminals are chamfered at 45°. It is byte-identical to `uploads/ChatGPT Image Oct 1, 2026, 12_36_04 AM.png`.
  - Landing uses it 4 times: header 30px (`alt="Collara"`), preview chrome 18px (`alt=""`), final CTA 44px at opacity .9 (`alt=""`), footer 26px (`alt="Collara"`).
  - Docs uses it 2 times: header 30px and footer 26px, both `alt="Collara"`.
  - [INFERRED] Serve it through `next/image` with a downscaled 128px or 256px WebP/PNG, ideally an SVG trace, because 384KB is excessive for 18-44px. Derive the favicon and app icons from it. None exist today.
- No other images, icons, or SVG. Arrows and glyphs are text characters.

---

## 3. Docs (`/docs`)

### 3.0 Head (lines 10-14) [READ]
- `<title>`: `Collara — Docs (pre-build)`
- `meta description`: `Collara documentation: overview, workflow, roles and permissions, synthetic demo scenario, and planned BitSafe governance. Pre-build specification.`
- No og tags.

### 3.1 Header (lines 28-57)
Identical to the Landing header, except:
- The logo links to `Collara Landing.dc.html`.
- Nav links point to `Collara Landing.dc.html#product`, `#workflow`, `#for-lenders`, and `#why-canton`.
- `Docs` → `#top`, shown with active color `#F7F8F8` and no hover style. This is the only "current page" cue, and there is no `aria-current`.
- In the mobile panel, only the `Docs` link calls `closeMenu`.

### 3.2 Pre-build banner (lines 59-64), full width, not sticky
- Outer: `border-bottom:1px solid oklch(82% 0.12 75 / .25);background:oklch(82% 0.12 75 / .08)`.
- Inner: `max-width:1120px;padding:9px 32px`, flex wrap, gap 14, baseline, 12.5px.
- Label (mono 11px, ls .06em, uppercase, 500, `oklch(90% 0.08 80)`): `Pre-build`
- Text (`oklch(84% 0.06 80)`): `This documentation describes a specification and interactive UI mockups. No running implementation, deployed contracts, API, or test suite exists yet.`

### 3.3 Layout and sidebar TOC (lines 66-84)
- Grid `220px | 1fr`, gap 56. At ≤920 it is a single column.
- `<nav class="o-side">`: sticky top 88, column, gap 2, 14px.
  - Heading (mono 11px uppercase #62666D, mb 8): `Docs · v0.1 draft`
  - Links (#9C9DA1, padding 6px 0, hover fg):
    1. `Overview` → `#overview`
    2. `Workflow` → `#workflow`
    3. `Roles & permissions` → `#roles`
    4. `Synthetic demo scenario` → `#demo`
    5. `Planned BitSafe governance` → `#governance`
    6. `Setup, API & tests` → `#setup`
  - **Status labels legend** (mt 22, pt 18, top border .07, gap 8, 12.5px #9C9DA1). Mono heading `Status labels`, then each chip followed by a description:
    - `UI mockup`: `Clickable design in this project`
    - `Specified`: `Defined in the spec, no code`
    - `Planned`: `Later phase, may change`
    - `Implemented`: `None at this time`
  - At ≤920 the sidebar becomes a static horizontal wrapping row (gap 4px 14px, bottom border). The legend block is then just another wrapping flex item.
- There is no scroll-spy and no active-section highlight.
- Content column: `<div>` flex column, gap 80, `min-width:0`.

### 3.4 Section 01: `#overview` (lines 88-128)
- Kicker `01 · Overview` + chip `Specified`.
- **H1** `Collara documentation`
- Lead (16px #C9CBD3): `Collara is a private coordination workspace for used CNC equipment financing. It links an equipment passport with its evidence, verification scope, lender decision, and collateral workflow, and discloses each record only to the counterparties named on it. It is being designed as Daml workflows on Canton.`
- Filled callout (bg #0F1013): title `Project status: pre-build`; body `What exists today is a product specification and three interactive UI mockups: the landing page, the lender workspace, and a governance simulation inside that workspace. The mockups project state locally in the browser. There are no deployed contracts, no ledger, no API, and no test suite. Nothing on this page describes working software.`
- 2 cards (`.o-g2`):
  - **What Collara coordinates** (`<ul>`): `Equipment passport and document versions` · `Verification requests and scoped attestations` · `Evidence packages shared with a named lender` · `Lender assessment and collateral decision` · `Pledge activation, release request, and release decision` · `Permission-scoped case history and exports`
  - **What Collara is not** (`<ul>`): `Not a lender; credit decisions and funding stay with the lender` · `Not a custodian and not a legal lien registry` · `An attestation is not proof of legal ownership` · `A Collara record does not verify pledges made outside Collara` · `Cash settlement and MainNet wallet payments are outside the initial scope`
- **Capability status** (title 14px/500) table, min-width 560. Columns: `Capability | Status | Where`.

| Capability | Status chip(s) | Where |
|---|---|---|
| Landing page | UI mockup | link `Collara Landing` (→ Landing) |
| Lender workspace: overview, case queue, case workspace, asset passport, collateral review, pledge and release, audit center | UI mockup | link `Collara Dashboard` (→ Dashboard) |
| Daml contract model: passport, evidence package, verification, assessment, proposal, pledge control | Specified | `Specification · ` + link `Workflow` (#workflow) |
| Roles, mandates, and scoped disclosure | Specified | `Specification · ` + link `Roles & permissions` (#roles) |
| LocalNet demo with access-denial and authorization tests | Planned | `Scenario defined · ` + link `Synthetic demo scenario` (#demo) |
| BitSafe governance for the verifier registry | Planned + UI mockup | `Simulation in the workspace · ` + link `Planned BitSafe governance` (#governance) |
| Decentralization Manager integration | Planned | `Not connected` |
| Setup instructions, API reference, test commands | Not available | `Added only after a verified implementation · ` + link `Setup, API & tests` (#setup) |

### 3.5 Section 02: `#workflow` (lines 130-163)
- Kicker `02 · Workflow` + `Specified`. H2 `From equipment evidence to authorized release`.
- Lead: `Six steps, each ending in a committed workflow state. Operational events such as uploads, drafts, and views are application actions and do not change workflow state. Failed or unknown commands never appear as successful lifecycle events.`
- Table (min-width 640). Columns: `Step | Who acts | Records | Committed states`. The step column has a mono #62666D number prefix. The states column is mono 12px; a line break is shown below as ` / `.

| Step | Who acts | Records | Committed states |
|---|---|---|---|
| 01 Register the equipment | Equipment owner | Passport, equipment identifier, ownership evidence, document versions | `DRAFT → REGISTERED` |
| 02 Request verification | Owner assigns an accepted verifier; verifier reviews and may request changes | Verification request with defined scope; attestation listing checked items, evidence versions, limitations, and validity | `REQUESTED → IN_REVIEW` / `→ CHANGES_REQUESTED` / `→ ATTESTED` |
| 03 Share with the lender | Owner, with the dealer's consent for contributed records | Evidence package addressed to one named lender; unrelated records stay outside the package | `NOT_SUBMITTED → SUBMITTED` |
| 04 Record review and pledge | Lender analyst records the assessment; lender approver records the collateral decision and issues the proposal; owner accepts; pledge activates with both authorizations | Collateral assessment (per lender, per case), financing proposal (versioned), pledge on the asset's canonical control | `IN_REVIEW → ELIGIBLE \| REJECTED` / `DRAFT → ISSUED → ACCEPTED \| WITHDRAWN` / `AVAILABLE → ACTIVE` |
| 05 Request and authorize release | Owner requests with a reason; the approver mandate of the lender named on the lock decides | Release request and decision on the active pledge | `ACTIVE → RELEASE_REQUESTED` / `→ RELEASED \| RELEASE_REJECTED` |
| 06 Export the case history | Any participant, within their access scope | Case workflow report with cut-off, ledger coverage watermark, retention caveat, and checksum | `Export job · no state change` |

- 2 cards:
  - **Pledge activation prerequisites (all required)** (`<ol>`): 1. `Lender-authorized collateral decision: Eligible for this case` 2. `Proposal issued and accepted at the exact version` 3. `Attestation valid at activation` 4. `Evidence snapshot matches the attested versions` 5. `Asset control available: no active lock on the canonical control`
  - **Workflow rules** (`<ul>`): `One active lock per registered asset within Collara` · `Eligibility is recorded per lender and per case; it does not transfer` · `Only the designated lender's approver mandate can authorize release` · `A rejected release leaves the lock active; the owner may reapply` · `Release ends the Collara workflow lock only; legal lien termination is separate` · `Historical lock records are retained after release`
- Boundary callout: `Boundary. Credit decisions, disbursement, legal filings, and enforcement remain with the lender and its existing processes. The workflow blocks a second active lock for the same registered asset within Collara; it does not detect pledges made outside the system or guarantee that duplicate registrations of a physical asset cannot occur.`

### 3.6 Section 03: `#roles` (lines 165-204, script 342-365)
- Kicker `03 · Roles & permissions` + `Specified`. H2 `Different participants, different permissions`.
- Lead: `Participation does not grant access to every document, every loan term, or every case. Responsibilities are expressed as mandates in the workflow, not only as interface controls. Access is re-evaluated when a report is generated and again when it is downloaded.`
- 6 role cards (`.o-g3`, 3 columns). Each is title / mono sub-label / body:
  1. `Equipment owner` / `Borrower mandate` / `Registers the passport, submits evidence, requests verification, approves sharing, accepts the proposal, co-authorizes activation, and requests release.`
  2. `Dealer` / `Contributor` / `Contributes equipment records to an invited case and consents when those records are shared onward.`
  3. `Verifier` / `Registry member` / `Accepts an assignment, requests changes, and issues an attestation with an explicit scope. Cannot approve financing or establish legal lien priority.`
  4. `Lender analyst` / `Lender · Analyst mandate` / `Works the review queue, opens shared evidence, drafts and submits the assessment, and requests exports. Cannot record decisions.`
  5. `Lender approver` / `Lender · Approver mandate` / `Records the collateral decision, issues or withdraws proposals, co-authorizes activation, and authorizes or rejects release. Holds the organization's governance seat (planned).`
  6. `Auditor` / `Scoped grant` / `Inspects and exports the records covered by a grant that names the case, the permission, the expiry, and the consenting parties.`
- **Permission matrix** (min-width 760; role columns centered). Header: `Action | Owner | Dealer | Verifier | Analyst | Approver | Auditor`. Cell rendering is `true` → `✓` colored `#F7F8F8`; `'scope'` → `scope` colored `#9C9DA1`; `false` → `—` colored `#3A3D44`. Rows, verbatim from the script (lines 345-359):

| Action | Owner | Dealer | Verifier | Analyst | Approver | Auditor |
|---|---|---|---|---|---|---|
| Register passport and submit evidence | ✓ | — | — | — | — | — |
| Contribute records to an invited case | — | ✓ | — | — | — | — |
| Request verification and assign a verifier | ✓ | — | — | — | — | — |
| Accept assignment, request changes, issue attestation | — | — | ✓ | — | — | — |
| Approve sharing of an evidence package | ✓ | scope | — | — | — | — |
| Open shared evidence and record the assessment | — | — | — | ✓ | ✓ | — |
| Record the collateral decision (eligible / rejected) | — | — | — | — | ✓ | — |
| Issue or withdraw a financing proposal | — | — | — | — | ✓ | — |
| Accept a proposal (exact version) | ✓ | — | — | — | — | — |
| Authorize pledge activation | ✓ | — | — | — | ✓ | — |
| Request release | ✓ | — | — | — | — | — |
| Authorize or reject release | — | — | — | — | ✓ | — |
| View case history | scope | scope | scope | scope | scope | scope |
| Export a case report | ✓ | — | — | ✓ | ✓ | scope |
| Vote on verifier-registry proposals (planned) | — | — | — | — | ✓ | ✓ |

- Footnote (13px #62666D): `✓ permitted within the participant's case scope · "scope" means only within an explicit grant or the records addressed to that party. Equipment evidence and financing terms are separate records, so their recipients can differ. Privacy depends on the implemented contract model and the deployment; the hosting provider's access and trust model must also be considered.`
- [INFERRED] Store this matrix as typed data (`packages/ui` or a docs content module). The backend permission tests should ideally share the same source, so the docs and the enforcement don't drift.

### 3.7 Section 04: `#demo` (lines 206-272, script 366-382)
- Kicker `04 · Synthetic demo scenario` + chips `UI mockup` and `LocalNet demo planned`. H2 `One case, CL-001, modelled end to end`.
- Lead: `All organizations, people, documents, and amounts are synthetic. No funds are transferred. Today the scenario runs as a local projection inside the workspace mockup; the planned LocalNet demo will replay the same scenario against committed Daml contracts and add access-denial and authorization tests.`
- Grid `repeat(auto-fit,minmax(360px,1fr))`, gap 14, holding two KV cards:
  - **Organizations**: `Demo Manufacturer` = `Equipment owner · borrower mandate`; `Demo CNC Dealer` = `Dealer · contributor`; `Demo Verifier` = `Verifier · VER-001, active`; `Demo Lender A` = `Lender · the workspace viewpoint (analyst and approver mandates)`; `Demo Lender B` = `Second lender · governance seat only`; `Demo Auditor` = `Auditor · scoped grant after release`
  - **Fixtures**: `Asset` = `ASSET-DEMO-001 · CNC machining center DEMO-CNC-500 · serial SYNTH-CNC-001`; `Case` = `CL-001 · used CNC financing · policy CP-2026-CNC-01`; `Evidence package` = `PKG-001 v2 · 5 documents: inspection report v2, dealer invoice, equipment photos (6), maintenance log, purchase agreement`; `Attestation` = `ATT-001 · issued by Demo Verifier · 7 checked items · valid to 2027-03-10`; `Assessment` = `CA-001 · Demo Lender A · per lender, per case`; `Proposal` = `FP-001 v2 · USD 105,000.00 · valuation illustrative at USD 150,000`; `Pledge` = `PL-001 on control v3 → v4 · release request RR-001, reason: external loan completion`
- **Two demo moments** (title), 2 filled cards, each with a mono uppercase label:
  - `Moment A · Lender review`: `PKG-001 v2 is shared and ATT-001 is valid. CA-001 is in review with a saved analyst draft. The approver mandate records Eligible for this case or Rejected for this case. Eligible unlocks proposal issuance; nothing is disbursed.`
  - `Moment B · Release review`: `FP-001 v2 was accepted and PL-001 activated on 2026-09-22. Demo Manufacturer requested release on 2026-09-30. The approver mandate authorizes release (control becomes AVAILABLE at v5) or rejects it (lock stays ACTIVE). After release, Demo Auditor holds a scoped grant to CL-001 until 2026-12-31.`
- **Committed events in the scenario** (title). Table min-width 700, columns `Date (UTC) | Reference | Event | Actor | State change`. Date, ref, and state columns are mono. Rows, verbatim (lines 368-381):

| Date (UTC) | Reference | Event | Actor | State change |
|---|---|---|---|---|
| 2026-09-01 | ASSET-DEMO-001 | Passport registered | Demo Manufacturer · Owner | DRAFT → REGISTERED |
| 2026-09-03 | VR-001 | Verification requested | Demo Manufacturer · Owner | — → REQUESTED |
| 2026-09-04 | VR-001 | Assignment accepted | Demo Verifier | REQUESTED → IN_REVIEW |
| 2026-09-06 | VR-001 | Changes requested: spindle photos and maintenance log | Demo Verifier | IN_REVIEW → CHANGES_REQUESTED |
| 2026-09-10 | ATT-001 | Attestation issued against evidence v2 | Demo Verifier | IN_REVIEW → ATTESTED |
| 2026-09-12 | CL-001 | Case created | Demo Manufacturer · Borrower | — → DRAFT |
| 2026-09-12 | PKG-001 | Package shared with Demo Lender A (5 documents, dealer consent) | Demo Manufacturer + Demo CNC Dealer | NOT_SUBMITTED → SUBMITTED |
| 2026-09-13 | CA-001 | Review started | Demo Lender A · Analyst | SUBMITTED → IN_REVIEW |
| 2026-09-18 | CA-001 | Collateral decision recorded: Eligible for this case | Demo Lender A · Approver | IN_REVIEW → ELIGIBLE |
| 2026-09-19 | FP-001 | Proposal issued (v1) | Demo Lender A · Approver | DRAFT → ISSUED |
| 2026-09-20 | FP-001 | Proposal withdrawn and reissued, expiry corrected (v2) | Demo Lender A · Approver | ISSUED → WITHDRAWN · ISSUED |
| 2026-09-21 | FP-001 | Proposal accepted at exact version v2 | Demo Manufacturer · Borrower | ISSUED → ACCEPTED |
| 2026-09-22 | PL-001 | Pledge activated | Demo Manufacturer + Demo Lender A | AVAILABLE → ACTIVE |
| 2026-09-30 | RR-001 | Release requested: external loan completion | Demo Manufacturer · Borrower | ACTIVE → RELEASE_REQUESTED |

  - Note below: `Events after 2026-09-13 belong to Moment B. In the mockup, the approver's own actions append events timestamped "just now".`
  - [INFERRED] Observations, not edits: the passport transition is "DRAFT → REGISTERED" (step 01) and the case is "— → DRAFT". The 2026-09-13 assessment transition is "SUBMITTED → IN_REVIEW", while the docs workflow table lists assessment states as `IN_REVIEW → ELIGIBLE | REJECTED` and package states as `NOT_SUBMITTED → SUBMITTED`. The domain/state-machine owner should reconcile these against the State Transition Design.
- **Known limits of the mockup** card (`<ul>`): `Only CL-001 is modelled. Queue rows CL-002 to CL-005 are filler and open nothing.` · `Ledger offsets, commit hashes, checksums, and timestamps are illustrative values, not outputs of a ledger.` · `Person names in the workspace (analyst, approver) are placeholders.` · `State changes are local to the browser session and reset on reload.`

### 3.8 Section 05: `#governance` (lines 274-303)
- Kicker `05 · Planned BitSafe governance` + chips `Planned` and `UI simulation`. H2 `Verifier-registry administration by a governance set`.
- Lead: `The BitSafe governance module is intended to decide which verifiers can be assigned to verification requests, so that no single operator adds or suspends a verifier. It is a planned capability. The workspace contains a UI simulation of it until the Decentralization Manager integration is implemented.`
- Info callout (blue): `Governance controls verifier-registry administration only. It never authorizes collateral release. Collateral decisions, financing proposals, pledge activation, and release remain under lender mandates and are not subject to governance votes.`
- Grid (auto-fit minmax 360):
  - KV card **Design as simulated**: `Governance set` = `Three seats: Demo Lender A, Demo Lender B, Demo Auditor`; `Seat holder` = `The organization's approver mandate (audit lead mandate for the auditor seat)`; `Proposal types` = `Add verifier · Suspend verifier`; `Threshold` = `2 of 3 approvals pass a proposal; 2 rejections close it`; `Execution` = `A separate step after threshold, by any seat. Registry changes apply only on execution.`; `Expiry` = `14 days after opening if not executed`; `Suspension effect` = `Blocks new assignments; attestations already issued remain valid and are not reopened`
  - A column of two cards:
    - **Simulated in the workspace today** + chip `UI mockup` (`<ul>`): `Verifier registry with active and suspended entries` · `Proposal list covering open, rejected, and executed states` · `Proposal detail with per-seat approval progress and execution state` · `Approve, reject, execute, and propose actions from seat 1, recorded locally`
    - **Pending implementation** + chip `Planned` (`<ul>`): `Decentralization Manager integration: proposals, votes, and execution as committed records` · `Seat key management and membership changes` · `Enforcement of expiry and of the registry check at verifier assignment` · `Reinstatement of a suspended verifier (not yet specified)`

### 3.9 Section 06: `#setup` (lines 305-314)
- Kicker `06 · Setup, API reference & tests` + chip `Not available`. H2 `Added after a verified implementation`. (The sidebar label is `Setup, API & tests`.)
- Lead: `No implementation exists yet, so this page intentionally contains no setup instructions, no API endpoints, and no test commands. These sections will be written only once the implementation exists and has been verified against the LocalNet demo scenario. Until then, treat any command, endpoint, or integration attributed to Collara as unverified.`
- 3 dashed placeholder cards (`.o-g3`):
  - `Setup`: `Will cover a LocalNet deployment of the Daml workflows and the workspace. Not yet written.`
  - `API reference`: `Will document the commands and queries behind each workflow transition. Not yet written.`
  - `Tests`: `Will list the access-denial and authorization tests run against the demo scenario. Not yet written.`
- The Docs page has **no code blocks** (no `<pre>`/`<code>`).

### 3.10 Docs footer (lines 320-334)
Same structure as the Landing footer (`.o-foot`). Links go to `Collara Landing.dc.html#product|#workflow|#for-lenders|#why-canton`, and `Docs` → `#top`. The logo links to Landing. The legal line adds a sentence: `Collara is in development. It is not a lender, custodian, legal lien registry, or provider of guaranteed financing. Documentation v0.1 draft · pre-build.`

---

## 4. Request a Pilot

[READ] What exists in the prototype:
- **No form, no `mailto:`, no inputs on any page** (grep `<form|<input|mailto` = 0).
- Every "Request a pilot" CTA uses the absolute href **`/pilot`**, a route that does not exist in the static prototype. On Landing that's 7 links: header desktop, header mobile, hero, "Discuss your workflow →", pilot card, final CTA, footer "Contact". On Docs it's 3: header desktop, header mobile, footer.
- The Landing has a **`#pilot` section** (2.9) that pitches the pilot and ends with this disclaimer, which explicitly refers to a form: `A pilot request is not a loan application. Do not submit financial documents through this form.`
- The older content spec (`inputs/Collara Website Content Specification.txt`, "Contact Section") says, in Indonesian: "Request Pilot — Collara terbuka untuk kolaborasi dengan perusahaan, bank, dan institusi yang ingin mengembangkan workflow asset financing berbasis Canton Network." Translation: "Collara is open to collaboration with companies, banks, and institutions that want to develop Canton-based asset-financing workflows." It specifies no fields.

[INFERRED] Recommended build:
- Keep the Landing `#pilot` section as-is (CTA → `/pilot`). Create **`/pilot`** as a Server Component page. Reuse the section's eyebrow, H2, lead, and 3 steps as the page intro, and add a form below them. Put the disclaimer `A pilot request is not a loan application. Do not submit financial documents through this form.` directly above the submit button.
- **Proposed fields. These are NOT in any source and need product sign-off.** They were derived from the landing copy (a lender team, mapping current evidence and collateral-status workflow, used CNC):
  - Full name (required)
  - Work email (required, `type=email`, `autocomplete=email`)
  - Organization (required)
  - Role / title (optional)
  - Organization type (required select): Equipment-finance lender · Equipment owner / manufacturer · Dealer · Verifier / inspector · Other
  - Team (optional select, lender only): Credit · Documentation · Servicing · Other
  - "Describe your current evidence and collateral-status workflow" (textarea, optional, max ~2000 chars, with helper text repeating "Do not include financial documents or borrower data")
  - Consent checkbox to be contacted, linking to `/privacy`
- No file upload, because the copy forbids documents. Add a honeypot and rate limiting. Submit to a server action or `POST /api/pilot-requests` in Fastify that stores to a `pilot_requests` table (Drizzle), with optional email notification.
- Success and error copy also needs approval. Use a neutral placeholder such as "Thanks. We'll reply by email." until approved.
- Until the backend exists, do **not** fake success. Show a disabled form with a contact fallback, or hide the form, consistent with brief line 104.

---

## 5. Links between pages → real routes

| Prototype href (where) | Count | Real route [INFERRED unless noted] |
|---|---|---|
| `#top` (Landing logo, footer logo) | 2 | `/` (on `/` it can stay `#top`) |
| `#product`, `#workflow`, `#for-lenders`, `#why-canton` (Landing nav, mobile nav, footer, CTAs) | 3/5/3/3 | Same-page anchors on `/`. Use `/#product` etc. in the shared header/footer so they work from any page. |
| `Collara Docs.dc.html` (Landing nav, mobile, footer) | 3 | `/docs` |
| `Collara Dashboard.dc.html` ("Sign in", both pages, desktop and mobile; Docs table "Collara Dashboard") | 2 + 3 | `/app`. [READ] The Mobile Preview labels the dashboard frame `Workspace · /app` (line 29). "Sign in" should go to `/app`, which redirects unauthenticated users to the OIDC sign-in, or to an explicit `/sign-in` that starts OIDC and returns to `/app`. |
| `/pilot` (all "Request a pilot" / "Discuss your workflow") | 7 + 3 | `/pilot` (new page with the form, section 4) |
| `/privacy`, `/terms` (footers) | 1 + 1 each | `/privacy`, `/terms`. **No content exists.** They need legal copy, so don't invent policy text. |
| `Collara Landing.dc.html` (Docs logo, footer logo, capability table) | 3 | `/` |
| `Collara Landing.dc.html#product` etc. (Docs nav and footer) | 3 each | `/#product`, `/#workflow`, `/#for-lenders`, `/#why-canton` |
| Docs `#overview #workflow #roles #demo #governance #setup` | — | `/docs#overview` … `/docs#setup`. Keep these ids stable, because other content deep-links to them. |
| Unlinked ids on Landing: `#pilot`, `#faq` | 0 | Keep the ids. Add `scroll-margin-top` to them. |
| Mobile Preview page (`Landing · /`, `Workspace · /app`) | — | Not a product route. [READ] It frames each page in a 414x880 device (12px padding, radius 44, bg `#1A1B20`, border .12, shadow `0 30px 80px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.08)`) with a 390x856 iframe at radius 34. Its note: `Both pages reflow below 900px: the landing collapses to a single column with a menu button; the workspace hides the sidebar behind a drawer and lets tables scroll horizontally. Tweaks (demo moment, mandate, technical IDs) apply on the desktop dashboard file.` [INFERRED] Replace it with Playwright visual/viewport tests at 390x844. |

Suggested Next.js structure [INFERRED]: `app/(marketing)/layout.tsx` (SiteHeader + SiteFooter, marketing tokens), `app/(marketing)/page.tsx`, `app/(marketing)/docs/page.tsx`, `app/(marketing)/pilot/page.tsx`, `app/(marketing)/privacy/page.tsx`, `app/(marketing)/terms/page.tsx`, and `app/app/...` for the authenticated workspace. The header takes an `active` prop (`'docs'` → `aria-current="page"`).

---

## 6. Illustrations and diagrams (no SVG; all HTML/CSS)

1. **Hero "Case workspace" preview** (2.2). This is a static mock window built from divs, so rebuild it as a `HeroCasePreview` Server Component with typed fixture props. It is decorative and illustrative: it must remain clearly labeled `Illustrative demo case`, and the values (`USD 150,000`, `USD 105,000`) stay labeled "(illustrative)". Layout is a title bar, then a 2-pane grid at 1.25fr:1fr: left has case header, stage pill, a 3-row KV, and a next-action row; right has 3 evidence rows, a dashed doc placeholder, and a 2-figure grid. Amber glow behind it.
2. **Workflow 6-step rail** (2.5). A 6-column grid with 24px gaps. Each step has a 34px circle at its top-left, followed by a title and text. A 1px horizontal **connector line** sits behind the circles: `position:absolute; top:17px; left:17px; right:calc((100% - 120px) / 6 - 17px); height:1px`. Here 120px = 5 gaps × 24px, so the line runs from the center of circle 01 to the center of circle 06. Gradient: amber .5 → white .12 (40%) → white .12 (60%) → green .5. Circles have bg `#08090A` to mask the line. Ring colors are amber (01), white .18 (02-05), green (06). At ≤920 it becomes 2 columns and the line is hidden; at ≤560 it becomes 1 column. [INFERRED] Use an `<ol>` with CSS counters, or keep explicit numbers.
3. **Participants strip** (2.7). One bordered rounded container split into 5 equal columns by 1px vertical dividers.
4. **Glows** (1.6). Three radial gradients: white top glow, amber behind the preview, amber at the bottom of the final CTA. All `pointer-events:none`, `aria-hidden`.
5. **Docs**: no diagrams. It uses tables, KV grids, and chips. [INFERRED] An optional state diagram could be added later, but none exists.
6. **Logo**: PNG only (section 2.14).

---

## 7. Accessibility issues to fix

All items are [READ] observations, with fixes [INFERRED].

1. **No `lang`** on `<html>` (all pages). Add `lang="en"` in the root layout.
2. **No skip link.** Add "Skip to content" targeting `<main id="main">`. There is also no `<main>` landmark on either page; wrap the content in `<main>`.
3. **No focus styles.** There are only `style-hover` rules, no `:focus-visible` anywhere. Add a visible focus ring to links, buttons, summaries, and form fields, for example `outline:2px solid var(--accent); outline-offset:2px`. Mirror hover states on `:focus-visible`.
4. **Mobile menu button**: it has `aria-label="Toggle menu"` but no `aria-expanded` or `aria-controls`. The glyph `≡`/`×` changes only visually. Fix: add `aria-expanded={open}`, `aria-controls="mobile-nav"`, a label that switches between "Open menu" and "Close menu", close on Escape, return focus to the button, and close on route change. Wrap the panel in `<nav aria-label="Mobile">`.
5. **Landmark labels**: header `<nav>` without `aria-label` → `aria-label="Primary"`. Docs sidebar `<nav>` → `aria-label="Documentation sections"`. Footer link groups are plain divs → `<nav aria-label="Footer">` with real headings (`<h2 class="sr-only-or-styled">`) or `<ul>` lists.
6. **Redundant logo alt**: header and footer use `alt="Collara"` next to visible text "Collara", so screen readers announce it twice. Use `alt=""` on the image and let the link text name the link (link name "Collara home" if desired).
7. **Low-contrast text**: `#62666D` on `#08090A` is **3.45:1**, and on `#0E0F11` it is **3.32:1**. That fails WCAG AA (4.5:1) at 11-14px. It's used for disclaimers, legal text, eyebrows, labels, KV keys, and the hero microcopy (which includes the important "currently in development" statement). Raise it to at least `#7E828A` (computed 5.17:1 on #08090A, 4.97 on #0E0F11, 4.86 on #111214). `#8A8E95` gives 6.06/5.83/5.70. Or use `#9C9DA1` (7.36:1). The matrix "—" `#3A3D44` is **1.83:1**, and the preview "/" separator `#3E3E44` is 1.88 (decorative; mark it `aria-hidden`).
8. **Tiny type**: 10.5px status chips and 11px mono labels. Consider ≥11.5-12px in production.
9. **Permission matrix semantics**: cells contain only `✓`, `—`, and `scope`, and meaning is partly conveyed by color. Add visually-hidden text ("Permitted", "Not permitted", "Within scope"), mark glyphs `aria-hidden`, use `<th scope="col">` for role headers and `<th scope="row">` for the action column, and add a `<caption>` (it can be visually hidden). Apply the same to all Docs tables (`<caption>` + `scope`).
10. **Scrollable table wrappers** (`overflow-x:auto`) are not keyboard-focusable. Add `tabindex="0"`, `role="region"`, and `aria-label="<table name>"`.
11. **Heading structure**: Landing Participants titles are `<div>`s (make them `<h3>`). The Docs card titles ("What Collara coordinates", "Organizations", "Capability status", etc.) are `<div>`s and should be `<h3>`. Docs has an H1 inside section 01 and no page-level header region, which is acceptable, but keep exactly one H1.
12. **Lists rendered as divs**: Landing problem items 01-03, workflow steps 01-06, and pilot steps 1-3 should be `<ol>`. Product, lender, and Canton card grids should be `<ul>`.
13. **Decorative glyphs read aloud**: `→` in link text, `+` in FAQ summaries, `·` separators. Wrap the arrows and `+` in `aria-hidden="true"` spans.
14. **FAQ**: `<summary>` markers are removed (`list-style:none`). That's fine with the "+" affordance, but add `aria-hidden` to "+". Item 1 has inline `color:#F7F8F8`, so it looks "open" even when closed. Use only the `details[open]` rule. Optionally use the native exclusive accordion (`<details name="faq">`); this is a product decision.
15. **Hero preview is a fake UI**: it contains a button-looking `<span>` "Review evidence →" and status text. Wrap it in `<figure>` with `aria-label` or a figcaption ("Illustrative demo case: case CL-001 awaiting lender review"), and keep the non-interactive elements non-focusable. Optionally mark the inner details `aria-hidden` and provide a concise text alternative.
16. **Reduced motion**: `html{scroll-behavior:smooth}` and the `.2s` transitions should be wrapped in `@media (prefers-reduced-motion: no-preference)`.
17. **Current page**: the Docs header "Docs" link has no `aria-current="page"`. The docs TOC has no active-section indication (add `aria-current="location"` via a scroll-spy client island, optional).
18. **Anchors under the sticky header**: `#pilot` and `#faq` lack `scroll-margin-top`. Docs sections use 96px, which is fine.
19. **Responsive overflow (also a usability issue)**: the Docs grids use `repeat(auto-fit,minmax(360px,1fr))` (Organizations/Fixtures, Governance). At a 390px viewport with 20px gutters the content box is 350px, which is smaller than 360px, so the cards overflow. The root `overflow-x:clip` then **clips** content. Use `minmax(min(360px,100%),1fr)`.
20. **Participants strip on mobile**: stacked cells keep `border-right` and have no horizontal dividers. Switch to `border-bottom` at ≤920.
21. **Docs mobile TOC**: the legend becomes a cramped wrapped flex item. Move it below the TOC or hide it on mobile.
22. **Link affordance**: links have `text-decoration:none` site-wide. Docs inline links use a border-bottom (good). Inline links in body text should keep an underline.
23. **Touch targets**: Docs sidebar links have `padding:6px 0` (about 30px tall), and footer links are 14px with no padding. Aim for ≥24px (WCAG 2.2 AA 2.5.8). Mobile menu items are fine (12px padding).

---

## 8. Design references, provenance, conflicts

- [READ] `uploads/web-capture-2026-09-30T17-30-17.json` (94 captured elements) comes from `https://linear.app/homepage` (25 elements; this is the landing direction: dark, "FIG 0.1" labels, mono eyebrows) and `https://demo.mercury.com/*` (69 elements; the dashboard direction). The brief (line 74) says these are references and "not permission to copy another brand". The Collara landing echoes Linear's "Fig. N" convention (Why Canton cards); that is acceptable as a pattern.
- [READ] `uploads/pasted-1790817851444-0.png` is an **earlier screenshot of the hero**. It shows small colored **status dots** that the current HTML no longer has: an amber dot before the eyebrow "PRIVATE EQUIPMENT COLLATERAL WORKFLOWS", an amber dot inside the "Awaiting lender review" pill, and blue dots before the KV values ("Inspection report · submitted"). The current markup still has the `display:inline-flex;gap:8px/7px` wrappers, which suggests the dots were removed. Treat the current HTML as authoritative and confirm with design (open question).
- [READ] `uploads/pasted-1790817989563-0.png` (dashboard sidebar) and `uploads/pasted-1790844517825-0.png` (dashboard queue row CL-004) are dashboard references, outside this file's scope.

---

## 9. Conflicts and risks (summary)

1. **Pre-build copy vs the full-stack build.** Docs states that no implementation, ledger, API, or tests exist, and the legend says "Implemented: None at this time". The new app will make this progressively false. Drive the chips and the capability table from one `capabilityStatus` config. Flip an item to "Implemented" only after verification (brief line 104). Write `#setup` only once commands are verified.
2. **Demo labels.** The hero preview chip says `Demo data — LocalNet` and FAQ 8 says the demo "uses synthetic records on LocalNet". Docs says no LocalNet exists. The brief requires mode-specific labels: `Synthetic demo data — UI mockup.` (UI_MOCK) or `Synthetic demo data — Canton LocalNet.` (LOCALNET). The landing chip should reflect the real mode.
3. **Older Indonesian content spec** (`inputs/Collara Website Content Specification.txt`) uses broader positioning: "Privacy-Preserving Collateral Infrastructure for Real-World Assets", heavy equipment, energy, vehicles, and a 5-step flow including "Enable Financing". That conflicts with the prototype's narrower, legally hedged, CNC-only copy. The prototype copy is newer and more conservative, so keep it as approved copy and flag the difference to product.
4. **Breakpoint mismatch**: the Mobile Preview text says "below 900px", but the landing/docs breakpoint is 920px (the dashboard is 900).
5. **Missing pages**: `/pilot`, `/privacy`, and `/terms` are linked but have no content anywhere.
6. **Pilot disclaimer refers to "this form"**, but no form exists yet.
7. **Docs state-name details** may diverge from the state-transition spec (3.7 note).
8. **Assets**: there's no favicon or og:image, and the logo PNG is 384KB.

## 10. Open questions

1. Pilot form: final fields, destination (DB only, or also email to which inbox), retention period, consent wording, success copy, spam protection.
2. Privacy and Terms content: who provides it?
3. "Sign in" target: `/app` with auth redirect, or a dedicated `/sign-in`? Should a signed-in user see "Open workspace"?
4. Unify marketing and app color tokens (#08090A/#F7F8F8/#9C9DA1/#62666D vs #101116/#F4F5F7/#9A9CA6/#676A75), or keep two scopes? Also unify breakpoints (920 vs 900)?
5. Reinstate the hero status dots shown in the earlier screenshot?
6. Docs as a single page `/docs` (preserves anchors) vs `/docs/[section]`, and authored as MDX vs TSX data?
7. Should the hero preview eventually show live LOCALNET data, or stay a static illustration?
8. Raise `#62666D` to meet AA. This changes the visual hierarchy, so it needs design approval.
9. FAQ: exclusive accordion or independent items (current behavior is independent)?
