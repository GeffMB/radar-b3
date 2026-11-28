r=$(curl -sS "https://radar-assistente.gefersonmarques.workers.dev/tg/teste-fontes" | tr '\n' ' ' | head -c 3000)
echo "::notice::$r"
