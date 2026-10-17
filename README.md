# Medellin Hack

Repositorio del equipo para el Hackathon de Interledger Open Payments, Medellín, 16–17 oct 2026 (la entrega cierra el sáb a las 11:00).

Empieza aquí:
1. Abre Claude Code en este repositorio. Lee `CLAUDE.md` (reglas duras) y `HACKATHON.md` (cronograma, premios, evaluación, lista de entrega); las páginas oficiales están en `docs/`.
2. Ejecuta `/kickoff` una vez en equipo para definir la idea, la categoría de premio y el flujo de Open Payments en `PROJECT.md`.
3. Antes de construir nada, ejecuta `/team-plan`. Reclama tus archivos en `team/tasks/` para que el agente de nadie sobrescriba el trabajo de otra persona (`team/README.md`).
4. Usa la skill `open-payments` para el trabajo con el SDK (solo red de prueba).
5. El registro de prompts es automático; tú solo revisas y publicas (abajo).

## Registro de uso de IA

Claude Code guarda cada prompt por su cuenta. Se ignoran los comandos slash. Los secretos se reemplazan primero con marcadores `[REDACTED:...]`. Nada se publica hasta que lo revises; las líneas pendientes quedan en `.prompts-pending/`, ignorado por git.

El paso humano:

```
! node scripts/prompts/cli.mjs review
```

Teclas: `[p]ublish`, `[e]dit`, `[s]kip` (dejar pendiente), `[d]rop` (borrar), `[q]uit`.

Un commit que deje `prompts/` en el stage sin esa revisión queda bloqueado. La misma compuerta bloquea `prompts/`, `AI_USAGE.md` o `ai-usage/*` en el stage cuando todavía hay un secreto en el archivo. Corre para el `git commit` del agente y para un commit manual (`.githooks/pre-commit`). Publicar escribe el hash de aprobación; editar `approved.json` a mano no cuenta.

Copia `ai-usage/TEMPLATE.md` a `ai-usage/<your-slug>.md` y luego regenera la divulgación:

```
node scripts/prompts/cli.mjs build-usage
```

Lista del sábado a las 11:00:

1. Ejecuta `! node scripts/prompts/cli.mjs review` hasta que no quede nada pendiente.
2. Ejecuta `node scripts/prompts/cli.mjs build-usage`.
3. Lee `prompts/` tú mismo antes del push público.
