"""
OCR para PDFs escaneados (páginas que son imágenes) y extracción de tablas.

- Renderiza cada página sin texto con pypdfium2 y la lee con RapidOCR (100% local, sin servicios externos).
- Si las librerías no están instaladas, el sistema sigue funcionando y avisa qué falta.
"""
import io
from typing import Callable, List, Optional, Tuple

_engine = None
_engine_error: Optional[str] = None


def available() -> Tuple[bool, str]:
    try:
        import pypdfium2  # noqa: F401
    except Exception:
        return False, "Falta 'pypdfium2' (pip install pypdfium2)"
    try:
        _get_engine()
    except Exception as e:  # noqa
        return False, f"Falta el motor OCR ('pip install rapidocr-onnxruntime'): {e}"
    return True, ""


def _get_engine():
    global _engine, _engine_error
    if _engine is None:
        if _engine_error:
            raise RuntimeError(_engine_error)
        try:
            from rapidocr_onnxruntime import RapidOCR
            _engine = RapidOCR()
        except Exception as e:  # noqa
            _engine_error = str(e)
            raise
    return _engine


def _lines_from_result(result) -> str:
    """Ordena los fragmentos detectados por filas (y de izquierda a derecha)."""
    if not result:
        return ""
    items = []
    for box, text, _conf in result:
        ys = [p[1] for p in box]
        xs = [p[0] for p in box]
        items.append((sum(ys) / 4.0, min(xs), max(ys) - min(ys), text))
    items.sort(key=lambda i: i[0])
    rows, cur, cur_y, cur_h = [], [], None, 0
    for y, x, h, t in items:
        if cur and abs(y - cur_y) > max(8, cur_h * 0.6):
            rows.append(cur)
            cur = []
        if not cur:
            cur_y, cur_h = y, h
        cur.append((x, t))
    if cur:
        rows.append(cur)
    return "\n".join("  ".join(t for _, t in sorted(r)) for r in rows)


def ocr_pdf_pages(file_bytes: bytes, page_numbers: List[int],
                  progress: Optional[Callable[[int, int], None]] = None) -> dict:
    """Devuelve {n_pagina: texto} para las páginas pedidas (1-indexadas)."""
    import pypdfium2 as pdfium
    engine = _get_engine()
    pdf = pdfium.PdfDocument(io.BytesIO(file_bytes))
    out = {}
    total = len(page_numbers)
    for k, n in enumerate(page_numbers, start=1):
        try:
            page = pdf[n - 1]
            img = page.render(scale=2.2).to_pil().convert("RGB")
            import numpy as np
            result, _ = engine(np.array(img))
            out[n] = _lines_from_result(result)
        except Exception:
            out[n] = ""
        if progress:
            progress(k, total)
    return out


def extract_tables(file_bytes: bytes, max_pages: int = 80, budget_s: int = 60) -> dict:
    """Tablas del PDF (pdfplumber) como filas 'celda | celda | celda' por página."""
    import time
    out = {}
    try:
        import pdfplumber
    except Exception:
        return out
    t0 = time.time()
    try:
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            for i, page in enumerate(pdf.pages[:max_pages], start=1):
                if time.time() - t0 > budget_s:
                    break
                try:
                    rows = []
                    for tbl in page.extract_tables() or []:
                        for r in tbl:
                            cells = [" ".join((c or "").split()) for c in r]
                            if any(cells):
                                rows.append(" | ".join(cells))
                        rows.append("")
                    if rows:
                        out[i] = "\n".join(rows)
                except Exception:
                    continue
    except Exception:
        pass
    return out
