@echo off
:: DomestiK - Acceso directo para Windows
:: Este script ejecuta start.ps1 puenteando las politicas de ejecucion de Windows.
:: Simplemente haz doble clic sobre este archivo para arrancar DomestiK.

cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File start.ps1
pause
