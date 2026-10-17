---
name: rafiki
description: "Trigger: Rafiki, ASE, account servicing entity, Admin API, GraphQL admin, localenv, Cloud Nine Wallet, Happy Life Bank, tenant, peer, liquidity, webhook events, auth server, TigerBeetle. Use, consume, or build against an Interledger Rafiki instance."
license: Apache-2.0
metadata:
  author: "jonatin"
  version: "1.0"
---

Version: study copy commit `68c11dc` (2026-10-14, `docs: add redirect`). Rafiki is pre-1.0. If a command, env var, or mutation disagrees with the clone, trust the clone.

## Activation Contract

Load when the task is to run Rafiki, call its Admin GraphQL API, implement the account servicing entity (ASE) around it (webhooks, liquidity, IdP), or change Rafiki itself. If the code only talks Open Payments to a Rafiki wallet, also load the `open-payments` skill.

## Hard Rules

- **The judged flow stays on the test wallet.** Open Payments on `https://wallet.interledger-test.dev` is mandatory (`CLAUDE.md`). A local Rafiki is extra play-money. Never point it at real wallets or production auth servers.
- **Do not vendor Rafiki** into this repo. Clone outside it (Lookup order). Product code is written during the event; forked Rafiki is third-party.
- **No secrets in git.** Demo HMAC secrets and `localenv/*/private-key.pem` stay in the Rafiki clone. Reference the path; never paste a PEM.
- **Admin API requests are HMAC-signed** (`signature` + `tenant-id`). The verifier uses `Date.now()` milliseconds (`packages/backend/src/shared/utils.ts`), not seconds.
- **Rafiki does not hold user balances.** The ASE ledger does. Webhooks tell you when to deposit or withdraw liquidity.
- **Cite, don't invent.** If a reference says `UNVERIFIED`, look it up before coding it.

## Mental Model

```
Open Payments client
  | GET wallet address, GNAP grant, incoming/quote/outgoing
  v
auth (GNAP, :3006) --redirect--> ASE IdP consent --x-idp-secret--> auth
  |
backend (OP :3000, Admin GraphQL :3001, ILP :3002)
  | POST webhook (expect 200)
  v
ASE you write (ledger, liquidity, wallet lookup)
  |
Postgres (resources) + Redis (STREAM, sessions) + TigerBeetle or Postgres (balances)
  |
peer Rafiki  <---- ILP / STREAM packets ---->  peer Rafiki
```

Ports above are Cloud Nine Wallet on the host (`localenv/README.md`). Happy Life Bank uses 4000/4001/4006.

## Decision Gates

| Need | Open |
|------|------|
| What Rafiki is, packages, stores, glossary | `references/concepts.md` |
| Local Playground commands, URLs, seeds, reset | `references/run-local.md` |
| Signed Admin GraphQL, bootstrap order | `references/admin-api.md` |
| Webhooks, liquidity, IdP, consuming OP | `references/integration.md` |
| Build, test, migrations, env vars | `references/develop.md` |
| A failure (ports, 137, signature, liquidity) | `references/troubleshooting.md` |
| Whether to spend hackathon time on it | `references/hackathon-fit.md` |

## Rafiki vs the testnet wallet

Use the test wallet and the `open-payments` skill for the payment the judges must see. That path needs no Docker and no ASE.

Run Rafiki locally only when the demo must *be* a wallet provider: custom asset, your own wallet-address URLs, peering, or webhook-driven liquidity. Cost on a ~1.5-day hackathon: Node 24, pnpm 10.33, a large Docker stack, and hours before the first payment. TigerBeetle containers exit 137 when Docker is short on memory (`localenv/README.md`). On a laptop with limited RAM prefer `pnpm localenv:compose:psql up`. Keep a testnet fallback ready.

## Lookup order

1. These `references/`.
2. Clone docs: `packages/documentation/src/content/docs/` (ignore `v1-beta/` and `es/`).
3. https://rafiki.dev for the same pages.
4. Source: `packages/backend/src/graphql/schema.graphql`, `packages/auth`, `localenv/`.

Refresh **outside** this repo (never `git submodule` it in):

```sh
git clone --depth 1 https://github.com/interledger/rafiki.git ~/.cache/rafiki
```

This skill was written from commit `68c11dc`.

## Relationship to `open-payments`

Load both when a client creates grants or payments against a Rafiki wallet address. Rafiki's `auth` is the GNAP server and `backend` is the resource server. Grant shapes, amounts, and the finish-hash rules stay in the `open-payments` skill. This skill covers the ASE side and the Admin API.

## References

- `references/concepts.md`, `references/run-local.md`, `references/admin-api.md`
- `references/integration.md`, `references/develop.md`
- `references/troubleshooting.md`, `references/hackathon-fit.md`
