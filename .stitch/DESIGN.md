---
name: "ShareGood 好物共享"
colors:
  paper: '#F9F6F2'
  paper-2: '#F2EEE7'
  card: '#FFFFFF'
  ink: '#1F1A13'
  ink-soft: '#655C52'
  ink-disabled: '#75716B'
  line: '#DCD6CF'
  brand: '#C14900'
  brand-ink: '#8E1C00'
  brand-soft: '#F9E3D7'
  navy: '#1D2A37'
  destructive: '#E7000B'
  border: '#E5E5E5'
  muted-foreground: '#737373'
typography:
  wordmark:
    fontFamily: Manrope (font-display)
    fontSize: 20px
    fontWeight: '800'
    lineHeight: normal
    letterSpacing: -0.01em
  hero-display:
    fontFamily: Geist Sans (font-sans)
    fontSize: 36px – 48px
    fontWeight: '800'
    lineHeight: 1.15
    letterSpacing: -0.02em
  section-headline:
    fontFamily: Geist Sans (font-sans)
    fontSize: 24px – 30px
    fontWeight: '700'
    lineHeight: normal
    letterSpacing: -0.01em
  card-title:
    fontFamily: Geist Sans (font-sans)
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 1.375
    letterSpacing: '0'
  body-base:
    fontFamily: Geist Sans (font-sans)
    fontSize: 16px – 18px
    fontWeight: '400'
    lineHeight: normal
    letterSpacing: '0'
  meta-caption:
    fontFamily: Geist Sans (font-sans)
    fontSize: 11px – 12px
    fontWeight: '400'
    lineHeight: normal
    letterSpacing: '0'
  button-label:
    fontFamily: Geist Sans (font-sans)
    fontSize: 14px – 16px
    fontWeight: '500'
    lineHeight: normal
    letterSpacing: '0'
rounded:
  sm: 0.375rem
  md: 0.5rem
  lg: 0.625rem
  xl: 0.875rem
  2xl: 1.125rem
  3xl: 1.375rem
  4xl: 1.625rem
  full: 9999px
spacing:
  unit: 4px
  card-padding: 16px
  card-padding-sm: 12px
  gutter-mobile: 16px
  gutter-tablet: 24px
  section-y: 48px – 64px
  container-max: 1152px
  touch-target: 44px
---

## 1. Visual Theme & Atmosphere

ShareGood is a warm, unpretentious neighborhood-sharing platform for giving
away things you no longer need — explicitly **not** a marketplace. The visual
language is built around a near-white warm paper background, near-black warm
ink text, and exactly **one** saturated color (an amber-orange, internally
called "琥珀橘" / amber orange) reserved strictly for calls to action, the
"free" tag, and active states. Everything else — cards, dividers, secondary
surfaces — stays in a tight, low-chroma warm-neutral range. The developer's
own code comments are unusually explicit about the *why*: the palette
deliberately avoids purple ("AI 泛用色" — the generic AI-startup color) and
avoids beige/tan luxury-goods palettes, because the product's emotional goal
is 安心 ("a sense of security/trust") between neighbors, not a premium-retail
or big-tech feel. The product brief (`PRODUCT.md`) names three brand words —
溫暖 (warm), 可靠 (reliable), 不做作 (unpretentious) — and explicitly rules out
three anti-references: promo-color-block e-commerce platforms (Shopee/Ruten
style discount banners and price-comparison psychology), a flamboyant
nostalgic/decorative direction (Kowloon Walled City signage, calligraphy
fonts — a proposal the stakeholder already rejected as "too fussy"), and a
cold, gray-scale enterprise-SaaS feel.

Whitespace is generous but not luxurious: section padding runs 48–64px,
card grids use 16–20px gaps, and the single content container caps at
1152px (`max-w-6xl`) — comfortable for scanning during idle moments
(commuting, before bed) rather than a dense marketplace grid. Density is
low-to-medium: a 2-column mobile / 4-column desktop product grid is the
densest pattern on the built homepage; everything else (hero, three-step
explainer, trust list, CTA band) is single- or triple-column with lots of
room to breathe. Color temperature is unambiguously warm — every neutral in
the custom `@theme` block (paper, paper-2, ink, ink-soft, line) carries a
small positive hue bias (h≈70–80, warm/orange-leaning), never a cool
blue-gray, reinforcing the "kind neighbor" feeling rather than a clinical
utility-app feeling. The one deliberate exception is `navy`, a dark
blue-gray neutral reserved for a single CTA band at the bottom of the
homepage — used precisely because it reads as confident/anchoring without
competing with the brand orange.

## 2. Color Palette & Roles

The custom palette lives in `src/app/globals.css`, in a `@theme` block
placed *below* the shadcn default token block, with a header comment
crediting `ui-ux-pro-max` generation "經人工校正" (manually corrected). This
is a documented, deliberate two-layer system: shadcn's generic OKLCH
grayscale tokens still exist and power a handful of primitives (destructive
state, popover/dropdown surfaces, focus rings), but the actual product
chrome — page background, text, cards, brand color — runs on ShareGood's own
named tokens, not the shadcn defaults.

### Primary Foundation

- **Paper** (`--color-paper`, `oklch(0.975 0.006 80)` ≈ `#F9F6F2`) — the page
  background (`body { bg-paper }` in `layout.tsx`). An almost-white, barely
  perceptibly warm cream — airy, not sterile white.
- **Paper 2** (`--color-paper-2`, `oklch(0.95 0.01 75)` ≈ `#F2EEE7`) —
  secondary background for the "how it works" and "trust" section stripes,
  the footer, and small pill/badge fills (category badge background,
  disabled bottom-tab fill). Slightly more saturated/darker than Paper, used
  to create quiet section breaks without a hard border.
- **Card** (`--color-card`, resolves through the inline `@theme` alias to
  shadcn's `--card`, `oklch(1 0 0)` = pure `#FFFFFF`) — elevated surfaces:
  the hero search bar, product cards, dialogs (via `--popover`), the bottom
  tab bar. The codebase has an explicit comment explaining this is **not**
  redeclared in the custom `@theme` block even though the value happens to
  equal pure white today: redeclaring it would sever the indirect reference
  to `--card`, and since `next-themes` is already a dependency, doing so
  would "lock" cards to white once dark mode is implemented. Treat this as
  an intentional forward-compatibility decision, not an oversight.

### Accent & Interactive

- **Brand — "琥珀橘" Amber Orange** (`--color-brand`, `oklch(0.56 0.17 45)`
  ≈ `#C14900`) — the single saturated color on the entire site. Used only
  for: primary CTA buttons (`variant="brand"`), the "免費" (free) price tag
  on product images, active bottom-nav icon/label, and small icon accents
  in the trust-list section. The L value was **manually contrast-corrected**
  and the code comment records the exact result: white text on this orange
  measures **4.99:1**, just over the WCAG AA text minimum of 4.5:1 — this is
  a documented design decision, not an incidental value.
- **Brand Ink** (`--color-brand-ink`, `oklch(0.42 0.16 42)` ≈ `#8E1C00`) —
  the hover/pressed state for brand buttons and the text color used for
  numerals inside the light "brand-soft" step badges. Comment records white
  text against this darker orange reaches 7:1+ contrast.
- **Brand Soft** (`--color-brand-soft`, `oklch(0.93 0.03 50)` ≈ `#F9E3D7`) —
  a very light peach fill used behind dark text, e.g. the circular
  step-number badges (1/2/3) in the "how it works" section.
- **Shadow Brand Glow** (`--shadow-brand-glow`) — a custom colored
  box-shadow token (`0 8px 18px -6px oklch(0.56 0.17 45 / 0.55)`) defined
  specifically to give the bottom-tab bar's central share button a warm
  glow once it ships; not yet wired into a live component in the reviewed
  code.
- **Navy** (`--color-navy`, `oklch(0.28 0.03 250)` ≈ `#1D2A37`) — the one
  cool-toned neutral in the system, used as a full-bleed dark background for
  the homepage's closing "把用不到的好物，分享出去" CTA band. A deliberate
  contrast to the warm neutrals — signals a confident close without
  reaching for the brand color a second time on the same page.

### Typography & Text Hierarchy

- **Ink** (`--color-ink`, `oklch(0.22 0.015 75)` ≈ `#1F1A13`) — primary
  text color everywhere (headings, product titles, body copy default).
  Near-black with a faint warm cast rather than a true `#000`.
- **Ink Soft** (`--color-ink-soft`, `oklch(0.48 0.02 70)` ≈ `#655C52`) —
  secondary text: hero subhead, product card meta (district/time), section
  eyebrow labels, footer copy, nav labels.
- **Ink Disabled** (`--color-ink-disabled`, `oklch(0.55 0.01 70)` ≈
  `#75716B`) — reserved specifically for "not yet available" feature labels
  (disabled bottom-tab items). The L value was hand-tuned and the comment
  states the exact reasoning: it measures **4.86:1** against the white card
  background, meeting WCAG AA — and the comment explicitly rejects the
  more "obvious" implementation (taking `ink-soft` and applying 50% opacity),
  because that approach only reaches 2.22:1 and would be illegible. This is
  the clearest evidence in the codebase that contrast was checked
  value-by-value rather than assumed.

### Functional States

- **Destructive** (shadcn default, `oklch(0.577 0.245 27.325)` ≈ `#E7000B`)
  — form validation errors (e.g., the onboarding form's inline error text),
  the `destructive` button/badge variants. Untouched shadcn default; no
  ShareGood-specific override exists yet.
- **Line** (`--color-line`, `oklch(0.88 0.012 75)` ≈ `#DCD6CF`) — the only
  border/divider color used across cards, the header's bottom hairline,
  the bottom-tab top border, and the horizontal trust-list dividers. Warm
  and light — a hairline, not a structural line.
- Shadcn's grayscale `border` / `muted-foreground` tokens (`#E5E5E5` /
  `#737373`) still exist underneath and surface in a few unstyled shadcn
  primitives (e.g. the raw `<select>` in the onboarding form uses
  `border-input` directly rather than `border-line`) — a minor
  inconsistency worth flagging: not every input element has been migrated
  onto the ShareGood token set yet.

## 3. Typography Rules

### Hierarchy & Weights

Two font families are loaded via `next/font/google` in `src/app/layout.tsx`,
each with a distinct CJK fallback stack (`PingFang TC`, `Noto Sans TC`,
`Microsoft JhengHei`) so Traditional Chinese renders consistently:

- **Geist Sans** (`--font-geist-sans`) → mapped to `--font-sans`, the
  default body font for the entire app (`html { font-sans }` in
  `globals.css`). Used for every heading, body paragraph, button label, and
  form field observed in the built pages. Geometric, neutral, legible —
  functions as the app's true workhorse typeface.
- **Manrope** (`--font-manrope`, weights `600/700/800` only — no regular
  weight is loaded) → mapped to `--font-display`, but this variable is used
  in exactly one place in the reviewed code: the "好物共享" wordmark in
  `site-header.tsx` (`font-display text-xl font-extrabold tracking-tight`).
  This is a deliberate, narrow scope — Manrope is the brand's logotype
  font, not a general display-heading font.
- Notably, shadcn's own `font-heading` utility (used by `CardTitle` and
  `DialogTitle`) is aliased to `var(--font-sans)`, i.e. Geist, **not**
  Manrope — so card/dialog titles render in the same body typeface as
  everything else. There is effectively one working typeface (Geist Sans)
  plus one narrowly-scoped wordmark accent (Manrope).

Observed scale, largest to smallest:

| Usage | Size | Weight | Line-height | Tracking |
|---|---|---|---|---|
| Hero H1 | `text-4xl` → `md:text-5xl` (36–48px) | `font-extrabold` (800) | `leading-[1.15]` | `tracking-tight` |
| Section H2 | `text-2xl` → `md:text-3xl` (24–30px) | `font-bold` (700) | default | `tracking-tight` |
| Wordmark | `text-xl` (20px) | `font-extrabold` (800), Manrope | default | `tracking-tight` |
| Card/Dialog title | `text-base` (16px) | `font-medium` (500) | `leading-none`/`leading-snug` | default |
| Product card title (h3) | inherited ~16px | `font-semibold` (600) | `leading-snug` | default |
| Body / hero subhead | `text-base` → `md:text-lg` (16–18px) | `font-normal` (400) | default | default |
| Button label | `text-sm`/`text-base` (14–16px) | `font-medium` (500) | default | default |
| Meta / caption | `text-xs`/`text-[11px]` (11–12px) | `font-normal` | default | default |

### Spacing Principles

Headings consistently use `tracking-tight` (negative letter-spacing) at
both the hero and section-headline levels — a deliberate "confident, not
loud" heading treatment, contrasted against generous `leading-[1.15]` line
height on the hero so the tight tracking never feels cramped. Body and
meta text uses default (`0`) tracking throughout — no uppercase/wide-tracked
labels anywhere in the observed code, reinforcing the "unpretentious, not
marketing-voice" brand personality from `PRODUCT.md`.

## 4. Component Stylings

### Buttons

`src/components/ui/button.tsx` defines a `cva`-driven variant system with
**7 color variants** (`default`, `outline`, `secondary`, `ghost`,
`destructive`, `link`, `brand`) and **10 sizes** (`default`, `xs`, `sm`,
`lg`, `xl`, `icon`, `icon-xs`, `icon-sm`, `icon-lg`, `icon-xl`).

- Corner radius: `rounded-lg` (0.625rem/10px) on the base class — a soft
  but not pill-like corner, consistent across every variant/size.
- `variant="brand"` (`bg-brand text-white hover:bg-brand-ink`) is the only
  saturated-color variant and, per the codebase's own comment, is reserved
  for "ShareGood 品牌唯一飽和色（琥珀橘）主要操作按鈕：登入、上架、CTA 等" —
  i.e. it is *the* primary-action button, used for every real CTA observed
  (登入/加入 ShareGood, 完成設定, 我要分享, the disabled 搜尋 button).
  `variant="outline"` is the only secondary variant actually used (登出).
  `secondary`, `ghost`, `destructive`, and `link` exist as shadcn defaults
  but have no confirmed usage in the built pages yet.
- Size `xl` (`h-11` = 44px) and `icon-xl` (`size-11` = 44px) exist
  specifically to satisfy the **WCAG 2.5.5 minimum touch-target size
  (44×44px)**, per an explicit code comment: "44px 觸控標準（WCAG 2.5.5）：
  手機主要操作按鈕（CTA、表單提交）用這個尺寸，其餘尺寸維持不動避免動到既有排版."
  Every real primary/secondary CTA on the homepage and site header uses
  `size="xl"` — this is the de facto standard button size for anything a
  user is meant to tap, while the smaller sizes (`default` 32px, `sm` 28px,
  `xs` 24px) are reserved for dense, non-primary UI (icon buttons, dialog
  close button at `icon-sm`).
- States: `hover:bg-brand-ink` darkens on hover; `active:translate-y-px`
  gives a 1px press-down "settle" affordance on click; disabled state is
  `opacity-50` + `pointer-events-none`. Focus is a 3px ring
  (`ring-3 ring-ring/50`) with a matching border color change — visible,
  not just a color swap, important given the all-ages user base named in
  `PRODUCT.md`.

### Cards & Product Cards

`src/components/ui/card.tsx` defines a generic shadcn `Card` (rounded-xl /
14px corners, `ring-1 ring-foreground/10` hairline instead of a
`border`, internal padding driven by a `--card-spacing` CSS var: 16px
default, 12px at `size="sm"`) — this primitive is imported but not yet used
directly on the built homepage.

The homepage's actual **product card** (in `page.tsx`) is a hand-rolled
pattern, not the shadcn `Card`: `rounded-xl border border-line bg-card`,
with a 4:3 image (`aspect-[4/3]`) that fills edge-to-edge at the top of the
card (no internal padding around the image — full-bleed image, padded text
below), a `hover:shadow-md` elevation-on-hover with a subtle `scale-[1.04]`
image zoom (respecting `motion-reduce`), and an absolutely-positioned
`免費` (free) badge pinned to the image's top-left corner in solid brand
orange. Text content below the image uses `p-3` (12px) padding — noticeably
tighter than the card grid's 16–20px gaps, keeping the card itself compact
in the 2-up mobile grid.

The hero image and CTA-search-bar containers use a larger `rounded-2xl`
(1.125rem/18px) — one step up from the product-card radius — reserved for
"hero-weight" containers, establishing a small but consistent radius
hierarchy: buttons/inputs 10px → cards/product tiles 14px → hero-weight
containers 18px → pills/tags fully round.

### Navigation

Two distinct nav patterns, split by viewport:

- **Site header** (`site-header.tsx`): sticky top bar (`sticky top-0`),
  translucent (`bg-paper/90 backdrop-blur`), hairline bottom border
  (`border-line/70`). Wordmark in Manrope, all actions rendered as
  `size="xl"` buttons — no plain text links for primary actions.
- **Bottom tab bar** (`bottom-tab.tsx`, mobile-only via `md:hidden`):
  fixed to the viewport bottom, 5-column grid, respects
  `env(safe-area-inset-bottom)` for notched devices. The active/enabled
  item ("逛好物") is rendered in solid brand orange with `font-semibold`;
  all other items are disabled `<button disabled>` elements in
  `ink-disabled`, explicitly *not* a styled span+`title` pattern — the code
  comment explains this choice is for assistive-tech correctness (native
  `disabled` semantics are announced by screen readers; `title` tooltips
  are unreliable on touch devices and some screen readers skip them). The
  center "分享" (share) tab is a raised circular FAB-style button
  (`-mt-6`, floating above the bar) — currently rendered in a neutral
  disabled state rather than the brand-glow treatment, with a comment
  explaining that using the styled `Button` component here would compound
  its `disabled:opacity-50` on top of the already contrast-corrected
  `ink-disabled` color and fall below AA — so this one control is
  hand-styled outside the shared `Button` primitive on purpose.

### Inputs & Forms

`input.tsx` / `textarea.tsx` / `label.tsx` are close-to-stock shadcn:
`rounded-lg` (10px, matching button radius), `border-input`, a 3px focus
ring matching the button's focus treatment, `h-8` (32px) default height for
`Input`. The onboarding form (`onboarding-form.tsx`) is the only real form
in the codebase: stacked `Label` + `Input` pairs with `space-y-2` internal
gaps and `space-y-6` between fields, full-width submit button
(`className="w-full"`), and a single-color error paragraph
(`text-destructive text-sm`). Note the form's native `<select>` for city
uses raw `border-input rounded-md` Tailwind classes rather than the
project's shadcn `Select` component or the `line`/`ink` token names —
flagged above as a token-migration gap, not an intentional style choice.

### Domain-Specific Components

- **"免費" (Free) price tag** — a small solid-brand-orange pill/rounded-md
  label absolutely pinned over the top-left of every product photo. This is
  the single most important UI element for the product's core promise
  (per `PRODUCT.md`: "免費感優先於促銷感" — the word "free" itself is the
  only pricing language, with no promotional visual treatment like
  full-bleed banners, exclamation marks, or countdowns).
- **Category filter chips** — pill-shaped (`rounded-full`), outlined
  (`border-line`), white/card background, `ink-soft` text — deliberately
  quiet and non-competing with the brand color.
- **Numbered step badges** ("怎麼運作" three-step section) — 44px circular
  badges (`h-11 w-11 rounded-full`) filled with `brand-soft` and
  `brand-ink` numerals — the one place `brand-soft`/`brand-ink` pair
  together outside of button hover states.
- **Trust-list** (信任與安全 section) — a horizontally-divided list
  (`divide-x`/`divide-y` depending on breakpoint) rather than a card grid;
  the code comment notes this is deliberate — "避免版面重複" (avoid
  repeating the same card-grid layout pattern used two sections earlier).

## 5. Layout Principles

### Grid & Structure

- Max content width: `max-w-6xl` (1152px), applied consistently to every
  section wrapper on the homepage (hero, product grid, three-step section,
  trust list, CTA band, footer).
- No custom Tailwind breakpoints are configured (Tailwind v4, CSS-first —
  no `tailwind.config.*` file exists in the repo); the project relies on
  Tailwind's default `screens` (`sm` 640px, `md` 768px, `lg` 1024px, `xl`
  1280px, `2xl` 1536px). `md` (768px) is the dominant breakpoint in
  practice — it's where the hero splits from stacked to a 12-column grid
  (`md:grid-cols-12`, content taking 7 of 12 columns, image taking 5), where
  the product grid goes from 2 to 4 columns, and where the bottom tab bar
  disappears (`md:hidden`) in favor of the sticky header's own actions.
- Hero layout is an explicit 12-column CSS grid split (`md:grid-cols-12`),
  not a generic flex row — content-left (7 cols) / image-right (5 cols).

### Whitespace Strategy

- Base spacing unit: Tailwind's default 4px scale (no custom `spacing`
  override in the theme).
- Section vertical rhythm: `py-12` (48px) to `py-14`/`py-16` (56–64px)
  between major homepage sections.
- Edge padding: `px-4` (16px) on mobile, stepping up to `px-6` (24px) at
  `sm:` — a modest, not dramatic, increase.
- Card-internal spacing (shadcn `Card` primitive): a dedicated
  `--card-spacing` CSS variable, 16px default / 12px at the `sm` card size
  — notably smaller than section-level spacing, keeping cards feeling
  compact relative to the airy page shell around them.
- Grid gaps: `gap-4` (16px) mobile stepping to `gap-5` (20px) desktop for
  the product grid; `gap-8`/`gap-9` (32–36px) for the more spacious
  three-step explainer grid.

### Alignment & Visual Balance

- Hero text is left-aligned with a constrained measure (`max-w-[14ch]` on
  the H1, `max-w-[38ch]` on the subhead) — deliberately short line lengths
  for scannability, not a centered marketing-hero treatment.
- Section headlines are also left-aligned with a `max-w-[16ch]` constraint
  where paired with body copy — consistent with the "not a marketing site"
  brand stance from `PRODUCT.md`.
- The CTA band (navy background) uses a flex row that goes from stacked
  (mobile) to space-between (desktop) — text block left, single button
  right — a low-visual-noise close to the page rather than a bold banner.

### Responsive Behavior & Touch

- Mobile-first in practice: the bottom tab bar is the primary navigation
  surface on mobile (`md:hidden`) and is treated in `PRODUCT.md` as the
  product's structural "skeleton" ("底部導覽是核心操作入口... 桌面版是手機版
  的延伸而非另一套設計" — desktop is explicitly described as an *extension*
  of the mobile design, not a separate design). The homepage's `<main>`
  carries `pb-24 md:pb-0` specifically to reserve clearance above the fixed
  bottom bar on mobile.
- Touch targets: every actionable control that a user is meant to tap
  (CTA buttons, header actions, bottom-tab items) targets the 44×44px WCAG
  2.5.5 minimum via the `xl`/`icon-xl` button sizes or hand-sized
  equivalents (the 44px circular disabled-share FAB). Smaller button sizes
  are reserved for secondary, desktop-oriented, or icon-only controls (e.g.
  the dialog close button).
- `prefers-reduced-motion` is explicitly respected on the one meaningful
  motion effect observed (product card image hover-zoom uses
  `motion-reduce:transition-none motion-reduce:group-hover:scale-100`).

## 6. Design System Notes for Stitch Generation

### Language to Use

Describe this system as: **warm, unpretentious, neighborly** — never
"vibrant," "bold," or "energetic" (those read as promotional/e-commerce,
which this product explicitly rejects). Prefer words like *calm*, *airy*,
*trustworthy*, *quietly confident*, *restrained*. The single accent color
should be described as used "sparingly, only at decision points" — not as a
theme color that saturates the page. Avoid describing any surface as
"vibrant orange everywhere" — that would misrepresent the actual usage
pattern (one saturated color, used narrowly).

### Color References

- **Paper** `#F9F6F2` — page background, warm off-white
- **Paper 2** `#F2EEE7` — section-stripe / footer background
- **Card (White)** `#FFFFFF` — elevated surfaces (product cards, search bar, dialogs)
- **Ink (Near-Black)** `#1F1A13` — primary text
- **Ink Soft (Warm Gray)** `#655C52` — secondary/meta text
- **Ink Disabled (Muted Warm Gray)** `#75716B` — disabled-feature labels only, contrast-verified at 4.86:1
- **Line (Warm Hairline Gray)** `#DCD6CF` — all borders/dividers
- **Brand — Amber Orange** `#C14900` — the one accent color; CTAs, "free" tag, active states; white-text contrast verified at 4.99:1
- **Brand Ink (Deep Amber)** `#8E1C00` — hover/pressed state for brand color
- **Brand Soft (Light Peach)** `#F9E3D7` — light fill behind brand-ink text (step badges)
- **Navy (Dark Blue-Gray)** `#1D2A37` — single closing CTA band background
- **Destructive (Red)** `#E7000B` — form/validation errors only

### Component Prompts

1. "A product card with a full-bleed 4:3 photo, a solid amber-orange
   rounded-corner '免費' (free) tag pinned to the photo's top-left corner,
   14px rounded corners on the card, a thin warm-gray hairline border, and
   compact 12px padding below the photo holding a bold title, a muted
   one-line description, and a small location + timestamp row with a pin
   icon — all in warm near-black and warm-gray text on a white card over a
   warm off-white page background."
2. "A primary call-to-action button, pill-ish with 10px rounded corners,
   44px tall, solid amber-orange fill with white bold text, darkening to a
   deep rust-orange on hover, with a 1px press-down settle animation and a
   visible 3px focus ring — used sparingly, once per screen, as the only
   saturated color in view."
3. "A mobile bottom tab bar with 5 items on a translucent white/blur
   background with a warm hairline top border: one active item in amber
   orange with a bold label, the rest muted warm-gray, and a raised
   circular button floating above the bar's center for the primary 'share'
   action."

### Incremental Iteration

- When refining any screen, check first whether a new saturated color has
  crept in — the whole point of this system is that amber-orange stays the
  *only* saturated color; any second bright color (especially purple, or a
  beige/tan "premium" palette) breaks the documented anti-references in
  `PRODUCT.md`.
- Preserve the radius hierarchy (10px buttons/inputs → 14px cards → 18px
  hero-weight containers → fully round pills) rather than introducing a new
  radius value per component.
- Preserve the 44px touch-target minimum on anything tappable; don't drop
  back to the smaller `default`/`sm` button sizes for primary actions just
  to fit a tighter layout.
- If asked to design dark mode: note that `--color-card` is intentionally
  left un-overridden in the ShareGood `@theme` block specifically so it
  keeps resolving through shadcn's `--card` variable — meaning dark mode
  should extend the *shadcn* `.dark` block's `--card`/`--background`
  tokens, not hardcode a new value in the ShareGood custom block, or it
  will fight the existing indirection.
