# Design System — LITBIG (잉크-다크 변주 / Ink-Dark variant)

> Source of truth for `ui/src/renderer/src/index.css`. Brand derives from the
> LITBIG design system (Korean Tier-1/2 automotive electronics — _Little but Big_).
> This document describes the **ink-dark variant** used by the CANalyst-II
> controller: the LITBIG brand's ink/orange/type/chamfer applied to a dark
> surface family so the app stays comfortable for long CAN-traffic monitoring.

## 1. Visual Theme & Atmosphere

LITBIG's identity is **restrained, technical, datasheet-confident** — the voice of an automotive-electronics supplier (AVN · SVM · Cluster · DSM · DVRS · QuadEYE). The mark is the system: a chamfered cube with a **square orange face** and a **chamfered dark side**. That **45° chamfer is the only signature shape**, and **orange `#FF6A13` is the only "loud" color** — it exists to mark the single most important thing on a surface, never to decorate.

The LITBIG brand is white-by-default, but this app is a real-time CAN monitor used for long sessions. We therefore adopt the brand's sanctioned **ink (`#231815`) surface** (reserved in the brand for "brand moments") as the _entire_ surface family, deriving a **warm-ink dark ladder** from it. The philosophy is "content-first darkness": the UI recedes into warm near-black so the live RX/TX traffic — the only thing that matters — glows. Orange is spent on exactly that: the primary CTA, the live connection status, your own transmissions, and the hero throughput number.

Unlike a cool, blue-black dark theme, every neutral here is **warm-leaning**, harmonizing with the brown-black ink and the orange. Corners are **sharp** (the mark is angular); the chamfer is the only curve-alternative, used sparingly on brand moments.

**Key Characteristics:**
- Warm-ink immersive dark theme (`#140d0b`–`#3d332f`), derived from brand ink `#231815` — UI recedes behind live traffic
- Orange `#FF6A13` as the singular brand accent — functional only, kept under ~10% of any surface
- Pretendard (UI/body) · Chakra Petch (display/wordmark) · JetBrains Mono (hex/specs/data) — all bundled offline
- **Sharp** geometry: 2px controls, 4px cards. Pills reserved for status chips only. Chamfer (45°) is the signature shape
- Korean-first copy; numerals/units/codes inline (`500,000 bps`, `0x18F`, `ISDB-T`)
- Elevation from **borders + tonal shifts**, not heavy shadows
- Semantic colors tuned for legibility on dark: danger `#f2685f`, warning `#e8a33d`, info `#5b95e0`, success `#34c77b`
- The LITBIG **vertical lockup** (chamfered cube mark over the `LITBIG` wordmark) is the official CI — the only sanctioned lockup; inverse (white-monochrome) on dark surfaces

### Brand lockup (CI)

The updated LITBIG design system unified on the **vertical lockup** — `logo-litbig-vertical.png` (the chamfered cube mark stacked above the `LITBIG` wordmark) — as the only sanctioned CI; the horizontal lockup is **deprecated — do not use it**. On dark/ink surfaces render it white-monochrome via the brand's inverse-filter trick (`filter: brightness(0) invert(1)`), which drops the orange cube so orange stays reserved for functional signals (CTA / live / TX / hero number). Don't recolor, rotate, or add effects; keep clear space around it.

This app's sidebar header is intentionally **text-only** — the `CANalyst-II` product wordmark (display) over the `CAN 분석 콘솔` descriptor. The lockup is documented here as the brand reference for brand surfaces outside the live monitor (splash / about / installer), not stamped into the working chrome, so the warm-ink monitor stays the only thing that glows.

## 2. Color Palette & Roles

### Primary Brand
- **Orange** (`#ff6a13`): `--litbig-orange` / `--accent` — the only loud color. Primary CTA, live status, TX, hero number
- **Orange Hover** (`#e85a04`): `--litbig-orange-600` / `--accent-bright` — filled-button hover (brand rule: darken on hover)
- **Orange Press** (`#c44a00`): `--litbig-orange-700` / `--accent-press`
- **Orange Soft** (`#ffa66b`): `--litbig-orange-300` — "quiet tint" for secondary signals (DBC decoded name, TX badge)
- **Ink** (`#231815`): `--litbig-ink` — warm near-black from the wordmark; Level-1 surface and inverse base
- **On-Orange** (`#ffffff`): `--on-accent` — text/icons on orange fills are white (brand)

### Surfaces (warm-ink depth ladder — depth via shade variation only)
- **Base / Level 0** (`#1a1210`): `--bg-base` — page background
- **Sidebar** (`#140d0b`): `--bg-sidebar` — deepest rail (the "library")
- **Surface / Level 1** (`#231815`): `--bg-surface` — cards & panels (= brand ink)
- **Input** (`#2e2522`): `--bg-input` / `--bg-card` — interactive surfaces, raised cards
- **Hover** (`#3d332f`): `--bg-hover` — row/card hover
- **Row Alt** (`#1f1613`): `--bg-row-alt`

### Text (warm whites)
- **Base** (`#f5f1ee`): `--text-base` — primary text on ink (brand fg-on-ink)
- **Near** (`#e8e0db`): `--text-near` — table cells, emphasis
- **Secondary** (`#b4a8a1`): `--text-secondary` — labels, muted
- **Muted** (`#897c74`): `--text-muted` — placeholders, meta, disabled-ish

### Semantic (lightened for dark surfaces)
- **Danger** (`#f2685f`): `--negative` — errors, destructive actions
- **Warning** (`#e8a33d`): `--warning` — amber (deliberately off-orange to avoid clash); paused state, overwrite banners, demo/mock badge
- **Info** (`#5b95e0`): `--info` — driver hints
- **Success** (`#34c77b`): `--success`

### Border / Divider (warm ink)
- **Border** (`#382c28`): `--border` — cards, inputs, row separators
- **Border Strong** (`#4a3d38`): `--border-strong` — input rest border, strong dividers
- **Border Light** (`#5c4e48`): `--border-light` — hover borders

### Shadows (dark needs depth, but kept hardware-precise)
- **Card** (`rgba(0,0,0,0.32) 0px 8px 16px`): `--shadow-card` — panels
- **Dialog** (`rgba(0,0,0,0.5) 0px 12px 32px`): `--shadow-dialog` — modals/menus
- **Orange** (`0 6px 20px rgba(255,106,19,0.3)`): `--shadow-orange` — **hero CTA hover only**
- **Inset Input** (`inset 0 0 0 1px var(--border-strong)`): `--inset-input`

## 3. Typography Rules

### Font Families (all bundled offline via `@fontsource` — no CDN, CSP-safe)
- **Display** (`--font-display`): `Chakra Petch`, fallback `Pretendard` → system. The chamfered, geometric face used for the product wordmark and large numerics. **Substitute** for the custom LITBIG wordmark. **Latin-only — Korean glyphs fall back to Pretendard automatically** (intended).
- **UI / Body** (`--font-ui`): `Pretendard`, fallback `Apple SD Gothic Neo`, `Malgun Gothic`, system. Single Korean+Latin family for all interface text.
- **Mono** (`--font-mono`): `JetBrains Mono`, fallback `Cascadia Code`, `Consolas`, system. For part numbers, specs, **hex frames, and stacked/aligned numerics** — the core data font of a CAN tool.

### Weight ladder & tracking
- 400 body · 500 emphasis · 600 H4/H3 + display headings · 700 H1/H2 + wordmark
- `--tracking-tight` (`-0.02em`): display headings (Latin)
- `--tracking-caps` (`0.12em`): UPPERCASE eyebrow / section / table-head labels (Latin)

### Hierarchy

| Role | Font | Size | Weight | Tracking | Notes |
|------|------|------|--------|----------|-------|
| Product wordmark | Display | 1.18rem | 700 | tight | `CANalyst-II` (Latin → Chakra Petch) |
| Panel header (h2) | Display | 1.05rem | 600 | tight | Korean falls back to Pretendard |
| Section/eyebrow label | Display | 0.7rem | 600 | caps | UPPERCASE, `--text-secondary` |
| Table head | Display | 0.68rem | 600 | caps | UPPERCASE, `--text-muted` |
| Body / cells | UI | 0.82–0.85rem | 400–600 | normal | `--text-near` |
| Label | UI | 0.74rem | 600 | normal | `--text-secondary` |
| Hero stat number | Mono | 1.5rem | 600 | normal | tabular-nums; one accent value = orange |
| Frame data / IDs | Mono | 0.84rem | 400 | normal | tabular hex |
| Direction badge | Display | 0.66rem | 600 | 0.6px | pill chip |

### Principles
- **Korean-first, never uppercase Korean.** The brand's uppercase + wide-tracking button voice is for **Latin labels only**. Buttons here carry Korean labels (`연결`, `송신`) in Pretendard, normal case, weight 600 — applying caps/tracking to Korean is wrong. Reserve UPPERCASE + `--tracking-caps` for Latin eyebrows, section titles, and table heads.
- **Mono for data, sans for prose.** Hex, IDs, counts, and rates use JetBrains Mono with `tabular-nums` so columns align. User text (preset names, Korean copy) stays Pretendard — never mono.
- **Display for brand moments only.** Chakra Petch on the wordmark, big stat numbers, and caps labels — not on body or buttons.

## 4. Component Stylings

### Buttons (sharp 2px — `--r-xs`)
**Secondary (default)** — ink surface with a border for elevation
- Background `--bg-input`, text `--text-near`, `1px solid --border-strong`, radius 2px, padding 8px 16px, weight 600
- Hover: bg `--bg-hover`, border `--border-light`, text `--text-base`. Active: `translateY(1px)`

**Primary CTA** (`.btn-primary`) — connect / send / confirm
- Background `--accent`, text `#fff`, border `--accent`, radius 2px
- Hover (brand motion): bg `--accent-bright` (darken), `translateY(-1px)`, `--shadow-orange`
- Press: bg `--accent-press`, `translateY(0)`, no shadow

**Destructive** (`.btn-danger`) — disconnect / stop logging / delete
- Transparent, text + `1px` border `--negative`; hover fills `--negative` with `#fff` text

### Cards & Panels (4px — `--r-md`)
- Background `--bg-surface`, `1px solid --border`, radius 4px, `--shadow-card`
- Elevation comes from the border + tonal shift, not large shadows

### Inputs (sharp 2px)
- Background `--bg-input`, no border, `--inset-input` (1px inset), radius 2px
- Hover: inset border → `--border-light`
- **Focus (brand):** orange inset border + `0 0 0 3px rgba(255,106,19,0.18)` glow
- Invalid: inset `--negative`. Checkbox `accent-color: --accent`

### Monitor table (the content)
- Surface `--bg-surface`; sticky head in display caps, `--text-muted`
- Rows separated by `1px --border`; cells `--text-near`, hex in mono
- **DBC decoded name** = `--litbig-orange-300` (quiet tint, not full orange)
- **Direction badge:** `.dir-rx` neutral ink chip (`--text-secondary`); `.dir-tx` orange-soft text on `--accent-tint` with a `1px` orange inset
- **TX row** ("your transmissions"): `--accent-tint` background + `inset 3px 0 0 --accent` left accent — meaningful because your own sends are rare (small orange area)
- Toolbar toggles `[aria-pressed=true]`: neutral "pressed" (`--bg-hover` + `--border-light`), **not** orange

### Status chips (pill — the one place pills are allowed)
- `--r-pill`; mock/demo badge in warning amber; connection dot colors: live=orange, error=danger, dropped=warning, connecting=muted

## 5. Layout Principles

### Spacing (8px base) — `--sp-1..6`
`4 · 8 · 12 · 16 · 20 · 24`

### Grid & Container
- **Sidebar** (`--sidebar-w` 268px, the "library": brand + status + connect + tools) **| Main** (monitor as the hero, full height) **+ right Rail** (`--rail-w` 340px: stats + TX + DBC, independent scroll)
- No vertical stacking of the monitor — it owns full height so growing logs never shrink it

### Border-radius scale (sharp by default)
- `--r-xs` 2px — controls (buttons, inputs)
- `--r-sm` 4px — small cards, table-wrap
- `--r-md` 4px — panels/cards
- `--r-lg` 8px — large card / modal
- `--r-pill` 999px — **status chips only**
- **Chamfer** (`--chamfer-sm`/`--chamfer-md`): the 45°-cut signature, for brand moments — used sparingly (never "everywhere", or it stops reading as deliberate)

### Whitespace
- Dense within a panel (engineering tool, not a marketing page); breathing room comes from the warm-ink surface contrast between panels, not large gaps.

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Base (Level 0) | `#1a1210` | Page background |
| Sidebar | `#140d0b` | Deepest rail |
| Surface (Level 1) | `#231815` (= ink) + `1px --border` | Cards, panels |
| Interactive | `#2e2522` | Inputs, buttons, raised cards |
| Hover | `#3d332f` | Rows, cards |
| Card shadow | `rgba(0,0,0,0.32) 0 8px 16px` | Panels |
| Dialog | `rgba(0,0,0,0.5) 0 12px 32px` | Modals/menus |

**Shadow philosophy:** restrained and hardware-precise. Elevation reads primarily through **1px warm borders and tonal steps** in the ink ladder; shadows add a subtle lift on panels. The only orange shadow (`--shadow-orange`) is reserved for the hero CTA on hover.

## 7. Do's and Don'ts

### Do
- Build surfaces from the **warm-ink ladder** (`#140d0b`–`#3d332f`) — depth through warm shade variation
- Spend orange on **the one thing that matters** per surface: primary CTA, live status, your own TX, the hero rate number
- Keep **sharp corners** (2px controls, 4px cards); pills only for status chips; chamfer only for rare brand moments
- Use **JetBrains Mono + tabular-nums** for all hex/IDs/counts so columns align
- Keep Korean labels in **Pretendard, normal case**; reserve display caps/tracking for Latin labels
- Show elevation through **borders + tonal shifts**, with restrained shadows

### Don't
- **Don't mechanically turn every old green into orange.** If a page is more than ~10% orange, pull it back to ink/neutral (decoded names, active toggles, secondary values stay quiet)
- Don't use cool/blue grays — they clash with the warm ink + orange
- Don't pill or heavily round buttons — square-ish (2px) is the identity; the chamfer is the only flourish
- Don't apply UPPERCASE / wide tracking to Korean text — it only suits Latin
- Don't use mono for prose or user-entered names; don't use Chakra Petch for body
- Don't reach for CDN fonts — everything is bundled offline (Electron/CSP)

## 8. Responsive Behavior

### Breakpoints (from `index.css`)
| Width | Key changes |
|-------|-------------|
| > 1120px | Full layout: sidebar · monitor · right rail |
| ≤ 1120px | Right rail drops **below** the monitor and flows as wrapping cards (`flex 1 1 280px`); console scrolls |
| ≤ 860px | Sidebar moves to the **top**, app height becomes auto; rail stacks vertically |

### Principles
- The monitor always remains the hero and keeps its own scroll region.
- Honors `prefers-reduced-motion`: transitions disabled; the error-panel "new error" cue degrades to a background flash only.

## 9. Agent Prompt Guide

### Quick Color Reference
- Background: `#1a1210` (base) · `#140d0b` (sidebar) · `#231815` (surface = ink)
- Text: `#f5f1ee` (base) · `#b4a8a1` (secondary) · `#897c74` (muted)
- Accent: Orange `#ff6a13` (hover `#e85a04`, press `#c44a00`, soft `#ffa66b`)
- Border: `#382c28` (strong `#4a3d38`)
- Danger `#f2685f` · Warning `#e8a33d` · Info `#5b95e0` · Success `#34c77b`

### Example Component Prompts
- "Card: `#231815` background, `1px solid #382c28`, 4px radius, `rgba(0,0,0,0.32) 0 8px 16px`. Header in Chakra Petch 1.05rem weight 600 (Korean → Pretendard)."
- "Primary button: orange `#ff6a13`, white text, 2px radius, 8px 16px, Pretendard weight 600. Hover → `#e85a04`, `translateY(-1px)`, orange glow shadow. (No uppercase — Korean label.)"
- "Input: `#2e2522`, `inset 0 0 0 1px #4a3d38`, 2px radius. Focus → orange inset + `0 0 0 3px rgba(255,106,19,.18)`."
- "Monitor row: cells `#e8e0db` in JetBrains Mono tabular-nums. TX row → `rgba(255,106,19,.14)` bg + `inset 3px 0 0 #ff6a13` left accent."
- "Hero stat: JetBrains Mono 1.5rem weight 600, orange `#ff6a13`. Other stats stay `#f5f1ee`."

### Iteration Guide
1. Start from the warm-ink ladder — everything lives in warm near-black, not cool charcoal.
2. Spend orange once per surface (CTA / live / TX / hero number); push everything else to ink/neutral.
3. Sharp corners (2px / 4px); pills only for status chips; chamfer only for a deliberate brand moment.
4. JetBrains Mono + tabular-nums for data; Pretendard for Korean; Chakra Petch for the wordmark and big numbers.
5. Elevate with borders + tonal steps; keep shadows restrained (orange shadow = hero CTA only).
6. The live CAN traffic is the only thing that should glow — keep the chrome quiet.
