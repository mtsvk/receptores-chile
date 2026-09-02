from __future__ import annotations

import csv
import json
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
SOURCE = DATA / "source" / "receptores_pjud_normalizados.csv"

RECEPTORES_OUT = DATA / "receptores.json"
SEARCH_OUT = DATA / "search-index.json"
META_OUT = DATA / "meta.json"

COMUNAS_FILE = DATA / "comunas.json"
CORTES_FILE = DATA / "cortes.json"
TRIBUNALES_FILE = DATA / "tribunales.json"

EXPECTED_RECEPTORS = 693


def normalize_text(s: str | None) -> str:
    s = "" if s is None else str(s)
    s = s.strip().lower()
    s = s.replace("ñ", "__enie__")
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    s = s.replace("__enie__", "ñ")
    s = s.replace("°", " ")
    s = re.sub(r"[^a-z0-9ñ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", normalize_text(s).replace("ñ", "n")).strip("-")


def title_keep(s: str | None) -> str:
    if not s:
        return ""
    small = {"de", "del", "la", "las", "los", "y", "en", "lo", "el"}
    parts = re.split(r"(\s+)", s.strip().lower())
    out = []
    for p in parts:
        if p.isspace():
            out.append(p)
        elif p in small:
            out.append(p)
        else:
            out.append(p[:1].upper() + p[1:])
    return "".join(out).replace("Ii", "II").replace("Iii", "III")


def clean_email(v: str | None) -> str:
    v = (v or "").strip().strip(";").lower()
    return v if "@" in v else ""


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def dump_json(path: Path, obj):
    with path.open("w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def split_pipe(v: str | None) -> list[str]:
    return [x.strip() for x in (v or "").split(" | ") if x.strip()]


def canonical_court(raw: str) -> str:
    n = normalize_text(raw)
    for prefix in ("corte de apelaciones de ", "corte apelaciones de "):
        if n.startswith(prefix):
            place = n[len(prefix):]
            return "Corte de Apelaciones de " + title_keep(place)
    return title_keep(raw)


def tribunal_pretty(raw: str) -> str:
    return (
        title_keep(raw)
        .replace("Juzgado De", "Juzgado de")
        .replace("Letras Y Garantia", "Letras y Garantía")
        .replace("Garantia", "Garantía")
        .replace("Valparaiso", "Valparaíso")
        .replace("Concepcion", "Concepción")
        .replace("Copiapo", "Copiapó")
        .replace("Chillan", "Chillán")
        .replace("Curico", "Curicó")
        .replace("Quilpue", "Quilpué")
    )


def infer_territory(corte: str, tribunal_raw: str, cortes, tribunales):
    court_map = {normalize_text(c["nombre"]): c for c in cortes}

    tribunal_lookup = {}
    asiento_lookup = defaultdict(list)
    for t in tribunales:
        keys = {normalize_text(t.get("nombre", ""))}
        keys.update(t.get("aliases", []))
        for k in keys:
            tribunal_lookup.setdefault(normalize_text(k), t)
        if t.get("asiento"):
            asiento_lookup[normalize_text(t["asiento"])].append(t)

    ntrib = normalize_text(tribunal_raw)
    tmatch = tribunal_lookup.get(ntrib)

    if not tmatch:
        # Conservative fallback: exact final place-name matching.
        m = re.search(r"\bde\s+(.+)$", tribunal_raw or "", flags=re.I)
        if m:
            matches = asiento_lookup.get(normalize_text(m.group(1)), [])
            if matches:
                tmatch = matches[0]

    flags = []
    notas = []
    related = []
    coms = []

    if tmatch and tmatch.get("comunas_competencia"):
        coms = list(tmatch["comunas_competencia"])
        related = [tmatch["nombre"]]
    elif ntrib.startswith("corte de apelaciones") and normalize_text(corte) in court_map:
        coms = list(court_map[normalize_text(corte)].get("regiones_comunas", []))
        related = [corte]
        flags.append("court_level_assignment")
        notas.append(
            "Adscripción informada a nivel de Corte; cobertura territorial estimada "
            "desde el territorio jurisdiccional de la Corte."
        )
    else:
        ct = court_map.get(normalize_text(corte))
        if ct:
            coms = list(ct.get("regiones_comunas", []))
            flags.append("territory_inferred_from_court_not_specific_tribunal")
            notas.append(
                "No se encontró coincidencia territorial exacta para el tribunal; "
                "se muestra como referencia la cobertura de la Corte. Verificar."
            )
        else:
            flags.append("no_territory_inferred")

    # Regla especial Santiago/San Miguel ya usada por el proyecto.
    if normalize_text(corte) in {
        normalize_text("Corte de Apelaciones de Santiago"),
        normalize_text("Corte de Apelaciones de San Miguel"),
    }:
        combined = set(coms)
        for cn in (
            "Corte de Apelaciones de Santiago",
            "Corte de Apelaciones de San Miguel",
        ):
            c = court_map.get(normalize_text(cn))
            if c:
                combined.update(c.get("regiones_comunas", []))
        coms = sorted(combined)
        flags.append("santiago_san_miguel_rule")
        notas.append(
            "Regla especial Santiago/San Miguel considerada para búsqueda territorial; "
            "verificar competencia antes de diligenciar."
        )

    return sorted(set(coms)), related, flags, notas


def build_search_index(receptores, comunas, tribunales, cortes):
    aliases = {
        "stgo": "santiago",
        "s miguel": "san miguel",
        "valpo": "valparaiso",
        "vina": "viña del mar",
        "viña": "viña del mar",
        "coyhaique": "coihaique",
        "calera": "la calera",
        "llay llay": "llay-llay",
    }

    tokens = Counter()
    for r in receptores:
        fields = (
            [r["nombre"], r["corte"], r.get("tribunal_fuente", "")]
            + r.get("comunas_cubiertas", [])[:12]
            + r.get("regiones", [])
        )
        for field in fields:
            for tok in normalize_text(field).split():
                if len(tok) > 1:
                    tokens[tok] += 1

    return {
        "tokens": [{"token": k, "count": v} for k, v in tokens.most_common(1000)],
        "aliases": aliases,
        "ngrams": [],
        "referencias_cruzadas": {
            "receptores": len(receptores),
            "comunas": len(comunas),
            "tribunales": len(tribunales),
            "cortes": len(cortes),
        },
    }


def main():
    required = [SOURCE, COMUNAS_FILE, CORTES_FILE, TRIBUNALES_FILE]
    missing = [str(p) for p in required if not p.exists()]
    if missing:
        raise SystemExit("Faltan archivos requeridos:\n  " + "\n  ".join(missing))

    comunas = load_json(COMUNAS_FILE)
    cortes = load_json(CORTES_FILE)
    tribunales = load_json(TRIBUNALES_FILE)

    with SOURCE.open("r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    if len(rows) != EXPECTED_RECEPTORS:
        raise SystemExit(
            f"BLOQUEADO: se esperaban {EXPECTED_RECEPTORS} receptores y llegaron {len(rows)}. "
            "Revisar fuente antes de publicar."
        )

    comuna_region = {c["nombre"]: c.get("region", "") for c in comunas}
    receptores = []

    for idx, r in enumerate(rows, start=1):
        nombre_original = (r.get("Nombre") or "").strip()
        corte = canonical_court((r.get("Corte") or "").strip())
        trib_raw = (r.get("Tribunal") or "").strip()
        tribunal_name = tribunal_pretty(trib_raw)

        coms, related, territory_flags, notas = infer_territory(
            corte, trib_raw, cortes, tribunales
        )
        regiones = sorted(
            {
                comuna_region.get(c, "")
                for c in coms
                if comuna_region.get(c, "")
            }
        )

        email1 = clean_email(r.get("Correo_Principal"))
        email2 = clean_email(r.get("Correo_Alternativo"))
        emails = []
        for e in (email1, email2):
            if e and e not in emails:
                emails.append(e)

        phone_flags = split_pipe(r.get("Flags_Telefono"))
        all_flags = sorted(set(territory_flags + phone_flags))

        mobile_original = (r.get("Telefono_Celular_Original") or "").strip()
        fixed_original = (r.get("Telefono_Fijo_Original") or "").strip()

        # Compatibility fields expected by the frontend.
        # Crucially: no 8-digit reconstruction.
        whatsapp_links = split_pipe(r.get("Whatsapp_Links_Seguros"))
        wa_number = ""
        if whatsapp_links:
            m = re.search(r"wa\.me/(\d+)", whatsapp_links[0])
            wa_number = m.group(1) if m else ""

        primary_normalized = (r.get("Telefono_Principal_Normalizado") or "").strip()

        item = {
            "id": f"rec-{idx:04d}-{slugify(nombre_original)}",
            "nombre": title_keep(nombre_original),
            "nombre_original": nombre_original,
            "nombre_normalizado": normalize_text(nombre_original),

            "corte": corte,
            "corte_normalizada": normalize_text(corte),
            "territorio": corte,

            # Deliberately removed misleading synthetic comuna_base.
            "regiones": regiones,
            "comunas_cubiertas": coms,
            "tribunales_relacionados": related or ([tribunal_name] if tribunal_name else []),
            "tribunal_fuente": tribunal_name,

            # Raw/display values from PJUD.
            "telefono": mobile_original,
            "telefono_fijo": fixed_original,
            "telefono_celular_display": (r.get("Telefono_Celular_Display") or "").strip(),
            "telefono_fijo_display": (r.get("Telefono_Fijo_Display") or "").strip(),

            # Safe machine-use values only.
            "telefono_normalizado": primary_normalized,
            "telefono_whatsapp_normalizado": wa_number,
            "telefono_valido_whatsapp": bool(wa_number),
            "tel_links_seguros": split_pipe(r.get("Tel_Links_Seguros")),
            "whatsapp_links_seguros": whatsapp_links,

            "telefono_estado_celular": split_pipe(r.get("Estados_Celular")),
            "telefono_estado_fijo": split_pipe(r.get("Estados_Fijo")),
            "requiere_revision_telefono": (
                (r.get("Requiere_Revision_Telefono") or "").strip().upper() == "SI"
            ),

            "email": emails[0] if emails else "",
            "emails": emails,

            "fuente": "Poder Judicial — Transparencia — Receptores Judiciales",
            "fecha_fuente": "2026-08-28",
            "notas": " ".join(notas),
            "flags_calidad": all_flags,
        }

        receptores.append(item)

    # Hard QA gates.
    ids = [r["id"] for r in receptores]
    if len(ids) != len(set(ids)):
        raise SystemExit("BLOQUEADO: IDs duplicados en receptores.json")

    names = [normalize_text(r["nombre_original"]) for r in receptores]
    if len(names) != len(set(names)):
        dup = [n for n, c in Counter(names).items() if c > 1]
        print("ADVERTENCIA: nombres repetidos:", dup)

    search_index = build_search_index(receptores, comunas, tribunales, cortes)

    meta = {
        "app": "Receptores Chile",
        "generado": str(date.today()),
        "fuente_directorio": {
            "nombre": "Poder Judicial — Transparencia — Receptores Judiciales",
            "archivo_local": "data/source/receptores_pjud_oficial.csv",
            "fecha_extraccion": "2026-08-28",
            "registros_fuente": len(rows),
        },
        "normalizacion_contactos": {
            "archivo": "data/source/receptores_pjud_normalizados.csv",
            "criterio": (
                "Se conservan los datos publicados. Los teléfonos chilenos de ocho "
                "dígitos compatibles con móvil pueden recibir una inferencia de "
                "prefijo 9 para enlaces de contacto; es una normalización y no "
                "modifica la fuente original. Los números ambiguos no generan "
                "enlaces automáticos."
            ),
        },
        "conteos": {
            "receptores": len(receptores),
            "receptores_con_whatsapp": sum(
                1 for r in receptores if r["telefono_valido_whatsapp"]
            ),
            "receptores_con_email": sum(1 for r in receptores if r["email"]),
            "receptores_revision_telefono": sum(
                1 for r in receptores if r["requiere_revision_telefono"]
            ),
            "comunas": len(comunas),
            "tribunales": len(tribunales),
            "cortes": len(cortes),
        },
        "disclaimer": (
            "Sitio no oficial. Los datos de contacto se reproducen desde la publicación "
            "del Poder Judicial y pueden contener omisiones o inconsistencias. "
            "Verifique ante el Poder Judicial o el tribunal correspondiente."
        ),
    }

    dump_json(RECEPTORES_OUT, receptores)
    dump_json(SEARCH_OUT, search_index)
    dump_json(META_OUT, meta)

    print()
    print("BUILD ACTUAL PJUD")
    print("=" * 60)
    print(f"Receptores:              {len(receptores)}")
    print(f"Con WhatsApp seguro:     {meta['conteos']['receptores_con_whatsapp']}")
    print(f"Con email:               {meta['conteos']['receptores_con_email']}")
    print(f"Revisión teléfono:       {meta['conteos']['receptores_revision_telefono']}")
    print(f"Comunas:                 {len(comunas)}")
    print(f"Tribunales:              {len(tribunales)}")
    print(f"Cortes:                  {len(cortes)}")
    print()
    print("Generados:")
    print(f"  {RECEPTORES_OUT.relative_to(ROOT)}")
    print(f"  {SEARCH_OUT.relative_to(ROOT)}")
    print(f"  {META_OUT.relative_to(ROOT)}")
    print()
    print("QA: NO se reconstruyen teléfonos de 8 dígitos.")


if __name__ == "__main__":
    main()
