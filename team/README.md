# Coordinación del equipo (5 personas, muchos agentes, un repositorio)

Objetivo: que el agente de nadie sobrescriba el trabajo de otra persona. Las reglas se sostienen por convención más `node scripts/team/check-overlap.mjs`.

## Lista
Agrega tu fila en `team/ROSTER.md` (una línea cada quien; edita solo tu propia línea para evitar conflictos de merge).

## Tareas
- Un archivo por tarea: `team/tasks/<slug>.md`, a partir de `team/TEMPLATE.md`. Créalo **antes** de escribir código y haz push de inmediato para que los demás vean el reclamo.
- Campos del frontmatter: `owner`, `status` (`todo` | `in-progress` | `review` | `done`), `branch`, `paths` (archivos o carpetas que vas a editar — rutas exactas o globs estrechos, nunca `.` ni un `src/` entero), `shared`, `depends_on`.
- Solo el `owner` edita su archivo de tarea. Actualiza `status` a medida que avanzas.

## Reglas de propiedad
1. Una ruta reclamada por una tarea en `in-progress` o `review` pertenece a su `owner`. No la edites; habla con el dueño o reparte el trabajo de otra forma.
2. Los archivos compartidos (`package.json`, lockfile, configuración, router, esquema) son **puntos de integración**: lístalos bajo `shared:` en la tarea y tócalos en el commit más pequeño posible, después de un pull o rebase. Prefiere agregar archivos nuevos antes que editar los compartidos.
3. Las interfaces entre miembros (rutas de API, firmas de funciones, formas de datos) van en `team/contracts.md`. Acuérdenlas antes de que ambos lados construyan.
4. Una rama por tarea: `feat/<member>-<slug>`. Fusiona a `main` con PRs pequeños; `git pull --rebase origin main` antes de empezar y antes de hacer push.
5. Nadie hace force-push de `main`. Todo tiene que estar en `main` el sáb a las 11:00.

## Para agentes: protocolo de planeación
Ejecuta `/team-plan` antes de proponer un plan. Lee `team/tasks/`, corre la verificación de solapamiento y produce un plan cuyos `paths` no choquen con el trabajo activo. Nunca implementes fuera de tus rutas reclamadas; si el plan necesita otra ruta, actualiza primero tu archivo de tarea y vuelve a correr la verificación.

## Comandos
```
node scripts/team/check-overlap.mjs           # sale 1 si tareas activas reclaman rutas que chocan
node scripts/team/check-overlap.mjs --status  # tabla de todas las tareas por owner y status
node scripts/team/check-overlap.mjs --paths a/b.ts c/**   # ¿estas rutas chocarían con tareas activas?
```
