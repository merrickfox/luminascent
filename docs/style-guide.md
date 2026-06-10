# Style Guide

Public frontend design system for Luminascent. North star: **Editorial. Cultured. Understated.**

## Brand archetype

Think private members club, boutique hotel, art gallery, high-end fashion house. Wealth whispering, not wealth signalling.

**Keywords:** Refined, Intelligent, Effortless, Cultured, Calm, Curated, Confident, Modern heritage

**Avoid:** Glamorous, Girly, Sparkly, Influencer aesthetic, "Boss babe", Loud luxury

**Tone:** This brand knows who it is and does not need your attention. Not "Look at us" — "You're invited."

## Typography

### Display — Canela Deck

Self-hosted in `frontend/public/fonts/`. Used for hero headings, editorial quotes, category titles.

| Weight | File | Use |
|--------|------|-----|
| 300 Light | `canela-deck-light.otf` | Rare emphasis |
| 300 Light Italic | `canela-deck-light-italic.otf` | Editorial quotes |
| 400 Regular | `canela-deck-regular.otf` | Subheadings |
| 500 Medium | `canela-deck-medium.otf` | H1 headings |

Tailwind: `font-display`

### Body / UI — Inter Variable

Loaded via `@fontsource-variable/inter`. Used for navigation, forms, body copy, labels.

Tailwind: `font-sans`

### Scale

| Element | Font | Size | Notes |
|---------|------|------|-------|
| H1 | Canela 500 | 64–96px desktop | Tight tracking (`-0.02em`) |
| H2 | Canela | 40–56px | |
| H3 | Canela | 28–36px | |
| Body | Inter | 17px | 1.6 line-height |
| Labels | Inter | 12px | `0.08em` tracking, uppercase |

## Colour system

Declared as Tailwind theme tokens in `frontend/src/index.css`.

| Token | Hex | Tailwind class | Use |
|-------|-----|----------------|-----|
| Background | `#F7F4EE` | `bg-bg` | Warm gallery white |
| Surface | `#FFFFFF` | `bg-surface` | Cards, elevated areas |
| Text | `#1D1D1D` | `text-text` | Primary text (not pure black) |
| Text secondary | `#66625C` | `text-text-secondary` | Supporting copy |
| Border | `#E7E0D7` | `border-border` | Dividers, card borders |
| Accent | `#B4975A` | `text-accent` | Muted champagne gold |
| Success | `#65745A` | `text-success` | Muted olive |
| Error | `#8A4B43` | `text-error` | Muted oxblood |

### Secondary palette (occasional use)

| Name | Hex | Class |
|------|-----|-------|
| Stone | `#D5CBBF` | `bg-stone` |
| Taupe | `#A28E7D` | `text-taupe` |
| Deep olive | `#4A5444` | `text-deep-olive` |
| Oxblood | `#5D2E2E` | `text-oxblood` |
| Espresso | `#352B26` | `bg-espresso` |

## Layout

**Philosophy:** Everything breathes. Double the spacing you think you need.

| Rule | Value |
|------|-------|
| Content width (reading) | 720–960px (`max-w-3xl` narrow, `max-w-6xl` default) |
| Section padding desktop | 120px top/bottom |
| Section padding mobile | 64px top/bottom |
| Horizontal padding | 24px mobile, 40px desktop |

Implemented via `Container` and `PageSection` layout components.

## Motion

Motion should feel expensive.

| Property | Value |
|----------|-------|
| Duration | 250–600ms |
| Easing | `ease-out` or `cubic-bezier(0.22, 1, 0.36, 1)` (`--ease-luxury`) |
| Effects | Fade, reveal, soft scale |

**Avoid:** Bounce, elastic, fast spring animations.

The `Reveal` component uses IntersectionObserver for scroll-triggered fade-up. Hover transitions on cards use 300–500ms ease-out.

## Components

### Buttons (`Button`, `ButtonLink`)

| Property | Value |
|----------|-------|
| Height | 48px (`h-12`) |
| Radius | 8px (`--radius-button`) |
| Primary | `bg-text text-bg` — inverts on hover to espresso |
| Secondary | Transparent, `border-border` |

### Cards (`Card`)

| Property | Value |
|----------|-------|
| Radius | 14px (`--radius-card`) |
| Shadow | None — prefer `border-border` |
| Hover | Border shifts to `accent/40` |

### Forms (future)

Large fields, generous spacing, minimal validation noise. Think private banking, not startup SaaS.

### Navigation (`TopNav`)

Sticky header with backdrop blur. Logo in Canela, nav links in Inter. Active state via colour shift, not underline.

## File structure

```
frontend/src/
  components/
    layout/     TopNav, Footer, Layout, Container, PageSection
    ui/         Button, Card, Label, Eyebrow, Spinner, EmptyState, Reveal
    brand/      BrandCard, AlphaFilter
    product/    ProductCard, ImageGallery, ScentPyramid, AccordList, SizeList, RatingStat, ReviewList
  pages/        HomePage, BrandsPage, BrandPage, ProductPage, AboutPage, NotFoundPage
  hooks/        useBrands, useCategories, useProducts, useProduct
  lib/          api.ts, queryClient.ts, utils.ts
  types/        api.ts
```

Pages compose layout and domain components. Data fetching lives in hooks. API client is a thin typed wrapper in `lib/api.ts`.

## API integration

| Env var | Default | Purpose |
|---------|---------|---------|
| `VITE_API_BASE_URL` | `http://localhost:8023` | Backend API base |

Public read endpoints used by the frontend:

- `GET /brands` — brand directory
- `GET /categories` — category labels for product cards
- `GET /products` — filtered product lists
- `GET /products/:slug` — full product detail

## Related

- [Overview](./overview.md) — product vision and architecture
- [API](./api.md) — full endpoint reference
- [Admin panel](./admin-panel.md) — internal admin UI (separate design: shadcn dark theme)
