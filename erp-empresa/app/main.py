import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db, ensure_tenant, _master_conn
from app.seed_data import populate_seed_data
from app.routers import (
    companies,
    business_folders,
    folder_workspace,
    tenders,
    quotations,
    sii,
    banking,
    inventory,
    export,
    auth,
    catalog,
    supplier_quotes,
    commercial_docs,
    integrations,
    pipeline,
    mailer,
    payments
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Inicializar Base de Datos y cargar datos de prueba al arrancar
    init_db()
    if os.environ.get("ERP_SEED_DEMO") == "1":  # Beta: sin datos de ejemplo salvo opt-in explícito
        populate_seed_data()
    auth.init_auth()
    # Migrar el esquema de las bases aisladas de las demás empresas
    with _master_conn() as c:
        ids = [r[0] for r in c.execute("SELECT id FROM companies ORDER BY id")]
    for cid in ids[1:]:
        try:
            ensure_tenant(cid)
        except Exception as e:
            print(f"[multi-empresa] No se pudo migrar la empresa {cid}: {e}")
    yield

def _load_dotenv():
    """Carga variables desde .env (raiz del proyecto) sin sobrescribir las ya definidas en el entorno."""
    p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    if not os.path.exists(p):
        return
    with open(p, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv()

app = FastAPI(
    title="ERP Comercial y Operativo",
    description="ERP integral para Mercado Público, Ventas Privadas, SII, Conciliación Bancaria y Stock",
    version="1.0.0",
    lifespan=lifespan
)

# CORS para desarrollo
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Sesión + empresa activa (debe quedar por fuera de CORS para evitar respuestas sin cabeceras)
app.add_middleware(auth.TenantMiddleware)

# Registrar Routers de la API
app.include_router(auth.router)
app.include_router(companies.router)
app.include_router(business_folders.router)
app.include_router(folder_workspace.router)
app.include_router(tenders.router)
app.include_router(quotations.router)
app.include_router(sii.router)
app.include_router(banking.router)
app.include_router(inventory.router)
app.include_router(export.router)
app.include_router(catalog.router)
app.include_router(supplier_quotes.router)
app.include_router(commercial_docs.router)
app.include_router(integrations.router)
app.include_router(pipeline.router)
app.include_router(pipeline.public_router)
app.include_router(mailer.router)
app.include_router(payments.router)

# Servir archivos estáticos
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
os.makedirs(STATIC_DIR, exist_ok=True)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.middleware("http")
async def no_cache_static(request, call_next):
    """Evita que el navegador use JS/HTML antiguos guardados en caché (la app se actualiza seguido en la Beta)."""
    resp = await call_next(request)
    if request.url.path.startswith("/static") or request.url.path in ("/", "/login"):
        resp.headers["Cache-Control"] = "no-cache, must-revalidate"
    return resp


@app.get("/login")
def read_login():
    return read_root()


@app.get("/")
def read_root():
    index_file = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"message": "ERP Comercial y Operativo backend activo. Cree el frontend en static/index.html"}
