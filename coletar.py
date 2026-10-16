"""
Radar de Ações B3 — coletor diário.

Baixa cotação e fundamentos das ações listadas em tickers.csv (fonte: Yahoo Finance,
via biblioteca yfinance), calcula os indicadores e gera:

  docs/index.html      página do radar com os dados embutidos (abra no navegador)
  docs/dados.json      os mesmos dados em JSON
  docs/acoes/XXXX.json cotação de 5 anos, proventos e resultados de cada ação (usado por docs/acao.html)
  saida/historico.csv  uma linha por ação por dia, para análises e gráficos futuros
  saida/execucao.log   registro de cada execução e das falhas

Uso:
  python coletar.py                      coleta todas as ações de tickers.csv
  python coletar.py --tickers PETR4,VALE3  coleta só algumas (teste rápido)
  python coletar.py --abrir              abre a página no navegador ao terminar
"""
from __future__ import annotations

import argparse
import csv
import json
import logging
import math
import sys
import time
import webbrowser
from datetime import datetime, timezone, timedelta
from pathlib import Path

BASE = Path(__file__).resolve().parent
ARQ_TICKERS = BASE / "tickers.csv"
ARQ_TEMPLATE = BASE / "template.html"
PASTA_DOCS = BASE / "docs"
PASTA_SAIDA = BASE / "saida"
FUSO_BR = timezone(timedelta(hours=-3))

# Setores em que dívida líquida/EBITDA não faz sentido (dívida é a matéria-prima do negócio)
SETORES_SEM_ALAVANCAGEM = {"Bancos", "Seguros e Serviços Financeiros"}
# Mas a B3 é empresa operacional comum e o indicador vale para ela
EXCECOES_ALAVANCAGEM = {"B3SA3"}

CABECALHO_HTML = (
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1"></head>\n'
)

PAUSA_ENTRE_ACOES = 0.4   # segundos; evita bloqueio do Yahoo por excesso de pedidos
TENTATIVAS = 3

log = logging.getLogger("radar")


# ---------------------------------------------------------------- utilidades

def num(x):
    """Converte para float; devolve None para vazio, NaN, infinito ou texto."""
    if x is None or isinstance(x, bool):
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def ler_tickers(filtro: set[str] | None = None) -> list[dict]:
    with open(ARQ_TICKERS, encoding="utf-8-sig", newline="") as f:
        linhas = [
            {k.strip(): (v or "").strip() for k, v in row.items()}
            for row in csv.DictReader(f, delimiter=";")
        ]
    linhas = [l for l in linhas if l.get("ticker") and not l["ticker"].startswith("#")]
    if filtro:
        linhas = [l for l in linhas if l["ticker"].upper() in filtro]
    return linhas


# ---------------------------------------------------------------- coleta

def buscar_info(ticker: str) -> dict:
    """Busca o dicionário de dados do Yahoo para um ticker da B3."""
    import yfinance as yf  # importado aqui para os testes rodarem sem a biblioteca
    return yf.Ticker(f"{ticker}.SA").info or {}


def normalizar_dy(info: dict) -> float | None:
    """DY dos últimos 12 meses, sempre como fração (0.064 = 6,4%).

    O Yahoo traz dois campos e o yfinance já mudou a escala de um deles entre versões:
    - trailingAnnualDividendYield: proventos pagos em 12 meses ÷ preço (fração). Preferido.
    - dividendYield: às vezes fração, às vezes em % (6.39). Usado só se o primeiro faltar.
    """
    dy_t = num(info.get("trailingAnnualDividendYield"))
    if dy_t is not None and dy_t > 0:
        return dy_t
    dy = num(info.get("dividendYield"))
    if dy is None:
        return 0.0 if dy_t == 0 else None
    return dy / 100 if dy > 0.5 else dy


def montar_acao(base: dict, info: dict) -> dict | None:
    t = base["ticker"].upper()
    preco = num(info.get("regularMarketPrice")) or num(info.get("currentPrice"))
    if preco is None:
        return None
    anterior = num(info.get("regularMarketPreviousClose")) or num(info.get("previousClose"))
    lpa = num(info.get("trailingEps"))
    pl = num(info.get("trailingPE"))
    if pl is None and lpa:                     # Yahoo omite P/L quando há prejuízo
        pl = preco / lpa
    divida = num(info.get("totalDebt"))
    caixa = num(info.get("totalCash"))
    ebitda = num(info.get("ebitda"))

    sem_alav = base["setor"] in SETORES_SEM_ALAVANCAGEM and t not in EXCECOES_ALAVANCAGEM
    if sem_alav:
        div_liq = dle = None
    else:
        div_liq = divida - caixa if divida is not None and caixa is not None else None
        dle = div_liq / ebitda if div_liq is not None and ebitda else None

    return {
        "t": t,
        "n": base.get("nome") or info.get("shortName") or t,
        "setor": base.get("setor") or "Outros",
        "preco": preco,
        "var": (preco / anterior - 1) if anterior else None,
        "mc": num(info.get("marketCap")),
        "pl": pl,
        "pvp": num(info.get("priceToBook")),
        "dy": normalizar_dy(info),
        "roe": num(info.get("returnOnEquity")),
        "ml": num(info.get("profitMargins")),
        "div": None if sem_alav else divida,
        "cx": None if sem_alav else caixa,
        "ebitda": None if sem_alav else ebitda,
        "dl": div_liq,
        "dle": dle,
        "lpa": lpa,
        "moeda_dre": info.get("financialCurrency"),
        "receita12m": num(info.get("totalRevenue")),
        "banco": base.get("setor") == "Bancos",
        "fin": sem_alav,
    }


def coletar(tickers: list[dict], buscar=buscar_info, pausa=PAUSA_ENTRE_ACOES):
    acoes, falhas = [], []
    for i, base in enumerate(tickers, 1):
        t = base["ticker"].upper()
        ultimo_erro = "sem cotação"
        for tentativa in range(1, TENTATIVAS + 1):
            try:
                acao = montar_acao(base, buscar(t))
                if acao:
                    acoes.append(acao)
                    log.info("[%d/%d] %s ok", i, len(tickers), t)
                    break
                ultimo_erro = "sem cotação (ticker mudou ou foi deslistado?)"
                break                             # não adianta repetir
            except Exception as e:                # rede, limite de pedidos, resposta inválida
                ultimo_erro = f"{type(e).__name__}: {e}"
                if tentativa < TENTATIVAS:
                    time.sleep(2 * tentativa)
        if not any(a["t"] == t for a in acoes):
            falhas.append({"t": t, "motivo": ultimo_erro})
            log.warning("[%d/%d] %s falhou: %s", i, len(tickers), t, ultimo_erro)
        if pausa:
            time.sleep(pausa)
    return acoes, falhas


# ---------------------------------------------------------------- detalhe por ação

ANOS_PRECO = 5          # cotação diária guardada na página da ação
ANOS_PROVENTOS = 10     # proventos e DY anual


def anos_atras(d, n):
    """Mesma data n anos antes (29/02 vira 28/02)."""
    try:
        return d.replace(year=d.year - n)
    except ValueError:
        return d.replace(year=d.year - n, day=28)


def arred2(x):
    return None if x is None else round(x, 2)


def buscar_detalhe(ticker: str) -> dict:
    """Busca no Yahoo o histórico de preços, os proventos e o resultado anual."""
    import yfinance as yf
    tk = yf.Ticker(f"{ticker}.SA")
    hist = tk.history(period=f"{ANOS_PROVENTOS}y", interval="1d", auto_adjust=False, actions=False)
    precos = [(idx.date(), num(c)) for idx, c in hist["Close"].items()] if len(hist) else []
    divs = tk.dividends
    proventos = [(idx.date(), num(v)) for idx, v in divs.items()] if divs is not None and len(divs) else []
    resultados = {}
    try:
        dre = tk.income_stmt              # colunas = fim de cada exercício
        if dre is not None and not dre.empty:
            for col in dre.columns:
                ano = col.year
                def linha(*nomes):
                    for n in nomes:
                        if n in dre.index:
                            return num(dre.at[n, col])
                    return None
                resultados[ano] = {
                    "receita": linha("Total Revenue", "Operating Revenue"),
                    "lucro": linha("Net Income Common Stockholders", "Net Income"),
                }
    except Exception as e:                # resultado é opcional; não derruba a ação
        log.info("   %s sem DRE anual: %s", ticker, e)
    extras = {}
    for chave, attr, nomes in [
        ("lucro_anual", "income_stmt", LINHAS_LUCRO),
        ("lucro_tri", "quarterly_income_stmt", LINHAS_LUCRO),
        ("pl_anual", "balance_sheet", LINHAS_PATRIMONIO),
        ("pl_tri", "quarterly_balance_sheet", LINHAS_PATRIMONIO),
    ]:
        try:
            extras[chave] = extrair_linha(getattr(tk, attr), nomes)
        except Exception as e:            # opcional: sem isso, só o gráfico de P/L ou P/VP fica de fora
            log.info("   %s sem %s: %s", ticker, attr, e)
            extras[chave] = []
    return {"precos": precos, "proventos": proventos, "resultados": resultados, **extras}


LINHAS_LUCRO = ("Net Income Common Stockholders", "Net Income")
LINHAS_PATRIMONIO = ("Common Stock Equity", "Stockholders Equity", "Total Equity Gross Minority Interest")


def extrair_linha(df, nomes) -> list:
    """[(data_fim_do_período, valor)] da primeira linha encontrada de uma tabela do yfinance."""
    if df is None or df.empty:
        return []
    for n in nomes:
        if n in df.index:
            out = [(col.date(), num(df.at[n, col])) for col in df.columns]
            return sorted((d, v) for d, v in out if v is not None)
    return []


def montar_detalhe(acao: dict, bruto: dict, hoje) -> dict | None:
    precos = [(d, c) for d, c in bruto.get("precos", []) if c is not None]
    if not precos:
        return None
    precos.sort()
    # o último preço do histórico pode ser de ontem; o preço do dia vem do radar
    if precos[-1][0] < hoje:
        precos.append((hoje, acao["preco"]))
    elif precos[-1][0] == hoje:
        precos[-1] = (hoje, acao["preco"])

    corte = anos_atras(hoje, ANOS_PRECO)
    serie = [(d, c) for d, c in precos if d >= corte]

    # fechamento do último pregão de cada ano, para o DY anual
    fech_ano = {}
    for d, c in precos:
        fech_ano[d.year] = c

    provs = sorted((d, v) for d, v in bruto.get("proventos", []) if v and v > 0)
    primeiro_ano = hoje.year - ANOS_PROVENTOS + 1
    por_ano = {}
    for d, v in provs:
        if d.year >= primeiro_ano:
            por_ano[d.year] = por_ano.get(d.year, 0.0) + v
    anos = list(range(max(primeiro_ano, min(por_ano) if por_ano else hoje.year), hoje.year + 1))
    anual = []
    for a in anos:
        total = por_ano.get(a, 0.0)
        preco_ref = acao["preco"] if a == hoje.year else fech_ano.get(a)
        anual.append({
            "ano": a,
            "total": round(total, 4),
            "dy": round(total / preco_ref, 4) if preco_ref else None,
            "parcial": a == hoje.year,
        })

    res = bruto.get("resultados") or {}
    resultados = [
        {"ano": a, "receita": res[a].get("receita"), "lucro": res[a].get("lucro")}
        for a in sorted(res)
        if res[a].get("receita") is not None or res[a].get("lucro") is not None
    ]

    ult12 = [(d, v) for d, v in provs if d > anos_atras(hoje, 1)]
    return {
        "t": acao["t"],
        "precos": {
            "d": [d.isoformat() for d, _ in serie],
            "c": [round(c, 2) for _, c in serie],
        },
        "max52": arred2(max((c for d, c in precos if d > anos_atras(hoje, 1)), default=None)),
        "min52": arred2(min((c for d, c in precos if d > anos_atras(hoje, 1)), default=None)),
        "proventos_anual": anual,
        "proventos": [[d.isoformat(), round(v, 6)] for d, v in provs[-40:]][::-1],
        "proventos_12m": round(sum(v for _, v in ult12), 4),
        "resultados": resultados,
    }


PRAZO_ANUAL = 90        # dias após o fim do exercício até o balanço anual ser publicado (DFP)
PRAZO_TRIMESTRAL = 45   # idem para o trimestral (ITR)


def _disponivel(eventos):
    """Ordena [(data_em_que_ficou_público, valor)] e devolve uma função data -> último valor conhecido."""
    eventos = sorted(eventos)
    datas = [d for d, _ in eventos]
    import bisect
    def valor_em(d):
        i = bisect.bisect_right(datas, d) - 1
        return eventos[i][1] if i >= 0 else None
    return valor_em


def serie_lucro_12m(anual, tri, fx):
    """Lucro dos 12 meses conhecido em cada data: exercícios anuais e somas de 4 trimestres seguidos."""
    conv = lambda d, v: v * fx[d.year] if fx else v
    ev = [(d + timedelta(days=PRAZO_ANUAL), conv(d, v)) for d, v in anual]
    tri = sorted(tri)
    for i in range(3, len(tri)):
        janela = tri[i - 3:i + 1]
        if 250 <= (janela[-1][0] - janela[0][0]).days <= 300:     # 4 trimestres consecutivos
            ev.append((janela[-1][0] + timedelta(days=PRAZO_TRIMESTRAL), sum(conv(d, v) for d, v in janela)))
    return _disponivel(ev)


def serie_patrimonio(anual, tri, fx):
    conv = lambda d, v: v * fx[d.year] if fx else v
    ev = [(d + timedelta(days=PRAZO_ANUAL), conv(d, v)) for d, v in anual]
    ev += [(d + timedelta(days=PRAZO_TRIMESTRAL), conv(d, v)) for d, v in tri]
    return _disponivel(ev)


def montar_multiplos(acao: dict, bruto: dict, hoje, fx) -> dict | None:
    """DY 12m, P/L e P/VP no fim de cada mês, reconstruídos com preços, proventos e balanços.

    Valor de mercado em cada data = valor de mercado de hoje x (preço na data / preço de hoje).
    O lucro e o patrimônio usados em cada data são os últimos já publicados naquela data.
    """
    precos = sorted((d, c) for d, c in bruto.get("precos", []) if c)
    if not precos:
        return None
    if precos[-1][0] < hoje:
        precos.append((hoje, acao["preco"]))
    fim_mes = {}
    for d, c in precos:
        fim_mes[(d.year, d.month)] = (d, c)
    pontos = [fim_mes[k] for k in sorted(fim_mes)]
    if len(pontos) < 13:
        return None

    provs = sorted((d, v) for d, v in bruto.get("proventos", []) if v and v > 0)
    lucro = serie_lucro_12m(bruto.get("lucro_anual", []), bruto.get("lucro_tri", []), fx) if fx is not None else (lambda d: None)
    patr = serie_patrimonio(bruto.get("pl_anual", []), bruto.get("pl_tri", []), fx) if fx is not None else (lambda d: None)
    mc0, p0 = acao.get("mc"), acao["preco"]

    meses, dy, pl, pvp = [], [], [], []
    inicio_prov = provs[0][0] if provs else None
    for d, c in pontos:
        um_ano = anos_atras(d, 1)
        soma = sum(v for dd, v in provs if um_ano < dd <= d)
        # sem proventos registrados antes da data, o DY daquele mês é desconhecido (não zero)
        dy.append(round(soma / c, 4) if inicio_prov and inicio_prov <= d else None)
        mc = mc0 * c / p0 if mc0 else None
        L, PL = lucro(d), patr(d)
        pl.append(round(mc / L, 2) if mc and L and L > 0 else None)
        pvp.append(round(mc / PL, 3) if mc and PL and PL > 0 else None)
        meses.append(f"{d.year}-{d.month:02d}")

    # Ações em units (ex.: SANB11) podem ter o valor de mercado do Yahoo em outra base.
    # Se o último ponto destoar muito do indicador atual, recalibra a série inteira.
    obs = []
    for serie, atual, nome in ((pl, acao.get("pl"), "P/L"), (pvp, acao.get("pvp"), "P/VP")):
        ult = serie[-1]
        if ult and atual and atual > 0:
            k = atual / ult
            if not 0.6 <= k <= 1.6:
                for i, v in enumerate(serie):
                    if v is not None:
                        serie[i] = round(v * k, 3)
                obs.append(f"{nome} recalibrado pelo valor atual do Yahoo (fator {k:.2f})")
    if obs:
        log.info("   %s: %s", acao["t"], "; ".join(obs))

    if not any(v is not None for v in pl + pvp + dy):
        return None
    return {"m": meses, "dy": dy, "pl": pl, "pvp": pvp}


_CAMBIO = {}


def cambio_medio_anual(moeda: str) -> dict:
    """Média anual da cotação moeda→BRL (ex.: USD → {2024: 5.39, ...}). Busca uma vez por execução."""
    if moeda not in _CAMBIO:
        import yfinance as yf
        h = yf.Ticker(f"{moeda}BRL=X").history(period="12y", interval="1d")
        medias = {}
        if len(h):
            for ano, grupo in h["Close"].groupby(h.index.year):
                v = num(grupo.mean())
                if v:
                    medias[int(ano)] = v
        _CAMBIO[moeda] = medias
    return _CAMBIO[moeda]


def ajustar_moeda_resultados(det: dict, acao: dict, cambio=cambio_medio_anual):
    """Algumas empresas (ex.: Petrobras) têm a DRE anual em dólar no Yahoo. Converte para reais.

    Sinais de que a DRE não está em reais:
    - o Yahoo informa financialCurrency diferente de BRL; ou
    - a receita de 12 meses (em reais, no resumo) é 3,5 a 8 vezes a receita do último ano da DRE,
      faixa compatível com o dólar entre R$ 3,50 e R$ 8,00.
    """
    """Devolve {ano: taxa} quando converteu, {} quando já está em reais e None se não deu para converter."""
    res = det.get("resultados") or []
    moeda = (acao.get("moeda_dre") or "BRL").upper()
    if moeda == "BRL":
        ult = next((r["receita"] for r in reversed(res) if r.get("receita")), None)
        r12 = acao.get("receita12m")
        if ult and r12 and ult > 0 and 3.5 <= r12 / ult <= 8:
            moeda = "USD"
    if moeda == "BRL":
        return {}
    try:
        fx = cambio(moeda)
    except Exception as e:
        log.warning("   %s: DRE em %s e câmbio indisponível (%s); mantendo valores originais", acao["t"], moeda, e)
        det["resultados_moeda"] = moeda
        return None
    ultimo_fx = fx[max(fx)] if fx else None
    for r in res:
        taxa = fx.get(r["ano"], ultimo_fx)
        if taxa is None:
            det["resultados_moeda"] = moeda
            return None
        for k in ("receita", "lucro"):
            if r.get(k) is not None:
                r[k] = r[k] * taxa
    det["resultados_convertidos_de"] = moeda
    log.info("   %s: DRE convertida de %s para BRL pelo câmbio médio de cada ano", acao["t"], moeda)
    return {a: fx.get(a, ultimo_fx) for a in range(2000, 2100) if fx.get(a, ultimo_fx)}


def coletar_detalhes(acoes: list[dict], hoje, buscar=buscar_detalhe, pausa=PAUSA_ENTRE_ACOES):
    """Gera docs/acoes/<TICKER>.json. Se uma ação falhar, mantém o arquivo anterior."""
    pasta = PASTA_DOCS / "acoes"
    pasta.mkdir(parents=True, exist_ok=True)
    falhas = []
    for i, acao in enumerate(acoes, 1):
        t = acao["t"]
        erro = None
        for tentativa in range(1, TENTATIVAS + 1):
            try:
                bruto = buscar(t)
                det = montar_detalhe(acao, bruto, hoje)
                if det is None:
                    erro = "sem histórico de preços"
                    break
                fx = ajustar_moeda_resultados(det, acao)
                det["multiplos"] = montar_multiplos(acao, bruto, hoje, fx)
                (pasta / f"{t}.json").write_text(
                    json.dumps(det, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
                erro = None
                break
            except Exception as e:
                erro = f"{type(e).__name__}: {e}"
                if tentativa < TENTATIVAS:
                    time.sleep(2 * tentativa)
        if erro:
            falhas.append(t)
            log.warning("[%d/%d] histórico de %s falhou: %s", i, len(acoes), t, erro)
        else:
            log.info("[%d/%d] histórico de %s ok", i, len(acoes), t)
        if pausa:
            time.sleep(pausa)
    return falhas


# ---------------------------------------------------------------- saídas

def arredondar(acao: dict) -> dict:
    out = {}
    for k, v in acao.items():
        out[k] = float(f"{v:.6g}") if isinstance(v, float) else v
    return out


def decimal_br(v, inteiro=False) -> str:
    """Número com vírgula decimal, para o Excel em português abrir o CSV direto."""
    if v is None:
        return ""
    if inteiro:
        return str(round(v))
    return f"{v:.6f}".rstrip("0").rstrip(".").replace(".", ",")


def salvar(acoes: list[dict], falhas: list[dict], agora: datetime) -> Path:
    PASTA_DOCS.mkdir(exist_ok=True)
    PASTA_SAIDA.mkdir(exist_ok=True)
    payload = {
        "atualizado_em": agora.isoformat(timespec="minutes"),
        "fonte": "Yahoo Finance (via yfinance)",
        "falhas": falhas,
        "acoes": [arredondar(a) for a in acoes],
    }
    dados = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    (PASTA_DOCS / "dados.json").write_text(dados, encoding="utf-8")

    template = ARQ_TEMPLATE.read_text(encoding="utf-8")
    marcador = "/*__DADOS__*/null"
    if marcador not in template:
        raise RuntimeError("template.html sem o marcador /*__DADOS__*/null")
    # </ dentro do JSON fecharia a tag <script>; escapar evita isso
    pagina = template.replace(marcador, dados.replace("</", "<\\/"))
    if not pagina.lstrip().lower().startswith("<!doctype"):
        pagina = CABECALHO_HTML + pagina
    destino = PASTA_DOCS / "index.html"
    destino.write_text(pagina, encoding="utf-8")

    hist = PASTA_SAIDA / "historico.csv"
    novo = not hist.exists()
    data = agora.date().isoformat()
    campos = ["data", "ticker", "preco", "pl", "pvp", "dy", "roe", "ml", "dle", "mc"]
    # se já rodou hoje, substitui as linhas do dia em vez de duplicar
    linhas_antigas = []
    if not novo:
        with open(hist, encoding="utf-8", newline="") as f:
            linhas_antigas = [r for r in csv.DictReader(f, delimiter=";") if r["data"] != data]
    with open(hist, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=campos, delimiter=";")
        w.writeheader()
        w.writerows(linhas_antigas)
        for a in acoes:
            w.writerow({"data": data, "ticker": a["t"], **{
                k: decimal_br(a.get(k), inteiro=(k == "mc")) for k in campos[2:]
            }})
    return destino


# ---------------------------------------------------------------- principal

def configurar_log():
    PASTA_SAIDA.mkdir(exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%Y-%m-%d %H:%M:%S")
    arq = logging.FileHandler(PASTA_SAIDA / "execucao.log", encoding="utf-8")
    arq.setFormatter(fmt)
    tela = logging.StreamHandler(sys.stdout)
    tela.setFormatter(logging.Formatter("%(message)s"))
    log.setLevel(logging.INFO)
    log.handlers[:] = [arq, tela]


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Coleta os dados do Radar de Ações B3")
    p.add_argument("--tickers", help="lista separada por vírgula, ex.: PETR4,VALE3")
    p.add_argument("--abrir", action="store_true", help="abre a página ao terminar")
    p.add_argument("--sem-historico", action="store_true",
                   help="pula cotação histórica e proventos (mais rápido)")
    args = p.parse_args(argv)

    configurar_log()
    filtro = {x.strip().upper() for x in args.tickers.split(",")} if args.tickers else None
    tickers = ler_tickers(filtro)
    if not tickers:
        log.error("Nenhum ticker encontrado em tickers.csv%s", " com esse filtro" if filtro else "")
        return 2

    log.info("Coletando %d ações...", len(tickers))
    inicio = time.time()
    acoes, falhas = coletar(tickers)

    if not acoes:
        log.error("Nenhuma ação coletada. A página anterior foi mantida. Verifique a internet ou atualize o yfinance: pip install -U yfinance")
        return 1

    agora = datetime.now(FUSO_BR)
    destino = salvar(acoes, falhas, agora)
    log.info("Radar: %d ações, %d falhas, %.0fs.", len(acoes), len(falhas), time.time() - inicio)
    if falhas:
        log.info("Falharam: %s", ", ".join(f["t"] for f in falhas))

    if not args.sem_historico:
        log.info("Coletando histórico de cotação, proventos e resultados...")
        falhas_det = coletar_detalhes(acoes, agora.date())
        log.info("Histórico: %d ok, %d falhas.", len(acoes) - len(falhas_det), len(falhas_det))
    log.info("Pronto em %.0fs. Página: %s", time.time() - inicio, destino)
    if args.abrir:
        webbrowser.open(destino.as_uri())
    # mais da metade falhando indica problema na fonte, não em tickers isolados
    return 1 if len(falhas) > len(tickers) / 2 else 0


if __name__ == "__main__":
    sys.exit(main())
