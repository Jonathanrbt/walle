# ai-usage

Un archivo por persona. Copia `TEMPLATE.md` a `ai-usage/<your-slug>.md` y complétalo.

Tu slug es `git config user.name` en minúsculas, con espacios y puntuación convertidos en `-` (el mismo id que usa el registrador de prompts). Ejemplo: `Ada Lovelace` → `ai-usage/ada-lovelace.md`.

Escribe en inglés:

- qué herramientas de IA usaste
- dónde las usaste (archivo, función o área) y qué hicieron
- qué escribiste, reescribiste o verificaste tú

No pegues claves de API, llaves privadas ni valores de `.env`. Si un secreto ya se coló en una nota, reemplázalo con un marcador `[REDACTED:...]` antes de hacer commit.

`README.md` y `TEMPLATE.md` son instrucciones. `node scripts/prompts/cli.mjs build-usage` los omite y fusiona cada otro `ai-usage/*.md` en `AI_USAGE.md`.
