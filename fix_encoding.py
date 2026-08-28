from pathlib import Path

replacements = {
    "\u00c2\u00b7": "\u00b7",
    "\u00e2\u2020\u2014": "\u2197",
    "\u00e2\u20ac\u00a6": "\u2026",
    "\u00e2\u20ac\u201d": "\u2014",
    "\u00c3\u00b3": "\u00f3",
    "\u00c3\u00a1": "\u00e1",
    "\u00c3\u00a9": "\u00e9",
    "\u00c3\u00ad": "\u00ed",
    "\u00c3\u00ba": "\u00fa",
    "\u00c3\u00b1": "\u00f1",
    "\u00c3\u0093": "\u00d3",
    "\u00c3\u0081": "\u00c1",
    "\u00c3\u0089": "\u00c9",
    "\u00c3\u008d": "\u00cd",
    "\u00c3\u009a": "\u00da",
    "\u00c3\u0091": "\u00d1",
}

for filename in ("index.html", "script.js"):
    path = Path(filename)
    text = path.read_text(encoding="utf-8-sig")

    for bad, good in replacements.items():
        text = text.replace(bad, good)

    path.write_text(text, encoding="utf-8", newline="\n")
    print("fixed:", filename)
