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

NOTE!!
the frontend is likely already running on http://localhost:5173/
and backend on http://localhost:8023
check first before running in your tools and killing my session

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

IMPORTANT!! regarding scraping, remember issues might affect just one site of 1000s do not put custom code in just for one site, we must fix things at a conceptual level while maintaining it working for sites it might already work for. Genericism and modularity is the goal here

1. **Capture** — a Tampermonkey userscript authors a per-host blueprint (`sites/<host>/config.json`), discovers product URLs, extracts raw DOM values, and posts them to the local Node server (`server/server.js`), which writes `data.json`, assembles `llm_input.json`, and downloads images. The scraper code is split into ordered edit-units under `userscript/src/` (`00-constants.js` … `07-init.js`, order in `src/manifest.json`); `userscript/bundle.mjs` concatenates them back into one IIFE — byte-identical to the original single file. **Install `userscript/scraper.loader.user.js` in Tampermonkey**, not the full file: it fetches `GET /userscript/bundle.js` (assembled fresh per request) and direct-`eval`s it, so editing a `src/` file + reloading the page picks up changes with no re-paste. `npm run build:userscript` regenerates the standalone `userscript/scraper.user.js` (CSP/offline fallback).
2. **Pipeline** (`pipeline/`, run via `tsx`) — reads `llm_input.json`, runs a per-field LLM extraction pass, and assembles `products.json` matching the backend's `scrapedProductSchema` (`backend/src/features/import/schema.ts`). `push` sends each product to `POST /admin/import/product`.

LLM providers are pluggable (`pipeline/providers/`): `ollama` is the working default (configured in `scraper/pipeline.config.json`); `claude` is a stub pending implementation (`ANTHROPIC_API_KEY`). The import contract is the seam between scraper and backend — when changing scraped fields, update both `scrapedProductSchema` and the pipeline assembler.

### Recovering from a failed scrape / push

The pipeline is a layered cache. Each stage writes an artifact the next stage consumes, so **recover at the lowest layer that is actually broken** — re-running a layer that was already correct just wastes time (and LLM calls). Per product, the artifacts under `sites/<host>/products/<slug>/` are:

| Layer | Artifact | Produced by | Re-run with |
|-------|----------|-------------|-------------|
| Capture | `data.json`, `llm_input.json`, `images/` | userscript in the browser | re-run the userscript on the live site |
| Extract | `llm_output.json` | `pipeline:run` (LLM pass) | `pipeline:run -- --brand <host> --reprocess` |
| Assemble | `sites/<host>/products.json` | `pipeline:run` (always, even when LLM is cached) | `pipeline:run -- --brand <host>` |
| Push | rows in backend / R2 | `pipeline:push` | `pipeline:push -- --brand <host>` |

**Diagnose from the error, then climb only as high as needed:**

1. **Backend validation error naming a field** (e.g. `product.images.N.source_url: Invalid url`, sizes/price shape) → the bad value is already in `products.json`. If the cause was a pipeline bug you just fixed (assembler/normalizer/`push.ts`), **re-push** (`pipeline:push`) — push-time transforms may fix it on the fly. To also clean the on-disk `products.json`, **re-assemble** (`pipeline:run -- --brand <host>`, LLM stays cached → no LLM cost), then push. No re-capture needed: the raw value was captured fine, only the transform was wrong.
2. **A field is wrong/empty across *all* products of a site** but the raw value exists in `llm_input.json` → LLM/prompt/schema problem. **Reprocess** (`pipeline:run -- --brand <host> --reprocess`) to re-run the LLM over the existing captured input, then push.
3. **The raw value is missing from `llm_input.json`/`data.json`, images didn't download, product URLs are incomplete, or the blueprint/recipes are wrong** → capture problem. **Re-capture from scratch** in the browser (only stage needing Tampermonkey), then `pipeline:run` → `pipeline:push`. Run `node scripts/verify-recipes.mjs` first to catch locator regressions offline.
4. **Broken images (especially "mainly secondary")** → a local file under `images/` is not actually an image — usually a CDN 404 HTML page that was downloaded from a bad/lazy URL and saved as `.jpg` before the guards landed. Re-download just the broken files from their (normalized) `data.json` URLs without a full re-capture: `node scripts/repair-images.mjs --brand <host>` (use `--dry-run` first; `--all` for every site). It trusts magic bytes, leaves valid images untouched, and writes the true extension — so afterward **re-assemble** (`pipeline:run -- --brand <host>`, since a fixed file may have changed extension) then **`pipeline:push -- --brand <host> --refetch-images`**. Capture now guards against this at three layers (userscript fetch, server save, push upload) so it shouldn't recur.

Remember the genericism rule above: if a failure looks site-specific, fix it at the layer/concept (normalizer, assembler, locator inference, byte-sniffing), never with a per-host special case.

## Conventions

- **Backend-first for data work** — settle the D1 schema and API shape before building UI that depends on them.
- **Cloudflare specifics** — read `backend/AGENTS.md` before touching Workers, bindings, or wrangler config; Workers runtime APIs/limits change, so verify against current Cloudflare docs.
- **Naming** — worker `luminascent-backend`; Pages projects `luminascent-admin-panel` and `luminascent-frontend`.
- **Typecheck** for frontend packages is `npm run build` (`tsc -b`); there is no separate typecheck script.
- **Commit after completing work** — once a task is done and verified, commit the changes with a clear, scoped message (stage only the files for that task; don't `git add -A` unrelated work into the same commit). Do not push unless asked.

## Undecided (confirm with the user before baking in)

Auth provider; note ontology (curated vs free-form); image moderation / who can add entries; similarity algorithm (note overlap vs Vectorize embeddings vs hybrid).
