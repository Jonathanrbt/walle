---
name: team-plan
description: "Trigger: plan, new task, claim work, split the MVP, before implementing a feature, planear, nueva tarea, reclamar trabajo, dividir el MVP, antes de implementar una funcionalidad. Construye un plan que no choque con el trabajo de otras personas, usando los reclamos de team/tasks y la verificación de solapamiento."
---

# Plan de equipo — planear sin pisar a los demás

Cinco personas y cinco agentes comparten un repositorio. Un plan solo es válido si sus rutas de archivo no chocan con el trabajo activo.

## Pasos
1. **Sincronizar**: `git pull --rebase origin main`. Lee `CLAUDE.md`, `PROJECT.md` (si sigue en `BORRADOR`, detente y sugiere `/kickoff`) y `team/README.md`.
2. **Ver qué está tomado**: `node scripts/team/check-overlap.mjs --status`, y lee los archivos de tarea que no estén en `done`. Lee también `team/contracts.md`.
3. **Elegir o definir el trabajo**: toma el siguiente ítem del MVP en `PROJECT.md` que ninguna tarea activa cubra. Si la persona nombró el trabajo, usa eso. Prefiere cortes verticales que hagan funcionar de punta a punta un paso del flujo de Open Payments, antes que capas horizontales.
4. **Declara los `paths`** que vas a editar: archivos exactos o globs estrechos, nunca `.` ni una carpeta entera de primer nivel. Pon los archivos compartidos inevitables (`package.json`, lockfile, configuración, router, esquema) bajo `shared:`.
5. **Verifica antes de reclamar**: `node scripts/team/check-overlap.mjs --paths <your paths>`. Si reporta un choque: no edites esas rutas. Reduce el reclamo, elige otro trabajo o dile a la persona con qué miembro hablar. Nunca pases por encima del reclamo de otro `owner`.
6. **Escribe el reclamo**: copia `team/TEMPLATE.md` a `team/tasks/<slug>.md` con `owner` = el slug de git de la persona (`git config user.name`, en minúsculas), `status: in-progress`, `branch: feat/<owner>-<slug>`, los `paths` y las verificaciones de `Listo cuando`. Haz commit y push solo de ese archivo primero (`docs: 📝 claim <slug>`), para que los demás lo vean.
7. **Interfaces**: si el código de otro miembro va a llamar al tuyo o al revés, agrega la forma a `team/contracts.md` y avísale a la persona antes de construir.
8. **Presenta el plan** a la persona en pocas líneas: objetivo, rutas, pasos, cómo se va a probar, qué paso de Open Payments cubre y cómo encaja en la demo. Espera la aprobación antes de implementar.

## Mientras trabajas
- Quédate dentro de tus `paths` reclamados. ¿Necesitas otra ruta? Actualiza tu archivo de tarea, vuelve a correr la verificación de solapamiento y luego sigue.
- Commits pequeños, rebase antes de hacer push, fusiona a `main` con PRs pequeños. Nunca hagas force-push de `main`.
- Actualiza `status` (`review` cuando esté listo, `done` después del merge). Las tareas en `done` liberan sus rutas.
- Todo el trabajo queda en `main` antes del sáb a las 11:00 (`HACKATHON.md`).
