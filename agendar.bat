@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Cria a tarefa "Radar B3" para rodar de segunda a sexta as 18:40, depois do fechamento da B3.
rem Para mudar o horario, troque 18:40 abaixo e rode este arquivo de novo.

schtasks /Create /F /TN "Radar B3" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 18:40 /TR "\"%~dp0atualizar.bat\""
if errorlevel 1 (
  echo Nao foi possivel criar a tarefa.
) else (
  echo Tarefa "Radar B3" criada: roda de segunda a sexta as 18:40.
  echo Se o PC estiver desligado nesse horario, a coleta fica para o proximo dia.
  echo Para remover: schtasks /Delete /TN "Radar B3" /F
)
pause
