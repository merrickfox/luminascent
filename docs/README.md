# Luminascent Documentation

Project docs for the candle database and discovery platform.

## Contents

| Doc | Description |
|-----|-------------|
| [Overview](./overview.md) | What Luminascent is, current status, architecture, repo layout |
| [Data model](./data-model.md) | D1 schema, entities, relationships, design decisions |
| [API](./api.md) | REST endpoints, admin routes, import, query parameters, example requests |
| [Storage](./storage.md) | R2 bucket, image key layout, upload flow |
| [Admin panel](./admin-panel.md) | Admin UI — env selector, entity management, sizes, import |
| [Migrations](./migrations.md) | D1 migration workflow — create, apply, rollback |
| [Style guide](./style-guide.md) | Public frontend design system, typography, colors, components |

## Quick start

```bash
# Backend API (from backend/)
npm run db:apply    # apply D1 migrations locally
npm run dev         # http://localhost:8023
npm test            # Vitest

# Admin panel (from luminascent-admin-panel/)
npm run dev         # http://localhost:5173 — connects to /admin on backend

# Scraping (from scrapling/crawler/)
./setup.sh && source .venv/bin/activate
python crawl_brands.py brands.json --brand "Acqua di Parma"

# Public frontend (from frontend/)
npm run dev         # http://localhost:5173 — connects to backend API
```

## Related

- [Root README](../README.md) — repo entry point
- [Backend migrations README](../backend/migrations/README.md) — operator reference for `db:*` commands
- [Scrapling crawler README](../scrapling/crawler/README.md) — scraping pipeline command reference
