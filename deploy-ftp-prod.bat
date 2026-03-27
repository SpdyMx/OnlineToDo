@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0deploy-ftp-prod.ps1" %*
