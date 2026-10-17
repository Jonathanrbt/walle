# Integrate an ASE with Rafiki

The ASE is your code. Rafiki never credits a customer account by itself (rafiki-docs: `integration/requirements/webhook-events.mdx`). Required pieces (rafiki-docs: `integration/overview.mdx`): a tenant, at least one asset, wallet addresses, and a webhook URL.

Worked example (mock, not a reference architecture):

| Piece | Path |
|-------|------|
| Remix mock ASE | `localenv/mock-account-servicing-entity/` |
| Webhook route | `localenv/mock-account-servicing-entity/app/routes/webhooks.ts` |
| Event handlers | `localenv/mock-account-servicing-entity/app/lib/webhooks.server.ts` |
| Rates | `localenv/mock-account-servicing-entity/app/routes/rates.ts` |
| Consent UI | `localenv/mock-account-servicing-entity/app/routes/mock-idp.consent.tsx` |
| Shared GraphQL calls | `packages/mock-account-service-lib/src/requesters.ts` |
| Seed | `packages/mock-account-service-lib/src/seed.ts` |

## Webhook receiver

`backend` `POST`s JSON to the tenant `WEBHOOK_URL`, or the env default if the tenant has none. It expects **HTTP 200**. Timeout default `WEBHOOK_TIMEOUT` **2000** ms. Retries up to `WEBHOOK_MAX_RETRY` (default **10**): first retry after 10s, then +20s, +30s, … (rafiki-docs: `integration/requirements/webhook-events.mdx`).

Body: `{ "id", "type", "data" }`. Dedupe on `id`.

Signature is optional. If `SIGNATURE_SECRET` is set, header `Rafiki-Signature: t=<ms>, v<version>=<hex>` with HMAC-SHA256 over `` `${timestamp}.${canonicalize(body)}` ``. Default version `1` (`SIGNATURE_VERSION`). Compare in constant time. Example in that same doc.

| `type` | What the ASE does |
|--------|-------------------|
| `incoming_payment.created` | No ledger action |
| `incoming_payment.completed` | `createIncomingPaymentWithdrawal`, then credit the user for `receivedAmount`. Two-phase: also `postLiquidityWithdrawal` |
| `incoming_payment.expired` | Same withdrawal **only if** something was received |
| `incoming_payment.partial_payment_received` | Off unless `ENABLE_PARTIAL_PAYMENT_DECISION=true`. Then approve or reject. The doc's sequence names `ConfirmPartialIncomingPayment` / `RejectPartialIncomingPayment`; those strings are **not** in `schema.graphql`. The schema has `approveIncomingPayment` and `cancelIncomingPayment` for `PENDING` incoming payments. Confirm which mutation the running build expects before coding it |
| `outgoing_payment.created` | If the user can pay: hold `debitAmount`, `depositOutgoingPaymentLiquidity`. Else `cancelOutgoingPayment` |
| `outgoing_payment.completed` | `createOutgoingPaymentWithdrawal` for leftover liquidity. Debit the user what was sent (`sentAmount`). Excess vs `debitAmount` is your fee-or-refund decision |
| `outgoing_payment.failed` | Withdraw leftover. If `sentAmount` is 0, drop the hold. If partial, debit only the sent amount. Docs say skip a sending fee on this path |
| `wallet_address.not_found` | Create the wallet address before `WALLET_ADDRESS_LOOKUP_TIMEOUT_MS` (default **1500**) |
| `wallet_address.web_monetization` | `createWalletAddressWithdrawal`, credit the user |
| `asset.liquidity_low` | `depositAssetLiquidity` or cross-currency sends fail |
| `peer.liquidity_low` | `depositPeerLiquidity` or that peer's packets fail |

Event list also in rafiki-docs: `resources/webhook-event-types.mdx`. OpenAPI: `packages/backend/src/openapi/specs/webhooks.yaml`. Bruno samples: `bruno/collections/Rafiki/Sample Webhook Events/`.

`depositOutgoingPaymentLiquidity` input is `outgoingPaymentId` + `idempotencyKey` (schema). It does not take an amount; Rafiki already knows the payment.

| Mutation | Required input | When |
|----------|----------------|------|
| `depositOutgoingPaymentLiquidity` | `outgoingPaymentId`, `idempotencyKey` | Fund `outgoing_payment.created` |
| `cancelOutgoingPayment` | `id`; optional `reason` | User cannot pay. `reason` is public on the Open Payments resource |
| `createOutgoingPaymentWithdrawal` | `outgoingPaymentId`, `idempotencyKey`, `timeoutSeconds` | Completed or failed send |
| `createIncomingPaymentWithdrawal` | `incomingPaymentId`, `idempotencyKey`, `timeoutSeconds` | Completed or expired receive |
| `createWalletAddressWithdrawal` | `walletAddressId`, `id`, `idempotencyKey`, `timeoutSeconds` | Web Monetization |
| `depositAssetLiquidity` | `assetId`, `amount`, `id`, `idempotencyKey` | Low asset liquidity |
| `depositPeerLiquidity` | `peerId`, `amount`, `id`, `idempotencyKey` | Low peer liquidity |
| `postLiquidityWithdrawal` | `withdrawalId`, `idempotencyKey` | Commit a two-phase withdraw |
| `voidLiquidityWithdrawal` | `withdrawalId`, `idempotencyKey` | Roll back a two-phase withdraw |

`timeoutSeconds: 0` is a single-phase post. Any value `> 0` leaves the withdrawal pending until `postLiquidityWithdrawal` or `voidLiquidityWithdrawal` (schema text on those inputs; rafiki-docs: `admin/liquidity/two-phase-transfers.mdx`).

Partial-payment approve/cancel, when that mode is on: `approveIncomingPayment(id)` and `cancelIncomingPayment(id, cancellationReason)` require the incoming payment to be `PENDING` (`ApproveIncomingPaymentInput`, `CancelIncomingPaymentInput`).

Mock handler dispatch lives in `webhooks.server.ts`: it branches on `WebhookEventType` from `mock-account-service-lib` (outgoing created/completed/failed, incoming completed/expired/partial, wallet-address withdrawal, `createWalletAddress`). Copy the decisions, not the file, into the team's ASE.

Reply 200 quickly and do slow ledger work on a queue, or retries pile up.

## IdP and GNAP consent

Outgoing payments need an interactive grant. Incoming and quote grants are interactive in Rafiki only when forced: `LIST_ALL_ACCESS_INTERACTION` defaults **`true`** (so `list-all` asks for consent), `INCOMING_PAYMENT_INTERACTION` and `QUOTE_INTERACTION` default **`false`** (rafiki-docs: `integration/requirements/open-payments/idp.mdx`).

Kratos is for Rafiki Admin logins. It cannot be the Open Payments IdP.

Per tenant, set `IDENTITY_SERVER_URL` (consent screen) and `IDENTITY_SERVER_SECRET`. The operator stores them via Backend Admin; auth reads them from its tenant table. Interaction port default `3009` (`INTERACTION_PORT`). Grant interaction TTL `INTERACTION_EXPIRY_SECONDS` default `600`.

| Call | Who | Header |
|------|-----|--------|
| `GET /interact/{id}/{nonce}` | OP client | public; auth redirects to `IDENTITY_SERVER_URL` |
| `GET /grant/{id}/{nonce}` | IdP | `x-idp-secret: IDENTITY_SERVER_SECRET` |
| `POST /grant/{id}/{nonce}/accept` or `/reject` | IdP | same header |
| `GET /interact/{id}/{nonce}/finish` | IdP | public; auth redirects the browser |
| `POST /interact/{id}/{nonce}` | OP client | continue grant (Open Payments, not the IdP spec) |

Finish redirect query: `result=grant_rejected`, `result=grant_invalid`, or on success `hash`, `interact_ref`, and the grant URI. Hash is SHA-256 of the client's `interact.finish.nonce` plus the auth server's `interact.finish` value. Verify that hash in your app using the `open-payments` skill, then `grant.continue` with `interact_ref`.

Mock consent screen: `app/routes/mock-idp.consent.tsx`. OpenAPI for the IdP calls: `packages/auth/src/openapi/specs/id-provider.yaml`.

## Wallet keys, grants, rates, fees, assets

- Keys: Ed25519 JWK (`kid`, `x`, `alg: EdDSA`, `kty: OKP`, `crv: Ed25519`) via `createWalletAddressKey`. Clients fetch `{walletAddress}/jwks.json`. Revoke with `revokeWalletAddressKey`. Seed helper: `generateJwk` in `packages/mock-account-service-lib/src/seed.ts`. Guide: rafiki-docs: `integration/requirements/open-payments/wallet-keys.mdx`.
- Revoke a grant your user withdrew: Auth Admin `revokeGrant({ grantId })` on `:3003/graphql` (rafiki-docs: `integration/requirements/open-payments/grants-revoking.mdx`).
- Rates: `GET EXCHANGE_RATES_URL?base=USD` → `{ "base", "rates": { "EUR": 0.91 } }`. Required env even for same-currency (**the table marks `EXCHANGE_RATES_URL` required**). Cache `EXCHANGE_RATES_LIFETIME` (15000). Slippage `SLIPPAGE` (0.01). Spec: `packages/backend/src/openapi/specs/exchange-rates.yaml`. Mock: `app/routes/rates.ts`.
- Fees: `setFee` per asset, fixed minor units + basis points. Not required for a first payment.
- Assets: one `code`+`scale` before any wallet address. Cross-currency also needs liquidity above `liquidityThreshold` or you get `asset.liquidity_low`.

## Consuming a Rafiki wallet with Open Payments

A client does not call Admin GraphQL. It uses the wallet address URL.

1. `GET` the wallet address (seeded Cloud Nine example in Bruno: `https://cloud-nine-wallet-backend/accounts/gfranklin`, or from the host `http://localhost:3000/...` if `OPEN_PAYMENTS_URL` is that origin).
2. Read `authServer` and `resourceServer` from the JSON. Do not hardcode them. Playground auth is `http://localhost:3006` (Cloud Nine) or `:4006` (Happy Life). Resource server is the Open Payments port (`:3000` / `:4000`).
3. Grants go to `authServer`. Incoming payments, quotes, and outgoing payments go to `resourceServer`.

Routes mounted by `packages/backend/src/app.ts` (under the wallet-address / tenant prefix the file registers):

| Method | Path |
|--------|------|
| `GET` | `/` (wallet address), `/jwks.json` |
| `POST`, `GET` | `/incoming-payments`, `/outgoing-payments` |
| `GET` | `/incoming-payments/{id}`, `/outgoing-payments/{id}`, `/quotes/{id}` |
| `POST` | `/quotes`, `/incoming-payments/{id}/complete` |

SPSP: `GET` the same URL with `Accept: application/spsp4+json`.

Grant bodies, limits, and the finish hash: `open-payments` skill (`references/gnap-grants.md`). Bruno walkthrough: `bruno/collections/Rafiki/Examples/Open Payments/` and rafiki-docs: `integration/playground/overview.mdx`.

Playground sequence the Bruno examples follow: `GET` sender wallet address, `GET` receiver wallet address, non-interactive incoming-payment grant, `POST /incoming-payments`, quote grant, `POST /quotes`, interactive outgoing-payment grant, browser consent, `POST /continue/{id}`, `POST /outgoing-payments`, then `GET` the outgoing payment until it settles. Same order as the `open-payments` skill. The only Rafiki-specific part is that `authServer` and `resourceServer` belong to the local ASE, and the ASE must fund liquidity when `outgoing_payment.created` fires or the `GET` stays at sent amount zero.

Wallet public key the ASE registers (`JwkInput`):

```json
{ "kid": "keyid-1", "x": "<base64url public key>", "alg": "EdDSA", "kty": "OKP", "crv": "Ed25519" }
```

Private half stays in `KEY_FILE` (`localenv/cloud-nine-wallet/private-key.pem` in the playground). Clients doing Open Payments use their own key, added with `createWalletAddressKey`, and sign per the `open-payments` skill.
