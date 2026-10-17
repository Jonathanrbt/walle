# Run the Local Playground

Commands below are copied from `package.json` and `localenv/README.md` (commit `68c11dc`). **VERIFIED** means the script or compose file contains them. This skill did not start Docker.

## Prerequisites

| Tool | Required version | Source |
|------|------------------|--------|
| Node | `24` (`engines.node`, `.nvmrc` is `v24`) | `package.json` |
| pnpm | `10.33.0` (`packageManager`, `engines.pnpm` `^10.33.0`) | `package.json` |
| Docker | current Engine + Compose v2 | `README.md`, `localenv/README.md` |
| Git | clone + `git submodule update --init --recursive` (Open Payments specs) | `README.md` |

```sh
# from a Rafiki clone, not this hackathon repo
nvm install && nvm use
corepack enable
pnpm i
```

Those four lines are the root README setup. Whether `corepack enable` alone installs pnpm 10.33.0 is **UNVERIFIED** (README says it).

Do not `pnpm i` inside a shared study clone if you were told not to. Use a scratch clone.

## What the two wallets are

| Name | Role |
|------|------|
| Cloud Nine Wallet | Primary mock ASE. Owns Postgres, Redis, and TigerBeetle when that overlay is on. Can run alone |
| Happy Life Bank | Second mock ASE. No databases of its own; uses Cloud Nine's stores. Peers with Cloud Nine |
| Cloud Ten Wallet | Tenant of Cloud Nine. Only in the multitenancy compose (`IS_TENANT: true`) |
| Global Bank | Third ASE used by the **psql** and **multihop** scripts, not by plain `localenv:compose` |

(rafiki: `localenv/README.md`, `localenv/cloud-ten-wallet/docker-compose.yml`, `package.json`).

## Start and stop (VERIFIED scripts)

From the Rafiki repo root.

| Intent | Command |
|--------|---------|
| TigerBeetle accounting on Cloud Nine | `pnpm localenv:compose up` |
| Detached | `pnpm localenv:compose up -d` |
| Postgres accounting (no TigerBeetle file) | `pnpm localenv:compose:psql up` |
| Multi-tenant (adds Cloud Ten) | `pnpm localenv:compose:multitenancy up` |
| Partial-payment decisioning | `pnpm localenv:compose:partial-payment up` |
| Multihop via Global Bank | `pnpm localenv:compose:multihop up` |
| Admin login (Kratos + Mail Slurper) | `pnpm localenv:compose:adminauth up` |
| Stop | `pnpm localenv:compose down` |
| Reset DB volumes | `pnpm localenv:compose down --volumes` |
| Also delete images | `pnpm localenv:compose down --volumes --rmi all` |
| Merged config | `pnpm localenv:compose config` |

`localenv:compose` files: `cloud-nine-wallet`, `happy-life-bank`, `merged`, `tigerbeetle` with `--env-file ./localenv/tigerbeetle/.env.tigerbeetle`.

`localenv:compose:psql` files: `cloud-nine-wallet`, `global-bank`, `happy-life-bank`, `merged` — **no** tigerbeetle overlay (`package.json`).

Matching `down` / `--volumes` for the psql and adminauth variants are in `localenv/README.md`. Use the **same** script you used to start, or volumes from the other project name can linger (**UNVERIFIED** which compose project name wins).

TigerBeetle env file (VERIFIED): `USE_TIGERBEETLE=true`, `TIGERBEETLE_CLUSTER_ID=0`, `TIGERBEETLE_REPLICA_ADDRESSES=10.5.0.50:4342` (rafiki: `localenv/tigerbeetle/.env.tigerbeetle`). Image `ghcr.io/tigerbeetle/tigerbeetle:0.16.29`, listen `0.0.0.0:4342`, no host port publish (rafiki: `localenv/tigerbeetle/docker-compose.yml`).

Partial-payment overlay sets `ENABLE_PARTIAL_PAYMENT_DECISION=true` and `PARTIAL_PAYMENT_DECISION_MAX_WAIT_MS=30000` on Happy Life backend (rafiki: `localenv/partial-payment/docker-compose.yml`).

Multihop overlay bind-mounts `seed.multihop.yml` (rafiki: `localenv/multihop/docker-compose.yml`).

## URLs (VERIFIED compose publishes)

Cloud Nine: UI `3030`, OP `3000`, Admin GraphQL `3001`, ILP `3002`, Auth Admin `3003`, auth `3006`, interaction `3009`, Admin UI `3010`, debugger `9229`.

Happy Life: UI `3031`, OP `4000`, Admin `4001`, ILP `4002`, Auth Admin `4003`, auth `4006`, interaction `4009`, Admin UI `4010`, debugger `9231`.

Global Bank (only some scripts): UI `3032`, OP `5000`, Admin `5001`, auth `5006`, Admin UI `5010`.

Cloud Ten UI: `5030`. Postgres: `5432`. Redis: not published. Kratos `4433` / `4432`, mail `4436` only with adminauth.

ILP addresses: Cloud Nine `test.cloud-nine-wallet`, Happy Life `test.happy-life-bank` (compose `ILP_ADDRESS`).

## Credentials

Auth on Admin UI is **off** by default. On mock-ASE start, logs print a URL that sets `tenantId` and `apiSecret` from `OPERATOR_TENANT_ID` and `SIGNATURE_SECRET` (rafiki: `localenv/README.md`).

| Instance | `OPERATOR_TENANT_ID` in compose |
|----------|---------------------------------|
| Cloud Nine | `438fa74a-fa7d-4317-9ced-dde32ece1787` |
| Happy Life | `cf5fd7d3-1eb1-4041-8e43-ba45747e9e5d` |

HMAC secret: env `ADMIN_API_SECRET` / `SIGNATURE_SECRET` in `localenv/cloud-nine-wallet/docker-compose.yml`. Do not copy it into this repo.

Wallet signing key file (do not copy): `localenv/cloud-nine-wallet/private-key.pem`, mounted as `KEY_FILE`. Same pattern for Happy Life, Cloud Ten, Global Bank.

Postgres superuser in that compose: `POSTGRES_USER=postgres`, `POSTGRES_PASSWORD=password`. Backend `DATABASE_URL` uses role `cloud_nine_wallet_backend` on database `cloud_nine_wallet_backend`. How that role is created is the image entrypoint — **UNVERIFIED** here beyond the URL string.

With adminauth, invite a user:

```sh
docker exec -it <admin-container-name> node --run invite-user -- example@mail.com
```

(VERIFIED as the documented command in `localenv/README.md` and `packages/frontend/README.md`.)

## Seeds (VERIFIED `seed.yml`)

Mock ASE reads `/workspace/seed.yml` (`SEED_FILE_LOCATION`). `packages/mock-account-service-lib/src/seed.ts` creates assets, peers, mock ledger accounts, wallet addresses (`${OPEN_PAYMENTS_URL}/${path}`), and a wallet key per account unless `skipWalletAddressCreation: true`.

Cloud Nine (`localenv/cloud-nine-wallet/seed.yml`): assets USD and EUR scale 2, liquidity `10000000`; peers Global Bank (`test.unreachable.global-bank`) and Happy Life (`test.happy-life-bank`); accounts `accounts/gfranklin`, `bhamchest`, `wbdc`, `broke` (USD), `lrossi` (EUR). Rates USD/EUR/MXN/JPY are in the file.

Happy Life seed adds MXN scale 2 and JPY scale 0, peers Cloud Nine and Cloud Ten, and `fees: fixed 100, basisPoints 200`. One account (`asmith`) sets `skipWalletAddressCreation: true`.

`pnpm localenv:seed:auth` runs auth knex seeds (`development` and `peerdevelopment`). The playground containers seed via the mock ASE on boot; you do not need that script for `localenv:compose` (**UNVERIFIED** whether auth tables also need the knex seed inside Docker — compose healthchecks only hit backend `/healthz`).

## Reset

`pnpm localenv:compose down --volumes` (or the psql twin) drops database volumes. Next `up` re-seeds from `seed.yml` because the mock ASE runs seed on start (`mock-account-service-lib` seed + compose `depends_on` backend healthy). A second seed against a live DB is not what the mock README wants: "not previously seeded" (`localenv/mock-account-servicing-entity/README.md`).

## Resources

Docker Compose "real ASE" guide asks for a Linux VM with **4 GB RAM and 2 vCPUs** minimum (rafiki-docs: `integration/deployment/docker-compose.mdx`). That guide is Nginx + Certbot + one instance, not the playground.

The playground runs two ASEs plus Postgres and Redis, and with TigerBeetle a privileged replica. Exact GiB is **UNVERIFIED**. Known failure: TigerBeetle exits **137** when Docker memory is too low (`localenv/README.md`). On a laptop with limited RAM use `pnpm localenv:compose:psql up`.

## "Real" ASE via Docker Compose

Not the playground. Steps in rafiki-docs: `integration/deployment/docker-compose.mdx`: VM, Docker, Nginx, Certbot, DNS:

| Service | Host |
|---------|------|
| Open Payments | `DOMAIN` |
| ILP connector | `ilp.DOMAIN` |
| Auth | `auth.DOMAIN` |
| Admin UI | `admin.DOMAIN` |

Then configure the compose file, Nginx, symlinks, and `docker compose` up (same page). Helm is a separate guide: `integration/deployment/helm-k8s.mdx`.
