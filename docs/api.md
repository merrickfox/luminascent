# API

The backend is a **Hono** app on Cloudflare Workers. Base URL in local dev: `http://localhost:8023` (`npm run dev` in `backend/`).

All routes are mounted in `backend/src/index.ts`. Request validation uses **Zod** via `@hono/zod-validator`.

## Route groups

| Group | Prefix | Auth | Purpose |
|-------|--------|------|---------|
| Public | `/` | None | Read/write endpoints for the public site (tests, direct API use) |
| Admin | `/admin` | `x-api-key` header | Same endpoints + import routes — used by the admin panel |

Both groups mount the same feature routers except import, which is admin-only. Public routes are unchanged; the admin panel calls `/admin/*`.

## Admin routes

All paths below are prefixed with `/admin` and require the `x-api-key` header.

```
x-api-key: <ADMIN_API_KEY>
```

The key is configured in `backend/wrangler.jsonc` as `ADMIN_API_KEY` (default: `dev-admin-key`). Returns `401 { "error": "Unauthorized" }` on mismatch.

**Example:**

```bash
curl -H 'x-api-key: dev-admin-key' http://localhost:8023/admin/brands
```

CORS is enabled for `http://localhost:5173` (admin panel dev server) with `Content-Type` and `x-api-key` allowed headers. Methods: `GET`, `POST`, `PUT`, `DELETE`, `OPTIONS`.

See [Admin panel](./admin-panel.md) for how the UI connects. See [Storage](./storage.md) for R2 bucket details.

## Health

```
GET /
```

```json
{ "name": "luminascent-backend", "status": "ok" }
```

## Products

### List (faceted)

```
GET /products
```

| Query param | Type | Description |
|-------------|------|-------------|
| category | string | Category slug, e.g. `candle` |
| brand | string | Brand slug |
| notes | string | Comma-separated note slugs, e.g. `flour,vanilla` |
| accords | string | Comma-separated accord slugs, e.g. `woody,smoky` |
| vote_options | string | Comma-separated vote option slugs, e.g. `winter,strong` |
| min_rating | number | Minimum `rating_avg` |
| limit | number | Default 20 |
| offset | number | Default 0 |
| sort | string | `name` (default), `rating`, `newest` |

**Example — bakery candle with flour note, rating ≥ 3.8:**

```bash
curl "http://localhost:8023/products?category=candle&min_rating=3.8&notes=flour"
```

**Example — woody winter candles with strong sillage:**

```bash
curl "http://localhost:8023/products?category=candle&accords=woody&vote_options=winter,strong"
```

### Full-text search

```
GET /products/search?q=<query>
```

| Query param | Type | Description |
|-------------|------|-------------|
| q | string | Required. FTS5 query over name, brand, description, notes, accords, reviews |
| limit | number | Default 20 |

```bash
curl "http://localhost:8023/products/search?q=flour"
```

### Get by slug (nested)

```
GET /products/:slug
```

Returns the product with nested brand, category, scent profile, notes, accords, vote aggregates, rating summary, reminds-me-of links, reviews, **images**, and **sizes** (ordered by position, primary first).

Each size in the response:

```json
{
  "id": "uuid",
  "product_id": "uuid",
  "size_value": 200,
  "size_unit": "g",
  "size_grams": 200,
  "price_amount": 6800,
  "price_currency": "GBP",
  "burn_time_hours": 60,
  "sku": "ADPADP062069-200G",
  "availability": "InStock",
  "source_url": "https://...",
  "position": 0,
  "is_primary": 1
}
```

Each image in the response:

```json
{
  "id": "uuid",
  "r2_key": "prod-id/xK9mP2.png",
  "url": "https://pub-45a6fcb80891409e9b5b224fa471a158.r2.dev/prod-id/xK9mP2.png",
  "position": 0,
  "is_primary": true
}
```

```bash
curl "http://localhost:8023/products/feu-de-bois"
```

### Product images

#### List images

```
GET /products/:id/images
```

Returns `{ "images": [...] }` with the same shape as in product detail.

#### Upload image (admin)

```
POST /admin/products/:id/images
Content-Type: multipart/form-data
x-api-key: <ADMIN_API_KEY>
```

| Field | Type | Description |
|-------|------|-------------|
| file | File | Required. PNG, JPEG, or WebP, max 10 MB |

Does **not** require the product to exist in D1 — uploads go straight to R2 under `{productId}/{rand6}.ext`. Used by the admin panel to upload before product create.

**Response (201):**

```json
{
  "id": "uuid",
  "r2_key": "draft-product-id/xK9mP2.png",
  "url": "https://pub-45a6fcb80891409e9b5b224fa471a158.r2.dev/draft-product-id/xK9mP2.png"
}
```

```bash
curl -X POST \
  -H 'x-api-key: dev-admin-key' \
  -F 'file=@photo.png' \
  http://localhost:8023/admin/products/draft-uuid/images
```

#### Delete image (admin)

```
DELETE /admin/products/:id/images/draft
Content-Type: application/json
x-api-key: <ADMIN_API_KEY>
```

For draft uploads (no DB row yet), pass the R2 key in the body:

```json
{ "r2_key": "draft-product-id/xK9mP2.png" }
```

For persisted images, use `DELETE /admin/products/:id/images/:imageId` instead.

### Create

```
POST /products
Content-Type: application/json
```

```json
{
  "id": "client-minted-uuid",
  "name": "Feu de Bois",
  "category_slug": "candle",
  "brand_slug": "diptyque",
  "description": "A smoky, woody candle.",
  "wax_type": "paraffin",
  "vessel_material": "glass",
  "scent_summary": "Smoky woods with cedar warmth.",
  "sizes": [
    {
      "size_value": 190,
      "size_unit": "g",
      "size_grams": 190,
      "price_amount": 6800,
      "price_currency": "GBP",
      "burn_time_hours": 60,
      "is_primary": true
    }
  ],
  "images": [
    { "r2_key": "client-minted-uuid/xK9mP2.png", "position": 0, "is_primary": true }
  ],
  "notes": [
    { "note_slug": "cedar", "pyramid_stage": "base", "position_index": 1 }
  ],
  "accords": [
    { "accord_slug": "woody", "strength_score": 0.9, "position_index": 1 }
  ]
}
```

- `id` — optional string id; admin panel mints a UUID client-side so images can be uploaded before create. Any non-empty string is accepted (seeded products use human-readable ids like `prod-bakery`)
- `sizes` — optional array; replaces the full size set on create. One entry should have `is_primary: true`.
- `images` — optional array of `{ r2_key, position?, is_primary? }`; keys must match `{productId}/{rand6}.ext`
- Slug is auto-generated from name if omitted. FTS index is rebuilt on create.

### Update

```
PUT /products/:id
Content-Type: application/json
```

Same fields as create, all optional. Pass `images` to replace the full image set (removed keys are deleted from R2). Pass `sizes` to replace the full size set. FTS index is rebuilt on update.

### Delete

```
DELETE /products/:id
```

Deletes the product and cascades related rows (scent profile, sizes, images, etc.). Removes associated R2 objects.

### Bulk delete

```
POST /products/bulk-delete
Content-Type: application/json
```

```json
{ "ids": ["uuid-1", "uuid-2"] }
```

Returns `{ "deleted": [...], "notFound": [...] }`.

### Set rating summary

```
POST /products/:id/rating
Content-Type: application/json
```

```json
{
  "rating_avg": 4.2,
  "rating_count": 85
}
```

### Set vote aggregates

```
POST /products/:id/votes
Content-Type: application/json
```

```json
{
  "votes": [
    { "vote_option_slug": "winter", "vote_count": 42 },
    { "vote_option_slug": "strong", "vote_count": 28 }
  ]
}
```

### Add review

```
POST /products/:id/reviews
Content-Type: application/json
```

```json
{
  "author_name": "Jane",
  "rating": 4.5,
  "title": "Cozy fireplace",
  "body": "Smells exactly like a winter evening by the fire."
}
```

Rebuilds FTS index (review text is searchable).

### Add reminds-me-of

```
POST /products/:id/reminds
Content-Type: application/json
```

Link to an existing product:

```json
{
  "reminded_product_id": "prod-other-id",
  "thumbs_up": 5
}
```

Or reference an external product not yet in the catalog:

```json
{
  "external_brand_name": "Diptyque",
  "external_product_name": "Feu de Bois",
  "thumbs_up": 3
}
```

## Import (admin only)

Import scraped JSON from the crawler into D1. Used by the admin panel import page.

### Ensure brand

```
POST /admin/import/brand
Content-Type: application/json
x-api-key: <ADMIN_API_KEY>
```

```json
{
  "name": "Acqua di Parma",
  "slug": "acqua-di-parma",
  "country": "Italy",
  "website_url": "https://www.acquadiparma.com"
}
```

Returns `{ "brand": {...}, "status": "created" | "existing" }`.

### Import product

```
POST /admin/import/product
Content-Type: application/json
x-api-key: <ADMIN_API_KEY>
```

```json
{
  "product": {
    "name": "CANDLE ITALIAN MOMENTS buongiorno",
    "category_slug": "candle",
    "brand_slug": "acqua-di-parma",
    "description": "...",
    "wax_type": "vegetable wax",
    "vessel_material": "glass",
    "sizes": [
      {
        "size_value": 200,
        "size_unit": "g",
        "size_grams": 200,
        "price_amount": 7100,
        "price_currency": "GBP",
        "burn_time_hours": 50,
        "sku": "ADPADP062069-200G",
        "availability": "InStock",
        "is_primary": true
      },
      {
        "size_value": 500,
        "size_unit": "g",
        "size_grams": 500,
        "price_amount": 12000,
        "price_currency": "GBP",
        "burn_time_hours": 90,
        "sku": "ADPADP062069-500G",
        "is_primary": false
      }
    ],
    "images": [
      { "source_url": "https://...master.1.H1.jpg", "position": 0, "is_primary": true }
    ],
    "notes": [{ "note_slug": "italian-lemon", "name": "Italian lemon", "pyramid_stage": "unknown", "color": "#e8c547" }],
    "accords": [{ "accord_slug": "green", "name": "green", "color": "#7a9e6e" }]
  },
  "options": {
    "update_existing": true,
    "refetch_images": false
  }
}
```

Returns `{ "result": { "status": "created"|"updated"|"skipped"|"failed", ... } }`.

- `update_existing` — update product if slug already exists (default `true`)
- `refetch_images` — re-download and upload images even if product already has them (default `false`)

The import service auto-creates missing notes and accords (with optional colors), uploads images to R2, and writes sizes to `product_sizes`. Existing note/accord colors are never overwritten on import; null colors may be filled from the payload.

## Reference data

All support `GET /` (list) and `POST /` (create).

| Resource | Path | Create body |
|----------|------|-------------|
| Brands | `/brands` | `{ "name", "slug?", "country?", "website_url?" }` |
| Categories | `/categories` | `{ "name", "slug?" }` |
| Notes | `/notes` | `{ "name", "slug?", "note_family?", "color?", "color_gradient?" }` |
| Accords | `/accords` | `{ "name", "slug?", "color?", "color_gradient?" }` |

Slug is auto-generated from name when omitted.

Notes and accords also support `PATCH /notes/:id` and `PATCH /accords/:id` (admin only) to set display colors:

```json
{ "color": "#c47a4a", "color_gradient": "linear-gradient(135deg, #c47a4a, #8b5a2b)" }
```

`color` is required (hex). `color_gradient` is optional (pass `null` to clear).

## Error responses

| Status | Body |
|--------|------|
| 400 | `{ "error": "..." }` — validation or unknown reference slug |
| 401 | `{ "error": "Unauthorized" }` — missing or invalid `x-api-key` on `/admin/*` |
| 404 | `{ "error": "..." }` — resource not found |
| 409 | `{ "error": "..." }` — slug conflict |
| 500 | `{ "error": "Internal server error" }` |

## Not implemented

- User-authenticated writes (admin uses temporary API key auth)
- Pagination metadata in list responses (offset/limit work; total count not returned)
- DELETE endpoints for reference data (brands, notes, etc.)
- Orphan R2 garbage collection for abandoned draft uploads
