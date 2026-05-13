# Receptores Chile · prototipo client-side

Buscador no oficial, estático y sin backend de receptores judiciales en Chile.

## Fuentes usadas

- `Poder Judicial - Transparencia.xlsx`: fuente primaria para nombres, Corte, tribunal, correo, celular y fijo.
- `Receptores-COT.txt`: base jurídica mínima sobre receptores judiciales, arts. 390 a 393 COT.
- `Juzgados-Código-Orgánico-de-Tribunales.txt`: juzgados civiles/letras, arts. 28 a 40 COT, y territorios de Cortes, arts. 54 y 55 COT.
- `juzgados-de-garantía.txt`: juzgados de garantía y comunas de competencia.
- `Tribunal-Juicio-Oral.txt`: tribunales de juicio oral en lo penal y comunas de competencia.
- `Comunas-de-Chile.txt`: normalización territorial por CUT, provincia, región y coordenadas.
- `neocities-receptoreschile.zip`: referencia técnica/prototipo anterior, no fuente primaria.

## Cómo probar

Como los datos se cargan con `fetch()`, conviene servir la carpeta con un servidor estático:

```bash
cd receptores_chile_site
python -m http.server 8000
```

Abrir: `http://localhost:8000`.

También puede subirse tal cual a Neocities, GitHub Pages o Cloudflare Pages.

## Estructura

```text
index.html
assets/app.js
assets/styles.css
data/receptores.json
data/tribunales.json
data/comunas.json
data/cortes.json
data/search-index.json
data/meta.json
```

## Reglas importantes

- Sitio no oficial.
- No usa backend.
- No usa tracking.
- No usa API oficial de WhatsApp Business.
- Solo genera enlaces `wa.me` con mensaje prellenado.
- No usa Google Ads ni API publicitaria.
- Los banners son locales y configurables en el array `ADS`.
- Los datos incompletos se marcan con flags de calidad.

## Re-generar datos

El script usado para convertir las fuentes a JSON está en `tools/build_receptores_data.py`.
