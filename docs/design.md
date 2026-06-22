# eNIX App — Design System

> Dokumen ini mendokumentasikan bagaimana UI dibangun: design tokens, komponen arsitektur, styling approach, layout system, animation system, dan theme system. Bukan alur aplikasi.

---

## 1. Tech Stack UI

| Library | Versi | Fungsi |
|---|---|---|
| Next.js | 16.2.3 | Framework, App Router, font loading |
| React | 19.2.4 | UI library |
| Tailwind CSS | ^4 | Utility-first CSS via `@import "tailwindcss"` + `@theme` |
| motion | ^12.38 | Animasi (Framer Motion rebrand) |
| react-icons | ^5.6 | Icon set: `fi` (Feather), `hi2` (Heroicons v2) |
| zustand | ^5.12 | Client state management |
| @tanstack/react-query | ^5.97 | Server state (staleTime: 30s) |
| @rainbow-me/rainbowkit | ^2.2 | Wallet connection UI |

Tidak ada component library (shadcn, Radix, MUI). Semua UI custom-built.

---

## 2. CSS Architecture

### 2.1 Framework: Tailwind v4

File: `src/app/globals.css`

- Entry point: `@import "tailwindcss"` (tanpa `tailwind.config.js`)
- Design tokens via CSS custom properties (bukan Tailwind `theme.extend`)
- Custom utilities via `@utility` directive sebagai semantic layer
- Tidak menggunakan `@layer` atau `@apply`

### 2.2 Design Tokens (Color System)

Semua warna didefinisikan sebagai `--color-*` pada dua scope:

```css
:root, [data-theme="dark"] { /* dark mode default */ }
[data-theme="light"] { /* override per role */ }
```

**Token Palette:**

| Token | Dark | Light | Usage |
|---|---|---|---|
| `--color-brand` | `#1e40af` | `#1e40af` | CTA, links, accent |
| `--color-brand-hover` | `#1e3a8a` | `#1e3a8a` | Hover state brand |
| `--color-brand-soft` | `rgba(30,64,175,0.18)` | `rgba(30,64,175,0.10)` | Badge, tag bg |
| `--color-canvas` | `#0d0e0f` | `#f5f6f8` | Page background |
| `--color-surface-1` | `#131316` | `#ffffff` | Card/surface base |
| `--color-surface-2` | `#1b1b1f` | `#f1f2f5` | Raised surface |
| `--color-surface-3` | `#222228` | `#e6e7eb` | Muted surface |
| `--color-line` | `#2c2c31` | `#e1e2e6` | Borders, dividers |
| `--color-line-strong` | `#3a3a41` | `#c8cad0` | Active borders |
| `--color-text-main` | `#ffffff` | `#0d0e0f` | Primary text |
| `--color-text-muted` | `#9b9ba5` | `#555861` | Secondary text |
| `--color-text-faint` | `#6b6b75` | `#8a8d96` | Tertiary/label text |
| `--color-positive` | `#40b66b` | `#2f9c54` | Success, green |
| `--color-negative` | `#fa2b39` | `#d92a36` | Error, red |
| `--color-glass-bg` | `rgba(255,255,255,0.1)` | `rgba(255,255,255,0.65)` | Glassmorphism bg |
| `--color-glass-border` | `rgba(255,255,255,0.15)` | `rgba(0,0,0,0.08)` | Glassmorphism border |
| `--color-glass-overlay` | `rgba(13,14,15,0.75)` | `rgba(245,246,248,0.85)` | Overlay/dim |
| `--color-selection-bg` | `rgba(30,64,175,0.45)` | `rgba(30,64,175,0.20)` | Text selection bg |
| `--color-selection-fg` | `#ffffff` | `#0d0e0f` | Text selection color |

### 2.3 Custom Utility Layer (`@utility`)

Semantic mapping agar Tailwind class bisa langsung pakai CSS variable:

```css
/* Surface */
bg-main       → background: var(--color-canvas)
bg-surface    → background: var(--color-surface-1)
bg-surface-raised → background: var(--color-surface-2)
bg-surface-muted  → background: var(--color-surface-3)
bg-overlay    → background: var(--color-glass-overlay)
bg-glass      → background: var(--color-glass-bg)
bg-brand      → background: var(--color-brand)
bg-brand-soft → background: var(--color-brand-soft)

/* Text */
text-main     → color: var(--color-text-main)
text-muted    → color: var(--color-text-muted)
text-faint    → color: var(--color-text-faint)
text-brand    → color: var(--color-brand)

/* Border */
border-main   → border-color: var(--color-line)
border-strong → border-color: var(--color-line-strong)
border-glass  → border-color: var(--color-glass-border)

/* Interaction */
hover-brand    → &:hover { background: var(--color-brand-hover) }
ring-brand     → --tw-ring-color: var(--color-brand)
```

### 2.4 Typography

- Font: Inter via `next/font/google`, diset sebagai CSS variable `--font-inter`
- Fallback: `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`
- Font feature: `"cv11", "ss01", "ss03"` (alternate stylistics)
- Smoothing: `-webkit-font-smoothing: antialiased`
- **Tidak ada type scale token** — nilai inline: `text-[10px]`, `text-[11px]`, `text-xs`, `text-sm`, `text-base`, `text-[28px]`

### 2.5 Element Reset

```css
html        → background: var(--color-canvas)
body        → bg transparent, color text-main, font-sans
button, a, select, [role="button"], [type="button"], [type="submit"], [type="reset"] → cursor: pointer
::selection → bg: selection-bg, color: selection-fg
```

---

## 3. Theme System (Dark/Light)

### 3.1 Storage & Bootstrap

Key: `enix-app-theme` di localStorage.

**Bootstrap (flash prevention):** Inline `<script>` di `<head>` `layout.tsx` yang jalan *sebelum* React hydrate:
```js
(function(){try{var t=localStorage.getItem('enix-app-theme');
if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t;}}catch(e){}})();
```

### 3.2 Theme Context

File: `src/lib/theme-context.tsx`

- `ThemeProvider` — React Context, default `"dark"`
- `useTheme()` → `{ theme, setTheme, toggleTheme }`
- Safe fallback: di luar provider return no-op functions
- `toggleTheme()` flip `dark` ↔ `light`, tulis ke `dataset.theme` + localStorage

### 3.3 RainbowKit Sync

`RainbowKitWithTheme` di `providers.tsx`:
- Baca `useTheme()` → render `darkTheme()` atau `lightTheme()` dengan `accentColor: "#1e40af"`, `borderRadius: "large"`, `overlayBlur: "small"`
- Theme RainbowKit sinkron dengan theme aplikasi

---

## 4. Component Architecture

### 4.1 Directory Structure

```
src/components/
  ui/                    → Reusable atomic UI
    index.ts             → Barrel exports
    navbar-1.tsx         → App navbar (glass pill)
    wallet-button.tsx    → RainbowKit wrapper multi-state
    theme-toggle.tsx     → Dark/light toggle button
    feature-sections.tsx → Landing page feature cards
    ai-chat/             → AI chat button + sheet + store

  layout/                → Layout-only components
    background-decor.tsx → Radial gradient glow

  pages/
    landing/             → Landing page sections
      landing-page.tsx, landing-navbar.tsx, hero-section.tsx,
      features-section.tsx, footer-section.tsx

    (app)/               → App pages
      earn/              → Earn page (supply-card, selector, vault-list, deposit-sheet, etc.)
      compare/           → Compare page
      portfolio/         → Portfolio page
```

### 4.2 Provider Tree

```
<ThemeProvider>
  <WagmiProvider>                       ← async dari /api/wallet-config
    <QueryClientProvider>               ← staleTime: 30s
      <RainbowKitProvider>              ← theme sync dengan app theme
        <WalletReadyContext.Provider>    ← boolean gate
```

### 4.3 Component Patterns

#### A. Card Surface (container utama)
```html
rounded-3xl border border-main bg-surface p-3
```
Sub-surface menggunakan `bg-surface-raised` untuk nested container.

#### B. Glassmorphism (navbar, theme toggle)
```html
rounded-full border border-glass bg-glass backdrop-blur-2xl backdrop-saturate-150
```
Ditambah `before:bg-[linear-gradient(140deg,...)]` untuk subtle highlight.

#### C. Sheet (bottom drawer)
Dua variant:
- **Center** (deposit): `items-end justify-center sm:items-center`, spring `y: 100% → 0`
- **Bottom-right** (AI chat): `sm:items-end sm:justify-end`, `max-w-[420px]`, `rounded-t-3xl sm:rounded-3xl`

Backdrop: `bg-black/70 backdrop-blur-md`.

#### D. Button System
Tidak ada komponen Button. Langsung inline class:

| Variant | Class |
|---|---|
| Primary navbar | `rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white hover-brand` |
| Full CTA | `rounded-2xl bg-brand px-5 py-4 text-base font-semibold text-white` |
| Outline/tag | `rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-bold text-muted` |
| Badge | `rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-bold text-brand` |
| MAX button | `rounded-md px-1.5 py-0.5 text-[10px] font-semibold bg-brand text-white/90` |

Semua button: `cursor-pointer transition-all duration-200 ease-in-out active:scale-[0.98]` + `disabled:cursor-not-allowed disabled:opacity-50`.

#### E. Selector (custom dropdown)

File: `src/components/pages/(app)/earn/selector/selector.tsx`

Props:
```ts
{ label, value, options: {key, label, hint?, iconUrl?}[],
  onSelect, variant: "pill"|"chip",
  emptyLabel?, loading?, locked? }
```

Features:
- Trigger dengan animated icon + label swap (`AnimatePresence mode="popLayout"`)
- Chevron rotation 0↔180°
- Search input otomatis saat `> 6` opsi
- Dropdown `max-h-72` scrollable dengan dividers
- Selected state: `FiCheck` di bullet
- Loading skeleton (pulse placeholder)
- Locked mode (read-only, no dropdown)

#### F. Step Indicator (multi-step flow)

File: `deposit-sheet-states.tsx`

Steps: Review → Approve → Bridge & Deposit/Deposit

Visual: numbered circles → checkmarks, connected by progress lines. States: `idle | quoting | ready | approving | depositing | success | error`.

#### G. State-driven UI Pattern

Setiap data list handle 4 states:
1. **Loading** — Skeleton dengan pulse animation, staggered `delay: index * 0.06`
2. **Empty** — `FiInbox` icon + heading + suggestion text
3. **Error** — `FiAlertTriangle` + red-tinted container (`border-[rgba(250,43,57,0.35)]` bg)
4. **Data** — Animated entrance: `initial={{ opacity: 0, y: 8 }} → animate`

Transisi antar state: `AnimatePresence mode="wait"`.

#### H. Connection Gate Pattern

Komponen wallet-dependent:
```
useWalletReady()? → No → LoadingState
useAccount()?     → No → ConnectPrompt
chain unsupported? → Yes → WrongNetwork state
                   → No → Render flow
```

#### I. Background Decor

File: `src/components/layout/background-decor.tsx`

4 absolute-positioned `radial-gradient` blobs:
- `left-[8%] top-[18%]` — 380px, blue brand 35%
- `right-[10%] top-[40%]` — 460px, blue brand 28%
- `bottom-[4%] left-[30%]` — 320px, blue-400 22%
- Full overlay: `radial-gradient(circle_at_50%_0%, brand 18%, transparent 55%)`
Semua `blur-3xl`, `pointer-events-none fixed inset-0 -z-10`.

#### J. Image Handling

- `next/image` dengan `object-contain`, sering `unoptimized`
- Fallback: inisial huruf pertama di lingkaran `bg-brand-soft text-brand`
- Chain badge overlay: `absolute -bottom-0.5 -right-0.5` di atas protocol logo
- Token logo di selector: `OptionIcon` component dengan error state fallback

---

## 5. Layout System

### 5.1 Root Layout

```
html: data-theme="dark", h-full, antialiased
body: min-h-full, text-main, flex flex-col
```

### 5.2 App Layout (`(app)/layout.tsx`)

```html
<div class="relative flex min-h-screen flex-col">
  <BackgroundDecor />          <!-- fixed -z-10 -->
  <Navbar1 />                  <!-- glass pill -->
  <div class="relative flex flex-1 flex-col">
    {children}
  </div>
  <AIChatSheet />              <!-- fixed z-40 -->
  <AIChatButton />             <!-- fixed bottom-6 right-6 z-40 -->
</div>
```

### 5.3 Earn Page Layout

Desktop: 2-column grid, fixed height:
```html
lg:grid-cols-2 lg:gap-5 lg:items-stretch
lg:h-[calc(100dvh-4rem)] lg:overflow-hidden
```
- Kiri: SupplyCard → StrategyReview
- Kanan: VaultList (scrollable)

### 5.4 Portfolio Layout

Single column centered: `max-w-[1160px]`.
Header → summary cards → tokens → positions.

### 5.5 Compare Layout

`max-w-[1240px]` centered, `min-w-[760px]`, `grid-cols-4`.
Horizontal scroll on mobile.

---

## 6. Animation System

Library: `motion` (Framer Motion v12+) — import `from "motion/react"`.

### 6.1 Animation Tokens (tersebar, tidak terpusat)

| Konteks | Pattern | Parameters |
|---|---|---|
| Sheet entry | Spring `y: 100% → 0` | `damping: 32, stiffness: 320` |
| Sheet entry (AI chat) | Spring `y: 100% → 0` | `damping: 30, stiffness: 320` |
| Mobile menu | Spring `x: 100% → 0` | `damping: 25, stiffness: 300` |
| Button hover | `whileHover: scale(1.05)` | `type: spring, stiffness: 500, damping: 30` |
| Button tap | `whileTap: scale(0.92)` | — |
| Entrance fade-up | `opacity: 0, y: 20 → 0` | `duration: 0.6` |
| Staggered list | `delay: index * 0.04` | `duration: 0.3` |
| Icon swap | `AnimatePresence mode="popLayout"` | rotate ±90°, scale 0.6→1 |
| Skeleton pulse | `opacity: [0.6, 1, 0.6]` | `duration: 1.6, repeat: Infinity` |
| Chevron rotate | `rotate: 0 → 180` | `type: spring, stiffness: 400, damping: 26` |
| Dropdown menu | `opacity: 0, y: -6, scale: 0.96 → 1` | `duration: 0.18`, cubic-bezier |
| Success check | `scale: 0, rotate: -30 → 1` | `stiffness: 340, damping: 18` |
| Bar chart grow | `scaleY: 0 → 1` origin-bottom | staggered delay |
| Animated counter | rAF-based, cubic ease-out `1 - (1-t)^3` | 1400ms duration |
| Typing dots | `opacity: 0.3→1→0.3` | `delay: i * 0.2`, repeat |
| Winner badge | Spring entrance | `stiffness: 380, damping: 22` |
| Layout animation | `layout` prop | `type: spring, stiffness: 380, damping: 32` |

### 6.2 Pattern yang Sering Dipakai

```tsx
// Entrance
initial={{ opacity: 0, y: 20 }}
animate={{ opacity: 1, y: 0 }}
transition={{ duration: 0.6, delay: 0.2 }}

// Spring
transition={{ type: "spring", damping: 32, stiffness: 320 }}

// Stagger
transition={{ delay: index * 0.04, duration: 0.3 }}

// Icon swap
<AnimatePresence mode="popLayout" initial={false}>
  {condition ? <motion.span key="a" ... /> : <motion.span key="b" ... />}
</AnimatePresence>
```

---

## 7. Responsive Strategy

- Mobile-first dengan breakpoint `sm:`, `md:`, `lg:`, `xl:`
- **Navbar**: glass pill center, menu collapse di `md:` (hamburger → fullscreen overlay)
- **Sheets**: full-width bottom drawer mobile, centered dialog `sm:`
- **Earn page**: stacked mobile, 2-column `lg:`
- **Typography**: tetap, yang berubah layout (no responsive font scaling)
- **Element hide**: `hidden sm:flex`, `hidden md:flex`, `md:hidden`

---

## 8. Catatan Desain untuk Konsistensi

### Potensi Refinement

1. **Button component** — Saat ini inline class berulang. Ekstrak ke komponen `<Button>` dengan variant props.
2. **Animation tokens** — Spring stiffness/damping tersebar tanpa konsistensi. Sentralisasi.
3. **Type scale** — Tidak ada token tipografi. Definisikan `text-display, text-hero, text-title, text-body, text-caption, text-micro`.
4. **Glass pattern** — `border border-glass bg-glass backdrop-blur-2xl` diulang di 3+ tempat. Ekstrak utility.
5. **Spacing** — Menggunakan Tailwind default scale. Konsisten.
6. **Empty/Error/Loading states** — Pola sudah konsisten, bisa di-ekstrak jadi `<AsyncBoundary>` wrapper.

### Yang Dilakukan dengan Baik

- Dark/light via CSS variables tanpa runtime class switching → performant
- Semantic utilities (`bg-surface`, `text-muted`) → mudah refactor
- Zustand stores terpisah per domain → tidak ada god-object
- Connection gate pattern → UX error handling yang baik
- Animated transitions antar state → perceived performance meningkat
- Glassmorphism navbar → visual signature distinctive
