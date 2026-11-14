"""Autenticación, selección de empresa (multi-tenant) y middleware de contexto.

- Usuarios y sesiones viven en la base maestra.
- La sesión y la empresa activa viajan en cookies (`erp_token`, `erp_company`), por lo que
  fetch, descargas y enlaces directos funcionan sin cambios en el front.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from http.cookies import SimpleCookie
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from app.database import (
    _master_conn, set_current_company, reset_current_company, MASTER,
)

router = APIRouter(prefix="/api/auth", tags=["Autenticación"])

COOKIE_TOKEN = "erp_token"
COOKIE_COMPANY = "erp_company"
COOKIE_FINANZIA = "finanzia_session"
SESSION_DAYS = 14


# ------------------------------------------------------------------ helpers
def _hash(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000).hex()


def _b64url_decode(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad)


def _verify_finanzia_jwt(token: Optional[str]) -> Optional[dict]:
    """Verifica el JWT HS256 emitido por Next.js (cookie finanzia_session) para Single Sign-On."""
    if not token or token.count(".") != 2:
        return None
    try:
        header_b64, payload_b64, sig_b64 = token.split(".")
        secret = (os.environ.get("AUTH_SECRET") or "dev-only-secret-change-me-in-production-32chars").encode("utf-8")
        expected_sig = hmac.new(secret, f"{header_b64}.{payload_b64}".encode("ascii"), hashlib.sha256).digest()
        if not hmac.compare_digest(expected_sig, _b64url_decode(sig_b64)):
            return None
        payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
        if payload.get("exp") and float(payload["exp"]) < time.time():
            return None
        return payload
    except Exception:
        return None


def init_auth() -> None:
    with _master_conn() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            full_name TEXT,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            role TEXT DEFAULT 'ADMIN',
            allowed_companies TEXT DEFAULT '',   -- ids separados por coma; vacío = todas
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)""")
        c.execute("""CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)""")
        try:
            c.execute("ALTER TABLE users ADD COLUMN email TEXT")
        except Exception:
            pass

        # Garantizar usuario maestro Vision / Code tanto para login directo como SSO
        vision_row = c.execute(
            "SELECT id FROM users WHERE LOWER(username) = 'vision' OR LOWER(COALESCE(email,'')) = 'vision@finanzia.cl'"
        ).fetchone()
        v_salt = secrets.token_hex(8)
        v_hash = _hash("Code", v_salt)
        if not vision_row:
            c.execute(
                "INSERT INTO users (username, full_name, email, password_hash, salt, role, is_active) VALUES (?,?,?,?,?,?,1)",
                ("vision", "Vision", "vision@finanzia.cl", v_hash, v_salt, "ADMIN"),
            )
        else:
            c.execute(
                "UPDATE users SET username = ?, full_name = ?, email = ?, password_hash = ?, salt = ?, role = 'ADMIN', is_active = 1 WHERE id = ?",
                ("vision", "Vision", "vision@finanzia.cl", v_hash, v_salt, vision_row["id"]),
            )

        # Sincronizar cuentas base de FINANZIA para SSO unificado y login directo
        demo_accounts = [
            ("admin@finanzia.cl", "Administración Finanzia", "ADMIN"),
            ("empresa@finanzia.cl", "Comercial Andes SpA", "ADMIN"),
            ("staff@finanzia.cl", "Matías Soto (Contador)", "ADMIN"),
            ("persona@finanzia.cl", "Camila Rojas", "USUARIO"),
        ]
        for email, full_name, role in demo_accounts:
            exists = c.execute(
                "SELECT id FROM users WHERE username = ? OR LOWER(COALESCE(email,'')) = ?",
                (email, email)
            ).fetchone()
            if not exists:
                salt = secrets.token_hex(8)
                c.execute(
                    "INSERT INTO users (username, full_name, email, password_hash, salt, role) VALUES (?,?,?,?,?,?)",
                    (email, full_name, email, _hash("demo1234", salt), salt, role)
                )
        c.commit()


def _user_by_token(token: Optional[str], finanzia_jwt: Optional[str] = None):
    if token:
        with _master_conn() as c:
            row = c.execute("""SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                               WHERE s.token = ? AND u.is_active = 1
                               AND s.created_at >= datetime('now', ?)""",
                            (token, f"-{SESSION_DAYS} days")).fetchone()
            if row:
                return dict(row)

    payload = _verify_finanzia_jwt(finanzia_jwt)
    if payload and payload.get("email"):
        email = str(payload["email"]).strip().lower()
        with _master_conn() as c:
            row = c.execute(
                "SELECT * FROM users WHERE (username = ? OR LOWER(COALESCE(email,'')) = ?) AND is_active = 1",
                (email, email)
            ).fetchone()
            if row:
                return dict(row)
    return None


def _companies_for(user: dict):
    with _master_conn() as c:
        rows = [dict(r) for r in c.execute(
            "SELECT id, rut, razon_social, giro, logo_url FROM companies ORDER BY is_default DESC, razon_social")]
    allowed = [int(x) for x in (user.get("allowed_companies") or "").split(",") if x.strip().isdigit()]
    if allowed:
        rows = [r for r in rows if r["id"] in allowed]
    return rows


def _public_user(u: dict) -> dict:
    return {"id": u["id"], "username": u["username"], "full_name": u.get("full_name"), "role": u.get("role")}


def _cookie_opts():
    return {"httponly": True, "samesite": "lax", "path": "/", "max_age": SESSION_DAYS * 86400}


def current_user(request: Request) -> dict:
    u = _user_by_token(request.cookies.get(COOKIE_TOKEN), request.cookies.get(COOKIE_FINANZIA))
    if not u:
        raise HTTPException(status_code=401, detail="Sesión no iniciada")
    return u


# ------------------------------------------------------------------ endpoints
class LoginModel(BaseModel):
    username: str
    password: str


class SelectCompanyModel(BaseModel):
    company_id: int


class PasswordModel(BaseModel):
    current_password: str
    new_password: str


class NewUserModel(BaseModel):
    username: str = ""
    email: str = ""
    password: str
    full_name: str = ""
    role: str = "USUARIO"
    allowed_companies: str = ""


class UpdateUserModel(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    allowed_companies: Optional[str] = None
    is_active: Optional[int] = None
    password: Optional[str] = None


class SetupModel(BaseModel):
    username: str
    password: str
    full_name: str = ""


@router.get("/setup-status")
def setup_status():
    with _master_conn() as c:
        n = c.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    return {"needs_setup": n == 0}


@router.post("/setup")
def setup_admin(data: SetupModel, response: Response):
    """Crea el SuperAdmin inicial. Solo funciona mientras no exista ningún usuario."""
    username = data.username.strip().lower()
    if len(username) < 3 or len(data.password) < 8:
        raise HTTPException(status_code=400, detail="Usuario (mín. 3) y contraseña (mín. 8 caracteres) son obligatorios")
    salt = secrets.token_hex(8)
    token = secrets.token_urlsafe(32)
    with _master_conn() as c:
        if c.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            raise HTTPException(status_code=403, detail="La instalación ya fue configurada")
        cur = c.execute("INSERT INTO users (username, full_name, password_hash, salt, role) VALUES (?,?,?,?,?)",
                        (username, data.full_name.strip() or username, _hash(data.password, salt), salt, "ADMIN"))
        c.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, cur.lastrowid))
        c.commit()
        row = c.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
    response.set_cookie(COOKIE_TOKEN, token, **_cookie_opts())
    response.delete_cookie(COOKIE_COMPANY, path="/")
    return {"user": _public_user(dict(row)), "companies": []}


@router.post("/login")
def login(data: LoginModel, response: Response):
    with _master_conn() as c:
        ident = data.username.strip().lower()
        row = c.execute("SELECT * FROM users WHERE (username = ? OR LOWER(COALESCE(email,'')) = ?) AND is_active = 1",
                        (ident, ident)).fetchone()
        if not row or not hmac.compare_digest(_hash(data.password, row["salt"]), row["password_hash"]):
            raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos")
        token = secrets.token_urlsafe(32)
        c.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, row["id"]))
        c.execute("DELETE FROM sessions WHERE created_at < datetime('now', ?)", (f"-{SESSION_DAYS} days",))
        c.commit()
    user = dict(row)
    response.set_cookie(COOKIE_TOKEN, token, **_cookie_opts())
    response.delete_cookie(COOKIE_COMPANY, path="/")  # obliga a elegir empresa en cada inicio de sesión
    return {"user": _public_user(user), "companies": _companies_for(user)}


@router.post("/logout")
def logout(request: Request, response: Response):
    tok = request.cookies.get(COOKIE_TOKEN)
    if tok:
        with _master_conn() as c:
            c.execute("DELETE FROM sessions WHERE token = ?", (tok,))
            c.commit()
    response.delete_cookie(COOKIE_TOKEN, path="/")
    response.delete_cookie(COOKIE_COMPANY, path="/")
    return {"message": "Sesión cerrada"}


@router.get("/me")
def me(request: Request, response: Response):
    user = current_user(request)
    companies = _companies_for(user)
    cid = request.cookies.get(COOKIE_COMPANY)
    active = next((c for c in companies if str(c["id"]) == str(cid)), None)
    if not active and companies:
        active = companies[0]
        from app.database import ensure_tenant
        ensure_tenant(active["id"])
        response.set_cookie(COOKIE_COMPANY, str(active["id"]), **_cookie_opts())
    return {"user": _public_user(user), "companies": companies, "active_company": active,
            "needs_company_setup": len(companies) == 0}


@router.post("/select-company")
def select_company(data: SelectCompanyModel, request: Request, response: Response):
    user = current_user(request)
    comp = next((c for c in _companies_for(user) if c["id"] == data.company_id), None)
    if not comp:
        raise HTTPException(status_code=403, detail="No tiene acceso a esa empresa")
    from app.database import ensure_tenant
    ensure_tenant(comp["id"])  # crea el espacio aislado si es la primera vez
    response.set_cookie(COOKIE_COMPANY, str(comp["id"]), **_cookie_opts())
    return {"message": f"Operando como {comp['razon_social']}", "company": comp}


@router.post("/change-password")
def change_password(data: PasswordModel, request: Request):
    user = current_user(request)
    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="La nueva contraseña debe tener al menos 6 caracteres")
    if not hmac.compare_digest(_hash(data.current_password, user["salt"]), user["password_hash"]):
        raise HTTPException(status_code=400, detail="La contraseña actual no es correcta")
    salt = secrets.token_hex(8)
    with _master_conn() as c:
        c.execute("UPDATE users SET password_hash = ?, salt = ? WHERE id = ?",
                  (_hash(data.new_password, salt), salt, user["id"]))
        c.commit()
    return {"message": "Contraseña actualizada"}


_ROLES = ("ADMIN", "USUARIO")
_EMAIL_RE = __import__("re").compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _require_admin(request: Request) -> dict:
    user = current_user(request)
    if user.get("role") != "ADMIN":
        raise HTTPException(status_code=403, detail="Solo administradores")
    return user


@router.get("/users")
def list_users(request: Request):
    _require_admin(request)
    with _master_conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT id, username, full_name, email, role, allowed_companies, is_active, created_at FROM users ORDER BY id")]


@router.post("/users")
def create_user(data: NewUserModel, request: Request):
    _require_admin(request)
    email = data.email.strip().lower()
    username = (data.username.strip().lower() or email)
    if email and not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Correo inválido")
    if len(username) < 3 or len(data.password) < 8:
        raise HTTPException(status_code=400, detail="Correo/usuario y contraseña (mín. 8 caracteres) son obligatorios")
    role = data.role.strip().upper()
    if role not in _ROLES:
        raise HTTPException(status_code=400, detail="Rol inválido (ADMIN o USUARIO)")
    salt = secrets.token_hex(8)
    try:
        with _master_conn() as c:
            if email and c.execute("SELECT 1 FROM users WHERE LOWER(COALESCE(email,'')) = ?", (email,)).fetchone():
                raise ValueError("dup")
            cur = c.execute("""INSERT INTO users (username, full_name, email, password_hash, salt, role, allowed_companies)
                         VALUES (?,?,?,?,?,?,?)""",
                            (username, data.full_name.strip(), email, _hash(data.password, salt), salt, role,
                             data.allowed_companies.strip()))
            c.commit()
    except Exception:
        raise HTTPException(status_code=400, detail="Ese usuario o correo ya existe")
    return {"message": "Usuario creado", "id": cur.lastrowid}


@router.put("/users/{user_id}")
def update_user(user_id: int, data: UpdateUserModel, request: Request):
    me_ = _require_admin(request)
    with _master_conn() as c:
        row = c.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Usuario no encontrado")
        role = (data.role or row["role"]).strip().upper()
        if role not in _ROLES:
            raise HTTPException(status_code=400, detail="Rol inválido (ADMIN o USUARIO)")
        active = row["is_active"] if data.is_active is None else int(bool(data.is_active))
        if (role != "ADMIN" or not active) and row["role"] == "ADMIN":
            others = c.execute("SELECT COUNT(*) FROM users WHERE role='ADMIN' AND is_active=1 AND id != ?", (user_id,)).fetchone()[0]
            if others == 0:
                raise HTTPException(status_code=400, detail="Debe quedar al menos un administrador activo")
        if user_id == me_["id"] and not active:
            raise HTTPException(status_code=400, detail="No puede desactivar su propio usuario")
        email = row["email"] if data.email is None else data.email.strip().lower()
        if email and not _EMAIL_RE.match(email):
            raise HTTPException(status_code=400, detail="Correo inválido")
        sets = {"full_name": row["full_name"] if data.full_name is None else data.full_name.strip(), "email": email,
                "role": role, "is_active": active,
                "allowed_companies": row["allowed_companies"] if data.allowed_companies is None else data.allowed_companies.strip()}
        if data.password:
            if len(data.password) < 8:
                raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 8 caracteres")
            salt = secrets.token_hex(8)
            sets["salt"], sets["password_hash"] = salt, _hash(data.password, salt)
        c.execute("UPDATE users SET " + ", ".join(f"{k}=?" for k in sets) + " WHERE id=?", (*sets.values(), user_id))
        if not active or data.password:
            c.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        c.commit()
    return {"message": "Usuario actualizado"}


# ------------------------------------------------------------------ middleware ASGI
_OPEN_PATHS = ("/api/auth/login", "/api/auth/logout", "/api/auth/setup-status", "/api/auth/setup")
_MASTER_PREFIXES = ("/api/auth", "/api/companies")


class TenantMiddleware:
    """Exige sesión y empresa activa para /api y fija la BD de la empresa en el contexto."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/api/") or scope["path"] in _OPEN_PATHS:
            return await self.app(scope, receive, send)

        cookies = SimpleCookie()
        for k, v in scope.get("headers", []):
            if k == b"cookie":
                cookies.load(v.decode("latin-1"))
        token = cookies[COOKIE_TOKEN].value if COOKIE_TOKEN in cookies else None
        finanzia_jwt = cookies[COOKIE_FINANZIA].value if COOKIE_FINANZIA in cookies else None
        user = _user_by_token(token, finanzia_jwt)
        if not user:
            return await self._reject(send, 401, "Sesión no iniciada")

        path = scope["path"]
        if path.startswith(_MASTER_PREFIXES):
            ctx_token = set_current_company(MASTER)
        else:
            cid = cookies[COOKIE_COMPANY].value if COOKIE_COMPANY in cookies else None
            allowed_comps = _companies_for(user)
            if (not cid or not cid.isdigit()) and allowed_comps:
                cid = str(allowed_comps[0]["id"])
            if not cid or not cid.isdigit():
                return await self._reject(send, 409, "Seleccione la empresa con la que desea operar")
            if not any(c["id"] == int(cid) for c in allowed_comps):
                return await self._reject(send, 403, "No tiene acceso a esa empresa")
            ctx_token = set_current_company(int(cid))
        try:
            return await self.app(scope, receive, send)
        finally:
            reset_current_company(ctx_token)

    @staticmethod
    async def _reject(send, status, detail):
        body = json.dumps({"detail": detail}).encode("utf-8")
        await send({"type": "http.response.start", "status": status,
                    "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})
