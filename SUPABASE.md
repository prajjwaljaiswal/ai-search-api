# Connect Codehence to Supabase PostgreSQL

The backend uses a private PostgreSQL connection. Application accounts, scrypt password hashes, sessions and store permissions remain in place: sign-in has **not** been switched to Supabase Auth. No Supabase anon/service-role API key belongs in the frontend.

## 1. Private connection

In Supabase, open **Connect → Transaction pooler** and copy the PostgreSQL URI. Replace its password placeholder and URL-encode special password characters. Use your project's exact username, region, hostname and port.

In the backend `.env`, add:

```env
DATABASE_URL=postgresql://YOUR_USER:YOUR_ENCODED_PASSWORD@YOUR_POOLER_HOST:6543/postgres
```

This is a placeholder example. Do not paste the real URI into chat or commit `.env`. The driver uses a small connection pool (max 3), unnamed parameterized queries and TLS with server-certificate verification. If needed, download the project's root certificate from Database settings and put its PEM in `SUPABASE_DB_CA` using literal `\n` line separators. Do not disable certificate verification.

References: [Supabase connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres), [serverless drivers](https://supabase.com/docs/guides/database/connecting-to-postgres/serverless-drivers).

## 2. Apply schema

From `C:\Project\ai-search\codehence`:

```powershell
npm install
npm run db:migrate
npm run db:check
```

The migration creates a private `codehence` schema for stores, products, embeddings, accounts, sessions, ownership, request limits and indexing leases. It records schema version 1, can be rerun and does not alter unrelated public tables. It does not touch the local SQLite database.

Alternatively, run `supabase/migrations/001_codehence.sql` in Supabase SQL Editor as the database owner, then run `npm run db:check`. Use the same database for migration and runtime. Keep the `codehence` schema out of Supabase Data API exposed schemas. The migration revokes PUBLIC, anon and authenticated schema/table access where those roles exist. Browsers continue to use Codehence backend APIs, with tenant authorization, rather than direct SQL.

## 3. Preserve existing local data (optional)

New PostgreSQL tables are initially empty. To retain existing local accounts/passwords, store IDs/API keys, ownership, products and embeddings:

1. Stop the application and take a backup of `data/codehence.sqlite`.
2. Ensure target Codehence tables are empty. The importer refuses populated targets.
3. Run:

```powershell
npm run db:import-sqlite
```

Set `CODEHENCE_SQLITE_IMPORT_PATH` if importing another file. Source is opened read-only. Target changes are in a single transaction, with table locks, and roll back on failure. Active sessions and request counters are not migrated; sign in again. The original SQLite file remains unchanged. Pause application writes during cutover.

## 4. Start and verify

```powershell
npm start
```

With DATABASE_URL set, startup validates PostgreSQL connectivity and migration; connection failures do not silently fall back. Without it, local SQLite remains supported. `/health` reports `database: postgres` or `database: sqlite`.

Verify account login, stores, domain settings, imports, product updates/deletes and search. Restart to verify persistence. PostgreSQL integration tests use the real local PGlite PostgreSQL engine and the same schema/query adapter, plus SQLite regression tests. A live Supabase check is still required.

## Boundaries

This integration uses Supabase **Database**, not Supabase Auth/Storage/Realtime. Embeddings remain serialized vectors; catalog retrieval still runs in application memory. A pgvector retrieval index is a future scaling step.

Request limits and indexing leases are now database-backed across processes. Sign-in limiting still uses the socket address; proxy/client-IP policy remains deployment work. Leases expire after two minutes and are released after indexing. Completed indexing batches are preserved on provider failure.

Vercel function entry/routing configuration is a separate step. Setting DATABASE_URL does not itself deploy the application. For a later Vercel deployment, add DATABASE_URL, the optional root certificate and other private server settings to Vercel environment variables; never use a NEXT_PUBLIC prefix for these secrets.
