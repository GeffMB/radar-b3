# Servidor do Assistente (Cloudflare Worker)

O chat do site conversa com este pequeno servidor, que guarda a chave do Google Gemini em segredo
e consulta a IA com busca na web. Plano gratuito da Cloudflare (100 mil pedidos por dia) e do Gemini
(modelo `gemini-2.5-flash`, busca grátis até 500 perguntas por dia).

## Proteções incluídas
- Só aceita pedidos vindos de `https://geffmb.github.io` (variável `ORIGENS`).
- Até 15 perguntas por hora e 40 por dia por visitante; teto de 400 por dia para o site inteiro.
- O IP do visitante vira um código (hash) antes de contar o limite; nenhum IP, pergunta ou resposta é gravado.
- Tamanho máximo para pergunta (500 caracteres), dados da página e histórico.
- A chave fica só no painel da Cloudflare, como segredo; não aparece no site nem no GitHub.

## Ativação (uma vez)
1. Chave do Gemini: https://aistudio.google.com/apikey → Create API key. Não cole a chave em nenhum outro lugar.
2. Cloudflare (conta grátis): Workers & Pages → Create → Worker → nome `radar-assistente` → Deploy.
3. Edit code → apague o conteúdo → cole `assistente.js` desta pasta → Deploy.
4. Settings → Variables and Secrets → Add → tipo **Secret**, nome `GEMINI_API_KEY`, valor = a chave → Deploy.
   Opcional: outro Secret `SAL` com um texto aleatório qualquer.
5. Storage & Databases → KV → Create → nome `radar-assistente-limites`.
   Volte no Worker → Settings → Bindings → Add → KV namespace → nome da variável `LIMITES` → escolha o namespace criado → Deploy.
6. Copie o endereço do Worker (ex.: `https://radar-assistente.SEU-USUARIO.workers.dev`) e coloque em
   `docs/assistente.js` (`ENDPOINT`) e no `connect-src` da Content-Security-Policy (`coletar.py`, `docs/acao.html`, `docs/comparar.html`).

## Publicação automática (GitHub → Cloudflare)
Quando `worker/assistente.js` muda no GitHub, o workflow **Publicar Assistente (Cloudflare)** publica sozinho
(configuração em `worker/wrangler.toml`). Precisa de um segredo do repositório
(Settings → Secrets and variables → Actions):
- `CLOUDFLARE_API_TOKEN`: token criado em Cloudflare → My Profile → API Tokens → Create Custom Token,
  com uma única permissão: **Account → Workers Scripts → Edit**, restrito à sua conta.
O Account ID já está em `wrangler.toml` (não é segredo; sozinho não dá acesso a nada).
Os segredos `GEMINI_API_KEY` e `SAL` ficam no Cloudflare e não são tocados. Se o token vazar, apague-o em API Tokens.

## Custos e limites
- Gemini gratuito: as perguntas podem ser usadas pelo Google para melhorar seus produtos (o site avisa no chat).
- Se o limite gratuito do Google acabar, o chat mostra "A IA atingiu o limite gratuito por agora".
- Para trocar de modelo, crie a variável `MODELO` no painel do Worker.
