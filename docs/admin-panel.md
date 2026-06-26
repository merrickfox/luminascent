# Admin Panel

Internal admin UI for managing catalog data — brands, categories, notes, accords, products, and bulk import. Lives in `luminascent-admin-panel/`, a React SPA deployed to Cloudflare Pages.

## Quick start

```bash
# Terminal 1 — backend (port 8023)
cd backend && npm run db:apply && npm run dev

# Terminal 2 — admin panel (port 5173)
cd luminascent-admin-panel && npm run dev
```

Open `http://localhost:5173`. The env selector defaults to **Local** (`http://localhost:8023`).

## Stack

| Layer | Technology |
|-------|------------|
| UI | React 19, Vite, TypeScript |
| Components | shadcn/ui (dark theme) |
| Routing | React Router |
| Data fetching | TanStack Query |
| Forms | react-hook-form + Zod |
| Deploy | Cloudflare Pages (`luminascent-admin-panel`) |

## Layout

Classic left-sidebar layout:

- **Env selector** at the top of the sidebar — switches the API host (Local / Dev / Prod)
- **Catalog** — Products, Import
- **Reference** — Brands, Categories, Notes, Accords
- **Main content** — list tables, create/edit forms per entity

The selected environment is persisted in `localStorage` under `luminascent-admin-env`.

## Environment configuration

Defined in `luminascent-admin-panel/src/lib/config.ts`:

| Env | Host |
|-----|------|
| Local | `http://localhost:8023` |
| Dev | `https://luminascent-backend-dev.example.com` (placeholder) |
| Prod | `https://luminascent-backend.example.com` (placeholder) |

Update the Dev and Prod hosts when those Workers are deployed.

## API client

All requests go through `src/lib/api.ts`:

- Prefixes the selected env host with `/admin` (e.g. `http://localhost:8023/admin/brands`)
- Sends `Content-Type: application/json` for JSON requests
- Sends `x-api-key: dev-admin-key` (hardcoded for now — see [API auth](./api.md#admin-routes))
- Image uploads use `multipart/form-data` without forcing `Content-Type` (browser sets boundary)

Typed helpers: `api.brands`, `api.categories`, `api.notes`, `api.accords`, `api.products` (including `uploadImage`, `deleteImage`, `bulkDelete`), `api.import`.

## Pages

| Route | Features |
|-------|----------|
| `/` | Dashboard with quick links |
| `/products` | List with category/brand/min-rating filters; bulk delete; create dialog |
| `/products/:slug` | Edit product — all fields, sizes editor, images, notes/accords |
| `/import` | Upload `products.json` from crawler; ensure brand; import with progress |
| `/scraper` | Scraper worklist + QA viewer + pipeline runner (see [below](#scraper-section)) |
| `/brands` | List + create (name, slug, country, website) |
| `/categories` | List + create (name, slug) |
| `/notes` | List + create (name, slug, note_family) |
| `/accords` | List + create (name, slug) |

### Product create / edit form

Core fields: name, category, brand, description, scent summary, release year, wax type, vessel material, discontinued flag.

**Sizes editor** — repeatable rows per variant:

- Size value, unit, grams
- Price (minor units), currency
- Burn time (hours)
- SKU, availability, source URL
- Primary size toggle (exactly one should be primary)

**Image uploader** — upload one or more images before saving the product:

1. Opening the create dialog mints a draft product id (`crypto.randomUUID()`)
2. Files upload immediately to `POST /admin/products/{draftId}/images`
3. Thumbnails appear with primary star and remove controls
4. On submit, the product is created/updated with `id: draftId` and the uploaded `images` array

See [Storage](./storage.md) for R2 key layout and public URL configuration.

Also includes:

- **Notes picker** — add rows with note slug, pyramid stage (`top` / `middle` / `base` / `general` / `unknown`), and position index
- **Accords picker** — add rows with accord slug, strength score (0–1), and position index

Deferred to a later pass: rating, vote aggregates, reviews, reminds-me-of.

### Import page

Upload a `products.json` (or `.jsonl`) file produced by `scrapling/crawler/`:

1. Parses and validates records (name, category, sizes, images, notes, accords)
2. Ensures the brand exists via `POST /admin/import/brand`
3. Imports each product via `POST /admin/import/product` with progress UI
4. Options: update existing products, refetch images

See [scrapling/crawler/README.md](../scrapling/crawler/README.md) for how to generate the file.

### Scraper section

A bridge over the local scraping pipeline: observe progress, sanity-check extracted data against captured images and the saved DOM, and run the pipeline — all from the panel. Unlike the rest of the admin panel (which talks to the Worker backend on `:8023`), this section talks to the **local scraper server** (`scraper/server/server.js` on `:8777`) via a separate client (`src/lib/scraper-api.ts`, base `SCRAPER_HOST` in `config.ts`). The Worker can't reach local disk or spawn the pipeline, so the scraper server is the bridge backend. The section is **local-only**: it shows an "offline" card (`ScraperGate`) when `:8777` isn't running.

| Route | Features |
|-------|----------|
| `/scraper` | Worklist: every brand in `data/raw-brands.txt`, cross-referenced with captured sites; status (`not-started`/`configured`/`captured`/`assembled`), filter + counts |
| `/scraper/:folder` | Site detail: blueprint summary, product **QA grid** (thumbnail, extracted name, artifact + flag badges), and the **pipeline runner** |
| `/scraper/:folder/:slug` | Product QA: image gallery, **recipe-preview vs capture** table, `data.json`/`llm_output.json`/`products.json` compare, captured-DOM iframe |

`:folder` is the site folder name under `scraper/sites/` (what `GET /sites` returns), not a hostname.

**Scraper-server endpoints** (added in `scraper/server/admin-api.mjs`, wired in `server.js`):

- `GET /sites`, `GET /sites/:folder`, `GET /sites/:folder/products/:slug` — site/product artifact summaries
- `GET /sites/:folder/products/:slug/images/:file`, `.../dom` — serve image bytes / saved DOM html
- `GET /worklist` — `raw-brands.txt` parsed + cross-referenced
- `POST /recipe/preview { host, slug }` — re-runs the blueprint locators against the saved DOM (shared resolver `scraper/server/recipe-resolver.mjs`, the same logic `scripts/verify-recipes.mjs` checks) and reports what each field/image extracts now vs. capture — separates a recipe problem (re-tag) from an LLM problem (reprocess)
- `POST /pipeline/:command { host, flags }` (`run`/`push`/`sync`) — spawns the pipeline CLI; `GET /jobs/:id` polls status + streamed log. One job per folder.

## Project structure

```
luminascent-admin-panel/
├── src/
│   ├── App.tsx                 # Router + sidebar shell
│   ├── main.tsx                # QueryClient, EnvProvider, Toaster
│   ├── components/
│   │   ├── app-sidebar.tsx     # Nav + env selector
│   │   ├── env-select.tsx
│   │   ├── notes-picker.tsx
│   │   ├── accords-picker.tsx
│   │   ├── image-uploader.tsx
│   │   └── ui/                 # shadcn components
│   ├── context/
│   │   └── env-context.tsx
│   ├── features/
│   │   ├── brands/
│   │   ├── categories/
│   │   ├── notes/
│   │   ├── accords/
│   │   ├── products/
│   │   │   ├── sizes-editor.tsx
│   │   │   ├── product-detail-page.tsx
│   │   │   └── ...
│   │   └── import/
│   └── lib/
│       ├── api.ts
│       ├── config.ts
│       └── types.ts
└── wrangler.jsonc
```

## Deploy

```bash
cd luminascent-admin-panel && npm run build && npm run deploy
```

After deploying, add the Pages origin to the backend CORS config in `backend/src/index.ts` if it differs from `http://localhost:5173`.

## Auth (temporary)

The admin panel sends a hardcoded `x-api-key` header. The backend validates it against `ADMIN_API_KEY` in `wrangler.jsonc` vars. This is a placeholder — replace with proper auth (Cloudflare Access, OAuth, etc.) before production use.
