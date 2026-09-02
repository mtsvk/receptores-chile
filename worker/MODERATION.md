# Moderación de comentarios públicos

Los comentarios históricos conservan `publication_status = 'not_requested'`.
Sólo una nueva entrega con autorización explícita puede quedar en `pending`.

## Listar pendientes

```powershell
npx wrangler d1 execute receptores-analytics-db --remote --command "SELECT rowid AS id, receptor_id, reasons_json, comment, created_at, updated_at FROM private_feedback WHERE publication_status = 'pending' ORDER BY updated_at ASC;"
```

## Aprobar por rowid

```powershell
npx wrangler d1 execute receptores-analytics-db --remote --command "UPDATE private_feedback SET publication_status = 'approved', published_at = datetime('now') WHERE rowid = <ID> AND publication_status = 'pending';"
```

## Rechazar por rowid

```powershell
npx wrangler d1 execute receptores-analytics-db --remote --command "UPDATE private_feedback SET publication_status = 'rejected', published_at = NULL WHERE rowid = <ID> AND publication_status = 'pending';"
```

## Retirar un comentario publicado

```powershell
npx wrangler d1 execute receptores-analytics-db --remote --command "UPDATE private_feedback SET publication_status = 'rejected', published_at = NULL WHERE rowid = <ID>;"
```

Sustituye `<ID>` por un número revisado manualmente. No pegues secretos en estos
comandos ni copies identificadores técnicos a publicaciones externas.

## Criterios mínimos

La revisión es humana. Puede aprobarse una crítica descriptiva, no sólo un
comentario positivo. Debe describir una experiencia relativamente concreta y
no incluir datos sensibles, partes de causas, RUT, teléfonos, correos privados,
insultos, amenazas, imputaciones delictivas presentadas como hechos, spam,
publicidad o contenido manifiestamente irrelevante.
