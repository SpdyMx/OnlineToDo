@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0deploy-ftp-beta.ps1" %*
