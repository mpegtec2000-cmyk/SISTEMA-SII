@echo off
title ERP Comercial y Operativo - Servidor Local
echo ==============================================================
echo  INICIANDO ERP COMERCIAL Y OPERATIVO
echo ==============================================================
echo.
cd /d "%~dp0"
python -m pip install -q -r requirements.txt
echo Abriendo navegador en http://localhost:8000 ...
start http://localhost:8000
echo Iniciando servidor FastAPI con Uvicorn...
python server.py
pause
