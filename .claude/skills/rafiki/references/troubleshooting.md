# Troubleshooting

Causes below are from docs, compose, or `packages/backend/src/shared/utils.ts` unless marked **UNVERIFIED**. This skill did not boot the stack.

## Port already in use

Playground publishes 3000–3003, 3006, 3009–3011, 3030–3031, 4000–4003, 4006, 4009–4011, 5432, and with other overlays 3032, 5000–5011, 5030, 4432–4433, 4436. `ss -ltnp` on the clash, then stop the other process or don't start a second compose project. Redis is **not** published; a host Redis on 6379 does not collide.

Two compose invocations (`localenv:compose` and `localenv:compose:psql`) share the Cloud Nine file. Running both is **UNVERIFIED** but will fight over those host ports.

## TigerBeetle exits 137

Container stops with code 137 and no useful logs. Docs: raise Docker's memory (`localenv/README.md`, link to TigerBeetle docker docs). Image is privileged (`localenv/tigerbeetle/docker-compose.yml`). With limited Docker memory use `pnpm localenv:compose:psql up` instead of `pnpm localenv:compose up`.

`TIGERBEETLE_REPLICA_ADDRESSES` must be `10.5.0.50:4342` when that overlay is on (`.env.tigerbeetle`). Empty default in the Cloud Nine compose (`TIGERBEETLE_REPLICA_ADDRESSES-''`) plus `USE_TIGERBEETLE=true` cannot reach the replica.

## Backend never becomes healthy

Healthcheck: `wget --spider http://localhost:3001/healthz`, `start_period: 60s` (`localenv/cloud-nine-wallet/docker-compose.yml`). Mock ASE waits for that. If Postgres or Redis isn't up, backend stays unhealthy and the UI never seeds. `docker compose logs` on `cloud-nine-backend` and `shared-database`.

## Wallet address not found

`GET` returns not-found and the ASE receives `wallet_address.not_found` with `data.walletAddressUrl`. You have `WALLET_ADDRESS_LOOKUP_TIMEOUT_MS` (default 1500) to `createWalletAddress`. After that the client request times out (rafiki-docs: `integration/requirements/webhook-events.mdx`).

Seeded URLs use `OPEN_PAYMENTS_URL` (`https://cloud-nine-wallet-backend/...`), not automatically `http://localhost:3000`. A client that `GET`s the wrong host will miss. Set `CLOUD_NINE_OPEN_PAYMENTS_URL` before `up` if the host should be localhost (**the variable name is in the compose `${CLOUD_NINE_OPEN_PAYMENTS_URL:-...}`**; effect on an already seeded DB is **UNVERIFIED** — reset volumes).

`skipWalletAddressCreation: true` (Happy Life `asmith`) means that account has no wallet address on purpose.

## Admin signature vs webhook signature

These are different headers. Mixing them fails both ways.

| Direction | Header | Secret env |
|-----------|--------|------------|
| You → Admin API | `signature` and `tenant-id` | tenant `apiSecret` (`ADMIN_API_SECRET` for the operator) |
| Rafiki → your webhook | `Rafiki-Signature` | `SIGNATURE_SECRET` |

Both are `t=<Date.now()>, v1=<hmac-sha256-hex>` over `` `${timestamp}.${canonicalize(json)}` ``. Webhook canonical JSON is the event `{id,type,data}` (rafiki-docs: `integration/requirements/webhook-events.mdx`). Admin canonical JSON is the GraphQL body `{query,variables,operationName}`.

## Admin signature rejected

Verifier rejects when any of these hold (`packages/backend/src/shared/utils.ts`):

| Check | Fix |
|-------|-----|
| Missing `signature` or `tenant-id` | Send both |
| Unknown tenant | Use `OPERATOR_TENANT_ID` from that instance's compose |
| Timestamp older than 30s (`ADMIN_API_SIGNATURE_TTL_SECONDS`) | `Date.now()` **milliseconds**. Docs prose says "seconds"; the code does not |
| Same `signature` header reused | New timestamp ⇒ new HMAC. Redis stores the whole header |
| Version ≠ `ADMIN_API_SIGNATURE_VERSION` (default 1) | Header form `t=<ms>, v1=<hex>` |
| Digest mismatch | HMAC-SHA256 hex of `` `${timestamp}.${canonicalize({query,variables,operationName})}` `` with the tenant `apiSecret` (`json-canonicalize`) |
| Operator secret used for a different tenant | Sign with **that** tenant's `apiSecret` |

HTTP status text for a bad signature is **UNVERIFIED** (middleware returns undefined / unauthorized; the status code is not in the snippet above).

## Not enough liquidity

`outgoing_payment.created` stays unfunded until `depositOutgoingPaymentLiquidity`. Asset or peer below threshold emits `asset.liquidity_low` / `peer.liquidity_low`; transfers then fail until `depositAssetLiquidity` / `depositPeerLiquidity` (webhook doc).

Deposits need a fresh `id` and `idempotencyKey`. Reusing a key returns the **first** response, including a failure (rafiki-docs: `apis/graphql/admin-api-overview.mdx`).

Happy Life peers set `maxPacketAmount: 10000` in `localenv/happy-life-bank/seed.yml` (minor units). A larger packet cannot use that peer. Exact error string is **UNVERIFIED**.

## Grant interaction loops

Outgoing grants always redirect to the IdP. `list-all` on incoming/quote also redirects while `LIST_ALL_ACCESS_INTERACTION` is `true` (default).

Loop if the IdP never calls `POST /grant/{id}/{nonce}/accept` then `GET .../finish`, or omits `x-idp-secret`. Interaction dies after `INTERACTION_EXPIRY_SECONDS` (600). Finish query `result=grant_invalid` means the grant was not pending (already approved or expired) (rafiki-docs: `integration/requirements/open-payments/idp.mdx`).

Kratos (`:4433`) is Admin UI login, not this redirect. If `IDENTITY_SERVER_URL` points at Kratos, consent cannot complete.

## Webhook timeouts and duplicates

Default budget is 2000 ms (`WEBHOOK_TIMEOUT`). Slow ledger work causes retries (10s, 20s, 30s, … up to `WEBHOOK_MAX_RETRY` 10). Return 200 and enqueue. Dedupe with the event `id` or you will double-credit.

If no events arrive: tenant `WEBHOOK_URL` overrides the env. Cloud Nine compose sets `WEBHOOK_URL=http://cloud-nine-wallet/webhooks` (Docker DNS to the mock ASE). Your laptop is not that hostname.

## Tenant HMAC / wrong instance

Cloud Nine tenant `438fa74a-fa7d-4317-9ced-dde32ece1787`. Happy Life `cf5fd7d3-1eb1-4041-8e43-ba45747e9e5d`. Signing Cloud Nine's secret against `:4001` fails the tenant lookup or the digest. `SEND_TENANT_WEBHOOKS_TO_OPERATOR` defaults `false`; tenant events stay on the tenant URL.

## Bruno `Cannot find module crypto`

Playground doc: if the Bruno collection throws `Error invoking remote method send-http-request` / `Cannot find module crypto`, switch Bruno from Safe Mode to Developer Mode (rafiki-docs: `integration/playground/overview.mdx`).

## Quote rejected or amount changed

Quotes live `QUOTE_LIFESPAN` ms (default `300000`, five minutes) (rafiki-docs: `partials/_backend-variables.mdx`). After that, create another quote. Cross-currency can also fail when the probed cost exceeds `SLIPPAGE` (default `0.01` = 1%) versus the quote (rafiki-docs: `integration/requirements/exchange-rates.mdx`). Rates endpoint down or wrong `base` does the same. Mock rates: `GET /rates?base=USD` on the mock ASE (`app/routes/rates.ts`).

## Submodule or build errors

Root README: Open Payments specs are a git submodule at `open-payments-specifications/`. A depth-1 clone without `git submodule update --init --recursive` will not have that tree. Localenv README repeats the same init before building the playground. Symptom of a missing submodule is **UNVERIFIED** here (likely a failed Docker build copying the specs).

## Grant or webhook "loop" on the wrong port

Cloud Nine interaction is host `:3009` (`cloud-nine-auth` publishes `3009:3009`). Happy Life publishes `4009:3009`. An IdP that calls `:3009` on the Happy Life grant will hit the other ASE. `IDENTITY_SERVER_SECRET` is per tenant; the header name is `x-idp-secret`.

## Idempotency key "succeeds" but nothing new happens

A repeated `idempotencyKey` returns the stored response for 24h (`GRAPHQL_IDEMPOTENCY_KEY_TTL_MS` default `86400000`), including an error response. A second request while the first is in flight (lock default `2000` ms, `GRAPHQL_IDEMPOTENCY_KEY_LOCK_MS`) errors instead of waiting (rafiki-docs: `apis/graphql/admin-api-overview.mdx`). Use a new UUID per logical operation, and reuse it only to retry that same operation.

## `outgoing_payment` stays at sent amount 0

Expected until the ASE handles `outgoing_payment.created` and `depositOutgoingPaymentLiquidity` returns success (rafiki-docs: `integration/requirements/webhook-events.mdx`). Also check peer liquidity and `maxPacketAmount` on the Happy Life seed (`10000` minor units). Webhook never arrived: your URL is not `http://cloud-nine-wallet/webhooks` inside the compose network.

## Clock skew on signatures

`canApiSignatureBeProcessed` subtracts the header timestamp from `Date.now()` and rejects when the difference is greater than `ADMIN_API_SIGNATURE_TTL_SECONDS * 1000` (default 30s). A timestamp in seconds (`1700000000`) looks decades old next to milliseconds and is rejected. A timestamp slightly in the future still passes that one comparison (the code only checks `current - signature > ttl`). Don't "fix" a rejection by switching the unit to seconds.

## Admin UI login when auth is on

`pnpm localenv:compose:adminauth up` enables Kratos. Forgot-password mail is Mail Slurper at `http://localhost:4436` (rafiki-docs: `integration/playground/overview.mdx`). Invitation links are single-use; Slack unfurling them burns them (`packages/frontend/README.md`). Default playground does **not** use this compose file, so `:3010` should load without a password. If it asks for one, you started the adminauth overlay.

Kratos and the Admin UI must share a top-level domain (`packages/frontend/README.md`). On localhost that is already true. Do not point `KRATOS_BROWSER_PUBLIC_URL` at a different site and expect the session cookie to stick.

`COOKIE_KEY` is required on auth (no default in the env table). The playground sets it in compose. A hand-run `pnpm --filter auth dev` without it will fail config load. The exact error string is **UNVERIFIED**; the required flag is not.

## Postgres vs TigerBeetle switch

`pnpm localenv:compose` turns TigerBeetle on via the env file. `pnpm localenv:compose:psql` does not include that file, and Cloud Nine defaults `USE_TIGERBEETLE` to false. Mixing an old TigerBeetle volume with a psql project is **UNVERIFIED**; `down --volumes` on the script you started is the clean switch. Happy Life accounting stays Postgres either way (playground overview).
