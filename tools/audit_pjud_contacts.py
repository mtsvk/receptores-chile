from __future__ import annotations

import csv
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "source" / "receptores_pjud_oficial.csv"
AUDIT_DIR = ROOT / "data" / "audit"

OUT_OK = AUDIT_DIR / "telefonos_ok.csv"
OUT_REVIEW = AUDIT_DIR / "telefonos_revisar.csv"
OUT_CONTACTS = AUDIT_DIR / "contactos_auditados.csv"

PHONE_FIELDS = (
    ("Telefono_Celular", "mobile"),
    ("Telefono_Fijo", "fixed"),
)

EMAIL_RE = re.compile(
    r"^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}$",
    re.IGNORECASE,
)

PHONE_OUTPUT_FIELDS = [
    "SourceRow",
    "Nombre",
    "Corte",
    "Tribunal",
    "CampoOrigen",
    "ValorCeldaOriginal",
    "TelefonoOriginal",
    "DigitosNacionales",
    "TelefonoNormalizado",
    "TipoDetectado",
    "Estado",
    "Confianza",
    "Flags",
    "RequiereRevision",
]


def clean_text(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def clean_email(value: str | None) -> str:
    return clean_text(value).lower()


def email_status(primary: str, alternate: str) -> tuple[str, list[str]]:
    emails = [e for e in (clean_email(primary), clean_email(alternate)) if e]
    flags: list[str] = []

    if not emails:
        return "SIN_EMAIL", flags

    if len(emails) == 2 and emails[0] == emails[1]:
        flags.append("EMAIL_DUPLICADO")

    invalid = [e for e in emails if not EMAIL_RE.match(e)]
    if invalid:
        flags.append("EMAIL_FORMATO_DUDOSO")
        return "REVISAR_EMAIL", flags

    return "OK_EMAIL", flags


def split_phone_cell(value: str | None) -> list[str]:
    """
    Separa sólo delimitadores razonablemente seguros.
    No separa por guiones porque pueden ser parte del formato del teléfono.
    """
    raw = clean_text(value)
    if not raw:
        return []

    parts = re.split(r"\s*(?:/|;|\||\n|\r|,\s*(?=\+?\d)|\s+[yYoO]\s+)\s*", raw)
    return [p.strip() for p in parts if p.strip()]


def strip_chile_prefix(raw: str) -> tuple[str, list[str]]:
    digits = re.sub(r"\D+", "", raw)
    flags: list[str] = []

    if not digits:
        return "", flags

    if digits.startswith("0056"):
        digits = digits[4:]
        flags.append("PREFIJO_0056_REMOVIDO")
    elif digits.startswith("56") and len(digits) == 11:
        digits = digits[2:]
        flags.append("PREFIJO_56_REMOVIDO")

    # Algunos datos pueden venir como 09XXXXXXXX o 0XXXXXXXXX.
    # Sólo removemos el cero si deja exactamente 9 dígitos.
    if digits.startswith("0") and len(digits) == 10:
        digits = digits[1:]
        flags.append("CERO_TRONCAL_REMOVIDO")

    return digits, flags


def classify_phone(raw_phone: str, source_kind: str) -> dict[str, str | bool]:
    digits, flags = strip_chile_prefix(raw_phone)

    result = {
        "raw": raw_phone,
        "digits": digits,
        "normalized": "",
        "detected_type": "desconocido",
        "status": "INVALIDO",
        "confidence": "baja",
        "flags": flags,
        "review": True,
    }

    if not digits:
        result["status"] = "INVALIDO"
        result["flags"].append("SIN_DIGITOS")
        return result

    if set(digits) == {"0"}:
        result["status"] = "INVALIDO"
        result["flags"].append("SOLO_CEROS")
        return result

    # Formato nacional chileno esperado: 9 dígitos.
    if len(digits) == 9:
        result["normalized"] = f"+56{digits}"

        if digits.startswith("9"):
            result["detected_type"] = "movil"
            result["confidence"] = "alta"

            if source_kind == "mobile":
                result["status"] = "OK_MOVIL"
                result["review"] = False
            else:
                result["status"] = "MOVIL_EN_CAMPO_FIJO"
                result["flags"].append("CAMPO_ORIGEN_INCONSISTENTE")
            return result

        # Conservador: un número nacional de 9 dígitos que no empieza en 9
        # es tratado como fijo plausible, sin inferir código de área visual.
        result["detected_type"] = "fijo"
        result["confidence"] = "alta"

        if source_kind == "fixed":
            result["status"] = "OK_FIJO"
            result["review"] = False
        else:
            result["status"] = "FIJO_EN_CAMPO_CELULAR"
            result["flags"].append("CAMPO_ORIGEN_INCONSISTENTE")
        return result

    if len(digits) == 8:
        result["status"] = "AMBIGUO_8_DIGITOS"
        result["confidence"] = "baja"
        result["flags"].append("NO_COMPLETAR_AUTOMATICAMENTE")
        return result

    if len(digits) < 8:
        result["status"] = "INVALIDO"
        result["flags"].append("DEMASIADO_CORTO")
        return result

    result["status"] = "INVALIDO"
    result["flags"].append("LARGO_NO_ESPERADO")
    return result


def write_csv(path: Path, rows: list[dict], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"No existe la fuente: {SOURCE}")

    AUDIT_DIR.mkdir(parents=True, exist_ok=True)

    with SOURCE.open("r", encoding="utf-8-sig", newline="") as f:
        source_rows = list(csv.DictReader(f))

    phone_rows: list[dict] = []
    contact_rows: list[dict] = []

    status_counter = Counter()
    flag_counter = Counter()

    for source_row_number, row in enumerate(source_rows, start=2):
        nombre = clean_text(row.get("Nombre"))
        corte = clean_text(row.get("Corte"))
        tribunal = clean_text(row.get("Tribunal"))

        receptor_phone_rows: list[dict] = []

        for field_name, source_kind in PHONE_FIELDS:
            cell_raw = clean_text(row.get(field_name))
            candidates = split_phone_cell(cell_raw)

            if not candidates:
                continue

            multiple = len(candidates) > 1

            for candidate in candidates:
                audit = classify_phone(candidate, source_kind)
                flags = list(audit["flags"])

                if multiple:
                    flags.append("MULTIPLES_NUMEROS_EN_CELDA")
                    # Aunque ambos números sean plausibles, conviene revisar
                    # la estructura del dato antes de consolidarlo.
                    audit["review"] = True

                flags = sorted(set(flags))
                status_counter[str(audit["status"])] += 1
                flag_counter.update(flags)

                out = {
                    "SourceRow": source_row_number,
                    "Nombre": nombre,
                    "Corte": corte,
                    "Tribunal": tribunal,
                    "CampoOrigen": field_name,
                    "ValorCeldaOriginal": cell_raw,
                    "TelefonoOriginal": candidate,
                    "DigitosNacionales": audit["digits"],
                    "TelefonoNormalizado": audit["normalized"],
                    "TipoDetectado": audit["detected_type"],
                    "Estado": audit["status"],
                    "Confianza": audit["confidence"],
                    "Flags": "|".join(flags),
                    "RequiereRevision": "SI" if audit["review"] else "NO",
                }

                phone_rows.append(out)
                receptor_phone_rows.append(out)

        if not receptor_phone_rows:
            status_counter["SIN_TELEFONO"] += 1
            receptor_phone_rows.append(
                {
                    "SourceRow": source_row_number,
                    "Nombre": nombre,
                    "Corte": corte,
                    "Tribunal": tribunal,
                    "CampoOrigen": "Telefonos",
                    "ValorCeldaOriginal": "",
                    "TelefonoOriginal": "",
                    "DigitosNacionales": "",
                    "TelefonoNormalizado": "",
                    "TipoDetectado": "",
                    "Estado": "SIN_TELEFONO",
                    "Confianza": "",
                    "Flags": "",
                    "RequiereRevision": "SI",
                }
            )
            phone_rows.append(receptor_phone_rows[-1])

        primary = clean_email(row.get("Correo_Principal"))
        alternate = clean_email(row.get("Correo_Alternativo"))
        e_status, e_flags = email_status(primary, alternate)

        review_phone_statuses = sorted(
            {
                r["Estado"]
                for r in receptor_phone_rows
                if r["RequiereRevision"] == "SI"
            }
        )

        contact_rows.append(
            {
                "SourceRow": source_row_number,
                "Nombre": nombre,
                "Corte": corte,
                "Tribunal": tribunal,
                "Correo_Principal_Original": clean_text(row.get("Correo_Principal")),
                "Correo_Principal_Normalizado": primary,
                "Correo_Alternativo_Original": clean_text(row.get("Correo_Alternativo")),
                "Correo_Alternativo_Normalizado": alternate,
                "Estado_Email": e_status,
                "Flags_Email": "|".join(sorted(set(e_flags))),
                "Telefono_Celular_Original": clean_text(row.get("Telefono_Celular")),
                "Telefono_Fijo_Original": clean_text(row.get("Telefono_Fijo")),
                "Telefonos_Detectados": sum(
                    1 for r in receptor_phone_rows if r["Estado"] != "SIN_TELEFONO"
                ),
                "Estados_Telefono": "|".join(
                    sorted({r["Estado"] for r in receptor_phone_rows})
                ),
                "Requiere_Revision_Telefono": "SI" if review_phone_statuses else "NO",
                "Motivos_Revision_Telefono": "|".join(review_phone_statuses),
            }
        )

    review_rows = [r for r in phone_rows if r["RequiereRevision"] == "SI"]
    ok_rows = [r for r in phone_rows if r["RequiereRevision"] == "NO"]

    write_csv(OUT_OK, ok_rows, PHONE_OUTPUT_FIELDS)
    write_csv(OUT_REVIEW, review_rows, PHONE_OUTPUT_FIELDS)

    contact_fields = [
        "SourceRow",
        "Nombre",
        "Corte",
        "Tribunal",
        "Correo_Principal_Original",
        "Correo_Principal_Normalizado",
        "Correo_Alternativo_Original",
        "Correo_Alternativo_Normalizado",
        "Estado_Email",
        "Flags_Email",
        "Telefono_Celular_Original",
        "Telefono_Fijo_Original",
        "Telefonos_Detectados",
        "Estados_Telefono",
        "Requiere_Revision_Telefono",
        "Motivos_Revision_Telefono",
    ]
    write_csv(OUT_CONTACTS, contact_rows, contact_fields)

    print()
    print("AUDITORIA PJUD")
    print("=" * 60)
    print(f"Receptores fuente:          {len(source_rows):>6}")
    print(f"Telefonos/casos detectados: {len(phone_rows):>6}")
    print(f"Telefonos OK:               {len(ok_rows):>6}")
    print(f"Casos a revisar:            {len(review_rows):>6}")
    print()

    print("Estados:")
    for status, count in status_counter.most_common():
        print(f"  {status:<28} {count:>6}")

    if flag_counter:
        print()
        print("Flags principales:")
        for flag, count in flag_counter.most_common(12):
            print(f"  {flag:<36} {count:>6}")

    print()
    print("Archivos generados:")
    print(f"  {OUT_OK.relative_to(ROOT)}")
    print(f"  {OUT_REVIEW.relative_to(ROOT)}")
    print(f"  {OUT_CONTACTS.relative_to(ROOT)}")
    print()
    print("Nota: el script nunca modifica la fuente oficial ni receptores.json.")


if __name__ == "__main__":
    main()
