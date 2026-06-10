# D1 Migrations

Luminascent uses Wrangler's native D1 migration system with paired down scripts for local rollback.

## Layout

```
migrations/
  NNNN_name.sql           # forward migration (applied by Wrangler)
  down/
    NNNN_name.down.sql    # reverse script (not scanned by Wrangler)
```

Wrangler records applied migrations in the `d1_migrations` table.

## Commands

| Command | Purpose |
|---------|---------|
| `npm run db:new -- <name>` | Create a new up + down migration pair |
| `npm run db:status` | List migration status (local) |
| `npm run db:status:remote` | List migration status (remote) |
| `npm run db:apply` | Apply pending migrations locally |
| `npm run db:apply:remote` | Apply pending migrations to production |
| `npm run db:rollback` | Roll back the last applied migration locally |
| `npm run db:rollback:remote -- --yes` | Roll back the last applied migration remotely (requires confirmation) |
| `npm run db:reset` | Wipe local D1 state and re-apply all migrations |

## Creating a migration

```bash
npm run db:new -- add_product_tags
```

This creates:

- `migrations/NNNN_add_product_tags.sql`
- `migrations/down/NNNN_add_product_tags.down.sql`

Edit both files. Every up migration must have a matching down script.

## Applying migrations

```bash
# Local development
npm run db:apply

# Production (after wrangler d1 create luminascent and updating database_id in wrangler.jsonc)
npm run db:apply:remote
```

## Rolling back

D1 has no built-in rollback. Use the paired down script:

```bash
npm run db:rollback
```

This:

1. Finds the last row in `d1_migrations`
2. Runs the matching `migrations/down/*.down.sql`
3. Deletes that row from `d1_migrations`

Remote rollback requires explicit confirmation:

```bash
npm run db:rollback:remote -- --yes
```

## Production recovery

For emergencies (bad migration applied to production), use D1 Time Travel:

```bash
wrangler d1 time-travel info luminascent
wrangler d1 time-travel restore luminascent --timestamp=<unix_timestamp>
```

Time Travel restores the entire database to a point in time (up to 30 days). Use for emergencies, not routine rollbacks.

## First-time setup

1. Create the remote database: `wrangler d1 create luminascent`
2. Copy the `database_id` into `wrangler.jsonc`
3. Apply migrations: `npm run db:apply:remote`
