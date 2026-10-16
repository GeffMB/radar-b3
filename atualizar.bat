@echo off
rem Executado pelo Agendador de Tarefas. Tambem pode ser rodado na mao com dois cliques.
cd /d "%~dp0"
.venv\Scripts\python.exe coletar.py %*
