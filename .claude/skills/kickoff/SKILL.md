---
name: kickoff
description: "Trigger: kickoff, define our idea, project idea, hackathon category, fill PROJECT.md, idea del proyecto, categoría del hackatón, llenar PROJECT.md. Entrevista al equipo para convertir una idea aproximada en PROJECT.md: problema, usuario, categoría de premio, flujo obligatorio de Open Payments, alcance del MVP y demo."
---

# Kickoff — convertir la idea en un proyecto construible

Úsala cuando `PROJECT.md` diga `Estado: BORRADOR`, o cuando el equipo quiera rehacer la idea.

## Antes de preguntar nada
Lee `HACKATHON.md` (reglas, premios, criterios, cronograma) y `PROJECT.md`. No preguntes lo que esos archivos ya responden.

## Reglas de la entrevista
- Una pregunta a la vez; luego detente y espera. Preguntas cortas, en el idioma del equipo.
- Parte de lo que ya tienen («¿cuál es la idea, aunque sea aproximada?»), no de un formulario en blanco.
- No impongas tecnología ni idea. Ofrece una recomendación con la contrapartida solo cuando estén atascados.
- Cuestiona los puntos débiles con los criterios de evaluación (claridad del problema, usuario real, inclusión, impacto).

## Qué cerrar (en este orden; salta lo que ya esté claro)
1. **Problema y usuario** — una persona concreta, idealmente desatendida, y el dolor de pago que tiene hoy.
2. **Solución en una frase** — qué hace el usuario y qué cambia para esa persona.
3. **Categoría de premio** — elige una principal entre Impacto, Inclusión, Innovación y Comunidad (`HACKATHON.md`). Explica qué criterios carga esa elección; un equipo gana como máximo un premio, así que di cuál es el ángulo secundario.
4. **Flujo obligatorio de Open Payments** — mapéalo a pasos concretos: solicitud de pago (`incoming payment` / `quote`), autorización (`grant` GNAP + consentimiento), ejecución del pago (`outgoing payment`), éxito mostrado al usuario. Decide las billeteras emisor y receptor (solo billetera de prueba) y dónde vivirá cada paso en el código. Usa la skill `open-payments` para lo que el SDK soporta; marca lo que la idea necesite y Open Payments no pueda hacer.
5. **Alcance del MVP** — qué tiene que funcionar en vivo en una demo de 5 minutos, y qué queda explícitamente fuera. Dimensiónalo para ~1.5 días de trabajo en total (vie 10:30–17:30, sáb 08:00–11:00) con 5 personas.
6. **Tecnología y arquitectura** — solo después de 1–5, lo más mínimo; registra la decisión y el porqué.
7. **Guion de la demo** — reto → usuario → solución → pago en vivo → conclusiones, en 5 minutos.
8. **Riesgos** — los 3 principales y el respaldo de cada uno (p. ej. flujo de `grant` lento → `grant` creados de antemano para la demo).

## Salida
Actualiza `PROJECT.md` sección por sección a medida que se confirman las decisiones (nunca inventes respuestas; deja `_Pendiente_` en lo que siga abierto). Pon `Estado: LISTO` solo cuando el equipo confirme las secciones 1–5 y 7. Luego propone dividir el MVP en tareas y pásale el turno a `/team-plan`. No escribas código de producto durante el kickoff.
