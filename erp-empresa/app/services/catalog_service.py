"""Servicio de catálogo: lectura de Excel con enlaces, enriquecimiento web de fichas técnicas
y generación de catálogos PDF.

Reproduce la lógica de mapeo de columnas de CatálogoPro Studio (excelParser.js) y la extiende
con lo que ese prototipo no hacía: descargar desde cada URL la descripción, especificaciones,
normas, ficha técnica (PDF) e imagen del producto.
"""
import csv
import io
import ipaddress
import json
import os
import re
import socket
import urllib.parse
from html.parser import HTMLParser
from typing import Any, Dict, List, Optional, Tuple

import requests

from app.database import DB_DIR, tenant_file_prefix

IMAGES_DIR = os.path.join(DB_DIR, "catalog_images")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0 Safari/537.36 ERP-Catalogo/1.0")
MAX_HTML = 3_000_000
MAX_IMG = 8_000_000

# ------------------------------------------------------------------ mapeo de columnas (igual que excelParser.js)
COLUMN_KEYWORDS = {
    "categoria": ["categoria", "categoría", "category", "familia", "linea", "línea", "rubro", "catalogo", "catálogo", "grupo", "seccion", "sección"],
    "nombre": ["nombre", "producto", "título", "titulo", "title", "name", "item", "artículo", "articulo", "denominacion", "denominación"],
    "sku": ["sku", "código", "codigo", "referencia", "ref", "code", "modelo", "id", "part number", "nro parte"],
    "url": ["url", "link", "enlace", "vínculo", "vinculo", "web", "pagina", "página", "sitio", "href"],
    "imagen": ["imagen", "foto", "photo", "image", "img", "fotografia", "link imagen", "url imagen"],
    "normas": ["norma", "normas", "certificación", "certificacion", "certificaciones", "standards", "standard", "regulaciones", "homologación", "homologacion", "sellos", "certificados"],
    "descripcion": ["descripción", "descripcion", "description", "detalle", "resumen", "summary", "caracteristicas generales", "general"],
    "fabricante": ["fabricante", "marca", "brand", "manufacturer", "origen"],
    "garantia": ["garantía", "garantia", "warranty"],
    "precio": ["precio venta", "precio de venta", "precio", "price", "pvp", "valor venta", "valor"],
    "costo": ["costo", "cost", "precio compra", "precio costo"],
    "stock": ["stock", "existencia", "cantidad", "qty", "inventario"],
    "unidad": ["unidad", "unit", "um", "u/m"],
}
# el campo "imagen" se evalúa antes que "url" para que "URL Imagen" no se confunda con el enlace del producto
_FIELD_ORDER = ["categoria", "sku", "nombre", "imagen", "url", "normas", "descripcion", "fabricante",
                "garantia", "costo", "precio", "stock", "unidad"]


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", str(s or "").strip().lower())


def autodetect_mapping(columns: List[str]) -> Dict[str, Any]:
    mapping: Dict[str, Any] = {k: "" for k in COLUMN_KEYWORDS}
    used = set()
    for field in _FIELD_ORDER:
        kws = COLUMN_KEYWORDS[field]
        # 1) coincidencia exacta, 2) coincidencia parcial
        for exact in (True, False):
            for col in columns:
                if col in used:
                    continue
                n = _norm(col)
                if (n in kws) if exact else any(len(k) > 2 and k in n for k in kws):
                    mapping[field] = col
                    used.add(col)
                    break
            if mapping[field]:
                break
    if not mapping["nombre"]:
        cand = next((c for c in columns if c not in used), "")
        if cand:
            mapping["nombre"] = cand
            used.add(cand)
    mapping["spec_columns"] = [c for c in columns if c not in used]
    return mapping


def _looks_like_url(v: str) -> bool:
    return bool(re.match(r"^(https?://|www\.)\S+", str(v or "").strip(), re.I))


def read_table(data: bytes, filename: str) -> Tuple[List[str], List[Dict[str, Any]]]:
    """Lee xlsx/csv. Devuelve (columnas, filas). Para celdas con hipervínculo, el valor es la URL real."""
    ext = os.path.splitext(filename or "")[1].lower()
    rows: List[List[Any]] = []
    if ext in (".xlsx", ".xlsm"):
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
        ws = wb.worksheets[0]
        for r in ws.iter_rows():
            vals = []
            for c in r:
                v = c.value
                if c.hyperlink is not None and c.hyperlink.target:
                    # si el texto visible no es una URL, preservamos el destino real del enlace
                    if v is None or not _looks_like_url(str(v)):
                        v = c.hyperlink.target
                vals.append(v)
            rows.append(vals)
    elif ext in (".csv", ".txt"):
        text = data.decode("utf-8-sig", errors="replace")
        try:
            dialect = csv.Sniffer().sniff(text[:2000], delimiters=",;\t")
        except Exception:
            dialect = csv.excel
        rows = [list(r) for r in csv.reader(io.StringIO(text), dialect)]
    elif ext == ".xls":
        raise ValueError("El formato .xls antiguo no está soportado; guarde el archivo como .xlsx y vuelva a subirlo.")
    else:
        raise ValueError("Formato no soportado. Use .xlsx o .csv")

    rows = [r for r in rows if any(str(x).strip() for x in r if x is not None)]
    if len(rows) < 2:
        raise ValueError("El archivo está vacío o no tiene filas de datos.")
    header = [str(h).strip() if h is not None and str(h).strip() else f"Columna {i + 1}" for i, h in enumerate(rows[0])]
    out = []
    for r in rows[1:]:
        d = {}
        for i, h in enumerate(header):
            d[h] = r[i] if i < len(r) and r[i] is not None else ""
        out.append(d)
    return header, out


def _num(v) -> float:
    if v in (None, ""):
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[^\d,.\-]", "", str(v))
    if not s:
        return 0.0
    if "," in s and "." in s:  # 1.234,56
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".") if len(s.split(",")[-1]) <= 2 else s.replace(",", "")
    elif s.count(".") > 1 or (s.count(".") == 1 and len(s.split(".")[-1]) == 3):
        s = s.replace(".", "")
    try:
        return float(s)
    except ValueError:
        return 0.0


def rows_to_products(rows: List[Dict[str, Any]], mapping: Dict[str, Any]) -> List[Dict[str, Any]]:
    def g(row, field):
        col = mapping.get(field)
        return str(row.get(col, "")).strip() if col else ""

    products = []
    for i, row in enumerate(rows):
        specs: Dict[str, str] = {}
        for col in mapping.get("spec_columns", []):
            v = str(row.get(col, "")).strip()
            if v:
                if _looks_like_url(v) and not mapping.get("url"):
                    mapping["url"] = col  # primera columna con links si no se detectó una
                    continue
                specs[col] = v
        url = g(row, "url")
        img = g(row, "imagen")
        if url and re.search(r"\.(jpe?g|png|webp|gif)(\?|$)", url, re.I) and not img:
            img, url = url, ""
        products.append({
            "category": g(row, "categoria") or "General",
            "name": g(row, "nombre") or f"Producto {i + 1}",
            "sku": g(row, "sku"),
            "source_url": url if _looks_like_url(url) else "",
            "image_url": img if _looks_like_url(img) else "",
            "norms": g(row, "normas"),
            "description": g(row, "descripcion"),
            "brand": g(row, "fabricante"),
            "warranty": g(row, "garantia"),
            "unit_price": _num(row.get(mapping["precio"])) if mapping.get("precio") else 0.0,
            "unit_cost": _num(row.get(mapping["costo"])) if mapping.get("costo") else 0.0,
            "stock": _num(row.get(mapping["stock"])) if mapping.get("stock") else 0.0,
            "unit": g(row, "unidad") or "UND",
            "specs": specs,
        })
    return products


# ------------------------------------------------------------------ scraping de fichas
def _safe_url(url: str) -> str:
    url = url.strip()
    if url.lower().startswith("www."):
        url = "https://" + url
    p = urllib.parse.urlparse(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        raise ValueError("URL inválida")
    try:  # evita apuntar a la red interna (SSRF)
        for info in socket.getaddrinfo(p.hostname, None):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local:
                raise ValueError("URL apunta a una dirección interna")
    except socket.gaierror:
        raise ValueError("No se pudo resolver el dominio")
    return url


class _PageParser(HTMLParser):
    """Extrae meta, JSON-LD, tablas/listas de especificaciones, imágenes y enlaces a PDF."""

    def __init__(self, base: str):
        super().__init__(convert_charrefs=True)
        self.base = base
        self.meta: Dict[str, str] = {}
        self.jsonld: List[str] = []
        self.title = ""
        self.h1 = ""
        self.pdfs: List[str] = []
        self.imgs: List[str] = []
        self.specs: Dict[str, str] = {}
        self._in = []            # pila de etiquetas relevantes
        self._buf = ""
        self._row: List[str] = []
        self._dt = ""
        self._ldjson = False
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("script", "style", "noscript", "svg"):
            if tag == "script" and "ld+json" in (a.get("type") or ""):
                self._ldjson = True
                self._buf = ""
            else:
                self._skip += 1
            return
        if tag == "meta":
            k = (a.get("property") or a.get("name") or "").lower()
            if k and a.get("content"):
                self.meta.setdefault(k, a["content"].strip())
        elif tag == "img":
            src = a.get("src") or a.get("data-src") or a.get("data-lazy-src")
            if src:
                self.imgs.append(urllib.parse.urljoin(self.base, src))
        elif tag == "a":
            href = a.get("href") or ""
            if re.search(r"\.pdf(\?|$)", href, re.I):
                self.pdfs.append(urllib.parse.urljoin(self.base, href))
        if tag in ("title", "h1", "th", "td", "dt", "dd", "li", "tr"):
            self._in.append(tag)
            self._buf = ""
            if tag == "tr":
                self._row = []

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript", "svg"):
            if tag == "script" and self._ldjson:
                self.jsonld.append(self._buf)
                self._ldjson = False
            elif self._skip:
                self._skip -= 1
            return
        txt = re.sub(r"\s+", " ", self._buf).strip()
        if tag == "title" and txt:
            self.title = self.title or txt
        elif tag == "h1" and txt:
            self.h1 = self.h1 or txt
        elif tag in ("th", "td"):
            self._row.append(txt)
        elif tag == "tr":
            if len(self._row) == 2 and self._row[0] and self._row[1] and len(self._row[0]) < 60:
                self.specs.setdefault(self._row[0].rstrip(":"), self._row[1][:300])
            self._row = []
        elif tag == "dt":
            self._dt = txt
        elif tag == "dd" and self._dt and txt:
            self.specs.setdefault(self._dt.rstrip(":"), txt[:300])
            self._dt = ""
        elif tag == "li" and ":" in txt and len(txt) < 200:
            k, v = txt.split(":", 1)
            if 1 < len(k.strip()) < 40 and v.strip():
                self.specs.setdefault(k.strip(), v.strip())
        if tag in self._in:
            self._in.remove(tag)
        if tag in ("title", "h1", "th", "td", "dt", "dd", "li", "tr"):
            self._buf = ""

    def handle_data(self, data):
        if self._skip and not self._ldjson:
            return
        self._buf += data


def _jsonld_product(blocks: List[str]) -> Dict[str, Any]:
    def walk(o):
        if isinstance(o, list):
            for x in o:
                yield from walk(x)
        elif isinstance(o, dict):
            yield o
            for v in o.values():
                if isinstance(v, (list, dict)):
                    yield from walk(v)

    for b in blocks:
        try:
            data = json.loads(b)
        except Exception:
            continue
        for node in walk(data):
            t = node.get("@type")
            if t == "Product" or (isinstance(t, list) and "Product" in t):
                return node
    return {}


def _http_get(url: str, stream=False):
    return requests.get(url, headers={"User-Agent": UA, "Accept-Language": "es-CL,es;q=0.9,en;q=0.5"},
                        timeout=15, stream=stream, allow_redirects=True)


def _read_limited(resp, limit: int) -> bytes:
    buf = b""
    for chunk in resp.iter_content(65536):
        buf += chunk
        if len(buf) > limit:
            break
    return buf[:limit]


def _pdf_text_specs(data: bytes) -> Tuple[str, Dict[str, str]]:
    try:
        from pypdf import PdfReader
        r = PdfReader(io.BytesIO(data))
        text = "\n".join((p.extract_text() or "") for p in r.pages[:6])
    except Exception:
        return "", {}
    specs = {}
    for line in text.splitlines():
        m = re.match(r"^\s*([A-Za-zÁÉÍÓÚáéíóúñÑ /()\-]{3,40}):\s*(.{2,200})$", line)
        if m:
            specs.setdefault(m.group(1).strip(), m.group(2).strip())
    return text, specs


_NORM_RE = re.compile(r"\b(ISO\s?\d{3,5}(?::\d{4})?|ASTM\s?[A-Z]?\d{2,5}|ANSI(?:/[A-Z]+)?\s?[A-Z]?\d[\d.\-]*|"
                      r"EN\s?\d{2,5}(?::\d{4})?|IEC\s?\d{3,6}|NCh\s?\d{2,5}|NOM-\d{3}-[A-Z]+-\d{4}|OSHA\s?\d+|ATEX|CE\b|UL\s?\d+|IP\d{2}|ISP)\b")


def extract_norms(*texts: str) -> List[str]:
    found: List[str] = []
    for t in texts:
        for m in _NORM_RE.finditer(t or ""):
            n = re.sub(r"\s+", " ", m.group(1)).strip()
            if n not in found:
                found.append(n)
    return found[:12]


def scrape_product(url: str) -> Dict[str, Any]:
    """Descarga la ficha de un enlace. Devuelve campos encontrados (nunca inventa datos)."""
    result: Dict[str, Any] = {"ok": False, "name": "", "description": "", "brand": "", "sku": "",
                              "image_url": "", "datasheet_url": "", "specs": {}, "norms": [], "price": 0.0,
                              "error": ""}
    try:
        url = _safe_url(url)
        resp = _http_get(url, stream=True)
        resp.raise_for_status()
        ctype = (resp.headers.get("content-type") or "").lower()
        if ctype.startswith("image/"):
            result.update(ok=True, image_url=url)
            return result
        raw = _read_limited(resp, MAX_HTML if "pdf" not in ctype else 15_000_000)
        if "pdf" in ctype or url.lower().split("?")[0].endswith(".pdf"):
            text, specs = _pdf_text_specs(raw)
            result.update(ok=bool(text), datasheet_url=url, specs=specs, norms=extract_norms(text),
                          description=re.sub(r"\s+", " ", text)[:600])
            return result
        enc = resp.encoding or "utf-8"
        try:
            html = raw.decode(enc, errors="replace")
        except LookupError:
            html = raw.decode("utf-8", errors="replace")
        p = _PageParser(resp.url)
        p.feed(html)
        ld = _jsonld_product(p.jsonld)
        meta = p.meta

        name = (ld.get("name") or meta.get("og:title") or p.h1 or p.title or "").strip()
        desc = (ld.get("description") or meta.get("og:description") or meta.get("description") or "").strip()
        brand = ld.get("brand")
        brand = (brand.get("name") if isinstance(brand, dict) else brand) or meta.get("product:brand", "")
        img = ld.get("image") or meta.get("og:image") or meta.get("twitter:image") or ""
        if isinstance(img, list):
            img = img[0] if img else ""
        if isinstance(img, dict):
            img = img.get("url", "")
        if not img:  # primera imagen razonable de la página
            img = next((i for i in p.imgs if not re.search(r"logo|icon|sprite|banner|pixel|\.svg", i, re.I)), "")
        specs = dict(p.specs)
        for prop in ld.get("additionalProperty", []) if isinstance(ld.get("additionalProperty"), list) else []:
            if isinstance(prop, dict) and prop.get("name") and prop.get("value") not in (None, ""):
                specs.setdefault(str(prop["name"]), str(prop["value"]))
        price = 0.0
        offers = ld.get("offers")
        if isinstance(offers, list) and offers:
            offers = offers[0]
        if isinstance(offers, dict):
            price = _num(offers.get("price"))

        datasheet = p.pdfs[0] if p.pdfs else ""
        if datasheet and len(specs) < 3:  # complementa con la ficha PDF si la página trae pocas especificaciones
            try:
                pr = _http_get(_safe_url(datasheet), stream=True)
                if pr.ok:
                    _, pspecs = _pdf_text_specs(_read_limited(pr, 15_000_000))
                    for k, v in pspecs.items():
                        specs.setdefault(k, v)
            except Exception:
                pass

        norms = extract_norms(name, desc, " ".join(specs.values()), " ".join(specs.keys()))
        result.update(
            ok=bool(name or desc or specs or img), name=name[:300], description=desc[:1500],
            brand=str(brand or "")[:120], sku=str(ld.get("sku") or ld.get("mpn") or "")[:80],
            image_url=urllib.parse.urljoin(resp.url, str(img)) if img else "", datasheet_url=datasheet,
            specs=dict(list(specs.items())[:40]), norms=norms, price=price)
        if not result["ok"]:
            result["error"] = "La página no entregó datos reconocibles"
    except Exception as e:
        result["error"] = str(e)[:200]
    return result


def download_image(url: str, key: str) -> Optional[str]:
    """Descarga y normaliza (JPEG ≤1000px) la imagen. Devuelve ruta local o None."""
    try:
        from PIL import Image
        resp = _http_get(_safe_url(url), stream=True)
        resp.raise_for_status()
        raw = _read_limited(resp, MAX_IMG)
        im = Image.open(io.BytesIO(raw))
        if im.mode in ("RGBA", "LA", "P"):
            bg = Image.new("RGB", im.size, (255, 255, 255))
            im = im.convert("RGBA")
            bg.paste(im, mask=im.split()[-1])
            im = bg
        else:
            im = im.convert("RGB")
        im.thumbnail((1000, 1000))
        os.makedirs(IMAGES_DIR, exist_ok=True)
        safe = re.sub(r"[^\w\-]+", "_", key)[:60]
        path = os.path.join(IMAGES_DIR, f"{tenant_file_prefix()}{safe}.jpg")
        im.save(path, "JPEG", quality=85)
        return path
    except Exception:
        return None


def save_image_bytes(raw: bytes, key: str) -> Optional[str]:
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        im.thumbnail((1000, 1000))
        os.makedirs(IMAGES_DIR, exist_ok=True)
        safe = re.sub(r"[^\w\-]+", "_", key)[:60]
        path = os.path.join(IMAGES_DIR, f"{tenant_file_prefix()}{safe}.jpg")
        im.save(path, "JPEG", quality=85)
        return path
    except Exception:
        return None


# ------------------------------------------------------------------ PDF de catálogo
def build_catalog_pdf(products: List[Dict[str, Any]], title: str, subtitle: str,
                      company: Dict[str, Any], per_page: int = 2, norms_matrix: bool = True,
                      cover_path: Optional[str] = None, logo_path: Optional[str] = None) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (BaseDocTemplate, Frame, Image as RLImage, KeepTogether, PageBreak,
                                    PageTemplate, Paragraph, Spacer, Table, TableStyle)
    from xml.sax.saxutils import escape

    buf = io.BytesIO()
    W, H = A4
    brand = colors.HexColor("#1e3a8a")
    ss = getSampleStyleSheet()
    st_h1 = ParagraphStyle("h1", parent=ss["Title"], fontSize=26, textColor=brand, leading=30, alignment=0)
    st_sub = ParagraphStyle("sub", parent=ss["Normal"], fontSize=12, textColor=colors.HexColor("#475569"))
    st_cat = ParagraphStyle("cat", parent=ss["Heading1"], fontSize=16, textColor=brand, spaceAfter=6)
    st_name = ParagraphStyle("nm", parent=ss["Heading3"], fontSize=12, textColor=colors.HexColor("#0f172a"), spaceAfter=2, leading=14)
    st_txt = ParagraphStyle("tx", parent=ss["Normal"], fontSize=8.5, leading=11, textColor=colors.HexColor("#334155"))
    st_small = ParagraphStyle("sm", parent=ss["Normal"], fontSize=7.5, leading=9.5, textColor=colors.HexColor("#64748b"))
    st_norm = ParagraphStyle("nr", parent=ss["Normal"], fontSize=7.5, textColor=colors.HexColor("#065f46"))
    cname = company.get("razon_social", "")

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(colors.HexColor("#94a3b8"))
        canvas.drawString(15 * mm, 9 * mm, f"{cname} · {title}")
        canvas.drawRightString(W - 15 * mm, 9 * mm, f"Página {doc.page}")
        canvas.restoreState()

    from reportlab.platypus import NextPageTemplate
    from reportlab.lib.utils import ImageReader

    def _wrap_lines(text, font, size, maxw):
        words, lines, cur = (text or "").split(), [], ""
        for w_ in words:
            t_ = (cur + " " + w_).strip()
            if canvas_stringwidth(t_, font, size) <= maxw:
                cur = t_
            else:
                if cur:
                    lines.append(cur)
                cur = w_
        if cur:
            lines.append(cur)
        return lines

    from reportlab.pdfbase.pdfmetrics import stringWidth as canvas_stringwidth

    def cover(canvas, doc):
        """Portada personalizable: imagen de portada (a página completa), logo, título y subtítulo."""
        canvas.saveState()
        has_img = bool(cover_path and os.path.exists(cover_path))
        if has_img:
            try:
                ir = ImageReader(cover_path)
                iw, ih = ir.getSize()
                sc = max(W / iw, H / ih)  # cubre toda la página
                dw, dh = iw * sc, ih * sc
                canvas.drawImage(ir, (W - dw) / 2, (H - dh) / 2, width=dw, height=dh)
                canvas.setFillColorRGB(0.04, 0.09, 0.2)
                canvas.setFillAlpha(0.72)
                canvas.rect(0, 0, W, 105 * mm, stroke=0, fill=1)
                canvas.setFillAlpha(1)
            except Exception:
                has_img = False
        if not has_img:
            canvas.setFillColor(brand)
            canvas.rect(0, H - 14 * mm, W, 14 * mm, stroke=0, fill=1)
        if logo_path and os.path.exists(logo_path):
            try:
                lr = ImageReader(logo_path)
                lw, lh = lr.getSize()
                ls = min(55 * mm / lw, 28 * mm / lh)
                if has_img:
                    canvas.setFillColorRGB(1, 1, 1)
                    canvas.roundRect(13 * mm, H - 13 * mm - lh * ls - 4 * mm, lw * ls + 8 * mm, lh * ls + 8 * mm, 3 * mm, stroke=0, fill=1)
                canvas.drawImage(lr, 17 * mm, H - 13 * mm - lh * ls, width=lw * ls, height=lh * ls, mask="auto")
            except Exception:
                pass
        white = has_img
        title_color = (1, 1, 1) if white else (0.12, 0.23, 0.54)
        sub_color = (0.9, 0.93, 1) if white else (0.28, 0.33, 0.41)
        y = (78 * mm) if has_img else (H - 90 * mm)
        canvas.setFillColorRGB(*title_color)
        for ln in _wrap_lines(title, "Helvetica-Bold", 30, W - 34 * mm)[:3]:
            canvas.setFont("Helvetica-Bold", 30)
            canvas.drawString(17 * mm, y, ln)
            y -= 12 * mm
        y -= 2 * mm
        canvas.setFillColorRGB(*sub_color)
        for ln in _wrap_lines(subtitle or "", "Helvetica", 14, W - 34 * mm)[:3]:
            canvas.setFont("Helvetica", 14)
            canvas.drawString(17 * mm, y, ln)
            y -= 7 * mm
        y = 28 * mm if has_img else 40 * mm
        canvas.setFillColorRGB(*sub_color)
        canvas.setFont("Helvetica-Bold", 11)
        canvas.drawString(17 * mm, y, cname)
        canvas.setFont("Helvetica", 8.5)
        if company.get("rut"):
            y -= 5 * mm
            canvas.drawString(17 * mm, y, f"RUT {company['rut']}")
        contact_ = " · ".join(x for x in (company.get("direccion"), company.get("telefono"), company.get("email")) if x)
        if contact_:
            y -= 5 * mm
            canvas.drawString(17 * mm, y, contact_[:110])
        canvas.restoreState()

    doc = BaseDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm,
                          topMargin=15 * mm, bottomMargin=16 * mm, title=title, author=cname)
    frame_ = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
    doc.addPageTemplates([PageTemplate(id="cover", frames=[Frame(15 * mm, 15 * mm, 60 * mm, 60 * mm, id="fc", leftPadding=0,
                                                                 rightPadding=0, topPadding=0, bottomPadding=0)], onPage=cover),
                          PageTemplate(id="p", frames=[frame_], onPage=footer)])
    story: list = [NextPageTemplate("p"), Spacer(1, 1), PageBreak()]

    def card(p: Dict[str, Any]):
        img = None
        gallery = [g for g in (p.get("gallery_paths") or []) if g and os.path.exists(g)]
        path = gallery[0] if gallery else p.get("image_path")
        if path and os.path.exists(path):
            try:
                img = RLImage(path, width=48 * mm, height=48 * mm, kind="proportional")
            except Exception:
                img = None
        if img is None:
            img = Paragraph("<font color='#94a3b8'>Sin imagen</font>", st_small)
        extra = []
        for g in gallery[1:4]:
            try:
                extra.append(RLImage(g, width=15 * mm, height=15 * mm, kind="proportional"))
            except Exception:
                pass
        if extra:
            thumbs = Table([extra], colWidths=[16 * mm] * len(extra))
            thumbs.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 1)]))
            img = [img, Spacer(1, 1.5 * mm), thumbs]
        specs = p.get("specs") or {}
        right: list = [Paragraph(escape(p["name"]), st_name)]
        meta = " · ".join(x for x in (f"SKU {p['sku']}" if p.get("sku") else "", p.get("brand") or "") if x)
        if meta:
            right.append(Paragraph(escape(meta), st_small))
        if p.get("description"):
            right.append(Spacer(1, 1.5 * mm))
            right.append(Paragraph(escape(p["description"][:420]), st_txt))
        if specs:
            rows = [[Paragraph(f"<b>{escape(str(k))}</b>", st_small), Paragraph(escape(str(v)[:140]), st_small)]
                    for k, v in list(specs.items())[:10]]
            t = Table(rows, colWidths=[32 * mm, 80 * mm])
            t.setStyle(TableStyle([("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.HexColor("#f8fafc"), colors.white]),
                                   ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
                                   ("TOPPADDING", (0, 0), (-1, -1), 1.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5)]))
            right += [Spacer(1, 2 * mm), t]
        norms = [n.strip() for n in re.split(r"[,;|]+", p.get("norms") or "") if n.strip()]
        if norms:
            right += [Spacer(1, 1.5 * mm), Paragraph("Normas: " + " · ".join(escape(n) for n in norms), st_norm)]
        if p.get("warranty"):
            right.append(Paragraph(f"Garantía: {escape(p['warranty'])}", st_small))
        if p.get("show_price") and p.get("unit_price"):
            right.append(Paragraph(f"<b>Precio neto: ${p['unit_price']:,.0f}</b>".replace(",", "."), st_txt))
        tb = Table([[img, right]], colWidths=[52 * mm, doc.width - 52 * mm])
        tb.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                                ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#cbd5e1")),
                                ("LEFTPADDING", (0, 0), (-1, -1), 6), ("TOPPADDING", (0, 0), (-1, -1), 6),
                                ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
        return KeepTogether([tb, Spacer(1, 5 * mm)])

    # Productos agrupados por categoría
    groups: Dict[str, list] = {}
    for p in products:
        groups.setdefault(p.get("category") or "General", []).append(p)
    for gi, (cat, items) in enumerate(groups.items()):
        if gi:
            story.append(PageBreak())
        story.append(Paragraph(escape(cat), st_cat))
        for i, p in enumerate(items):
            story.append(card(p))
            if per_page and (i + 1) % per_page == 0 and i + 1 < len(items):
                story.append(PageBreak())

    # Matriz de normas
    if norms_matrix:
        rows = [["SKU", "Producto", "Normas / Certificaciones"]]
        for p in products:
            if p.get("norms"):
                rows.append([Paragraph(escape(p.get("sku") or "-"), st_small), Paragraph(escape(p["name"][:70]), st_small),
                             Paragraph(escape(p["norms"][:160]), st_small)])
        if len(rows) > 1:
            story += [PageBreak(), Paragraph("Matriz de cumplimiento normativo", st_cat)]
            t = Table(rows, colWidths=[28 * mm, 70 * mm, doc.width - 98 * mm], repeatRows=1)
            t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), brand), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                                   ("FONTSIZE", (0, 0), (-1, 0), 8), ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#cbd5e1")),
                                   ("VALIGN", (0, 0), (-1, -1), "TOP")]))
            story.append(t)

    doc.build(story)
    return buf.getvalue()


def template_xlsx() -> bytes:
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Catalogo"
    ws.append(["Categoría", "SKU", "Nombre", "Link Producto (URL)", "Marca", "Precio Venta", "Costo", "Stock", "Normas"])
    ws.append(["EPP", "EPP-001", "Guante dieléctrico Clase 3", "https://ejemplo.cl/producto/guante-clase-3", "Marca X", 45000, 28000, 10, "ASTM D120"])
    for col, w in zip("ABCDEFGHI", (18, 14, 36, 48, 16, 14, 12, 10, 24)):
        ws.column_dimensions[col].width = w
    b = io.BytesIO()
    wb.save(b)
    return b.getvalue()
