# Receptores Chile

Buscador estático y no oficial de receptores judiciales en Chile.

## Qué cambió en esta versión

La interfaz se redujo a su función principal: consultar un dataset.

- 100% estático y compatible con GitHub Pages.
- Sin backend, tracking, analytics ni frameworks.
- Sin auspicios, modales, overlays, onboarding o UI flotante.
- Búsqueda client-side por nombre, comuna, tribunal, Corte, correo o teléfono.
- Filtros por Corte, comuna y disponibilidad de contacto.
- Tabla compacta en escritorio y fichas lineales en móvil.
- Cobertura, fuente y notas metodológicas disponibles con `<details>`, sin abrir ventanas ni bloquear la navegación.
- Render inicial paginado para no crear 673 filas de DOM de una vez.

## Estructura

```text
index.html
styles.css
script.js
.nojekyll
robots.txt
data/
  receptores.json
  meta.json
  receptores_poder_judicial.json
  receptores_poder_judicial.csv
  comunas.json
  cortes.json
  tribunales.json
tools/
  build_receptores_data.py
```

La interfaz consume únicamente `data/receptores.json` y `data/meta.json`. Los demás archivos se conservan como datos auxiliares/insumos del proyecto.

## Probar localmente

Desde PowerShell, dentro de la carpeta del proyecto:

```powershell
python -m http.server 8000
```

Luego abre `http://localhost:8000`.

## Recomendaciones y comentarios privados

El sitio carga `ratings.js` y consulta el Worker compartido en lotes. Configura `window.RECEPTORES_TURNSTILE_SITE_KEY` en `index.html` y en `tools/generate_seo_pages.py`; usa las claves oficiales de prueba de Turnstile durante desarrollo. Cada navegador puede recomendar una vez por receptor; los comentarios privados se envían por separado con razones estructuradas. El enlace `/ranking/` sólo muestra receptores con al menos 5 recomendaciones y ordena principalmente por cantidad de recomendaciones. `?debug=ratings` activa logs temporales de batches, recomendaciones, Turnstile y errores.

Las recomendaciones no requieren cuenta. La IP sólo se usa para rate limiting y no se almacena en claro; el `browser_id` sólo se transforma mediante HMAC. Los comentarios privados no aparecen en el sitio, sitemap, JSON-LD, analytics ni endpoints públicos.

No conviene abrir `index.html` directamente con `file://`, porque algunos navegadores bloquean `fetch()` de archivos JSON locales.

## Worker y D1

El Worker forma parte de este mismo repositorio, pero mantiene su propio proyecto Node/Wrangler dentro de `worker/`.

Frontend:

```powershell
cd C:\Workspace\projects\receptores-chile
python -m http.server 8000
```

Worker:

```powershell
cd C:\Workspace\projects\receptores-chile\worker
npm install
npm test
npx wrangler deploy
npx wrangler d1 migrations list receptores-analytics-db --remote
npx wrangler secret list
```

La configuración de `worker/wrangler.jsonc` sigue apuntando al Worker remoto `receptores-analytics` y a la base D1 existente `receptores-analytics-db`, mediante el binding `receptores_analytics_db` y su `database_id` existente. Esta consolidación no recrea ni renombra recursos remotos. Los secrets `TURNSTILE_SECRET_KEY` y `VOTE_HMAC_SECRET` permanecen gestionados por Cloudflare y nunca deben guardarse en el repositorio.

`worker/migrations/0001_ratings.sql` es la migración versionada para ratings y debe aplicarse solo cuando corresponda; no se vuelve a aplicar durante esta consolidación. `worker/schema.sql` conserva el esquema base histórico de `events` como referencia/auxiliar: no reemplaza el historial de migraciones remotas ni debe ejecutarse automáticamente sobre la base existente.

## Publicación

El proyecto sigue siendo apto para GitHub Pages. Reemplaza los archivos de la rama publicada por esta versión y GitHub Pages servirá `index.html` sin proceso de build.

## Datos y alcance

El sitio es no oficial. El dataset incluye información derivada de los archivos y reglas jurisdiccionales utilizadas en el proyecto; algunas coberturas territoriales son inferidas. Antes de encargar una diligencia, verifica el antecedente con la fuente oficial, el tribunal o el receptor correspondiente.

## Nota sobre el builder

`tools/build_receptores_data.py` se conserva desde el proyecto anterior para no perder el trabajo de construcción del dataset. No es necesario para ejecutar el sitio y actualmente mantiene supuestos/rutas del proceso original; conviene refactorizarlo por separado antes de considerarlo un pipeline reproducible desde este repositorio.
