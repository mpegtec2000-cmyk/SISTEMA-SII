"""Membrete: logo oficial de la empresa activa para PDFs (cotización, OC, anexos, catálogo)."""
import glob
import os
from typing import List, Optional

from app import database

LOGO_DIR = os.path.join(database.DB_DIR, "company_logos")


def company_logo_path(company_id=None) -> Optional[str]:
    cid = company_id or database.active_company_id()
    if not cid:
        return None
    hits = glob.glob(os.path.join(LOGO_DIR, f"{int(cid)}.*"))
    return hits[0] if hits else None


def logo_flowable(max_w_cm: float = 4.5, max_h_cm: float = 2.2):
    """Imagen reportlab proporcional del logo, o None si la empresa no tiene logo."""
    p = company_logo_path()
    if not p:
        return None
    try:
        from reportlab.lib.units import cm
        from reportlab.platypus import Image
        return Image(p, width=max_w_cm * cm, height=max_h_cm * cm, kind="proportional", hAlign="LEFT")
    except Exception:
        return None


def logo_list() -> List:
    lg = logo_flowable()
    return [lg] if lg else []
