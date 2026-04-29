@echo off
chcp 65001 >nul 2>&1
title Shopee Tool Updater

echo.
echo ========================================
echo   Shopee Quick Lister - Auto Update
echo ========================================
echo.

set "DOWNLOAD_URL=https://github.com/newyear83101234/shopee-tool/releases/download/latest/shopee-tool.zip"
set "TARGET_DIR=D:\shopee-tool"
set "TEMP_ZIP=%TEMP%\shopee-tool-update.zip"
set "TEMP_EXTRACT=%TEMP%\shopee-tool-update"

echo [1/4] Downloading latest version from GitHub...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; try { Invoke-WebRequest -Uri '%DOWNLOAD_URL%' -OutFile '%TEMP_ZIP%' -UseBasicParsing; Write-Host '  [OK] Download complete' -ForegroundColor Green } catch { Write-Host ('  [ERROR] Download failed: ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }"
if errorlevel 1 goto :error

echo.
echo [2/4] Extracting...
if exist "%TEMP_EXTRACT%" rmdir /s /q "%TEMP_EXTRACT%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; try { Expand-Archive -Path '%TEMP_ZIP%' -DestinationPath '%TEMP_EXTRACT%' -Force; Write-Host '  [OK] Extracted' -ForegroundColor Green } catch { Write-Host ('  [ERROR] Extract failed: ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }"
if errorlevel 1 goto :error

echo.
echo [3/4] Copying files to %TARGET_DIR%...
echo   NOTE: If files are locked, please close Chrome first.
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"
robocopy "%TEMP_EXTRACT%" "%TARGET_DIR%" /E /XF "com.shopee.helper.json" /NDL /NJH /NJS /NP /R:5 /W:2
set "RC=%ERRORLEVEL%"
echo   robocopy exit code: %RC%
if %RC% GEQ 8 goto :copyerr
echo   [OK] Files updated successfully
goto :showver

:copyerr
echo.
echo   [ERROR] robocopy failed with exit code %RC%
echo   Common causes:
echo     - Chrome is running and holding extension files (close Chrome and retry)
echo     - D:\shopee-tool needs admin permission (run BAT as administrator)
echo     - Antivirus blocking the copy
goto :error

:showver
REM Parse manifest version via PowerShell (avoids findstr matching manifest_version)
for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "$m=Get-Content '%TARGET_DIR%\manifest.json' -Raw -Encoding UTF8; $j=ConvertFrom-Json $m; $j.version"`) do set "VERSION=%%v"
echo   [INFO] Updated to version: v%VERSION%

echo.
echo [4/4] Opening Chrome extensions page...
REM Find chrome.exe via PowerShell (handles all common install paths)
powershell -NoProfile -Command "$p=@($env:LOCALAPPDATA+'\Google\Chrome\Application\chrome.exe',$env:ProgramFiles+'\Google\Chrome\Application\chrome.exe',${env:ProgramFiles(x86)}+'\Google\Chrome\Application\chrome.exe'); $c=$p|Where-Object{Test-Path $_}|Select-Object -First 1; if($c){Start-Process $c 'chrome://extensions/'}else{Write-Host '  [WARN] Chrome not found in standard paths. Please open chrome://extensions/ manually.' -ForegroundColor Yellow}"

echo.
powershell -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Write-Host ''; Write-Host '========================================' -ForegroundColor Green; Write-Host '   更新完成！請完成最後兩步：' -ForegroundColor Green; Write-Host '========================================' -ForegroundColor Green; Write-Host ''; Write-Host '  1. 在 Chrome 擴充功能頁面，找到「蝦皮快速上架助手」' -ForegroundColor Yellow; Write-Host '     點該卡片右下角的「重新整理」圖示（圓形箭頭）' -ForegroundColor Yellow; Write-Host ''; Write-Host '  2. 把蝦皮賣家中心已開啟的分頁，按 F5 重新整理' -ForegroundColor Yellow; Write-Host ''; Write-Host '========================================' -ForegroundColor Green"

del /q "%TEMP_ZIP%" 2>nul
rmdir /s /q "%TEMP_EXTRACT%" 2>nul

echo.
echo Press any key to close...
pause >nul
exit /b 0

:error
echo.
echo ========================================
echo   UPDATE FAILED
echo ========================================
echo.
echo Please screenshot the FULL window above and send to admin.
echo.
echo Press any key to close...
pause >nul
exit /b 1
