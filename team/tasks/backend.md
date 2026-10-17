---
owner: jonatin
status: in-progress
branch: feat/jonatin-backend
paths:
  - server/**
  - packages/contracts/**
shared:
  - package.json
  - package-lock.json
  - .gitignore
  - team/contracts.md
  - PROJECT.md
depends_on: []
---

# Backend: operador y punto de efectivo (`server/`)

Documento de funcionalidad con formato ODD: intención, decisiones, tareas con IDs estables, evidencia y progreso en un solo lugar. Una tarea se marca solo con prueba observada. Es la entrada del bucle orquestador (ver «Bucle de ejecución»).

## Objetivo
Implementar el backend real detrás de `team/contracts.md`, para que `web/` pase de `VITE_API_MOCK=1` a `VITE_API_MOCK=0` sin reescribir pantallas: cotización, ingreso de efectivo con el flujo completo de Open Payments (tienda → operador), envío de USDC en Stellar testnet, `grant` diario de la tienda e inventario del operador.

## Problema
El front (`team/tasks/web-cajero.md`, W1–W9 listos) corre contra un doble simulado. Sin backend, el flujo obligatorio «solicitud → autorización → ejecución → finalización» (`docs/submission-judging.md`) no existe en testnet. El backend mueve dinero de prueba en dos redes: un error de estado se ve como un doble envío o un pago perdido en plena demo.

## Por qué así (decisiones)
| Decisión | Elección | Por qué | Alternativa descartada |
|---|---|---|---|
| Monorepo | `npm workspaces` en la raíz con `server` y `packages/contracts`. `web/` queda fuera de los workspaces y conserva su lockfile hasta que su dueño decida unirse | No tocamos las rutas reclamadas por `andss-ye`; el contrato queda listo para que `web/` lo importe después | pnpm/turbo: otra herramienta para dos paquetes |
| Arquitectura | Hexagonal con estructura que grita el dominio: `cash-in`, `store-grant`, `treasury`, `pricing`, `compliance`; los adaptadores (`open-payments`, `stellar`, `sqlite`, `http`) implementan puertos; un único punto de composición (`main.ts`) | El dominio (estados, dinero, límites) se prueba sin red; cada red se cambia por un doble en las pruebas | Capas por tipo técnico (`controllers/`, `services/`): esconde el dominio |
| Runtime | Node ≥ 24, TypeScript estricto ejecutado con la eliminación nativa de tipos de Node (`erasableSyntaxOnly`); `tsc --noEmit` solo verifica | Sin paso de compilación ni `tsx`; Node 26 local | `tsx`/`ts-node`: una dependencia más |
| HTTP | Fastify 5 + esquemas Zod (`fastify-type-provider-zod`), `pino` integrado con redacción de PII y secretos | Validación de entrada y salida desde el mismo esquema del contrato; `inject()` para pruebas sin puerto | Express: sin validación ni tipos de serie |
| Persistencia | SQLite con `node:sqlite` (archivo en `server/data/`, ignorado por git), migraciones SQL versionadas, columna `version` para concurrencia optimista | Durable entre reinicios (el proceso de liquidación se reanuda), sin dependencias nativas ni servidor | Memoria: se pierde un pago al reiniciar. Postgres: infraestructura de más |
| Dinero | `bigint` en unidades menores + `assetCode`/`assetScale`; nunca `number` para montos; redondeo explícito y a favor del operador (piso en USDC) | Regla dura de la skill `open-payments`; evita errores de coma flotante | `number`/`decimal.js` |
| Trabajo en segundo plano | Procesador de liquidación dentro del proceso: bucle de sondeo con retroceso, estado durable en SQLite, reanudable al arrancar, un solo dueño por `cash-in` | Polling verificado (~0–1.5 s); sin colas externas | Webhooks: el testnet no los necesita y exigen URL pública |
| Envío Stellar idempotente | Se construye y firma el sobre una vez, se guarda XDR + hash antes de enviar; el reintento reenvía el mismo XDR y consulta el hash en Horizon | El mismo número de secuencia no puede aplicarse dos veces: imposible pagar doble | Reconstruir la transacción en cada reintento |
| Pruebas | Vitest. Unitarias del dominio con `fast-check` (propiedades del dinero y de la máquina de estados); suites de contrato por puerto que corren contra el doble y contra testnet (`TESTNET=1`); integración HTTP con `inject()` + SQLite real; una prueba de punta a punta en testnet | «Pruebas reales»: el mismo contrato prueba el doble y la red, así el doble no miente | Solo mocks: pasan en verde y fallan en la demo |
| Calidad | `typescript-eslint` con reglas de tipos (`no-floating-promises`, `switch-exhaustiveness-check`), Prettier, cobertura ≥ 90 % de líneas en `domain/`, Stryker sobre `domain/` al final | Una promesa sin `await` en código de pagos es un bug silencioso | Biome: sin reglas que usan tipos |

## Alcance
Dentro: todos los endpoints de `team/contracts.md`; límites de nivel 1 por documento (tx/día/mes) y tope UIAF; `grant` diario con `interval` P1D y rotación de tokens; liquidación tienda → operador por Open Payments; USDC operador → cliente con `memo`; reintento de `failed_stellar`; vencimiento de cotizaciones; inventario y reposición de USDC de testnet (`path payment` XLM → USDC); salud y apagado ordenado.

Fuera (como en `PROJECT.md`): flujo inverso USDC → efectivo, cuenta Stellar patrocinada (se agregan como tareas si alcanza el tiempo), KYC real, nivel 2, múltiples tiendas (el modelo admite `storeId`, la demo usa una), autenticación del operador (requiere cambio de contrato, ver Riesgos), mainnet.

## Restricciones
- Solo testnet: `wallet.interledger-test.dev` y Stellar testnet. Leer `authServer`/`resourceServer` de la wallet address, nunca fijarlos (skill `open-payments`).
- Sin secretos en el repo: `.env` en la raíz (ignorado). `server/.env.example` solo con nombres. Nunca imprimir valores de configuración; `pino` redacta llaves, tokens y PII (teléfono, nombre, documento).
- El contrato manda: cualquier cambio de forma se propone primero en `team/contracts.md` y se avisa a `andss-ye`.
- Quedarse en `server/**` y `packages/contracts/**`; los archivos compartidos se tocan en commits mínimos.
- Todo el código se escribe durante el evento (`CLAUDE.md` regla 2).
- Prueba primero: cuando haya una prueba determinista ejecutable, se observa ROJO antes de implementar y VERDE después; la excepción se explica en la evidencia.
- ~400 líneas por tarea como guía, no como tope.

## Qué hace falta además del SDK
1. **Segunda billetera de testnet para el operador** (receptor) con su propia llave y key ID. La billetera COP que ya está en `.env` queda como la de la tienda (emisor).
2. **Cuenta Stellar del operador**: secreto de testnet fondeado con friendbot y `trustline` de USDC (ya verificado; solo falta guardarlo en `.env`).
3. Dependencias: `@interledger/open-payments@7.4.0`, `@stellar/stellar-sdk@14`, `fastify@5`, `zod`, `fastify-type-provider-zod`, `vitest`, `fast-check`, `typescript-eslint`, `prettier`, `@stryker-mutator/core`. Se fijan versiones exactas en B0.
4. Un consentimiento manual por día en la billetera de testnet (la prueba de punta a punta reutiliza ese `grant`).

Variables de entorno (nombres, sin valores; `.env` en la raíz). Credenciales ya presentes: tienda (COP) `WALLET_ADDRESS_URL`, `KEY_ID`, `TEST_KEY`; operador (USD) `WALLET_ADDRESS_URL_VENDEDOR`, `KEY_ID_VENDEDOR`, `TEST_KEY_VENDEDOR`; `STELLAR_OPERATOR_SECRET` (cuenta `GCDF7VTSBPXFQJJ4HQKP725J4FX43GWMIUUH5X4QYPNV3IF2RE2BCTXL`, fondeada, sin `trustline` todavía). `config.ts` lee esos nombres y los expone como `store` y `operator`; `PUBLIC_KEY*` no se usa. Con valores por defecto documentados: `STELLAR_USDC_ISSUER`, `HORIZON_URL`, `PUBLIC_BASE_URL`, `WEB_BASE_URL`, `REFERENCE_COP_PER_USD`, `SPREAD_PCT`, `DAILY_GRANT_LIMIT_COP`, `USDC_FLOAT`, `DATABASE_PATH`.

## Estructura
```
package.json                  # workspaces: ["server", "packages/*"]
packages/contracts/src/       # esquemas Zod de team/contracts.md + tipos inferidos
server/src/
  shared/                     # Money, Clock, IdGenerator, Result, errores de dominio
  cash-in/
    domain/                   # CashIn, máquina de estados, eventos
    application/              # createCashIn, confirmCashIn, retryCashIn, getCashIn, settlementProcessor
    ports.ts                  # CashInRepository, PaymentsNetwork, UsdcNetwork
  store-grant/                # grant diario: start, finish (hash), status, rotación
  treasury/                   # inventario, reserva, reposición
  pricing/                    # RateProvider, spread, conversión COP → USDC
  compliance/                 # política de niveles y tope UIAF
  adapters/
    open-payments/            # cliente del SDK para tienda y operador
    stellar/                  # Horizon, pago con memo, path payment, idempotencia
    sqlite/                   # migraciones y repositorios
    http/                     # rutas Fastify, mapeo de errores a ApiError
  config.ts                   # entorno validado con Zod; falla al arrancar
  main.ts                     # composición y arranque
server/test/                  # dobles, suites de contrato de puertos, e2e testnet
```

## Máquina de estados de `CashIn`
```
(crear) ─▶ quoted ──confirm──▶ settling ──OP completo──▶ settled ──▶ sending_usdc ──tx ok──▶ completed
  quoted ──vence──▶ expired
  settling ──OP falla──▶ failed_payment            (devolver billetes)
  sending_usdc ──tx falla──▶ failed_stellar ──retry──▶ sending_usdc
```
- `quoted`: `incoming payment` del operador + `quote` de la tienda creados; inventario de USDC reservado; vence en `min(quote.expiresAt, 60 s)`.
- `settling`: `outgoing payment` creado con el `grant` diario (rotación de token si hace falta).
- `settled`: `outgoing payment` con `sentAmount == debitAmount` **y** `incoming payment` del operador con `completed=true`.
- `sending_usdc`: sobre Stellar firmado y guardado antes de enviarse.
- Las transiciones no válidas son errores de dominio; cada transición incrementa `version` (concurrencia optimista).

## Tareas
Cada tarea: rama `feat/jonatin-backend`, prueba primero, verificación con los comandos indicados, commit de unidad de trabajo, evidencia aquí.

- [x] **B0 Monorepo y esqueleto de `server/`**: `package.json` raíz con workspaces, `server/` con TS estricto + `erasableSyntaxOnly`, ESLint con tipos, Prettier, Vitest con cobertura, `config.ts` (Zod, mensajes sin valores), `pino` con redacción, fábrica `buildApp()` de Fastify, `GET /healthz`, `server/.env.example`, `server/data/` en `.gitignore`. Verificar que `node:sqlite` y la eliminación de tipos funcionan en Node 24 y 26.
  - Acepta: `npm run -w server typecheck`, `lint`, `test` en verde; prueba de `/healthz` con `inject()`; la configuración inválida falla al arrancar sin imprimir valores.
- [x] **B1 Paquete de contratos**: esquemas Zod de todas las formas de `team/contracts.md` (`CashIn`, `Rate`, `Grant`, `Inventory`, `ApiError`, solicitudes) y tipos inferidos; montos como string decimal validado.
  - Acepta: pruebas con ejemplos válidos e inválidos por esquema; los tipos inferidos coinciden con `web/src/api/types.ts` (prueba de tipos con `expectTypeOf`, sin importar desde `web/`).
- [x] **B2 Núcleo del dominio**: `Money` (bigint, cambio de escala, redondeo explícito), conversión COP → USDC con spread, `CashIn` y su máquina de estados, política de niveles (100/150/500 USDC; tope UIAF COP 10M / 50M), puertos `Clock` e `IdGenerator`.
  - Acepta: pruebas de propiedades con `fast-check` (sin pérdida en ida y vuelta de escala, nunca se entrega más USDC que el cotizado, solo transiciones de la tabla); cobertura ≥ 90 % en `domain/`.
- [x] **B3 Persistencia SQLite**: migraciones, repositorios de `CashIn`, `StoreGrant`, uso de límites por documento e inventario; transacciones y conflicto de `version` como error tipado. Doble en memoria que pasa la misma suite.
  - Acepta: la suite de contrato del repositorio corre contra SQLite real (archivo temporal) y contra el doble; reabrir la base conserva los datos.
- [x] **B4 Precio**: puerto `RateProvider` con adaptador de tasa de referencia configurada + spread; `GET /api/rate`.
  - Acepta: prueba HTTP que valida la respuesta con el esquema de B1; `copPerUsdc` incluye el spread.
- [x] **B5 Adaptador de Open Payments**: clientes autenticados de tienda y operador, `incoming payment` (operador), `quote` (tienda), `outgoing payment` con token, lectura de estados. Primero un sondeo en testnet que confirme `assetScale` de COP y la comisión en COP → moneda del operador.
  - Acepta: suite de contrato del puerto `PaymentsNetwork` en verde contra el doble y contra testnet (`TESTNET=1`); errores del SDK mapeados a errores de dominio.
- [x] **B6 `grant` diario de la tienda**: `GET /api/grant/start` (GNAP interactivo, `interval` R/…/P1D, `debitAmount` diario, `nonce` guardado), `GET /api/grant/finish` (verifica `hash`, `grant.continue`, guarda token + `manage`, redirige a `WEB_BASE_URL/tienda?grant=ok|error`), `GET /api/grant` (estado, `spentCop` desde el libro propio), rotación de token serializada (antes de vencer o ante 401).
  - Acepta: vectores de prueba del `hash`; rotación con el doble (dos pagos, un consentimiento); consentimiento real en testnet registrado como evidencia.
- [x] **B7 Crear ingreso de efectivo**: `POST /api/cash-ins`: valida la dirección (StrKey + cuenta existente con `trustline` de USDC), límites del nivel 1, `grant` vigente con cupo, inventario (reserva), crea `incoming payment` + `quote`, guarda `quoted`.
  - Acepta: pruebas HTTP para el camino feliz y cada código (`limit_exceeded`, `no_grant`, `grant_exhausted`, `invalid_address`, `insufficient_inventory`) con dobles + SQLite real.
- [x] **B8 Adaptador Stellar**: preparación idempotente de la cuenta del operador al arrancar (crea la `trustline` de USDC si falta), lectura de saldo USDC, pago USDC con `memo`, envío idempotente (XDR + hash guardados, reenvío del mismo sobre, consulta por hash), reposición con `path payment` XLM → USDC hasta el flotante.
  - Acepta: suite de contrato de `UsdcNetwork` contra el doble y contra testnet; prueba de que el reintento tras un fallo de red no paga doble.
- [x] **B9 Confirmar y liquidar**: `POST /api/cash-ins/:id/confirm` (crea el `outgoing payment`, idempotente por estado), procesador de liquidación (sondeo con retroceso, reanuda al arrancar), barrido de vencimientos, `POST /api/cash-ins/:id/retry`, `GET /api/cash-ins/:id`.
  - Acepta: pruebas deterministas con reloj falso para cada transición; doble confirmación concurrente crea un solo pago; «caída» simulada entre `settled` y `sending_usdc` se recupera sin doble envío.
- [x] **B10 Vistas del operador**: `GET /api/operator/cash-ins`, `GET /api/operator/inventory`, `POST /api/operator/inventory/refill`.
  - Acepta: pruebas HTTP con esquemas de B1; un ingreso completado aparece primero y descuenta el inventario.
- [x] **B11 Punta a punta en testnet**: prueba que crea, confirma y completa un ingreso real con el `grant` del día; luego `web/` con `VITE_API_MOCK=0` (coordinar con W10 de `andss-ye`).
  - Acepta: hash de Stellar + id del `outgoing payment` + captura de Freighter en la evidencia.
- [ ] **B12 Endurecimiento y documentación**: límite de peticiones, manejador de errores uniforme, apagado ordenado (drena el procesador), auditoría de logs sin PII, Stryker sobre `domain/` (umbral acordado en la evidencia), `server/README.md`, `PROJECT.md` (Tecnología y arquitectura + columna «Dónde» del flujo de Open Payments).
  - Acepta: `npm test` completo en verde; puntaje de mutación registrado; ningún secreto en `git grep` con los valores de `.env`.

## Fase 2: conectar `web/` con el backend real
`web/` es de `andss-ye` (tareas `web-cajero` en `done` y `web-diseno` en `review`; W10 de `web-cajero` es justo este cambio). No se edita sin acuerdo: antes de F1 se agrega a esta tarea la ruta exacta que se toca (mínima, solo configuración de entorno y proxy) y se avisa a `andss-ye`. El cliente HTTP (`web/src/api/http.ts`) ya implementa el contrato; la fase 2 prueba que el backend lo cumple tal cual, sin reescribir pantallas.

- [ ] **F1 Contrato ejecutable**: prueba en `server/test/` que carga `web/src/api/types.ts` solo como lectura (sin editarlo) y verifica con `expectTypeOf` que los esquemas de `packages/contracts` producen los mismos tipos que usa el front; falla si divergen.
  - Acepta: la prueba falla si se cambia un campo en un lado y no en el otro.
- [ ] **F2 Arranque conjunto**: script raíz `npm run dev:all` (backend + `web/` con `VITE_API_MOCK=0` y `VITE_API_TARGET=http://localhost:3000`), `server/.env.example` con `WEB_BASE_URL`; verificar que el proxy de Vite reenvía `/api` y que el redirect del final del consentimiento llega a `/tienda?grant=ok|error`.
  - Acepta: con ambos corriendo, `/tienda` muestra el estado real del `grant` (`missing`) y `/operador` el inventario real.
- [ ] **F3 Recorrido con navegador contra testnet**: el `grant` diario por la pantalla real de consentimiento, un ingreso de efectivo completo desde la UI (datos → dirección Stellar → billetes → confirmar → comprobante), el pago visto en Freighter y en `/operador`; también los fallos reales: límite excedido, `grant` agotado, cotización vencida, `failed_stellar` + reintentar.
  - Acepta: evidencia con hash de Stellar, id del `outgoing payment` y capturas; cada fallo con salida en pantalla.
- [ ] **F4 Cierre con el dueño del front**: PR de las rutas de `web/` tocadas aprobado por `andss-ye`, W10 marcada por su dueño, `web/README.md` apunta a `npm run dev:all`.
  - Acepta: `npm test` de `web/` y de `server/` en verde en `main`.

## Bucle de ejecución (orquestador + subagentes)
Prompt para iniciar o retomar el bucle (por ejemplo con `/loop`):

> Lee `team/tasks/backend.md`, `CLAUDE.md` y `team/contracts.md`. Toma la primera tarea `B*` sin marcar cuyas anteriores estén marcadas. Delega UN implementador (`gentle-ai-cursor run implementer -C <raíz del repo> --timeout 1800 "<prompt>"`) con: la tarea completa, `## Allowed edit surfaces` = las rutas de la tarea dentro de `server/**` / `packages/contracts/**` (más los archivos compartidos que la tarea nombre), la skill `open-payments` cuando toque Open Payments, prueba primero y los comandos de «Acepta». Cuando vuelva, ejecuta tú uno de los comandos de verificación. Si todo está en verde: commit de unidad de trabajo en `feat/jonatin-backend` (conventional commit con emoji, sin atribución de IA), evalúa el commit con `gentle-ai review assess --cwd <raíz> --agent claude-code --base-ref <último límite revisado> --committed-only --json` y, si `review_due` es verdadero, sigue la revisión nativa (RDD); marca la tarea, escribe la evidencia, el riesgo evaluado y el progreso aquí. Si falla algo, o hace falta una decisión humana (credenciales, consentimiento en el navegador, cambio de contrato), detente y pregunta. Nunca hagas push sin permiso.

Entrega: PRs encadenados a `main` cada 2–3 tareas (≈400 líneas por PR): B0–B1, B2–B3, B4–B5, B6–B7, B8–B9, B10–B12.

## Hallazgos de revisión pendientes para B12
Aprobados con advertencias (no bloquean; se atienden en el endurecimiento):
- B5: `R3-invalidate-by-key` (la invalidación de la caché de grants tras un 401 debe usar la clave correcta) y nombres de `payments-network.ts:17,48-54`.
- B4+B6: `R1-unauth-grant-start` (`GET /api/grant/start` no tiene autenticación; el contrato lo define así y es testnet: decidir si se protege con un token de operador), `R4-mutex-held-over-network` (el mutex del servicio de grant se mantiene durante la llamada de rotación a la red: acotar con un tiempo límite), `R3-invalid-amount-status` (`invalid_amount` de dominio → 400 vs 500 según el origen), `R2-004` (migración 002 con valor por defecto vacío), `R2-001`, `R2-002`, `R2-003`, `R3-token-mutex-scope`.
- B8: `R3-prepare-dest-validation`, `R3-receive-liabilities`.
- B3: `R3-insert-nonpk-conflict`, `R3-listbystatus-unprepared`.

## Decisiones fijadas por la sonda (2026-10-17)
- El `incoming payment` del operador va en USD (escala 2), sin `incomingAmount`; el `quote` de la tienda usa `debitAmount` = efectivo en COP. La verdad de la liquidación es `quote.receiveAmount`.
- Con un incoming abierto, `completed` no se activa solo: B9 espera `outgoing payment` con `sentAmount == debitAmount` y `receivedAmount > 0` en el incoming, y luego el operador lo completa explícitamente (`complete`). B5 lo verifica en testnet; si se comporta distinto, se pasa a un `incomingAmount` calculado con una cotización previa.
- El mínimo operativo es 31.77 COP; las reglas de nivel 1 ya imponen montos mucho mayores. El vencimiento de la cotización de producto es `min(quote.expiresAt, 60 s)`.
- `REFERENCE_COP_PER_USD` por defecto pasa a 3177 (la tasa de testnet), de modo que el spread sea el único margen del operador.
- El cargador de llaves del backend reenvuelve un PEM de una sola línea y acepta una ruta de archivo.

## Riesgos
1. Los endpoints del operador no tienen autenticación en el contrato → aceptable en testnet; proponer un token de operador en `team/contracts.md` antes de B10 si `andss-ye` puede enviarlo.
2. La comisión de testnet: en COP → USD la sonda no encontró comisión fija (en EUR → EUR el débito se duplicaba) → el límite del `grant` se sigue calculando desde el `debitAmount` de la cotización, no desde el monto en efectivo.
3. El cliente sin `trustline` de USDC no puede recibir → `invalid_address` con detalle; la cuenta patrocinada queda como candidata.
4. Caída de testnet durante la demo → `grant` aprobado de antemano, inventario prefondeado y el procesador reanuda al volver la red.

## Evidencia
- Sonda de testnet COP → USD (2026-10-17, sin commit; scripts descartados): la billetera de la tienda es COP escala 2 y la del operador USD escala 2. Cotización con débito fijo en COP: lineal a ≈3176.98 COP por USD, `receiveAmount` con piso al centavo y `debitAmount` con techo al centavo, sin comisión fija; 20,000 COP → 6.29 USD, 100,000 → 31.47, 412,000 → 129.68. Mínimo que funciona: 31.77 COP → 0.01 USD (31.76 COP responde 400 `non-positive receive amount`). El `quote` vive 300 s; el `incoming payment` 30 días. Un `incomingAmount` en COP sobre la billetera USD responde 400. Un débito fijo contra un incoming sin `incomingAmount` se acepta y deja `completed: false`. El SDK no carga un PEM en una sola línea: hay que reenvolverlo en líneas de 64 caracteres.
- B2 (2026-10-17, commits `ed761c2`, `3a1e9a6`): ROJO (6 suites sin módulos), VERDE 113 pruebas con propiedades de fast-check (dinero, cotización, límites, todas las parejas estado × evento, secuencias aleatorias); cobertura de líneas 100 % en shared, pricing y compliance, 95,65 % en cash-in/domain. Revisión nativa aprobada; el hallazgo del memo vacío se corrigió con prueba.
- B3 (commit `91a4a29`): contratos de repositorio contra el doble, `:memory:` y archivo; CAS con carrera de dos `save`, enteros mayores que 2^53, fronteras UTC de uso diario y mensual, migraciones idempotentes que rechazan un esquema más nuevo; cobertura de `src/adapters/sqlite` 99,24 % de líneas. Revisión aprobada.
- B5 (commits `e7ff516`, `fccddeb`): PaymentsNetwork contra testnet con TESTNET=1 (cotización COP→USD, incoming sin completar, rechazo bajo el mínimo); revisión nativa de riesgo alto aprobada dos veces; corregido: el hash de finalización exige el endpoint del grant, caché de grants con una sola petición en vuelo y reintento ante 401, pruebas unitarias del adaptador. Pendiente de B12: `R3-invalidate-by-key` (invalidación de la caché por clave) y nombres de los hallazgos R2. Aún sin verificar en testnet: pago saliente y GrantGateway (requieren consentimiento humano; B11).
- B8 (commit `08cd21a`): contrato UsdcNetwork 18 pruebas en testnet con TESTNET=1: la reposición XLM→USDC encontró ruta y fondeó al operador, el reenvío del mismo sobre mueve el saldo una sola vez, `tx_bad_seq` se clasifica desde ambas formas de error de Horizon. Revisión aprobada.
- B7 (commits `6dbfca2` y anteriores): creación de ingreso con mutex único para límites, cupo e inventario; `Idempotency-Key` con índice único; expiración perezosa; revisión nativa sin hallazgos.
- B10 (commit `bab3aab`): servicio del operador con aritmética exacta en bigint, reposición serializada; cableado propio en `compose.ts`.
- B9a (commit `2f6ea65`): confirmar reclama antes de llamar a la red (una caída no crea un segundo pago saliente); dos eventos nuevos de dominio (`OutgoingCreated`, `UsdcEnvelopeRebuilt`).
- B9b (commit `20214c4`): procesador de liquidación durable: un paso por pasada, cada transición guardada antes del siguiente efecto, reenvío del mismo sobre tras una caída, reconstrucción solo con el sobre demostrado muerto; pruebas de recuperación ante caídas y de dos procesadores; flujo completo por HTTP con dobles. Revisión nativa de riesgo alto aprobada con una advertencia de seguridad (carrera de doble pago al reconstruir) que se corrige en H3.
- H1 (`e2497bd`), H2 (`5f0c05a`): endurecimiento tras revisiones: tiempo límite de rotación con persistencia del resultado tardío, `invalid_amount` no capturado → 500, reposición con reservado, validación de destino.
- B11 (2026-10-17, commit `bde0315`): recorrido REAL en testnet de punta a punta, sin dobles: `grant` diario aprobado por el dueño (limit consentido 2.000.000 COP; el backend aplica su tope de 500.000), cotización COP→USD con las billeteras reales (20.000 COP → 6,11 USDC a 3272,31), `confirm` → `outgoing payment` real → incoming completado → USDC enviado: estados `settling` (+9,9 s) → `settled` (+16,0 s) → `sending_usdc` (+18,0 s) → `completed` (+27,0 s). Verificado en Horizon: transacción `6aedf0969c4e6734fbd5cc4b61fd98ae21777f9638a26fda472b06366a0f758d`, exitosa, ledger 5242133, `memo` WALLE-E2F38489, pago de 6,1100000 USDC (emisor GBBD47…) a la dirección Freighter del cliente; inventario del operador 17,60 → 11,49. El primer intento reveló un defecto real (un POST sin cuerpo con content-type JSON respondía 500): corregido con prueba en `bde0315`. El `grant` sobrevivió a dos reinicios del servidor.
- B1 (2026-10-17, commit `08f287b`): ROJO (módulo inexistente), VERDE 80 pruebas del paquete + 17 del servidor, `typecheck`, `lint` y Prettier en verde; revisión nativa aprobada sin hallazgos.
- B0 (2026-10-17, commit `fee2141`): ROJO observado (2 archivos sin módulo); VERDE: `typecheck`, `lint`, `format:check` y `vitest` 17/17; `node src/main.ts` arranca con la eliminación nativa de tipos y `/healthz` responde 200; `node:sqlite` importa en Node 24.5 (aviso de API experimental); el `.env` real carga (ajuste: las direcciones de billetera aceptan `$host/ruta`, `host/ruta` o URL completa); 13 pruebas de `scripts/` en verde; 0 valores de `.env` en el diff. Riesgo evaluado: medio, revisión nativa concedida y aprobada con 3 hallazgos informativos (validación del archivo de llave, cobertura de ramas de `loadConfig`, comodines de `redact`), pendientes para B12. Versiones fijadas: fastify 5.12.5, zod 4.6.5, fastify-type-provider-zod 7.0.0, typescript 6.0.3, vitest 5.0.3, eslint 10.12.0, typescript-eslint 8.71.0, prettier 3.9.9, fast-check 4.10.2.

## Progreso
2026-10-16: plan y reclamo creados.
2026-10-17: B0 listo (`fee2141`). Siguiente tanda en paralelo con un `git worktree` por worker: B1, B2 y una sonda de COP → USD en testnet.
2026-10-17: credenciales listas en `.env` (billetera USD del operador, cuenta Stellar del operador fondeada con friendbot). Se mantiene el plan completo B0–B12. Reclamo en `in-progress`.

## Siguiente paso
Tanda 1: B1 + B2 + sonda de testnet (paralelo); luego B3, B5, B8.
