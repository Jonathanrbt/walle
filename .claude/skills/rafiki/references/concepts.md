# Rafiki concepts

Study copy `68c11dc` (2026-10-14). Ignore docs under `v1-beta/` and `es/`.

## What it is / is not

Rafiki is open-source software an account servicing entity (ASE) or financial service provider runs so its accounts can send and receive Interledger payments and expose Open Payments. License Apache-2.0 (`package.json`).

It includes an ILP connector, accounting (TigerBeetle or Postgres), a GraphQL Admin API, Open Payments resource routes, an SPSP endpoint, and a reference GNAP auth server (`README.md`).

It is **not** the Interledger test wallet. The Local Playground mock ASE "is not designed to serve as a reference architecture"; the docs point at the Test Wallet for that (rafiki-docs: `integration/playground/overview.mdx`). Rafiki "should not be used in production by non-regulated entities" (`README.md`). It does not store end-user balances; it tracks liquidity on asset, peer, and payment accounts (rafiki-docs: `integration/requirements/webhook-events.mdx`).

The ASE (what this team would write) owns the customer ledger, the webhook receiver, liquidity decisions, and the consent UI.

## ASE, operator, tenant

An ASE / FSP holds customer payment accounts. In Rafiki's model the **operator** runs the shared instance (creates tenants, owns the wallet-address domain, peers, infra). A **tenant** is an FSP on that instance: it creates wallet addresses, sends and receives, and sets its webhook URL and rates URL (rafiki-docs: `overview/concepts/multi-tenancy.mdx`). You still create a tenant when you are the only FSP (rafiki-docs: `integration/overview.mdx`).

## Packages

| Package | Role | Source |
|---------|------|--------|
| `backend` | Open Payments resource server, ILP connector, Backend Admin GraphQL, SPSP/STREAM | `packages/backend/README.md` |
| `auth` | GNAP authorization server for Open Payments grants | `packages/auth/README.md` |
| `frontend` | Rafiki Admin (Remix) over the Backend Admin API. Kratos is for **admin users only**, not Open Payments consent | `packages/frontend/README.md` |
| `token-introspection` | GNAP token-introspection client used by the resource server. No ASE work if you use Rafiki `auth` | `packages/token-introspection/README.md` |
| `documentation` | Starlight site behind rafiki.dev | `packages/documentation/README.md` |
| `mock-account-service-lib` | Shared seed/GraphQL helpers for mock ASEs. Not a production ASE | `packages/mock-account-service-lib/README.md` |
| `card-service` | Card payment service in the monorepo (Cloud Nine compose runs it) | `packages/card-service/README.md` (title only) |
| `point-of-sale` | POS service with its own GraphQL and webhook handlers | `packages/point-of-sale/src/index.ts` |

`pnpm-workspace.yaml` also includes `localenv/mock-account-servicing-entity` (the Remix mock ASE).

## Data stores

| Store | Why |
|-------|-----|
| Postgres (`backend`) | Open Payments resources, tenants, application data |
| Postgres (`auth`) | Grants, access tokens, interactions |
| Redis (`auth`) | Interaction sessions |
| Redis (`backend`) | STREAM connection details shared across processes |
| TigerBeetle **or** Postgres | Accounting balances. TigerBeetle is the recommended ledger; Postgres is the switchable alternative |

(rafiki-docs: `resources/architecture.mdx`, `overview/concepts/accounting.mdx`). `USE_TIGERBEETLE` defaults to `false` (rafiki-docs: `partials/_backend-variables.mdx`). Happy Life Bank always uses Postgres accounting even when Cloud Nine uses TigerBeetle (rafiki-docs: `integration/playground/overview.mdx`).

## How one payment moves

Same-instance (rafiki-docs: `integration/overview.mdx`):

1. ASE or a client creates an incoming payment on the receiver wallet (`createIncomingPayment`, or Open Payments `POST /incoming-payments`).
2. Quote on the sender wallet (`createQuote` or `POST /quotes`). Rafiki rate-probes ILP. Cross-currency needs the ASE rates endpoint.
3. Outgoing payment (`createOutgoingPayment` or `POST /outgoing-payments`). State starts waiting for liquidity.
4. Webhook `outgoing_payment.created`. ASE holds the user's funds and calls `depositOutgoingPaymentLiquidity`.
5. Backend streams ILP packets to the receiver (directly, or via a peer). Packets update TigerBeetle or Postgres liquidity, not the user ledger.
6. Webhook `outgoing_payment.completed` / `incoming_payment.completed`. ASE withdraws Rafiki liquidity and posts the user ledger.

A remote receiver adds a peer hop: sender connector → peer HTTP endpoint (`CreatePeerInput.http.outgoing.endpoint`) → receiver connector. No shared peer means the payment cannot route (rafiki-docs: `overview/concepts/interledger.mdx`).

## Protocols

| Name | Role here |
|------|-----------|
| ILP | Packet request/response. Each packet is a conditional IOU that moves liquidity (rafiki-docs: `overview/concepts/interledger.mdx`) |
| STREAM | Transport inside ILP `data`: auth, encryption, path exchange rate. Backend connector sends and receives it |
| SPSP | `GET` a payment pointer with `Accept: application/spsp4+json` returns `destination_account` + `shared_secret`. On when `ENABLE_SPSP_PAYMENT_POINTERS` (default `true`) |
| Open Payments | Client API on the backend resource server: wallet address, incoming payments, quotes, outgoing payments |
| GNAP | Grant negotiation. Rafiki `auth` is a reference authorization server. Interactive grants need your IdP |

## Peering HTTP

`CreatePeerInput.http.outgoing` needs the peer connector URL and an `authToken` you will send. `http.incoming.authTokens` is the list you accept. Local seeds use tokens such as `cloud-nine-to-happy` / `happy-to-cloud-nine` (`localenv/cloud-nine-wallet/seed.yml`). Those strings are playground shared secrets, not production credentials. ILP address and routes in that file must stay aligned or packets for the other ASE are marked unreachable (`test.unreachable.global-bank` is the seed's way of saying "do not route here" when Global Bank is not in the compose).

## Multi-tenancy and telemetry

One backend can serve many tenants. Operators create tenants; only operators can. Tenant settings keys are `EXCHANGE_RATES_URL`, `WEBHOOK_URL`, `WEBHOOK_TIMEOUT`, `WEBHOOK_MAX_RETRY`, `WALLET_ADDRESS_URL`, `ILP_ADDRESS` (rafiki: `packages/backend/src/graphql/schema.graphql` enum `TenantSettingKey`).

`ENABLE_TELEMETRY` defaults `false` in the env table, but Cloud Nine's compose sets `ENABLE_TELEMETRY: true` (rafiki: `localenv/cloud-nine-wallet/docker-compose.yml`). The telemetry overlay adds Prometheus `:9090`, Tempo `:3200`, Grafana `:4500` (rafiki: `localenv/telemetry/docker-compose.yml`). Privacy notes: rafiki-docs: `overview/concepts/telemetry.mdx`.

## Ports (Cloud Nine, host)

| Service | URL |
|---------|-----|
| Mock ASE UI | `http://localhost:3030` |
| Open Payments | `http://localhost:3000` |
| Backend Admin GraphQL | `http://localhost:3001/graphql` |
| ILP connector | host `:3002` → container `3002` |
| Auth Admin GraphQL | `http://localhost:3003/graphql` |
| Open Payments auth | `http://localhost:3006` |
| Interaction | host `:3009` |
| Rafiki Admin | `http://localhost:3010` |
| Postgres | `localhost:5432` |
| Redis | compose network only (`redis:7`), no host port |

Happy Life: UI `:3031`, OP `:4000`, Admin `:4001`, auth `:4006`, Admin UI `:4010`. Kratos (`:4433`) and Mail Slurper (`:4436`) are off unless `localenv:compose:adminauth` (rafiki: `localenv/README.md`, `localenv/cloud-nine-wallet/docker-compose.yml`).

Seeded wallet URLs use `OPEN_PAYMENTS_URL`, default `https://cloud-nine-wallet-backend`, so a seeded address looks like `https://cloud-nine-wallet-backend/accounts/gfranklin` (rafiki: `bruno/collections/Rafiki/environments/Local Playground.bru`). The playground doc also shows `http://localhost:3000/accounts/gfranklin` for an SPSP `GET` from the host (rafiki-docs: `integration/playground/overview.mdx`).

## Glossary

| Term | Meaning |
|------|---------|
| Asset | `code` + `scale`. USD scale 2: value `1000` is $10.00 (rafiki-docs: `resources/glossary.mdx`) |
| Peer | Counterparty node. Rafiki holds a liquidity account per peer. Peers exchange ILP over HTTP (`http.outgoing.endpoint` + `authToken`) |
| Wallet address | Public URL of an Open Payments account. Case-insensitive |
| Payment pointer | `$host/path` shorthand for that HTTPS URL. Also an SPSP endpoint |
| Liquidity | Balance Rafiki will move for an asset, a peer, or a payment. Not the user's bank balance |
| Two-phase transfer | Withdrawal with timeout `> 0`: `pending`, then `postLiquidityWithdrawal`, `voidLiquidityWithdrawal`, or expiry (rafiki-docs: `admin/liquidity/two-phase-transfers.mdx`) |
| Sending fee | Fixed minor units + basis points (1 bp = 0.01%) added on top of the quote via `setFee` type `SENDING` (rafiki-docs: `integration/requirements/sending-fees.mdx`) |
| Receiving fee | Same fee model on the asset (`receivingFee` on type `Asset`) |
| Operator vs tenant | Operator creates tenants and owns the domain. Tenant manages its own wallet addresses and webhook URL. Both can be the same party |

## Accounting shape

TigerBeetle stores balances only, not ILP packet metadata. Docs map Rafiki liquidity accounts and settlement accounts onto TigerBeetle credits and debits (rafiki-docs: `overview/concepts/accounting.mdx`). Postgres accounting is the supported alternative when `USE_TIGERBEETLE=false`. Two-phase withdrawals (timeout `> 0`) sit in `pending` until `postLiquidityWithdrawal`, `voidLiquidityWithdrawal`, or the timeout returns the funds (rafiki-docs: `admin/liquidity/two-phase-transfers.mdx`). Default TigerBeetle two-phase timeout is `TIGERBEETLE_TWO_PHASE_TIMEOUT_SECONDS` `5`.

User-visible balances stay in the ASE. The mock ledger is `mock-account-service-lib` (`credit` on seed). That library is a demo, not an API you should wrap in production.

FSP obligations (KYC, safeguarding, who may run this in production) are out of scope for the hackathon and live in rafiki-docs: `overview/concepts/financial-service-provider.mdx`. The README line to remember: regulated providers only, not production for everyone else.
| Exchange rate | ASE `GET` endpoint `{ "base": "USD", "rates": { "EUR": 0.91 } }`. Cached `EXCHANGE_RATES_LIFETIME` ms (default `15000`). Slippage default `0.01` |
| Quote | Sender-side cost commitment. Default life `QUOTE_LIFESPAN` `300000` ms |
| Operator tenant | Created from `OPERATOR_TENANT_ID` + `ADMIN_API_SECRET` and synced on startup (rafiki-docs: `partials/_backend-variables.mdx`) |
