# Luminascent

A candle database and discovery platform — think [Fragrantica](https://www.fragrantica.com/) for candles. Users browse, search, and compare candles by brand, scent profile, notes, and community reviews.

## Status

Backend data layer, API, admin panel, scraping pipeline, and bulk import are implemented. Public frontend is still the starter template — not yet wired to the API.

See **[docs/](./docs/)** for full documentation: overview, data model, API reference, migrations, admin panel, scraping.

## Repo layout

```
luminascent/
├── docs/                      # Project documentation
├── backend/                   # Cloudflare Worker API (luminascent-backend)
│   ├── migrations/            # D1 schema + seed data
│   └── src/features/          # products, sizes, import, brands, notes, etc.
├── luminascent-admin-panel/   # Admin SPA — CRUD, import, sizes editor
├── scrapling/crawler/           # Python crawler → products.json
└── frontend/                  # React + Vite SPA (luminascent-frontend) — not wired yet
```

| Package | Stack | Deploy target |
|---------|-------|---------------|
| `backend` | TypeScript, Wrangler, Vitest | Cloudflare Worker |
| `luminascent-admin-panel` | React 19, Vite, shadcn/ui | Cloudflare Pages |
| `frontend` | React 19, Vite, TypeScript | Cloudflare Pages |
| `scrapling/crawler` | Python, Scrapling, Ollama | Local |

## Development

Run each package from its own directory:

```bash
# API
cd backend && npm run db:apply  # apply D1 migrations (first time / after pull)
cd backend && npm run dev       # http://localhost:8023

# Admin panel
cd luminascent-admin-panel && npm run dev   # http://localhost:5173

# Scraping (optional)
cd scrapling/crawler && ./setup.sh && source .venv/bin/activate
python crawl_brands.py brands.json --brand "Acqua di Parma"

# Public UI (not wired to API yet)
cd frontend && npm run dev
```

```bash
cd backend && npm test
cd frontend && npm run build && npm run preview
```

Deploy:

```bash
cd backend && npm run deploy
cd luminascent-admin-panel && npm run deploy
cd frontend && npm run deploy
```

## Conventions for agents

- **Read the docs** — [docs/](./docs/) describes the current schema, API, migration workflow, and scraping pipeline.
- **Backend first for data** — API shape and D1 schema before frontend pages that depend on them.
- **Size variants live in `product_sizes`** — grams, price, burn time per size; not on the product row.
- **Match Fragrantica mental model** — scent pyramids, note-based similarity, community reviews are first-class, not afterthoughts.
- **Cloudflare specifics** — read `backend/AGENTS.md` before touching Workers, bindings, or wrangler config.
- **Naming** — worker name `luminascent-backend`, Pages projects `luminascent-admin-panel` and `luminascent-frontend`.

## Open questions

Not decided yet — confirm with the user before baking in:

- Auth provider (Clerk, Auth0, Cloudflare Access, roll-your-own)
- Note ontology source (curated list vs free-form tags)
- Image moderation and who can add new candle entries
- Similarity algorithm (note overlap, embeddings via Vectorize, or hybrid)
