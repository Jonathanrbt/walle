# web — cajero de efectivo a USDC

SPA en Vite + React + TypeScript. Tiene tres vistas:

| Ruta | Quién la usa | Qué muestra |
|---|---|---|
| `/` | Cliente en el cajero | Datos → dirección Stellar → billetes → cotización → las 4 fases de Open Payments + envío de USDC → comprobante |
| `/tienda` | Dueño del punto de efectivo | `grant` diario (GNAP): estado, límite usado, botón «Autorizar el día» |
| `/operador` | Operador | Pagos recibidos por Open Payments, inventario de USDC, botón «Reponer» |

El front solo habla con el backend por los contratos de `team/contracts.md`. Las llaves de Open Payments y de Stellar viven en el backend, nunca aquí.

## Correr

```bash
cd web
npm install
cp .env.example .env
npm run dev
```

- `VITE_API_MOCK=1` (por defecto): backend simulado en el navegador. El estado vive en `localStorage`, así que el cajero y el operador pueden abrirse en dos pestañas lado a lado.
- `VITE_API_MOCK=0`: backend real. El servidor de desarrollo reenvía `/api` a `VITE_API_TARGET` (por defecto `http://localhost:3000`). El backend debe redirigir el final del consentimiento a `/tienda?grant=ok|error`.

`npm test` corre las pruebas (Vitest) y `npm run build` verifica los tipos y empaqueta.

## Guion de la demo (simulado)

1. Abre `/tienda?reiniciar=1` → «Autorizar el día» → Aceptar. Es el consentimiento del `grant` de Open Payments.
2. En otra pestaña, `/operador`: inventario en 1000 USDC y sin pagos.
3. En `/`: Empezar → celular, nombre, cédula → «Conectar Freighter» (Testnet) o pegar la dirección `G…`.
4. Arrastra billetes de la billetera al cajero (o tócalos) → Continuar → Confirmar.
5. La línea de tiempo muestra Solicitud de pago → Autorización → Ejecución del pago → Finalización → USDC en tu billetera, y luego el comprobante.
6. `/operador` muestra el pago completado y el inventario descontado.

## Diseño

El estilo es de ilustración isométrica en blanco y negro, con trazo fino, un acento verde (éxito) y uno azul (en curso). No usa imágenes ni dependencias extra.

- `src/styles.css`: tokens en `:root` (paleta, trazo, radios, curvas `--ease` y `--spring`), tarjetas extruidas, botones con profundidad y la retícula de fondo.
- `src/iso/`: `iso.ts` proyecta puntos 3D a la pantalla; `shapes.tsx` dibuja cajas, cilindros y caras; `scenes.tsx` arma las escenas del cajero, la tienda y el operador, y los cubos de la línea de tiempo.
- `src/cajero/Banknote.tsx`: billetes al estilo colombiano, con el color y el largo real de cada denominación. Son estilizados y llevan la marca «MUESTRA · SIN VALOR».
- `src/cajero/Billetes.tsx`: arrastre con Pointer Events. El billete se inclina según la velocidad y gira desde donde se agarró. La ranura lo traga, o lo devuelve si supera el límite. Tocar el billete o presionar Enter hace el mismo recorrido.
- Con `prefers-reduced-motion` se desactivan las animaciones y el flujo funciona igual.

## Ensayar fallos

Agrega `?fallo=` a la URL del cajero:

| Valor | Qué pasa |
|---|---|
| `stellar` | Open Payments se liquida, pero el envío de USDC falla → «Reintentar envío» |
| `pago` | El `outgoing payment` falla → devolución de billetes |
| `limite` | Rechazo por el límite del nivel 1 |
| `inventario` | El operador no tiene USDC suficientes |
| `grant` | Cajero fuera de servicio, como si no hubiera `grant` |

`?reiniciar=1` en cualquier vista borra el estado simulado.
