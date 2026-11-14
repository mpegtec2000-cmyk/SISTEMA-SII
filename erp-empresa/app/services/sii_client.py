"""Cliente del SII con certificado digital o Clave Tributaria: autenticación y consulta del RCV.

Flujo de sesión para el Registro de Compras y Ventas (RCV):
1. Login formal contra zeusr.sii.cl (Clave Tributaria) o herculesr.sii.cl (Certificado digital).
2. Captura y propagación de cookies de sesión (TOKEN y asociadas) a dominios .sii.cl y www4.sii.cl.
3. Warmup navegando a https://www4.sii.cl/consdcvinternetui/ para inicializar la sesión en el servidor del RCV.
4. Llamadas al FacadeService con cabeceras de navegador realistas (User-Agent, Referer, Accept, Cookie).
5. Captura y volcado completo de respuestas HTTP 500 y errores raw para diagnóstico exacto en data/sii_last_response.log.
"""
import logging
import os
import re
import tempfile
import time
import uuid
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import requests

LOGIN_URL = "https://herculesr.sii.cl/cgi_AUT2000/CAutInicio.cgi?https://misiir.sii.cl/cgi_misii/siihome.cgi"
CLAVE_LOGIN_URL = "https://zeusr.sii.cl/cgi_AUT2000/CAutInicio.cgi"
RCV_PAGE = "https://www4.sii.cl/consdcvinternetui/"
RCV_BASE = "https://www4.sii.cl/consdcvinternetui/services/data/facadeService/"
LOG_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "sii_last_response.log")

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
DOC_TYPES = [33, 34, 46, 56, 61]  # factura electrónica, exenta, factura compra, nota débito, nota crédito
log = logging.getLogger("sii")


class SiiError(Exception):
    pass


def split_rut(rut: str) -> Tuple[str, str]:
    r = re.sub(r"[^0-9kK]", "", rut or "").upper()
    if len(r) < 2:
        raise SiiError("RUT inválido")
    return r[:-1], r[-1]


def inspect_pfx(data: bytes, password: str) -> Dict[str, Any]:
    """Valida el certificado y devuelve datos informativos (no guarda nada)."""
    from cryptography.hazmat.primitives.serialization import pkcs12
    from cryptography.x509.oid import NameOID
    try:
        key, cert, _ = pkcs12.load_key_and_certificates(data, password.encode("utf-8"))
    except Exception as e:
        msg = str(e)
        if "password" in msg.lower() or "mac" in msg.lower():
            raise SiiError("La contraseña del certificado es incorrecta.")
        raise SiiError(f"No se pudo leer el certificado: {msg}. Si es un .pfx antiguo, vuelva a exportarlo con cifrado moderno (AES-256).")
    if key is None or cert is None:
        raise SiiError("El archivo no contiene clave privada y certificado.")
    subj = cert.subject
    cn = next((a.value for a in subj.get_attributes_for_oid(NameOID.COMMON_NAME)), "")
    serial = next((a.value for a in subj.get_attributes_for_oid(NameOID.SERIAL_NUMBER)), "")
    exp = getattr(cert, "not_valid_after_utc", None) or cert.not_valid_after
    return {"subject": cn, "cert_rut": serial, "expires": exp.strftime("%Y-%m-%d"), "expired": exp.replace(tzinfo=None) < datetime.utcnow()}


@contextmanager
def _pem_files(pfx: bytes, password: str):
    """requests necesita archivos PEM: se crean temporales y se eliminan siempre."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.serialization import pkcs12
    key, cert, _ = pkcs12.load_key_and_certificates(pfx, password.encode("utf-8"))
    d = tempfile.mkdtemp(prefix="sii_")
    cpath, kpath = os.path.join(d, "c.pem"), os.path.join(d, "k.pem")
    try:
        with open(cpath, "wb") as f:
            f.write(cert.public_bytes(serialization.Encoding.PEM))
        with open(kpath, "wb") as f:
            f.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL,
                                      serialization.NoEncryption()))
        yield cpath, kpath
    finally:
        for pth in (cpath, kpath):
            try:
                os.remove(pth)
            except Exception:
                pass
        try:
            os.rmdir(d)
        except Exception:
            pass


class SiiSession:
    def __init__(self, pfx: bytes, password: str, rut: str):
        self.pfx, self.password = pfx, password
        self.rut, self.dv = split_rut(rut)
        self.http = requests.Session()
        self.http.headers.update({"User-Agent": UA})
        self.token: Optional[str] = None
        self._warm = False

    def _propagate_cookies(self) -> None:
        """Asegura que todas las cookies de sesión (TOKEN, etc.) estén disponibles para .sii.cl y www4.sii.cl."""
        for c in list(self.http.cookies):
            for dom in [".sii.cl", "www4.sii.cl"]:
                self.http.cookies.set(c.name, c.value, domain=dom, path="/")

    def login(self) -> None:
        with _pem_files(self.pfx, self.password) as cert:
            try:
                r = self.http.get(LOGIN_URL, cert=cert, timeout=40, allow_redirects=True)
            except requests.exceptions.SSLError as e:
                raise SiiError(f"El SII rechazó el certificado (SSL): {str(e)[:160]}")
            except requests.exceptions.RequestException as e:
                raise SiiError(f"No se pudo contactar al SII: {str(e)[:160]}")
        self.token = self.http.cookies.get("TOKEN")
        if not self.token:
            raise SiiError("El SII no inició la sesión con este certificado (sin cookie TOKEN). Verifique que el certificado esté vigente "
                           f"y sea de un usuario autorizado para la empresa. Respuesta HTTP {r.status_code}.")
        self._propagate_cookies()

    def _browser_headers(self, json_body: bool = True) -> Dict[str, str]:
        h = {
            "User-Agent": UA,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
            "Referer": RCV_PAGE,
            "Origin": "https://www4.sii.cl",
            "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
        }
        if json_body:
            h["Content-Type"] = "application/json;charset=UTF-8"

        # Cabecera Cookie explícita para garantizar que TOKEN y las cookies de sesión siempre se transmitan
        cookie_parts = {}
        for c in self.http.cookies:
            cookie_parts[c.name] = c.value
        if self.token and "TOKEN" not in cookie_parts:
            cookie_parts["TOKEN"] = self.token
        if cookie_parts:
            h["Cookie"] = "; ".join(f"{k}={v}" for k, v in cookie_parts.items())
        return h

    def _warmup(self) -> None:
        """Abre la página inicial del RCV con la sesión ya autenticada para que www4.sii.cl genere sus cookies y contexto."""
        if self._warm:
            return
        self._propagate_cookies()
        try:
            warm_headers = {
                "User-Agent": UA,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Referer": "https://misiir.sii.cl/cgi_misii/siihome.cgi",
                "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
            }
            if self.token:
                warm_headers["Cookie"] = f"TOKEN={self.token}"
            r = self.http.get(RCV_PAGE, timeout=40, allow_redirects=True, headers=warm_headers)
            self._dump("GET " + RCV_PAGE, r)
            self._propagate_cookies()
            if "CAutInicio" in r.url or "CAutInicio" in r.text[:800]:
                raise SiiError("El SII pidió volver a autenticarse al abrir el RCV (la sesión no fue aceptada por www4.sii.cl).")
        except requests.exceptions.RequestException as e:
            raise SiiError(f"No se pudo abrir el RCV del SII: {str(e)[:160]}")
        self._warm = True

    @staticmethod
    def _snippet(text: str, n: int = 300) -> str:
        if not text:
            return ""
        t = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", text, flags=re.S | re.I)
        t = re.sub(r"<[^>]+>", " ", t)
        return re.sub(r"\s+", " ", t).strip()[:n]

    def _dump(self, what: str, r) -> None:
        """Guarda la respuesta cruda del SII en consola y en data/sii_last_response.log."""
        try:
            body = (r.text or "")[:8000]
            print(f"[SII LOG] {what} -> HTTP {r.status_code} {r.headers.get('Content-Type')}: {body[:250]}", flush=True)
            log.warning("SII %s -> HTTP %s ct=%s body=%r", what, r.status_code, r.headers.get("Content-Type"), body[:600])
            os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
            with open(LOG_FILE, "a", encoding="utf-8") as f:
                f.write(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {what} -> HTTP {r.status_code} {r.headers.get('Content-Type')}\n{body}\n{'-' * 60}\n")
        except Exception:
            pass

    def _call(self, service: str, data: Dict[str, Any]) -> Dict[str, Any]:
        self._warmup()
        payload = {
            "metaData": {
                "namespace": f"cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/{service}",
                "conversationId": self.token,
                "transactionId": str(uuid.uuid4()),
                "page": None
            },
            "data": data
        }
        headers = self._browser_headers()
        r = None
        for attempt in range(2):  # Reintento ante micro-cortes
            try:
                r = self.http.post(RCV_BASE + service, json=payload, timeout=60, headers=headers)
            except requests.exceptions.RequestException as e:
                raise SiiError(f"Error de red al consultar el RCV ({service}): {str(e)[:160]}")
            if r.status_code < 500:
                break
            self._dump(f"POST {service} (intento {attempt + 1})", r)
            time.sleep(1.5)

        self._dump(f"POST {service}", r)

        if r.status_code == 401 or "CAutInicio" in r.text[:500]:
            raise SiiError("La sesión con el SII expiró o fue rechazada (HTTP 401 o redirección a autenticación).")

        if r.status_code >= 500:
            snippet = self._snippet(r.text, 250) or "Sin cuerpo de error"
            raise SiiError(f"Respuesta de error del SII (HTTP {r.status_code}) en {service}: «{snippet}». "
                           "El detalle raw fue registrado en data/sii_last_response.log")

        try:
            return r.json()
        except Exception:
            snippet = self._snippet(r.text, 250) or "Respuesta no es JSON"
            raise SiiError(f"Respuesta inesperada del SII (HTTP {r.status_code}) en {service}: «{snippet}». "
                           "El detalle raw fue registrado en data/sii_last_response.log")

    def detail(self, operation: str, period: str, doc_type: int) -> List[Dict[str, Any]]:
        """operation: COMPRA | VENTA; period: YYYYMM; doc_type: 33, 34, 46, 56, 61"""
        data = {
            "rutEmisor": self.rut,
            "dvEmisor": self.dv,
            "ptributario": period,
            "codTipoDoc": str(doc_type),
            "operacion": operation,
            "estadoContab": "REGISTRO" if operation == "COMPRA" else ""
        }
        out = self._call("getDetalleCompra" if operation == "COMPRA" else "getDetalleVenta", data)
        resp = out.get("respEstado") or {}
        if resp.get("codRespuesta") not in (None, 0, "0") and not out.get("data"):
            msg = (resp.get("msgeRespuesta") or "").strip()
            if msg:
                low = msg.lower()
                if "no existen" in low or "sin datos" in low or "no hay" in low or "sin registros" in low:
                    return []
                raise SiiError(f"SII: {msg}")
        rows = out.get("data")
        if isinstance(rows, list):
            return rows
        elif isinstance(rows, dict):
            for k in ("detalles", "detalle", "rows", "items"):
                if isinstance(rows.get(k), list):
                    return rows[k]
        return []


def parse_date(s: str) -> str:
    s = (s or "").strip()[:10]
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", s)
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else s


def normalize_row(row: Dict[str, Any], default_dte_type: int = 33) -> Optional[Dict[str, Any]]:
    try:
        t = row.get("detTipoDoc")
        dte_type = int(t) if (t is not None and str(t).strip() != "") else int(default_dte_type)
        return {
            "dte_type": dte_type,
            "folio": int(row.get("detNroDoc")),
            "rut": f"{row.get('detRutDoc')}-{str(row.get('detDvDoc')).upper()}",
            "name": (row.get("detRznSoc") or "").strip() or "Sin razón social",
            "date": parse_date(row.get("detFchDoc") or ""),
            "net": float(row.get("detMntNeto") or 0),
            "exempt": float(row.get("detMntExe") or 0),
            "iva": float(row.get("detMntIVA") or 0),
            "total": float(row.get("detMntTotal") or 0)
        }
    except (TypeError, ValueError):
        return None


class SiiClaveSession(SiiSession):
    """Sesión con RUT + Clave Tributaria (sin certificado digital). Suficiente para consultar el RCV."""

    def __init__(self, rut: str, clave: str, company_rut: Optional[str] = None):
        super().__init__(b"", "", company_rut or rut)
        self.login_rut, self.login_dv = split_rut(rut)
        self.clave = clave

    def login(self) -> None:
        if not self.clave:
            raise SiiError("Falta la Clave Tributaria (Clave SII).")

        login_headers = {
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Referer": "https://zeusr.sii.cl/AUT2000/InPlugInHome.html",
            "Origin": "https://zeusr.sii.cl",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
        }

        # 1. Visita previa para establecer contexto en zeusr
        try:
            self.http.get("https://zeusr.sii.cl/AUT2000/InPlugInHome.html", timeout=30, headers={"User-Agent": UA})
        except Exception as e:
            log.warning("No se pudo cargar InPlugInHome.html previo: %s", e)

        # 2. POST de autenticación formal
        data = {
            "rut": self.login_rut,
            "dv": self.login_dv,
            "referencia": "https://misiir.sii.cl/cgi_misii/siihome.cgi",
            "411": "",
            "rutcntr": f"{self.login_rut}-{self.login_dv}",
            "clave": self.clave
        }
        try:
            r = self.http.post(CLAVE_LOGIN_URL, data=data, timeout=40, allow_redirects=True, headers=login_headers)
        except requests.exceptions.RequestException as e:
            raise SiiError(f"No se pudo contactar al servidor de autenticación del SII: {str(e)[:160]}")

        self._dump("LOGIN CAutInicio.cgi", r)

        # 3. Captura del TOKEN de sesión
        self.token = self.http.cookies.get("TOKEN")
        if not self.token:
            # Buscar en texto o cabeceras si vino embebido
            m = re.search(r'TOKEN\s*=\s*["\']?([A-Za-z0-9+/=_-]{10,})["\']?', r.text or "")
            if m:
                self.token = m.group(1)
                self.http.cookies.set("TOKEN", self.token, domain=".sii.cl", path="/")

        if not self.token:
            txt = (r.text or "")[:3000].lower()
            if "clave" in txt and ("incorrect" in txt or "inválid" in txt or "invalid" in txt or "bloquead" in txt):
                raise SiiError("El SII rechazó el RUT o la Clave Tributaria (incorrecta o bloqueada).")
            raise SiiError(f"El SII no entregó cookie TOKEN de sesión. Verifique RUT y Clave Tributaria (HTTP {r.status_code}). "
                           "Detalle raw guardado en data/sii_last_response.log")

        # 4. Propagación inmediata de cookies a los dominios del portal RCV
        self._propagate_cookies()
        print(f"[SII LOGIN] Autenticación exitosa. TOKEN capturado. Cookies: {list(self.http.cookies.keys())}", flush=True)

        # 5. Warmup inicial del RCV para enlazar la sesión con www4.sii.cl
        self._warmup()
