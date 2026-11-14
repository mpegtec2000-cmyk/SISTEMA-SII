import os
from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from app.services.excel_service import (
    generate_folder_excel,
    generate_consolidated_folders_excel,
    generate_inventory_excel
)

router = APIRouter(prefix="/api/export", tags=["Exportación"])

@router.get("/folder/{folder_id}")
def export_folder(folder_id: int):
    """
    Descarga el informe completo de rentabilidad y auditoría de la Carpeta de Negocio en Excel (.xlsx).
    """
    try:
        filepath = generate_folder_excel(folder_id)
        filename = os.path.basename(filepath)
        return FileResponse(
            path=filepath,
            filename=filename,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/consolidated-folders")
def export_consolidated():
    """
    Descarga el consolidado de todas las Carpetas de Negocio para auditoría en Excel.
    """
    try:
        filepath = generate_consolidated_folders_excel()
        filename = os.path.basename(filepath)
        return FileResponse(
            path=filepath,
            filename=filename,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/inventory")
def export_inventory():
    """
    Descarga el catálogo de productos con stock físico, reservado y disponible en Excel.
    """
    try:
        filepath = generate_inventory_excel()
        filename = os.path.basename(filepath)
        return FileResponse(
            path=filepath,
            filename=filename,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
