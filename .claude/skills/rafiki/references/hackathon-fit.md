# Hackathon fit

Event window after kickoff is roughly Friday afternoon plus Saturday until **11:00** (`HACKATHON.md`). Judges score a working Open Payments flow. That flow should be the test wallet (`https://wallet.interledger-test.dev`) plus the `open-payments` skill. Rafiki does not replace it.

Rafiki is pre-1.0 (`68c11dc`, 2026-10-14) and the Local Playground is a Docker stack (Node 24, pnpm 10.33, Postgres, Redis, optionally TigerBeetle). TigerBeetle is a known OOM on low-memory Docker (exit 137). Prefer not starting it.

Estimates are judgment from the docs, not timed runs. Each option's fallback is the testnet payment you already have.

## Start here

**Do not run Rafiki** unless the story is "we are a wallet provider". Setup time is the scarce resource. Reading `references/concepts.md` so the pitch names ASE vs client correctly is free and enough for most ideas.

## Options (neutral — not a product pick)

| Option | What it shows | Effort | Risk | Fallback |
|--------|---------------|--------|------|----------|
| Testnet only | Mandatory grant → pay → complete | 0 h of Rafiki | Lowest | This is the fallback |
| Playground, Postgres, no code | Cloud Nine `localhost:3030` and Happy Life `localhost:3031` already peered, with seeded accounts (`gfranklin`, `pfry`, …) | 1–2 h if images pull cleanly; more if Docker memory or ports fight | Stack may not be healthy before lunch | Testnet demo |
| Admin API onboarding | Against that playground, `createAsset` + `createWalletAddress` + key for one extra account | +1–2 h after the stack is up | HMAC timestamp in ms; webhook still required for a real pay-in | Create the account in the test wallet UI |
| Closed loop, custom asset | Your asset code on Cloud Nine, two wallet addresses, admin `createQuote` / `createOutgoingPayment`, fund the `outgoing_payment.created` webhook | 4–6 h after a healthy stack | You must implement liquidity or the mock ASE only understands its seed. Easy to miss the 11:00 cutoff | Same story told with testnet USD/EUR |
| Peer story | Already in the seed (Cloud Nine ↔ Happy Life). Multihop adds Global Bank (`localenv:compose:multihop`) | 2–3 h to *show* existing peering; a new peer is longer | `maxPacketAmount` and liquidity thresholds fail quietly | Skip peering slides |
| Multi-tenant | `pnpm localenv:compose:multitenancy up` (Cloud Ten on `:5030`) | 2–3 h to boot and explain operator vs tenant | Extra compose, more RAM. **UNVERIFIED** on low RAM | One testnet wallet is one tenant; say so |
| Your own webhook + IdP | The actual ASE surface: 200 in 2s, deposit/withdraw, consent screen, `x-idp-secret` | 6 h+ | This is a product, not a side path. Interaction loops burn the demo | Testnet consent on `wallet.interledger-test.dev` |
| `card-service` or `point-of-sale` | Packages exist (`packages/card-service`, `packages/point-of-sale`). Cloud Nine compose already starts a card service | 6 h+ and mostly unread surface | Card README is a title. POS has no README. High chance of a dead end | Do not demo it |
| Patch Rafiki itself | Behavior you cannot get from Admin API or webhooks | Longer than the event | Fork is third-party. Your app must still be written at the event and AI prompts disclosed | Config, seed, or ASE code |

## If you do boot it

Commands, from a clone outside this repo (see `references/run-local.md`):

```sh
pnpm localenv:compose:psql up -d
```

Stop with `pnpm localenv:compose:psql down`. Add `--volumes` only when you want the seed to run again on a fresh database.

Check these URLs before writing ASE code:

| Check | URL |
|-------|-----|
| Cloud Nine UI | `http://localhost:3030` |
| Happy Life UI | `http://localhost:3031` |
| Admin GraphQL | `http://localhost:3001/graphql` |
| Open Payments port | `http://localhost:3000` |

The mock ASE log line is the Admin UI link with `tenantId` and `apiSecret`. Cloud Nine's tenant id in compose is `438fa74a-fa7d-4317-9ced-dde32ece1787`. Do not paste the secret into MedellinHack.

A payment between seeded accounts (`accounts/gfranklin` on Cloud Nine, `accounts/pfry` on Happy Life) is the playground's own demo. It is not the hackathon's required testnet payment. Record the testnet one first.

Stop the stack if any of these happen: TigerBeetle-style exit 137 (you used the wrong script), host ports already taken, or images still pulling with under two hours to the 11:00 cutoff. The testnet demo does not need those containers running during the pitch.

## Already in the seed (do not rebuild)

Cloud Nine `seed.yml` already has USD and EUR, peer liquidity, and accounts `gfranklin`, `bhamchest`, `wbdc`, `broke`, `lrossi`. Happy Life has USD, EUR, MXN, JPY and a sending fee of `fixed: 100`, `basisPoints: 200`. Showing those screens is a tour of the playground, not new product code. Write ASE code only for behavior the seed does not cover.

Cloud Nine compose sets `ENABLE_TELEMETRY: true` even on the psql script (the flag is in `localenv/cloud-nine-wallet/docker-compose.yml`, and the telemetry *stack* is a separate compose file). Expect extra log noise. Grafana (`:4500`) is only there if you started `localenv:compose:telemetry` or `localenv:compose:psql:telemetry`.

`localenv:compose:autopeer` starts a tunnel (`scripts/localenv-tunnel-setup.js`) so a laptop can peer with something public. That is a networking project. Skip it this weekend.

## What "using Rafiki" is allowed to mean

- Talking to a running instance with Open Payments (load `open-payments` too).
- Calling Admin GraphQL from **your** service to onboard wallet addresses.
- Receiving webhooks and moving **your** ledger.

It does not mean copying `packages/backend` into this repo. Upstream stays upstream.

## Lightest useful Rafiki use

1. Ship the testnet Open Payments flow first.
2. If there is time and a reason: `pnpm localenv:compose:psql up -d` in a clone outside this repo.
3. Open `http://localhost:3030` and the Admin URL the mock ASE prints (tenant id + secret from its env, not from git).
4. One extra wallet address via Admin GraphQL is the smallest "we operated Rafiki" proof.
5. Leave TigerBeetle, multihop, Kratos (`localenv:compose:adminauth`), and source edits for after the testnet demo is recorded.

## Decision in under a minute

Answer in order. Stop at the first "no".

1. Is the testnet payment (request, grant, execute, complete) already working? If no, Rafiki waits.
2. Does the pitch need *your* wallet-address host, a non-ISO asset, or two providers you operate? If no, stop at the test wallet.
3. Is Docker free of the ports in `references/run-local.md`, and is it before Saturday 08:00 with the testnet demo already recorded? If no, do not pull images.
4. Only then: Postgres playground, one Admin mutation, stop.

Peers, Cloud Ten, card, and POS packages are real code in the clone. They are not a hackathon MVP unless step 4 is done and the clock still has hours. Card and POS have almost no README (`packages/card-service/README.md` is the title; `packages/point-of-sale` has no README). Treat them as unread.

## What judges still have to see

`HACKATHON.md` scores a working Open Payments flow, not a self-hosted connector. A Rafiki slide helps Inclusion or Innovation only if the testnet payment is on camera. Suggested order on Saturday morning:

1. Testnet payment recorded (request, user consent, completion).
2. Optional: 60 seconds of Cloud Nine UI plus one wallet address you created with the Admin API.
3. Stop containers before the pitch so a port or an OOM cannot take the demo down. The testnet path does not need them.

If step 1 is not done by Saturday 08:00, skip step 2. Code freeze is 11:00.

The rows do not add. "Custom asset" is 4–6 h after a healthy stack, and "your own webhook + IdP" is 6 h+ instead of that, not on top of it. Either one can consume the time left after the testnet demo. Five people do not multiply Docker RAM; one laptop still runs the compose project.

Keep the Rafiki clone out of `MedellinHack` (`git clone --depth 1 https://github.com/interledger/rafiki.git ~/.cache/rafiki`). A submodule or a copied `packages/backend` makes the submission look like vendored upstream and fights the "written at the event" rule. Link the clone path from the pitch notes, not from git.

If the only Rafiki artifact in the pitch is a diagram, use the one in `SKILL.md` (client → auth/IdP → backend → ASE webhook → peer). That matches rafiki-docs: `resources/architecture.mdx` plus the webhook page, and it costs no Docker. Say out loud that user balances sit in the ASE and Rafiki only tracks liquidity.

Things that look like progress and are not, this weekend:

| Tempting | Why it waits |
|----------|----------------|
| `pnpm localenv:compose up` (TigerBeetle) | Exit 137 when Docker memory is low. Use the psql script or skip |
| `localenv:compose:adminauth` | Kratos + mail. Admin UI already works without login |
| Editing `schema.graphql` | Codegen, migrations, and a fork. Your ASE calls the API that already exists |
| Card / POS packages | Present in the monorepo, almost undocumented |
| Copying `private-key.pem` into `.env` in this repo | Secret in git. The playground mounts that file inside the clone |

The testnet wallet remains the payment of record even if the table's playground row succeeds. Rafiki on localhost is a second story, told only after that payment has completed.

Re-read the clone if it is no longer commit `68c11dc`.

## What not to spend the night on

- Vendoring `github.com/interledger/rafiki` into MedellinHack.
- Copying `localenv/*/private-key.pem` or `ADMIN_API_SECRET` into the repo.
- Replacing the testnet payment with a laptop-only Rafiki payment. Judges need the Open Payments flow; the test wallet is the one that does not depend on your Docker daemon at pitch time.
