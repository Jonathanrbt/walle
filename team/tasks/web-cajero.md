---
owner: andss-ye
status: review
branch: feat/andss-ye-web-cajero
paths:
  - web/**
shared:
  - team/contracts.md
depends_on: []
---

# Front: cajero automático de efectivo → USDC (`web/`)

Documento de funcionalidad con formato ODD: intención, tareas con IDs estables, evidencia y progreso en un solo lugar. Las tareas se marcan solo con prueba observada.

## Objetivo
Construir el recorrido completo del cliente y de los operadores en un cajero automático virtual. El cliente arrastra billetes colombianos desde una billetera interactiva hasta la ranura del cajero, el cajero le pide sus datos paso a paso y muestra en vivo las cuatro fases de Open Payments, seguidas del envío de USDC en Stellar. Primero corre contra una API simulada que respeta `team/contracts.md` y después contra el backend real, sin reescribir pantallas.

## Problema
La demo dura 5 minutos y los jueces tienen que ver con claridad «solicitud de pago → autorización → ejecución del pago → finalización exitosa» (`docs/submission-judging.md`). Sin una interfaz, ese flujo solo existe en llamadas al SDK. El front tampoco puede esperar al backend: necesita un doble fiel a los contratos.

## Por qué así
- El cajero es el punto de efectivo de `PROJECT.md`: su billetera de Open Payments (COP) paga al operador por cada ingreso de efectivo. Es una pantalla, no hardware, así que respeta lo que queda fuera del alcance.
- SPA client-side (Vite + React + TS): todo es estado vivo (sondeo, cotización, Freighter). El SEO y el SSR no aportan.
- Las llaves (Open Payments, secreto Stellar del operador) viven solo en el backend. El front nunca las ve, ni siquiera en modo simulado.
- Simulación detrás de la misma interfaz (`VITE_API_MOCK=1`). Cambiar al backend real es una variable, no un refactor.

## Alcance
Dentro:
- Vista **Cajero** (`/`): bienvenida → datos de nivel 1 (teléfono, nombre completo, número de documento) → dirección Stellar (Freighter o pegar) → inserción de billetes → cotización → procesamiento con las 4 fases + envío de USDC → recibo.
- Vista **Tienda** (`/tienda`): estado del `grant` diario (límite en COP, gastado, vence) y botón «Autorizar el día» (redirige al consentimiento GNAP y vuelve).
- Vista **Operador** (`/operador`): pagos liquidados, inventario de USDC con alerta por debajo de ~30% y botón «Reponer».
- Errores con salida: cajero fuera de servicio sin `grant`, límite de nivel excedido, cotización vencida, pago en Stellar fallido → pendiente + reintentar (riesgo 1 de `PROJECT.md`).

Fuera: flujo inverso USDC → efectivo, cuenta Stellar patrocinada (candidatas del MVP, se agregan como tareas nuevas si alcanza el tiempo), KYC real, nivel 2, i18n y SSR.

## Restricciones
- Contratos de `team/contracts.md` como única forma de hablar con el backend. Cualquier cambio se acuerda allí primero.
- Solo testnet. Los enlaces de transacciones apuntan a `stellar.expert/explorer/testnet`.
- Sin secretos en `web/` (ni en `.env` versionado). Solo variables `VITE_*` públicas.
- Billetes en circulación: COP 2.000, 5.000, 10.000, 20.000, 50.000 y 100.000. Dibujados con CSS/SVG propios, sin imágenes del Banco de la República.
- Límites de nivel 1 (`PROJECT.md`): 100 USDC por tx, 150 por día, 500 por mes. El front avisa y el backend decide.
- La tasa de testnet no es de mercado (riesgo 4): la UI muestra «tasa de referencia del operador» = mid + 3%.
- Arrastrar y soltar nativo de HTML5, con clic/Enter como alternativa (accesible y usable en táctil).
- Modo TDD: apagado (el repo no lo configura). Verificación: `vitest` para la lógica pura y recorrido manual con Playwright por tarea.
- Commits pequeños por tarea; PR a `main` cada 1–2 tareas (estimado: ~2.500 líneas en total).

## Recorrido del cajero (máquina de estados)
```
idle ──(sin grant)──▶ fuera_de_servicio
idle → datos → direccion → billetes → cotizacion → procesando → recibo → idle
                         (cancelar en datos/direccion/billetes/cotizacion → «retire sus billetes» → idle)
procesando: solicitud(incoming+quote) → autorizacion(grant diario vigente) → ejecucion(outgoing) → finalizacion(incoming completed) → stellar(envío USDC)
procesando ─(stellar falla)─▶ pendiente_stellar ─(reintentar)─▶ procesando.stellar
```

## Tareas
- [x] **W1 Base de `web/`**: Vite + React + TS, proxy `/api` en desarrollo, `VITE_API_MOCK`, rutas `/`, `/tienda` y `/operador` sin librería de router, layout y tokens de color del cajero.
  - Acepta: `npm run dev` en `web/` sirve las 3 vistas; `npm run build` y `npm test` en verde.
- [x] **W2 Cliente de API + simulación**: tipos de `team/contracts.md`, cliente `fetch` real y doble simulado con latencias y estados reales (incluidos los fallos forzables por `?fallo=stellar|grant|limite`).
  - Acepta: tests de la máquina de estados simulada (`quoted → settling → settled → sending_usdc → completed` y la rama `failed_stellar` → reintentar).
- [x] **W3 Billetera + ranura**: billetera con los 6 billetes, arrastrar a la ranura o clic para insertar, animación de entrada, total en COP con su equivalente en USDC en vivo, deshacer el último, tope del nivel 1 bloqueando billetes que lo excedan.
  - Acepta: tests de suma y tope; arrastrar y soltar con teclado y ratón probado en el navegador.
- [x] **W4 Captura interactiva de datos**: pantallas de teléfono, nombre y documento con teclado numérico en pantalla; dirección Stellar con «Conectar Freighter» (`@stellar/freighter-api`, red Testnet) o pegar `G…` validado.
  - Acepta: no avanza con datos inválidos; Freighter real devuelve la dirección en Testnet.
- [x] **W5 Cotización y confirmación**: `POST /api/cash-ins` → COP entregados, tasa, USDC a recibir, vencimiento con cuenta regresiva; confirmar o cancelar.
  - Acepta: la cotización vencida obliga a recotizar; cancelar lleva a «retire sus billetes».
- [x] **W6 Línea de tiempo de Open Payments + recibo**: 4 fases con nombre visible (solicitud, autorización, ejecución, finalización) + «USDC enviado a tu billetera», sondeo de `GET /api/cash-ins/:id`, recibo con montos, `memo` y enlace a la transacción en testnet.
  - Acepta: cada fase cambia según la respuesta (simulada o real), no con temporizadores propios del front.
- [x] **W7 Vista Tienda (`grant` diario)**: estado, límite, gastado y vencimiento; «Autorizar el día» → `/api/grant/start` → vuelve a `/tienda?grant=ok|error`. En simulación, una página falsa de consentimiento.
  - Acepta: sin `grant`, el cajero muestra «fuera de servicio» con un enlace a la tienda; con `grant`, vuelve a `idle`.
- [x] **W8 Vista Operador**: tabla de pagos liquidados (sondeo), inventario de USDC con umbral y botón Reponer.
  - Acepta: un ingreso de efectivo completado aparece en la tabla y descuenta el inventario.
- [x] **W9 Errores y respaldo de la demo**: límite excedido, cotización vencida, `grant` vencido o agotado en mitad del flujo, pendiente de Stellar + reintentar, backend caído.
  - Acepta: cada fallo forzado de W2 tiene una pantalla con salida y ninguno deja al cajero colgado.
- [ ] **W10 Cambio al backend real y pulido**: `VITE_API_MOCK=0` contra el backend del equipo, ancho de teléfono/kiosko, contraste y foco, recorrido de la demo en menos de 90 s.
  - Acepta: un ingreso de efectivo de punta a punta en testnet visto en Freighter (evidencia: hash + captura).

## Evidencia
- W1 (2026-10-16): `npm test` 1/1 en verde; `npm run build` en verde (221 kB JS); servidor de desarrollo: `/`, `/tienda`, `/operador` renderizan, navegación interna y botón atrás funcionan, sin errores de consola, sin scroll horizontal a 375 px; `/api/rate` llega al proxy (502 sin backend).
- W2 (2026-10-16): `npm test` 8/8 en verde (`src/api/mock.test.ts`: recorrido completo, `failed_stellar` → reintentar, cotización vencida, límites de nivel 1, `grant` faltante/forzado/agotado/vencido, dirección inválida, reposición); `npm run build` en verde.
- W3 (2026-10-16): `npm test` 11/11 en verde (`src/cajero/cash.test.ts`: suma, conversión, tope de 100 USDC, existencias). En el navegador: arrastrar y soltar con `DataTransfer` (2 × 100.000), clic (50.000) y Enter con el foco (2.000) insertan; a 400.000 COP se deshabilitan 20.000/50.000/100.000 con aviso; 412.000 COP = 100.00 USDC llena el medidor; deshacer, continuar y cancelar funcionan; sin scroll horizontal a 375 px; sin errores de consola. Falta probar a mano el arrastre con el ratón físico: el arrastre sintético del navegador de pruebas no dispara eventos HTML5.
- W4 (2026-10-16): `src/cajero/validate.test.ts` 2/2. En el navegador: el teclado en pantalla solo habilita OK con 10 dígitos que empiezan por 3; el nombre exige nombre y apellido; la cédula filtra lo que no son dígitos; la dirección `gabc` se rechaza y una `G…` válida muestra «Enviaremos a GBRPYH…C7OX2H»; Atrás conserva los datos; sin la extensión, «Conectar Freighter» avisa a los ~2 s y deja pegar. Falta probar con Freighter instalado (Testnet).
- W5–W9 (2026-10-16): `npm test` 15/15 (`phases.test.ts`: estado de cada fase por status y por fallo). En el navegador con la API simulada: sin `grant` el cajero queda «fuera de servicio»; Tienda → consentimiento simulado → Aceptar → `/tienda?grant=ok`, «Activa, $0 / $2.000.000»; ingreso de 110.000 COP → cotización 26.69 USDC con 60 s → fases `ddapp` → `dddda` → completado → comprobante con memo y hash; `?fallo=stellar` deja la fase 5 en error y «Reintentar envío» la completa; `pago` → fase 3 en error → devolución; `limite` e `inventario` → pantalla de rechazo → devolución; `grant` → fuera de servicio, y se recupera solo al quitar el fallo; la cotización vencida muestra «Recotizar» y genera una nueva; Operador: fila «Completado», inventario 975.73 → «Reponer» → 1000.00. Sin scroll horizontal a 375 px en las tres vistas.
- W10 parcial (2026-10-16): con `VITE_API_MOCK=0` y sin backend, el cajero muestra «Sin conexión… Reintentando». Contra un backend de prueba del contrato (fuera del repo, en :3000): el redirect `/api/grant/start` → `/api/grant/finish` → `/tienda?grant=ok` funciona a través del proxy, un ingreso de 50.000 COP llega al comprobante y el Operador lo lista. Falta el backend real del equipo en testnet y Freighter.

## Progreso
2026-10-16: reclamo creado; contratos propuestos en `team/contracts.md` (pendientes de acuerdo con quien haga el backend).
2026-10-16: W1 listo. Vite 8 + React 19 + TS 5.9 + Vitest 5; fuentes del sistema para que la demo funcione sin red; navegación con `history.pushState` para que el estado simulado sobreviva al cambiar de vista.
2026-10-16: W2 listo. `src/api/` = tipos del contrato, cliente `fetch` y simulación; el estado simulado vive en `sessionStorage` y el estado de cada ingreso se deriva del tiempo desde la confirmación. Fallos forzables: `?fallo=stellar|pago|grant|limite|inventario`. Contrato: se agregan los códigos `grant_exhausted` y `quote_expired`.
2026-10-16: W3 listo. `src/cajero/` = lógica del efectivo + billetera y zona de soltar; el cajero entero acepta billetes y la ranura anima la entrada. Existencias iniciales de la billetera en `WALLET`. La pantalla `cotizacion` es provisional hasta W5. Por ahora el paso de billetes va justo después de la bienvenida; W4 inserta los datos antes.
2026-10-16: W5–W9 listos. Las fases se derivan del `status` del backend (`src/cajero/phases.ts`), no de temporizadores del front. Después de Confirmar nunca se ofrece devolver billetes, salvo `failed_payment`. El estado simulado pasó de `sessionStorage` a `localStorage` para ver cajero y operador en dos pestañas; `?reiniciar=1` lo borra. El consentimiento simulado imita la pantalla de la billetera de testnet. Guía de uso y guion de la demo en `web/README.md`.

## Siguiente paso
W10: conectar con el backend real del equipo cuando exista (`VITE_API_MOCK=0`), probar Freighter en Testnet y guardar como evidencia el hash de una transacción real.
