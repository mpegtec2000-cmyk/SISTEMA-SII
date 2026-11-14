"""Integraciones en vivo: SII (RCV con RUT + Clave Tributaria; certificado digital sólo para emitir DTE) y banco (Fintoc). Todo por empresa activa."""
import os
import re
import contextvars
import threading
import time
import uuid
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.database import active_company_id, execute_commit, execute_insert, query_all, query_one
from app.models import formatear_rut
from app.services import bank_client, secrets_store, sii_client, rcv_import
from app.services.reconciliation_service import find_reconciliation_matches, reconcile_transaction

router = APIRouter(prefix="/api/integrations", tags=["Integraciones SII y Banco"])
_JOBS: Dict[str, Dict[str, Any]] = {}
AUTO_CONFIDENCE = 90


def _now() -> str:
    return datetime.now().isoformat(sep=" ", timespec="seconds")


# =============================================================== SII
def _sii_row() -> Optional[Dict[str, Any]]:
    return query_one("SELECT * FROM sii_config WHERE id = 1")


def _sii_public(r: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not r:
        comp = query_one("SELECT rut FROM companies WHERE id = ?", (active_company_id(),)) or {}
        return {"configured": False, "has_clave": False, "has_cert": False, "rut": comp.get("rut", ""), "ambiente": "PRODUCCION"}
    return {"configured": bool(r.get("clave_enc")), "has_clave": bool(r.get("clave_enc")), "has_cert": bool(r.get("pfx_enc")),
            "rut": r.get("rut"), "ambiente": r.get("ambiente"),
            "cert_subject": r.get("cert_subject"), "cert_rut": r.get("cert_rut"), "cert_expires": r.get("cert_expires"),
            "last_sync": r.get("last_sync"), "last_status": r.get("last_status")}


@router.get("/sii/config")
def sii_get_config():
    return _sii_public(_sii_row())


@router.post("/sii/config")
async def sii_save_config(rut: str = Form(...), ambiente: str = Form("PRODUCCION"), clave: str = Form(""),
                          password: str = Form(""), file: Optional[UploadFile] = File(None)):
    """Guarda RUT, ambiente y Clave Tributaria (para consultar el RCV) cifrada. El certificado .pfx/.p12 + su contraseña
    son opcionales y sólo se usan para facturar / emitir DTE."""
    if ambiente not in ("PRODUCCION", "CERTIFICACION"):
        raise HTTPException(status_code=400, detail="Ambiente inválido")
    try:
        sii_client.split_rut(rut)
    except sii_client.SiiError as e:
        raise HTTPException(status_code=400, detail=str(e))
    rut_fmt = formatear_rut(rut)
    cur = _sii_row()
    info = None
    pfx_enc = cur.get("pfx_enc") if cur else None
    pass_enc = cur.get("pass_enc") if cur else None
    clave_enc = cur.get("clave_enc") if cur else None
    if clave:
        clave_enc = secrets_store.encrypt(clave.encode("utf-8"))
    if file is not None and file.filename:
        if not file.filename.lower().endswith((".pfx", ".p12")):
            raise HTTPException(status_code=400, detail="El certificado debe ser un archivo .pfx o .p12")
        data = await file.read()
        if not data or len(data) > 2_000_000:
            raise HTTPException(status_code=400, detail="Archivo de certificado vacío o demasiado grande")
        if not password:
            raise HTTPException(status_code=400, detail="Ingrese la contraseña del certificado")
        try:
            info = sii_client.inspect_pfx(data, password)
        except sii_client.SiiError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if info["expired"]:
            raise HTTPException(status_code=400, detail=f"El certificado está vencido ({info['expires']}).")
        pfx_enc, pass_enc = secrets_store.encrypt(data), secrets_store.encrypt(password.encode("utf-8"))
    elif password and pfx_enc:  # cambio de contraseña sobre el certificado ya guardado
        try:
            info = sii_client.inspect_pfx(secrets_store.decrypt(pfx_enc), password)
        except sii_client.SiiError as e:
            raise HTTPException(status_code=400, detail=str(e))
        pass_enc = secrets_store.encrypt(password.encode("utf-8"))
    execute_commit("""INSERT INTO sii_config (id, rut, ambiente, pfx_enc, pass_enc, cert_subject, cert_rut, cert_expires, clave_enc, updated_at)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET rut=excluded.rut, ambiente=excluded.ambiente, pfx_enc=excluded.pfx_enc, pass_enc=excluded.pass_enc,
          clave_enc=excluded.clave_enc,
          cert_subject=COALESCE(excluded.cert_subject, sii_config.cert_subject), cert_rut=COALESCE(excluded.cert_rut, sii_config.cert_rut),
          cert_expires=COALESCE(excluded.cert_expires, sii_config.cert_expires), updated_at=CURRENT_TIMESTAMP""",
                   (rut_fmt, ambiente, pfx_enc, pass_enc, info and info["subject"], info and info["cert_rut"], info and info["expires"], clave_enc))
    return {"message": "Configuración SII guardada (datos cifrados)", **_sii_public(_sii_row())}


@router.delete("/sii/config")
def sii_delete_cert():
    execute_commit("UPDATE sii_config SET pfx_enc=NULL, pass_enc=NULL, cert_subject=NULL, cert_rut=NULL, cert_expires=NULL WHERE id=1")
    return {"message": "Certificado eliminado"}


@router.delete("/sii/clave")
def sii_delete_clave():
    execute_commit("UPDATE sii_config SET clave_enc=NULL WHERE id=1")
    return {"message": "Clave Tributaria eliminada"}


def _sii_session() -> sii_client.SiiSession:
    r = _sii_row()
    if not r or not r.get("clave_enc"):
        raise HTTPException(status_code=400, detail="Primero ingrese el RUT y la Clave Tributaria (Clave SII) de la empresa.")
    if r.get("ambiente") != "PRODUCCION":
        raise HTTPException(status_code=400, detail="El Registro de Compras y Ventas sólo existe en ambiente PRODUCCIÓN. Cambie el ambiente.")
    try:
        clave = secrets_store.decrypt(r["clave_enc"]).decode("utf-8")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return sii_client.SiiClaveSession(r["rut"], clave)


@router.post("/sii/test")
def sii_test():
    s = _sii_session()
    try:
        s.login()
        s._warmup()
    except sii_client.SiiError as e:
        execute_commit("UPDATE sii_config SET last_status=? WHERE id=1", (f"Prueba fallida: {e}",))
        raise HTTPException(status_code=502, detail=str(e))
    execute_commit("UPDATE sii_config SET last_status=? WHERE id=1", ("Conexión y sesión RCV con el SII verificadas",))
    return {"message": "Sesión iniciada y verificada en el portal RCV del SII con RUT y Clave Tributaria."}


def _periods(n: int) -> List[str]:
    t, out = date.today(), []
    y, m = t.year, t.month
    for _ in range(max(1, min(n, 12))):
        out.append(f"{y}{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out


def _link_folder(direction: str, counterparty_rut: str) -> Optional[int]:
    """Vincula una venta a la carpeta abierta del mismo cliente si hay una sola coincidencia."""
    if direction != "EMITIDO":
        return None
    rows = query_all("SELECT id FROM business_folders WHERE client_rut = ? AND status NOT IN ('CERRADA','PERDIDA')", (counterparty_rut,))
    return rows[0]["id"] if len(rows) == 1 else None


def _upsert_dte(row: Dict[str, Any], direction: str, company_rut: str, company_name: str, counters: Dict[str, int]):
    cp_rut = formatear_rut(row["rut"])
    if direction == "EMITIDO":
        emisor, emisor_n, recep, recep_n, src = company_rut, company_name, cp_rut, row["name"], "RCV_VENTAS"
    else:
        emisor, emisor_n, recep, recep_n, src = cp_rut, row["name"], company_rut, company_name, "RCV_COMPRAS"
    if query_one("SELECT id FROM dte_documents WHERE dte_type=? AND folio=? AND rut_emisor=?", (row["dte_type"], row["folio"], emisor)):
        counters["existentes"] += 1
        return
    folder_id = _link_folder(direction, cp_rut)
    execute_insert("""INSERT INTO dte_documents (dte_type, folio, rut_emisor, razon_social_emisor, rut_receptor, razon_social_receptor,
        emission_date, expiration_date, net_amount, exempt_amount, iva_amount, total_amount, direction, status_sii, folder_id, source)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'ACEPTADO',?,?)""",
                   (row["dte_type"], row["folio"], emisor, emisor_n, recep, recep_n, row["date"], row["date"], row["net"], row["exempt"],
                    row["iva"], row["total"], direction, folder_id, src))
    counters["nuevos_" + ("ventas" if direction == "EMITIDO" else "compras")] += 1
    if folder_id:
        counters["vinculados"] += 1


def _run_sii_sync(job_id: str, months: int):
    job = _JOBS[job_id]
    try:
        r = _sii_row()
        s = _sii_session()
        company = query_one("SELECT * FROM companies WHERE id = ?", (active_company_id(),)) or {}
        company_rut, company_name = r["rut"], company.get("razon_social") or "Empresa"
        job.update(status="CONECTANDO", message="Autenticando en el SII con la Clave Tributaria…")
        s.login()
        periods = _periods(months)
        steps = [(op, per, t) for per in periods for op in ("VENTA", "COMPRA") for t in sii_client.DOC_TYPES]
        job["total"] = len(steps)
        job.update(status="DESCARGANDO", message="Descargando Registro de Compras y Ventas…")
        consecutive_errors = 0
        for op, per, t in steps:
            try:
                for raw in s.detail(op, per, t):
                    n = sii_client.normalize_row(raw, default_dte_type=t)
                    if n:
                        _upsert_dte(n, "EMITIDO" if op == "VENTA" else "RECIBIDO", company_rut, company_name, job["counters"])
                consecutive_errors = 0
            except sii_client.SiiError as e:
                job["errors"].append(f"{op} {per} tipo {t}: {e}")
                consecutive_errors += 1
                if "sesión" in str(e).lower() or consecutive_errors >= 3:
                    break
            job["done"] += 1
        c = job["counters"]
        if job["errors"] and (c["nuevos_ventas"] + c["nuevos_compras"] + c["existentes"]) == 0:
            # Ningún documento se leyó y el SII respondió con errores: se informa el motivo real, no un "éxito" vacío
            uniq = []
            for m in job["errors"]:
                tail = m.split(": ", 1)[-1]
                if tail not in uniq:
                    uniq.append(tail)
            raise sii_client.SiiError(f"El SII no entregó documentos ({len(job['errors'])} consultas con error). Motivo(s): " + " | ".join(uniq[:3]))
        summary = f"RCV sincronizado: {c['nuevos_ventas']} ventas y {c['nuevos_compras']} compras nuevas, {c['vinculados']} vinculadas a carpetas."
        execute_commit("UPDATE sii_config SET last_sync=?, last_status=? WHERE id=1", (_now(), summary))
        job.update(status="LISTO", message=summary)
    except HTTPException as e:
        job.update(status="ERROR", message=str(e.detail))
    except sii_client.SiiError as e:
        execute_commit("UPDATE sii_config SET last_status=? WHERE id=1", (f"Error: {e}",))
        job.update(status="ERROR", message=str(e))
    except Exception as e:
        job.update(status="ERROR", message=f"Error inesperado: {e}")


class SyncModel(BaseModel):
    months: int = 2


@router.post("/sii/sync")
def sii_sync(d: SyncModel):
    _sii_session()  # valida configuración antes de lanzar el trabajo
    job_id = uuid.uuid4().hex[:10]
    _JOBS[job_id] = {"job_id": job_id, "status": "PENDIENTE", "message": "En cola", "total": 0, "done": 0, "errors": [],
                     "counters": {"nuevos_ventas": 0, "nuevos_compras": 0, "existentes": 0, "vinculados": 0}}
    ctx = contextvars.copy_context()
    threading.Thread(target=ctx.run, args=(_run_sii_sync, job_id, d.months), daemon=True).start()
    return {"job_id": job_id}


@router.get("/job/{job_id}")
def job_status(job_id: str):
    j = _JOBS.get(job_id)
    if not j:
        raise HTTPException(status_code=404, detail="Trabajo no encontrado")
    return {**j, "errors": j["errors"][:25]}


@router.post("/rcv/import")
async def rcv_import_file(file: UploadFile = File(...), operation: Optional[str] = Form(None), period: Optional[str] = Form(None)):
    """Importa el archivo oficial del RCV (CSV/Excel de 'Descargar Detalles' o 'Descargar Resumen')."""
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="El archivo está vacío")
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="El archivo supera 25 MB")
    op = (operation or "").upper() if (operation or "").upper() in ("COMPRA", "VENTA") else None
    try:
        parsed = rcv_import.parse_rcv(file.filename or "", data, op)
    except rcv_import.RcvFileError as e:
        raise HTTPException(status_code=400, detail=str(e))
    op = parsed["operation"]
    if op not in ("COMPRA", "VENTA"):
        raise HTTPException(status_code=400, detail="No se pudo determinar si el archivo es de COMPRAS o de VENTAS. Indíquelo en el selector.")
    direction = "EMITIDO" if op == "VENTA" else "RECIBIDO"
    rows = parsed["rows"]
    if parsed["kind"] == "RESUMEN":
        per = re.sub(r"\D", "", period or "") or rcv_import.detect_period(file.filename or "")
        if not per or len(per) != 6:
            raise HTTPException(status_code=400, detail="El resumen no trae el período. Indíquelo (AAAA-MM) en el selector de período.")
        execute_commit("DELETE FROM rcv_summary WHERE period=? AND direction=?", (per, direction))
        for r in rows:
            execute_insert("INSERT INTO rcv_summary (period, direction, dte_type, doc_count, exempt_amount, net_amount, iva_amount, total_amount) VALUES (?,?,?,?,?,?,?,?)",
                           (per, direction, r["dte_type"], r["count"], r["exempt"], r["net"], r["iva"], r["total"]))
        return {"kind": "RESUMEN", "operation": op, "period": per, "documents": sum(r["count"] for r in rows),
                "net": sum(r["net"] for r in rows), "iva": sum(r["iva"] for r in rows), "total": sum(r["total"] for r in rows),
                "message": f"Resumen RCV de {op.lower()}s {per[:4]}-{per[4:]} cargado (totales por tipo de documento; no incluye folios, solo alimenta el F29). "
                           "Para ver cada factura importe el archivo de Detalle."}
    r0 = _sii_row()
    company = query_one("SELECT * FROM companies WHERE id = ?", (active_company_id(),)) or {}
    company_rut = formatear_rut((r0 or {}).get("rut") or company.get("rut") or "")
    company_name = company.get("razon_social") or "Empresa"
    if not company_rut:
        raise HTTPException(status_code=400, detail="Configure primero el RUT de la empresa.")
    counters = {"nuevos_ventas": 0, "nuevos_compras": 0, "existentes": 0, "vinculados": 0}
    months: Dict[str, int] = {}
    for r in rows:
        _upsert_dte(r, direction, company_rut, company_name, counters)
        months[r["date"][:7]] = months.get(r["date"][:7], 0) + 1
    new = counters["nuevos_ventas"] + counters["nuevos_compras"]
    per = max(months, key=months.get).replace("-", "") if months else ""
    msg = f"Detalle de {op.lower()}s importado: {new} documento(s) nuevo(s), {counters['existentes']} ya existían"
    if parsed.get("skipped"):
        msg += f", {parsed['skipped']} fila(s) ignoradas por formato"
    execute_commit("UPDATE sii_config SET last_status=? WHERE id=1", (msg + " (archivo RCV)",))
    return {"kind": "DETALLE", "operation": op, "period": per, "documents": len(rows), "nuevos": new, "existentes": counters["existentes"],
            "net": sum(r["net"] for r in rows), "iva": sum(r["iva"] for r in rows), "total": sum(r["total"] for r in rows), "message": msg + "."}


# =============================================================== BANCO (Fintoc)
def _bank_row() -> Optional[Dict[str, Any]]:
    return query_one("SELECT * FROM bank_connections WHERE id = 1")


def _mode(r: Optional[Dict[str, Any]]) -> str:
    return "TEST" if (r or {}).get("mode") == "TEST" else "LIVE"


# columnas (secreto, pública, link) y variables de entorno / .env de cada modo
_COLS = {"LIVE": ("secret_enc", "public_key", "link_token_enc"), "TEST": ("secret_test_enc", "public_key_test", "link_token_test_enc")}
_ENV = {"LIVE": ("FINTOC_SECRET_KEY", "FINTOC_API_KEY"), "TEST": ("FINTOC_SECRET_KEY_TEST", "FINTOC_API_KEY_TEST")}


def _mode_info(r: Dict[str, Any], mode: str) -> Dict[str, Any]:
    sc, pc, lc = _COLS[mode]
    senv, penv = _ENV[mode]
    env_secret = bool(os.environ.get(senv))
    return {"has_secret": bool(r.get(sc)) or env_secret, "from_env": env_secret and not r.get(sc),
            "public_key": r.get(pc) or os.environ.get(penv, "").strip(), "has_link": bool(r.get(lc))}


def _status_for(info: Dict[str, Any]) -> str:
    return "CONECTADO" if (info["has_secret"] and info["has_link"]) else ("PENDIENTE_VINCULO" if info["has_secret"] else "SIN_CONECTAR")


def _bank_public(r: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    accounts = query_all("SELECT id, bank_name, account_number, account_type, balance, currency FROM bank_accounts WHERE provider = 'FINTOC'")
    r = r or {}
    mode = _mode(r)
    live, test = _mode_info(r, "LIVE"), _mode_info(r, "TEST")
    cur = live if mode == "LIVE" else test
    status = "ERROR" if (r.get("status") == "ERROR" and cur["has_link"]) else _status_for(cur)
    return {"provider": "FINTOC", "mode": mode, "status": status, "public_key": cur["public_key"], "has_secret": cur["has_secret"],
            "has_link": cur["has_link"], "institution": r.get("institution"), "last_sync": r.get("last_sync"),
            "last_message": r.get("last_message"), "live": live, "test": test, "accounts": accounts}


@router.get("/bank/config")
def bank_get_config():
    return _bank_public(_bank_row())


class BankConfigModel(BaseModel):
    mode: Optional[str] = None            # LIVE | TEST (modo activo)
    secret_key: Optional[str] = None      # LIVE
    public_key: Optional[str] = None
    link_token: Optional[str] = None
    secret_key_test: Optional[str] = None  # TEST
    public_key_test: Optional[str] = None
    link_token_test: Optional[str] = None


def _check_prefix(v: Optional[str], prefix: str, label: str):
    if v and v.strip() and not v.strip().startswith(prefix):
        raise HTTPException(status_code=400, detail=f"{label} debe comenzar con {prefix}")


@router.post("/bank/config")
def bank_save_config(d: BankConfigModel):
    cur = _bank_row() or {}
    mode = (d.mode or _mode(cur)).strip().upper()
    if mode not in ("LIVE", "TEST"):
        raise HTTPException(status_code=400, detail="Modo inválido (LIVE o TEST)")
    _check_prefix(d.secret_key, "sk_live_", "La clave secreta LIVE")
    _check_prefix(d.public_key, "pk_live_", "La clave pública LIVE")
    _check_prefix(d.secret_key_test, "sk_test_", "La clave secreta TEST")
    _check_prefix(d.public_key_test, "pk_test_", "La clave pública TEST")

    def enc(v, old):
        return secrets_store.encrypt(v.strip().encode()) if v and v.strip() else old

    def pub(v, old):
        return v.strip() if v is not None else old

    execute_commit("INSERT OR IGNORE INTO bank_connections (id, provider) VALUES (1, 'FINTOC')")
    execute_commit("""UPDATE bank_connections SET mode=?, secret_enc=?, public_key=?, link_token_enc=?,
        secret_test_enc=?, public_key_test=?, link_token_test_enc=?, updated_at=CURRENT_TIMESTAMP WHERE id=1""",
                   (mode, enc(d.secret_key, cur.get("secret_enc")), pub(d.public_key, cur.get("public_key")), enc(d.link_token, cur.get("link_token_enc")),
                    enc(d.secret_key_test, cur.get("secret_test_enc")), pub(d.public_key_test, cur.get("public_key_test")),
                    enc(d.link_token_test, cur.get("link_token_test_enc"))))
    row = _bank_row()
    execute_commit("UPDATE bank_connections SET status=? WHERE id=1", (_status_for(_mode_info(row, _mode(row))),))
    return {"message": f"Credenciales bancarias guardadas (cifradas). Modo activo: {mode}", **_bank_public(_bank_row())}


def _fintoc() -> bank_client.Fintoc:
    r = _bank_row() or {}
    mode = _mode(r)
    sc, _pc, lc = _COLS[mode]
    try:
        secret = secrets_store.decrypt(r.get(sc))
        secret = secret.decode() if secret else os.environ.get(_ENV[mode][0], "").strip()
        link = secrets_store.decrypt(r.get(lc))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not secret:
        raise HTTPException(status_code=400, detail=f"Primero ingrese la clave secreta de Fintoc (modo {mode}).")
    return bank_client.Fintoc(secret, link.decode() if link else "")


class ExchangeModel(BaseModel):
    exchange_token: str


@router.post("/bank/exchange")
def bank_exchange(d: ExchangeModel):
    """Canjea el exchange_token del widget de Fintoc por el link_token de la cuenta de la empresa."""
    f = _fintoc()
    try:
        link = f.exchange(d.exchange_token.strip())
    except bank_client.BankError as e:
        raise HTTPException(status_code=502, detail=str(e))
    inst = (link.get("institution") or {}).get("name") if isinstance(link.get("institution"), dict) else link.get("institution")
    col = _COLS[_mode(_bank_row())][2]
    execute_commit(f"UPDATE bank_connections SET {col}=?, institution=?, status='CONECTADO' WHERE id=1",
                   (secrets_store.encrypt(f.link.encode()), inst))
    return {"message": f"Banco conectado{(': ' + inst) if inst else ''}", **_bank_public(_bank_row())}


@router.delete("/bank/config")
def bank_disconnect():
    col = _COLS[_mode(_bank_row())][2]
    execute_commit(f"UPDATE bank_connections SET {col}=NULL, institution=NULL, status='SIN_CONECTAR' WHERE id=1")
    return {"message": "Cuenta bancaria desvinculada (claves y movimientos ya descargados se conservan)"}


def auto_reconcile(min_confidence: int = AUTO_CONFIDENCE) -> int:
    n = 0
    used_dtes = set()
    for sug in find_reconciliation_matches():
        if sug["confidence"] >= min_confidence and sug["dte"]["id"] not in used_dtes:
            if reconcile_transaction(sug["transaction"]["id"], sug["dte"]["id"]):
                used_dtes.add(sug["dte"]["id"])
                n += 1
    return n


class BankSyncModel(BaseModel):
    days: int = 90


@router.post("/bank/sync")
def bank_sync(d: BankSyncModel):
    f = _fintoc()
    if not f.link:
        raise HTTPException(status_code=400, detail="Aún no hay una cuenta vinculada. Conecte el banco con el widget de Fintoc o pegue el link_token.")
    if _mode(_bank_row()) == "TEST":
        # En modo TEST se verifica la lectura pero NO se guardan datos (evita mezclar movimientos de prueba con los reales).
        try:
            accs = f.accounts()
            n_mov = sum(len(f.movements(a["id"])) for a in accs[:5])
        except bank_client.BankError as e:
            execute_commit("UPDATE bank_connections SET last_message=?, status='ERROR' WHERE id=1", (str(e),))
            raise HTTPException(status_code=502, detail=str(e))
        msg = f"MODO TEST: lectura correcta, {len(accs)} cuenta(s) y {n_mov} movimiento(s) de prueba (no se guardan). Cambie a LIVE para importar datos reales."
        execute_commit("UPDATE bank_connections SET last_sync=?, last_message=?, status='CONECTADO' WHERE id=1", (_now(), msg))
        return {"message": msg, "new_transactions": 0, "reconciled": 0}
    since = (date.today().fromordinal(date.today().toordinal() - max(1, min(d.days, 730)))).isoformat()
    conn = _bank_row() or {}
    new_tx = upd_acc = 0
    try:
        accounts = f.accounts()
        for acc in accounts:
            ext = f"fintoc:{acc['id']}"
            balance = ((acc.get("balance") or {}).get("current")) or 0
            row = query_one("SELECT id FROM bank_accounts WHERE external_id = ?", (ext,))
            bank_name = conn.get("institution") or acc.get("official_name") or acc.get("name") or "Banco"
            if row:
                execute_commit("UPDATE bank_accounts SET balance=?, bank_name=? WHERE id=?", (balance, bank_name, row["id"]))
                acc_id = row["id"]
            else:
                acc_id = execute_insert("""INSERT INTO bank_accounts (bank_name, account_number, account_type, company_id, currency, balance, external_id, provider)
                    VALUES (?,?,?,?,?,?,?,'FINTOC')""",
                                        (bank_name, acc.get("number") or acc["id"], acc.get("name") or "Cuenta Corriente",
                                         active_company_id(), acc.get("currency") or "CLP", balance, ext))
            upd_acc += 1
            for m in f.movements(acc["id"], since):
                mext = f"fintoc:{m['id']}"
                if query_one("SELECT id FROM bank_transactions WHERE external_id = ?", (mext,)):
                    continue
                amount = float(m.get("amount") or 0)
                party = m.get("sender_account") if amount > 0 else m.get("recipient_account")
                party = party or {}
                desc = " | ".join(x for x in [m.get("description"), party.get("holder_name"), party.get("holder_id"), m.get("comment")] if x) or "Movimiento"
                execute_insert("""INSERT INTO bank_transactions (account_id, transaction_date, description, amount, transaction_type, notes, external_id)
                    VALUES (?,?,?,?,?,?,?)""",
                               (acc_id, (m.get("post_date") or m.get("transaction_date") or "")[:10], desc[:300], abs(amount),
                                "ABONO" if amount > 0 else "CARGO", f"Fintoc · {m.get('type') or ''}", mext))
                new_tx += 1
    except bank_client.BankError as e:
        execute_commit("UPDATE bank_connections SET last_message=?, status='ERROR' WHERE id=1", (str(e),))
        raise HTTPException(status_code=502, detail=str(e))
    matched = auto_reconcile()
    msg = f"{upd_acc} cuenta(s), {new_tx} movimiento(s) nuevo(s), {matched} conciliado(s) automáticamente con facturas."
    execute_commit("UPDATE bank_connections SET last_sync=?, last_message=?, status='CONECTADO' WHERE id=1", (_now(), msg))
    return {"message": msg, "new_transactions": new_tx, "reconciled": matched}


@router.post("/bank/auto-reconcile")
def bank_auto_reconcile():
    n = auto_reconcile()
    return {"message": f"{n} movimiento(s) conciliado(s) automáticamente", "reconciled": n}


@router.get("/bank/summary")
def bank_summary():
    """Saldos pendientes al instante: lo que falta cobrar/pagar según facturas no conciliadas con el banco."""
    cxc = query_one("SELECT COUNT(*) n, COALESCE(SUM(total_amount-COALESCE(paid_amount,0)),0) t FROM dte_documents WHERE direction='EMITIDO' AND is_reconciled=0 AND dte_type IN (33,34,56)")
    cxp = query_one("SELECT COUNT(*) n, COALESCE(SUM(total_amount-COALESCE(paid_amount,0)),0) t FROM dte_documents WHERE direction='RECIBIDO' AND is_reconciled=0 AND dte_type IN (33,34,46,56)")
    tx = query_one("SELECT COUNT(*) n FROM bank_transactions WHERE is_reconciled=0")
    sug = len(find_reconciliation_matches())
    return {"cxc_count": cxc["n"], "cxc_total": cxc["t"], "cxp_count": cxp["n"], "cxp_total": cxp["t"],
            "unreconciled_tx": tx["n"], "suggestions": sug}
