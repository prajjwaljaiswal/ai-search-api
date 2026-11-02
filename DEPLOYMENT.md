# VPS deployment

This application requires a persistent Node.js process and SQLite storage. It cannot be deployed unchanged into the marketing page's static/Worker hosting. Use a separate Linux VPS with Docker Engine and Compose, a DNS record and ports 80/443 reachable. The marketing page can remain on its existing host.

## Prepare

1. Choose a backend hostname, such as `api.yourdomain.com`. Point its A record to the VPS IPv4 address. Only add an AAAA record if IPv6 is correctly routed. Caddy provisions HTTPS after DNS resolves and the ports are reachable.
2. Copy this application source to the VPS. Exclude `.env`, `data/`, `.git/`, `node_modules/` and local logs. Never upload the development admin key inadvertently. Keep SSH credentials outside the application.
3. On the VPS, create a private `.env` file next to `compose.yaml` with:

```env
CODEHENCE_DOMAIN=api.yourdomain.com
CODEHENCE_ADMIN_KEY=REPLACE_WITH_A_RANDOM_SECRET_OF_AT_LEAST_32_BYTES
OPENAI_API_KEY=
CODEHENCE_EMBEDDING_MODEL=text-embedding-3-small
```

Generate the admin secret using `openssl rand -hex 32`. Apply `chmod 600 .env`. Add an OpenAI API key only when you want semantic indexing; products and queries will then be sent to that provider. `.env` is excluded from source and the Docker build context.

## Launch and verify

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
curl --fail https://api.yourdomain.com/health
```

Open the HTTPS dashboard, create a merchant account, create a store with the storefront's exact allowed origin, import products and verify search. Generate the widget snippet at this HTTPS origin. Test both allowed and disallowed website origins. Confirm the session cookie has HttpOnly, Secure and SameSite=Strict flags. No raw app port is published; only Caddy exposes 80/443.

The `catalog` named volume persists accounts, sessions, products and embeddings across image updates. Never run `docker compose down -v` against live data. Back up the SQLite database consistently (SQLite backup API or a maintenance window with the app stopped), encrypt backups, store them off-host, and test restore before launch. Local development data is not migrated automatically. Existing local stores can be re-imported on the VPS, or migrated with a deliberate database backup/restore process.

## Update

Upload changed source, preserve `.env` and Docker volumes, then run `docker compose up -d --build`. Verify health and sign-in. Keep the previous image/source and a pre-migration database backup for rollback.

## Pilot boundaries

This is for a controlled pilot. Email ownership verification, password reset, MFA, account deletion, private-key rotation, billing, distributed quotas and dedicated indexing workers remain unimplemented. Registration is open when hosted. Rate limits use the direct socket address; behind Caddy this currently shares the sign-in bucket across visitors. Add a deliberate trusted-proxy policy before tuning per-client limits. Embedding calls time out and search falls back to lexical retrieval; live model relevance/cost still requires evaluation. Docker image builds and certificate issuance have not been verified on this development machine because Docker is not installed.
