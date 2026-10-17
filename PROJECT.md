# Proyecto

**Estado:** IDEA LISTA (2026-10-16). Pendiente durante el evento: tecnología y arquitectura, división de tareas (`/team-plan`), guion de la demo (se escribe cuando la construcción funcione).

## En una línea
Entra efectivo, sale cripto: un punto de efectivo (cajero o tienda de barrio) que convierte billetes en USDC en la billetera Stellar propia del cliente, con Open Payments como red abierta de liquidación entre los puntos de efectivo y el operador.

## Problema y usuario
- Usuario: personas que viven del efectivo y no tienen cuenta bancaria, pero quieren dólares digitales (USDC) — para ahorrar en una moneda estable o recibir y enviar valor.
- Problema: comprar cripto hoy exige un banco o una cuenta digital para fondear un exchange. Una billetera cripto de autocustodia no necesita banco, pero no hay una forma simple de meterle efectivo.

## Solución
- El cliente entrega efectivo en un punto y recibe USDC en su billetera Stellar (solo hace falta un teléfono o un QR impreso). La dirección inversa (USDC → efectivo) es candidata, no está decidida.
- Cada punto de efectivo tiene una billetera de Open Payments. Cuando recibe efectivo, paga al operador por Open Payments (solicitud → autorización → ejecución → finalización). Cuando ese pago termina, el operador envía USDC en Stellar.
- El operador puede crear y patrocinar la cuenta Stellar del cliente y la `trustline` de USDC, así el cliente no necesita XLM (verificado en testnet el 2026-10-16).
- Precedente para la presentación: MoneyGram ofrece efectivo ↔ USDC en Stellar en más de 170 países; nuestra diferencia es la liquidación abierta entre cualquier punto de efectivo vía Open Payments.
- Supuestos: el operador tiene licencia y se encarga de KYC/AML y de los límites por transacción.

## Categoría de premio a la que apuntamos (elige una principal)
- [ ] Impacto (RutaN) · [ ] Inclusión (Puntored) · [x] Innovación (FIND EAFIT) · [ ] Comunidad (This Week in Fintech)

Por qué esta: la cripto es la protagonista; la innovación es unir efectivo, liquidación por Open Payments y USDC en Stellar en un solo flujo. Ángulo secundario: inclusión de personas que solo usan efectivo.

## Verificado en testnet (2026-10-16)
- Stellar testnet: fondeo con friendbot, `trustline` de USDC, `path payment` XLM→USDC, cuenta del cliente patrocinada por el operador (el cliente tiene 0 XLM), pago fijo de USDC desde el inventario del operador.
- Freighter (extensión de navegador, Testnet) muestra el USDC entrante y el `memo` del pago: sirve como billetera del cliente en la demo.
- Open Payments: el receptor detecta los `incoming payment` completados por sondeo (`polling`, `completed=true` en ~0–1.5 s); no hacen falta webhooks.
- Open Payments: UN consentimiento interactivo con `interval` P1D + límite `debitAmount` cubrió DOS `outgoing payment`, con rotación de tokens (los tokens duran 10 min).
- Open Payments entre divisas: una billetera COP cotizó pagos hacia una billetera EUR (tasa de testnet ≈3,552 COP/EUR, lineal, sin comisión fija observada; 100,000 COP → 28.15 EUR). Los pagos pequeños EUR→EUR en la misma divisa mostraron que la comisión de testnet duplicaba el débito (2.00 debitado → 1.00 recibido).
- La billetera de testnet admite COP, USD, EUR, MXN y más (interledger/testnet `gatehub/consts.ts`).

## Modelo de negocio (propuesta; las cifras son supuestos de la presentación)
- Ingresos: margen cambiario sobre la tasa de referencia COP/USD (decidido). Cifras para la presentación: cotizar a mid + 3%, 0.8% para el punto de efectivo, ~0.5% para reponer USDC, ~1.7% neto. Referencia: los cajeros de Bitcoin cobran una mediana de ~16% (Kansas City Fed, datos de Coin ATM Radar de 2023).
- Dos inventarios, como los agentes de M-Pesa / los corresponsales colombianos: la tienda se queda con los billetes; el operador tiene la tesorería de USDC. Cada ingreso de efectivo se liquida tienda → operador por Open Payments en tiempo real; el USDC va operador → cliente en Stellar.
- Reposición: empezar el día con un flotante de USDC (p. ej. 1,000 USDC); cuando baja de ~30%, comprar USDC en un exchange local con los COP que depositaron las tiendas. Nunca por cliente. Demo: USDC de testnet prefondeado; reponer = un botón.
- Los puntos de efectivo autorizan UN `grant` de Open Payments por día con un límite de débito diario (verificado en testnet: un consentimiento, dos pagos, rotación de tokens).

## Límites y cumplimiento (propuesta)
| Nivel | Verificación | Por tx | Por día | Por mes |
|---|---|---|---|---|
| 1 Mostrador | teléfono + nombre completo + número de documento | 100 USDC | 150 USDC | 500 USDC |
| 2 Verificado | foto del documento + prueba de vida, cribado de sanciones/PEP | 500 USDC | 1,000 USDC | 3,000 USDC |
| Alto | un efectivo individual ≥ COP 10,000,000, o ≥ COP 50,000,000 en un mes, o hallazgo de riesgo | sin venta | escalar | reportar |
- Base: umbrales de reporte de transacciones en efectivo de la UIAF, COP 10M individual / COP 50M mensual múltiple (orientación de la SFC); DIAN Resolución 000240 de 2025 (reporte de proveedores de servicios de criptoactivos, desde el año gravable 2026); todavía no hay una ley integral de cripto. Límites de on-ramp de MoneyGram Access: 5–950 USDC por transacción.
- El operador decide el KYC; la tienda solo cuenta billetes. Se asume un operador con licencia.

## Diferenciación (borrador)
«Cualquier tienda de barrio se vuelve un punto de efectivo a USDC: liquida con el operador por Open Payments y los dólares llegan a la billetera Stellar propia del cliente — sin cuenta en un exchange, sin red cerrada de agentes, sin comisiones de cajero.»
- vs MoneyGram Access: marca cerrada de agentes; nosotros somos una red abierta (una tienda nueva = una billetera nueva de Open Payments).
- vs Binance P2P / Bitso / Littio: necesitan una app, un banco o una cuenta de exchange y conservan la custodia; lo nuestro es efectivo en el mostrador hacia autocustodia.
- vs cajeros de Bitcoin: hardware + comisiones de ~16%; lo nuestro es una tienda con un teléfono.

## Flujo de Open Payments (obligatorio)
Qué billeteras son emisor y receptor, y dónde vive cada paso en el código:

| Paso | Qué ocurre | Dónde (archivo/módulo) | Dueño |
|---|---|---|---|
| Solicitud de pago (`incoming payment` / `quote`) | El operador crea un `incoming payment` en su billetera USD (escala 2, sin monto fijo); la billetera COP de la tienda lo cotiza (`quote`) con el efectivo como débito fijo | `server/src/cash-in/application/create-cash-in.ts`, `server/src/adapters/open-payments/payments-network.ts` | backend (jonatin) |
| Autorización (`grant` GNAP + consentimiento) | El dueño de la tienda aprueba UN `grant` de `outgoing payment` por día con un límite diario en COP (`interval` P1D) | `server/src/store-grant/application/store-grant-service.ts`, `server/src/adapters/open-payments/grant-gateway.ts` | backend (jonatin) |
| Ejecución del pago (`outgoing payment`) | La billetera de la tienda paga al operador por cada ingreso de efectivo, reutilizando el `grant` diario (rotación de tokens) | `server/src/cash-in/application/confirm-cash-in.ts`, `server/src/cash-in/application/settlement-processor.ts` | backend (jonatin) |
| Finalización exitosa mostrada al usuario | El operador ve el pago recibido, completa el `incoming payment` y entonces envía USDC en Stellar; el cliente lo ve en Freighter | `server/src/cash-in/application/settlement-processor.ts`, `server/src/adapters/stellar/usdc-network.ts` | backend (jonatin) |

Emisor: la billetera de Open Payments del punto de efectivo (COP, testnet). Receptor: la billetera de Open Payments del operador (COP u otra divisa, testnet). Lado del cliente: billetera de USDC en Stellar testnet (Freighter).

## Alcance del MVP (tiene que funcionar en una demo de 5 minutos)
- Dentro: ingreso de efectivo en vivo de punta a punta con cuentas de prueba — la tienda ingresa el monto en efectivo + la dirección Stellar del cliente → cotización en COP y USDC → liquidación por Open Payments tienda → operador → el operador envía USDC de testnet → el cliente lo ve en Freighter. Autorización diaria de la tienda (un consentimiento). Vista del operador de los pagos liquidados y del inventario de USDC. Límites del nivel de KYC aplicados como reglas simples (sin verificación real de identidad).
- Candidato si alcanza el tiempo: flujo inverso USDC → efectivo; creación de cuenta patrocinada para clientes sin cuenta Stellar.
- Fuera (explícitamente no se hace): dinero real o mainnet, KYC o prueba de vida reales, hardware de cajero físico, integración con un exchange para la reposición (un botón rellena USDC de prueba), autoalojar Rafiki, estándares de ancla de Stellar (SEP-24).

## Tecnología y arquitectura
- **Lenguaje y ejecución:** Node.js ≥ 24 con TypeScript estricto, ejecutado directamente por Node (sin paso de compilación); `tsc` solo verifica los tipos. Monorepo con `npm workspaces`: `server/` (backend) y `packages/contracts/` (esquemas Zod del API, fuente de verdad de las formas HTTP). `web/` (front de otro integrante) queda fuera de los workspaces y conserva su propio lockfile.
- **Arquitectura hexagonal** en `server/src`: dominio puro (`cash-in/domain`, `pricing`, `compliance`, `shared`), servicios de aplicación (`cash-in/application`, `store-grant/application`, `treasury/application`) que dependen solo de puertos, y adaptadores (`adapters/open-payments`, `adapters/stellar`, `adapters/sqlite`, `adapters/http`). `compose.ts` es el único punto de composición.
- **Dinero:** `bigint` en unidades menores con `assetCode` y `assetScale`, nunca `number`. El USDC que recibe el cliente se redondea hacia abajo; el spread, hacia arriba.
- **Persistencia:** SQLite (`node:sqlite`) con migraciones versionadas y guardado con control de versión optimista; el estado de cada ingreso sobrevive a un reinicio.
- **Liquidación:** un procesador dentro del proceso avanza cada ingreso un paso durable por pasada. El sobre de Stellar se firma y se guarda antes de enviarse; un reintento reenvía el mismo sobre y solo se reconstruye cuando se demuestra que el anterior nunca podrá aplicarse (doble verificación espaciada), de modo que el USDC sale como máximo una vez.
- **Open Payments:** SDK `@interledger/open-payments` 7.4.0; `grant` de salida interactivo con `interval` diario, rotación de tokens serializada que conserva el resultado tardío, y recuperación de un pago saliente por su `quote`.
- **Stellar:** `@stellar/stellar-sdk` 14, testnet; envío de USDC con `memo`, recarga del inventario por `path payment` XLM → USDC.
- **Pruebas:** Vitest; propiedades con `fast-check` sobre el dinero y la máquina de estados; suites de contrato por puerto que corren contra el doble en memoria y, con `TESTNET=1`, contra la red real; pruebas de recuperación ante caídas y de dos procesadores; pruebas de que el contrato coincide con los tipos del front. Cada unidad de trabajo pasó una revisión nativa y sus hallazgos se anotan en `team/tasks/backend.md`.

## Guion de la demo (5 min: reto → usuario → solución → pago en vivo → conclusiones)
_Pendiente_

## Riesgos
1. Open Payments se liquidó pero el pago en Stellar falla → cola de reintento o reembolso del lado del operador; respaldo de la demo: mostrar el pago pendiente y reintentar.
2. Caída de la testnet o límite de peticiones (`rate limit`) de friendbot o de la testnet de Interledger → cuentas prefondeadas y `grant` diario preaprobado antes de la demo.
3. La cripto opaca el flujo obligatorio de Open Payments en la evaluación → la demo muestra las dos patas de forma explícita.
4. Las tasas de cambio de testnet no son tasas de mercado → decirlo y usar nuestra propia tasa de referencia para el precio del USDC.
