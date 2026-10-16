@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Radar de Acoes B3: instalacao ===
echo.

where py >nul 2>nul && (set PY=py -3) || (set PY=python)
%PY% --version >nul 2>nul || (
  echo Python nao encontrado. Instale em https://www.python.org/downloads/ marcando "Add python.exe to PATH".
  pause & exit /b 1
)

if not exist .venv (
  echo Criando ambiente virtual...
  %PY% -m venv .venv || (echo Falha ao criar o ambiente virtual. & pause & exit /b 1)
)

echo Instalando dependencias...
.venv\Scripts\python.exe -m pip install --upgrade pip >nul
.venv\Scripts\python.exe -m pip install -r requirements.txt || (echo Falha ao instalar dependencias. & pause & exit /b 1)

echo.
echo Fazendo a primeira coleta (leva cerca de 1 minuto)...
.venv\Scripts\python.exe coletar.py --abrir

echo.
echo Instalacao concluida. Para atualizar todo dia automaticamente, rode agendar.bat
pause
