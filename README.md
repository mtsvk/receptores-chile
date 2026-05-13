# Receptores Chile

Buscador client-side de receptores judiciales, con auspicios raros rotativos.

## Estructura

```txt
index.html
styles.css
script.js
.nojekyll
assets/ads/
data/ads.json
data/receptores_poder_judicial.json
data/receptores_poder_judicial.csv
tools/prepare_ads.py
tools/prepare_ads.ps1
```

## Auspicios

El sitio usa seis banners optimizados en `assets/ads/`:

- `pan-caliente-960.jpg` / `pan-caliente-640.jpg`
- `cafe-pasillo-960.jpg` / `cafe-pasillo-640.jpg`
- `completo-italiano-960.jpg` / `completo-italiano-640.jpg`
- `archivador-sentimental-960.jpg` / `archivador-sentimental-640.jpg`
- `timbre-mistico-960.jpg` / `timbre-mistico-640.jpg`
- `plantita-960.jpg` / `plantita-640.jpg`

Si generas nuevas imágenes PNG con los nombres simples `marraqueta.png`, `cafepasillo.png`, `completo.png`, `archivador.png`, `timbre.png` y `plantita.png`, ejecuta:

```powershell
python .	ools\prepare_ads.py
```

Eso crea automáticamente las versiones JPEG de 960×320 y 640×213.
