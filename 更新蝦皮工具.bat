@echo off
setlocal
chcp 65001 >nul 2>&1
title 蝦皮快速上架助手 - 自動更新

echo.
echo ========================================
echo   蝦皮快速上架助手 - 一鍵更新
echo ========================================
echo.

REM 下載 URL（Release tag 永遠用 latest，URL 不會變）
set "DOWNLOAD_URL=https://github.com/newyear83101234/shopee-tool/releases/download/latest/shopee-tool.zip"
set "TARGET_DIR=D:\shopee-tool"
set "TEMP_ZIP=%TEMP%\shopee-tool-update.zip"
set "TEMP_EXTRACT=%TEMP%\shopee-tool-update"

echo [1/4] 下載最新版本...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -Uri '%DOWNLOAD_URL%' -OutFile '%TEMP_ZIP%' -UseBasicParsing; Write-Host '[OK] 下載完成' -ForegroundColor Green } catch { Write-Host ('[ERROR] 下載失敗: ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }"
if errorlevel 1 goto :error

echo.
echo [2/4] 解壓縮...
if exist "%TEMP_EXTRACT%" rmdir /s /q "%TEMP_EXTRACT%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Expand-Archive -Path '%TEMP_ZIP%' -DestinationPath '%TEMP_EXTRACT%' -Force; Write-Host '[OK] 解壓完成' -ForegroundColor Green } catch { Write-Host ('[ERROR] 解壓失敗: ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }"
if errorlevel 1 goto :error

echo.
echo [3/4] 覆蓋更新到 %TARGET_DIR%（保留你的 Native Host 設定）...
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"
robocopy "%TEMP_EXTRACT%" "%TARGET_DIR%" /E /XF "com.shopee.helper.json" /NDL /NJH /NJS /NP /R:2 /W:1 >nul
if %errorlevel% GEQ 8 (
    echo [ERROR] 檔案複製失敗（exit code %errorlevel%）
    goto :error
)
echo [OK] 程式檔已更新

REM 顯示新版本號
for /f "tokens=2 delims=:," %%a in ('findstr /c:"\"version\"" "%TARGET_DIR%\manifest.json"') do set "VERSION=%%a"
set "VERSION=%VERSION:"=%"
set "VERSION=%VERSION: =%"
echo [INFO] 已更新到版本：v%VERSION%

echo.
echo [4/4] 開啟 Chrome 擴充功能管理頁面...
start "" "chrome://extensions/"

echo.
echo ========================================
echo   ✓ 更新完成！請完成最後兩步：
echo ========================================
echo   1. 在 Chrome 擴充功能頁面，找到「蝦皮快速上架助手」
echo      點卡片右下角的【🔄 重新整理】圖示
echo.
echo   2. 把蝦皮賣家中心已開啟的分頁，按 F5 重新整理
echo ========================================
echo.

REM 清理暫存
del /q "%TEMP_ZIP%" 2>nul
rmdir /s /q "%TEMP_EXTRACT%" 2>nul

echo 按任意鍵關閉...
pause >nul
exit /b 0

:error
echo.
echo ========================================
echo   ✗ 更新失敗，請聯絡阿葉
echo ========================================
pause
exit /b 1
