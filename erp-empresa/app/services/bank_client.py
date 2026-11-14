"""Cliente Fintoc (API bancaria chilena): cuentas y movimientos en tiempo real.

Flujo: el widget de Fintoc (clave pública) entrega un exchange_token → el backend lo canjea con la clave
secreta por un link_token → con ambos se leen cuentas y movimientos.
"""
from typing import Any, Dict, List, Optional

import requests

BASE = "https://api.fintoc.com/v1"


class BankError(Exception):
    pass


class Fintoc:
    def __init__(self, secret_key: str, link_token: Optional[str] = None):
        self.secret, self.link = secret_key.strip(), (link_token or "").strip()

    def _get(self, path: str, params: Optional[Dict[str, Any]] = None):
        try:
            r = requests.get(BASE + path, params=params or {}, headers={"Authorization": self.secret}, timeout=40)
        except requests.exceptions.RequestException as e:
            raise BankError(f"No se pudo contactar a Fintoc: {str(e)[:160]}")
        if r.status_code == 401:
            raise BankError("Fintoc rechazó la clave secreta (401). Verifique que sea la sk_live_… correcta.")
        if r.status_code >= 400:
            try:
                msg = r.json().get("error", {}).get("message") or r.text[:200]
            except Exception:
                msg = r.text[:200]
            raise BankError(f"Fintoc ({r.status_code}): {msg}")
        return r.json()

    def exchange(self, exchange_token: str) -> Dict[str, Any]:
        link = self._get("/links/exchange", {"exchange_token": exchange_token})
        if not link.get("link_token"):
            raise BankError("Fintoc no entregó el link_token.")
        self.link = link["link_token"]
        return link

    def accounts(self) -> List[Dict[str, Any]]:
        return self._get("/accounts", {"link_token": self.link})

    def movements(self, account_id: str, since: Optional[str] = None) -> List[Dict[str, Any]]:
        out, page = [], 1
        while page <= 30:
            params = {"link_token": self.link, "per_page": 300, "page": page}
            if since:
                params["since"] = since
            batch = self._get(f"/accounts/{account_id}/movements", params)
            if not batch:
                break
            out += batch
            if len(batch) < 300:
                break
            page += 1
        return out
