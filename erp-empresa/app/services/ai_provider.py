"""
Proveedor de IA para el análisis documental de la Carpeta de Negocio.

Proveedores:
  - gemini : API de Google Gemini. Recibe el PDF completo (texto + imágenes + escaneados), por lo que
             hace OCR y lectura de imágenes de forma nativa.
  - openai : cualquier API compatible con OpenAI (OpenAI, Ollama local, LM Studio...). Recibe el texto.
  - none   : análisis local por reglas (bases_heuristic). Sin costo ni red, menor cobertura.

La configuración se guarda en data/ai_settings.json (o variables de entorno GEMINI_API_KEY / OPENAI_API_KEY).
"""
import base64
import json
import os
import re
import urllib.request
import urllib.error
import time
from typing import Any, Dict, List, Tuple, Optional

from app.database import DB_DIR
from app.services.bases_heuristic import analyze_heuristic

SETTINGS_PATH = os.path.join(DB_DIR, "ai_settings.json")

DEFAULT_SETTINGS = {
    "provider": "none",          # none | gemini | openai | anthropic
    "api_key": "",
    "model": "",
    "base_url": "",              # solo openai-compatible (ej: http://localhost:11434/v1)
}

DEFAULT_MODELS = {"gemini": "gemini-2.5-flash", "openai": "gpt-4o-mini", "anthropic": "claude-sonnet-4-5"}

_PROVIDERS = ("gemini", "openai", "anthropic")

PROMPT = """Eres un analista experto en licitaciones públicas chilenas (Mercado Público / ChileCompra) y en requerimientos de clientes privados.
Lee TODO el documento (texto, tablas, imágenes, formularios escaneados) y responde SOLO con un JSON válido, sin texto adicional, con esta estructura exacta:

{
 "meta": {"tender_id": str|null, "entity": str|null, "title": str|null, "budget": number|null, "budget_includes_iva": bool|null, "delivery_place": str|null},
 "products": [{"name": str, "quantity": number, "unit": str, "description": str, "specs": [str], "page": int|null}],
 "evaluation_criteria": [{"criterion": str, "weight_pct": number, "detail": str, "page": int|null}],
 "admin_documents": [{"title": str, "detail": str, "mandatory": bool, "page": int|null}],
 "documents": [{"title": str, "detail": str, "category": "DECLARACION|ANEXO|ANEXO_OFERTA|CERTIFICADO|GARANTIA|LEGAL|DOCUMENTO|DATO_OFERTA|EXCLUYENTE", "requires_signature": bool, "mandatory": bool, "page": int|null}],
 "samples": {"required": bool, "detail": str, "deadline": str|null, "place": str|null, "page": int|null},
 "milestones": [{"kind": "PUBLICACION|INICIO_PREGUNTAS|CIERRE_PREGUNTAS|RESPUESTAS|CIERRE_OFERTAS|APERTURA|ADJUDICACION|MUESTRAS|ENTREGA|OTRO", "title": str, "rule_text": str, "anchor": "PUBLICACION|INICIO_PREGUNTAS|CIERRE_PREGUNTAS|RESPUESTAS|CIERRE_OFERTAS|APERTURA|ADJUDICACION|null", "offset_days": int|null, "offset_type": "CORRIDOS|HABILES", "date": "YYYY-MM-DD"|null, "time": "HH:MM"|null, "datetime_str": str|null, "page": int|null}],
 "risks": [{"kind": "GARANTIA|MULTA|CRITERIO|EXCLUYENTE|CONDICION|PLAZO", "title": str, "detail": str, "severity": "ALTA|MEDIA|BAJA", "page": int|null}]
}

Reglas:
- products: UN elemento por cada producto/prenda/línea solicitada, con TODAS sus especificaciones técnicas detalladas en viñetas en "specs", y la cantidad total solicitada.
  * Nombre del ítem/prenda claro (ej: Chaqueta Micropolar, Pantalón Cargo de Gabardina con Cintas Reflectantes, Parka Térmica Alta Visibilidad, Polera Manga Larga Reflectante, Overol Bicolor Reflectante, Pantalón Ignífugo).
  * Ficha Técnica completa en "specs": telas y composición (micropolar antipilling, gabardina poliéster/algodón, tela oxford impermeable 300D, etc.), gramaje (gr/m²), normas reflectantes y cintas (Cintas reflectantes 2" 3M o similar, Norma NCh 3254, EN ISO 20471 Clase 2 o 3), certificaciones técnicas (Cesmec, Caltex, LICTEX), colores y contrastes (Naranjo Flúor, Azul Marino, Amarillo Flúor) y curva de tallas completa (S, M, L, XL, XXL).
  * NUNCA agrupes varias prendas distintas en un solo producto; desglósalas en productos independientes.
- evaluation_criteria: Extrae la tabla de evaluación de la oferta con cada criterio y su porcentaje de ponderación (weight_pct, ej: Precio 40, Plazo de entrega 20, Calidad técnica / muestra 30, Cumplimiento de requisitos formales 10) y el detalle o fórmula de cálculo.
- admin_documents: Detecta todos los documentos y antecedentes administrativos adicionales señalados en las bases que el oferente debe adjuntar en el portal (ej: Patente municipal al día, Certificado de vigencia de la sociedad y estatutos actualizados, Copia de Cédula de Identidad del representante legal, Certificado F30/F30-1 de antecedentes laborales y previsionales emitido por la Dirección del Trabajo, Acreditación de experiencia comercial o técnica mediante facturas o certificados de OC anteriores, Certificado de Registro de Proveedores de ChileCompra).
- documents: Formularios tipo, anexos de la licitación y declaraciones juradas que requieren completar o firmar (requires_signature=true si exige firma o timbre). Incluye los requisitos excluyentes con category EXCLUYENTE.
- samples: Si se exige entrega de muestras físicas (fecha límite, lugar exacto, especificación y cantidad de muestras). Si no se exigen, required=false.
- milestones: Extrae minuciosamente las fechas y horas de cada hito clave del cronograma oficial (1 al 8):
  1. Fecha de Publicación (PUBLICACION)
  2. Inicio de Preguntas (INICIO_PREGUNTAS)
  3. Cierre de Preguntas (CIERRE_PREGUNTAS)
  4. Fecha de Respuestas / Aclaraciones (RESPUESTAS)
  5. Cierre de Recepción de Ofertas (CIERRE_OFERTAS)
  6. Apertura Técnica y Económica (APERTURA)
  7. Fecha Estimada de Adjudicación (ADJUDICACION)
  8. Plazo / Entrega de Muestras (MUESTRAS)
  Incluye fecha ("YYYY-MM-DD"), hora ("HH:MM") o texto completo de fecha y hora ("datetime_str") si aparece en el documento. Si es relativa (ej. 'catorce días corridos desde la publicación') usa anchor y offset_days.
- risks: Garantías exigidas (seriedad de la oferta / fiel cumplimiento del contrato con monto o porcentaje), multas (tasa y topes), causales de inadmisibilidad, condiciones especiales y aspectos críticos.
- No inventes datos. Si algo no aparece en el documento, omítelo (o usa null). Incluye el número de página cuando lo conozcas.
"""


def load_settings() -> Dict[str, Any]:
    s = dict(DEFAULT_SETTINGS)
    try:
        if os.path.exists(SETTINGS_PATH):
            with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
                s.update(json.load(f))
    except Exception:
        pass
    if s.get("provider") == "gemini":
        if not s.get("model") or s.get("model") in ("gemini-3.8-flash", "gemini-1.5-flash"):
            s["model"] = "gemini-2.5-flash"
        if not s.get("api_key") and os.environ.get("GEMINI_API_KEY"):
            s["api_key"] = os.environ["GEMINI_API_KEY"]
    if s["provider"] == "none":
        if os.environ.get("GEMINI_API_KEY"):
            s.update(provider="gemini", api_key=os.environ["GEMINI_API_KEY"], model="gemini-2.5-flash")
        elif os.environ.get("OPENAI_API_KEY"):
            s.update(provider="openai", api_key=os.environ["OPENAI_API_KEY"])
        elif os.environ.get("ANTHROPIC_API_KEY"):
            s.update(provider="anthropic", api_key=os.environ["ANTHROPIC_API_KEY"])
    return s


def save_settings(new: Dict[str, Any]) -> Dict[str, Any]:
    cur = load_settings()
    for k in DEFAULT_SETTINGS:
        if k in new and new[k] is not None:
            if k == "api_key" and (new[k] == "" or new[k].startswith("••")):
                continue  # no sobrescribir con vacío / valor enmascarado
            cur[k] = new[k]
    os.makedirs(DB_DIR, exist_ok=True)
    with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(cur, f, ensure_ascii=False, indent=2)
    return public_settings()


def public_settings() -> Dict[str, Any]:
    s = load_settings()
    key = s.get("api_key") or ""
    return {
        "provider": s["provider"],
        "model": s.get("model") or DEFAULT_MODELS.get(s["provider"], ""),
        "base_url": s.get("base_url", ""),
        "has_key": bool(key),
        "api_key_masked": ("••••••" + key[-4:]) if key else "",
    }


def _post_json(url: str, payload: dict, headers: dict, timeout: int = 300) -> dict:
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"HTTP {e.code}: {body}")


def _parse_json_loose(txt: str) -> Dict[str, Any]:
    txt = txt.strip()
    txt = re.sub(r"^```(?:json)?|```$", "", txt, flags=re.MULTILINE).strip()
    try:
        return json.loads(txt)
    except Exception:
        m = re.search(r"\{[\s\S]*\}", txt)
        if m:
            return json.loads(m.group(0))
        raise


def _prepare_gemini_parts(file_bytes: Optional[bytes], is_pdf: bool, text: str, prompt: str) -> List[dict]:
    """Optimiza el envío de texto e imágenes para evitar saturación de tokens y errores 503."""
    parts: List[dict] = []
    clean_text = (text or "").strip()
    # Si tenemos texto extraído real (directo o tras OCR de páginas escaneadas),
    # priorizamos el texto formateado por páginas en lotes para proteger cuota y evitar sobrecarga visual
    if len(clean_text) >= 50:
        # Límite seguro para prevenir saturación de contexto en una sola petición
        if len(clean_text) > 300_000:
            clean_text = clean_text[:300_000] + "\n\n[... Resto del documento omitido para optimizar procesamiento de IA ...]"
        parts.append({"text": "DOCUMENTO:\n" + clean_text})
    elif is_pdf and file_bytes and len(file_bytes) < 12 * 1024 * 1024:
        # Solo si no hay texto legible extraído se envía el binario PDF
        parts.append({"inline_data": {"mime_type": "application/pdf", "data": base64.b64encode(file_bytes).decode()}})
    else:
        parts.append({"text": "DOCUMENTO:\n" + (clean_text or "Sin texto disponible")})
    parts.append({"text": prompt})
    return parts


def _call_gemini(s: Dict[str, Any], file_bytes: Optional[bytes], is_pdf: bool, text: str, prompt: str = PROMPT) -> Tuple[Dict[str, Any], str, List[str]]:
    """Ejecuta la llamada a Gemini con cadena de modelos de respaldo y reintentos con backoff exponencial (503 / 429)."""
    configured_model = (s.get("model") or "gemini-1.5-flash").strip()
    if configured_model.startswith("models/"):
        configured_model = configured_model[len("models/"):]
    if not configured_model:
        configured_model = "gemini-1.5-flash"

    # Cadena de modelos de respaldo en orden de prioridad:
    # 1. Modelo configurado por el usuario
    # 2. Modelos solicitados: gemini-1.5-flash, gemini-1.5-pro, gemini-2.0-flash
    # 3. Modelos de alta disponibilidad y cuota activa verificados en la API
    candidate_chain = [
        configured_model,
        "gemini-1.5-flash",
        "gemini-1.5-pro",
        "gemini-2.0-flash",
        "gemini-flash-lite-latest",
        "gemini-3.5-flash-lite",
        "gemini-3-flash-preview",
        "gemini-flash-latest",
        "gemini-3.8-flash"
    ]
    models_to_try = []
    for m in candidate_chain:
        if m and m not in models_to_try:
            models_to_try.append(m)

    parts = _prepare_gemini_parts(file_bytes, is_pdf, text, prompt)
    warnings: List[str] = []
    last_err = None

    for model_name in models_to_try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={s['api_key']}"
        # Hasta 2 reintentos con pausas exponenciales de 2s y 4s ante 503 o 429
        for attempt in range(3):
            try:
                out = _post_json(
                    url,
                    {
                        "contents": [{"parts": parts}],
                        "generationConfig": {"responseMimeType": "application/json", "temperature": 0.1}
                    },
                    {"Content-Type": "application/json"},
                    timeout=180
                )
                txt = out["candidates"][0]["content"]["parts"][0]["text"]
                parsed = _parse_json_loose(txt)
                if model_name != configured_model:
                    warnings.append(f"Modelo principal '{configured_model}' con alta demanda/no disponible. Procesado exitosamente mediante respaldo '{model_name}'.")
                return parsed, model_name, warnings
            except Exception as e:
                last_err = e
                err_str = str(e)
                # Si el modelo no existe o fue retirado (404), pasar inmediatamente al siguiente modelo
                if "404" in err_str:
                    break
                # Si el error es 503 (Unavailable / High Demand), 429 (Rate limit) o 500
                if ("503" in err_str or "demand" in err_str.lower() or "429" in err_str or "quota" in err_str.lower() or "500" in err_str):
                    if attempt < 2:
                        delay = 2 * (attempt + 1)  # 2s en intento 1, 4s en intento 2
                        time.sleep(delay)
                        continue
                    else:
                        # Se agotaron los reintentos para este modelo; intentar con el siguiente en cascada
                        break
                else:
                    # Error no recuperable con este modelo, continuar al siguiente
                    break

    raise last_err or RuntimeError("Todos los modelos de la cadena de respaldo fallaron.")


def _call_openai(s: Dict[str, Any], text: str) -> Dict[str, Any]:
    base = (s.get("base_url") or "https://api.openai.com/v1").rstrip("/")
    model = s.get("model") or DEFAULT_MODELS["openai"]
    headers = {"Content-Type": "application/json"}
    if s.get("api_key"):
        headers["Authorization"] = f"Bearer {s['api_key']}"
    payload = {"model": model, "temperature": 0.1,
               "messages": [{"role": "system", "content": PROMPT},
                            {"role": "user", "content": "DOCUMENTO:\n" + text[:400000]}],
               "response_format": {"type": "json_object"}}
    out = _post_json(f"{base}/chat/completions", payload, headers)
    return _parse_json_loose(out["choices"][0]["message"]["content"])


def _enabled(s: Dict[str, Any]) -> bool:
    return s.get("provider") in _PROVIDERS and bool(s.get("api_key") or s.get("provider") == "openai")


def _call_anthropic(s: Dict[str, Any], file_bytes: Optional[bytes], is_pdf: bool, text: str, prompt: Optional[str] = None) -> Dict[str, Any]:
    model = s.get("model") or DEFAULT_MODELS["anthropic"]
    content: List[dict] = []
    if is_pdf and file_bytes and len(file_bytes) < 30 * 1024 * 1024:
        content.append({"type": "document", "source": {"type": "base64", "media_type": "application/pdf",
                                                       "data": base64.b64encode(file_bytes).decode()}})
    elif text:
        content.append({"type": "text", "text": "DOCUMENTO:\n" + text[:600000]})
    content.append({"type": "text", "text": "Analiza el documento y responde SOLO con el JSON solicitado."})
    out = _post_json("https://api.anthropic.com/v1/messages",
                     {"model": model, "max_tokens": 16000, "temperature": 0.1, "system": prompt or PROMPT,
                      "messages": [{"role": "user", "content": content}]},
                     {"Content-Type": "application/json", "x-api-key": s["api_key"], "anthropic-version": "2023-06-01"})
    txt = "".join(b.get("text", "") for b in out.get("content", []) if b.get("type") == "text")
    return _parse_json_loose(txt)


def _run(s: Dict[str, Any], prompt: str, file_bytes: Optional[bytes] = None, is_pdf: bool = False, text: str = "") -> Dict[str, Any]:
    """Llamada genérica al proveedor configurado. Lanza excepción si falla."""
    if s["provider"] == "anthropic":
        return _call_anthropic(s, file_bytes, is_pdf, text, prompt)
    if s["provider"] == "gemini":
        parsed, _, _ = _call_gemini(s, file_bytes, is_pdf, text, prompt)
        return parsed
    base = (s.get("base_url") or "https://api.openai.com/v1").rstrip("/")
    headers = {"Content-Type": "application/json"}
    if s.get("api_key"):
        headers["Authorization"] = f"Bearer {s['api_key']}"
    payload = {"model": s.get("model") or DEFAULT_MODELS["openai"], "temperature": 0.1,
               "messages": [{"role": "system", "content": prompt},
                            {"role": "user", "content": "DOCUMENTO:\n" + (text or "")[:400000]}],
               "response_format": {"type": "json_object"}}
    out = _post_json(f"{base}/chat/completions", payload, headers)
    return _parse_json_loose(out["choices"][0]["message"]["content"])



def ping() -> Dict[str, Any]:
    """Verifica en vivo la clave/proveedor con una llamada mínima."""
    s = load_settings()
    if not _enabled(s):
        return {"ok": False, "message": "No hay proveedor de IA con clave configurado."}
    try:
        r = _run(s, 'Responde exactamente con este JSON: {"ok": true}', text="ping")
        label = s.get("model") or DEFAULT_MODELS.get(s["provider"], "")
        return {"ok": True, "message": f"Conexión correcta con {s['provider']} ({label}). Respuesta: {json.dumps(r)[:80]}"}
    except Exception as e:
        return {"ok": False, "message": f"El proveedor respondió con error: {str(e)[:400]}"}


def _normalize(r: Dict[str, Any]) -> Dict[str, Any]:
    r = r or {}
    r.setdefault("meta", {})
    for k in ("products", "documents", "milestones", "risks", "evaluation_criteria", "admin_documents"):
        if not isinstance(r.get(k), list):
            r[k] = []
    for c in r["evaluation_criteria"]:
        c["criterion"] = str(c.get("criterion") or "Criterio")[:200]
        try:
            c["weight_pct"] = float(c.get("weight_pct") or 0)
        except Exception:
            c["weight_pct"] = 0.0
        c["detail"] = str(c.get("detail") or "")
    for a in r["admin_documents"]:
        a["title"] = str(a.get("title") or "Antecedente")[:250]
        a["detail"] = str(a.get("detail") or "")
        a["mandatory"] = bool(a.get("mandatory", True))
    if not isinstance(r.get("samples"), dict):
        r["samples"] = {"required": False, "detail": "Sin información de muestras."}
    for p in r["products"]:
        p["name"] = str(p.get("name") or "Producto")[:200]
        try:
            p["quantity"] = float(p.get("quantity") or 1)
        except Exception:
            p["quantity"] = 1.0
        p["unit"] = str(p.get("unit") or "UND")[:10]
        specs = p.get("specs") or []
        if isinstance(specs, str):
            specs = [specs]
        p["specs"] = [str(x) for x in specs]
        p["description"] = str(p.get("description") or "")
    return r


def analyze(file_bytes: Optional[bytes], filename: str, pages: List[Tuple[int, str]]) -> Tuple[Dict[str, Any], str, List[str]]:
    """Devuelve (resultado, etiqueta_proveedor, advertencias)."""
    s = load_settings()
    warnings: List[str] = []
    text = "\n\f\n".join(f"[Página {n}]\n{t}" for n, t in pages)
    is_pdf = filename.lower().endswith(".pdf")
    empty_pages = [n for n, t in pages if len((t or "").strip()) < 30]

    if _enabled(s):
        try:
            if s["provider"] == "anthropic":
                res = _call_anthropic(s, file_bytes, is_pdf, text)
                label = f"Claude ({s.get('model') or DEFAULT_MODELS['anthropic']})"
            elif s["provider"] == "gemini":
                res, used_model, model_warns = _call_gemini(s, file_bytes, is_pdf, text)
                label = f"Gemini ({used_model})"
                warnings.extend(model_warns)
            else:
                res = _call_openai(s, text)
                label = f"{s.get('model') or DEFAULT_MODELS['openai']} (OpenAI-compatible)"
                if empty_pages:
                    warnings.append(f"{len(empty_pages)} página(s) sin texto (escaneadas/imágenes) no pudieron leerse con este proveedor; use Gemini para OCR.")
            return _normalize(res), label, warnings
        except Exception as e:
            warnings.append(f"El proveedor de IA falló ({e}). Se usó el análisis local por reglas.")

    res = analyze_heuristic(pages)
    if empty_pages:
        warnings.append(f"{len(empty_pages)} página(s) sin texto (escaneadas / sólo imágenes) NO se pudieron leer. Configure Gemini en Configuración para leer imágenes y escaneados.")
    if s["provider"] == "none":
        warnings.append("Análisis local por reglas (sin IA). Para mayor precisión configure un proveedor de IA en Multi-Empresa & Config.")
    return _normalize(res), "Reglas locales", warnings

def llm_json(prompt: str, file_bytes: Optional[bytes] = None, is_pdf: bool = False, text: str = "") -> Optional[Dict[str, Any]]:
    """Llamada genérica al proveedor de IA configurado, esperando un JSON. None si no hay IA o si falla."""
    s = load_settings()
    if not _enabled(s):
        return None
    try:
        return _run(s, prompt, file_bytes, is_pdf, text)
    except Exception:
        return None
