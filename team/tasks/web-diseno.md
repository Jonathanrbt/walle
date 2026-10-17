---
owner: andss-ye
status: review
branch: feat/andss-ye-web-diseno
paths:
  - web/**
shared: []
depends_on:
  - web-cajero
---

# Front: sistema de diseño isométrico y billetes con movimiento real (`web/`)

Plan de implementación con formato ODD: intención, tareas con IDs estables y criterios de aceptación, evidencia y progreso en un solo lugar. Una tarea se marca solo con prueba observada.

**Objetivo:** cambiar toda la interfaz de `web/` a un sistema de diseño de ilustración isométrica en blanco y negro, con trazos finos y movimiento suave. Los billetes deben parecerse a los colombianos y moverse como papel real.

**Arquitectura:** la geometría isométrica se calcula con funciones puras (`web/src/iso/iso.ts`) y se dibuja con SVG en línea, sin imágenes. El arrastre usa Pointer Events y Web Animations, que son nativos del navegador, y su física (inclinación por velocidad, resultado de soltar) vive en funciones puras con pruebas. Las pantallas, la API y `team/contracts.md` no cambian de comportamiento: solo cambian el aspecto y el movimiento.

**Stack:** Vite 8 + React 19 + TypeScript ~5.9 + Vitest 5. No se agregan dependencias.

**Referencia visual:** las dos imágenes que compartió andss-ye el 16 oct. Son una fábrica isométrica blanca con trazo gris oscuro sobre fondo gris claro, con un solo acento verde (el camión), y un cubo de servidor con tres puntos azules y líneas punteadas azules de fondo.

## Problema
La UI actual (W1–W9 de `web-cajero.md`) es funcional, pero parece una pantalla LCD oscura genérica. Los billetes son rectángulos de un color y el arrastre usa HTML5 drag-and-drop, que en pantallas táctiles no funciona, no tiene física y no se puede automatizar en el navegador de pruebas. En una demo de 5 minutos, lo visual es lo primero que ven los jueces.

## Por qué
- Las ilustraciones isométricas explican el sistema sin texto: efectivo → cajero → Open Payments → Stellar.
- Que un billete reconocible entre «de verdad» al cajero es el momento memorable de la demo.
- Pointer Events funciona igual con mouse, con touch y en las pruebas automatizadas.

## Alcance
- Dentro: los tokens de diseño, el shell (barra superior y fondo), los botones, campos, teclado, paneles, tablas y banners; las primitivas y escenas isométricas; los billetes; el arrastre físico; las transiciones entre pantallas; y el restyling de `/`, `/tienda` y `/operador`.
- Fuera: lógica de negocio, contratos, API simulada, modo oscuro (el kiosco es claro) y fuentes externas.

## Restricciones globales
- Sin dependencias nuevas. Solo React, CSS, SVG, Pointer Events y la Web Animations API.
- Solo fuentes del sistema, para que la demo funcione sin conexión.
- Paleta: fondo `#eceef0`, superficies `#ffffff`, tinta `#2a2f35`, caras `#f4f5f6` / `#e3e6e9` / `#d3d8dd`, acento `#1fa463` (éxito y acción), señal `#2563eb` (en curso), peligro `#d64545`, aviso `#c98a16`.
- Trazo de 1.25 px, `stroke-linejoin: round` y `vector-effect: non-scaling-stroke` en todo el SVG.
- Curvas: `--ease: cubic-bezier(.2,.8,.2,1)` para entradas y `--spring: cubic-bezier(.34,1.56,.64,1)` para rebotes.
- Con `prefers-reduced-motion: reduce` no hay animaciones (duración 0), y el flujo funciona igual.
- Billetes: estilizados, nunca réplicas. Sin retratos reales, sin números de serie y sin «Banco de la República». Llevan «MUESTRA · SIN VALOR».
- Medidas de los billetes: la familia actual mide 66 mm de alto y de 128 a 153 mm de largo, 5 mm más por cada denominación.
- Textos de la UI en español; código y comentarios en inglés. Las pruebas (`npm test`) y el build (`npm run build`) quedan en verde en cada commit.
- A 375 px de ancho no debe haber scroll horizontal.

## Foco de revisión
1. **Arrastre táctil:** al arrastrar un billete en un teléfono, la página no debe desplazarse y el billete debe seguir el dedo (`touch-action: none`). Se verifica en D4.
2. **Billete que no cabe:** si se suelta sobre el cajero un billete que supera los 100 USDC por operación, el cajero lo devuelve y explica por qué, sin insertarlo. Lo cubren la prueba `dropOutcome` de D4 y la verificación en el navegador.
3. **Arrastre interrumpido:** con `pointercancel`, o al soltar fuera de la ventana, el billete vuelve a la billetera y no queda ningún fantasma. Se verifica en D4.
4. **Movimiento reducido:** con `prefers-reduced-motion`, insertar con clic, teclado o arrastre suma el billete igual. Se verifica en D4 y D7.
5. **Pantalla angosta (375 px):** el cajero y la billetera se apilan, el billete de 100.000 cabe y las escenas escalan. Se verifica en D7.

---

## Mapa de archivos
| Archivo | Responsabilidad |
|---|---|
| `web/src/iso/iso.ts` (+ `iso.test.ts`) | Proyección isométrica y geometría de cajas y cilindros |
| `web/src/iso/shapes.tsx` | Componentes SVG: `IsoSvg`, `IsoBox`, `IsoCylinder`, `IsoPoly` |
| `web/src/iso/scenes.tsx` | Escenas: `Logo`, `AtmScene`, `StoreScene`, `ServerScene`, `PhaseCube` |
| `web/src/styles.css` | Tokens, shell y componentes base (reescrito) |
| `web/src/cajero/cash.ts` (+ test) | `BILL_DESIGN`: color, palabras y largo de cada billete |
| `web/src/cajero/Banknote.tsx` | Billete en SVG |
| `web/src/cajero/drag.ts` (+ `drag.test.ts`) | Física del arrastre: `tilt`, `inside`, `dropOutcome` |
| `web/src/cajero/Billetes.tsx`, `billetes.css` | Billetera con pilas, arrastre con punteros, ranura que traga o devuelve |
| `web/src/views/*.tsx`, `web/src/cajero/Proceso.tsx`, `App.tsx` | Pantallas con escenas, transiciones y comprobante impreso |

## Tareas

### D1 — Primitivas isométricas
**Archivos:** crear `web/src/iso/iso.ts`, `web/src/iso/iso.test.ts` y `web/src/iso/shapes.tsx`.

**Interfaces que produce:**
- `type Vec3 = [number, number, number]`
- `iso(x: number, y: number, z?: number): [number, number]`: x va a la derecha y abajo, y a la izquierda y abajo, z hacia arriba. Fórmula: `[(x - y)·cos30°, (x + y)·0.5 − z]`.
- `points(...p: Vec3[]): string`: el atributo `points` de un polígono, con 2 decimales.
- `box(x, y, z, w, d, h): { top: string; left: string; right: string }`: caras visibles. `left` es la cara `y = y + d` y `right` es la cara `x = x + w`.
- `cylinder(x, y, z, r, h): { cx: number; topY: number; bottomY: number; rx: number; ry: number }`, con `rx = r·√2·cos30°` y `ry = r·√2·0.5`.
- Componentes:
  - `<IsoSvg viewBox className? label?>` pone `role="img"` y `aria-label`, o `aria-hidden` si no hay `label`.
  - `<IsoBox x y z w d h tone?: 'plain' | 'accent' | 'signal' | 'danger' | 'ink'>`
  - `<IsoCylinder x y z r h tone?>`
  - `<IsoPoly p={Vec3[]} className?>`

Los tonos se aplican con las clases `iso-plain` y similares, definidas en `styles.css`. Por tono, la cara superior es la más clara, la izquierda es intermedia y la derecha la más oscura.

- [x] **D1.1 Pruebas que fallan** (`iso.test.ts`):
  - `iso(1,0,0)` ≈ `[0.866, 0.5]`; `iso(0,1,0)` ≈ `[-0.866, 0.5]`; `iso(0,0,1)` = `[0,-1]`.
  - `points([0,0,0],[1,0,0])` = `'0,0 0.87,0.5'`.
  - `box(0,0,0,1,1,1).top` empieza en `'0,-1 '` y tiene 4 puntos.
  - `box(...).right` incluye `iso(1,1,0)` (`'0,1'`).
  - `cylinder(0,0,0,1,2)` da `rx` ≈ 1.2247, `ry` ≈ 0.7071, `topY` = −2 y `bottomY` = 0.
- [x] **D1.2** `npm test`: falla porque falta el módulo.
- [x] **D1.3** Implementar `iso.ts` y `shapes.tsx` (`IsoCylinder` es un path con el lado y el arco inferior, más una elipse superior).
- [x] **D1.4** `npm test`: pasa.
- [x] **D1.5** Commit: `feat: ✨ add isometric drawing primitives`.

### D2 — Sistema de diseño y shell
**Archivos:** reescribir `web/src/styles.css`; crear `web/src/iso/scenes.tsx` (por ahora solo `Logo`); modificar `web/src/App.tsx`.

**Interfaces que produce:**
- Tokens en `:root`: los de las restricciones globales, más `--stroke`, `--radius: 14px`, `--radius-sm: 8px`, `--depth: 3px`, `--ease`, `--spring` y `--dur: 220ms`.
- Clases que conservan sus nombres actuales, para no tocar el JSX de la lógica: `.btn`, `.btn-ghost`, `.atm-btn`, `.atm-btn-ghost`, `.atm-input`, `.atm-key`, `.panel`, `.stats`, `.stat`, `.banner-*`, `.atm-meter`, `.table-wrap`.
- Botón táctil: borde de tinta, profundidad con `box-shadow: 0 var(--depth) 0 var(--ink)`; al presionarlo baja 3 px y la sombra pasa a 0. El primario va en tinta con texto blanco; el `ghost` va en blanco.
- Tarjetas «extruidas» (`.panel`, `.atm`): borde de tinta y `box-shadow: 8px 8px 0 -1px var(--face-2), 8px 8px 0 0 var(--ink)`.
- Fondo: `--bg` con una retícula isométrica punteada muy tenue (SVG en un data URI, líneas a ±30°).

- [x] **D2.1** Reescribir `styles.css` con los tokens, el shell y los componentes base. Agregar `.screen-in` (entrada de 260 ms con opacidad y `translateY(6px)`) y las clases de tono iso.
- [x] **D2.2** `Logo` (un cubo de 3 caras con la cara superior en acento) más «walle» en `App.tsx`. El badge «API simulada · testnet» lleva un punto azul.
- [x] **D2.3** Verificar: `npm run build` en verde y captura de `/` sin errores de consola.
- [x] **D2.4** Commit: `feat: 💄 add isometric line design system and app shell`.

### D3 — Billetes colombianos
**Archivos:** modificar `web/src/cajero/cash.ts` y `cash.test.ts`; crear `web/src/cajero/Banknote.tsx`.

**Interfaces que produce:**
- `BILL_DESIGN: Record<Bill, { color: string; words: string; lengthMm: number }>`:

  | Billete | Color | Palabras | Largo |
  |---|---|---|---|
  | 2000 | aguamarina `#2f9fa4` | `DOS MIL PESOS` | 128 |
  | 5000 | ocre `#b07a3c` | `CINCO MIL PESOS` | 133 |
  | 10000 | rojo `#c24a4f` | `DIEZ MIL PESOS` | 138 |
  | 20000 | naranja `#e08a2e` | `VEINTE MIL PESOS` | 143 |
  | 50000 | morado `#8a4c9e` | `CINCUENTA MIL PESOS` | 148 |
  | 100000 | verde `#3a9a62` | `CIEN MIL PESOS` | 153 |

- `BILL_HEIGHT_MM = 66`.
- `<Banknote bill />`: un SVG con `viewBox="0 0 {lengthMm} 66"`, `width="100%"` y `aria-hidden`. Sus capas son:
  1. Fondo con un degradado del color al color mezclado con blanco.
  2. Guilloches: elipses concéntricas y ondas en blanco al 35 %.
  3. Marca de agua: un círculo claro a la izquierda.
  4. Hilo de seguridad: una línea punteada vertical en x = 40 %.
  5. Un retrato genérico: silueta de cabeza y hombros en un óvalo a la derecha, dibujada solo con trazo.
  6. El número grande `{bill/1000}` con «MIL» arriba a la izquierda.
  7. «COLOMBIA», las palabras de la denominación y «MUESTRA · SIN VALOR» en microtexto.

- [x] **D3.1** Prueba que falla, `BILL_DESIGN covers every denomination with growing length`:
  - Cada `DENOMINATIONS` tiene diseño.
  - Los largos son `[128,133,138,143,148,153]`.
  - `BILL_DESIGN[50000].words` = `'CINCUENTA MIL PESOS'`.
- [x] **D3.2** `npm test`: falla.
- [x] **D3.3** Implementar `BILL_DESIGN`, `BILL_HEIGHT_MM` y `Banknote.tsx`, y reemplazar `BillNote` por `Banknote` en todos sus usos.
- [x] **D3.4** `npm test`: pasa. Revisar en captura que los 6 billetes se distingan por color y por largo.
- [x] **D3.5** Commit: `feat: 💄 draw Colombian-style banknotes`.

### D4 — Arrastre físico y ranura
**Archivos:** crear `web/src/cajero/drag.ts` y `drag.test.ts`; reescribir `Wallet` y `DropZone` en `web/src/cajero/Billetes.tsx` y su `billetes.css`; modificar `web/src/views/Cajero.tsx`.

**Interfaces que produce:**
- `MAX_TILT = 14` (grados) y `tilt(vx: number): number`, que da `clamp(vx·18, −14, 14)` con vx en px/ms.
- `inside(p: {x,y}, r: {left,top,right,bottom}): boolean`
- `type DropOutcome = 'insert' | 'reject' | 'return'`
- `dropOutcome(p, target: Rect | null, allowed: boolean): DropOutcome`
- `Wallet` recibe `onInsert(bill)` y además `onReject(bill)`. Cada denominación con `remaining > 0` se puede arrastrar, aunque no quepa, porque el cajero la devuelve. El elemento destino tiene `data-bill-drop`, la ranura tiene `data-bill-slot`, y durante el arrastre se le pone `data-over` al destino.
- En `Cajero.tsx`:
  - `rejected: { bill: Bill; seq: number } | null`. `BillsScreen` recibe `notice?: string` y muestra «El billete de $X supera el límite de 100 USDC por operación».
  - `DropZone` recibe `rejected` para encender la luz roja de la ranura.

**Comportamiento:**
- Al hacer `pointerdown` en una pila, el billete superior pasa a un fantasma con `position: fixed`, que conserva el punto donde se agarró. Se captura el puntero.
- En `pointermove` (con `requestAnimationFrame`):
  - La posición sigue al puntero.
  - La velocidad se suaviza con `v = 0.8·v + 0.2·instantánea`.
  - La rotación se acerca a `tilt(v)` con `rot += (objetivo − rot)·0.25`.
  - El fantasma sube con `scale(1.06)` y una sombra.
- `pointerup`: si el movimiento total es menor a 6 px, cuenta como toque, y el billete vuela desde la pila hasta la ranura.
  - `insert`: Web Animations lleva el fantasma al centro superior de la ranura en 260 ms con `--ease`. Después se llama `onInsert` y la ranura lo traga.
  - `reject`: el billete llega a la ranura, se sacude (±6 px, 3 veces) y vuelve. Se llama `onReject`.
  - `return`: vuelve al origen en 420 ms con `--spring`.
- `pointercancel` se trata igual que `return`.
- Con el teclado (`click` con `detail === 0`) se usa el mismo camino que el toque.
- La ranura traga el billete con `.slot-feed`: baja una altura completa mientras `clip-path: inset(0 0 100% 0)` lo recorta, en 600 ms.

- [x] **D4.1** Pruebas que fallan (`drag.test.ts`):
  - `tilt(0)` = 0; `tilt(0.5)` = 9; `tilt(5)` = 14; `tilt(-5)` = −14.
  - `inside` incluye los bordes y excluye `x = right + 1`.
  - `dropOutcome`:
    - dentro y permitido da `'insert'`;
    - dentro y no permitido da `'reject'`;
    - fuera da `'return'`;
    - con `target` en `null` da `'return'`.
- [x] **D4.2** `npm test`: falla.
- [x] **D4.3** Implementar `drag.ts`, la billetera con pilas y arrastre, y la ranura que traga o devuelve.
- [x] **D4.4** `npm test`: pasa.
- [x] **D4.5** Verificar en el navegador:
  - Arrastrar con el mouse inserta el billete.
  - Soltar fuera lo devuelve.
  - Un billete de 100.000 con 90 USDC ya cargados se devuelve con el aviso.
  - El toque y la tecla Enter insertan.
  - A 375 px, arrastrar no desplaza la página.
- [x] **D4.6** Commit: `feat: ✨ drag banknotes with pointer physics into the cashier slot`.

### D5 — Pantallas del cajero
**Archivos:** modificar `web/src/views/Cajero.tsx`, `web/src/cajero/Proceso.tsx` y `web/src/iso/scenes.tsx`.

**Interfaces que produce:**
- `<AtmScene />`: una plataforma isométrica, un kiosco con la pantalla en la cara izquierda y la ranura, una pila de billetes verde, líneas punteadas azules animadas hacia un servidor con 3 puntos azules, y una moneda (cilindro) en señal.
- `<PhaseCube state: PhaseState />`: un cubo de 18 px con estos tonos:
  - `done` en acento;
  - `active` en señal, con un rebote de 2 px cada 1 s;
  - `pending` en `plain`;
  - `error` en peligro.

**Cambios:**
- Cada pantalla del cajero se envuelve en `<div key={step} className="screen-in">`.
- El estado `idle` muestra `AtmScene` encima de «Bienvenido».
- La línea de tiempo usa `PhaseCube` en lugar del círculo numerado. Un conector punteado vertical une las fases, y el tramo activo fluye con `stroke-dashoffset`.
- `Receipt` se renderiza como un tique de papel (`.ticket`) con el borde inferior en zigzag (`mask` con `conic-gradient`) que sale «impreso» con `clip-path` de arriba hacia abajo en 700 ms.

- [x] **D5.1** Implementar `AtmScene`, `PhaseCube`, las transiciones, la línea de tiempo y el tique.
- [x] **D5.2** Verificar en el navegador el recorrido completo simulado: inicio → datos → dirección → billetes → cotización → proceso → comprobante, y también `?fallo=stellar` y `?fallo=pago`. Sin errores en consola.
- [x] **D5.3** Commit: `feat: 💄 restyle cashier screens with isometric scene, timeline cubes and printed receipt`.

### D6 — Tienda y operador
**Archivos:** modificar `web/src/views/Tienda.tsx`, `web/src/views/Operador.tsx` y `web/src/iso/scenes.tsx`.

**Interfaces que produce:**
- `<StoreScene active: boolean />`: un edificio con toldo, puerta y un cajero pequeño al frente. Con `grant` activo lleva una llave o cubo en acento sobre el techo; si no, en `plain`.
- `<ServerScene pct: number />`: un servidor de dos cuerpos con rejilla y 3 puntos azules que pulsan, más una columna de monedas apiladas. La columna tiene `round(pct / 10)` monedas, de 0 a 10, y va en peligro si `pct` < 30.

- [x] **D6.1** `/tienda` muestra la escena al lado de las estadísticas, y el consentimiento simulado queda como una tarjeta blanca de billetera. `/operador` muestra la escena con la columna de inventario y una tabla con líneas finas.
- [x] **D6.2** Verificar en el navegador:
  - `/tienda?reiniciar=1` → «Autorizar el día» → Aceptar: el cubo del techo se pone verde.
  - En `/operador`, después de un pago, la columna baja; con «Reponer» vuelve a 10.
- [x] **D6.3** Commit: `feat: 💄 add isometric store and operator scenes`.

### D7 — Verificación, documentación y limpieza
- [x] **D7.1** `npm test` y `npm run build` en verde. Capturas a 1280 px y a 375 px de `/`, `/tienda` y `/operador`, sin scroll horizontal y sin errores en consola.
- [x] **D7.2** Revisar con movimiento reducido: insertar sigue funcionando.
- [x] **D7.3** Actualizar `web/README.md` (sección «Diseño») y la evidencia de este documento.
- [x] **D7.4** Cerrar el servidor de desarrollo por PID y confirmar que `lsof` no muestra ningún proceso escuchando. Revisar `git status --untracked-files=all`.
- [x] **D7.5** Commit: `docs: 📝 document isometric design system`.

## Evidencia
- **D1:** `iso.test.ts` falló porque faltaba el módulo y pasó tras implementarlo (4 pruebas). En macOS, `Iso.tsx` chocaba con `iso.ts` porque el sistema de archivos no distingue mayúsculas; se renombró a `shapes.tsx`.
- **D2:** `npm run build` en verde. Captura de `/tienda` con el shell, la retícula y las tarjetas extruidas, sin errores de consola.
- **D3:** la prueba `BILL_DESIGN covers every denomination with growing length` falló y luego pasó. En la captura de la billetera, los 6 billetes se distinguen por color y por largo.
- **D4:** `drag.test.ts` falló y luego pasó (3 pruebas). En el navegador integrado (Chrome):
  - Arrastrar el 50.000 con el mouse real lo insertó.
  - Soltar el 10.000 fuera del cajero lo devolvió (siguió ×4).
  - Tocar el 100.000 y el 50.000 los insertó.
  - Con 97,08 USDC, el 20.000 llegó a la ranura, se encendió el anillo rojo, apareció el aviso «supera el límite de 100 USDC» y el billete volvió (×3).
  - Enter sobre la pila del 2.000 lo insertó.
  - A 375 px, `scrollWidth` = 375 y `touch-action: none` en las pilas; arrastrar a la ranura insertó.
  - Con `matchMedia` de movimiento reducido forzado, el billete se insertó sin dejar ningún fantasma.
  - Se corrigió una condición de carrera: dos toques seguidos usaban el estado viejo. Ahora la caída lee los callbacks vigentes por `ref` y `setBills` es funcional.
- **D5:** recorrido simulado completo (inicio con escena → datos → dirección → billetes → cotización → 5 cubos que pasan a verde → tique impreso). Con `?fallo=stellar`, el último cubo queda en rojo con «Reintentar envío». Consola sin errores. Con el panel oculto, el navegador no pinta frames y las animaciones esperan; no es un fallo de la app.
- **D6:**
  - `/tienda?reiniciar=1` → «Autorizar el día» → Aceptar: el cubo del techo y el toldo pasan a verde.
  - En `/operador`, con el saldo base simulado en 200 USDC, aparecen 2 monedas rojas y el aviso del 30 %. «Reponer» vuelve a 10 monedas azules.
  - Se corrigió `var(--error)`, un token viejo, por `var(--danger)`.
- **D7:**
  - `npm test`: 23/23. `npm run build` en verde.
  - A 375 px, `scrollWidth` = `clientWidth` = 375 en `/`, `/tienda` y `/operador`, y la billetera queda fija abajo en el cajero.
  - Sin errores en consola.

## Progreso
D1–D7 completas en `feat/andss-ye-web-diseno`.

## Siguiente paso
Abrir el PR hacia `main`. Falta probar a mano el arrastre táctil en un teléfono real; el navegador de pruebas envía eventos de mouse.
