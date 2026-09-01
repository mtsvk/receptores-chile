#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import datetime as dt
import html
import json
import re
import unicodedata
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "receptores.json"
OUT_DIR = ROOT / "receptores"
SITEMAP_FILE = ROOT / "sitemap.xml"
BASE_URL = "https://receptores.vukusic.cl"
SITE_NAME = "Receptores Chile"


def esc(value) -> str:
    return html.escape(str(value or ""), quote=True)


def slugify(value: str) -> str:
    value = unicodedata.normalize("NFD", str(value or ""))
    value = "".join(c for c in value if unicodedata.category(c) != "Mn")
    value = value.lower().strip()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "receptor"


def receptor_slug(row: dict) -> str:
    rid = str(row.get("id") or "")
    m = re.match(r"^rec-\d+-(.+)$", rid)
    if m:
        return slugify(m.group(1))
    return slugify(row.get("nombre") or row.get("nombre_original") or rid)


def listify(value):
    if value is None:
        return []
    if isinstance(value, list):
        return [x for x in value if str(x or "").strip()]
    return [value] if str(value).strip() else []


def dedupe(values):
    out, seen = [], set()
    for value in values:
        text = str(value or "").strip()
        if not text:
            continue
        key = text.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(text)
    return out


def phone_chunks(value: str):
    if not value:
        return []
    return [p.strip() for p in re.split(r"\s*(?:\||;|/)\s*", str(value)) if p.strip()]


def chile_phone(value: str):
    raw = str(value or "").strip()
    if not raw:
        return None
    digits = re.sub(r"\D+", "", raw)
    if digits.startswith("0056"):
        digits = digits[4:]
    elif digits.startswith("56") and len(digits) == 11:
        digits = digits[2:]

    if len(digits) == 8:
        national = "9" + digits
    elif len(digits) == 9:
        national = digits
    else:
        return None

    e164 = "+56" + national
    if national.startswith("9"):
        label = f"+56 9 {national[1:5]} {national[5:]}"
    elif national.startswith("2"):
        label = f"+56 2 {national[1:5]} {national[5:]}"
    else:
        label = "+56 " + national
    return label, "tel:" + e164, e164


def collect_phones(row: dict):
    candidates = []
    for key in (
        "telefono_celular_display",
        "telefono_fijo_display",
        "telefono",
        "telefono_fijo",
        "telefono_normalizado",
    ):
        candidates.extend(phone_chunks(row.get(key, "")))
    for link in listify(row.get("tel_links_seguros")):
        if str(link).startswith("tel:"):
            candidates.append(str(link)[4:])

    phones, seen = [], set()
    for candidate in candidates:
        parsed = chile_phone(candidate)
        if parsed:
            label, href, canonical = parsed
            if canonical in seen:
                continue
            seen.add(canonical)
            phones.append({"label": label, "href": href})
        else:
            raw = str(candidate).strip()
            key = "raw:" + re.sub(r"\s+", "", raw).casefold()
            if raw and key not in seen:
                seen.add(key)
                phones.append({"label": raw, "href": ""})
    return phones


def collect_emails(row: dict):
    values = []
    values.extend(listify(row.get("emails")))
    values.extend(listify(row.get("email")))
    return dedupe(values)


def brief_description(row: dict) -> str:
    name = str(row.get("nombre") or "Receptor judicial")
    place = str(row.get("tribunal_fuente") or row.get("corte") or "").strip()
    if place:
        text = f"{name}, receptor judicial en {place}. Datos de contacto, adscripción y cobertura. Fuente: Poder Judicial."
    else:
        text = f"{name}, receptor judicial en Chile. Datos de contacto, adscripción y cobertura. Fuente: Poder Judicial."
    text = text[:158].rstrip(" ,.;")
    return text + "."


def render_phone_rows(phones):
    if not phones:
        return '<p class="empty">Sin teléfono publicado.</p>'
    parts = ['<ul class="contact-list">']
    for phone in phones:
        if phone["href"]:
            parts.append(f'<li><a href="{esc(phone["href"])}">{esc(phone["label"])}</a></li>')
        else:
            parts.append(f'<li>{esc(phone["label"])}</li>')
    parts.append("</ul>")
    return "\n".join(parts)


def render_email_rows(emails):
    if not emails:
        return '<p class="empty">Sin correo publicado.</p>'
    parts = ['<ul class="contact-list">']
    for email_addr in emails:
        parts.append(f'<li><a href="mailto:{quote(email_addr, safe="@.+-_")}">{esc(email_addr)}</a></li>')
    parts.append("</ul>")
    return "\n".join(parts)


def render_list(values, empty_text="No informado."):
    values = dedupe(values)
    if not values:
        return f'<p class="empty">{esc(empty_text)}</p>'
    return "<p>" + esc(", ".join(values)) + "</p>"


PAGE_CSS = """
:root{color-scheme:light;--ink:#111;--muted:#666;--line:#ddd;--surface:#f7f7f7;--max:880px}
*{box-sizing:border-box}html{font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:#fff}
body{margin:0;line-height:1.55}a{color:inherit;text-underline-offset:3px}.shell{width:min(calc(100% - 32px),var(--max));margin-inline:auto}
header{border-bottom:1px solid var(--line)}.header-inner{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:18px 0}
.brand{font-weight:700;text-decoration:none}.back{font-size:14px;color:var(--muted)}main{padding:52px 0 72px}.eyebrow{margin:0 0 8px;color:var(--muted);font-size:14px}
h1{font-size:clamp(30px,5vw,46px);line-height:1.08;letter-spacing:-.03em;margin:0 0 14px}.lead{font-size:18px;color:#333;max-width:700px;margin:0 0 38px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:0;border-top:1px solid var(--line)}.section{padding:24px 0;border-bottom:1px solid var(--line);min-width:0}
.section:nth-child(odd){padding-right:28px}.section:nth-child(even){padding-left:28px;border-left:1px solid var(--line)}.section.full{grid-column:1/-1;padding-left:0;padding-right:0;border-left:0}
h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 10px;color:var(--muted)}p{margin:0}.contact-list{list-style:none;margin:0;padding:0;display:grid;gap:6px}.empty{color:var(--muted)}
.notice{margin-top:32px;padding:16px 18px;background:var(--surface);border:1px solid var(--line);font-size:14px;color:#444}.meta{margin-top:24px;font-size:13px;color:var(--muted)}
footer{border-top:1px solid var(--line);padding:22px 0 40px;font-size:13px;color:var(--muted)}footer .shell{display:flex;justify-content:space-between;gap:18px;flex-wrap:wrap}
@media(max-width:650px){.header-inner{align-items:flex-start;flex-direction:column;gap:4px}main{padding-top:34px}.grid{display:block}.section,.section:nth-child(odd),.section:nth-child(even){padding:20px 0;border-left:0}}
"""


def render_receptor_page(row: dict, slug: str) -> str:
    name = str(row.get("nombre") or row.get("nombre_original") or "Receptor judicial")
    corte = str(row.get("corte") or "").strip()
    tribunal = str(row.get("tribunal_fuente") or "").strip()
    territorio = str(row.get("territorio") or "").strip()
    comunas = listify(row.get("comunas_cubiertas"))
    regiones = listify(row.get("regiones"))
    phones = collect_phones(row)
    emails = collect_emails(row)
    canonical = f"{BASE_URL}/receptores/{slug}.html"
    description = brief_description(row)
    title = f"{name} | Receptor judicial | {SITE_NAME}"
    adscripcion = tribunal or corte or territorio or "No informada"

    telephone_jsonld = next((p["label"] for p in phones if p["href"]), None)
    json_ld = {"@context": "https://schema.org", "@type": "Person", "name": name, "jobTitle": "Receptor judicial", "url": canonical}
    if emails:
        json_ld["email"] = emails[0]
    if telephone_jsonld:
        json_ld["telephone"] = telephone_jsonld

    return f'''<!doctype html>
<html lang="es-CL">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<meta name="robots" content="index,follow">
<link rel="canonical" href="{esc(canonical)}">
<meta name="receptor-id" content="{esc(row.get('id'))}">
<meta property="og:type" content="profile">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:url" content="{esc(canonical)}">
<meta property="og:locale" content="es_CL">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">{json.dumps(json_ld, ensure_ascii=False, separators=(",", ":"))}</script>
<style>{PAGE_CSS}</style>
</head>
<body>
<header><div class="shell header-inner"><a class="brand" href="/">Receptores Chile</a><a class="back" href="/receptores/">Todos los receptores</a></div></header>
<main class="shell">
<p class="eyebrow">Receptor judicial · directorio no oficial</p>
<h1>{esc(name)}</h1>
<p class="lead">{esc(adscripcion)}</p>
<div class="grid">
<section class="section"><h2>Corte</h2><p>{esc(corte or "No informada")}</p></section>
<section class="section"><h2>Tribunal / adscripción</h2><p>{esc(tribunal or "No informado")}</p></section>
<section class="section"><h2>Teléfono</h2>{render_phone_rows(phones)}</section>
<section class="section"><h2>Correo</h2>{render_email_rows(emails)}</section>
<section class="section full"><h2>Comunas cubiertas</h2>{render_list(comunas, "Cobertura comunal no informada.")}</section>
<section class="section full"><h2>Región</h2>{render_list(regiones, "Región no informada.")}</section>
</div>
<div class="notice">Directorio no oficial. Los datos provienen de información publicada por el Poder Judicial. Verifica la información directamente antes de encargar una diligencia.</div>
<p class="meta">Fuente: {esc(row.get("fuente") or "Poder Judicial")} · Actualización: {esc(row.get("fecha_fuente") or "sin fecha informada")}</p>
</main>
<footer><div class="shell"><span>Receptores Chile</span><a href="/">Volver al buscador</a></div></footer>
<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{{"token":"47df7ee006864c7cb89ac9a9ec036ba4"}}'></script><!-- End Cloudflare Web Analytics -->
<script defer src="/analytics.js?v=20260901-3"></script></body></html>'''


def render_directory(rows_with_slugs) -> str:
    items = []
    for row, slug in sorted(rows_with_slugs, key=lambda pair: str(pair[0].get("nombre") or "").casefold()):
        name = str(row.get("nombre") or row.get("nombre_original") or "Receptor judicial")
        corte = str(row.get("corte") or "").strip()
        items.append(f'<li><a href="/receptores/{esc(slug)}.html">{esc(name)}</a>' + (f'<span>{esc(corte)}</span>' if corte else "") + '</li>')

    title = f"Directorio de receptores judiciales en Chile | {SITE_NAME}"
    description = "Directorio alfabético de receptores judiciales en Chile, con adscripción, cobertura y datos de contacto publicados por el Poder Judicial."
    return f'''<!doctype html>
<html lang="es-CL"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(title)}</title><meta name="description" content="{esc(description)}"><meta name="robots" content="index,follow"><link rel="canonical" href="{BASE_URL}/receptores/">
<style>{PAGE_CSS}
.directory{{list-style:none;margin:34px 0 0;padding:0;border-top:1px solid var(--line)}}.directory li{{display:grid;grid-template-columns:minmax(0,1fr) minmax(180px,.6fr);gap:22px;padding:13px 0;border-bottom:1px solid var(--line);align-items:baseline}}.directory a{{font-weight:600}}.directory span{{font-size:13px;color:var(--muted)}}@media(max-width:650px){{.directory li{{grid-template-columns:1fr;gap:3px}}}}
</style></head><body>
<header><div class="shell header-inner"><a class="brand" href="/">Receptores Chile</a><a class="back" href="/">Buscador</a></div></header>
<main class="shell"><p class="eyebrow">Directorio alfabético</p><h1>Receptores judiciales en Chile</h1><p class="lead">{len(rows_with_slugs)} receptores. Selecciona un nombre para ver su ficha pública.</p><ul class="directory">{''.join(items)}</ul></main>
<footer><div class="shell"><span>Receptores Chile</span><a href="/">Volver al buscador</a></div></footer><!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{{"token":"47df7ee006864c7cb89ac9a9ec036ba4"}}'></script><!-- End Cloudflare Web Analytics -->
<script defer src="/analytics.js?v=20260901-3"></script></body></html>'''


def write_sitemap(rows_with_slugs, today: str):
    urls = [(f"{BASE_URL}/", today), (f"{BASE_URL}/receptores/", today)]
    urls.extend((f"{BASE_URL}/receptores/{slug}.html", today) for _, slug in rows_with_slugs)
    body = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for url, lastmod in urls:
        body += ["  <url>", f"    <loc>{html.escape(url)}</loc>", f"    <lastmod>{lastmod}</lastmod>", "  </url>"]
    body.append("</urlset>")
    SITEMAP_FILE.write_text("\n".join(body) + "\n", encoding="utf-8")
    return len(urls)


def main():
    if not DATA_FILE.exists():
        raise SystemExit(f"No existe: {DATA_FILE}")
    rows = json.loads(DATA_FILE.read_text(encoding="utf-8-sig"))
    if not isinstance(rows, list):
        raise SystemExit("data/receptores.json debe contener una lista JSON.")

    rows_with_slugs, used = [], set()
    for row in rows:
        slug = receptor_slug(row)
        base, n = slug, 2
        while slug in used:
            slug = f"{base}-{n}"
            n += 1
        used.add(slug)
        rows_with_slugs.append((row, slug))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("*.html"):
        old.unlink()
    for row, slug in rows_with_slugs:
        (OUT_DIR / f"{slug}.html").write_text(render_receptor_page(row, slug), encoding="utf-8")
    (OUT_DIR / "index.html").write_text(render_directory(rows_with_slugs), encoding="utf-8")

    today = dt.date.today().isoformat()
    sitemap_count = write_sitemap(rows_with_slugs, today)

    print("=" * 62)
    print("SEO ESTÁTICO GENERADO")
    print("=" * 62)
    print(f"Receptores:           {len(rows_with_slugs)}")
    print(f"Páginas individuales: {len(rows_with_slugs)}")
    print(f"URLs en sitemap:      {sitemap_count}")
    print(f"Directorio:           {OUT_DIR / 'index.html'}")
    print(f"Sitemap:              {SITEMAP_FILE}")
    print("\nEjemplos:")
    for row, slug in rows_with_slugs[:3]:
        print(f"  /receptores/{slug}.html — {row.get('nombre','')}")


if __name__ == "__main__":
    main()




