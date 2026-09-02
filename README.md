# Receptores Chile

Directorio no oficial de receptores judiciales en Chile, con datos derivados de publicaciones del Poder Judicial.

## Frontend

El directorio principal es estático y compatible con GitHub Pages. Incluye búsqueda client-side, datos locales y páginas SEO generadas para cada receptor. Las funciones interactivas usan el Worker y D1.

## Backend

El Worker de `worker/` expone recomendaciones anónimas mediante `/vote`, comentarios privados mediante `/feedback`, comentarios públicos moderados mediante `/comments`, analytics propio mediante `/event` y consultas de recomendaciones y ranking.

Las recomendaciones no requieren cuenta y mantienen un máximo de 5 recomendaciones nuevas por IP y día. Los comentarios requieren una cuenta Google verificada, Turnstile y rate limiting por IP. No se almacenan en claro nombre, correo, foto, `sub` ni Google ID token; se usa un identificador HMAC. La IP no se almacena en claro en D1 propio.

Los comentarios autorizados para publicación pasan por estos estados:

```text
private_feedback
        |
        +-- publication_status=not_requested -> privado
        |
        +-- publication_status=pending -> espera moderación
        |
        +-- publication_status=approved -> visible en ficha
        |
        +-- publication_status=rejected -> no visible
```

La publicación requiere opt-in y moderación humana. Los comentarios históricos permanecen privados. Los comentarios públicos no afectan recomendaciones ni ranking.

## Estructura

```text
index.html
app-v4.js
analytics.js
ratings.js
data/
tools/generate_seo_pages.py
worker/
```

## Desarrollo local

Frontend:

```powershell
python -m http.server 8000
```

Worker y tests:

```powershell
cd worker
npm install
npm test -- --run
```

No abras `index.html` directamente con `file://`; algunos navegadores bloquean el acceso a los JSON locales.

## Datos y generación

`data/receptores.json` y `data/meta.json` alimentan el frontend. Las fichas SEO se regeneran con:

```powershell
python tools/generate_seo_pages.py
```

## Worker, D1 y despliegue

`worker/wrangler.jsonc` apunta al Worker y a la base D1 existentes. Los secrets se gestionan en Cloudflare y no deben guardarse en el repositorio.

```powershell
cd worker
npx wrangler deploy
npx wrangler d1 migrations list receptores-analytics-db --remote
```

La migración de comentarios públicos debe revisarse y aplicarse remotamente antes de desplegar el Worker que la utiliza. No se ejecuta automáticamente desde este repositorio.

## Alcance

El sitio no es oficial. Verifica los datos directamente con el Poder Judicial, el tribunal o el receptor antes de encargar una diligencia.
