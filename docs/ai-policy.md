# Política de IA

## **1. Se permite el uso de herramientas de IA**

Los participantes pueden usar herramientas de IA (por ejemplo, ChatGPT, Claude, GitHub Copilot, Cursor, Gemini, entre otras) durante todo el hackatón. La IA puede usarse para programar frontend y backend, depurar código, investigar, diseñar o redactar documentación, según lo requiera el proyecto del hackatón.

## **2. Se requiere divulgar su uso**

Cada equipo debe agregar un archivo llamado `AI_USAGE.md` en la raíz de su repositorio de GitHub. Este archivo debe indicar:

- Qué herramienta(s) de IA se usaron.
- Para qué se usaron.
- En qué parte del proyecto se usaron (archivos, funciones o componentes específicos), o bien mencionar que se usaron en todo el proyecto, si no se escribió ningún archivo sin ayuda de IA.
- Especificar los archivos en los que se usó mínima o ninguna IA, por ejemplo, el archivo de servicio de Open Payments.

### Example: AI_USAGE.md

```markdown
# AI Usage Disclosure

## Tools Used

* ChatGPT (GPT-4o)

* Claude

## Where and How We Used AI

### 1. Backend – Payment flow (`/src/api/open-payments.ts`)

* Used Claude to scaffold the initial Open Payments flow, creating incoming and outgoing payments, as well as quote creation.

* Reviewed and rewrote error handling ourselves after testing revealed the AI's version didn't handle grants correctly.

### 2. Frontend – Donation platform UI (`/src/components/Donation.tsx`)

* Used Claude to generate all design and frontend pages and components

### 3. Documentation – README setup instructions

* Used ChatGPT to draft the initial README structure.

* Edited by hand to match our actual setup steps and fix inaccurate install commands.

## What We Did Ourselves

* Testing and verification of all AI-suggested code

## Prompt Log

See `/prompts/backend-payments.md` for the full list of prompts used to generate the open payments flow code.
```

## **3. Se requieren registros de prompts**

Los equipos también deben subir a su repositorio los prompts que usaron para instruir a

las herramientas de IA en tareas de programación, en una carpeta llamada: `/prompts` (o al final del archivo: `AI_USAGE.md`, si el registro es breve). Esto debe incluir el texto real de los prompts enviados a la IA, no solo un resumen. Todas las herramientas de IA utilizadas deben poder generar una lista de prompts que pueda guardarse en dicha carpeta o archivo.

Ejemplo: `/prompts/backend-payments.md`

## **4. Recomendación: usa la IA, pero no le delegues tu trabajo ni tu criterio**

**Trabajar con la IA, no dejar que trabaje en tu lugar.** El uso de IA está completamente permitido y se fomenta como herramienta de productividad. Dicho esto, se recomienda encarecidamente a los participantes no delegar todo el proyecto a la IA. El propósito del hackatón es desarrollar las habilidades y criterios propios; el valor está en comprender lo que se construyó, no en cuánto escribió la IA.

**Confiar, pero verificar.** Los participantes deben siempre revisar, probar y comprender cualquier código o contenido que la IA les entregue antes de publicarlo. El código generado por IA puede tener errores sutiles, ser inseguro, o basarse en APIs desactualizadas, o incluso no corresponder a la API de Open Payments de Interledger. Cada equipo es responsable de lo que hay en su repositorio, sin importar quién (o qué) lo haya escrito.

## **5. Preparación requerida sobre Open Payments**

Antes del hackatón (o antes de enviar el proyecto), todos los participantes deben completar una de las siguientes opciones:

- El curso de Platzi sobre Open Payments: [https://platzi.com/cursos/interledger-openpayments/ (se abre en una pestaña nueva)](https://platzi.com/cursos/interledger-openpayments/) (solo disponible en español), o
- Revisar la Guía de Open Payments (disponible en inglés y español).

Comprender bien el flujo de Open Payments es un requisito antes de construir sobre él, y esta preparación garantiza que todos los participantes cuenten con esa base.
