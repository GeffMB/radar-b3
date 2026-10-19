# Radar de Ações B3

Coletor diário em Python que gera a página do radar (P/L, P/VP, DY, ROE, margem líquida e dívida líquida/EBITDA) com dados do Yahoo Finance,
e as seções de Fundos Imobiliários, Stocks, ETFs, BDRs, Índices, Commodities, Renda Fixa e Tesouro Direto (menu "Mercados" no topo).

## Como funciona no GitHub

- **Coleta automática**: o GitHub Actions roda `coletar.py` de segunda a sexta às 18:40 (Brasília) e salva os dados novos no repositório.
- **Site**: o GitHub Pages publica a pasta `docs/`. O endereço fica em Settings → Pages.
- **Rodar na hora**: aba Actions → "Coleta diária" → Run workflow.
- **Se a coleta falhar**: o GitHub manda um e-mail. O log fica na execução, em Artifacts → execucao-log. A página anterior continua no ar.
- **Incluir ou tirar ações**: edite `tickers.csv` direto no site do GitHub (ícone de lápis). A próxima coleta já usa a lista nova.
- **Incluir ou tirar FIIs, ETFs, BDRs, stocks, índices ou commodities**: edite o arquivo da pasta `listas/`.
- **Rodar só uma parte**: em Run workflow, escolha "acoes" ou "mercado".

## Rodar num PC com Windows (opcional)

1. Dê dois cliques em `instalar.bat`. Ele cria o ambiente Python, instala o `yfinance`, faz a primeira coleta e abre a página.
2. Só se não usar o GitHub Actions: dê dois cliques em `agendar.bat` para a coleta rodar sozinha de segunda a sexta às 18:40.

Depois disso, abra `docs\index.html` quando quiser ver o radar. Para atualizar na hora, dê dois cliques em `atualizar.bat`.

## Arquivos

| Arquivo | Para que serve |
|---|---|
| `tickers.csv` | Lista de ações (ticker;nome;setor). Edite no Bloco de Notas ou Excel para incluir ou tirar ações. Linhas começando com `#` são ignoradas. |
| `coletar.py` | Busca os dados, calcula os indicadores e gera as saídas. |
| `template.html` | Modelo da página. O coletor coloca os dados no lugar de `/*__DADOS__*/null`. |
| `docs/index.html` | A página pronta, com os dados do dia. |
| `docs/dados.json` | Os mesmos dados em JSON. |
| `docs/acao.html` | Página de cada ação (`acao.html?t=PETR4`): cotação de 5 anos, proventos por ano com DY, receita e lucro, indicadores comparados com a mediana do setor. |
| `docs/acoes/*.json` | Histórico de cada ação usado pela página acima. |
| `mercado.py` | Coleta as outras classes (roda depois de `coletar.py`). Cada fonte é independente: se uma cair, as outras seguem. |
| `listas/*.csv` | Ativos de cada classe: `fiis.csv` (ticker;segmento), `etfs.csv`, `exterior.csv` (stock;BDR;nome;setor), `indices.csv`, `commodities.csv`. |
| `docs/mercado.html` | Página de cada classe (`mercado.html?c=fiis`, `etfs`, `bdrs`, `stocks`, `indices`, `commodities`). |
| `docs/ativo.html` | Página de cada ativo dessas classes (`ativo.html?c=fiis&t=MXRF11`). |
| `docs/renda-fixa.html` | Selic, CDI, IPCA, poupança, Focus e simulador com IR e custódia. |
| `docs/tesouro.html` | Títulos do Tesouro Direto à venda e histórico das taxas. |
| `docs/mercado/` | Dados dessas páginas (JSON), gerados pelo `mercado.py`. |
| `saida/historico.csv` | Uma linha por ação por dia. Base para gráficos de evolução no futuro. |
| `saida/execucao.log` | Registro de cada execução e das ações que falharam. |

## Comandos úteis (no terminal, dentro da pasta)

```
.venv\Scripts\python.exe coletar.py --tickers PETR4,VALE3   # teste rápido
.venv\Scripts\python.exe coletar.py --abrir                 # coleta e abre a página
.venv\Scripts\python.exe coletar.py --sem-historico         # só o radar, mais rápido
.venv\Scripts\python.exe -m pip install -U yfinance         # se o Yahoo mudar algo e a coleta parar
```

## Visual

- `docs/estilo.css`: cores (claro e escuro), fontes e componentes compartilhados. `docs/comum.js`: formatação, logos, minigráficos e busca do topo.
- Fontes Plus Jakarta Sans (títulos) e Manrope (texto e números), servidas pelo próprio site.
- Logos: baixadas de icons.brapi.dev durante a coleta (uma vez por mês por ação), higienizadas e salvas em `docs/logos/`. Sem logo na fonte, aparece um monograma colorido com as iniciais do ticker.

## Alertas de dados suspeitos

O coletor marca com **conferir** as ações cujos números fogem do normal: DY acima de 20%, provento único acima de 12% do preço, P/VP acima de 15 ou abaixo de 0,15, P/L acima de 100, ROE ou margem acima de 100%, variação de mais de 15% no dia, salto de mais de 40% na cotação sem provento que explique (possível desdobramento/grupamento sem ajuste) e cotação parada há mais de 7 dias. As regras ficam em `alertas_indicadores` e `alertas_historico`, em `coletar.py`.

## Assistente

O botão **Assistente** abre um chat dentro do site. As perguntas, com os dados da página, vão para um servidor intermediário (Cloudflare Worker, pasta `worker/`) que consulta o Google Gemini com busca na web. A chave da IA fica só no painel da Cloudflare. Instruções de ativação em `worker/LEIA-ME.md`.

## Segurança e privacidade

- **Nada de terceiros no navegador do visitante:** fontes e biblioteca de gráficos ficam em `docs/vendor/`. Só o GitHub (hospedagem) vê o IP de quem acessa, e ele não repassa esse dado.
- **Content-Security-Policy** em todas as páginas: o navegador só executa scripts do próprio site. Os dados do radar vão num bloco JSON não executável.
- **Sem referer:** nenhum site de destino (inclusive o claude.ai, pelo Assistente) recebe o endereço de onde o visitante veio.
- **Anti-iframe:** o site não aparece se for embutido em página de terceiros (proteção contra clickjacking).
- **Textos escapados:** nomes e setores do `tickers.csv` e mensagens de alerta não viram código HTML.
- **Coleta:** sem senhas ou chaves no repositório; actions fixadas por SHA e `yfinance` em versão fixa (`requirements.txt`), para que uma atualização maliciosa de terceiros não rode aqui sem revisão. Para atualizar o yfinance, troque a versão e rode a coleta manualmente para testar.
- **Não adicione** Google Analytics, pixels, widgets ou scripts de CDN: cada um volta a enviar o IP dos visitantes para terceiros.

## Fontes das outras classes

| Dado | Fonte |
|---|---|
| Cotações, proventos e fundamentos de FIIs, ETFs, BDRs, stocks, índices e commodities | Yahoo Finance |
| Valor patrimonial, patrimônio e cotistas dos FIIs (P/VP) | Informe mensal da CVM (dados.cvm.gov.br) |
| IFIX, SMLL e IDIV (valor do dia) | B3. O histórico usa o ETF que replica cada índice (XFIX11, SMAL11, DIVO11), na escala do índice |
| CDI e Selic do dia | B3 |
| Meta Selic (Copom) e projeções do Focus | Banco Central |
| IPCA | IBGE (SIDRA) |
| TR (poupança) | Ipeadata |
| Títulos à venda e histórico das taxas | Tesouro Direto e Tesouro Transparente |

## Como os indicadores são calculados

- **P/L**: preço ÷ lucro por ação dos últimos 12 meses. Negativo quando há prejuízo.
- **P/VP**: preço ÷ valor patrimonial por ação.
- **DY 12m**: proventos pagos nos últimos 12 meses ÷ preço.
- **ROE** e **margem líquida**: como informados pelo Yahoo (12 meses).
- **Dívida líquida/EBITDA**: (dívida total − caixa) ÷ EBITDA de 12 meses. Não é calculado para bancos e seguradoras.

## Quando algo dá errado

- **Uma ação falhou**: quase sempre o ticker mudou (ex.: ELET3 virou AXIA3). Corrija em `tickers.csv`.
- **Quase todas falharam**: o Yahoo pode ter bloqueado temporariamente ou mudado a API. Espere alguns minutos e rode de novo; se persistir, atualize o yfinance (comando acima). A página do dia anterior é mantida.
- **A tarefa agendada não rodou**: o PC precisa estar ligado às 18:40. Veja `saida\execucao.log`.

Material para estudo, não é recomendação de investimento.
