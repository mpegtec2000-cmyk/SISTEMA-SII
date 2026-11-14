"""
Analizador de respaldo (sin IA externa) para bases de licitación chilenas
(Mercado Público / ChileCompra) y requerimientos privados.

Produce el MISMO esquema que el proveedor LLM. Cada hallazgo incluye la página
de origen para que el usuario pueda verificarlo. Nunca inventa datos: si algo no
se encuentra en el texto, simplemente no se informa.
"""
import re
from typing import List, Dict, Any, Tuple, Optional

NUM_WORDS = {
    "un": 1, "uno": 1, "una": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5, "seis": 6,
    "siete": 7, "ocho": 8, "nueve": 9, "diez": 10, "quince": 15, "veinte": 20,
    "treinta": 30, "cuarenta": 40, "sesenta": 60, "noventa": 90,
}


class _Doc:
    def __init__(self, pages: List[Tuple[int, str]]):
        self.pages = pages
        parts = []
        self.starts = []
        pos = 0
        for pno, txt in pages:
            txt = (txt or "").replace("\r", "")
            self.starts.append((pos, pno))
            parts.append(txt)
            pos += len(txt) + 1
        self.text = "\n".join(parts)

    def page_of(self, pos: int) -> int:
        page = self.starts[0][1] if self.starts else 1
        for start, pno in self.starts:
            if start <= pos:
                page = pno
            else:
                break
        return page


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def _first_int(s: str) -> Optional[int]:
    m = re.search(r"\((\d{1,3})\)", s)
    if m:
        return int(m.group(1))
    m = re.search(r"\b(\d{1,3})\b", s)
    if m:
        return int(m.group(1))
    for w, v in NUM_WORDS.items():
        if re.search(rf"\b{w}\b", s, re.IGNORECASE):
            return v
    return None


# ---------------------------------------------------------------- productos
UNIT_RE = r"(UN|UND|UNID|UNIDAD(?:ES)?|PAR(?:ES)?|MT|MTS|M2|M3|M|KG|LT|LTS|CJ|CAJAS?|GL|SET|KIT|BOB|ROLLOS?|PZA?S?|SERVICIO)"


def _extract_products(d: _Doc) -> List[Dict[str, Any]]:
    t = d.text
    products = []
    # Tabla "CANTIDAD UNIDAD DESCRIPCIÓN"
    head = re.search(r"CANTIDAD\s+UNIDAD\s+DESCRIPCI[ÓO]N", t, re.IGNORECASE)
    if head:
        seg_end = re.search(r"\n\s*(?:IV\.|V\.|CONDICIONES DE ENTREGA|ESPECIFICACIONES)", t[head.end():])
        seg = t[head.end(): head.end() + (seg_end.start() if seg_end else 1500)]
        seg = re.sub(r"\n\s*\n", "\n", seg)
        rows = re.split(r"\n(?=\s*\d[\d\.]*\s+" + UNIT_RE + r"\b)", "\n" + seg)
        for row in rows:
            m = re.match(r"\s*(\d[\d\.]*)\s+" + UNIT_RE + r"\s+(.*)", row, re.DOTALL | re.IGNORECASE)
            if not m:
                continue
            qty = float(m.group(1).replace(".", ""))
            unit = m.group(2).upper()
            desc_lines = [_clean(l) for l in m.group(3).split("\n") if _clean(l)]
            if not desc_lines:
                continue
            full = _clean(" ".join(desc_lines))
            name = re.split(r"\s+de acuerdo|\s+Tallas?\b|\s*,\s*de acuerdo", full, flags=re.IGNORECASE)[0].strip(" ,.-")
            name = re.sub(r"\s+(de|con|y)$", "", name, flags=re.IGNORECASE)
            products.append({
                "name": name,
                "quantity": qty,
                "unit": "PAR" if unit.startswith("PAR") else ("UND" if unit in ("UN", "UNID", "UNIDAD", "UNIDADES") else unit),
                "description": full,
                "specs": [],
                "page": d.page_of(head.start()),
            })

    # Bloques de especificaciones técnicas (título en MAYÚSCULAS para no confundir con frases del texto)
    blocks = []
    for m in re.finditer(r"ESPECIFICACIONES\s+T[ÉE]CNICAS[ \t]+([A-ZÁÉÍÓÚÑ][^\n]*)\n(?:[ \t]*([A-ZÁÉÍÓÚÑ ]{3,30})[ \t]*\n)?", t):
        title = _clean(m.group(1) + " " + (m.group(2) or ""))
        blocks.append((m.start(), m.end(), title))
    for i, (bs, be, title) in enumerate(blocks):
        end = blocks[i + 1][0] if i + 1 < len(blocks) else len(t)
        nxt = re.search(r"\n\s*(ANEXO\s+[A-Z]\b|IV\.\s|V\.\s)", t[be:end])
        if nxt:
            end = be + nxt.start()
        body = t[be:end]
        # Título previo en mayúsculas (heading del producto)
        prev = t[max(0, bs - 250):bs]
        prev_lines = [_clean(l) for l in prev.split("\n") if _clean(l)]
        heading = prev_lines[-1] if prev_lines and prev_lines[-1].isupper() and len(prev_lines[-1]) > 12 else ""
        title_ctx = (heading + " " + title).strip()
        lines = []
        cur = None
        for raw in body.split("\n"):
            ln = _clean(raw)
            if not ln:
                continue
            if ln.isupper() and len(ln) >= 25 and not ln.startswith(("•", "-", "–", "*")):
                break  # comienza el encabezado del siguiente producto
            if ln.startswith(("•", "-", "–", "*")):
                cur = ln.lstrip("•-–* ").strip()
                lines.append(cur)
            elif re.match(r"^[A-ZÁÉÍÓÚ ]{4,}:?$", ln) and len(ln) < 40:
                lines.append(f"[{ln.strip(':').title()}]")
                cur = None
            elif cur is not None and lines:
                lines[-1] = (lines[-1] + " " + ln).strip()
            else:
                lines.append(ln)
        block = {"title": title_ctx, "lines": lines, "page": d.page_of(bs)}
        if not products:
            products.append({"name": title_ctx.title() or "Producto", "quantity": 1, "unit": "UND",
                             "description": title_ctx, "specs": lines, "page": block["page"]})
            continue
        # Asignar bloque al producto con mayor traslape léxico
        def toks(s):
            return {w[:5].lower() for w in re.findall(r"[A-Za-zÁÉÍÓÚáéíóúñÑ]{4,}", s)}
        bt = toks(title_ctx)
        best, best_score = None, 0
        for p in products:
            score = len(bt & toks(p["name"] + " " + p["description"]))
            if score > best_score:
                best, best_score = p, score
        if best is None:
            best = products[-1]
        sub = title.title() if title else heading.title()
        if best["specs"]:
            best["specs"].append(f"[{sub}]")
        best["specs"].extend(lines)

    for p in products:
        if re.search(r"\bpares\b", " ".join(p["specs"]) + " " + p["description"], re.IGNORECASE):
            p["unit"] = "PAR"
    return products


# ---------------------------------------------------------------- hitos
MILESTONE_LABELS = [
    ("PUBLICACION", "Publicación de la propuesta", r"Publicaci[óo]n de la propuesta"),
    ("CONSULTAS", "Plazo para recepción de consultas", r"Recepci[óo]n de consultas"),
    ("RESPUESTAS", "Publicación de respuestas", r"Publicaci[óo]n de respuestas"),
    ("CIERRE", "Cierre de recepción de ofertas", r"Cierre de (?:la )?licitaci[óo]n"),
    ("APERTURA", "Apertura de ofertas", r"Apertura de ofertas"),
    ("ADJUDICACION", "Adjudicación (evaluación y resolución)", r"Etapa de evaluaci[óo]n"),
    ("ORDEN_COMPRA", "Envío de orden de compra", r"Env[íi]o de orden de compra"),
]


def _extract_milestones(d: _Doc) -> List[Dict[str, Any]]:
    t = d.text
    m = re.search(r"CRONOGRAMA\s+DE\s+LA\s+PROPUESTA", t, re.IGNORECASE)
    if not m:
        return []
    seg = t[m.end(): m.end() + 2500]
    stop = re.search(r"\n\s*(?:II\.|III\.|DE LAS|I\.)\s", seg[200:])
    if stop:
        seg = seg[: 200 + stop.start()]
    positions = []
    for kind, title, rx in MILESTONE_LABELS:
        mm = re.search(rx, seg, re.IGNORECASE)
        if mm:
            positions.append((mm.start(), mm.end(), kind, title))
    positions.sort()
    out = []
    for i, (s, e, kind, title) in enumerate(positions):
        nxt = positions[i + 1][0] if i + 1 < len(positions) else len(seg)
        rule = _clean(seg[(s if kind == "ADJUDICACION" else e):nxt])
        rule = re.sub(r"=====.*", "", rule).strip()
        rule = re.sub(r"^(en el sistema\.?\s*)", "", rule, flags=re.IGNORECASE).lstrip(". ").strip()
        if kind == "PUBLICACION":
            out.append({"kind": kind, "title": title, "rule_text": rule or "Día 1", "anchor": None,
                        "offset_days": 0, "offset_type": "CORRIDOS", "page": d.page_of(m.start())})
            continue
        n = _first_int(rule)
        hab = bool(re.search(r"h[áa]bil", rule, re.IGNORECASE))
        anchor = "PUBLICACION"
        if kind == "RESPUESTAS":
            anchor = "CONSULTAS"
        elif kind == "APERTURA":
            anchor = "CIERRE"
        elif kind in ("ADJUDICACION",):
            anchor = "APERTURA"
        elif kind == "ORDEN_COMPRA":
            anchor = "ADJUDICACION"
        out.append({"kind": kind, "title": title, "rule_text": rule, "anchor": anchor, "offset_days": n,
                    "offset_type": "HABILES" if hab else "CORRIDOS", "page": d.page_of(m.start())})
    return out


# ---------------------------------------------------------------- documentos
def _extract_documents(d: _Doc) -> List[Dict[str, Any]]:
    t = d.text
    docs: List[Dict[str, Any]] = []
    seen = set()

    def add(title, detail, category, sign, page, mandatory=True):
        key = title.lower()[:40]
        if key in seen:
            return
        seen.add(key)
        docs.append({"title": title, "detail": detail, "category": category,
                     "requires_signature": sign, "mandatory": mandatory, "page": page})

    # Formatos adjuntos (2.3, 2.4, 2.5, 2.6 ...): se detectan por sus encabezados
    fmts = list(re.finditer(r"(?m)^\s*(2\.\d)\s+((?:FORMATO|CRITERIO)[^\n]*)", t))
    for i, m in enumerate(fmts):
        end = fmts[i + 1].start() if i + 1 < len(fmts) else min(len(t), m.end() + 6000)
        body = t[m.end(): end]
        title = _clean(m.group(2))
        title = re.sub(r",?\s*(PROPUESTA|LICITACI[ÓO]N)\s+P[ÚU]BLICA.*$", "", title, flags=re.IGNORECASE).strip(" ,.")
        sign = bool(re.search(r"firma|firmad", body, re.IGNORECASE))
        category = "DECLARACION" if re.search(r"declaraci", title, re.IGNORECASE) else (
            "ANEXO_OFERTA" if re.search(r"oferta", title, re.IGNORECASE) else "ANEXO")
        if re.search(r"identificaci", title, re.IGNORECASE):
            category = "ANEXO"
        add(f"{m.group(1)} {title.title()}", "Formato adjunto en las bases. Debe completarse y adjuntarse a la oferta."
            + (" Exige firma del representante legal." if sign else ""), category, sign, d.page_of(m.start()))

    # Documentos administrativos / técnicos exigidos (VII.x.y)
    for m in re.finditer(r"(?m)^\s*(VII\.\d(?:\.\d)?)\.?\s+(.+?)(?=\n\s*VII\.\d|\n\s*VIII\.|\Z)", t, re.DOTALL):
        code, text = m.group(1), _clean(m.group(2))
        if len(text) < 6:
            continue
        if text.upper().startswith("DOCUMENTOS ") and re.search(r"El oferente deber[áa] incluir", text):
            continue
        # Cláusula que remite a un formato adjunto ya detectado (punto/apartado 2.x): se fusiona
        ref = re.search(r"(?:punto|apartado)\s+(2\.\d)", text)
        linked = next((dd for dd in docs if ref and dd["title"].startswith(ref.group(1))), None)
        if linked:
            linked["detail"] += f" (Exigido en cláusula {code}.)"
            continue
        first_sentence = re.split(r"\.\s", text)[0]
        sign = bool(re.search(r"firmad|declaraci[óo]n", text, re.IGNORECASE))
        if re.search(r"plazo de entrega|plazo de garant", first_sentence, re.IGNORECASE) and len(first_sentence) < 40:
            cat = "DATO_OFERTA"
            text = first_sentence.strip(". ")
        elif re.search(r"declaraci", text, re.IGNORECASE):
            cat = "DECLARACION"
        elif re.search(r"certific", text, re.IGNORECASE):
            cat = "CERTIFICADO"
        elif re.search(r"escritura|poder|vigencia", text, re.IGNORECASE):
            cat = "LEGAL"
        else:
            cat = "DOCUMENTO"
        title = first_sentence[:110].strip(" .")
        add(f"{code}  {title}", text[:420], cat, sign, d.page_of(m.start()))

    # Requisitos excluyentes (Anexo A)
    anexo = re.search(r"PAR[ÁA]METROS\s+EXCLUYENTES", t)
    if anexo:
        seg = t[anexo.end(): anexo.end() + 2500]
        seg = seg.split("Aquellas ofertas")[0]
        for m in re.finditer(r"(?m)^\s*(\d)\)\s+(.+?)(?=\n\s*\d\)|\Z)", seg, re.DOTALL):
            txt = _clean(re.sub(r"\bSI\s+NO\b", "", m.group(2)))
            if len(txt) < 8:
                continue
            docs.append({"title": txt[:140], "detail": "Requisito EXCLUYENTE: su omisión deja la oferta fuera de evaluación.",
                         "category": "EXCLUYENTE", "requires_signature": False, "mandatory": True,
                         "page": d.page_of(anexo.start())})
    return docs


# ---------------------------------------------------------------- muestras
def _extract_samples(d: _Doc) -> Dict[str, Any]:
    t = d.text
    hits = [m for m in re.finditer(r"[^.\n]*\bmuestras?\b[^.\n]*(?:\.|\n)", t, re.IGNORECASE)]
    hits = [h for h in hits if re.search(r"entreg|present|remit|enviar|deber|exig|solicit", h.group(0), re.IGNORECASE)]
    if not hits:
        return {"required": False, "detail": "No se detectaron exigencias de muestras en los documentos analizados."}
    detail = " ".join(_clean(h.group(0)) for h in hits[:4])
    dl = re.search(r"(\d{1,2}\s+de\s+\w+\s+de\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\w+\s+\(\d+\)\s+d[íi]as[^.]{0,60})", detail)
    pl = re.search(r"(?:en|a)\s+(?:las?\s+)?((?:bodegas?|oficinas?|direcci[óo]n|calle|aeropuerto)[^.]{0,120})", detail, re.IGNORECASE)
    return {"required": True, "detail": detail[:700], "deadline": dl.group(1) if dl else None,
            "place": _clean(pl.group(1)) if pl else None, "page": d.page_of(hits[0].start())}


# ---------------------------------------------------------------- riesgos
def _extract_risks(d: _Doc) -> List[Dict[str, Any]]:
    t = d.text
    risks: List[Dict[str, Any]] = []

    def add(kind, title, detail, sev, pos):
        risks.append({"kind": kind, "title": title, "detail": _clean(detail), "severity": sev, "page": d.page_of(pos)})

    # Multas
    m = re.search(r"(?m)^\s*XXII\.\s*DE LAS MULTAS|^\s*[IVXL]+\.\s*DE LAS MULTAS", t)
    if m:
        seg = t[m.end(): m.end() + 2200]
        rules = re.findall(r"•\s*(.+?)(?=\n•|\n\s*\n|\Z)", seg, re.DOTALL)
        detail = " ".join(_clean(r) for r in rules[:4]) or _clean(seg[:600])
        add("MULTA", "Multas por atraso en la entrega", detail, "ALTA", m.start())

    # Garantías (seriedad / fiel cumplimiento)
    for rx, name in [(r"garant[íi]a de seriedad", "Garantía de seriedad de la oferta"),
                     (r"garant[íi]a de fiel (?:y oportuno )?cumplimiento", "Garantía de fiel cumplimiento"),
                     (r"boleta de garant[íi]a|vale vista|p[óo]liza de garant[íi]a", "Boleta / vale vista / póliza de garantía")]:
        for mm in re.finditer(rx, t, re.IGNORECASE):
            ctx = t[max(0, mm.start() - 200): mm.end() + 350]
            if re.search(r"deber[áa]n?\s+(?:presentar|entregar|otorgar|constituir|tomar|acompa)|se\s+exig|monto|vigencia m[íi]nima|equivalente al", ctx, re.IGNORECASE) \
               and not re.search(r"har[áa] efectiva", ctx, re.IGNORECASE):
                add("GARANTIA", name, ctx, "ALTA", mm.start())
                break
    if not any(r["kind"] == "GARANTIA" for r in risks):
        risks.append({"kind": "GARANTIA", "title": "No se detectó garantía bancaria exigida",
                      "detail": "No hay mención a garantía de seriedad ni de fiel cumplimiento (boleta/vale vista/póliza). Verificar en el portal.",
                      "severity": "BAJA", "page": 1})

    # Criterios de evaluación
    crit = []
    for mm in re.finditer(r"(?m)^\s*([A-F])\.\s+([^\n(]{5,90}?)\s*\((\d{1,3})\s*%\)", t):
        crit.append((mm.start(), f"{_clean(mm.group(2)).title()}: {mm.group(3)}%"))
    mm = re.search(r"equivaldr[áa]\s+al\s+(\d{1,2})\s*%\s+del\s+total", t)
    if mm:
        crit.append((mm.start(), f"Criterio Sustentable: {mm.group(1)}%"))
    if crit:
        add("CRITERIO", "Criterios de evaluación y ponderaciones", " · ".join(c[1] for c in crit), "ALTA", crit[0][0])
    mm = re.search(r"GARANTIA\s+50[\s\S]{0,400}?Entre 21 y 30 d[íi]as corridos\s+\d+", t)
    if mm:
        add("CRITERIO", "Detalle técnico (60%): garantía y plazo de entrega",
            "Garantía ≥6 meses = 50 pts; 3 a 6 meses = 10 pts. Plazo de entrega ≤10 días = 50 pts; 11–20 días = 20 pts; 21–30 días = 10 pts. Conviene ofertar garantía ≥6 meses y entrega ≤10 días.",
            "ALTA", mm.start())

    # Condiciones especiales
    def cond(rx, title, sev="MEDIA", detail_rx=None):
        mm = re.search(rx, t, re.IGNORECASE)
        if mm:
            ctx = t[max(0, mm.start() - 60): mm.end() + 260] if detail_rx is None else mm.group(0)
            add("CONDICION", title, ctx, sev, mm.start())

    cond(r"precio de la oferta presentada sea menor al cincuenta por ciento", "Oferta temeraria (< 50% de la siguiente)", "ALTA")
    cond(r"vigencia de la oferta no podr[áa] ser inferior a[^\n]*\n?[^\n]*", "Vigencia mínima de la oferta", "MEDIA", True)
    cond(r"TIEMPO DE ENTREGA:[^\n]*(?:\n[^\n]*)?", "Plazo máximo de entrega", "ALTA", True)
    cond(r"El precio deber[áa] incluir el valor del despacho[^\n]*", "El precio debe incluir despacho", "MEDIA", True)
    cond(r"se reserva el derecho de adjudicar parcialmente[^\n]*(?:\n[^\n]*){0,2}", "Adjudicación parcial / reducción de cantidades", "MEDIA", True)
    cond(r"Las ofertas deber[áa]n presentarse en formato Adobe Acrobat[^\n]*", "Formato de la oferta (PDF)", "BAJA", True)
    cond(r"presupuesto estimado y referencial[\s\S]{0,260}?I\.V\.A\. incluido", "Presupuesto referencial", "MEDIA", True)
    cond(r"declarar[áa] inadmisibles las ofertas cuando[^\n]*(?:\n[^\n]*){0,2}", "Causales de inadmisibilidad", "ALTA", True)
    cond(r"debe estar inscrito y habilitado en el Registro de\s+Proveedores|estar inscrito y habilitado en el Registro[^\n]*", "Proveedor habilitado en Registro de Proveedores", "ALTA", True)
    return risks


def _extract_meta(d: _Doc) -> Dict[str, Any]:
    t = d.text
    meta: Dict[str, Any] = {}
    m = re.search(r"\b(\d{3,5}-\d{1,4}-[A-Z]{1,3}\d{2})\b", t)
    if m:
        meta["tender_id"] = m.group(1)
    m = re.search(r"asciende a la suma\s+de\s+\$\s*([\d\.]+)", t)
    if m:
        meta["budget"] = float(m.group(1).replace(".", ""))
        meta["budget_includes_iva"] = bool(re.search(r"I\.?V\.?A\.? incluido", t[m.end(): m.end() + 200], re.IGNORECASE))
    m = re.search(r"DIRECCI[ÓO]N GENERAL DE [A-ZÁÉÍÓÚ ]+|MUNICIPALIDAD DE [A-ZÁÉÍÓÚ ]+|HOSPITAL [A-ZÁÉÍÓÚ ]+|SERVICIO DE [A-ZÁÉÍÓÚ ]+", t)
    if m:
        meta["entity"] = _clean(m.group(0)).title()
    m = re.search(r"OBJ\.?:\s*([\s\S]{20,260}?)_{5,}", t)
    if m:
        meta["title"] = _clean(m.group(1))[:240]
    m = re.search(r"(?:bodegas?|entregad[oa]s?\s+en)[^\n]{0,200}", t[t.find("CONDICIONES DE ENTREGA"):] if "CONDICIONES DE ENTREGA" in t else "", re.IGNORECASE)
    pl = re.search(r"CONDICIONES DE ENTREGA\s*\n+\s*Los elementos deben ser entregados en ([^\n]+(?:\n[^\n]+){0,2})", t)
    if pl:
        meta["delivery_place"] = re.split(r",\s*contacto", _clean(pl.group(1)))[0][:300]
    return meta


def _extract_table_products(d: _Doc) -> List[Dict[str, Any]]:
    """Productos desde filas de tabla 'celda | celda | ...' con encabezado Cantidad / Descripción (o Producto)."""
    out: List[Dict[str, Any]] = []
    qty_re = re.compile(r"^(cantidad|cant\.?|qty|unidades)$", re.I)
    desc_re = re.compile(r"(descripci|producto|detalle|art[ií]culo|bien\b|especificaci|nombre|[ií]tem)", re.I)
    unit_re = re.compile(r"^(unidad|u\.?m\.?|und\.?|medida|unidad de medida)$", re.I)
    for pno, txt in d.pages:
        header = None
        for raw in (txt or "").split("\n"):
            if " | " not in raw:
                if not raw.strip():
                    header = None if header else header
                continue
            cells = [c.strip() for c in raw.split(" | ")]
            low = [c.lower() for c in cells]
            qi = next((i for i, c in enumerate(low) if qty_re.match(c)), None)
            di = next((i for i, c in enumerate(low) if desc_re.search(c) and len(c) < 40), None)
            if qi is not None and di is not None and qi != di:
                header = (qi, di, next((i for i, c in enumerate(low) if unit_re.match(c)), None), len(cells))
                continue
            if not header:
                continue
            qi, di, ui, n = header
            if len(cells) <= max(qi, di):
                continue
            qraw = cells[qi].replace(".", "").replace(",", ".")
            m = re.match(r"^\d+(\.\d+)?$", qraw)
            desc = cells[di]
            if not m or len(desc) < 3:
                continue
            lines = [_clean(l) for l in desc.split("\n") if _clean(l)]
            full = _clean(desc)
            name = re.split(r"\s+de acuerdo|\s+Tallas?\b|[:;]", full, flags=re.IGNORECASE)[0].strip(" ,.-")[:120] or full[:80]
            unit = (cells[ui] if ui is not None and ui < len(cells) else "UND").upper() or "UND"
            out.append({"name": name, "quantity": float(qraw), "unit": "UND" if unit.startswith("UN") else unit[:10],
                        "description": full, "specs": [full] if full != name else [], "page": pno})
    return out


def analyze_heuristic(pages: List[Tuple[int, str]]) -> Dict[str, Any]:
    d = _Doc(pages)
    docs = _extract_documents(d)
    risks = _extract_risks(d)
    excl = [x for x in docs if x["category"] == "EXCLUYENTE"]
    if excl:
        risks.insert(0, {"kind": "EXCLUYENTE", "title": "Requisitos excluyentes: omitirlos invalida la oferta",
                         "detail": " · ".join(f"{i + 1}) {x['title']}" for i, x in enumerate(excl)),
                         "severity": "ALTA", "page": excl[0]["page"]})
    products = _extract_products(d)
    table_products = _extract_table_products(d)
    if table_products and len(table_products) >= len(products):
        # Las tablas traen cantidades reales; se conservan los bloques técnicos como fichas de apoyo
        extra = [p for p in products if p.get("specs") and not any(
            p["name"][:12].lower() in tp["name"].lower() or tp["name"][:12].lower() in p["name"].lower() for tp in table_products)]
        for tp in table_products:
            tk = {w[:5].lower() for w in re.findall(r"[A-Za-zÁÉÍÓÚáéíóúñÑ]{4,}", tp["name"])}
            for p in products:
                pk = {w[:5].lower() for w in re.findall(r"[A-Za-zÁÉÍÓÚáéíóúñÑ]{4,}", p["name"])}
                if tk & pk and p.get("specs"):
                    tp["specs"] = p["specs"]
                    break
        products = table_products + extra
    return {
        "meta": _extract_meta(d),
        "products": products,
        "documents": docs,
        "samples": _extract_samples(d),
        "milestones": _extract_milestones(d),
        "risks": risks,
    }
