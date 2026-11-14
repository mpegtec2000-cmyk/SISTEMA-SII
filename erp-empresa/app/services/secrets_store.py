"""Cifrado de credenciales sensibles (certificado digital, claves API) en reposo.

La clave simétrica vive en data/secret.key, fuera de la base de datos: quien copie sólo el
archivo .db no puede leer los secretos. Protege la clave con permisos del sistema operativo
(y no la suba a repositorios ni la comparta).
"""
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from app.database import DB_DIR

KEY_PATH = os.path.join(DB_DIR, "secret.key")


def _fernet() -> Fernet:
    os.makedirs(DB_DIR, exist_ok=True)
    if not os.path.exists(KEY_PATH):
        with open(KEY_PATH, "wb") as f:
            f.write(Fernet.generate_key())
        try:
            os.chmod(KEY_PATH, 0o600)
        except Exception:
            pass
    with open(KEY_PATH, "rb") as f:
        return Fernet(f.read().strip())


def encrypt(data: bytes) -> bytes:
    return _fernet().encrypt(data)


def decrypt(token: Optional[bytes]) -> Optional[bytes]:
    if not token:
        return None
    try:
        return _fernet().decrypt(bytes(token))
    except InvalidToken:
        raise ValueError("No se pudo descifrar el secreto guardado (¿cambió o se perdió data/secret.key?). Vuelva a cargarlo.")
