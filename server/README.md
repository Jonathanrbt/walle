# Servidor

Instalación desde la raíz del repositorio:

```bash
npm install
```

Las variables de entorno viven en el `.env` de la raíz (ese archivo no se versiona). Los nombres y los valores por defecto están en `server/.env.example`.

Desarrollo, con reinicio al cambiar archivos:

```bash
npm run -w server dev
```

Pruebas:

```bash
npm run -w server test
```

## Correr backend y front juntos

Desde la raíz del repositorio:

```bash
npm run dev:all
```

Eso arranca el backend (`npm run -w server dev`, puerto 3000) y el front (`npm --prefix web run dev`) con `VITE_API_MOCK=0` y `VITE_API_TARGET=http://localhost:3000`. Cada línea de salida lleva el prefijo `[server]` o `[web]`. Si falta `web/node_modules`, el script imprime `run: npm --prefix web ci` y termina sin levantar procesos. `npm run dev:server` arranca solo el backend.

Ctrl+C reenvía la señal a ambos procesos.

## Probar contra testnet

Los valores van en el `.env` de la raíz (no se versiona). Solo los nombres: `WALLET_ADDRESS_URL`, `KEY_ID`, `TEST_KEY` (tienda, COP), `WALLET_ADDRESS_URL_VENDEDOR`, `KEY_ID_VENDEDOR`, `TEST_KEY_VENDEDOR` (operador, USD), `STELLAR_OPERATOR_SECRET`, `HORIZON_URL`, `STELLAR_USDC_ISSUER`, `PUBLIC_BASE_URL`, `WEB_BASE_URL`, `REFERENCE_COP_PER_USD`, `SPREAD_PCT`, `DAILY_GRANT_LIMIT_COP`, `USDC_FLOAT`, `DATABASE_PATH`, `PORT`, `LOG_LEVEL`. Los valores por defecto están en `server/.env.example`.

El consentimiento diario de la tienda se hace en el front: abrir `/tienda` y pulsar «Autorizar el día». El redirect de vuelta llega a `/tienda?grant=ok` o `/tienda?grant=error`.

Para reponer USDC de testnet hasta el flotante:

```bash
curl -X POST http://localhost:3000/api/operator/inventory/refill
```

Los logs salen por stdout (pino). Con `dev:all` se distinguen por el prefijo `[server]`. No pegar llaves, tokens ni datos de clientes en el repositorio ni en capturas.
