"""Configuración de correo por empresa y envío directo de cotizaciones / órdenes de compra."""
import os
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.database import query_one, execute_commit
from app.services import mailer_service, secrets_store

router = APIRouter(prefix="/api/email", tags=["Correo"])

_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PROVIDERS = ("SMTP", "RESEND", "SENDGRID")


class EmailConfigModel(BaseModel):
    provider: str = "SMTP"
    host: str = ""
    port: int = 587
    security: str = "STARTTLS"
    username: str = ""
    password: Optional[str] = None
    api_key: Optional[str] = None
    from_email: str = ""
    from_name: str = ""
    reply_to: str = ""


class TestModel(BaseModel):
    to: str


class SendModel(BaseModel):
    to: str
    cc: str = ""
    subject: str
    body: str
    attach_type: Optional[str] = None   # quotation | commdoc
    attach_id: Optional[int] = None


def _row() -> Optional[Dict[str, Any]]:
    return query_one("SELECT * FROM email_config WHERE id = 1")


def _is_configured(r: Optional[Dict[str, Any]]) -> bool:
    if not r or not r.get("from_email"):
        return False
    if (r.get("provider") or "SMTP") == "SMTP":
        return bool(r.get("host"))
    return bool(r.get("api_key_enc"))


def _public(r: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    r = r or {}
    return {"provider": r.get("provider") or "SMTP", "host": r.get("host") or "", "port": r.get("port") or 587,
            "security": r.get("security") or "STARTTLS", "username": r.get("username") or "",
            "has_password": bool(r.get("pass_enc")), "has_api_key": bool(r.get("api_key_enc")),
            "from_email": r.get("from_email") or "", "from_name": r.get("from_name") or "",
            "reply_to": r.get("reply_to") or "", "last_status": r.get("last_status") or "",
            "configured": _is_configured(r)}


def _cfg() -> Dict[str, Any]:
    r = _row()
    if not _is_configured(r):
        raise HTTPException(status_code=400, detail="Primero configure el correo de salida (Multi-Empresa & Config → Correo).")
    try:
        pw = secrets_store.decrypt(r.get("pass_enc"))
        key = secrets_store.decrypt(r.get("api_key_enc"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {**r, "password": pw.decode() if pw else "", "api_key": key.decode() if key else ""}


def _emails(txt: str, label: str) -> List[str]:
    out = [e.strip() for e in re.split(r"[,;\s]+", txt or "") if e.strip()]
    bad = [e for e in out if not _RE.match(e)]
    if bad:
        raise HTTPException(status_code=400, detail=f"{label} inválido: {', '.join(bad)}")
    return out


@router.get("/config")
def get_config():
    return _public(_row())


@router.post("/config")
def save_config(d: EmailConfigModel):
    prov = d.provider.strip().upper()
    if prov not in PROVIDERS:
        raise HTTPException(status_code=400, detail="Proveedor inválido (SMTP, RESEND o SENDGRID)")
    sec = d.security.strip().upper()
    if sec not in ("STARTTLS", "SSL", "NONE"):
        raise HTTPException(status_code=400, detail="Seguridad inválida")
    if not _RE.match(d.from_email.strip()):
        raise HTTPException(status_code=400, detail="El correo remitente no es válido")
    if d.reply_to.strip() and not _RE.match(d.reply_to.strip()):
        raise HTTPException(status_code=400, detail="El correo de respuesta no es válido")
    cur = _row() or {}
    pw = secrets_store.encrypt(d.password.encode()) if d.password else cur.get("pass_enc")
    key = secrets_store.encrypt(d.api_key.strip().encode()) if d.api_key and d.api_key.strip() else cur.get("api_key_enc")
    if prov == "SMTP" and not d.host.strip():
        raise HTTPException(status_code=400, detail="Indique el servidor SMTP")
    if prov != "SMTP" and not key:
        raise HTTPException(status_code=400, detail="Indique la API key del proveedor")
    execute_commit("""INSERT INTO email_config (id, provider, host, port, security, username, pass_enc, api_key_enc, from_email, from_name, reply_to, updated_at)
        VALUES (1,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET provider=excluded.provider, host=excluded.host, port=excluded.port, security=excluded.security,
          username=excluded.username, pass_enc=excluded.pass_enc, api_key_enc=excluded.api_key_enc, from_email=excluded.from_email,
          from_name=excluded.from_name, reply_to=excluded.reply_to, updated_at=CURRENT_TIMESTAMP""",
                   (prov, d.host.strip(), d.port, sec, d.username.strip(), pw, key, d.from_email.strip(), d.from_name.strip(), d.reply_to.strip()))
    return {"message": "Configuración de correo guardada (secretos cifrados)", **_public(_row())}


@router.post("/test")
def test_send(d: TestModel):
    cfg = _cfg()
    to = _emails(d.to, "Destinatario")
    if not to:
        raise HTTPException(status_code=400, detail="Indique un destinatario de prueba")
    try:
        msg = mailer_service.send(cfg, to, [], "Prueba de correo - ERP Comercial",
                                  "Este es un correo de prueba enviado desde tu ERP. Si lo recibes, el envío directo funciona.", [])
    except mailer_service.MailError as e:
        execute_commit("UPDATE email_config SET last_status=? WHERE id=1", (f"Prueba fallida: {e}",))
        raise HTTPException(status_code=502, detail=str(e))
    execute_commit("UPDATE email_config SET last_status=? WHERE id=1", (msg,))
    return {"message": msg}


def _attachment(kind: Optional[str], ref: Optional[int]):
    if not kind or not ref:
        return None
    if kind == "quotation":
        from app.services import folder_documents_export as exporter
        path = exporter.quotation_pdf(ref)
        with open(path, "rb") as f:
            return (os.path.basename(path), f.read(), "application/pdf")
    if kind == "commdoc":
        from app.routers import commercial_docs as cd
        doc = cd.get_doc(ref)
        return (f"{doc['folio']}.pdf", cd._pdf(doc), "application/pdf")
    raise HTTPException(status_code=400, detail="Tipo de adjunto inválido")


@router.post("/send")
def send_mail(d: SendModel, request: Request):
    cfg = _cfg()
    to, cc = _emails(d.to, "Destinatario"), _emails(d.cc, "Copia")
    if not to:
        raise HTTPException(status_code=400, detail="Indique al menos un destinatario")
    att = _attachment(d.attach_type, d.attach_id)
    try:
        msg = mailer_service.send(cfg, to, cc, d.subject.strip() or "(sin asunto)", d.body, [att] if att else [])
    except mailer_service.MailError as e:
        raise HTTPException(status_code=502, detail=str(e))
    if d.attach_type == "quotation":
        from app.routers import pipeline
        pipeline.mark_sent(d.attach_id, {"via": "correo (envío directo)", "to": ", ".join(to)}, request)
    elif d.attach_type == "commdoc":
        execute_commit("UPDATE commercial_docs SET status='ENVIADA' WHERE id=? AND status='EMITIDA'", (d.attach_id,))
    return {"message": msg}
