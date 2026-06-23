@echo off
setlocal

set "APP_EXE=XSafeClaw.exe"
set "USER_INSTALL=%LOCALAPPDATA%\Programs\XSafeClaw\%APP_EXE%"
set "MACHINE_INSTALL=%ProgramFiles%\XSafeClaw\%APP_EXE%"
set "MACHINE_INSTALL_X86=%ProgramFiles(x86)%\XSafeClaw\%APP_EXE%"

if exist "%USER_INSTALL%" (
  start "" "%USER_INSTALL%"
  exit /b 0
)

if exist "%MACHINE_INSTALL%" (
  start "" "%MACHINE_INSTALL%"
  exit /b 0
)

if exist "%MACHINE_INSTALL_X86%" (
  start "" "%MACHINE_INSTALL_X86%"
  exit /b 0
)

echo XSafeClaw is not installed yet.
echo Please run the XSafeClaw setup.exe produced by CI or a release package first.
pause
exit /b 1
