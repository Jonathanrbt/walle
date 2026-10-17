# Interledger test network (Open Payments)

Use only these hosts. Play money. Do not point clients at production wallet or auth hosts.

## Documented hosts

| Host | Role | Source |
| --- | --- | --- |
| `https://wallet.interledger-test.dev` | Test wallet UI: signup, KYC, deposit, wallet address, developer keys | `sdk/before-you-begin.mdx`, `resources/op-wallets.mdx`, `resources/further-learning.mdx` |
| `https://boutique.interledger-test.dev/products` | Test Boutique: buy virtual items with the test wallet | `resources/further-learning.mdx` |
| `https://ilp.interledger-test.dev` | OpenAPI example resource-server base (wallet path, e.g. `/alice`) and `/.well-known/pay` when the wallet address has no path | `resource-server.yaml` `servers` |
| `https://ilp.interledger-test.dev/alice`, `/bob` | OpenAPI example wallet-address servers | `wallet-address-server.yaml` `servers` |
| `https://auth.interledger-test.dev` | OpenAPI example authorization server (`POST /`, `/continue/{id}`, `/token/{id}`) | `auth-server.yaml` `servers` |

Example wallet-address JSON in the wallet-address spec uses `authServer` `https://ilp.interledger-test.dev/auth` and `resourceServer` `https://ilp.interledger-test.dev/op`. That differs from `auth.interledger-test.dev`. Do not hardcode either pair. Read `authServer` and `resourceServer` from `GET` of the wallet address. The URL the test-wallet UI assigns after "Add wallet address" is **UNVERIFIED** (docs do not print the resulting URL template).

Verification email sender documented: `tech@interledger.org`, subject `[Test.Wallet] Verify your account`.

## Signup and KYC

1. Open `https://wallet.interledger-test.dev`.
2. Click **Create account** (bottom-right).
3. Enter email, a strong password, confirm password, submit.
4. Open the email from `tech@interledger.org`. Click **Confirm my email address.**
5. Click **Login to your account**. Log in.
6. Finish KYC.

**What must be real:** the email address only. All other KYC fields may be fake. The UI is a GateHub pre-production environment, so the KYC steps match production GateHub even though the money is play money.

## Fund with play money

1. Dashboard → **New account**.
2. Any account name. Select an asset (currency). **Create account**. **Close**.
3. Left nav **Accounts** → select the account → **Deposit**.
4. Enter an amount → **Deposit**.

The docs call this play money. No fiat rail is documented.

## Wallet address

1. Select the account → **Add wallet address**.
2. Enter **Wallet Address name** and **Public name** (both free-form).
3. **Create**.

A wallet address is an `https` URL with no user-info, no port, no query, and no fragment (`concepts/wallet-addresses.mdx`). Probe with `GET` and `Accept: application/json`. Required response fields: `id`, `assetCode`, `assetScale`, `authServer`, `resourceServer`. `publicName` is optional in the schema but set from **Public name** in the UI.

Public keys for that address: `GET {walletAddress}/jwks.json` (`get-wallet-address-keys`).

A payment pointer (`$…`, SPSP) is a different identifier. It may also be a wallet address when ILP is the method. Not every wallet address is a payment pointer (`resources/glossary.mdx`). The test wallet UI shows a payment pointer like `$ilp.interledger-test.dev/abc123`. VERIFIED: replace `$` with `https://` to get the wallet address URL (`https://ilp.interledger-test.dev/abc123`).

## Developer keys

Settings → **Developer Keys** → expand the wallet account → **Generate public & private key** → any **nickname** → **Generate keys**.

- Browser downloads `private.key`. Keep it. Sign every request with it.
- UI then shows the **key ID** and **Show/Hide** for the **public key**.
- ASE publishes the public key in JWKS at `{walletAddress}/jwks.json`.

JWKS key object (Ed25519 only): `kid` (the key ID), `x` (base64url public key), `alg` `EdDSA`, `kty` `OKP`, `crv` `Ed25519`. Optional `use`: `sig`.

Initialize the client with wallet-address URL, key ID, and `private.key`. Use the key ID shown in the UI as `keyId` (VERIFIED working). `private.key` is a PEM with `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----` lines: keep them, they are part of the key.

Client identity on grant requests is `client.walletAddress` (or deprecated string `client`) so the AS fetches `{walletAddress}/jwks.json`, or `client.jwk` (directed identity) only on non-interactive grants.

## Verified on testnet (smoke test 2026-10-11, Node SDK 7.4.0)

Full one-time payment passed: wallet GET → incoming grant → incoming payment → quote grant → quote → interactive outgoing grant → consent → continue → outgoing payment → sent.

- Real wallet response shape: `id: https://ilp.interledger-test.dev/<name>`, `authServer: https://auth.interledger-test.dev/<uuid>`, `resourceServer: https://ilp.interledger-test.dev/<uuid>`. Hosts carry a per-tenant UUID: always read them from the wallet GET.
- Continue URI is `https://auth.interledger-test.dev/continue/<id>`, `wait: 1`.
- Consent URL: `https://auth.interledger-test.dev/interact/<id>/<code>?clientName=...&clientUri=...`; user logs into the test wallet and approves.
- `finish.uri` may be `http://localhost:<port>/callback`: the redirect happens in the user's browser, so a local server works for dev.
- Paying your own wallet works (sender = receiver). One wallet is enough for tests.
- **Fees are high on testnet:** receiving `100` (1.00 EUR) debited `200`. Always set the outgoing grant `limits.debitAmount` from `quote.debitAmount`, never from the intended amount.
- Outgoing payments are async: created with `sentAmount.value: "0"`, reached `sentAmount == debitAmount` within a few seconds of polling `outgoingPayment.get`.
- Accounts may be EUR scale 2 (not USD): read `assetCode`/`assetScale` from the wallet, never hardcode.
