# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Luminascent is a candle database and discovery platform — "Fragrantica for candles." Users browse, search, and compare candles by brand, scent profile, notes, and community reviews. The Fragrantica mental model is first-class: scent pyramids, note-based similarity, and community reviews are core, not afterthoughts.

Current state: backend data layer, API, admin panel, and scraping pipeline are implemented. The public `frontend/` is wired to the API (TanStack Query client in `lib/api.ts`, hooks in `hooks/`) with working home/brands/product pages. The product detail page has two layouts: a data-driven **v2** at `/products/:slug` (default) and the original retail-style **v1** preserved at `/products/:slug/v1`.

## Monorepo layout

Each package is independent — run commands from its own directory, not the repo root (there is no root `package.json`).

| Package | Stack | Deploy target | Purpose |
|---------|-------|---------------|---------|
| `backend/` | TypeScript, Hono, Wrangler, Vitest | Cloudflare Worker | D1-backed API |
| `luminascent-admin-panel/` | React 19, Vite, shadcn/ui, react-hook-form + zod | Cloudflare Pages | CRUD, bulk import, sizes editor |
| `frontend/` | React 19, Vite, TanStack Query, react-router | Cloudflare Pages | Public SPA (not wired yet) |
| `scraper/` | Node + TypeScript (tsx), Tampermonkey userscript | Local only | Blueprint-driven scraping → import-ready JSON |

`docs/` holds authoritative documentation: `overview.md`, `data-model.md`, `api.md`, `migrations.md`, `admin-panel.md`, `storage.md`, `style-guide.md`. **Read the relevant doc before changing the schema, API, or migration workflow** — they describe current behavior, not aspirations.

`archived-systems-dont-look-here/` contains the retired Python `candle-crawler`/`scrapling` crawlers. The root `README.md` still references `scrapling/crawler` as the active scraper — that is stale; the live scraping path is `scraper/`.

## Commands

### backend (Cloudflare Worker)
```bash
cd backend
npm run dev              # wrangler dev on http://localhost:8023
npm test                 # vitest (Cloudflare workers pool)
npm test -- products     # run a single test file by name match
npm run db:apply         # apply D1 migrations locally (run first / after pull)
npm run db:apply:remote  # apply migrations to remote D1
npm run db:new           # scaffold a new numbered migration (scripts/new-migration.mjs)
npm run db:rollback      # roll back last migration (scripts/rollback.mjs)
npm run db:reset         # wipe local D1 state and re-apply all migrations
npm run db:status        # list local migration state
npm run cf-typegen       # regenerate Env types after editing wrangler.jsonc bindings
npm run deploy           # wrangler deploy
```

### admin panel / frontend (identical script set)
```bash
cd luminascent-admin-panel   # or: cd frontend
npm run dev       # vite (admin :5173)
npm run build     # tsc -b && vite build  — use this to typecheck
npm run lint      # eslint
npm run deploy    # build + wrangler pages deploy
```

### scraper pipeline (LLM extraction)
```bash
cd scraper
node server/server.js              # local HTTP API for the userscript on :8777
npm run pipeline:run -- --brand <host_slug>   # LLM pass + assemble products.json
npm run pipeline:run -- --dry-run             # skip LLM calls
npm run pipeline:push -- --brand <host_slug>  # push products.json + images to backend import API
node scripts/verify-recipes.mjs    # offline locator regression checks
```

## Backend architecture

Hono app (`backend/src/index.ts`) mounted twice:
- **Public routes** at the root (`/brands`, `/products`, etc.) — no auth.
- **Admin routes** under `/admin/*` — gated by `apiKeyAuth` middleware (`x-api-key` header vs `ADMIN_API_KEY`, default `dev-admin-key` in dev). Bulk **import lives only under `/admin/import`**.

### Feature module convention
Every feature in `backend/src/features/<name>/` follows the same file split:
- `handlers.ts` — Hono router; uses `zValidator('json', schema, hook)` for validation.
- `repo.ts` — all SQL / data access.
- `schema.ts` — zod request schemas.
- `types.ts` — TypeScript row types that **mirror the D1 tables** (kept in sync with `migrations/`).

Shared helpers in `backend/src/lib/`:
- `db.ts` — thin D1 wrappers: `queryAll`, `queryOne`, `execute`. Use these instead of calling `db.prepare(...)` directly.
- `http.ts` — typed JSON error responses: `notFound`, `badRequest`, `conflict`, `serverError`.
- `auth.ts` — `apiKeyAuth` middleware.
- `zod-validation.ts` — `formatZodError` / `validationFailed`; used as the zValidator hook so validation errors return a flattened `{ error, issues }`.
- `id.ts`, `slug.ts`, `images.ts` — UUID generation, slugging, R2 image URL helpers.

### Data model essentials
- D1 (SQLite); migrations are numbered SQL files in `backend/migrations/` (`down/` holds reverse migrations). See `docs/data-model.md` for the full ERD.
- A product has **one** `scent_profiles` row; notes and accords attach to the profile (`scent_profile_notes`, `scent_profile_accords`), not directly to the product.
- **Size variants live in `product_sizes`** (grams, price, burn time per size) — never on the product row.
- Full-text search uses an FTS table `product_search`. `features/products/fts.ts` rebuilds a product's search row from joined name/brand/notes/accords/reviews; **call `rebuildProductSearch` after any mutation that affects searchable fields.**
- Bindings (`wrangler.jsonc`): `DB` (D1), `BUCKET` (R2, public images). Run `cf-typegen` after changing them.

## Scraper architecture

Two-stage, fully local. Output (`scraper/sites/`) is gitignored.

1. **Capture** — a Tampermonkey userscript (`userscript/scraper.user.js`) authors a per-host blueprint (`sites/<host>/config.json`), discovers product URLs, extracts raw DOM values, and posts them to the local Node server (`server/server.js`), which writes `data.json`, assembles `llm_input.json`, and downloads images.
2. **Pipeline** (`pipeline/`, run via `tsx`) — reads `llm_input.json`, runs a per-field LLM extraction pass, and assembles `products.json` matching the backend's `scrapedProductSchema` (`backend/src/features/import/schema.ts`). `push` sends each product to `POST /admin/import/product`.

LLM providers are pluggable (`pipeline/providers/`): `ollama` is the working default (configured in `scraper/pipeline.config.json`); `claude` is a stub pending implementation (`ANTHROPIC_API_KEY`). The import contract is the seam between scraper and backend — when changing scraped fields, update both `scrapedProductSchema` and the pipeline assembler.

## Conventions

- **Backend-first for data work** — settle the D1 schema and API shape before building UI that depends on them.
- **Cloudflare specifics** — read `backend/AGENTS.md` before touching Workers, bindings, or wrangler config; Workers runtime APIs/limits change, so verify against current Cloudflare docs.
- **Naming** — worker `luminascent-backend`; Pages projects `luminascent-admin-panel` and `luminascent-frontend`.
- **Typecheck** for frontend packages is `npm run build` (`tsc -b`); there is no separate typecheck script.
- **Commit after completing work** — once a task is done and verified, commit the changes with a clear, scoped message (stage only the files for that task; don't `git add -A` unrelated work into the same commit). Do not push unless asked.

## Undecided (confirm with the user before baking in)

Auth provider; note ontology (curated vs free-form); image moderation / who can add entries; similarity algorithm (note overlap vs Vectorize embeddings vs hybrid).
