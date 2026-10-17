# Build and change Rafiki

Do this in a clone **outside** the hackathon repo (`~/.cache/rafiki` or similar). Commit `68c11dc` is what this skill read. Re-check `package.json` scripts if they differ.

## Hackathon caveat

Rafiki is third-party Apache-2.0 code. Hackathon rules: product code is written during the event, AI use goes in `AI_USAGE.md` and `prompts/`, and secrets stay out of git (`CLAUDE.md`). Cloning or patching Rafiki does not replace your app, and it does not replace the testnet Open Payments demo. If a judge asks what you wrote, the ASE/app is the answer; upstream Rafiki is not.

## Layout

pnpm workspace (`pnpm-workspace.yaml`): `packages/*`, `localenv/mock-account-servicing-entity`, `test/*`, `bruno/collections/Rafiki`.

| Path | What you edit |
|------|----------------|
| `packages/backend` | Connector, Open Payments routes, Admin schema, webhooks, accounting |
| `packages/auth` | GNAP, interaction endpoints, Auth Admin schema |
| `packages/frontend` | Rafiki Admin Remix UI |
| `packages/backend/src/graphql/schema.graphql` | Admin API contract |
| `packages/backend/migrations`, `packages/auth/migrations` | Knex SQL |
| `localenv/` | Playground compose and seeds only |

Engines: Node `24`, pnpm `10.33.0`. `.nvmrc` is `v24`.

## Commands (root `package.json` and `README.md`)

```sh
pnpm i
pnpm -r build          # or: pnpm build   (tsc --build)
pnpm --filter backend build
pnpm --filter backend test
pnpm -r --workspace-concurrency=1 test
pnpm --filter backend generate   # graphql-codegen
pnpm format            # prettier + eslint --fix
pnpm checks            # prettier --check && eslint
pnpm lint
```

One package in dev (backend `package.json`):

```sh
pnpm --filter backend dev
# ts-node-dev --inspect=0.0.0.0:9229 --respawn --transpile-only src/index.ts
```

Auth has the same `dev` script name. Frontend: `pnpm --filter frontend dev`. Docs site: `pnpm start` inside `packages/documentation`.

Playground containers are usually a better runtime than `backend dev`, because they already wire Postgres, Redis, and the mock ASE. See `references/run-local.md`.

## Migrations

Knex files: `packages/backend/knexfile.js`, `packages/auth/knexfile.js`, `migrations/` beside each.

Auto-migrate is the default (`ENABLE_MANUAL_MIGRATIONS` `false`). When it is `true`, the env tables say:

- backend: `npm run knex - migrate:latest -env production`
- auth: `node --run knex -- migrate:latest --env production`

(rafiki-docs: `partials/_backend-variables.mdx`, `partials/_auth-variables.mdx`). Quote those exactly; the backend flag spelling is what the doc prints. Local auth seed, not a migration: `pnpm localenv:seed:auth`.

## GraphQL codegen

Edit `packages/backend/src/graphql/schema.graphql`, then `pnpm --filter backend generate` (`graphql-codegen --config codegen.yml`). Auth: `pnpm --filter auth generate`. Commit the generated types with the schema change. Resolver types will fail `tsc` until you do.

## Env vars to know

Full tables: rafiki-docs: `resources/environment-variables.mdx` which includes `partials/_backend-variables.mdx`, `_auth-variables.mdx`, `_frontend-variables.mdx`.

Backend required (no default, except where noted):

| Variable | Default | Role |
|----------|---------|------|
| `DATABASE_URL` | `postgresql://postgres:password@localhost:5432/development` | Resource Postgres |
| `REDIS_URL` | `redis://127.0.0.1:6379` | STREAM cache |
| `USE_TIGERBEETLE` | `false` | `true` → TigerBeetle balances |
| `ILP_ADDRESS` | — | This node's ILP address |
| `ILP_CONNECTOR_URL` | — | Where peers post packets |
| `OPEN_PAYMENTS_URL` | — | Public resource-server origin |
| `AUTH_SERVER_GRANT_URL` | — | Auth grant endpoint |
| `AUTH_SERVER_INTROSPECTION_URL` | — | Token introspection |
| `AUTH_SERVICE_API_URL` | — | Push tenant changes to auth |
| `EXCHANGE_RATES_URL` | — | ASE rates `GET` |
| `WEBHOOK_URL` | — | Default webhook `POST` |
| `KEY_ID` | — | Instance client key id |
| `ADMIN_API_SECRET` | — | Operator HMAC secret |
| `OPERATOR_TENANT_ID` | — | Operator UUID v4 |

Auth required: `AUTH_DATABASE_URL` (default `postgresql://postgres:password@localhost:5432/auth_development`), `REDIS_URL`, `AUTH_SERVER_URL`, `COOKIE_KEY`, `IDENTITY_SERVER_URL`, `IDENTITY_SERVER_SECRET`, `ADMIN_API_SECRET`, `OPERATOR_TENANT_ID`.

Frontend required: `GRAPHQL_URL`, `OPEN_PAYMENTS_URL`. Kratos URLs only when `AUTH_ENABLED=true` (that flag's **default is `true`** in the frontend table; the playground turns auth off).

Useful optionals: `ADMIN_PORT` 3001, `OPEN_PAYMENTS_PORT` 3000, `CONNECTOR_PORT` 3002, `AUTH_PORT` 3006, `INTERACTION_PORT` 3009, `ADMIN_API_SIGNATURE_TTL_SECONDS` 30, `QUOTE_LIFESPAN` 300000, `WEBHOOK_TIMEOUT` 2000, `SLIPPAGE` 0.01, `LOG_LEVEL` `info`.

## Debug

Playground debuggers: Cloud Nine backend `127.0.0.1:9229`, auth `9230`, Happy Life backend `9231`, auth `9232` (`localenv/README.md`). VS Code attach `remoteRoot` `/home/rafiki/`.

`LOG_LEVEL=debug` is what Cloud Nine compose sets. Backend health: `GET /healthz` (compose healthcheck uses `:3001/healthz`).

## Tests and lint from the scripts

Backend test script is Jest with `--experimental-vm-modules` and `--maxWorkers=50%` (`packages/backend/package.json`). `pnpm --filter backend test:cov` adds coverage. `pnpm sanity` is `pnpm -r build && pnpm -r test` (root `package.json`) — too heavy for a hackathon laptop; don't run it casually.

Frontend user scripts (only relevant if `AUTH_ENABLED=true`): `invite-user` and `delete-user` (`packages/frontend/package.json`). Playground form: `docker exec -it <admin-container> node --run invite-user -- example@mail.com` (`packages/frontend/README.md`).

Codegen config files: `packages/backend/codegen.yml`, `packages/auth/codegen.yml`. Generated GraphQL types are imported by resolvers; a schema edit without `generate` fails `tsc`.

`ENABLE_MANUAL_MIGRATIONS` documents the production command. In development the knex script is just `knex` (`"knex": "knex"`). Typical local apply, **UNVERIFIED** against a running playground DB because containers migrate themselves:

```sh
pnpm --filter backend knex migrate:latest
pnpm --filter auth knex migrate:latest
```

Read `knexfile.js` for the `--env` name before using `production`.

## Small change checklist

1. Branch in the Rafiki clone, not in MedellinHack.
2. Prefer an ASE webhook/Admin call over a Rafiki patch. Patch only if behavior cannot live outside.
3. If the Admin API changes: schema first, `pnpm --filter backend generate`, resolver, a test under `packages/backend`.
4. If columns change: a knex migration, then `pnpm --filter backend test`.
5. If config changes: document the env var next to `config/app.ts` (`envInt` / existing helpers). Do not invent a name that is not read.
6. `pnpm --filter <pkg> test` and `pnpm checks` on the files you touched.
7. Do not commit `localenv/**/private-key.pem` contents or live secrets into the hackathon repo.
