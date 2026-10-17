# Open Payments HTTP flow (testnet shapes)

Resolve hosts from the wallet address. Do not assume the example hosts below are what `GET` returns.

- Wallet address server: the wallet address URL itself. Spec examples: `https://ilp.interledger-test.dev/alice`. Ops: `get-wallet-address`, `get-wallet-address-keys`.
- Authorization server: JSON `authServer`. Spec file server: `https://auth.interledger-test.dev`. Ops in `auth-server.yaml`.
- Resource server: JSON `resourceServer`. Paths below are appended to that base. Spec file server: `https://ilp.interledger-test.dev`. Ops in `resource-server.yaml`.

**Every signed call**

- `Content-Type: application/json` when there is a JSON body.
- `Content-Digest`: required in the signature when a body is present (parameter text). Digest algorithm in the HTTP-signatures doc example is `sha-512=:…=:`. Exact digest header syntax beyond that example is the HTTP signatures doc, not a separate OpenAPI field.
- `Signature-Input`: label plus covered components. MUST include `"@method"`, `"@target-uri"`, `"authorization"`. With a body, MUST also include `"content-digest"`. `keyid` MUST equal the JWK `kid`. `alg="ed25519"`.
- `Signature`: base64 of the Ed25519 signature over the SHA-512 hash of the signature base (`identity/http-signatures.mdx`).
- `Authorization: GNAP <token>` on protected calls. Open Payments does not use bearer tokens. Initial `POST /` grant has `security: []` (no access token yet); still sign it. Continuation, cancel, rotate, and revoke use the continuation token or the token whose `manage` URI you call.

Resource-server failures: `401` (`WWW-Authenticate: GNAP as_uri=<URI>`), `403`, `404`, quote `400`. Body: `{ "error": { "code", "description", "details"? } }`.

Amounts: `{ "value": "<uint64 string>", "assetCode", "assetScale" }`. `incomingAmount.assetCode` and `assetScale` MUST match the wallet address.

## 1. GET wallet address

`GET {walletAddress}` — `wallet-address-server.yaml` `get-wallet-address`. No auth (`security: []`). Header: `Accept: application/json` (else `302` to HTML is allowed).

`200`: `id`, `publicName?`, `assetCode`, `assetScale`, `authServer`, `resourceServer`. `404` if missing.

Optional: `GET {walletAddress}/jwks.json` — `get-wallet-address-keys`. `200` `{ "keys": [ { kid, x, alg, kty, crv } ] }`.

## 2. Non-interactive incoming-payment grant

`POST {authServer}/` — `auth-server.yaml` `post-request`. `Content-Type: application/json`. Sign. No `Authorization`.

Body (`grant-request`):

- `client`: `{ "walletAddress": "<client wallet address>" }` or deprecated string URL, or directed identity `{ "jwk": { kid, alg: "EdDSA", kty: "OKP", crv: "Ed25519", x, use?: "sig" } }`.
- `access_token.access[]` (max 3 items): `{ "type": "incoming-payment", "actions": ["create","read", …], "identifier"?: "<recipient wallet address URI>" }`.
- Actions enum: `create`, `complete`, `read`, `read-all`, `list`, `list-all`. `list-all` should force interaction (`concepts/auth.mdx`). Omit `interact` for the default non-interactive grant.

`200` Approved: `access_token` (`value`, `manage`, `access`, optional `expires_in`) and `continue` (`access_token.value`, `uri`, optional `wait`). Use `access_token.value` as the resource token. `400` `invalid_request` | `invalid_client`. `401` `invalid_client`. `500` `request_denied`.

## 3. Create incoming payment

`POST {resourceServer}/incoming-payments` — `create-incoming-payment`.

Headers: `Authorization: GNAP <incoming access_token.value>`, `Content-Type`, `Content-Digest`, `Signature-Input`, `Signature`.

Body (`create-incoming-payment-request`): required `walletAddress`. Optional `incomingAmount`, `expiresAt` (date-time), `metadata` (object).

`201`: `id`, `walletAddress`, `incomingAmount?`, `receivedAmount`, `completed` (false), `expiresAt`, `createdAt`, `metadata?`, `methods[]` (`type: "ilp"`, `ilpAddress`, `sharedSecret`). `401`/`403`.

## 4. Quote grant

Same `POST {sender authServer}/` — `post-request`.

`access_token.access[]`: `{ "type": "quote", "actions": ["create","read"] }`. No `identifier` on `access-quote`. Actions: `create`, `read`, `read-all`. Non-interactive unless `list-all` (docs; `list-all` is not in the quote action enum — **UNVERIFIED** whether quote `read-all` is what the prose means). Directed identity allowed.

`200`: `access_token.value` for quote calls.

## 5. Create quote

`POST {sender resourceServer}/quotes` — `create-quote`.

Headers: GNAP quote token, digest, signatures, `Content-Type: application/json`.

Body one of:

- Incoming-amount receiver: `walletAddress`, `receiver` (incoming-payment URL; pattern `^(https|http)://(.+)/incoming-payments/(.+)$`), `method` (`"ilp"`).
- Fixed-send: those plus `debitAmount`.
- Fixed-receive: those plus `receiveAmount`.

Do not send both amounts. Omit both only when `receiver` already has `incomingAmount`.

`201` quote: `id`, `walletAddress`, `receiver`, `debitAmount`, `receiveAmount`, `method`, `createdAt`, `expiresAt`. `400` if no amount can be inferred. `401`/`403`.

## 6. Interactive outgoing-payment grant

`POST {sender authServer}/` — `post-request`. Wallet-address client (not `jwk`). Outgoing grants are interactive.

Body:

- `access_token.access[]`: `{ "type": "outgoing-payment", "actions": ["create","read"], "identifier": "<sender wallet address URI>", "limits"?: … }`. Actions: `create`, `read`, `read-all`, `list`, `list-all`. `identifier` is required on outgoing.
- `limits`: optional `receiver` (incoming-payment URL), optional `interval` (ISO 8601 repeating interval), and either `debitAmount` or `receiveAmount` (each is a maximum). All three may be omitted (`limits-outgoing-no-amount`).
- `interact.start`: `["redirect"]` only.
- `interact.finish`: `method` `"redirect"`, `uri` (your callback), `nonce` (unguessable, unique per request). All three required if `finish` is present. `start` is required on `interact`.

`200` Pending interaction: `interact.redirect` (send the user here), `interact.finish` (callback key string), `continue.access_token.value`, `continue.uri`, `continue.wait` (seconds; MUST wait before calling `uri`). No resource `access_token` until continuation.

## 7. Consent redirect

Send the user to `interact.redirect`. After consent, the AS redirects to `interact.finish.uri` with query `interact_ref` and `hash` (`identity/hash-verification.mdx`). Verify `hash` before trusting the redirect (algorithm in `gnap-grants.md`). The continuation body field is `interact_ref`.

## 8. Grant continuation

`POST {continue.uri}` which is `POST {authServer}/continue/{id}` — `post-continue`.

Headers: `Authorization: GNAP <continue.access_token.value>`, signatures. Wait at least `continue.wait` seconds after the response that issued this continuation token.

Body: `{ "interact_ref": "<value from redirect>" }` (`continuation-request`). `interact_ref` is optional in the schema; send it after an interactive finish.

`200`: `access_token` (resource token: `value`, `manage`, `expires_in?`, `access`) and required `continue`. If interaction is still pending, `access_token` is absent and `continue.wait` is set; poll after `wait`. `400` `too_fast` | `invalid_client`. `401` `invalid_client` | `invalid_continuation` | `request_denied`. `404` `invalid_continuation` | `invalid_request`.

## 9. Create outgoing payment

`POST {sender resourceServer}/outgoing-payments` — `create-outgoing-payment`.

Headers: `Authorization: GNAP <outgoing access_token.value>`, digest, signatures.

Body one of:

- From quote: `walletAddress`, `quoteId` (quote URL), optional `metadata`.
- Without quote: `walletAddress`, `incomingPayment` (URL), `debitAmount`, optional `metadata`.

`201`: `id`, `walletAddress`, `failed`, `receiver`, `debitAmount`, `receiveAmount`, `sentAmount`, `grantSpentDebitAmount`, `grantSpentReceiveAmount`, `metadata?`, `createdAt`. `401`/`403`.

## 10. Get and list

All require GNAP + signatures except where noted. `id` is the path segment, not the full URL.

| Call | operationId | Query / path | `200` |
| --- | --- | --- | --- |
| `GET {rs}/incoming-payments/{id}` | `get-incoming-payment` | Signature headers optional | incoming payment; `methods` only for the client that created it (`incoming-payment-with-methods` or `public-incoming-payment`) |
| `GET {rs}/incoming-payments` | `list-incoming-payments` | required `wallet-address`; optional `cursor`, `first` or `last` (1–100) | `{ pagination: { startCursor, endCursor, hasNextPage, hasPreviousPage }, result: [...] }` |
| `GET {rs}/outgoing-payments/{id}` | `get-outgoing-payment` | | outgoing payment (`failed`, amounts, `sentAmount`, …) |
| `GET {rs}/outgoing-payments` | `list-outgoing-payments` | same query as incoming list | `{ pagination, result }` |
| `GET {rs}/quotes/{id}` | `get-quote` | | quote |
| `GET {rs}/outgoing-payment-grant` | `get-outgoing-payment-grant` | | `spentReceiveAmount`, `spentDebitAmount` (amount or null) |

`401`/`403`/`404` as applicable.

## 11. Complete incoming payment

`POST {resourceServer}/incoming-payments/{id}/complete` — `complete-incoming-payment`. GNAP token whose access includes `complete`. No request body in the spec.

`200`: incoming payment with `completed: true`. Use when there is no `incomingAmount` (fixed-send quote does not auto-complete). Fixed-receive and quote-with-`incomingAmount` complete when the outgoing payment completes. `401`/`403`/`404`.

## 12. Token rotation and revocation

Manage URL is `access_token.manage`, shaped `POST|DELETE {authServer}/token/{id}`.

- Rotate: `POST` — `post-token`. `Authorization: GNAP <current access_token.value>`. No request body in the spec. `200` `{ "access_token": { value, manage, expires_in?, access } }`. Old token management URI changes. `400`/`404` `invalid_rotation`. `401` `invalid_client`. `500` `request_denied`.
- Revoke: `DELETE` — `delete-token`. Same Authorization. Success status is **UNVERIFIED** (no `204` schema on this operation in the file; cancel grant is the one documented as `204`). `401` `invalid_client`. `500` `request_denied`.

## 13. Cancel grant

`DELETE {authServer}/continue/{id}` — `delete-continue`. `Authorization: GNAP <continue.access_token.value>`. `204` No Content. `401` `invalid_client` | `invalid_continuation` | `invalid_request`. `404` `invalid_request`.
