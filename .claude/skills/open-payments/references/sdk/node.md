# Open Payments Node SDK (test network only)

Package `@interledger/open-payments` **7.4.0** (`open-payments-node/packages/open-payments/package.json`). Docs status for TypeScript/NodeJS: **Done** (`open-payments/docs/src/content/docs/sdk/before-you-begin.mdx`). Repo engines: Node **24**, pnpm **11.24.0** (monorepo only). Use **wallet.interledger-test.dev** only. Snippets use placeholders (`WALLET_ADDRESS`, `CLIENT_WALLET_ADDRESS`); they do not hardcode that host.

## Status & version

- Published client: `npm install @interledger/open-payments` → 7.4.0.
- Runtime deps: `@interledger/http-signature-utils` workspace 2.0.3, `@interledger/openapi` workspace 2.0.4, `ky`, `http-message-signatures`, `pino`.
- Public exports (`packages/open-payments/src/index.ts`): `createAuthenticatedClient`, `createUnauthenticatedClient`, `AuthenticatedClient`, `UnauthenticatedClient`, `OpenPaymentsClientError`, grant guards `isPendingGrant`, `isFinalizedGrant` (**deprecated**), `isFinalizedGrantWithAccessToken`, `isFinalizedGrantWithSubject`, plus resource types and test mocks.

## Install

```sh
npm install @interledger/open-payments
```

Docs init (`partials/_ts-init-config.mdx`): `"type": "module"` in `package.json`; `tsconfig` `target`/`module` `ES2022`. Run snippets with `tsx path/to/directory/index.ts`.

## Credentials

Test wallet (`sdk/before-you-begin.mdx`): create account at https://wallet.interledger-test.dev, fund with play money, add a wallet address, **Settings → Developer Keys → Generate public & private key**. Browser downloads `private.key`. The UI shows the **key ID**.

Authenticated client (`packages/open-payments/README.md` + `src/client/index.ts`):

| Field | Meaning |
| --- | --- |
| `walletAddressUrl` | Client identity. Public JWK MUST be at `{walletAddressUrl}/jwks.json`. Sent as GNAP `client` on `grant.request` (override with 3rd arg `{ jwk }`). |
| `keyId` | Kid of that key. |
| `privateKey` | Ed25519 key: PEM **path** (relative to `process.cwd()` or absolute), PEM/key **string**, `Buffer`, or `crypto.KeyObject`. |

Load order in private `parseKey` (`src/client/index.ts`): `KeyObject` as-is → `Buffer` via `createPrivateKey` → if `path.resolve(cwd, string)` exists, `@interledger/http-signature-utils` `loadKey` (file must be Ed25519 PEM) → else `createPrivateKey(string)`. Failure throws `OpenPaymentsClientError` message `Could not load private key when creating authenticated client`.

Helper keygen (not the test-wallet flow): `generateKey` / `loadKey` / `loadOrGenerateKey` in `packages/http-signature-utils/src/utils/key.ts`.

## Clients

```ts
import { createUnauthenticatedClient, createAuthenticatedClient } from '@interledger/open-payments'

const publicClient = await createUnauthenticatedClient()
// README calls with no args. Implementation `createUnauthenticatedDeps` defaults to {}.
// Exported param type is required `CreateUnauthenticatedClientArgs` (all fields optional).

const client = await createAuthenticatedClient({
  walletAddressUrl: CLIENT_WALLET_ADDRESS, // docs snippets
  privateKey: PRIVATE_KEY_PATH,            // path or key material
  keyId: KEY_ID,
  // optional: requestTimeoutMs (default 5000), logger, logLevel (default silent),
  // validateResponses (default true), useHttp (dev only)
})
```

`UnauthenticatedClient`: `walletAddress`, `incomingPayment` (public only: `getPublic` in README error sample).

`AuthenticatedClient` adds `grant`, `token`, `quote`, full `incomingPayment`, `outgoingPayment`.

Experimental: `authenticatedRequestInterceptor` instead of `privateKey`/`keyId`. Both together throws `OpenPaymentsClientError` (`Invalid arguments when creating authenticated client.`).

## One-time payment

Receiver wallet vs sender wallet are different `walletAddress.get` calls. Grants go to that wallet’s `authServer`; creates go to `resourceServer`. Non-interactive incoming/quote grants return an access token immediately; outgoing is interactive.

**1. Wallet**

```ts
const walletAddress = await client.walletAddress.get({ url: WALLET_ADDRESS })
// walletAddress.authServer, .resourceServer, .id
```

`sdk/wallet-get-info.mdx`. Public; unauthenticated client allowed.

**2. Incoming-payment grant (non-interactive)** — `sdk/grant-create-incoming.mdx`

```ts
import { isFinalizedGrantWithAccessToken } from '@interledger/open-payments'

const grant = await client.grant.request(
  { url: walletAddress.authServer },
  {
    access_token: {
      access: [{
        type: 'incoming-payment',
        actions: ['list', 'read', 'read-all', 'complete', 'create']
      }]
    }
  }
)
if (!isFinalizedGrantWithAccessToken(grant)) throw new Error('Expected finalized grant')
// grant.access_token.value
```

README example uses only `actions: ['read', 'create']` on the **merchant** `authServer` (`packages/open-payments/README.md`).

**3. Create incoming payment** — `sdk/incoming-create.mdx`

```ts
const incomingPayment = await client.incomingPayment.create(
  { url: walletAddress.resourceServer, accessToken: INCOMING_PAYMENT_ACCESS_TOKEN },
  {
    walletAddress: WALLET_ADDRESS,
    incomingAmount: { value: '1000', assetCode: 'USD', assetScale: 2 },
    expiresAt: new Date(Date.now() + 60_000 * 10).toISOString()
  }
)
// incomingPayment.id
```

README uses `value: '5000'` ($50 at scale 2) plus `metadata.externalRef` / `description`, and `walletAddress: shoeShopWalletAddress.id`.

**4. Quote grant + quote** — `sdk/grant-create-quote.mdx`, `sdk/quote-create.mdx`

```ts
const quoteGrant = await client.grant.request(
  { url: walletAddress.authServer }, // sender (customer) auth server
  { access_token: { access: [{ type: 'quote', actions: ['create', 'read', 'read-all'] }] } }
)
if (!isFinalizedGrantWithAccessToken(quoteGrant)) throw new Error('Expected finalized grant')

const quote = await client.quote.create(
  { url: walletAddress.resourceServer, accessToken: QUOTE_ACCESS_TOKEN },
  { method: 'ilp', walletAddress: WALLET_ADDRESS, receiver: INCOMING_PAYMENT_URL }
)
// quote.id, quote.debitAmount
```

**5. Interactive outgoing-payment grant** — `sdk/grant-create-outgoing.mdx`

```ts
import { isPendingGrant } from '@interledger/open-payments'

const grant = await client.grant.request(
  { url: walletAddress.authServer },
  {
    access_token: {
      access: [{
        identifier: walletAddress.id,
        type: 'outgoing-payment',
        actions: ['list', 'list-all', 'read', 'read-all', 'create'],
        limits: {
          debitAmount: {
            assetCode: quote.debitAmount.assetCode,
            assetScale: quote.debitAmount.assetScale,
            value: quote.debitAmount.value
          }
        }
      }]
    },
    interact: {
      start: ['redirect'],
      finish: { method: 'redirect', uri: 'http://localhost:3344', nonce: NONCE }
    }
  }
)
if (!isPendingGrant(grant)) throw new Error('Expected pending/interactive grant')
// Send the user to grant.interact.redirect
// grant.continue.access_token.value, grant.continue.uri
```

README finish URI is `https://online-marketplace.com/complete-payment` and `nonce: uuid()`. Response shape in README includes `interact.redirect`, `interact.finish`, `continue.uri`, `continue.access_token.value`, `continue.wait`.

**6. `interact_ref` after redirect**

README: after consent the IdP redirects to `finish.uri` **with `interact_ref` in the URL**. No SDK helper parses the query. Callers read it themselves (`INTERACT_REF_FROM_URL` / `interactRef`). VERIFIED on testnet: the redirect query has exactly `hash` and `interact_ref`; parse with `new URL(req.url, FINISH_URI).searchParams`.

**7. Continue** — `sdk/grant-continue.mdx`

```ts
const continued = await client.grant.continue(
  { accessToken: CONTINUE_ACCESS_TOKEN, url: CONTINUE_URI },
  { interact_ref: interactRef }
)
if (!isFinalizedGrantWithAccessToken(continued)) throw new Error('Expected finalized grant')
// continued.access_token.value  → outgoing payment token
```

**8. Create outgoing payment** — `sdk/outgoing-create.mdx`

```ts
const outgoingPayment = await client.outgoingPayment.create(
  { url: walletAddress.resourceServer, accessToken: OUTGOING_PAYMENT_ACCESS_TOKEN },
  { walletAddress: WALLET_ADDRESS, quoteId: QUOTE_URL }
)
```

**9. Get / list** — `sdk/outgoing-get.mdx`, `sdk/outgoing-list.mdx`

```ts
const one = await client.outgoingPayment.get({
  url: OUTGOING_PAYMENT_URL,
  accessToken: OUTGOING_PAYMENT_ACCESS_TOKEN
})

const outgoingPayments = await client.outgoingPayment.list(
  {
    url: walletAddress.resourceServer,
    walletAddress: WALLET_ADDRESS,
    accessToken: OUTGOING_PAYMENT_ACCESS_TOKEN
  },
  { first: 10, last: undefined, cursor: undefined, 'wallet-address': WALLET_ADDRESS }
)
```

## Recurring grant (interval limits)

Same interactive `grant.request`, plus `limits.interval` (`sdk/grant-create-outgoing.mdx`):

```ts
limits: {
  debitAmount: { assetCode: quote.debitAmount.assetCode, assetScale: quote.debitAmount.assetScale, value: quote.debitAmount.value },
  interval: 'R/2016-08-24T08:00:00Z/P1D'
}
```

Guide partial `partials/code/guides/recurring-subscription-incoming-amount/_grant-request-outgoing-payment.mdx` uses `actions: ['create', 'read']` and `interval: 'R12/2025-10-14T00:03:00Z/P1M'` with a fixed `debitAmount` (`value: '1500'`, USD, scale 2), then `isPendingGrant`. Client rejects a grant that sets **both** `debitAmount` and `receiveAmount` (`src/client/grant.ts`). `sdk/outgoing-grant-spent-amounts.mdx`: spent amounts for an interval grant are the **current interval only**.

## Token rotate / revoke, grant cancel

Access tokens last **10 minutes** by default, including rotated tokens (`sdk/token-rotate.mdx`). `MANAGE_URL` is the token management URL (`token.access_token.manage` after rotate).

```ts
const token = await client.token.rotate({ url: MANAGE_URL, accessToken: ACCESS_TOKEN })
// token.access_token.value, token.access_token.manage

await client.token.revoke({ url: MANAGE_URL, accessToken: ACCESS_TOKEN })

await client.grant.cancel({ accessToken: CONTINUE_ACCESS_TOKEN, url: CONTINUE_URI })
```

`grant.cancel` is DELETE on the **continue** URI (`sdk/grant-revoke.mdx`): grant is finalized; no further updates. `token.revoke` invalidates that access token (`sdk/token-revoke.mdx`). HTTP: rotate POST `/token/{id}`, revoke DELETE `/token/{id}`, cancel DELETE `/continue/{id}` (`src/client/token.ts`, `src/client/grant.ts`).

## Error handling

Only client error class: `OpenPaymentsClientError` (`src/client/error.ts`). `name` is `OpenPaymentsClientError`. Fields: `message`, `description` (required), `status`, `code`, `validationErrors`, `details`.

```ts
import { OpenPaymentsClientError } from '@interledger/open-payments'
try {
  await client.incomingPayment.getPublic({ url: '...' })
} catch (error) {
  if (error instanceof OpenPaymentsClientError) {
    error.message; error.description; error.status; error.code
    error.validationErrors; error.details
  }
}
```

Guards (`src/types.ts`):

- `isPendingGrant(grant)` — true if `.interact` is set (`PendingGrant`).
- `isFinalizedGrantWithAccessToken(grant)` — true if `.access_token` is set.
- `isFinalizedGrantWithSubject(grant)` — true if `.subject` is set (subject grants may have no access token).
- `isFinalizedGrant` — **deprecated**; same check as access-token guard. CHANGELOG: prefer the two specific guards.

`grant.request` without `access_token` or `subject` throws `OpenPaymentsClientError` `Invalid Grant Request`.

## Gotchas

- `grant.request` injects `client: walletAddressUrl` unless you pass `{ jwk }`.
- Outgoing limits: only one of `debitAmount` or `receiveAmount`.
- `identifier` is required on outgoing-payment access in the docs snippets (wallet `id`).
- Interactive grants are pending (`isPendingGrant`); do not read `access_token` until `grant.continue` and `isFinalizedGrantWithAccessToken`.
- Continue uses the **continuation** token (`grant.continue.access_token.value`) and `grant.continue.uri`, not the eventual payment token.
- `privateKey` path is resolved from `process.cwd()`, not from the file that imports the client.
- README unauthenticated sample calls `client.walletAddress.get` with an incoming-payment URL; the error sample correctly uses `incomingPayment.getPublic`. Treat the first as a doc bug.
- `validateResponses` defaults **true**. Bad responses throw `OpenPaymentsClientError` with `validationErrors`.
- `useHttp: true` forces HTTP. Test wallet is HTTPS. **UNVERIFIED:** any official testnet base URL other than the wallet host in `before-you-begin.mdx`.
- Quote `method` in these snippets is only `'ilp'`.
- Amount `value` is a **string** in minor units (`assetScale: 2` → `'1000'` = 10.00).
