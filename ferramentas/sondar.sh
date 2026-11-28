r=$(curl -sS -A "Mozilla/5.0" "https://news.google.com/rss/search?q=%22BBAS3%22+OR+%22Banco+do+Brasil%22+when:3d&hl=pt-BR&gl=BR&ceid=BR:pt-419" | head -c 2500 | tr '\n' ' ')
echo "::notice::$r"
