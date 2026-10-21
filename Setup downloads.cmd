@echo off
cd /d "%~dp0"
if not exist "tools\tmp" mkdir "tools\tmp"
set "TMP=%~dp0tools\tmp"
set "TEMP=%~dp0tools\tmp"
python -m pip install --no-cache-dir --upgrade --target tools/python "yt-dlp[default]"
if errorlevel 1 goto end
where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo FFmpeg is also required. Install it from https://ffmpeg.org/download.html
) else (
  echo Download tools are ready. Restart Record Room.
)
:end
pause
