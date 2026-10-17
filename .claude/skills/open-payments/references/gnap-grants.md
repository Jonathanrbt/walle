# GNAP grants (Open Payments profile)

Spec: `auth-server.yaml` v1.4.0. Narrative: `identity/grants.mdx`, `identity/client-keys.mdx`, `identity/http-signatures.mdx`, `identity/hash-verification.mdx`, `concepts/auth.mdx`.

One grant endpoint: `POST {authServer}/`. Tokens are bound to the client key. No bearer tokens. No OAuth `client_id`.

## Access types and actions

`access_token.access` is an array, max 3, unique items. Each item:

| `type` | Actions (enum) | `identifier` |
| --- | --- | --- |
| `incoming-payment` | `create`, `complete`, `read`, `read-all`, `list`, `list-all` | optional URI of a resource at the RS (wallet address in examples) |
| `quote` | `create`, `read`, `read-all` | not in schema |
| `outgoing-payment` | `create`, `read`, `read-all`, `list`, `list-all` | **required** URI (sender wallet address) |

Docs (`concepts/auth.mdx`): incoming and quote grants are non-interactive by default. If the request includes `list-all`, the AS should require interaction because that lists resources the client did not create. Quote's OpenAPI enum has `read-all`, not `list-all`. Treat quote `list-all` as **UNVERIFIED**. Outgoing-payment grants MUST be interactive.

`jwk` directed identity is only for non-interactive grants (spec text says "i.e.: incoming payments"; client-keys page also allows quote grants).

## Limits (outgoing only)

`limits` on `outgoing-payment` access. One of:

- No amount: optional `receiver`, optional `interval`.
- `debitAmount` required (plus optional `receiver`, `interval`).
- `receiveAmount` required (plus optional `receiver`, `interval`).

`debitAmount` and `receiveAmount` are `amount`: `value` (uint64 decimal string), `assetCode` (ISO 4217), `assetScale` integer 0–255. They are maxima: several payments may be created until the sum exceeds the max per interval.

`receiver`: incoming-payment URL.

`interval`: ISO 8601 repeating interval. Examples in spec: `R12/2019-08-24T14:15:22Z/P1M`, `R11/2022-08-24T14:15:22Z/P1M`, `R/2017-03-01T13:00:00Z/2018-05-11T15:30:00Z`, `R-1/P1Y2M10DT2H30M/2022-05-11T15:30:00Z`.

## Client identity

Required on initiation. One of:

- `{ "walletAddress": "<https wallet address>" }` — AS `GET {walletAddress}/jwks.json`.
- Deprecated string: the wallet address URL itself.
- `{ "jwk": { "kid", "alg": "EdDSA", "kty": "OKP", "crv": "Ed25519", "x", "use"?: "sig" } }` — non-interactive only. No JWKS fetch.

JWKS `keys[]`: `alg=EdDSA`, `kty=OKP`, `crv=Ed25519`, `kid`, `x`.

## Interactive vs non-interactive

Non-interactive (incoming, quote, no `list-all`): `POST /` returns `access_token` immediately (`200` Approved). `continue` is still required in that schema.

Interactive (outgoing, and any grant the AS refuses to approve inline): send `interact`.

- Request `interact.start`: only `redirect`.
- Request `interact.finish.method`: only `redirect`. `uri` = client callback. `nonce` = client-generated unguessable unique value, used in the hash.
- Response `interact.redirect`: where to send the user. `interact.finish`: unique key securing the callback.
- Response always includes `continue` when the AS allows continuation.

## Finish hash (VERIFIED on testnet 2026-10-11)

After consent the browser is redirected to `finish.uri?hash=...&interact_ref=...` (exactly these two query params).

Hash base = four values joined by `
` (real newline, no trailing newline):

1. Your client `nonce` (the one you sent in `interact.finish.nonce`).
2. `interact.finish` from the **grant response** (the AS nonce).
3. `interact_ref` from the redirect query.
4. The grant endpoint URL you POSTed to = the wallet's `authServer` (e.g. `https://auth.interledger-test.dev/<uuid>`).

`sha256(base)` → **standard base64 WITH `=` padding** (Node: `createHash('sha256').update(base).digest('base64')`). The docs prose says "no padding" but the testnet matches the padded form; compare against both if unsure.

```js
const base = [clientNonce, grant.interact.finish, interactRef, wallet.authServer].join('
')
const ok = createHash('sha256').update(base).digest('base64') === hashFromQuery
```

## Continue token, uri, wait

`continue` object:

- `access_token.value` — continuation access token. Send as `Authorization: GNAP <value>` on `POST/DELETE continue.uri`. This is not the resource access token.
- `uri` — continuation URL (`…/continue/{id}`).
- `wait` — integer seconds. Client MUST wait this long after receiving the continuation response before calling `uri`. Calling sooner → `400` `too_fast`.

`POST` body may be `{ "interact_ref": "<AS-generated>" }` after consent. Poll while the `200` has `continue` and no `access_token`.

Resource token fields: `value`, `manage` (rotate/revoke URL, must not embed the token value), `access`, optional `expires_in` (seconds). Client MUST NOT use the token after `expires_in`. RS MUST NOT accept it after that.

## GNAP error codes

Body shape: `{ "error": { "code", "description" } }`.

| `code` | Where |
| --- | --- |
| `invalid_request` | `POST /` 400; `POST /continue/{id}` 404; `DELETE /continue/{id}` 401 and 404 |
| `invalid_client` | `POST /` 400 and 401; `POST /continue/{id}` 400 and 401; `DELETE /continue/{id}` 401; `POST /token/{id}` 401; `DELETE /token/{id}` 401 |
| `request_denied` | `POST /` 500; `POST /continue/{id}` 401; `POST /token/{id}` 500; `DELETE /token/{id}` 500 |
| `too_fast` | `POST /continue/{id}` 400 |
| `invalid_continuation` | `POST /continue/{id}` 401 and 404; `DELETE /continue/{id}` 401 |
| `invalid_rotation` | `POST /token/{id}` 400 and 404 |

Resource-server errors are a separate `error.code` string (`invalid_request` in examples) plus optional `details`. Not the GNAP enum above.

## HTTP message signatures and client key

- Algorithm: Ed25519 (`alg` on the signature params `"ed25519"`; JWK `alg` `EdDSA`, `crv` `Ed25519`). Proof method name when a raw key is shown: `httpsig`.
- `Signature-Input` label (example `sig1`) lists covered components. MUST: `"@method"`, `"@target-uri"`, `"authorization"`. If the message has a body, MUST also: `"content-digest"`. Doc example also covers `content-type`, `content-length`. `created` is in examples. `keyid` MUST be the JWK `kid`.
- Signature creation (`identity/http-signatures.mdx`): hash the signature base with SHA-512; sign that digest with the private key; Base64-encode the signature bytes into `Signature`.
- `Content-Digest` example: `sha-512=:…=:`.
- Grant initiation: signed, no access token. Later AS and RS calls: `Authorization: GNAP <token>` covered by the signature.
- AS checks `keyid` against JWKS (`walletAddress`) or against `client.jwk` (directed identity).
