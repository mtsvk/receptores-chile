from __future__ import annotations

import csv
import re
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

SOURCE = ROOT / "data" / "source" / "receptores_pjud_oficial.csv"
OUT = ROOT / "data" / "source" / "receptores_pjud_normalizados.csv"
AUDIT = ROOT / "data" / "audit" / "auditoria_normalizacion_contactos.csv"


def clean(value):
    return "" if value is None else str(value).strip()


def join_unique(values):
    out = []
    seen = set()

    for value in values:
        value = clean(value)

        if not value:
            continue

        if value in seen:
            continue

        seen.add(value)
        out.append(value)

    return " | ".join(out)


def split_phone_cell(value):
    """
    Divide una celda sólo usando separadores razonablemente seguros.

    No divide espacios ni guiones, porque pueden ser parte del formato
    visual de un único teléfono.
    """

    value = clean(value)

    if not value:
        return []

    parts = re.split(
        r"\s*(?:/|;|\||,\s*(?=\d)|\by/o\b)\s*",
        value,
        flags=re.IGNORECASE,
    )

    return [
        p.strip()
        for p in parts
        if p.strip()
    ]


def digits_only(value):
    return re.sub(
        r"\D+",
        "",
        clean(value),
    )


def canonical_national_digits(value):
    """
    Normalización estructural conservadora.

    Puede retirar:
    - 0056;
    - 56;
    - un 0 troncal.

    Nunca agrega dígitos.
    """

    d = digits_only(value)

    if d.startswith("0056") and len(d) > 4:
        d = d[4:]

    elif d.startswith("56") and len(d) in (10, 11):
        d = d[2:]

    if d.startswith("0") and len(d) == 10:
        d = d[1:]

    return d


def pretty_e164(digits):
    if len(digits) != 9:
        return ""

    if digits.startswith("9"):
        return (
            f"+56 {digits[0]} "
            f"{digits[1:5]} "
            f"{digits[5:]}"
        )

    return (
        f"+56 {digits[0]} "
        f"{digits[1:5]} "
        f"{digits[5:]}"
    )


def parse_phone(value, source_field):
    """
    Clasifica un teléfono individual sin inventar información.

    source_field:
        Telefono_Celular
        Telefono_Fijo
    """

    original = clean(value)
    d = canonical_national_digits(original)

    out = {
        "original": original,
        "digits": d,
        "normalized": "",
        "type": "",
        "status": "",
        "safe_link": "",
        "safe_whatsapp": "",
        "review": True,
    }

    if not d:
        out["status"] = "VACIO"
        out["review"] = False
        return out

    if set(d) == {"0"}:
        out["status"] = "INVALIDO"
        return out

    # ---------------------------------------------------------
    # Número nacional de 9 dígitos
    # ---------------------------------------------------------

    if len(d) == 9:
        out["normalized"] = pretty_e164(d)

        # Móvil
        if d.startswith("9"):
            out["type"] = "movil"

            if source_field == "Telefono_Celular":
                out["status"] = "OK_MOVIL"
                out["safe_link"] = f"tel:+56{d}"

                # WhatsApp sólo se habilita en este caso:
                # móvil estructuralmente válido publicado
                # explícitamente por PJUD como celular.
                out["safe_whatsapp"] = (
                    f"https://wa.me/56{d}"
                )

                out["review"] = False

            else:
                out["status"] = (
                    "MOVIL_EN_CAMPO_FIJO"
                )

                # El número sigue siendo telefónicamente
                # plausible, por lo que tel: es seguro.
                out["safe_link"] = f"tel:+56{d}"

                # Pero NO generamos WhatsApp desde
                # el campo fijo.
                out["review"] = True

        # Fijo
        else:
            out["type"] = "fijo"

            if source_field == "Telefono_Fijo":
                out["status"] = "OK_FIJO"
                out["safe_link"] = f"tel:+56{d}"
                out["review"] = False

            else:
                out["status"] = (
                    "FIJO_EN_CAMPO_CELULAR"
                )
                out["safe_link"] = f"tel:+56{d}"
                out["review"] = True

        return out

    # ---------------------------------------------------------
    # 8 dígitos: se conserva exactamente lo publicado por PJUD
    # ---------------------------------------------------------

    if len(d) == 8:
        out["status"] = "FORMATO_PJUD_8_DIGITOS"

        if source_field == "Telefono_Celular":
            out["type"] = "celular_fuente"
        else:
            out["type"] = "fijo_fuente"

        # IMPORTANTE:
        #
        # NO agregar 9.
        # NO tel:
        # NO WhatsApp.
        # NO adivinar tipo real.
        #
        # El valor simplemente se conserva.
        return out

    if len(d) < 8:
        out["status"] = "INVALIDO_CORTO"
        return out

    out["status"] = "INVALIDO_LARGO"
    return out


def write_csv(path, rows, fieldnames):
    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    with path.open(
        "w",
        encoding="utf-8-sig",
        newline="",
    ) as f:

        writer = csv.DictWriter(
            f,
            fieldnames=fieldnames,
            extrasaction="ignore",
        )

        writer.writeheader()
        writer.writerows(rows)


def main():

    if not SOURCE.exists():
        raise SystemExit(
            "No existe la fuente oficial esperada:\n"
            f"{SOURCE}"
        )

    with SOURCE.open(
        "r",
        encoding="utf-8-sig",
        newline="",
    ) as f:
        rows = list(csv.DictReader(f))

    if not rows:
        raise SystemExit(
            "La fuente oficial está vacía."
        )

    required = {
        "Nombre",
        "Corte",
        "Tribunal",
        "Correo_Principal",
        "Correo_Alternativo",
        "Telefono_Celular",
        "Telefono_Fijo",
    }

    missing = required - set(rows[0].keys())

    if missing:
        raise SystemExit(
            "Faltan columnas requeridas:\n  "
            + "\n  ".join(sorted(missing))
        )

    # =========================================================
    # PRIMERA PASADA
    # Parseo individual y mapa de teléfonos compartidos
    # =========================================================

    parsed_per_row = []
    number_people = defaultdict(set)

    for r in rows:

        parsed = {
            "Telefono_Celular": [
                parse_phone(
                    x,
                    "Telefono_Celular",
                )
                for x in split_phone_cell(
                    r.get("Telefono_Celular")
                )
            ],
            "Telefono_Fijo": [
                parse_phone(
                    x,
                    "Telefono_Fijo",
                )
                for x in split_phone_cell(
                    r.get("Telefono_Fijo")
                )
            ],
        }

        for field in (
            "Telefono_Celular",
            "Telefono_Fijo",
        ):
            for p in parsed[field]:

                if (
                    p["digits"]
                    and len(p["digits"]) >= 8
                ):
                    number_people[
                        p["digits"]
                    ].add(
                        clean(r.get("Nombre"))
                    )

        parsed_per_row.append(parsed)

    # =========================================================
    # SEGUNDA PASADA
    # Normalización por receptor
    # =========================================================

    normalized_rows = []
    audit_rows = []

    status_counter = Counter()
    flags_counter = Counter()

    for idx, (r, parsed) in enumerate(
        zip(rows, parsed_per_row),
        start=2,
    ):

        nombre = clean(r.get("Nombre"))

        cel = parsed["Telefono_Celular"]
        fijo = parsed["Telefono_Fijo"]

        all_items = cel + fijo

        # -----------------------------------------------------
        # Mismo número literal en ambas columnas
        # -----------------------------------------------------

        same_in_both = bool(
            {
                x["digits"]
                for x in cel
                if x["digits"]
            }
            &
            {
                x["digits"]
                for x in fijo
                if x["digits"]
            }
        )

        # -----------------------------------------------------
        # Número compartido entre receptores distintos
        # -----------------------------------------------------

        shared = sorted({
            x["digits"]
            for x in all_items
            if (
                x["digits"]
                and len(
                    number_people[x["digits"]]
                ) > 1
            )
        })

        # =====================================================
        # REGLA ESPECIAL 8D ↔ 9+8D
        #
        # Ejemplo:
        #
        # celular PJUD: 82368602
        # fijo PJUD:    982368602
        #
        # El segundo es exactamente:
        #
        #     "9" + "82368602"
        #
        # En ese caso:
        #
        # - preservamos ambos originales;
        # - usamos 982368602 como representación normalizada;
        # - permitimos tel:;
        # - NO generamos WhatsApp;
        # - deja de requerir revisión por esa inconsistencia.
        # =====================================================

        resolved_8d9d_pairs = []

        for c in cel:

            if (
                c["status"]
                == "FORMATO_PJUD_8_DIGITOS"
                and len(c["digits"]) == 8
            ):

                for f in fijo:

                    if (
                        f["status"]
                        == "MOVIL_EN_CAMPO_FIJO"
                        and len(f["digits"]) == 9
                        and f["digits"].startswith("9")
                        and f["digits"][1:]
                        == c["digits"]
                    ):

                        resolved_8d9d_pairs.append(
                            (c, f)
                        )

        resolved_item_ids = {
            id(item)
            for pair in resolved_8d9d_pairs
            for item in pair
        }

        # =====================================================
        # FLAGS
        # =====================================================

        flags = []

        if resolved_8d9d_pairs:
            flags.append(
                "COINCIDENCIA_8D_9D_MISMO_NUMERO"
            )
            flags.append(
                "RESUELTO_POR_COINCIDENCIA_8D_9D"
            )

        if same_in_both:
            flags.append(
                "MISMO_NUMERO_EN_CELULAR_Y_FIJO"
            )

        if shared:
            flags.append(
                "NUMERO_COMPARTIDO_ENTRE_RECEPTORES"
            )

        if any(
            x["status"]
            == "MOVIL_EN_CAMPO_FIJO"
            for x in fijo
        ):
            flags.append(
                "MOVIL_PLAUSIBLE_EN_CAMPO_FIJO"
            )

        if any(
            x["status"]
            == "FIJO_EN_CAMPO_CELULAR"
            for x in cel
        ):
            flags.append(
                "FIJO_PLAUSIBLE_EN_CAMPO_CELULAR"
            )

        if any(
            x["status"]
            == "FORMATO_PJUD_8_DIGITOS"
            for x in all_items
        ):
            flags.append(
                "FORMATO_PJUD_8_DIGITOS"
            )

        if any(
            x["status"].startswith("INVALIDO")
            for x in all_items
        ):
            flags.append(
                "TELEFONO_INVALIDO"
            )

        if not cel and not fijo:
            flags.append(
                "SIN_TELEFONOS_PUBLICADOS"
            )

        elif cel and not fijo:
            flags.append(
                "SOLO_CELULAR_PUBLICADO"
            )

        elif fijo and not cel:
            flags.append(
                "SOLO_FIJO_PUBLICADO"
            )

        # =====================================================
        # VALORES DE DISPLAY
        # =====================================================

        celulares_display = join_unique([
            x["original"]
            for x in cel
        ])

        fijos_display = join_unique([
            x["original"]
            for x in fijo
        ])

        # =====================================================
        # LINKS TEL:
        # =====================================================

        tel_link_values = [
            x["safe_link"]
            for x in all_items
            if x["safe_link"]
        ]

        # Agregamos explícitamente el tel: del 9D
        # respaldado por la coincidencia exacta.
        for _, f in resolved_8d9d_pairs:

            if f["digits"]:
                tel_link_values.append(
                    f"tel:+56{f['digits']}"
                )

        tel_links = join_unique(
            tel_link_values
        )

        # =====================================================
        # WHATSAPP
        #
        # EXCLUSIVAMENTE:
        # OK_MOVIL desde Telefono_Celular.
        #
        # Un 8D↔9D resuelto NO genera WhatsApp.
        # =====================================================

        wa_links = join_unique([
            x["safe_whatsapp"]
            for x in cel
            if x["safe_whatsapp"]
        ])

        # =====================================================
        # TELÉFONO PRINCIPAL
        # =====================================================

        mobile_ok = next(
            (
                x
                for x in cel
                if x["status"] == "OK_MOVIL"
            ),
            None,
        )

        fixed_ok = next(
            (
                x
                for x in fijo
                if x["status"] == "OK_FIJO"
            ),
            None,
        )

        resolved_8d9d = (
            resolved_8d9d_pairs[0][1]
            if resolved_8d9d_pairs
            else None
        )

        primary = (
            mobile_ok
            or fixed_ok
            or resolved_8d9d
        )

        if (
            primary is resolved_8d9d
            and resolved_8d9d is not None
        ):
            primary_status = (
                "RESUELTO_POR_COINCIDENCIA_8D_9D"
            )

        else:
            primary_status = (
                primary["status"]
                if primary
                else ""
            )

        # =====================================================
        # REQUIERE REVISIÓN
        # =====================================================

        unresolved_review = any(
            x["review"]
            for x in all_items
            if id(x) not in resolved_item_ids
        )

        # Los números compartidos y duplicados exactos
        # continúan siendo casos de revisión documental.
        structural_review = any(
            flag in flags
            for flag in (
                "MISMO_NUMERO_EN_CELULAR_Y_FIJO",
                "NUMERO_COMPARTIDO_ENTRE_RECEPTORES",
            )
        )

        requiere_revision = (
            unresolved_review
            or structural_review
        )

        # =====================================================
        # SALIDA NORMALIZADA
        # =====================================================

        normalized_rows.append({

            "Nombre":
                nombre,

            "Corte":
                clean(r.get("Corte")),

            "Tribunal":
                clean(r.get("Tribunal")),

            "Correo_Principal":
                clean(
                    r.get("Correo_Principal")
                ),

            "Correo_Alternativo":
                clean(
                    r.get("Correo_Alternativo")
                ),

            "Telefono_Celular_Original":
                clean(
                    r.get("Telefono_Celular")
                ),

            "Telefono_Fijo_Original":
                clean(
                    r.get("Telefono_Fijo")
                ),

            "Telefono_Celular_Display":
                celulares_display,

            "Telefono_Fijo_Display":
                fijos_display,

            "Telefono_Principal_Normalizado":
                (
                    primary["normalized"]
                    if primary
                    else ""
                ),

            "Telefono_Principal_Tipo":
                (
                    primary["type"]
                    if primary
                    else ""
                ),

            "Telefono_Principal_Estado":
                primary_status,

            "Tel_Links_Seguros":
                tel_links,

            "Whatsapp_Links_Seguros":
                wa_links,

            "Estados_Celular":
                join_unique([
                    x["status"]
                    for x in cel
                ]),

            "Estados_Fijo":
                join_unique([
                    x["status"]
                    for x in fijo
                ]),

            "Flags_Telefono":
                join_unique(flags),

            "Requiere_Revision_Telefono":
                (
                    "SI"
                    if requiere_revision
                    else "NO"
                ),
        })

        # =====================================================
        # AUDITORÍA
        #
        # Los pares 8D↔9D resueltos dejan de entrar
        # sólo por su antigua ambigüedad.
        # =====================================================

        for x in all_items:

            needs_audit = (
                (
                    x["review"]
                    and id(x)
                    not in resolved_item_ids
                )
                or same_in_both
                or x["digits"] in shared
            )

            if not needs_audit:
                continue

            if x in cel:
                source_field = (
                    "Telefono_Celular"
                )
            else:
                source_field = (
                    "Telefono_Fijo"
                )

            audit_rows.append({

                "SourceRow":
                    idx,

                "Nombre":
                    nombre,

                "Corte":
                    clean(r.get("Corte")),

                "Tribunal":
                    clean(r.get("Tribunal")),

                "CampoOrigen":
                    source_field,

                "ValorOriginal":
                    x["original"],

                "DigitosInterpretados":
                    x["digits"],

                "Normalizado":
                    x["normalized"],

                "TipoDetectado":
                    x["type"],

                "Estado":
                    x["status"],

                "TelSeguro":
                    x["safe_link"],

                "WhatsappSeguro":
                    x["safe_whatsapp"],

                "MismoNumeroEnAmbosCampos":
                    (
                        "SI"
                        if same_in_both
                        else "NO"
                    ),

                "NumeroCompartidoEntreReceptores":
                    (
                        "SI"
                        if x["digits"] in shared
                        else "NO"
                    ),

                "FlagsFila":
                    join_unique(flags),
            })

        # =====================================================
        # CONTEOS QA
        # =====================================================

        for x in all_items:

            if x["status"] != "VACIO":
                status_counter[
                    x["status"]
                ] += 1

        for flag in flags:
            flags_counter[flag] += 1

    # =========================================================
    # ESCRITURA DE ARCHIVOS
    # =========================================================

    normalized_fields = [
        "Nombre",
        "Corte",
        "Tribunal",
        "Correo_Principal",
        "Correo_Alternativo",
        "Telefono_Celular_Original",
        "Telefono_Fijo_Original",
        "Telefono_Celular_Display",
        "Telefono_Fijo_Display",
        "Telefono_Principal_Normalizado",
        "Telefono_Principal_Tipo",
        "Telefono_Principal_Estado",
        "Tel_Links_Seguros",
        "Whatsapp_Links_Seguros",
        "Estados_Celular",
        "Estados_Fijo",
        "Flags_Telefono",
        "Requiere_Revision_Telefono",
    ]

    audit_fields = [
        "SourceRow",
        "Nombre",
        "Corte",
        "Tribunal",
        "CampoOrigen",
        "ValorOriginal",
        "DigitosInterpretados",
        "Normalizado",
        "TipoDetectado",
        "Estado",
        "TelSeguro",
        "WhatsappSeguro",
        "MismoNumeroEnAmbosCampos",
        "NumeroCompartidoEntreReceptores",
        "FlagsFila",
    ]

    write_csv(
        OUT,
        normalized_rows,
        normalized_fields,
    )

    write_csv(
        AUDIT,
        audit_rows,
        audit_fields,
    )

    # =========================================================
    # QA FINAL
    # =========================================================

    resolved_count = sum(
        (
            "RESUELTO_POR_COINCIDENCIA_8D_9D"
            in clean(
                r["Flags_Telefono"]
            ).split(" | ")
        )
        for r in normalized_rows
    )

    whatsapp_rows = sum(
        bool(
            clean(
                r["Whatsapp_Links_Seguros"]
            )
        )
        for r in normalized_rows
    )

    review_rows = sum(
        (
            r[
                "Requiere_Revision_Telefono"
            ]
            == "SI"
        )
        for r in normalized_rows
    )

    # ---------------------------------------------------------
    # Control crítico:
    # un 8D↔9D resuelto jamás puede producir WhatsApp.
    # ---------------------------------------------------------

    bad_resolved_whatsapp = [
        r
        for r in normalized_rows
        if (
            (
                "RESUELTO_POR_COINCIDENCIA_8D_9D"
                in clean(
                    r["Flags_Telefono"]
                ).split(" | ")
            )
            and clean(
                r["Whatsapp_Links_Seguros"]
            )
        )
    ]

    if bad_resolved_whatsapp:
        raise SystemExit(
            "BLOQUEADO: se generó WhatsApp "
            "para un caso 8D↔9D resuelto."
        )

    if len(normalized_rows) != len(rows):
        raise SystemExit(
            "BLOQUEADO: cambió el número de "
            "receptores durante la normalización."
        )

    # =========================================================
    # RESUMEN
    # =========================================================

    print()
    print(
        "NORMALIZACION CONSERVADORA PJUD"
    )
    print("=" * 62)

    print(
        f"Receptores procesados: "
        f"{len(normalized_rows)}"
    )

    print(
        f"Registros para revisión: "
        f"{review_rows}"
    )

    print(
        f"Casos resueltos 8D ↔ 9+8D: "
        f"{resolved_count}"
    )

    print(
        f"Receptores con WhatsApp seguro: "
        f"{whatsapp_rows}"
    )

    print()
    print("Estados:")

    for k, v in status_counter.most_common():
        print(
            f"  {k:<34} {v:>5}"
        )

    print()
    print("Flags:")

    for k, v in flags_counter.most_common():
        print(
            f"  {k:<42} {v:>5}"
        )

    print()

    print(
        f"Salida normalizada: "
        f"{OUT.relative_to(ROOT)}"
    )

    print(
        f"Auditoría:          "
        f"{AUDIT.relative_to(ROOT)}"
    )

    print()
    print("Política aplicada:")

    print(
        "  - No se agrega un 9 "
        "a números de 8 dígitos."
    )

    print(
        "  - Los 8D aislados permanecen "
        "literales y sin enlace."
    )

    print(
        "  - 8D + (9+8D) exacto se "
        "resuelve sólo para tel:."
    )

    print(
        "  - Esa resolución NO "
        "habilita WhatsApp."
    )

    print(
        "  - WhatsApp sólo proviene "
        "de OK_MOVIL en campo celular."
    )

    print(
        "  - Los valores originales PJUD "
        "se preservan literalmente."
    )


if __name__ == "__main__":
    main()