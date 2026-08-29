from __future__ import annotations

import csv
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "source" / "receptores_pjud_oficial.csv"
AUDIT = ROOT / "data" / "audit"
AUDIT.mkdir(parents=True, exist_ok=True)

OUT = AUDIT / "auditoria_telefonos_cruzada.csv"
OUT_DUP = AUDIT / "telefonos_duplicados_entre_receptores.csv"


def txt(v):
    return re.sub(r"\s+", " ", (v or "").strip())


def digits(v):
    return re.sub(r"\D+", "", v or "")


def national_digits(v):
    d = digits(v)
    if d.startswith("0056"):
        d = d[4:]
    elif d.startswith("56") and len(d) == 11:
        d = d[2:]
    if d.startswith("0") and len(d) == 10:
        d = d[1:]
    return d


def phone_shape(v):
    """
    Clasificación estructural conservadora.
    No completa números de 8 dígitos.
    """
    raw = txt(v)
    d = national_digits(raw)

    if not raw:
        return "VACIO", d

    if not d or set(d) == {"0"}:
        return "INVALIDO", d

    if len(d) == 9:
        if d.startswith("9"):
            return "MOVIL_PLAUSIBLE", d
        return "FIJO_PLAUSIBLE", d

    if len(d) == 8:
        return "8_DIGITOS_NO_INFERIR", d

    if len(d) < 8:
        return "DEMASIADO_CORTO", d

    return "LARGO_NO_ESPERADO", d


def add_issue(out, rownum, row, code, severity, detail):
    out.append({
        "SourceRow": rownum,
        "Nombre": txt(row.get("Nombre")),
        "Corte": txt(row.get("Corte")),
        "Tribunal": txt(row.get("Tribunal")),
        "Telefono_Celular": txt(row.get("Telefono_Celular")),
        "Telefono_Fijo": txt(row.get("Telefono_Fijo")),
        "Codigo": code,
        "Severidad": severity,
        "Detalle": detail,
    })


def main():
    if not SOURCE.exists():
        raise SystemExit(f"No existe: {SOURCE}")

    with SOURCE.open("r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    issues = []
    number_to_people = defaultdict(list)

    for rownum, row in enumerate(rows, start=2):
        cel_raw = txt(row.get("Telefono_Celular"))
        fijo_raw = txt(row.get("Telefono_Fijo"))

        cel_shape, cel = phone_shape(cel_raw)
        fijo_shape, fijo = phone_shape(fijo_raw)

        # 1. Exactamente el mismo número en ambas columnas.
        if cel and fijo and cel == fijo:
            add_issue(
                issues, rownum, row,
                "MISMO_NUMERO_EN_CELULAR_Y_FIJO",
                "ALTA",
                f"El mismo número ({cel_raw or fijo_raw}) está publicado en ambos campos."
            )

        # 2. La columna "fijo" tiene forma inequívoca de móvil actual.
        if fijo_shape == "MOVIL_PLAUSIBLE":
            add_issue(
                issues, rownum, row,
                "MOVIL_PLAUSIBLE_EN_CAMPO_FIJO",
                "ALTA",
                f"Teléfono fijo='{fijo_raw}' tiene 9 dígitos nacionales y comienza en 9."
            )

        # 3. La columna celular tiene forma de fijo actual.
        if cel_shape == "FIJO_PLAUSIBLE":
            add_issue(
                issues, rownum, row,
                "FIJO_PLAUSIBLE_EN_CAMPO_CELULAR",
                "ALTA",
                f"Teléfono celular='{cel_raw}' tiene 9 dígitos nacionales y no comienza en 9."
            )

        # 4. Ocho dígitos: fuente incompleta/ambigua; nunca completar.
        if cel_shape == "8_DIGITOS_NO_INFERIR":
            add_issue(
                issues, rownum, row,
                "CELULAR_8_DIGITOS",
                "MEDIA",
                f"PJUD publica '{cel_raw}' en celular. Se conserva literal; no se agrega 9."
            )

        if fijo_shape == "8_DIGITOS_NO_INFERIR":
            add_issue(
                issues, rownum, row,
                "FIJO_8_DIGITOS",
                "MEDIA",
                f"PJUD publica '{fijo_raw}' en fijo. Se conserva literal; no se infiere código."
            )

        # 5. Valores materialmente inválidos.
        if cel_shape in {"INVALIDO", "DEMASIADO_CORTO", "LARGO_NO_ESPERADO"}:
            add_issue(
                issues, rownum, row,
                "CELULAR_INVALIDO",
                "ALTA",
                f"Valor celular='{cel_raw}' clasificado como {cel_shape}."
            )

        if fijo_shape in {"INVALIDO", "DEMASIADO_CORTO", "LARGO_NO_ESPERADO"}:
            add_issue(
                issues, rownum, row,
                "FIJO_INVALIDO",
                "ALTA",
                f"Valor fijo='{fijo_raw}' clasificado como {fijo_shape}."
            )

        # 6. Casos útiles para auditoría: sólo fijo o sólo celular.
        if cel_shape == "VACIO" and fijo_shape != "VACIO":
            add_issue(
                issues, rownum, row,
                "SOLO_FIJO_PUBLICADO",
                "INFO",
                "PJUD no publica teléfono celular; sólo existe valor en teléfono fijo."
            )

        if fijo_shape == "VACIO" and cel_shape != "VACIO":
            add_issue(
                issues, rownum, row,
                "SOLO_CELULAR_PUBLICADO",
                "INFO",
                "PJUD no publica teléfono fijo; sólo existe valor en teléfono celular."
            )

        if cel_shape == "VACIO" and fijo_shape == "VACIO":
            add_issue(
                issues, rownum, row,
                "SIN_TELEFONOS_PUBLICADOS",
                "INFO",
                "PJUD no publica teléfono celular ni fijo para este receptor."
            )

        # Índice de números para detectar reutilización entre distintas personas.
        for campo, raw, d in [
            ("Telefono_Celular", cel_raw, cel),
            ("Telefono_Fijo", fijo_raw, fijo),
        ]:
            if d and len(d) >= 8:
                number_to_people[d].append({
                    "Nombre": txt(row.get("Nombre")),
                    "Campo": campo,
                    "ValorOriginal": raw,
                    "SourceRow": rownum,
                })

    # Duplicados entre personas distintas.
    dup_rows = []
    for d, hits in sorted(number_to_people.items()):
        names = sorted({h["Nombre"] for h in hits})
        if len(names) <= 1:
            continue

        for h in hits:
            dup_rows.append({
                "DigitosComparacion": d,
                "CantidadPersonas": len(names),
                "Personas": " | ".join(names),
                "Nombre": h["Nombre"],
                "Campo": h["Campo"],
                "ValorOriginal": h["ValorOriginal"],
                "SourceRow": h["SourceRow"],
            })

            # También lo dejamos en auditoría principal.
            row = rows[h["SourceRow"] - 2]
            add_issue(
                issues, h["SourceRow"], row,
                "NUMERO_COMPARTIDO_ENTRE_RECEPTORES",
                "ALTA",
                f"El número {d} aparece asociado a {len(names)} personas: " + " | ".join(names)
            )

    issue_fields = [
        "SourceRow", "Nombre", "Corte", "Tribunal",
        "Telefono_Celular", "Telefono_Fijo",
        "Codigo", "Severidad", "Detalle"
    ]
    with OUT.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=issue_fields)
        w.writeheader()
        w.writerows(sorted(
            issues,
            key=lambda r: (
                {"ALTA": 0, "MEDIA": 1, "INFO": 2}.get(r["Severidad"], 9),
                r["Codigo"],
                r["Nombre"],
            )
        ))

    dup_fields = [
        "DigitosComparacion", "CantidadPersonas", "Personas",
        "Nombre", "Campo", "ValorOriginal", "SourceRow"
    ]
    with OUT_DUP.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=dup_fields)
        w.writeheader()
        w.writerows(dup_rows)

    # Resumen.
    from collections import Counter
    by_code = Counter(r["Codigo"] for r in issues)
    by_sev = Counter(r["Severidad"] for r in issues)

    print()
    print("AUDITORIA CRUZADA DE TELEFONOS PJUD")
    print("=" * 64)
    print(f"Receptores analizados: {len(rows)}")
    print()
    print("Por severidad:")
    for sev in ("ALTA", "MEDIA", "INFO"):
        print(f"  {sev:<8} {by_sev.get(sev, 0):>5}")

    print()
    print("Hallazgos:")
    for code, count in by_code.most_common():
        print(f"  {code:<40} {count:>5}")

    print()
    print(f"Archivo principal: {OUT.relative_to(ROOT)}")
    print(f"Duplicados:        {OUT_DUP.relative_to(ROOT)}")
    print()
    print("IMPORTANTE: este auditor no corrige ni reemplaza ningún dato del PJUD.")


if __name__ == "__main__":
    main()
