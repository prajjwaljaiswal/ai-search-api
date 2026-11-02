# Codehence Search backend

## Supabase database

Supabase PostgreSQL is supported through the private DATABASE_URL environment variable. See [SUPABASE.md](SUPABASE.md) for pooler setup, TLS, schema migration, connectivity checks and optional migration of existing local data. Existing application authentication stays in place; Supabase Auth is not enabled. Without DATABASE_URL, local SQLite remains available. Live Supabase connectivity requires your project URI and has not been verified automatically.


## Customer workspace

The customer UI is organized around business onboarding at `https://api.codehence.com`: create/sign in to an account, connect a storefront, upload a real catalog, preview search, copy installation code, and manage allowed website origins. Admin-key access is no longer part of the customer UI; the server-side admin API remains available to operators. Sample-data loading has been removed from the normal business workflow. The dashboard shows actual product/index counts and lists the first 30 catalog products.

`GET /public-config` provides the public integration origin. Generated installation snippets use CODEHENCE_PUBLIC_ORIGIN when configured, otherwise `https://api.codehence.com`; they no longer take the visitor's local browser origin as the deployment endpoint. The in-workspace widget preview still uses the current backend. Deployment and DNS must exist before the public installation snippet can work on another website.

`GET /v1/stores/:id/settings` reads store metadata. `PATCH /v1/stores/:id/settings` updates name and allowedOrigins (up to 20 exact HTTP(S) origins, deduplicated); currency is fixed. Both require the owner session or private Write key. Search-only keys cannot read/update these settings. Owner-session search uses dashboard-origin CSRF validation independently of storefront CORS, so changing allowed storefront domains does not break the merchant's preview.

Local Node.js 24 application. Run `npm install` to install the PostgreSQL driver before starting. SQLite is provided by Node's experimental `node:sqlite` module.

## Run (PowerShell)

```powershell
cd C:\Project\ai-search\codehence
npm start
```

Open http://127.0.0.1:4300. The launcher creates or reuses `data/local-admin-key.txt` unless CODEHENCE_ADMIN_KEY is explicitly set. Copy that key into the local dashboard to create a store. Save the returned store ID and keys securely; the dashboard holds credentials only in tab memory. Load the sample catalog or upload a CSV/JSON file, import it, test search, then preview the widget. Data persists in `data/codehence.sqlite`. Do not commit keys or data.

## API

## Merchant accounts

Create an account in the dashboard using an email and a 12–128 character password. Email ownership is not verified yet. Passwords use salted scrypt hashes; sessions use random tokens stored hashed in SQLite with seven-day expiry. Cookies are HttpOnly and SameSite=Strict, plus Secure in production. Account mutations require a matching Origin to protect against CSRF. Log out revokes the current session.

Signed-in merchants can create stores without the platform admin key and manage only stores they own. To migrate a pre-account store, sign in, expand **Use existing credentials**, fill Store ID, search key and write key, then click **Link store using existing credentials below**. Claiming validates both keys and never transfers another account's store. Store selection and sign-in sessions survive reload; private API keys are not saved in browser storage. A signed-in account uses its session for catalog writes. Existing backend API keys still work for server integrations.

Account routes: `POST /account/register`, `POST /account/login`, `GET /account/me`, `POST /account/logout`, `GET /account/stores`, `POST /account/claim-store`. Auth routes have a per-socket sign-in attempt limit. The dashboard continues to support legacy manual key access for development.

For Linux VPS deployment see [DEPLOYMENT.md](DEPLOYMENT.md). Docker, Compose and a Caddy HTTPS proxy configuration are provided; no live VPS deployment has been performed yet.

All API credentials use `Authorization: Bearer KEY`.

| Method | Route | Credential | Purpose |
|---|---|---|---|
| POST | /v1/stores | Admin | Create store: name, currency (default USD), allowedOrigins |
| PUT | /v1/stores/:id/products | Write | Upsert `{ "products": [...] }`, 1–1,000 per batch |
| GET | /v1/stores/:id/products | Write | List up to 1,000 products |
| DELETE | /v1/stores/:id/products/:productId | Write | Delete a product |
| POST | /v1/stores/:id/search | Search or write | query, filters, page, pageSize |
| GET | /v1/stores/:id/semantic/status | Write | Provider configuration and current index coverage |
| POST | /v1/stores/:id/semantic/index | Write | Embed up to 100 pending products per run |
| GET | /health | None | Readiness |

Product: `id`, `title`, `price`, optional `description`, `category`, `brand`, `currency`, `inStock`, `attributes` (string values), `url`, `imageUrl`. HTTP(S) URLs only. Currency must match the store. Treat variants as separate product IDs for now.

Search supports price phrases (under, above, between), recognized colors, stock requests, a small synonym map, explicit filters and pagination. Explicit filters override interpreted filters. Category facets reflect the returned candidate set. Without a configured semantic index, responses include `engine: lexical-rules-v1` and `semanticSearch: false`.

## Import a real catalog

Download the dashboard CSV template, replace its illustrative data with your public product catalog, then upload. CSV needs `id,title,price`; optional headers are `description,category,brand,currency,inStock,url,imageUrl` and `attributes.NAME` such as `attributes.color`. Quoted commas and multiline fields are supported. Use plain numbers for prices and true/false for stock. JSON accepts a product array or `{ "products": [...] }`. Files are previewed in the editor before saving. Limits: 2 MB per request and 1,000 products per import. Currency must match the store. IDs are upserted, so repeat imports do not duplicate products.

## Enable semantic search (optional)

1. Copy `.env.example` to `.env` and set OPENAI_API_KEY locally. Do not put this key in browser JavaScript or chat.
2. Restart with `npm start`. Existing catalog data and the local admin key are preserved.
3. Connect a store with its saved credentials. Click **Build / update semantic index**. This sends product title, description, category, brand and attributes to OpenAI. Queries are sent to the same service when semantic search runs. Use public catalog data only.
4. Check index coverage; repeat indexing if more than 100 products are pending.

The adapter follows the official [OpenAI embeddings API](https://developers.openai.com/api/reference/resources/embeddings/methods/create). Default model is `text-embedding-3-small`, configurable via CODEHENCE_EMBEDDING_MODEL. An account API key and available API credits are needed; no live provider calls were made during development. Tests use deterministic test vectors and mocked HTTP responses, not model-quality evaluations.

Embeddings persist in SQLite, scoped by store/product/model/content hash. Changes to descriptive content make a vector stale; price and stock updates reuse it. Only current vectors participate in search. Product deletions cascade to embeddings. Index requests process up to 100 products in batches of 20, preserve completed batches after failures and reject overlapping index jobs for one store. Query embeddings have an 8-second provider timeout. Provider failures fall back to lexical retrieval with `fallbackReason`; embedding/indexing errors never return provider secrets.

Hybrid retrieval combines up to 100 lexical and 100 semantic candidates using reciprocal rank fusion, after applying hard filters to both. Similarity cutoff is currently 0.3 and requires calibration on a representative catalog. Hybrid results are bounded candidates, not an exhaustive catalog count. Blank queries use filtered lexical browsing. Query embeddings currently have no cache. Query latency, relevance and provider costs still need live evaluation before production.

The widget can be embedded in any JavaScript website. The dashboard generates a snippet with a search-only key. Configure exact origins such as `https://shop.example` at store creation. CORS applies only to the search endpoint; catalog write APIs are server-to-server. CORS is a browser boundary, not protection against someone reusing a public search key. Product text renders with textContent, not arbitrary HTML.

## Validation

`npm test` covers tenant isolation, search-only permission boundaries, CORS, query filters, pagination, batch atomicity, upserts, deletions, malformed filters and request limits.

## Current boundaries and next work

This is a development MVP, not a production multi-tenant SaaS. It listens on loopback by default. It has merchant login, hashed API keys and per-store in-process rate limits, but no email verification, password reset, key rotation, distributed quotas, billing, audit logs or automated backups. Search scans each store's catalog in memory; benchmark and move retrieval into a dedicated hybrid search index before large catalogs. Catalog GET currently caps at 1,000 rows. External AI is opt-in through server environment configuration. No customer/order data is required.

Next: representative live query evaluation; production storage and queue/indexing workers; merchant authentication and credential rotation; cloud deployment with TLS, backup/restore and operational monitoring. The existing marketing page remains separate and has not been connected to this local backend.
