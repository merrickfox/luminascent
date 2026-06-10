# Storage

Product images are stored in a single **Cloudflare R2** bucket shared across all environments (local, dev, prod).

## Bucket

| Setting | Value |
|---------|-------|
| Bucket name | `luminascent` |
| Worker binding | `BUCKET` |
| Public base URL | `R2_PUBLIC_BASE_URL` env var (no trailing slash) |

Configured in `backend/wrangler.jsonc`:

```jsonc
"r2_buckets": [
  { "binding": "BUCKET", "bucket_name": "luminascent", "remote": true }
],
"vars": {
  "R2_PUBLIC_BASE_URL": "https://pub-45a6fcb80891409e9b5b224fa471a158.r2.dev"
}
```

`remote: true` on the R2 binding makes local `wrangler dev` talk to the real bucket (not the Miniflare simulation in `.wrangler/state/`). Without it, uploads succeed locally but the public r2.dev URL returns 404 because the object was never written remotely.

One public URL is enough for all environments — local, dev, and prod all use the same `R2_PUBLIC_BASE_URL`. You must be logged in via `wrangler login` for local dev to reach remote R2.

Replace `R2_PUBLIC_BASE_URL` with your r2.dev subdomain or custom domain if the public URL changes.

## Key layout

```
{product-id}/{random-6-char}.png
```

- `product-id` — UUID of the product (minted client-side before create, or generated server-side)
- `random-6-char` — 6 characters from `[a-zA-Z0-9]`
- Extension matches the uploaded content type (`png`, `jpg`, `webp`)

**Example:** `a1b2c3d4-e5f6-7890-abcd-ef1234567890/xK9mP2.png`

Public URL: `{R2_PUBLIC_BASE_URL}/{r2_key}`

## Upload flow

Images are uploaded **before** the product is saved:

1. Admin panel mints a draft `productId` (`crypto.randomUUID()`) when the create dialog opens
2. User selects files → `POST /admin/products/{productId}/images` (multipart)
3. Worker writes to R2 under `{productId}/{rand6}.ext` — no DB row yet
4. On product submit, `POST /admin/products` includes `id: productId` and `images: [{ r2_key, position, is_primary }]`
5. Worker inserts the product and `product_images` rows

Abandoned drafts leave orphan objects in R2 (acceptable for now; garbage collection can be added later).

## Limits

| Constraint | Value |
|------------|-------|
| Max file size | 10 MB |
| Allowed types | `image/png`, `image/jpeg`, `image/webp` |

## Database

Image metadata lives in the `product_images` table (see [Data model](./data-model.md)). The legacy `products.image_url` column remains for optional external URLs.

## Public access setup

1. Create the `luminascent` R2 bucket in the Cloudflare dashboard (if not already created)
2. Enable public access via r2.dev subdomain or attach a custom domain
3. Set `R2_PUBLIC_BASE_URL` in `wrangler.jsonc` (or as a secret/var per deploy) to match the public URL

The same bucket and public URL serve all environments. Local dev requires `"remote": true` on the R2 binding (see above).
