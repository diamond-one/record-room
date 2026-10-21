@echo off
cd /d "%~dp0"
where pythonw >nul 2>nul
if errorlevel 1 (
    start "" /min python "%~dp0launch.pyw"
) else (
    start "" pythonw "%~dp0launch.pyw"
)
