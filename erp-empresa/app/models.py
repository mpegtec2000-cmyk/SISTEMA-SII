import re
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

def validar_rut(rut: str) -> bool:
    if not rut:
        return False
    # tolera puntos, guion normal, guion largo (– —), espacios y RUT pegado sin separadores
    rut_clean = __import__("re").sub(r"[^0-9kK]", "", rut).upper()
    if len(rut_clean) < 2:
        return False
    cuerpo = rut_clean[:-1]
    dv = rut_clean[-1]
    if not cuerpo.isdigit():
        return False
    
    suma = 0
    multiplicador = 2
    for c in reversed(cuerpo):
        suma += int(c) * multiplicador
        multiplicador = 2 if multiplicador == 7 else multiplicador + 1
    
    resto = suma % 11
    esperado = 11 - resto
    if esperado == 11:
        dv_esperado = "0"
    elif esperado == 10:
        dv_esperado = "K"
    else:
        dv_esperado = str(esperado)
    
    return dv == dv_esperado

def formatear_rut(rut: str) -> str:
    if not rut:
        return ""
    rut_clean = __import__("re").sub(r"[^0-9kK]", "", rut).upper()
    if len(rut_clean) < 2:
        return rut
    cuerpo = rut_clean[:-1]
    dv = rut_clean[-1]
    if not cuerpo.isdigit():
        return rut
    
    # Formatear cuerpo con puntos
    cuerpo_rev = cuerpo[::-1]
    partes = [cuerpo_rev[i:i+3] for i in range(0, len(cuerpo_rev), 3)]
    cuerpo_formateado = ".".join(partes)[::-1]
    return f"{cuerpo_formateado}-{dv}"

def rut_valido_formato(rut: str) -> bool:
    """Formato chileno: 7-8 dígitos + dígito verificador (0-9 o K), con cualquier separador."""
    return bool(__import__("re").fullmatch(r"\d{7,8}[0-9K]", __import__("re").sub(r"[^0-9kK]", "", rut or "").upper()))


# --- Modelos Multi-Empresa ---
class CompanyModel(BaseModel):
    rut: str
    razon_social: str
    giro: Optional[str] = ""
    direccion: Optional[str] = ""
    comuna: Optional[str] = ""
    ciudad: Optional[str] = ""
    telefono: Optional[str] = ""
    email: Optional[str] = ""
    logo_url: Optional[str] = ""
    ppm_rate: float = 1.5
    is_default: int = 0

# --- Modelos Carpeta de Negocio ---
class BusinessFolderModel(BaseModel):
    code: Optional[str] = None
    title: str
    client_name: str
    client_rut: str
    status: str = "EN_EJECUCION"
    type: str = "MERCADO_PUBLICO"
    tender_id: Optional[str] = None
    tender_closing_date: Optional[str] = None
    budget_amount: float = 0.0
    company_id: Optional[int] = None
    target_margin_pct: float = 25.0
    notes: Optional[str] = ""

class FolderExpenseModel(BaseModel):
    folder_id: int
    description: str
    category: str = "FLETE"
    amount: float
    date: str
    doc_number: Optional[str] = None
    supplier_rut: Optional[str] = None
    notes: Optional[str] = None

# --- Modelos Catálogo & Inventario ---
class ProductModel(BaseModel):
    sku: Optional[str] = None
    barcode: Optional[str] = None
    name: str
    description: Optional[str] = ""
    category: str = "General"
    unit: str = "UND"
    unit_cost: float = 0.0
    unit_price: float = 0.0
    stock_physical: float = 0.0
    stock_reserved: float = 0.0
    stock_min: float = 5.0
    is_active: int = 1

class InventoryMovementModel(BaseModel):
    product_id: int
    sku: str
    type: str  # ENTRADA, SALIDA, RESERVA, LIBERACION
    quantity: float
    reference_doc: Optional[str] = None
    reference_type: Optional[str] = "AJUSTE"
    notes: Optional[str] = None

# --- Modelos Cotizaciones ---
class QuotationItemModel(BaseModel):
    sku: Optional[str] = None
    description: str
    unit: str = "UND"
    quantity: float
    unit_cost: float = 0.0
    unit_price: float
    discount_pct: float = 0.0
    margin_pct: float = 0.0
    subtotal: float

class QuotationModel(BaseModel):
    folio: Optional[str] = None
    folder_id: Optional[int] = None
    company_id: int
    client_name: str
    client_rut: str
    client_address: Optional[str] = ""
    client_contact: Optional[str] = ""
    client_email: Optional[str] = ""
    date: str
    validity_days: int = 15
    currency: str = "CLP"
    payment_terms: str = "30 días contra factura"
    delivery_time: str = "5 días hábiles"
    subtotal: float
    discount_amount: float = 0.0
    net_amount: float
    tax_amount: float
    total_amount: float
    notes: Optional[str] = ""
    type: str = "MERCADO_PUBLICO"
    tender_id: Optional[str] = None
    warranty_doc: Optional[str] = None
    status: str = "ACEPTADA"
    signature_data_url: Optional[str] = None
    signer_name: Optional[str] = None
    signer_rut: Optional[str] = None
    items: List[QuotationItemModel] = []

# --- Modelos DTE & SII ---
class DteModel(BaseModel):
    dte_type: int  # 33, 34, 61, 56, 52
    folio: int
    rut_emisor: str
    razon_social_emisor: str
    rut_receptor: str
    razon_social_receptor: str
    emission_date: str
    expiration_date: Optional[str] = None
    net_amount: float = 0.0
    exempt_amount: float = 0.0
    iva_amount: float = 0.0
    total_amount: float
    direction: str  # EMITIDO, RECIBIDO
    status_sii: str = "ACEPTADO"
    folder_id: Optional[int] = None
    quotation_id: Optional[int] = None
    source: str = "RCV"
    payment_method: Optional[str] = None
    sku: Optional[str] = None
    quantity: float = 0.0

class DteAssignFolderModel(BaseModel):
    dte_id: int
    folder_id: Optional[int] = None

# --- Modelos Bancarios ---
class BankTransactionModel(BaseModel):
    account_id: int
    transaction_date: str
    description: str
    amount: float
    transaction_type: str  # ABONO, CARGO
    balance: float = 0.0
    notes: Optional[str] = None

class ReconciliationRequestModel(BaseModel):
    transaction_id: int
    dte_id: int
    folder_id: Optional[int] = None

# --- Modelos Gestor Documental Licitaciones ---
class TenderDocumentModel(BaseModel):
    folder_id: int
    name: str
    doc_type: str = "ANEXO_DECLARACION"
    original_filename: Optional[str] = None
    form_data_json: Optional[str] = None
    signature_data_url: Optional[str] = None
    signer_name: Optional[str] = None
    signer_rut: Optional[str] = None
    status: str = "BORRADOR"
