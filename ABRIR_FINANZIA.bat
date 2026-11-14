@echo off
title FINANZIA - Servidor Web
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"

echo ========================================================
echo               INICIANDO PLATAFORMA FINANZIA
echo ========================================================
echo.
echo Iniciando servidor local en http://localhost:3000 ...
echo Por favor, no cierres esta ventana mientras uses la plataforma.
echo.

start "" "http://localhost:3000"
npm.cmd run dev
pause
