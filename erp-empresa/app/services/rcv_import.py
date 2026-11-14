"""Importación del archivo oficial del RCV (SII): 'Descargar Detalles' (CSV) o 'Descargar Resumen' (CSV / Excel).

Detalle: un documento por fila (con folio). Resumen: totales por tipo de documento (sin folios).
"""
import csv
import io
import re
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

from app.services.sii_client import parse_date


class RcvFileError(ValueError):
    pass


def _norm(s: Any) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9 ]", "", s.lower().replace(".", " ")).strip()


def _num(v: Any) -> float:
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace("$", "").replace(" ", "")
    if not s or s in ("-", "--"):
        return 0.0
    if re.fullmatch(r"-?\d{1,3}(\.\d{3})+", s):
        s = s.replace(".", "")
    s = s.replace(",", ".") if re.fullmatch(r"-?\d+,\d+", s) else s
    try:
        return float(s)
    except ValueError:
        return 0.0


def _read_rows(filename: str, data: bytes) -> List[List[Any]]:
    low = (filename or "").lower()
    if low.endswith(".xlsx") or low.endswith(".xlsm") or data[:2] == b"PK":
        import openpyxl
        try:
            wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        except Exception as e:
            raise RcvFileError(f"No se pudo abrir el Excel: {e}")
        ws = wb.worksheets[0]
        return [list(r) for r in ws.iter_rows(values_only=True)]
    if low.endswith(".xls") and data[:4] == b"\xd0\xcf\x11\xe0":
        raise RcvFileError("Formato Excel antiguo (.xls) no soportado. Guarde el archivo como .xlsx o use el CSV del portal del SII.")
    for enc in ("utf-8-sig", "latin-1"):
        try:
            text = data.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    first = text.splitlines()[0] if text.strip() else ""
    delim = ";" if first.count(";") >= first.count(",") else ","
    return [r for r in csv.reader(io.StringIO(text), delimiter=delim)]


def _find_header(rows: List[List[Any]]) -> Tuple[int, Dict[str, int]]:
    for i, r in enumerate(rows[:15]):
        names = [_norm(c) for c in r]
        if any(n.startswith("tipo doc") for n in names) and (any(n == "folio" for n in names) or any("total documentos" in n for n in names)):
            return i, {n: j for j, n in reversed(list(enumerate(names))) if n}
    raise RcvFileError("No se reconoce el formato: el archivo debe ser el CSV/Excel oficial del RCV del SII "
                       "(botón 'Descargar Detalles' o 'Descargar Resumen').")


def _tipo(v: Any) -> Optional[int]:
    s = str(v or "").strip()
    m = re.search(r"\b(\d{2,3})\b", s)
    if m:
        return int(m.group(1))
    n = _norm(s)
    for key, code in (("factura electronica", 33), ("factura no afecta", 34), ("factura exenta", 34), ("factura de compra", 46),
                      ("nota de credito", 61), ("nota de debito", 56), ("liquidacion", 43), ("factura", 30)):
        if key in n:
            return code
    return None


def _col(cols: Dict[str, int], *cands: str) -> Optional[int]:
    for c in cands:
        if c in cols:
            return cols[c]
    for c in cands:
        for k, v in cols.items():
            if k.startswith(c):
                return v
    return None


def detect_period(filename: str) -> Optional[str]:
    m = re.search(r"(20\d{2})[-_]?(0[1-9]|1[0-2])(?!\d)", filename or "")
    return f"{m.group(1)}{m.group(2)}" if m else None


def detect_operation(filename: str) -> Optional[str]:
    n = (filename or "").upper()
    if "VENTA" in n:
        return "VENTA"
    if "COMPRA" in n:
        return "COMPRA"
    return None


def parse_rcv(filename: str, data: bytes, operation: Optional[str] = None) -> Dict[str, Any]:
    rows = _read_rows(filename, data)
    hi, cols = _find_header(rows)
    body = rows[hi + 1:]
    is_summary = _col(cols, "total documentos") is not None and "folio" not in cols
    c_tipo = _col(cols, "tipo documento", "tipo doc")
    c_exe = _col(cols, "monto exento")
    c_net = _col(cols, "monto neto")
    c_iva = _col(cols, "monto iva recuperable", "monto iva")
    c_tot = _col(cols, "monto total")
    if c_tipo is None or c_tot is None:
        raise RcvFileError("Faltan columnas obligatorias (Tipo Doc, Monto Total) en el archivo.")

    def g(r, c):
        return r[c] if c is not None and c < len(r) else None

    if is_summary:
        c_cnt = _col(cols, "total documentos")
        out = []
        for r in body:
            t = _tipo(g(r, c_tipo))
            if t is None or not any(g(r, c) not in (None, "") for c in (c_net, c_tot)):
                continue
            out.append({"dte_type": t, "count": int(_num(g(r, c_cnt))), "exempt": _num(g(r, c_exe)),
                        "net": _num(g(r, c_net)), "iva": _num(g(r, c_iva)), "total": _num(g(r, c_tot))})
        if not out:
            raise RcvFileError("El resumen no contiene filas con datos.")
        return {"kind": "RESUMEN", "operation": operation or detect_operation(filename), "rows": out}

    c_rut = _col(cols, "rut proveedor", "rut cliente", "rut")
    c_name = _col(cols, "razon social")
    c_folio = _col(cols, "folio")
    c_date = _col(cols, "fecha docto", "fecha documento")
    if None in (c_rut, c_folio, c_date):
        raise RcvFileError("Faltan columnas (RUT, Folio, Fecha Docto) en el archivo de detalle.")
    op = operation or ("COMPRA" if ("rut proveedor" in cols or "tipo compra" in cols) else "VENTA" if ("rut cliente" in cols or "tipo venta" in cols) else detect_operation(filename))
    out, skipped = [], 0
    for r in body:
        folio = re.sub(r"\D", "", str(g(r, c_folio) or ""))
        tipo = re.sub(r"\D", "", str(g(r, c_tipo) or "")[:4])
        rut = re.sub(r"[^0-9kK]", "", str(g(r, c_rut) or ""))
        if not folio or not tipo or len(rut) < 2:
            skipped += 1 if any(str(x).strip() for x in r) else 0
            continue
        d = g(r, c_date)
        date = d.strftime("%Y-%m-%d") if hasattr(d, "strftime") else parse_date(str(d or ""))
        out.append({"dte_type": int(tipo), "folio": int(folio), "rut": f"{rut[:-1]}-{rut[-1].upper()}",
                    "name": (str(g(r, c_name) or "").strip() or "Sin razón social"), "date": date,
                    "net": _num(g(r, c_net)), "exempt": _num(g(r, c_exe)), "iva": _num(g(r, c_iva)), "total": _num(g(r, c_tot))})
    if not out:
        raise RcvFileError("El archivo no contiene documentos (filas con folio).")
    return {"kind": "DETALLE", "operation": op, "rows": out, "skipped": skipped}
