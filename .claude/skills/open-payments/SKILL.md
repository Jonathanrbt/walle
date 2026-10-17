---
name: open-payments
description: "Trigger: Open Payments, Interledger, ILP, GNAP grant, wallet address, incoming/outgoing payment, quote, test wallet. Build payments with Open Payments SDKs on testnet."
license: Apache-2.0
metadata:
  author: "jonatin"
  version: "1.1"
---

## Activation Contract

Load when code or design touches Open Payments: wallet addresses, grants (GNAP), incoming payments, quotes, outgoing payments, HTTP message signatures, the Interledger test wallet, or any `open-payments-*` SDK (Node/TS, Go, Java, PHP, Rust, Python, .NET).

## Hard Rules

- **Testnet only.** Use accounts from `https://wallet.interledger-test.dev` (play money). Never target production wallets or auth servers.
- **Never hardcode `authServer` / `resourceServer`.** `GET` the wallet address first and read both URLs from the response. Each party (sender, receiver) has its own.
- **Grants go to `authServer`; resources go to `resourceServer`.** Every resource call needs the access token from the matching grant.
- **Outgoing payments need interactive consent.** The outgoing-payment grant returns `interact.redirect`; the user must approve in the browser before `grant.continue`. Incoming-payment and quote grants are non-interactive.
- **Amounts are strings in minor units** with `assetCode` + `assetScale` (`{ value: "1000", assetCode: "USD", assetScale: 2 }` = 10.00 USD). Copy them from the quote; never compute floats.
- **Secrets stay out of git.** `private.key`, key ID, and wallet address URL come from env vars / `.env` (gitignored). A multi-line PEM in `.env` MUST be wrapped in double quotes (keep the BEGIN/END lines), or store a file path instead.
- **Payment pointers:** the test wallet shows `$ilp.interledger-test.dev/name`; the wallet address URL is `https://ilp.interledger-test.dev/name`.
- **Grant limits come from the quote:** `limits.debitAmount = quote.debitAmount`. Testnet fees can double small payments.
- **Cite, don't invent.** Use only method names found in `references/sdk/<lang>.md`. If something is marked `UNVERIFIED` or missing, look it up (see Lookup order) before coding it.
- Prefer an SDK with status **Done** (Node/TS, Go, Java, PHP, Rust). Python and .NET are **In progress**: check the gaps listed in their reference first.

## Mental Model

```
Sender wallet ──(outgoing payment)──> ILP ──> Receiver wallet (incoming payment)
```

1. `GET` receiver wallet address → `authServer`, `resourceServer`, `assetCode`, `assetScale`.
2. Non-interactive grant `incoming-payment` on receiver `authServer` → token.
3. Create **incoming payment** on receiver `resourceServer` (where money lands).
4. Non-interactive grant `quote` on **sender** `authServer` → create **quote** on sender `resourceServer` with `receiver` = incoming payment URL.
5. Interactive grant `outgoing-payment` on sender `authServer` (limits from the quote) → redirect user to `interact.redirect`.
6. User approves → browser hits your `finish.uri?hash=...&interact_ref=...` → verify hash (SHA-256, base64 **with** padding, see `gnap-grants.md`) → `grant.continue` with `interact_ref` → token.
7. Create **outgoing payment** with `quoteId` on sender `resourceServer`. It is async (`sentAmount` starts at `"0"`): poll `get` until `sentAmount == debitAmount` or `failed`.

This whole flow was VERIFIED end to end on testnet (sender may equal receiver); the Node calls are in `references/sdk/node.md`.

## Decision Gates

| Need | Open |
|------|------|
| Account, keys, KYC, hosts | `references/testnet.md` |
| Code for a language | `references/sdk/<lang>.md` (`node`, `go`, `java`, `php`, `rust`, `python`, `dotnet`) |
| Which flow fits the product idea | `references/use-cases.md` (see "Pick a pattern") |
| Grant bodies, limits, `interval`, finish hash, signatures | `references/gnap-grants.md` |
| Raw HTTP / no SDK / debugging requests | `references/flow-http.md` |
| An error or unexpected status | `references/troubleshooting.md` |
| Check credentials work | request a non-interactive `incoming-payment` grant on your own wallet (see Execution Steps) |

## Execution Steps

1. Pick the pattern in `use-cases.md`; pick the SDK file for the project language.
2. Set up credentials per `testnet.md` in a gitignored `.env`: `WALLET_ADDRESS_URL`, `KEY_ID`, `TEST_KEY` (quoted PEM or path to `private.key`). Validate them once: `GET` your wallet address, then request a non-interactive `incoming-payment` grant on its `authServer`; a finalized grant means keys and signatures work.
3. Build the authenticated client exactly as in the SDK file.
4. Implement the flow step by step; log each response (`id`, status, token) while developing.
5. Implement the consent redirect: a `finish.uri` route in your app that reads `interact_ref`, verifies `hash` if possible, then calls continue.
6. On error, check `troubleshooting.md` before changing code.

## Lookup order (when the references are not enough)

1. `https://openpayments.dev/llms.txt` → open only the specific linked page you need (e.g. `.../sdk/grant-create-outgoing/`).
2. SDK repo: `https://github.com/interledger/open-payments-<lang>` (README, examples, tests). Citations like `packages/...` or `sdk/*.mdx` in the references point to these repos and to `interledger/open-payments` (`docs/src/content/docs/`).
3. Exact schemas: `https://github.com/interledger/open-payments-specifications/tree/main/openapi` (`wallet-address-server.yaml`, `auth-server.yaml`, `resource-server.yaml`).
4. Never fetch `llms-full.txt` whole (~640 KB); search it instead.

## Output Contract

- Code uses the SDK's real names from the reference and env-based credentials.
- State which use case and which grants/limits were chosen.
- Flag any step that relied on an `UNVERIFIED` item.

## References

- `references/testnet.md`, `references/use-cases.md`, `references/gnap-grants.md`
- `references/flow-http.md`, `references/troubleshooting.md`
- `references/sdk/{node,go,java,php,rust,python,dotnet}.md`
