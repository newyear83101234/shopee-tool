@echo off
echo.
echo ====================================
echo   Shopee Tool - Install Native Host
echo ====================================
echo.

REM Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found!
    echo Please install Python 3 from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH"
    echo.
    pause
    exit /b 1
)
echo [OK] Python found

REM Create shared data folder
if not exist "D:\shopee-data" mkdir "D:\shopee-data"
echo [OK] D:\shopee-data folder ready

REM Run Python installer script
python "%~dp0native-host\install_helper.py" "%~dp0native-host"
if errorlevel 1 (
    echo [ERROR] Installation failed!
    pause
    exit /b 1
)

REM Write to Windows Registry
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.shopee.helper" /ve /t REG_SZ /d "%~dp0native-host\com.shopee.helper.json" /f >nul 2>&1
echo [OK] Registry updated

echo.
echo ====================================
echo   Install complete!
echo   Please restart ALL Chrome windows.
echo ====================================
echo.
pause
