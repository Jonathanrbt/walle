# Servidor

Instalación desde la raíz del repositorio:

```bash
npm install
```

Las variables de entorno viven en el `.env` de la raíz (ese archivo no se versiona). Los nombres y los valores por defecto están en `server/.env.example`.

Desarrollo, con reinicio al cambiar archivos:

```bash
npm run -w server dev
```

Pruebas:

```bash
npm run -w server test
```
