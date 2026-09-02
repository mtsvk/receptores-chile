#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import datetime as dt
import csv
import html
import json
import re
import unicodedata
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "receptores.json"
OUT_DIR = ROOT / "receptores"
RANKING_DIR = ROOT / "ranking"
SITEMAP_FILE = ROOT / "sitemap.xml"
CONTACT_NAMES_FILE = ROOT / "data" / "nombres_contacto.csv"
BASE_URL = "https://receptores.vukusic.cl"
SITE_NAME = "Receptores Chile"
REGION_ORDER = ["Arica y Parinacota", "Tarapacá", "Antofagasta", "Atacama", "Coquimbo", "Valparaíso", "Metropolitana de Santiago", "Libertador General Bernardo O'Higgins", "Maule", "Ñuble", "Biobío", "La Araucanía", "Los Ríos", "Los Lagos", "Aysén del General Carlos Ibáñez del Campo", "Magallanes y de la Antártica Chilena"]


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


NAME_PARTICLES = {"de", "del", "la", "las", "los", "van", "von"}
SURNAME_PARTICLES = NAME_PARTICLES | {"san", "santa"}
MULTI_PARTICLES = {"de la", "de las", "de los"}


def natural_name(value: str) -> str:
    words = str(value or "").strip().split()
    return " ".join(word.lower() if word.casefold() in NAME_PARTICLES else word[:1].upper() + word[1:].lower() for word in words)


def consume_surname(tokens, start):
    if start >= len(tokens):
        return [], start
    first = tokens[start].casefold()
    if first == "de" and start + 2 < len(tokens) and f"{first} {tokens[start + 1].casefold()}" in MULTI_PARTICLES:
        return tokens[start:start + 3], start + 3
    if first in SURNAME_PARTICLES:
        return tokens[start:start + 2], min(start + 2, len(tokens))
    return tokens[start:start + 1], start + 1


def infer_contact_name(source: str) -> dict:
    tokens = str(source or "").strip().split()
    if len(tokens) < 3:
        suggested = natural_name(source)
        return {"nombres_contacto": suggested, "apellidos_contacto": "", "nombre_contacto": suggested, "confianza": "BAJA"}
    first_surname, index = consume_surname(tokens, 0)
    second_surname, index = consume_surname(tokens, index)
    given = tokens[index:]
    if not given or not first_surname or not second_surname:
        suggested = natural_name(source)
        return {"nombres_contacto": suggested, "apellidos_contacto": "", "nombre_contacto": suggested, "confianza": "BAJA"}
    surnames = natural_name(" ".join(first_surname + second_surname))
    names = natural_name(" ".join(given))
    if any(len(token) == 1 and token.isalpha() for token in first_surname + second_surname):
        confidence = "BAJA"
    else:
        confidence = "MEDIA" if len(first_surname) > 1 or len(second_surname) > 1 or len(tokens) == 3 else "ALTA"
    return {"nombres_contacto": names, "apellidos_contacto": surnames, "nombre_contacto": f"{names} {surnames}", "confianza": confidence}


def load_contact_audit():
    if not CONTACT_NAMES_FILE.exists():
        return {}
    with CONTACT_NAMES_FILE.open("r", encoding="utf-8", newline="") as handle:
        return {row.get("slug", ""): row.get("nombre_override", "").strip() for row in csv.DictReader(handle) if row.get("slug")}


def write_contact_audit(rows_with_slugs):
    existing = {}
    if CONTACT_NAMES_FILE.exists():
        with CONTACT_NAMES_FILE.open("r", encoding="utf-8", newline="") as handle:
            existing = {row.get("slug", ""): row for row in csv.DictReader(handle) if row.get("slug")}
    current = {}
    for row, slug in rows_with_slugs:
        source = str(row.get("nombre_original") or row.get("nombre") or "").strip()
        inferred = infer_contact_name(source)
        audit_row = existing.get(slug, {})
        override = str(audit_row.get("nombre_override") or "").strip()
        current[slug] = {"slug": slug, "nombre_fuente": source, "nombre_sugerido": inferred["nombre_contacto"], "nombres_sugeridos": inferred["nombres_contacto"], "apellidos_sugeridos": inferred["apellidos_contacto"], "confianza": inferred["confianza"], "nombre_override": override, "nombres_override": str(audit_row.get("nombres_override") or "").strip(), "apellidos_override": str(audit_row.get("apellidos_override") or "").strip()}
    orphaned = {slug: row for slug, row in existing.items() if slug not in current}
    with CONTACT_NAMES_FILE.open("w", encoding="utf-8", newline="") as handle:
        fields = ["slug", "nombre_fuente", "nombre_sugerido", "nombres_sugeridos", "apellidos_sugeridos", "confianza", "nombre_override", "nombres_override", "apellidos_override"]
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows([current[slug] for _, slug in rows_with_slugs])
        writer.writerows(orphaned.values())
    return current


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


def region_rank(value):
    key = unicodedata.normalize("NFD", str(value or "")).encode("ascii", "ignore").decode().casefold()
    for index, region in enumerate(REGION_ORDER):
        target = unicodedata.normalize("NFD", region).encode("ascii", "ignore").decode().casefold()
        if key == target:
            return index
    return len(REGION_ORDER)


def sort_regions(values):
    return sorted(dedupe(values), key=lambda value: (region_rank(value), str(value).casefold()))


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


def render_vcard_action(row: dict, slug: str, canonical: str, audit_row: dict) -> str:
    phones = collect_phones(row)
    emails = collect_emails(row)
    note_parts = []
    corte = str(row.get("corte") or "").strip()
    comunas = listify(row.get("comunas_cubiertas"))
    if corte:
        note_parts.append(f"Corte: {corte}")
    if comunas:
        note_parts.append("Comunas: " + ", ".join(comunas))
    inferred = infer_contact_name(str(row.get("nombre_original") or row.get("nombre") or "").strip())
    override = audit_row.get("nombre_override", "").strip()
    given_names = audit_row.get("nombres_override", "").strip() or inferred["nombres_contacto"]
    surnames = audit_row.get("apellidos_override", "").strip() or inferred["apellidos_contacto"]
    contact_name = override or inferred["nombre_contacto"]
    contact = {
        "name": contact_name,
        "given": given_names,
        "surnames": surnames,
        "phone": next((phone["href"][4:] for phone in phones if phone["href"].startswith("tel:")), ""),
        "email": emails[0] if emails else "",
        "note": "; ".join(note_parts),
        "url": canonical,
        "filename": slug + ".vcf",
    }
    payload = json.dumps(contact, ensure_ascii=False, separators=(",", ":"))
    return f'''<div class="contact-actions"><button type="button" id="save-contact">Guardar contacto</button></div><script>
const contactData={payload};
function escapeVCard(value){{return String(value||"").replace(/([\\\\,;])/g,"\\\\$1").replace(/\\r?\\n|\\r/g,"\\\\n");}}
document.getElementById("save-contact").addEventListener("click",()=>{{const lines=["BEGIN:VCARD","VERSION:3.0",contactData.name&&`FN:${{escapeVCard(contactData.name)}}`,`N:${{escapeVCard(contactData.surnames)}};${{escapeVCard(contactData.given)}};;;`,contactData.phone&&`TEL;TYPE=CELL:${{escapeVCard(contactData.phone)}}`,contactData.email&&`EMAIL:${{escapeVCard(contactData.email)}}` ,"ORG:Receptor Judicial",contactData.note&&`NOTE:${{escapeVCard(contactData.note)}}`,`URL:${{escapeVCard(contactData.url)}}`,"END:VCARD"].filter(Boolean);const blob=new Blob([lines.join("\\r\\n")+"\\r\\n"],{{type:"text/vcard;charset=utf-8"}});const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=contactData.filename;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);}});
</script>'''


def render_list(values, empty_text="No informado."):
    values = dedupe(values)
    if not values:
        return f'<p class="empty">{esc(empty_text)}</p>'
    return "<p>" + esc(", ".join(values)) + "</p>"


def render_rating_widget(receptor_id: str) -> str:
    return f'''<section class="rating-widget" data-receptor-id="{esc(receptor_id)}" aria-label="Recomendación y comentario"><div class="rating-title">Recomendaciones</div><div class="rating-summary">Cargando recomendaciones…</div><div class="rating-actions"><button type="button" data-recommend aria-label="Recomendar receptor" aria-pressed="false">Recomendar</button><button type="button" data-feedback-toggle>Enviar comentario</button></div><p class="rating-note">Las recomendaciones son anónimas. Los comentarios son privados por defecto y, si lo autorizas, pueden enviarse a moderación para aparecer en la ficha del receptor.</p><form class="rating-feedback" hidden><fieldset><legend>¿Qué influyó en tu experiencia?</legend><label><input type="checkbox" name="reason" value="rapidez"> Rapidez</label><label><input type="checkbox" name="reason" value="comunicacion"> Comunicación</label><label><input type="checkbox" name="reason" value="disponibilidad"> Disponibilidad</label><label><input type="checkbox" name="reason" value="cumplimiento"> Cumplimiento</label><label><input type="checkbox" name="reason" value="trato"> Trato</label><label><input type="checkbox" name="reason" value="honorarios"> Honorarios</label></fieldset><label class="rating-comment"><span class="rating-comment-label">Comentario opcional</span><textarea name="comment" maxlength="300" rows="3"></textarea></label><div class="turnstile-slot"><span class="turnstile-status" role="status" aria-live="polite"></span></div><button type="submit">Enviar comentario</button><span class="feedback-message" role="status"></span><label class="rating-public-consent"><input type="checkbox" name="allow_publication"> Autorizo que este comentario pueda publicarse sin mostrar mi identidad en la sección "Comentarios de usuarios" de la ficha de este receptor, sujeto a moderación.</label><p class="rating-public-note">Si no marcas esta opción, el comentario permanecerá privado.</p><p class="rating-public-note" data-publication-note hidden>Si es aprobado, aparecerá públicamente en la ficha de este receptor. La autorización no garantiza su publicación. No incluyas datos de causas, RUT, teléfonos, correos ni datos personales de terceros.</p></form></section>'''


def render_public_comments(receptor_id: str) -> str:
    return f"""<section class="section full public-comments" data-public-comments data-receptor-id="{esc(receptor_id)}"><h2>Comentarios de usuarios</h2><p class="public-comments-empty">Aún no hay comentarios públicos moderados para este receptor.</p><div class="public-comments-list"></div><p class="public-comments-note">Los comentarios que aparecen aquí fueron enviados con una cuenta Google verificada, autorizados para publicación y aprobados mediante moderación. La verificación de Google no acredita identidad legal ni una relación profesional con el receptor.</p></section>"""


def render_rating_scripts() -> str:
    return '''<link rel="stylesheet" href="/ratings.css?v=20260901-3"><script>window.RECEPTORES_TURNSTILE_SITE_KEY = "0x4AAAAAAEkQy8FIbatMffjR";</script><script src="/ratings.js?v=20260902-6" defer></script>'''


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
.contact-actions{margin-top:0}.contact-actions button{font:inherit;font-size:13px;text-decoration:none;border:1px solid #b7b7b0;border-radius:6px;padding:7px 10px;color:var(--ink);background:#fff;cursor:pointer;min-height:34px}.contact-actions button:hover{color:#111;border-color:#111;background:#fafaf8}
.notice{margin-top:32px;padding:16px 18px;background:var(--surface);border:1px solid var(--line);font-size:14px;color:#444}.meta{margin-top:24px;font-size:13px;color:var(--muted)}
footer{border-top:1px solid var(--line);padding:22px 0 40px;font-size:13px;color:var(--muted)}footer .shell{display:flex;justify-content:space-between;gap:18px;flex-wrap:wrap}.public-comments-list{display:grid;gap:18px}.public-comment{border-top:1px solid var(--line);padding-top:16px}.public-comment-text{font-size:15px}.public-comment-reasons,.public-comment-meta,.public-comments-note{font-size:13px;color:var(--muted)}
@media(max-width:650px){.header-inner{align-items:flex-start;flex-direction:column;gap:4px}main{padding-top:34px}.grid{display:block}.section,.section:nth-child(odd),.section:nth-child(even){padding:20px 0;border-left:0}}
"""


def render_receptor_page(row: dict, slug: str, contact_audit: dict) -> str:
    name = str(row.get("nombre") or row.get("nombre_original") or "Receptor judicial")
    corte = str(row.get("corte") or "").strip()
    tribunal = str(row.get("tribunal_fuente") or "").strip()
    territorio = str(row.get("territorio") or "").strip()
    comunas = listify(row.get("comunas_cubiertas"))
    regiones = sort_regions(listify(row.get("regiones")))
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
{render_rating_widget(str(row.get("id") or ""))}
{render_public_comments(str(row.get("id") or ""))}
<div class="grid">
<section class="section"><h2>Corte</h2><p>{esc(corte or "No informada")}</p></section>
<section class="section"><h2>Tribunal / adscripción</h2><p>{esc(tribunal or "No informado")}</p></section>
<section class="section"><h2>Teléfono</h2>{render_phone_rows(phones)}</section>
<section class="section"><h2>Correo</h2>{render_email_rows(emails)}</section>
<section class="section full">{render_vcard_action(row, slug, canonical, contact_audit)}</section>
<section class="section full"><h2>Comunas cubiertas</h2>{render_list(comunas, "Cobertura comunal no informada.")}</section>
<section class="section full"><h2>Región</h2>{render_list(regiones, "Región no informada.")}</section>
</div>
<div class="notice">Directorio no oficial. Los datos provienen de información publicada por el Poder Judicial. Verifica la información directamente antes de encargar una diligencia.</div>
<p class="meta">Fuente: {esc(row.get("fuente") or "Poder Judicial")} · Actualización: {esc(row.get("fecha_fuente") or "sin fecha informada")}</p>
</main>
<footer><div class="shell"><span>Receptores Chile</span><span><a href="/privacidad/">Privacidad</a> · <a href="/">Volver al buscador</a></span></div></footer>
<!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{{"token":"47df7ee006864c7cb89ac9a9ec036ba4"}}'></script><!-- End Cloudflare Web Analytics -->
<script defer src="/analytics.js?v=20260901-3"></script>{render_rating_scripts()}</body></html>'''


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
<footer><div class="shell"><span>Receptores Chile</span><span><a href="/privacidad/">Privacidad</a> · <a href="/">Volver al buscador</a></span></div></footer><!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{{"token":"47df7ee006864c7cb89ac9a9ec036ba4"}}'></script><!-- End Cloudflare Web Analytics -->
<script defer src="/analytics.js?v=20260901-3"></script></body></html>'''


def render_ranking_page() -> str:
    return f"""<!doctype html><html lang="es-CL"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ranking de receptores judiciales | {SITE_NAME}</title><meta name="description" content="Ranking público de receptores judiciales en Chile según recomendaciones anónimas."><meta name="robots" content="index,follow"><link rel="canonical" href="{BASE_URL}/ranking/"><style>{PAGE_CSS}.ranking{{list-style:none;padding:0;margin:26px 0;border-top:1px solid var(--line)}}.ranking li{{display:grid;grid-template-columns:2fr 1fr .7fr .7fr;gap:14px;padding:14px 0;border-bottom:1px solid var(--line);align-items:baseline}}.ranking small{{color:var(--muted)}}.ranking-note{{font-size:14px;color:var(--muted);max-width:680px}}@media(max-width:650px){{.ranking li{{grid-template-columns:1fr 1fr}}}}</style></head><body><header><div class="shell header-inner"><a class="brand" href="/">Receptores Chile</a><a class="back" href="/">Buscador</a></div></header><main class="shell"><p class="eyebrow">Recomendaciones anónimas</p><h1>Ranking de recomendaciones</h1><p class="lead">El orden prioriza la cantidad de recomendaciones recibidas.</p><p class="ranking-note">Las recomendaciones reflejan interacciones de usuarios del sitio y no constituyen una evaluación profesional ni verifican una relación previa con el receptor.</p><ul id="ranking" class="ranking"><li>Cargando ranking…</li></ul></main><footer><div class="shell"><span>Receptores Chile</span><span><a href="/privacidad/">Privacidad</a> · <a href="/">Volver al buscador</a></span></div></footer><script>window.RECEPTORES_TURNSTILE_SITE_KEY="0x4AAAAAAEkQy8FIbatMffjR";</script><script src="/ratings.js?v=20260902-6" defer></script><script>const API="https://receptores-analytics.adminbase100.workers.dev";fetch("/data/receptores.json").then(r=>r.json()).then(rows=>fetch(API+"/ratings/top?limit=100").then(r=>r.json()).then(data=>{{const byId=new Map(rows.map(r=>[r.id,r]));const el=document.getElementById("ranking");const ratings=Array.isArray(data.ratings)?data.ratings:[];el.replaceChildren(...ratings.map(item=>{{const r=byId.get(item.receptor_id)||{{}};const li=document.createElement("li");const name=document.createElement("span");const link=document.createElement("a");link.href="/receptores/"+String(r.id||item.receptor_id).replace(/^rec-\\d+-/,"")+".html";link.textContent=r.nombre||item.receptor_id;name.appendChild(link);const place=document.createElement("small");place.textContent=r.corte||r.tribunal_fuente||"Adscripción no informada";const count=document.createElement("span");count.textContent=String(item.recommendations)+" recomendaciones";li.append(name,place,count);return li}}));if(!ratings.length)el.textContent="Aún no hay receptores con 5 recomendaciones.";}})).catch(()=>{{document.getElementById("ranking").textContent="No fue posible cargar el ranking.";}});</script></body></html>"""

def write_sitemap(rows_with_slugs, today: str):
    urls = [(f"{BASE_URL}/", today), (f"{BASE_URL}/receptores/", today), (f"{BASE_URL}/ranking/", today)]
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

    contact_audit = write_contact_audit(rows_with_slugs)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("*.html"):
        old.unlink()
    for row, slug in rows_with_slugs:
        (OUT_DIR / f"{slug}.html").write_text(render_receptor_page(row, slug, contact_audit[slug]), encoding="utf-8")
    (OUT_DIR / "index.html").write_text(render_directory(rows_with_slugs), encoding="utf-8")
    RANKING_DIR.mkdir(parents=True, exist_ok=True)
    ranking_html = render_ranking_page().replace("ratings.js?v=20260901-" + "4", "ratings.js?v=20260902-6")
    (RANKING_DIR / "index.html").write_text(ranking_html, encoding="utf-8")

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
    counts = {level: sum(1 for row in contact_audit.values() if row.get("confianza") == level) for level in ("ALTA", "MEDIA", "BAJA")}
    print(f"Auditoría nombres:    total {len(rows_with_slugs)} · ALTA {counts['ALTA']} · MEDIA {counts['MEDIA']} · BAJA {counts['BAJA']}")
    print("\nCasos MEDIA/BAJA para revisión:")
    doubtful = [row for row in contact_audit.values() if row.get("confianza") in {"MEDIA", "BAJA"}]
    for row in sorted(doubtful, key=lambda item: (0 if item.get("confianza") == "BAJA" else 1, item.get("slug", "")))[:20]:
        print(f"  {row['confianza']} - {row['slug']} - {row['nombre_fuente']} -> {row['nombre_sugerido']}")
    print("\nEjemplos:")
    for row, slug in rows_with_slugs[:3]:
        print(f"  /receptores/{slug}.html — {row.get('nombre','')}")


if __name__ == "__main__":
    main()





