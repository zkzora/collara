# Research notes: reference uploads, logo mark and thumbnail

Scope: `C:\Collara\Collara Website\uploads\*`, `C:\Collara\Collara Website\assets\collara-mark.png`, `C:\Collara\Collara Website\.thumbnail`.
Inspected 2026-10-01 (read-only; nothing in the prototype folder was modified). I wrote temporary previews and analysis scripts only to the session scratchpad.

Legend: **[read]** = observed directly in a file, a hash or a pixel measurement. **[inferred]** = my interpretation.

---

## 0. Summary

| # | File | What it is |
|---|------|-----------|
| 1 | `assets/collara-mark.png` | **The Collara logo mark.** It is a white geometric "C" on a transparent background, 1254x1254 RGBA, generated in ChatGPT (`gpt-image`), which C2PA metadata embedded in the PNG proves. **Byte-identical** to upload #2. |
| 2 | `uploads/ChatGPT Image Oct 1, 2026, 12_36_04 AM.png` | The original logo download from ChatGPT. It is the same file as #1 (same SHA-256). |
| 3 | `uploads/pasted-1790817851444-0.png` | A screenshot of the **Collara Landing hero plus its product-preview card**, taken from an earlier iteration of the prototype. |
| 4 | `uploads/pasted-1790817989563-0.png` | A screenshot of the **Collara Dashboard sidebar nav** (Overview/Cases/Assets/Pledges/Audit with colored square dots), from an earlier iteration. |
| 5 | `uploads/pasted-1790844517825-0.png` | A screenshot of **one Cases-table row (CL-004)** from the Collara Dashboard. |
| 6 | `uploads/web-capture-2026-09-30T17-30-17.json` | An **element-level DOM/CSS capture of two external reference sites**: 25 elements from **linear.app/homepage** and 69 elements from **demo.mercury.com** (dashboard, accounts, treasury, financing, transactions, insights, cards, credit card, team spend). It holds no screenshots or image data. This is the actual design reference: Linear for the landing and docs look, Mercury for the dashboard layout. |
| 7 | `.thumbnail` | A WebP image (not a PNG), 640x338, showing the project thumbnail of the **Collara Docs page**. The design tool generated it [inferred]. |

Main takeaways:
- The **landing and docs palette in the prototype is essentially Linear's dark palette** (`#08090A`, `#F7F8F8`, `#9C9DA1`, `#62666D`, `#3E3E44`), and the **dashboard is Mercury-inspired** but more neutral and less violet. The brief (master prompt §5, line 74) says these are "design references, not permission to copy another brand", so the migration should define Collara-owned semantic tokens. The structural patterns are reusable. Fonts, brand assets and copy are not.
- **Derive an SVG master and a favicon set from the logo.** The current mark is a 384 KB raster that the pages render at 14 to 44 px. The glyph is white only, so it disappears on light backgrounds. The thin separators inside it vanish below about 40 px. There is no favicon, apple-touch-icon or og:image anywhere in the prototype. Details are in §1.6.

---

## 1. Logo mark: `assets/collara-mark.png` vs `uploads/ChatGPT Image Oct 1, 2026, 12_36_04 AM.png`

### 1.1 Identity [read]
| Property | `assets/collara-mark.png` | `uploads/ChatGPT Image … 12_36_04 AM.png` |
|---|---|---|
| Size (bytes) | 384,138 | 384,138 |
| SHA-256 | `4f1440dd08a636e184a00c674009c5095546544cac227d3cd649bde91afdaa56` | same |
| MD5 | `0dc9f2e7b6c84647fc1189e59237cd9c` | same |
| `cmp` | **IDENTICAL** (byte for byte) | |

So `assets/collara-mark.png` is a straight copy of the ChatGPT download. Nothing was cropped, resized or optimized.

### 1.2 Format and pixels [read]
- PNG, **1254 x 1254 px**, 8-bit/channel **RGBA**, non-interlaced.
- PNG chunks: `IHDR`, `caBX` (23,654 bytes; this is the C2PA/JUMBF manifest), 6x `IDAT`, `IEND`. It has no `sRGB`, `gAMA`, `pHYs` or `iCCP` chunk.
- **Transparency: yes.**
  - 70.4% of pixels have alpha = 0.
  - The glyph body sits at alpha 250 to 254 (mode **254**), so the glyph is not quite fully opaque. Only 0.18% of pixels reach alpha 255.
  - Antialiased edges account for roughly 13k pixels with alpha between 16 and 249.
- **Glyph color:** near-white, mean RGB ≈ (253, 253, 253) with a slight speckle (top colors `#FDFDFD`, `#FDFCFD`, `#FCFCFC`, `#FFFFFF`, …). The glyph is not pure `#FFFFFF`. This is typical of AI image output.
- **Noise:** 27,749 pixels have alpha between 1 and 15, a faint haze or speckle. 779 of them lie outside the glyph bounding box. They are invisible at normal sizes but should be thresholded away when the mark is vectorized.
- **Glyph bounding box** (alpha ≥ 128): x 211–1037, y 184–1084, so about **827 x 901 px**. The glyph fills 66% of the canvas width and 72% of its height, and covers 58% of its own bbox. Its center is (624, 634) against the canvas center (626.5, 626.5), which is visually centered.
  - Padding: left ≈ 210 px, right ≈ 215 px, top ≈ 183 px, bottom ≈ 169 px (about 14–17%).
  - Consequence: when the prototype renders the full canvas at 26 px, the visible glyph is only about 17x19 px.
- **Shape** [read from the image]: a bold geometric **"C" made of two nested bands**.
  - The outer band sweeps from top-right around the left to bottom-right.
  - The inner band starts mid-left and tucks inside.
  - The two bands are separated by thin diagonal and horizontal **gaps**, about 24–30 px on the 1254 canvas, measured at columns 300/450/626/800.
  - The right-hand terminals are **chamfered at 45°**, like arrow or chevron tips, with rounded corners.
  - The design reads as "collateral/clamp/link" [inferred meaning].

Previews I rendered for verification (scratchpad, not deliverables): the mark on `#141416`, and the alpha channel. Both show a clean white "C" with two dark separator lines.

### 1.3 Provenance: C2PA manifest inside `caBX` [read]
Strings extracted from the chunk:
- `claim_generator_info`: name **"ChatGPT"**, version `gpt-image`; software agent **"OpenAI Media Service API"**.
- `digitalSourceType`: `http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia` (an AI-generated image).
- Actions: `c2pa.created`, `c2pa.converted`, `c2pa.watermarked.unbound`. The last one suggests an invisible watermark was applied [inferred from the action name].
- Timestamps: `2026-09-30T17:35:37.42Z`. Manifest URN: `urn:c2pa:34516853-b038-49c9-93ff-1a4c4f3fecd3`. Title `image.png`.
- Signature chain: SSL.com C2PA RSA Root CA 2025 / SSL.com C2PA ICA R1, plus an OpenAI TSA timestamp ("OpenAI OpCo, LLC", San Francisco).
- **Embedded SVG:** the manifest contains a 2,414-byte SVG (`<svg width="716" height="716" viewBox="0 0 716 716">`, one black path) referenced as `c2pa.icon`. **This is the OpenAI claim-generator logo, NOT the Collara mark.** Do not mistake it for a vector source of the logo.
- The filename's "Oct 1, 2026, 12:36:04 AM" matches 17:36 UTC on Sep 30. That implies the user's local timezone is **UTC+7** [inferred].

Implications [inferred]:
- Any re-encode or optimization (sharp, oxipng `--strip`, Next/Image) removes or invalidates the manifest. The `c2pa.hash.data` binding breaks.
- The team should decide deliberately whether production assets keep provenance metadata. A redrawn SVG will not carry it.
- **AI-generated logo ownership:** purely AI-generated imagery may have limited copyright protection (US Copyright Office guidance on AI-generated material). This is general knowledge, not legal advice.
  - A human-authored vector redraw with documented design decisions strengthens the ownership position.
  - Run a trademark clearance search before public launch.
  - Flag this to the user as an open question rather than an engineering task.

### 1.4 Where the prototype uses the mark [read]
There are 11 `<img src="assets/collara-mark.png">` references. All of them are raster renders of the full 1254 canvas:

| File : line | Rendered size | Context |
|---|---|---|
| `Collara Landing.dc.html:34` | 30x30 | Top nav logo + "Collara" wordmark (Geist 600, 17px, ls -0.01em, gap 9px) |
| `Collara Landing.dc.html:81` | 18x18 | Preview card breadcrumb "Case workspace / CL-001" |
| `Collara Landing.dc.html:282` | 44x44, opacity .9 | Pre-footer CTA block |
| `Collara Landing.dc.html:296` | 26x26 | Footer logo (wordmark 16px) |
| `Collara Docs.dc.html:30` / `:324` | 30x30 / 26x26 | Nav / footer |
| `Collara Dashboard.dc.html:35` / `:77` | 26x26 | Sidebar header / mobile drawer (wordmark 15.5px) |
| `Collara Dashboard.dc.html:42` | 14x14, opacity 1 (active) or .45 (inactive) | **Used as the icon of every sidebar nav item** (see §2.2) |
| `Collara Dashboard.dc.html:54` | 14x14, opacity .45 | "Settings" button icon |
| `Collara Mobile Preview.dc.html:18` | 26x26 | Header |

No `<link rel="icon">`, apple-touch-icon or `og:image` exists in any prototype page. `grep -c icon` returns 0 for all four .dc.html files. `Collara Landing.dc.html:12-14` has only `description`, `og:title` and `og:description`.

### 1.5 Small-size legibility [read measurements, inferred conclusion]
- The separator gaps measure 24–30 px on the 1254 canvas, about 2.7–3.3% of the glyph height.
- Rendered as the full canvas:

  | Render size | Gap width |
  |---|---|
  | 44 px | ≈ 1 px |
  | 26 px | ≈ 0.5–0.6 px |
  | 16 px | ≈ 0.3–0.4 px |

- At 16 px the gaps disappear and the mark reads as a solid "C" blob.
- Cropping to the glyph bbox gains about 1.4x, which is still sub-pixel at 16 px.

### 1.6 Recommendation: derive SVG and favicon variants (yes)
Do this inside the new repo (for example `packages/ui/src/brand/` and `apps/web/app/`). Do not modify the original prototype.

1. **`collara-mark.svg` master (vector).**
   - Preferred route: hand-redraw the geometry (two concentric bands, 45° chamfered terminals, rounded corners) in Figma or Illustrator, using the PNG as an underlay.
   - Alternative: auto-trace the alpha ≥ 128 mask with potrace or Inkscape "Trace Bitmap", then clean up nodes, straighten the 45° chamfers, and equalize the gap widths.
   - Crop the viewBox to the glyph (aspect about **0.917 : 1**, i.e. 827:901). Optionally add a square variant with about 12% padding.
   - Use `fill="currentColor"` so it inherits theme color. Expose it as a React `<CollaraMark size title />` component with `aria-hidden` when decorative.
2. **Color variants.** The current asset is white only and is **invisible on light surfaces** (browser light-mode tabs, emails, PDFs/exports, print, light docs). Ship at least:
   - light-on-dark (default, `#F7F8F8` or white)
   - dark-on-light (`#08090A`)
   - optionally a "tile" variant: a white glyph on a dark rounded square (`#08090A`, radius about 22%)
3. **Small-size variant (≤ 32 px).** Either use a simplified glyph (single solid C, or separators widened to ≥ 1 device px at 16 px, which means ≥ 6% of glyph height), or always use the tile variant at favicon sizes.
4. **Next.js App Router metadata files** (file conventions):

   | File | Spec |
   |---|---|
   | `app/icon.svg` | SVG with an embedded `<style>@media (prefers-color-scheme: light){…}</style>` that swaps fill, **or** the tile variant |
   | `app/favicon.ico` | 16/32/48 multi-size, tile variant |
   | `app/apple-icon.png` | 180x180, opaque `#08090A` background, glyph about 60–65% |
   | PWA icons | 192/512, plus a maskable 512 with an 80% safe zone if a manifest is added |
   | `app/opengraph-image.(png\|tsx)` | 1200x630 (the `.thumbnail` is too small and is a design-tool artifact; see §3) |

5. **Performance.** Stop shipping the 384 KB 1254² PNG for 14–44 px renders. Inline the SVG component, or keep a pre-sized 64/128 px PNG/WebP for email or third parties.
6. **Clean-up when vectorizing.**
   - Threshold out the alpha 1–15 haze.
   - Use pure `#FFFFFF`/`currentColor`, not the 253-grey of the raster.
   - Keep the original PNG archived as the "source of record" alongside its C2PA provenance.
7. **Dashboard nav icon pattern (open question).** The prototype currently uses the logo mark as the icon for *every* nav item (`Collara Dashboard.dc.html:42`, `markOpacity` at line 1290). This weakens wayfinding. The earlier iteration (screenshot #4) used colored status dots. The brief lists `Sidebar` as a shared primitive, so the team needs to decide between distinct icons, dots, and the mark.

---

## 2. Pasted screenshots (Collara's own prototype, earlier iterations)

All three are PNG RGBA, fully opaque, with `sRGB`, `gAMA` and `pHYs` chunks, the typical output of a Windows clipboard paste.
- The numeric part of each filename is a **Unix epoch in milliseconds** [inferred; the decoded dates fit the timeline].
- Text in all three shows **ClearType sub-pixel color fringes**, so they were captured on Windows. Do **not** sample accent colors from these images. Use the source tokens instead (`C` map, `Collara Dashboard.dc.html:1053`).

### 2.1 `pasted-1790817851444-0.png`: Landing hero (900x757, epoch → 2026-10-01T01:24:11Z)
SHA-256 `bf326941d5a40fb5bf959edabd8b6353a7c9c2d5d91b1c2504bdf49eaf3bf384`.
It is a crop of a wider viewport: the hero is centered at x ≈ 533 and the preview card runs off the right edge.

Contents, top to bottom:
- **Eyebrow pill:** a 1px hairline pill with an **amber dot**, then `PRIVATE EQUIPMENT COLLATERAL WORKFLOWS` in uppercase Red Hat Mono.
- **H1** (3 lines, white, tight leading): "Equipment evidence and pledge workflows, coordinated privately."
- **Sub-copy** (grey): "Bring used CNC equipment evidence, verification, and lender review into one coordinated workflow. Share the relevant records with selected counterparties and track who can authorize each pledge and release."
- **CTAs:** "Request a pilot" (white filled, dark text) and "Read the workflow →" (outlined).
- **Footnotes** (dim): "Starting with used CNC financing. Built on Canton." / "Collara is currently in development. We are seeking equipment-finance design partners."
- A faint warm radial glow above the card.
- **Product preview card** (dark surface, hairline border, rounded):
  - Header: mark + "Case workspace / CL-001" (ID in mono), and chips `Demo data — LocalNet` (outlined mono) and `Illustrative demo…` (amber-tinted, cut off).
  - Left column: `CASE` label; "Used CNC financing · CL-001"; "CNC machining center · DEMO-CNC-500 · Serial SYNTH-CNC-001"; "Current stage" with an amber pill "Awaiting lender review"; row "Evidence · • Inspection report · submitted".
  - Right column: `EVIDENCE PACKAGE · SHARED WITH DEMO LENDER A`, then the list
    - "Inspection report / Demo Verifier · v2 · PDF / Atte[sted]" (green)
    - "Dealer invoice / Demo CNC Dealer · v1 · PDF / Hash ver[ified]"
    - "Equipment photos (6)"

Sampled backgrounds [read]: page `#08090A` (dominant), text `#F7F8F8`, card `#0E0F11` / `#111214`, warm glow pixels around `#201D18` / `#29231B`.

Matches the current source `Collara Landing.dc.html:63-113`: H1 at line 67, sub-copy at 68, CTAs at 70–71, footnotes at 73–74, card at 81–113 with "Illustrative demo case" at 84 and "Evidence package · shared with Demo Lender A" at 109.

**Difference:** the current eyebrow at line 66 has **no amber dot**. It is plain text "Private equipment collateral workflows" in a pill, `color:#9C9DA1`, Red Hat Mono 11.5px, ls .07em, uppercase. So the screenshot is from a different (earlier or later) iteration [inferred].

### 2.2 `pasted-1790817989563-0.png`: Dashboard sidebar (182x175, epoch → 2026-10-01T01:26:29Z)
SHA-256 `fee43cb9f21788e33f0765d743612b183196aab441f90b4fd775e9d071d76ec9`.
- Nav items, each with a **~5 px rounded-square color dot**, a label, and a right-aligned mono count:
  - **Overview** (active row: background `#1D1E22` on sidebar `#0C0D11`, rounded; amber dot)
  - **Cases** (blue dot) `5`
  - **Assets** (green dot) `1`
  - **Pledges** (light-grey dot) `1`
  - **Audit** (grey dot)
- Below: the mono uppercase label `SAVED VIEWS`, partially visible.
- Matches `Collara Dashboard.dc.html:42-45` and `navDefs` at line 1289, whose dot colors are still defined: `C.pend`, `C.info`, `C.ok`, `#B5B5BF`, `#6F727D`.
- **Differences from current source:**
  - Current nav renders the **Collara mark at 14px** instead of the dot (line 42, `opacity:{{ n.markOpacity }}`). The `dot` field is computed but no longer rendered.
  - A sixth item, **Governance** (count = open governance proposals), was added.
  - Active row background is now `rgba(255,255,255,.07)`.
  - Active text is `#F4F5F7`; inactive text is `#9A9CA6`.

### 2.3 `pasted-1790844517825-0.png`: Cases table row (1031x62, epoch → 2026-10-01T08:48:37Z)
SHA-256 `2117ee2ac082ba936f8bbb0cf206a5454612ccbb2d89cd4b54adcb71f910e604`.
- One row inside a rounded container. Row surface `#16171D`, outer `#101116`, hairlines `#28292F` / `#24252A`.
- Columns:
  1. `CL-004` (mono)
  2. "CNC machining center · DEMO-CNC-500" with sub-line `ASSET-DEMO-004` (mono, dim)
  3. "Demo Tooling Inc"
  4. "• Attested" (green dot)
  5. "• Awaiting approval" (amber dot)
  6. "• Available" (grey dot)
  7. "Demo Lender A · Approver" (dim)
  8. "5h ago" (right-aligned, dim)
- Matches the fixture at `Collara Dashboard.dc.html:1198`: `row('CL-004', 'CNC machining center · DEMO-CNC-500', 'ASSET-DEMO-004', 'Demo Tooling Inc', chip('Attested','ok'), chip('Awaiting approval','pend'), chip('Available','neu'), 'Demo Lender A · Approver', '5h ago', …)`.
- Status color map at line 1053: `C = { ok: 'oklch(74% 0.13 155)', pend: 'oklch(82% 0.12 75)', neu: '#6F727D', bad: 'oklch(70% 0.17 25)', info: 'oklch(74% 0.1 250)' }`.
- Useful as the visual spec for the brief's `CaseTable` and `StatusBadge` primitives:
  - Column order: case ID → asset → borrower org → verification → decision → collateral availability → my role → recency.
  - Each status is shown as a dot plus a label (not a filled chip).

[inferred] Screenshots #3–#5 were probably pasted into the design-tool chat as visual references for edit requests. There are no annotations, so the intent of each paste is unknown.

---

## 3. `.thumbnail` [read]
- Despite having no extension, it is **WebP** (RIFF/`WEBPVP8X`), **640x338**, RGB with a 456-byte ICC profile, 18,418 bytes.
- SHA-256 `ca5a7ff81e621d250f260bc1ef8ed07a460d111ef8a52e1df50ddcfcbf4809a5`.
- It shows the **Collara Docs page** (`Collara Docs.dc.html`, `<title>Collara — Docs (pre-build)</title>` at line 11) at desktop width:
  - **Top nav:** mark + "Collara"; Product / Workflow / For Lenders / Why Canton / **Docs** (active, pill); Sign in; "Request a pilot" (white button).
  - **Amber banner:** "PRE-BUILD … This documentation describes a specification and interactive UI mockups. No running implementation, deployed contracts, API, or test suite exists yet." (source line 62)
  - **Left doc nav:** Overview, Workflow, Roles & permissions, Synthetic demo scenario, Planned BitSafe governance, Setup, API & tests. Below it a status legend with mono badges: "UI mockup", "Specified", "Planned"…
  - **Body:** H1 "Collara documentation"; intro paragraph; "Project status: pre-build" card; two cards "What Collara coordinates" / "What Collara is not"; and a "Capability status" table (Capability / Status / Where) with rows "Landing page", "Lender workspace: overview, case queue, …" (source lines 90–107).
- [inferred] This is the design tool's auto-generated project thumbnail (the `.dc.html` / `<x-dc>` / `support.js` runtime), not a brand asset.
  - Not suitable as an OG image: it is low-res and its 1.89:1 aspect is not 1.91:1.
  - It is useful only as a quick visual of the Docs layout.

---

## 4. `web-capture-2026-09-30T17-30-17.json` (2,618,625 bytes)

### 4.1 Structure [read]
- Top level: **JSON array of 94 objects**. Every object has exactly these 12 keys:

  | Key | Type | Notes |
  |---|---|---|
  | `id` | string | `cap_<base36 Date.now()>_<rand>`, e.g. `cap_muodcugo_d8cfil`; `muodcugo` decodes to `2026-09-30T17:18:22.776Z`, equal to its `timestamp` |
  | `selector` | string | e.g. `nav.TZTsQG_menuRoot`, `div._large_kwlx6_9` (CSS-module hashed class names) |
  | `label` | string | Truncated text label |
  | `tag` | string | `nav`, `div`, `h1`, `td`, `svg`, … |
  | `url`, `title` | string | Page URL and document title |
  | `timestamp` | ISO string | 2026-09-30T17:18:22Z → 17:28:01Z. The filename `17-30-17` is the export time. |
  | `innerText` | string | 38,982 chars total |
  | `outerHTML` | string | **2,366,547 chars total, about 91% of the file**. The largest are #1 `main` and #2 Linear root (≈456 KB each), #75 Mercury cards page (180 KB), #82 credit-usage `<svg>` (163 KB). |
  | `rect` | `{x,y,width,height}` | Viewport-relative. The Linear nav is 1905 px wide, so the window was about 1920 px with a scrollbar [inferred]. |
  | `computedStyles` | object | A whitelisted subset: display, width, height, padding, margin, border, border-radius, box-shadow, background, color, font-family, font-size, font-weight, line-height, letter-spacing, gap, grid-template-*, flex*, position/insets, transform, overflow, cursor, z-index, transition. 45 KB total. |
  | `cssRules` | array of `{selector, css, media?}` | Non-empty only for Linear entries #3–#16 and #21 (14.8 KB total). Mercury entries all have `[]`. |

- **No screenshots or image data:** zero `data:image/...;base64` occurrences.
  - `<img>` tags reference remote URLs only: `https://linear.app` (99), `https://webassets.linear.app` (6), `https://cdn-development.mercury.com` (24).
  - There are 632 + 384 inline `<svg>` elements, mostly icons and charts.
- **No `<style>` blocks** and **no `:root` custom-property values.** `var(--…)` names appear but their values do not.
- **Noise:** 4,331 `bis_skin_checked="1"` attributes injected by a browser extension [inferred: an antivirus/web-protection extension]. Strip them if any HTML is reused.
- [inferred] This was produced by a DOM element-picker capture tool (each entry is one user-clicked element), probably the design tool's "web capture" import. It is a style reference, not a page archive.

### 4.2 What was captured [read]
| Site / page | Count | Entries |
|---|---|---|
| `https://linear.app/homepage`, title "Linear – The system for product development" | 25 | #0–#24 |
| `https://demo.mercury.com/team-spend` | 10 | #25–#34 (org switcher, search pill, dashboard content, H1 "Team Spend", cards "Budget spend summary $4,593.84" / "Review required", sidebar nav, top bar) |
| `…/dashboard` | 4 | #35–#38 ("Money movement" row, 3-up module row: Credit Card / Bill Pay / Invoicing) |
| `…/accounts` | 1 | #39 |
| `…/accounts/treasury/party-treasury-id-0` | 5 | #40–#44 (header, balance block, daily activity table, grid cells) |
| `…/capital/ecommerce` ("E-commerce Dashboard \| Mercury") | 4 | #45–#48 (Financing header, outstanding balance + repayment progress, activity table) |
| `…/capital/venture-debt` | 6 | #49–#54 (loan card, "Next payment" side panel, tabs Home / Working Capital / Venture Debt / SAFEs) |
| `…/capital/safe` | 2 | #55–#56 (summary strip "Total / Received / Outstanding / SAFEs", view filters All / Active / Cancelled / Expired) |
| `…/transactions` | 4 | #57–#60 (title, "Saved views / Filters / Date / Keyword / Amount", net-change strip, "Match receipts" pill) |
| `…/insights/overview` | 10 | #61–#70 (sticky controls + month timeline, Net cashflow metrics, chart hit-area, disclaimer, money in/out tables) |
| `…/cards` | 8 | #71–#78 (title, recommendations card, tabs Manage / Subscriptions, filter bar, cards table cells) |
| `…/accounts/credit` | 15 | #79–#93 (header + actions, credit meter, usage SVG chart, "This month" breadcrumbs strip, table header cells) |

So the "Mercury dashboard" reference is in this JSON, not in the PNGs. Linear is the second reference, for the marketing page.

### 4.3 Mercury (demo.mercury.com): reusable dashboard patterns and measured tokens [read]
All values come from `computedStyles`. The colors are Mercury's dark theme.

**Color**

| Role | Value |
|---|---|
| App background | `rgb(23,23,33)` = `#171721` (`_dashboardContent`, sticky headers, table header cells) |
| Card surface | `rgb(30,30,42)` = `#1E1E2A` |
| Hairline / border | `rgba(180,183,200,0.12)` (1px card border; also as inset box-shadow `0 -1px 0 0` for tab bars and `0 1px 0 0 inset` for table headers) |
| Active tab underline | `rgba(180,183,200,0.36) 0 -2px 0 0 inset` |
| Pill button background | `rgba(180,183,200,0.12)` (search) / `rgba(180,183,200,0.2)` ("Match receipts") |
| Text, title | `#FFFFFF` |
| Text, button and link | `rgb(244,245,249)` `#F4F5F9` |
| Text, secondary | `rgb(221,221,229)` `#DDDDE5` |
| Text, label | `rgb(195,195,204)` `#C3C3CC` |
| Text, tertiary | `rgb(157,157,168)` `#9D9DA8` |

- Hex values seen in HTML: `#B5B5BF`, `#707393`, `#2A293C`, `#514E82`, `#F6F5FF`, `#EFEFFD`, `#C45000`, …
- Card elevation, small: `rgba(175,178,206,0.56) 0 0 2px 0, rgba(4,4,52,0.1) 0 1px 4px 0`.
- Card elevation, loan card: a 4-layer stack, `rgba(183,187,219,.14) 0 1px 4px, rgba(175,178,206,.9) 0 0 1px, rgba(14,14,45,.08) 0 8px 12px, rgba(4,4,52,.02) 0 14px 20px`.

**Typography.** Mercury uses its proprietary **"Arcadia Text" / "Arcadia Display"** with fallback `system-ui, sans-serif`, at unusual weights **360** (text) and **380** (display). Do not copy the font. Collara already uses Geist.

The role scale, from CSS-module `qaod7` class names, is a good model for Collara's type tokens:

| Role (class) | Size / line-height | Extra |
|---|---|---|
| `_titleMain` (page H1) | 28 / 36 | Display, wt 380 |
| `_bodyLarge` (section title, e.g. "Activity") | 17 / 28 | |
| `_bodyDefault` (inline link-buttons) | 15 / 24 | |
| `_label` (metric label "Net cashflow") | 15 / 20 | ls 0.1px, `#C3C3CC` |
| `_bodySecondary` (tabs, table header cells) | 14 / 20 | `#DDDDE5` (tabs) or `#9D9DA8` (headers) |
| `_tiny` (captions, disclaimers) | 12 / 20 | ls 0.2px |
| Chart overlay text | 13 / 20 | ls 0.1px |
| Buttons | 13.333 | Browser default for `<button>`, wt 360 |

- Text-color utility classes: `_text-title`, `_text-secondary`, `_text-tertiary`.
- Semantic CSS variable *names* seen (values not captured), a good naming model:
  - `--ds-text-secondary`, `--ds-text-link`
  - `--ds-icon-default|secondary|tertiary|emphasized|error|money-in`
  - `--ds-background-default`
  - `--ds-data-visualization-segment-primary|secondary|background`, `--ds-data-visualization-line`
  - `--net-change-positive|negative`
  - `--inflow-bar-gradient-start|end`, `--outflow-bar-gradient-start|end`

**Layout (AppShell).** Measured at a 1905 px viewport.
- **Sidebar.**
  - Width **219 px**, plus a 1px divider, so content starts at x = 220.
  - Org switcher block 48 px tall ("Mercury Demo / Pro", padding 8 6 8 8).
  - "Banking | Books" segmented switch, 40 px (padding 4 8).
  - Nav container: padding `8px 0 40px`, gap 12px, `overflow:auto`. Grouped items: Home, Tasks (badge 10), Command, Accounts, Treasury, Financing, Transactions, Insights, Cards, Credit Card, Team Spend, …, Bookmarks.
- **Top bar.**
  - Full width, **48 px**, content centered.
  - Search pill "Search for anything": 180x32, `border-radius:9999px`, padding `4px 16px 4px 12px`, font 13.33px.
  - Primary action "Move money".
- **Page content column.**
  - **968 px** wide, centered (`margin: 24px 32px 40px`, `padding-bottom:112px`).
  - Data-heavy pages (Transactions, Insights) go full-bleed at about 1400–1530 px with 24 px padding.
- **Page header.**
  - 56 px: a 40 px title row plus 16 px bottom padding. The background equals the page background so it can stick.
  - Right-aligned pill actions: "Share feedback", "Create budget", "Transfer funds", "Pay", "How limits work", "Request a limit increase".
- **Cards.**
  - `border-radius:12px`, padding **24px** (hero cards 40px), inner gap 16–20px.
  - Module rows: a **3-column grid with 24 px gap** (306.66 px each in 968).
  - 2-up mixes: 568 + 384 (gap 16) and 636 + 330 (loan card + side info panel).
- **Tabs.** Bar 40 px; tab label 14/20; padding 10px 0; 24 px between tabs; active state shown by a 2px inset underline.
- **Filter row.** "Saved views / Filters / Date / Keyword / Amount", 32 px chips, gap 8px; "Add filter · No filters applied". (The Collara prototype's "Saved views" sidebar label echoes this.)
- **Summary strip.** Grid `368 | 1px | 722 | 1px | 496` with 1px vertical dividers, 76 px tall, padding `12px 16px`, gap 16. Example: "Net change this month $0.00 | Money in $0.00 | Money out $0.00".
- **Tables.**
  - Header cells 36 px (padding 8 0), 14/20 tertiary text, top hairline. **Numeric columns right-aligned** ("Amount", "Ending balance").
  - Body rows 52–58 px; first cell `border-radius: 8px 0 0 8px` for a rounded hover row.
  - Collapsible secondary columns (`_collapsible`) hide on narrow widths.
- **Metric block.** Label (15/20) above the amount, baseline-aligned with its cents/suffix (`align-items: baseline; gap 4px`).
- **Sticky controls.** Insights uses `position:sticky; top:0; z-index:2` with the page background.
- Microcopy pattern: "Trends are generated and may include inaccuracies." Use 12/20 tertiary text for honest disclaimers. Collara needs the same treatment for "Demo data", "Illustrative" and "Pending ledger confirmation" notes [inferred].

**Mapping to Collara screens** [inferred]:

| Mercury pattern | Collara screen |
|---|---|
| Overview "Money movement" plus 3-up module row | Lender Overview "needs decision" tiles |
| Transactions table + saved views + filters | Case Queue |
| Venture-debt loan card + "Next payment" side panel | Pledge detail (status + authorized parties + release request) |
| Tabs bar | Case tabs (Summary / Evidence / Verification / …) |
| Summary strip with dividers | Case-queue counters |

### 4.4 Linear (linear.app/homepage): reusable marketing-page patterns [read]
**Color.**
- Text `rgb(247,248,248)` = `#F7F8F8`.
- Product-frame surface `rgb(16,17,18)` = `#101112`.
- Frame border `1px solid rgba(255,255,255,0.08)`, radius 12px.
- Hex values most used in the HTML (SVG fills/strokes): `#e4e5e9` (375), `#9c9da1` (206), `#08090A` (165), `#2E2E32` (105), `#62666D` (75), `#3E3E44` (70), `#D0D6E0` (60).
- Semantic variable names: `--color-bg-primary`, `--color-text-primary|secondary|tertiary|quaternary` (a **four-level text hierarchy**), `--color-border-translucent-strong`, `--color-brand-bg`, accent names `--color-green|yellow|indigo|orange|red|blue|teal`.
- Layout variables: `--homepage-padding-inset`, `--homepage-outer-padding`, `--homepage-max-width`, `--border-hairline`, `--mask-visible` / `--mask-invisible`, `--grid-columns`, `--grid-gap`, `--ease-out-quad`.

**Typography.** Container computed font is `-apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", "Nanum Gothic", sans-serif` at 16/24. The footer uses 13/19.5 with ls -0.13px. Heading sizes are not in the capture: they come from styled-components classes `sc-KOGVz lmPTvT`, whose computed styles were not recorded on child nodes. Headings use a `max-width: 18ch` (section) or `16ch` (prefooter) measure.

**Layout.**
- Nav **72 px** tall.
- Content **1344 px** inside a 1436 px root (46 px side padding).
- **12-column grid, 32 px gap**, collapsing to 8 columns at ≤768 and 4 at ≤640, with breakpoints at **1024 / 768 / 640**.
- **Section** (`b-30Va_root`): `padding-block:128px` (48/96 at ≤768, 0 at ≤640).
- **Section header:** a 2-column grid (title | description + "Learn more →") with `padding-bottom:96px` (64 at ≤1024; 40 top / 48 bottom at ≤640). It collapses to 1 column at ≤1024.
- **Product mock frames:**
  - `border-radius:22px; padding:8px; border:1px solid var(--color-border-translucent-strong)`.
  - **Gradient fade** `mask-image: linear-gradient(to bottom, visible 0%, visible 60%, invisible 100%)`.
  - Stages bleed past the content width (`translateX(var(--stage-bleed))`).
  - This is the same idea as Collara's landing "Case workspace" preview card.
- **Numbered benefits:** "FIG 0.1 Purpose-built / FIG 0.2 Powered by agents / FIG 0.3 Designed for speed", each a mono figure label, title and one sentence. Collara's mono uppercase eyebrows follow this pattern.
- **Prefooter:** a centered H2 "Built for the future. Available today." (max 16ch) and two large buttons (`variant-invert` "Get started" + `variant-secondary` "Contact sales", gap 12px). Column flex with gap 40px and `margin-block:224px` (128 at ≤768, 96 at ≤640).
- **Footer:** link columns 224 px wide (padding 0 32px), headings Product / Features / Resources / Connect, legal links row with gap 20px.
- **Changelog** list with uppercase dates ("SEP 24, 2026") and customer-quote cards (gap 8px, padding 12px 12px 0).

### 4.5 How the prototype already uses these references [read]
Tallies are hex counts in the source files.

| Token role | Linear (capture) | Collara Landing / Docs | Mercury (capture) | Collara Dashboard |
|---|---|---|---|---|
| Page background | `#08090A` | `#08090A` (Landing 19x) | `#171721` | `#101116` (body, line 15) |
| Sidebar | — | — | (same as page) | `#0C0D11` |
| Surface / card | `#101112` frame | `#0E0F11`, `#111214` (Docs `#0F1013`) | `#1E1E2A` | `#16171D` (69x), `#1E1F27` |
| Text primary | `#F7F8F8` | `#F7F8F8` (40x) | `#FFFFFF` / `#F4F5F9` | `#F4F5F7` (102x) |
| Text secondary | `#D0D6E0` | `#D0D1D4` (Docs `#C9CBD3`) | `#DDDDE5` | `#C9CBD3` |
| Text tertiary | `#9c9da1` | `#9C9DA1` (71x) | `#9D9DA8` | `#9A9CA6` (211x) |
| Text quaternary | `#62666D` | `#62666D` (32x) | — | `#676A75` (168x), `#4E515B` |
| Separator text | `#3E3E44` | `#3E3E44` | — | — |
| Hairline | `rgba(255,255,255,.08)` | `rgba(255,255,255,.06–.16)` (.08 most common) | `rgba(180,183,200,.12)` | `rgba(255,255,255,.08)` (146x) |
| Neutral chip | — | — | `#B5B5BF` (in HTML) | `#B5B5BF` (Pledges dot) |
| Radius | 12 / 22 | 8, 9, 12, 999 | 12, 9999 | 10, 8, 7, 999 |
| Fonts | system stack | **Geist** 300–800 + **Red Hat Mono** 400/500 (Google Fonts) | Arcadia (proprietary) | same as Landing |
| H1 | n/a | `clamp(38px,6vw,74px)`/1.02, ls -0.035em, wt 500 (Landing:67) | 28/36 | 22px wt 500, ls -0.02em (line 91) |

Conclusions [inferred]:
- The Landing and Docs neutrals are **Linear's palette nearly verbatim**.
- The Dashboard adopts **Mercury's structure** (sidebar, 48 px top bar, centered content, 12 px cards, pill actions, saved views) with a cooler-neutral palette of its own and one exact Mercury value (`#B5B5BF`).
- For the full-stack app (`packages/ui` design tokens, Tailwind + CSS variables + shadcn per the brief §2, line 31):
  - Define **Collara semantic tokens** (`--bg`, `--bg-subtle`, `--surface`, `--surface-raised`, `--border`, `--text-1..4`, `--status-ok|pend|bad|info|neutral`) and map them to the prototype's values. This preserves the "approved look" per brief §5.
  - Do not reference Linear or Mercury names. Do not use Arcadia fonts, Mercury/Linear logos, or their class names or copy.
  - Generic neutral greys are not brand-protectable, but avoid shipping a pixel-identical clone of either site [inferred risk judgement].

### 4.6 Useful tokens to carry forward (proposal)
- **Spacing and layout:**
  - Dashboard: sidebar 220 px (219 + 1 hairline); top bar 48 px; content max-width 968 px for narrative pages, full-bleed with 24 px padding for tables; card padding 24; grid gaps 16 / 24; page-header block 56 px.
  - Landing: max-width 1120–1344 px; section padding-block 128 / 96 / 48; header-to-content 96 / 64 / 48; breakpoints 1024 / 768 / 640, plus the prototype's own 900 / 560 dashboard breakpoints (`Collara Dashboard.dc.html:22-23`).
- **Type scale (dashboard, Geist):** 28/36 page title (the prototype uses 22), 17/28 section, 15/24 body, 14/20 table/tab, 13/20 dense meta, 12/20 caption; mono 11–12 px uppercase ls .05–.08em for IDs and eyebrows (Red Hat Mono).
- **Radius:** 12 for cards; 8–10 for rows and inputs; 999 for pills and chips.
- **Elevation:** hairline borders on dark surfaces instead of heavy shadows. Use at most a 2-layer subtle shadow for popovers and dialogs.
- **Status:** keep the prototype's OKLCH status map (`Collara Dashboard.dc.html:1053`) as `--status-*` tokens, rendered as dot plus label (screenshot §2.3).
- **Patterns:** saved views plus filter chips on the Case Queue; summary strip with dividers; right-aligned numerics; sticky page header and controls; honest-disclaimer caption style; landing product-preview frame with bottom gradient mask.

---

## 5. Timeline [read timestamps, inferred sequence]
| UTC time | Event |
|---|---|
| 2026-09-30 17:18:22 → 17:28:01 | Web capture of linear.app homepage, then demo.mercury.com pages |
| 2026-09-30 17:30:17 | Capture JSON exported (filename) |
| 2026-09-30 17:35:37 | Logo generated in ChatGPT (C2PA). Local-time filename "Oct 1, 2026, 12_36_04 AM" means UTC+7 [inferred] |
| 2026-10-01 01:24:11 | Landing hero screenshot pasted |
| 2026-10-01 01:26:29 | Dashboard sidebar screenshot pasted |
| 2026-10-01 08:48:37 | Cases row screenshot pasted |
| 2026-10-01 (file mtime 17:12 local) | Files copied into `C:\Collara\Collara Website\` |

---

## 6. Open questions for the user
1. **Logo ownership and redraw.** May we commission or produce a human-redrawn vector of the ChatGPT-generated mark? Should the C2PA provenance be preserved in the archived source? Has a trademark search been done?
2. **Light-mode and print usage.** Is a dark-on-light logo variant approved? (Needed for favicon in light tabs, PDFs/exports, email.)
3. **Dashboard nav icons.** Keep the current "logo mark as every nav icon" or revert to the colored status dots of the earlier iteration (screenshot §2.2)? Or use distinct line icons?
4. **Landing eyebrow.** Keep the amber dot shown in screenshot §2.1, or the current dot-less pill (`Collara Landing.dc.html:66`)?
5. **Palette distance from Linear.** Is the near-verbatim Linear neutral palette on the landing "approved Collara direction" as-is, or should it be nudged to a Collara-specific neutral and accent set?
6. **Purpose of the pasted screenshots.** Were they bug reports or edit requests (for example, the preview card overflowing at that viewport) or just references? The files contain no annotations.

---

## 7. Reproduction (commands used)
```bash
# hashes / identity
sha256sum "C:/Collara/Collara Website/assets/collara-mark.png" "C:/Collara/Collara Website/uploads/ChatGPT Image Oct 1, 2026, 12_36_04 AM.png"
cmp  "…/assets/collara-mark.png" "…/uploads/ChatGPT Image Oct 1, 2026, 12_36_04 AM.png" && echo IDENTICAL
file "C:/Collara/Collara Website/.thumbnail"          # RIFF … Web/P image
# pixels (Python 3.12 + Pillow 12.3 + numpy 2.2)
python -c "from PIL import Image; im=Image.open(r'C:\Collara\Collara Website\assets\collara-mark.png'); print(im.size, im.mode)"
# capture JSON overview (Node 24)
node -e "const j=require('C:/Collara/Collara Website/uploads/web-capture-2026-09-30T17-30-17.json'); console.log(j.length, Object.keys(j[0]))"
# C2PA strings: scan the caBX chunk for printable runs (see §1.3)
```
