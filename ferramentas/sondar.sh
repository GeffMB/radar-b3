me=$(curl -sS "https://api.telegram.org/bot$TG/getMe" | head -c 300)
echo "::notice::getMe -> $me"
info=$(curl -sS "https://api.telegram.org/bot$TG/getWebhookInfo" | head -c 500)
echo "::notice::webhook -> $info"
