# Medellín Hack — Hackatón de Open Payments (equipo de 5)

Hackatón de Interledger Open Payments, Medellín (RutaN), **vie 16 – sáb 17 oct 2026**. El material fuente está en `docs/` (español, oficial). Los datos, plazos y reglas están resumidos en `HACKATHON.md`: léelo primero. Responde al equipo en español (o en el idioma en que escriban). Toda la documentación y los archivos de texto del repositorio se escriben en español neutro. El código, los identificadores, los comentarios de código y los mensajes de commit quedan en inglés (conventional commits con emoji). Las secciones de `PROJECT.md` deben permanecer en español cuando un agente las edite. Las skills `open-payments` y `rafiki` son referencias técnicas en inglés.

## Reglas duras (no negociables)
1. **Open Payments es obligatorio** y debe mostrar un flujo de punta a punta que funcione: solicitud de pago → autorización (`grant` GNAP) → ejecución del pago → finalización exitosa. **Solo red de prueba** (`interledger-test.dev`), nunca dinero real. Usa la skill `open-payments`.
2. **Todo el código se escribe durante el evento.** No pegues código escrito antes. Las herramientas previas al evento que ya están en el repositorio son solo `.claude/`, `scripts/` y `team/`, nunca parte del producto.
3. **La divulgación de IA es obligatoria**: `AI_USAGE.md` en la raíz del repositorio + el texto real de los prompts en `prompts/`. Está automatizado (ver `README.md`). Nunca evadas la compuerta de commit, nunca edites el manifiesto de aprobación bajo `.prompts-pending/`, nunca publiques ni apruebes prompts en nombre de una persona.
4. **La entrega cierra el sáb a las 11:00**: repositorio público de GitHub con todo el código en la rama `main`, video de demo y diapositivas en la carpeta de Drive del equipo. Sin cambios de código después de eso.
5. **Sin secretos en el repositorio**: `.env` está ignorado; las claves, llaves privadas y credenciales de billetera nunca van en el código, en `docs/`, en `prompts/` ni en los commits.
6. Las personas son dueñas del trabajo: revisen, prueben y entiendan todo lo que escribe la IA (la política de IA evalúa esto).

## Dónde está cada cosa
- `HACKATHON.md` — reglas, cronograma, premios, criterios de evaluación, lista de entrega.
- `PROJECT.md` — la idea del equipo, la categoría, el alcance y el flujo de Open Payments. Si todavía dice `Estado: BORRADOR`, sugiere `/kickoff` antes de cualquier trabajo de funcionalidades.
- `team/` — coordinación: lista, un archivo por tarea, reglas de propiedad (`team/README.md`).
- `.claude/skills/` — `open-payments` (uso del SDK), `kickoff` (definir la idea), `team-plan` (planear sin chocar), `rafiki` (referencia técnica de Rafiki, en inglés).
- `docs/` — páginas oficiales del hackatón. Cítalas; no parafrasees de memoria.

## Trabajo con otros (resumen — detalles en `team/README.md`)
Antes de planear o editar, ejecuta `/team-plan`: lee `team/tasks/`, reclama tus archivos en un archivo de tarea, rama `feat/<member>-<slug>`, quédate dentro de tus rutas reclamadas, `git pull --rebase` antes de empezar y antes de hacer push, commits pequeños. Nunca edites una ruta que reclame otra tarea en progreso; habla primero con esa persona.

## Commits
Conventional commits con un emoji después del tipo (`feat: ✨`, `fix: 🐛`, `docs: 📝`, `refactor: ♻️`, `test: ✅`, `chore: 🔧`), asunto descriptivo, cuerpo que explica qué y por qué. La persona es la única autora: sin líneas `Co-Authored-By` ni atribución de IA. Los commits que dejen `prompts/` en el stage exigen primero el paso de revisión humana.
