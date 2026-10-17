# Backend and Auth Admin GraphQL

Schema: `packages/backend/src/graphql/schema.graphql` and `packages/auth/src/graphql/schema.graphql`. Requests must be private to the ASE (rafiki-docs: `apis/graphql/admin-api-overview.mdx`).

## Endpoints (Local Playground)

| API | Cloud Nine | Happy Life |
|-----|------------|------------|
| Backend Admin | `http://localhost:3001/graphql` | `http://localhost:4001/graphql` |
| Auth Admin | `http://localhost:3003/graphql` | `http://localhost:4003/graphql` |

Apollo is enabled on those URLs in the playground (rafiki-docs: `integration/playground/overview.mdx`). Defaults if you run a service yourself: backend `ADMIN_PORT` `3001`, auth `ADMIN_PORT` `3003` (rafiki-docs: `partials/_backend-variables.mdx`, `partials/_auth-variables.mdx`).

## Auth: HMAC, not a bearer token

Every Backend Admin request needs headers `signature` and `tenant-id` (rafiki-docs: `apis/graphql/signing-admin-api-requests.mdx`, `partials/_tenant-id-hmac-note.mdx`).

Verifier (rafiki: `packages/backend/src/shared/utils.ts`):

1. Read `tenant-id`, load that tenant, reject unknown ids.
2. Reject if `Date.now() - timestamp > ADMIN_API_SIGNATURE_TTL_SECONDS * 1000` (default TTL **30 seconds**).
3. Reject replays: Redis key `signature:${signature}` for that same TTL.
4. HMAC-SHA256 hex over `` `${timestamp}.${canonicalize(body)}` `` using the **tenant** `apiSecret`. Version must equal `ADMIN_API_SIGNATURE_VERSION` (default `1`).
5. `isOperator` when `tenant.apiSecret === ADMIN_API_SECRET`.

`canonicalize` is the `json-canonicalize` package (docs example and `packages/backend/src/tests/apiSignature.ts`).

The docs prose says the timestamp is "UNIX seconds", then shows `Date.now()`. The code compares `Date.now()` to the header as milliseconds. **Use milliseconds.**

```js
import { createHmac } from 'node:crypto'
import { canonicalize } from 'json-canonicalize'

export function adminSignature(secret, version, body) {
  const timestamp = Date.now()
  const payload = `${timestamp}.${canonicalize(body)}`
  const digest = createHmac('sha256', secret).update(payload).digest('hex')
  return {
    signature: `t=${timestamp}, v${version}=${digest}`,
    'tenant-id': process.env.OPERATOR_TENANT_ID
  }
}
```

`body` is the JSON object `{ query, variables, operationName }` actually sent. Sign those bytes, not a pretty-printed variant. Secret and tenant id come from env, never from the hackathon repo. Local values live in `localenv/cloud-nine-wallet/docker-compose.yml` (`ADMIN_API_SECRET`, `OPERATOR_TENANT_ID`).

Auth Admin uses the same header scheme (`ADMIN_API_SIGNATURE_TTL_SECONDS` default `30` on auth too).

Idempotency: mutations that take `idempotencyKey` store the response for `GRAPHQL_IDEMPOTENCY_KEY_TTL_MS` (default `86400000`). A second call with the same key returns the first response. A concurrent duplicate inside `GRAPHQL_IDEMPOTENCY_KEY_LOCK_MS` (default `2000`) errors (rafiki-docs: `apis/graphql/admin-api-overview.mdx`).

## Bootstrap a fresh instance

Operator tenant is synced on startup from `OPERATOR_TENANT_ID` + `ADMIN_API_SECRET` (rafiki-docs: `partials/_backend-variables.mdx`). Required integration order (rafiki-docs: `integration/overview.mdx`):

1. Tenant exists (the operator, or `createTenant` for another FSP).
2. `createAsset` (at least one).
3. `createWalletAddress` (needs an asset).
4. Webhook URL (`WEBHOOK_URL` or tenant setting `WEBHOOK_URL`).

Then, before cross-ASE payments: `createPeer`, deposit asset and peer liquidity, `createWalletAddressKey` so Open Payments clients can sign. The Local Playground seed does steps 2–3 and peering for you.

## Operations

Amounts in Admin GraphQL are `UInt64` minor units (`AmountInput.value`), not the Open Payments string `value`.

### createAsset

```graphql
mutation CreateAsset($input: CreateAssetInput!) {
  createAsset(input: $input) { asset { id code scale } }
}
```

```json
{ "input": { "code": "USD", "scale": 2, "liquidityThreshold": "1000000", "idempotencyKey": "<uuid>" } }
```

`CreateAssetInput`: `code`, `scale` required; optional `withdrawalThreshold`, `liquidityThreshold`, `idempotencyKey`, `tenantId`.

### depositAssetLiquidity / depositPeerLiquidity

Both require `amount`, `id` (transfer id), and `idempotencyKey` (`String!`). Asset uses `assetId`; peer uses `peerId`.

```graphql
mutation DepositAsset($input: DepositAssetLiquidityInput!) {
  depositAssetLiquidity(input: $input) { success }
}
```

### createPeer

Required: `http.outgoing.authToken`, `http.outgoing.endpoint`, `assetId`, `staticIlpAddress`. Optional: `name`, `maxPacketAmount`, `initialLiquidity`, `liquidityThreshold`, `routes`, `http.incoming.authTokens`.

### createWalletAddress

Required: `assetId`, `address` (URL). Optional: `publicName`, `tenantId`, `idempotencyKey`, `additionalProperties: [{ key, value, visibleInOpenPayments }]`.

`publicName` is visible to anyone who fetches the wallet address URL.

### createWalletAddressKey

```graphql
mutation AddKey($input: CreateWalletAddressKeyInput!) {
  createWalletAddressKey(input: $input) { walletAddressKey { id } }
}
```

`jwk` allows only `alg: EdDSA`, `kty: OKP`, `crv: Ed25519`, plus `kid` and base64url `x` (`JwkInput`). Revoke with `revokeWalletAddressKey(id)`.

### Incoming, quote, outgoing (admin, no GNAP)

```graphql
mutation CreateIncoming($input: CreateIncomingPaymentInput!) {
  createIncomingPayment(input: $input) { payment { id } }
}
```

`CreateIncomingPaymentInput` requires `walletAddressId`. Optional `expiresAt`, `incomingAmount`, `metadata`, `idempotencyKey`.

`CreateQuoteInput` requires `walletAddressId` and `receiver` (wallet address URL). Provide `debitAmount` and/or `receiveAmount`.

`CreateOutgoingPaymentInput` requires `walletAddressId` and `quoteId`. This starts the payment; the ASE must still fund it on `outgoing_payment.created` (`depositOutgoingPaymentLiquidity`). Cancel with `cancelOutgoingPayment`.

### Webhook event list

```graphql
query Events($first: Int) {
  webhookEvents(first: $first) {
    edges { node { id type data createdAt } }
  }
}
```

Filter: `WebhookEventFilter.type.in` / `notIn`.

### Tenants

```graphql
mutation CreateTenant($input: CreateTenantInput!) {
  createTenant(input: $input) { tenant { id } }
}
```

`apiSecret` is required. Optional `id` (UUID v4), `email`, `idpConsentUrl`, `idpSecret`, `publicName`, `settings`. Settings use `TenantSettingInput` (`key: TenantSettingKey`, `value`). Operator-only create (rafiki-docs: `overview/concepts/multi-tenancy.mdx`).

### Auth Admin: grants

`grant(id)`, `grants(filter)`, and `revokeGrant(input: { grantId })` (rafiki: `packages/auth/src/graphql/schema.graphql`). Same signing headers against the auth Admin URL.

### Fees

`setFee` with `type: SENDING` or the receiving equivalent, `fee.fixed` (`UInt64`) and `fee.basisPoints` (`0..10000`). Example in rafiki-docs: `integration/requirements/sending-fees.mdx`.
