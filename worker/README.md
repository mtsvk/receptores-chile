# Receptores Analytics V5

Este proyecto está consolidado dentro de `receptores-chile/worker`. Ejecuta los comandos desde esta carpeta. El nombre del Worker, el binding D1, la base y el `database_id` de `wrangler.jsonc` son los recursos remotos existentes y no deben cambiarse.

Worker y D1 compartidos para analytics existentes y evaluaciones anónimas.

## Arquitectura

`POST /event` conserva los eventos `search`, `receptor_open` y `contact_click`. V5 agrega `POST /vote`, `GET /ratings?ids=...`, `GET /ratings/top?limit=100` y `GET /ratings/{receptor_id}/reasons`. El sitio mantiene el dataset estático; los nombres del ranking se resuelven en el navegador desde `data/receptores.json`.

## D1 y migración

`migrations/0001_ratings.sql` crea `votes`, `vote_details` y `vote_rate_limits`. La clave primaria `(receptor_id, voter_key)` hace idempotentes los cambios de voto y detalles. Los comentarios nacen con estado `private` y no son devueltos por ningún endpoint público.

Aplicar localmente:

```powershell
npx wrangler d1 migrations apply receptores-analytics-db --local
```

Aplicar remotamente sólo con autorización explícita:

```powershell
npx wrangler d1 migrations apply receptores-analytics-db --remote
```

## Secrets y Turnstile

Configurar como secrets del Worker (no en el repositorio):

```powershell
npx wrangler secret put VOTE_HMAC_SECRET
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Crear un widget Turnstile en Cloudflare, restringido a `receptores.vukusic.cl` (y `localhost`/`127.0.0.1` sólo si se necesita desarrollo), copiar la site key en `window.RECEPTORES_TURNSTILE_SITE_KEY` en `index.html` y en la plantilla de `tools/generate_seo_pages.py`. Para desarrollo usar las claves oficiales de prueba de Turnstile; nunca agregar un bypass condicional de producción.

## Despliegue autorizado

```powershell
npm install
npx wrangler deploy
```

No se ejecuta automáticamente en este cambio.

`schema.sql` es un esquema auxiliar/histórico de la tabla `events`; la fuente canónica para cambios aplicables a D1 es el directorio `migrations/`. No ejecutes `schema.sql` como parte de un despliegue ni reapliques migraciones ya registradas.

## Pruebas

```powershell
npm test
npx wrangler dev
```

Abrir el sitio con `python -m http.server 8000`. Usar `?debug=ratings` para ver batches, votos, Turnstile, respuestas y errores. Consultar datos sólo con:

```powershell
npx wrangler d1 execute receptores-analytics-db --local --command "SELECT receptor_id, vote, moderation_status FROM votes JOIN vote_details USING (receptor_id, voter_key) LIMIT 20"
```

La prueba manual debe votar sin detalles, repetir con motivos/comentario, cambiar el voto y actualizar detalles: siempre debe existir una sola fila por `(receptor_id, voter_key)`. Verificar rechazos para comentario sobre 300 caracteres, motivo desconocido, voto distinto de `1/-1`, Turnstile inválido y respuestas `429` después de 20 acciones por hora. `/ratings/top` sólo incluye totales de al menos 5 y ordena por Wilson 95%; ninguna lectura pública incluye comentario, motivos individuales, IP, browser ID o voter key.
