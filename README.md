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

No conviene abrir `index.html` directamente con `file://`, porque algunos navegadores bloquean `fetch()` de archivos JSON locales.

## Publicación

El proyecto sigue siendo apto para GitHub Pages. Reemplaza los archivos de la rama publicada por esta versión y GitHub Pages servirá `index.html` sin proceso de build.

## Datos y alcance

El sitio es no oficial. El dataset incluye información derivada de los archivos y reglas jurisdiccionales utilizadas en el proyecto; algunas coberturas territoriales son inferidas. Antes de encargar una diligencia, verifica el antecedente con la fuente oficial, el tribunal o el receptor correspondiente.

## Nota sobre el builder

`tools/build_receptores_data.py` se conserva desde el proyecto anterior para no perder el trabajo de construcción del dataset. No es necesario para ejecutar el sitio y actualmente mantiene supuestos/rutas del proceso original; conviene refactorizarlo por separado antes de considerarlo un pipeline reproducible desde este repositorio.
