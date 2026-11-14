"""Envío directo de correo: SMTP, Resend o SendGrid (con adjuntos)."""
import base64
import smtplib
import socket
import ssl
from email.message import EmailMessage
from email.utils import formataddr
from typing import Any, Dict, List, Tuple

import requests


class MailError(Exception):
    pass


Attachment = Tuple[str, bytes, str]  # (nombre, contenido, mime)


def send(cfg: Dict[str, Any], to: List[str], cc: List[str], subject: str, body: str,
         attachments: List[Attachment]) -> str:
    """Envía el correo con la configuración dada (secretos ya descifrados). Devuelve un texto de confirmación."""
    prov = (cfg.get("provider") or "SMTP").upper()
    if prov == "SMTP":
        _smtp(cfg, to, cc, subject, body, attachments)
    elif prov == "RESEND":
        _resend(cfg, to, cc, subject, body, attachments)
    elif prov == "SENDGRID":
        _sendgrid(cfg, to, cc, subject, body, attachments)
    else:
        raise MailError("Proveedor de correo inválido")
    return f"Correo enviado a {', '.join(to)} vía {prov}"


def _smtp(cfg, to, cc, subject, body, attachments):
    host, port = (cfg.get("host") or "").strip(), int(cfg.get("port") or 587)
    if not host:
        raise MailError("Falta el servidor SMTP")
    msg = EmailMessage()
    msg["From"] = formataddr((cfg.get("from_name") or "", cfg["from_email"]))
    msg["To"] = ", ".join(to)
    if cc:
        msg["Cc"] = ", ".join(cc)
    if cfg.get("reply_to"):
        msg["Reply-To"] = cfg["reply_to"]
    msg["Subject"] = subject
    msg.set_content(body)
    for name, data, mime in attachments:
        main, sub = (mime.split("/", 1) + ["octet-stream"])[:2]
        msg.add_attachment(data, maintype=main, subtype=sub, filename=name)
    sec = (cfg.get("security") or "STARTTLS").upper()
    ctx = ssl.create_default_context()
    try:
        if sec == "SSL":
            srv = smtplib.SMTP_SSL(host, port, timeout=30, context=ctx)
        else:
            srv = smtplib.SMTP(host, port, timeout=30)
        with srv:
            srv.ehlo()
            if sec == "STARTTLS":
                srv.starttls(context=ctx)
                srv.ehlo()
            if cfg.get("username"):
                srv.login(cfg["username"], cfg.get("password") or "")
            srv.send_message(msg, to_addrs=to + cc)
    except smtplib.SMTPAuthenticationError:
        raise MailError("El servidor rechazó el usuario/contraseña (SMTP 535). Con Gmail/Outlook/Office365 debes usar una "
                        "«contraseña de aplicación», no la clave normal.")
    except smtplib.SMTPRecipientsRefused as e:
        raise MailError(f"El servidor rechazó a los destinatarios: {e}")
    except smtplib.SMTPSenderRefused as e:
        raise MailError(f"El servidor rechazó el remitente {cfg['from_email']}: {e.smtp_error!r}")
    except (socket.gaierror, ConnectionRefusedError, TimeoutError, socket.timeout, OSError) as e:
        raise MailError(f"No se pudo conectar a {host}:{port} ({sec}): {e}. Revisa servidor, puerto y tipo de seguridad "
                        f"(587 = STARTTLS, 465 = SSL).")
    except smtplib.SMTPException as e:
        raise MailError(f"Error SMTP: {e}")


def _from(cfg):
    return formataddr((cfg.get("from_name") or "", cfg["from_email"]))


def _resend(cfg, to, cc, subject, body, attachments):
    key = cfg.get("api_key")
    if not key:
        raise MailError("Falta la API key de Resend")
    payload: Dict[str, Any] = {"from": _from(cfg), "to": to, "subject": subject, "text": body}
    if cc:
        payload["cc"] = cc
    if cfg.get("reply_to"):
        payload["reply_to"] = cfg["reply_to"]
    if attachments:
        payload["attachments"] = [{"filename": n, "content": base64.b64encode(d).decode()} for n, d, _ in attachments]
    try:
        r = requests.post("https://api.resend.com/emails", json=payload, headers={"Authorization": f"Bearer {key}"}, timeout=40)
    except requests.exceptions.RequestException as e:
        raise MailError(f"No se pudo contactar a Resend: {str(e)[:160]}")
    if r.status_code >= 400:
        raise MailError(f"Resend ({r.status_code}): {r.text[:300]}")


def _sendgrid(cfg, to, cc, subject, body, attachments):
    key = cfg.get("api_key")
    if not key:
        raise MailError("Falta la API key de SendGrid")
    pers: Dict[str, Any] = {"to": [{"email": e} for e in to]}
    if cc:
        pers["cc"] = [{"email": e} for e in cc]
    payload: Dict[str, Any] = {"personalizations": [pers], "from": {"email": cfg["from_email"], "name": cfg.get("from_name") or ""},
                               "subject": subject, "content": [{"type": "text/plain", "value": body}]}
    if cfg.get("reply_to"):
        payload["reply_to"] = {"email": cfg["reply_to"]}
    if attachments:
        payload["attachments"] = [{"content": base64.b64encode(d).decode(), "filename": n, "type": m, "disposition": "attachment"}
                                  for n, d, m in attachments]
    try:
        r = requests.post("https://api.sendgrid.com/v3/mail/send", json=payload, headers={"Authorization": f"Bearer {key}"}, timeout=40)
    except requests.exceptions.RequestException as e:
        raise MailError(f"No se pudo contactar a SendGrid: {str(e)[:160]}")
    if r.status_code >= 400:
        raise MailError(f"SendGrid ({r.status_code}): {r.text[:300]}")
