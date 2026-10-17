# Datos del hackatón (desde `docs/`)

Fuentes oficiales: `docs/2026-hackathon-medellin.md`, `docs/2026-timetable.md`, `docs/submission-judging.md`, `docs/ai-policy.md`, `docs/open-payments.md`, `docs/code-conduct.md`. Si este archivo y `docs/` no coinciden, gana `docs/`: corrige este archivo.

## Logística
- **Cuándo:** vie 16 oct 2026 08:30–18:00, sáb 17 oct 2026 07:00–18:00. Los candidatos seleccionados deben asistir en persona durante los dos días completos.
- **Dónde:** RutaN, Calle 67 # 52-20, Piso 2, Torre A, Aranjuez, Medellín.
- Trae tu computadora portátil; no se proporcionará equipo. Todo el código debe escribirse el mismo día. Contacto: hackathon@interledger.org.
- Preparación requerida antes de enviar: curso de Platzi sobre Open Payments o la guía de Open Payments (`docs/ai-policy.md` §5).

## Cronograma
| Cuándo | Qué |
|---|---|
| vie 10:30–14:00 | Sesión 1: Hacking |
| vie 14:00–15:00 | Comida |
| vie 15:00–17:30 | Sesión 2: Hacking (salidas 17:30–18:00) |
| sáb 08:00–11:00 | Sesión 3: Hacking |
| **sáb 11:00** | **Entrega de código, video de demo y diapositivas. No se permiten más cambios de código.** Los mentores revisan los repos 11:00–12:00; ensayo de la presentación en paralelo |
| sáb 12:00–13:00 | Ronda 1 de evaluación (4 salas, ≥2 jueces cada una, **5 min por equipo**: presentación + demo) |
| sáb 14:30–15:30 | Se anuncian 12 finalistas; Ronda 2 (5 min por equipo; todos votan por el Premio de la Comunidad) |
| sáb 16:30–17:30 | Ganadores y clausura |

## Premios
Todos los equipos pueden postularse a todos; un equipo gana como máximo uno; el premio se reparte en partes iguales entre los miembros; se paga en COP, equivalente a USD 5,000.

| Premio | Se otorga a |
|---|---|
| RutaN — **Premio al impacto** | El proyecto con el mayor potencial de impacto real usando Open Payments. |
| Puntored — **Premio a la inclusión** | El proyecto que mejor impulsa la inclusión financiera, haciendo los pagos digitales más accesibles y equitativos. |
| FIND EAFIT — **Premio a la innovación** | El proyecto que demuestra el pensamiento más original y el uso más innovador de Open Payments. |
| This Week in Fintech — **Premio de la comunidad** | El equipo o proyecto que mejor representa el espíritu de la comunidad Interledger. Elegido por todos los participantes. |

## Criterios de evaluación
Definición del problema · Uso de Open Payments (flujo de pago que funciona) · Experiencia del usuario · Calidad técnica (prototipo confiable) · Presentación · Inclusión (usuarios desatendidos) · Innovación · Impacto.

## Lista de entrega (cierra el sáb a las 11:00)
- [ ] Repositorio público de GitHub, **todas las ramas fusionadas en `main`**, nada que quede solo en una computadora
- [ ] Enlace del repositorio enviado por el formulario de Google compartido en el Slack del hackatón
- [ ] Diapositivas (copia la plantilla de Google Slides en la carpeta de Drive del equipo)
- [ ] Video de demo + enlace de la demo en la carpeta de Drive del equipo
- [ ] Las diapositivas explican: el reto, el usuario, la solución, cómo se utilizó Open Payments, conclusiones clave
- [ ] La demo muestra con claridad: solicitud de pago → autorización → ejecución del pago → finalización exitosa
- [ ] `AI_USAGE.md` + `prompts/` en el commit (lista del sábado a las 11:00 en el README); prompts revisados por una persona
- [ ] Sin secretos en el repositorio
- Opcional: diagramas de arquitectura, maquetas, documentación técnica, videos

## Política de IA en un párrafo
Las herramientas de IA están permitidas en todo. Hay que divulgar: `AI_USAGE.md` (herramientas, para qué, dónde, qué archivos tuvieron poca o ninguna IA) y el texto real de los prompts en `prompts/`. Revisen y entiendan todo lo que produjo la IA; el equipo es responsable del repositorio.

## Código de conducta
Evento libre de acoso; reporta a coc@interledger.org o al personal de ILF (`docs/code-conduct.md`).

## Recursos
Billetera de prueba `https://wallet.interledger-test.dev` · docs `https://openpayments.dev/es` · SDK `https://github.com/interledger/open-payments-node` · Boutique `https://boutique.interledger-test.dev/` · Interledger Pay `https://interledgerpay.com/`. Usa la skill `open-payments` para el trabajo con el SDK.
