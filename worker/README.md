# Receptores Analytics V5

Este proyecto está consolidado dentro de `receptores-chile/worker`. Ejecuta los comandos desde esta carpeta. El nombre del Worker, el binding D1, la base y el `database_id` de `wrangler.jsonc` son los recursos remotos existentes y no deben cambiarse.

Worker y D1 compartidos para analytics existentes, recomendaciones anónimas y comentarios privados.

## Arquitectura

`POST /event` conserva los eventos `search`, `receptor_open` y `contact_click`. El Worker expone `POST /vote` (sólo recomendación `vote=1`), `POST /feedback`, `GET /ratings?ids=...` y `GET /ratings/top?limit=100`. Los endpoints públicos sólo devuelven cantidades de recomendaciones. El sitio mantiene el dataset estático; los nombres del ranking se resuelven en el navegador desde `data/receptores.json`.

## D1 y migración

`migrations/0001_ratings.sql` conserva `votes` y `vote_details` históricos. `migrations/0002_private_feedback.sql` crea `private_feedback`, independiente de `votes`, para que un comentario no requiera recomendación. Las recomendaciones nuevas usan sólo `vote=1`; los negativos históricos se ignoran en todos los agregados públicos. La clave primaria `(receptor_id, voter_key)` hace idempotentes recomendaciones y comentarios.

Aplicar localmente:

```powershell
npx wrangler d1 migrations apply receptores-analytics-db --local
```

Aplicar remotamente sólo con autorización explícita:

```powershell
npx wrangler d1 migrations apply receptores-analytics-db --remote
```

## Secrets y Turnstile

## Verificación Google para comentarios

Configurar `GOOGLE_CLIENT_ID` en el Worker. `POST /feedback` requiere un Google ID token válido además de Turnstile y el rate limiting existente. Los comentarios sin autorización de publicación siguen privados; los autorizados quedan pendientes de moderación. No se crean cuentas, sesiones ni cookies.

`GET /comments?receptor_id=...` devuelve sólo comentarios aprobados para la ficha correspondiente. La migración `0003_public_comments.sql` agrega el estado de publicación separado; los registros históricos quedan como `not_requested`. La moderación manual está documentada en `MODERATION.md`.

## WhatsApp Cloud API (recepción mínima)

El webhook `GET/POST /whatsapp/webhook` requiere configurar estas variables como secrets del Worker:

- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`

Esta prueba sólo recibe y valida mensajes entrantes. Todavía no envía mensajes ni verifica usuarios.

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

La prueba manual debe recomendar, repetir la recomendación, enviar un comentario privado sin recomendar y verificar que el ranking no cambia por el comentario. Verificar rechazos para comentario sobre 300 caracteres, motivo desconocido, `vote=-1`, Turnstile inválido y respuesta `429` al superar 5 recomendaciones nuevas por día desde una IP. `/ratings/top` sólo incluye receptores con al menos 5 recomendaciones y ordena por cantidad; ninguna lectura pública incluye comentario, motivos, IP, browser ID o voter key. Los datos negativos de prueba existentes en Abarca deben limpiarse posteriormente con un procedimiento autorizado; este cambio no los borra.
