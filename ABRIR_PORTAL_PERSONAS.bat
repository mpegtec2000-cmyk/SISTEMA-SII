@echo off
title FINAZIA - Portal Personas
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"

echo ========================================================
echo         INICIANDO FINAZIA - PORTAL PERSONAS
echo ========================================================
echo.
echo Iniciando servidor en http://localhost:3000/personas ...
echo.

start "" "http://localhost:3000/personas"
npm.cmd run dev
pause
