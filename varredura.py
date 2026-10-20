"""
Radar B3 — varredura de ativos (roda uma vez por mês ou na hora, pelo GitHub Actions).

Lê o arquivo oficial de cotações da B3 (COTAHIST do último mês) e acrescenta às listas do site
as ações, FIIs, ETFs e BDRs com liquidez suficiente que ainda não estão nelas:

  tickers.csv          ações (com o setor, deduzido da classificação do Yahoo)
  listas/fiis.csv      FIIs (o segmento vem do informe da CVM na coleta diária)
  listas/etfs.csv      ETFs (sem ETFs de criptomoedas)
  listas/exterior.csv  BDRs (ligados à ação americana quando ela já está na lista)

Nada é removido: ativos que deixaram de ser negociados viram comentário (#) para não gerar falhas.
O resumo da varredura fica em saida/varredura.md.

Uso:
  python varredura.py                 varre e grava
  python varredura.py --simular       só mostra o que faria
"""
from __future__ import annotations

import argparse
import csv
import io
import logging
import re
import sys
import time
import unicodedata
import zipfile
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

from coletar import ARQ_TICKERS, BASE, PASTA_SAIDA, num
from mercado import PASTA_LISTAS, baixar

log = logging.getLogger("varredura")

URL_COTAHIST = "https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_M{mes:%m%Y}.ZIP"
# média negociada por dia (R$) para entrar no site
MINIMO = {"acoes": 250_000, "fiis": 150_000, "etfs": 100_000, "bdrs": 100_000}
CRIPTO = re.compile(r"BITCOIN|BTC|ETHER|ETH\b|HASH|CRIPTO|CRYPTO|BLOCKCHAIN|DEFI|WEB3|NFT|SOLANA|\bSOL\b|XRP|META ?VERSO|"
                    r"QBTC|QETH|QDFI|QSOL|BITH|ETHE|COIN|NASDAQ CRYPTO", re.I)
CRIPTO_TICKERS = {"HASH11", "BITH11", "ETHE11", "QBTC11", "QETH11", "QDFI11", "WEB311", "SOLH11", "XRPH11", "BITI11", "DEFI11",
                  "NFTS11", "META11", "CRPT11", "BLOK11", "COIN11", "QSOL11", "BTEK11", "ETHT11", "BITS11", "NASC11"}


# ---------------------------------------------------------------- arquivo da B3

def ler_cotahist(texto: str) -> dict:
    """{ticker: {"vol": média diária R$, "bdi", "nome", "esp", "isin"}} do mercado à vista (lote padrão)."""
    vol, dias, info, pregões = defaultdict(float), defaultdict(int), {}, set()
    for l in texto.splitlines():
        if l[:2] != "01" or l[24:27] != "010":
            continue
        cod = l[12:24].strip()
        pregões.add(l[2:10])
        vol[cod] += int(l[170:188]) / 100
        dias[cod] += 1
        info[cod] = {"bdi": l[10:12], "nome": l[27:39].strip(), "esp": " ".join(l[39:49].split()), "isin": l[230:242]}
    n = max(len(pregões), 1)
    for cod, i in info.items():
        i["vol"] = vol[cod] / n
        i["dias"] = dias[cod]
    return info


def baixar_cotahist(hoje: date) -> tuple[dict, str]:
    mes = hoje.replace(day=1) - timedelta(days=1)
    for _ in range(3):                     # o arquivo do mês sai nos primeiros dias do mês seguinte
        try:
            z = zipfile.ZipFile(io.BytesIO(baixar(URL_COTAHIST.format(mes=mes), timeout=300)))
            return ler_cotahist(z.read(z.namelist()[0]).decode("latin1")), f"{mes:%m/%Y}"
        except Exception as e:
            log.warning("COTAHIST %s indisponível: %s", f"{mes:%m/%Y}", e)
            mes = mes.replace(day=1) - timedelta(days=1)
    raise RuntimeError("arquivo de cotações da B3 indisponível")


def classe(i: dict) -> str | None:
    esp, bdi = i["esp"], i["bdi"]
    if bdi == "02" and re.match(r"^(ON|PN|PNA|PNB|PNC|UNT)\b", esp):
        return "acoes"
    if bdi == "12" and esp.startswith("CI"):
        return "fiis"
    if bdi == "14" and esp.startswith("CI"):
        return "etfs"
    if bdi in ("34", "35") and re.match(r"^DR[N123]", esp):
        return "bdrs"
    return None


# ---------------------------------------------------------------- Yahoo: nome e setor

SETORES = [  # (trecho da indústria do Yahoo, setor do site) — a primeira que bater vale
    ("banks", "Bancos"), ("insurance", "Seguros e Serviços Financeiros"), ("capital markets", "Seguros e Serviços Financeiros"),
    ("financial data", "Seguros e Serviços Financeiros"), ("credit services", "Seguros e Serviços Financeiros"),
    ("asset management", "Seguros e Serviços Financeiros"), ("financial conglomerates", "Seguros e Serviços Financeiros"),
    ("regulated water", "Saneamento"), ("waste management", "Saneamento"), ("regulated gas", "Petróleo e Gás"),
    ("utilities", "Energia Elétrica"), ("telecom", "Telecom"),
    ("oil & gas", "Petróleo e Gás"), ("oil and gas", "Petróleo e Gás"),
    ("steel", "Mineração e Siderurgia"), ("metals & mining", "Mineração e Siderurgia"), ("gold", "Mineração e Siderurgia"),
    ("copper", "Mineração e Siderurgia"), ("aluminum", "Mineração e Siderurgia"), ("coal", "Mineração e Siderurgia"),
    ("paper", "Papel e Celulose"), ("lumber", "Papel e Celulose"), ("packaging", "Papel e Celulose"),
    ("chemicals", "Química e Petroquímica"), ("agricultural", "Agronegócio"), ("farm products", "Agronegócio"),
    ("beverages", "Alimentos e Bebidas"), ("packaged foods", "Alimentos e Bebidas"), ("confectioners", "Alimentos e Bebidas"),
    ("food distribution", "Alimentos e Bebidas"), ("tobacco", "Alimentos e Bebidas"),
    ("residential construction", "Construção"), ("engineering & construction", "Construção"), ("real estate - development", "Construção"),
    ("building materials", "Construção"), ("real estate services", "Shoppings"), ("reit", "Shoppings"), ("real estate", "Construção"),
    ("medical", "Saúde"), ("health", "Saúde"), ("drug", "Saúde"), ("diagnostics", "Saúde"), ("pharmaceutical retailers", "Varejo"),
    ("education", "Educação"),
    ("software", "Tecnologia"), ("information technology", "Tecnologia"), ("communication equipment", "Tecnologia"),
    ("electronic", "Tecnologia"), ("semiconductor", "Tecnologia"), ("internet content", "Tecnologia"),
    ("retail", "Varejo"), ("department stores", "Varejo"), ("grocery", "Varejo"), ("home improvement", "Varejo"),
    ("apparel", "Varejo"), ("footwear", "Varejo"), ("luxury", "Varejo"), ("personal services", "Serviços e Lazer"),
    ("airlines", "Transporte e Logística"), ("railroads", "Transporte e Logística"), ("trucking", "Transporte e Logística"),
    ("marine shipping", "Transporte e Logística"), ("integrated freight", "Transporte e Logística"), ("airports", "Transporte e Logística"),
    ("rental & leasing", "Transporte e Logística"), ("infrastructure operations", "Transporte e Logística"),
    ("restaurants", "Serviços e Lazer"), ("lodging", "Serviços e Lazer"), ("leisure", "Serviços e Lazer"), ("travel", "Serviços e Lazer"),
    ("entertainment", "Serviços e Lazer"), ("gambling", "Serviços e Lazer"), ("advertising", "Serviços e Lazer"),
    ("auto", "Indústria"), ("machinery", "Indústria"), ("aerospace", "Indústria"), ("electrical equipment", "Indústria"),
    ("industrial", "Indústria"), ("conglomerates", "Indústria"), ("building products", "Indústria"), ("textile", "Indústria"),
    ("security & protection", "Indústria"), ("staffing", "Serviços e Lazer"), ("consulting", "Serviços e Lazer"),
]
POR_SETOR_YAHOO = {"financial services": "Seguros e Serviços Financeiros", "utilities": "Energia Elétrica", "energy": "Petróleo e Gás",
                   "basic materials": "Mineração e Siderurgia", "consumer defensive": "Alimentos e Bebidas", "consumer cyclical": "Varejo",
                   "industrials": "Indústria", "healthcare": "Saúde", "technology": "Tecnologia", "real estate": "Construção",
                   "communication services": "Serviços e Lazer"}


# a página de BDRs e stocks usa setores mais amplos
SETOR_EXTERIOR = {"Bancos": "Financeiro", "Seguros e Serviços Financeiros": "Financeiro", "Energia Elétrica": "Energia",
                  "Saneamento": "Energia", "Petróleo e Gás": "Petróleo e gás", "Mineração e Siderurgia": "Mineração",
                  "Varejo": "Consumo", "Alimentos e Bebidas": "Consumo", "Educação": "Consumo", "Serviços e Lazer": "Consumo",
                  "Telecom": "Comunicação", "Indústria": "Indústria", "Construção": "Indústria", "Transporte e Logística": "Indústria",
                  "Papel e Celulose": "Indústria", "Agronegócio": "Indústria", "Química e Petroquímica": "Química",
                  "Tecnologia": "Tecnologia", "Saúde": "Saúde", "Shoppings": "Imóveis (REIT)", "Outros": "Outros"}


def setor_pt(info: dict) -> str:
    ind = (info.get("industry") or "").lower()
    for trecho, setor in SETORES:
        if trecho in ind:
            return setor
    return POR_SETOR_YAHOO.get((info.get("sector") or "").lower(), "Outros")


def info_yahoo(simbolo: str) -> dict:
    import yfinance as yf
    try:
        return yf.Ticker(simbolo).info or {}
    except Exception as e:
        log.info("   %s sem info: %s", simbolo, e)
        return {}


SUFIXOS = r"\b(S\.?\s?A\.?|S/A|INC\.?|CORP\.?|CORPORATION|CO\.?|COMPANY|LTD\.?|LIMITED|PLC|HOLDINGS?|GROUP|N\.?V\.?|AG|SE|THE|CLASS [A-C]|CIA|COMPANHIA)\b"


def nome_curto(nome: str) -> str:
    n = re.split(r"\s+-\s+|,", nome or "")[0]
    n = re.sub(SUFIXOS, " ", n, flags=re.I)
    n = " ".join(n.split()).strip(" .-")
    return n


def normalizar(s: str) -> str:
    s = unicodedata.normalize("NFD", nome_curto(s)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", s)


def titulo(nomres: str) -> str:
    return " ".join(w.capitalize() if len(w) > 2 else w for w in nomres.split())


def rotulo_classe(esp: str) -> str:
    e = esp.split()[0] if esp else ""
    return {"UNT": "Unit", "PNA": "PNA", "PNB": "PNB", "PNC": "PNC"}.get(e, e)


NAO_ETF = re.compile(r"INFRA|ISENT|INCENTIV|FIAGRO|\bFIC\b|\bCR[AI]\b|PARTICIPA|\bFIP\b|DEBENTURES? INCENT|AGROINDUSTRIA|CADEIAS PRODUTIVAS", re.I)


def categoria_etf(nome: str) -> tuple[str, str]:
    n = re.sub(r"RESPONSABILIDADE LIMITADA|FUNDO DE [IÍ]NDICE|CLASSE DE [IÍ]NDICE|EM COTAS DE.*", " ", nome.upper())
    regras = [
        (r"\bIFIX\b|\bXFIX|IMOBILI", "Fundos imobiliários"),
        (r"\bOURO\b|\bGOLD\b", "Ouro"),
        (r"IMA-?B|IRF-?M|\bPR[EÉ]\b|PR[EÉ]-?FIXAD|TESOURO|\bSELIC\b|\bLFTS?\b|\bIB5M|\bB5P|RENDA FIXA|DEBENTURE|\bCDI\b|\bIDA\b|\bTREASURY|\bBOND|\bJUROS\b|\bDI\b", "Renda fixa"),
        (r"DIVID|\bIDIV\b|\bDIVO\b|YIELD|INCOME", "Dividendos"),
        (r"\bS&P\b|SP ?500|\bSPX|NASDAQ|\bNASD|NYSE|\bEUA\b|\bUSA?\b|\bU\.S\.?|MUNDO|WORLD|\bWRLD|ACWI|GLOBAL|CHINA|EURO|JAPAN|EMERG|INTERNAC|FANG|\bDOW\b|ALL-WORLD|US LISTED|CRSP|BLOOMBERG US|\bDOLAR|\bDÓLAR", "Exterior"),
        (r"SMALL|\bSMAL|\bSMLL", "Ações Brasil"),
        (r"IBOV|IBOVESPA|\bIBRX|\bIBXX|\bIBXL|\bBR\+|BRAZIL|BRASIL|\bISE\b|ICO2|IGCT|GOVERN|MIDLARGE|IVBX|MSCI BRAZIL", "Ações Brasil"),
        (r"\bAGRO|ENERG|\bUTIL|UTILIDADE|FINANC|\bIFNC|BANC|CONSUMO|INDUST|MATERIA|SA[UÚ]DE|VAREJO|\bIMAT|\bICON\b|\bIEE|\bINDX|SEMICONDUCTOR|TECHNOLOGY|TECNOLOGIA", "Setorial"),
    ]
    for padrao, cat in regras:
        if re.search(padrao, n):
            return cat, nome_curto(nome)
    return "Outros", nome_curto(nome)


# ---------------------------------------------------------------- listas do site

def ler_csv(caminho: Path) -> tuple[list[str], list[list[str]]]:
    with open(caminho, encoding="utf-8-sig", newline="") as f:
        linhas = list(csv.reader(f, delimiter=";"))
    return linhas[0], linhas[1:]


def gravar_csv(caminho: Path, cab: list[str], linhas: list[list[str]]) -> None:
    with open(caminho, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter=";", lineterminator="\n")
        w.writerow(cab)
        w.writerows(linhas)


def ativo(t: str) -> str:
    return t.lstrip("#").strip().upper()


def varrer(hoje: date, simular=False, pausa=0.4) -> str:
    cot, mes = baixar_cotahist(hoje)
    log.info("COTAHIST %s: %d papéis no mercado à vista.", mes, len(cot))
    por_classe = defaultdict(list)
    for t, i in cot.items():
        c = classe(i)
        if c and i["vol"] >= MINIMO[c]:
            por_classe[c].append(t)
    for c in por_classe:
        por_classe[c].sort(key=lambda t: -cot[t]["vol"])
    relatorio = [f"# Varredura de ativos — {hoje:%d/%m/%Y}", "",
                 f"Base: arquivo de cotações da B3 de {mes}. Mínimos de liquidez (média por dia): " +
                 ", ".join(f"{k} R$ {v/1e3:.0f} mil" for k, v in MINIMO.items()) + ".", ""]

    # ---- ações
    cab, linhas = ler_csv(ARQ_TICKERS)
    existentes = {ativo(l[0]) for l in linhas if l}
    novas = [t for t in por_classe["acoes"] if t not in existentes]
    add = []
    irmas = {}
    for l in linhas:
        if l and len(l) >= 3 and not l[0].startswith("#"):
            irmas.setdefault(l[0][:4].upper(), l)
    for t in novas:
        if CRIPTO.search(cot[t]["nome"]):
            continue
        irma = irmas.get(t[:4])
        if irma:
            # outra classe da mesma empresa já está no site: mesmo setor e mesmo nome
            base_nome = re.sub(r"\s+(ON|PN|PNA|PNB|PNC|Unit|UNT)$", "", irma[1])
            add.append([t, f"{base_nome} {rotulo_classe(cot[t]['esp'])}", irma[2]])
            continue
        inf = info_yahoo(f"{t}.SA")
        if not (inf.get("regularMarketPrice") or inf.get("currentPrice") or inf.get("previousClose")):
            log.info("   %s sem cotação no Yahoo; fica de fora", t)
            continue
        if CRIPTO.search(f"{inf.get('longName', '')} {inf.get('industry', '')}"):
            continue
        nome = nome_curto(inf.get("longName") or inf.get("shortName") or "")
        if not nome or len(nome) > 24 or nome.isupper():
            nome = titulo(cot[t]["nome"])
        add.append([t, f"{nome} {rotulo_classe(cot[t]['esp'])}", setor_pt(inf)])
        time.sleep(pausa)
    # deixaram de ser negociadas no mês: viram comentário
    sumidas = [l[0] for l in linhas if l and not l[0].startswith("#") and l[0].upper() not in cot]
    linhas = [["#" + l[0], *l[1:]] if l and l[0] in sumidas else l for l in linhas]
    relatorio += [f"## Ações: {len(add)} incluídas", ""] + [f"- {a[0]} · {a[1]} · {a[2]}" for a in add] + [""]
    if sumidas:
        relatorio += [f"Sem negócios no mês (comentadas em tickers.csv): {', '.join(sumidas)}", ""]
    if not simular:
        gravar_csv(ARQ_TICKERS, cab, linhas + add)

    # ---- FIIs
    arq = PASTA_LISTAS / "fiis.csv"
    cab, linhas = ler_csv(arq)
    existentes = {ativo(l[0]) for l in linhas if l}
    add = [[t, ""] for t in por_classe["fiis"] if t not in existentes]
    relatorio += [f"## FIIs: {len(add)} incluídos (segmento vem da CVM)", "", ", ".join(a[0] for a in add), ""]
    if not simular:
        gravar_csv(arq, cab, linhas + add)

    # ---- ETFs (sem cripto)
    arq = PASTA_LISTAS / "etfs.csv"
    cab, linhas = ler_csv(arq)
    existentes = {ativo(l[0]) for l in linhas if l}
    add, cripto, nao_etf = [], [], []
    fiis_listados = {ativo(l[0]) for l in ler_csv(PASTA_LISTAS / "fiis.csv")[1] if l}
    for t in por_classe["etfs"]:
        if t in existentes:
            continue
        if t in CRIPTO_TICKERS or CRIPTO.search(cot[t]["nome"]):
            cripto.append(t); continue
        inf = info_yahoo(f"{t}.SA")
        nome_y = inf.get("longName") or inf.get("shortName") or cot[t]["nome"]
        if CRIPTO.search(nome_y):
            cripto.append(t); continue
        if NAO_ETF.search(f"{nome_y} {cot[t]['nome']}"):
            nao_etf.append(t); continue
        if not (inf.get("regularMarketPrice") or inf.get("previousClose")):
            continue
        if t in fiis_listados or re.search(r"\bFII\b|IMOBILI[AÁ]RIO|TERRAS AGR", f"{nome_y} {cot[t]['nome']}", re.I):
            nao_etf.append(t); continue
        cat, nome = categoria_etf(f"{nome_y} {cot[t]['nome']}")
        nome = nome_curto(nome_y)
        if len(nome) < 6 or re.match(r"^(FI )?DE [IÍ]NDICE|^FI DE", nome, re.I):
            nome = titulo(cot[t]["nome"])           # nome do Yahoo incompleto: usa o da B3
        nome = re.sub(r"\b(FUNDO DE [ÍI]NDICE|CLASSE DE [ÍI]NDICE|FUNDO DE INVESTIMENTO|EM COTAS DE.*|RESPONSABILIDADE.*)\b", "", nome, flags=re.I)
        nome = " ".join(nome.split())[:40] or titulo(cot[t]["nome"])
        add.append([t, nome, cat, nome])
        time.sleep(pausa)
    relatorio += [f"## ETFs: {len(add)} incluídos", ""] + [f"- {a[0]} · {a[1]} · {a[2]}" for a in add] + [""]
    if cripto:
        relatorio += [f"ETFs de cripto deixados de fora: {', '.join(cripto)}", ""]
    if nao_etf:
        relatorio += [f"Fundos de infraestrutura, Fiagros e similares (não são ETFs) deixados de fora: {', '.join(nao_etf)}", ""]
    if not simular:
        gravar_csv(arq, cab, linhas + add)

    # ---- BDRs (liga à ação americana quando o nome bate)
    arq = PASTA_LISTAS / "exterior.csv"
    cab, linhas = ler_csv(arq)
    existentes = {l[1].upper() for l in linhas if len(l) > 1 and l[1]}
    sem_bdr = {normalizar(l[2]): i for i, l in enumerate(linhas) if len(l) > 2 and l[0] and not l[1]}
    add, ligados = [], []
    for t in por_classe["bdrs"]:
        if t in existentes:
            continue
        inf = info_yahoo(f"{t}.SA")
        if not (inf.get("regularMarketPrice") or inf.get("previousClose")):
            continue
        nome = nome_curto(inf.get("longName") or inf.get("shortName") or titulo(cot[t]["nome"]))
        chave = normalizar(nome)
        alvo = next((i for k, i in sem_bdr.items() if k == chave or (len(k) >= 4 and len(chave) >= 4 and (k.startswith(chave) or chave.startswith(k)))), None)
        if alvo is not None:
            linhas[alvo][1] = t
            ligados.append(f"{t} → {linhas[alvo][0]}")
            sem_bdr = {k: i for k, i in sem_bdr.items() if i != alvo}
        else:
            add.append(["", t, nome[:40], SETOR_EXTERIOR.get(setor_pt(inf), "Outros")])
        time.sleep(pausa)
    relatorio += [f"## BDRs: {len(add)} incluídos, {len(ligados)} ligados a ações americanas já listadas", ""] + \
                 [f"- {a[1]} · {a[2]} · {a[3]}" for a in add] + ([""] + [f"- {x}" for x in ligados] if ligados else []) + [""]
    if not simular:
        gravar_csv(arq, cab, linhas + add)

    texto = "\n".join(relatorio)
    if not simular:
        PASTA_SAIDA.mkdir(exist_ok=True)
        (PASTA_SAIDA / "varredura.md").write_text(texto, encoding="utf-8")
    return texto


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Acrescenta às listas do site os ativos líquidos que faltam")
    p.add_argument("--simular", action="store_true", help="só mostra o que faria")
    args = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    print(varrer(date.today(), simular=args.simular))
    return 0


if __name__ == "__main__":
    sys.exit(main())
