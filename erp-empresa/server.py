import os
import sys
import uvicorn

if __name__ == "__main__":
    current_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(current_dir)
    sys.path.insert(0, current_dir)
    print("==================================================================")
    print("  ERP COMERCIAL Y OPERATIVO - SERVIDOR LOCAL ACTIVO")
    print("  Acceso web en: http://localhost:8000")
    print("  Documentación API: http://localhost:8000/docs")
    print("  Presiona Ctrl+C para detener el servidor")
    print("==================================================================")
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
