# Radar de Ações B3

Coletor diário em Python que gera a página do radar (P/L, P/VP, DY, ROE, margem líquida e dívida líquida/EBITDA) com dados do Yahoo Finance.

## Primeira vez

1. Dê dois cliques em `instalar.bat`. Ele cria o ambiente Python, instala o `yfinance`, faz a primeira coleta e abre a página.
2. Dê dois cliques em `agendar.bat` para a coleta rodar sozinha de segunda a sexta às 18:40.

Depois disso, abra `docs\index.html` quando quiser ver o radar. Para atualizar na hora, dê dois cliques em `atualizar.bat`.

## Arquivos

| Arquivo | Para que serve |
|---|---|
| `tickers.csv` | Lista de ações (ticker;nome;setor). Edite no Bloco de Notas ou Excel para incluir ou tirar ações. Linhas começando com `#` são ignoradas. |
| `coletar.py` | Busca os dados, calcula os indicadores e gera as saídas. |
| `template.html` | Modelo da página. O coletor coloca os dados no lugar de `/*__DADOS__*/null`. |
| `docs/index.html` | A página pronta, com os dados do dia. |
| `docs/dados.json` | Os mesmos dados em JSON. |
| `saida/historico.csv` | Uma linha por ação por dia. Base para gráficos de evolução no futuro. |
| `saida/execucao.log` | Registro de cada execução e das ações que falharam. |

## Comandos úteis (no terminal, dentro da pasta)

```
.venv\Scripts\python.exe coletar.py --tickers PETR4,VALE3   # teste rápido
.venv\Scripts\python.exe coletar.py --abrir                 # coleta e abre a página
.venv\Scripts\python.exe -m pip install -U yfinance         # se o Yahoo mudar algo e a coleta parar
```

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
