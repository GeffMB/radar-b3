"""
Radar B3 — coletor das outras classes de ativos (roda depois de coletar.py).

Gera em docs/mercado/:
  fiis.json, etfs.json, bdrs.json, stocks.json, indices.json, commodities.json   lista de cada classe
  <classe>/<ID>.json        cotação de 5 anos, proventos e retornos de cada ativo
  rendafixa.json            Selic, CDI, IPCA, poupança e projeções do Focus
  tesouro.json              títulos do Tesouro Direto à venda e histórico das taxas
  menu.json                 ativos populares de cada classe (menu do topo)

Fontes: Yahoo Finance (yfinance), CVM (patrimônio dos FIIs), B3 (IFIX, SMLL, IDIV, CDI e Selic),
Banco Central (decisões do Copom e Focus), IBGE (IPCA) e Tesouro Direto / Tesouro Transparente.
Cada parte é independente: se uma fonte falhar, as outras seguem e a página mostra o que houver.

Uso:
  python mercado.py                       tudo
  python mercado.py --so fiis,tesouro     só algumas partes
"""
from __future__ import annotations

import argparse
import base64
import csv
import io
import json
import logging
import sys
import time
import urllib.request
import zipfile
from datetime import date, datetime, timedelta
from pathlib import Path

from coletar import (BASE, FUSO_BR, PASTA_DOCS, PASTA_SAIDA, anos_atras, atualizar_logos, num, retornos)

PASTA_LISTAS = BASE / "listas"
PASTA_MERCADO = PASTA_DOCS / "mercado"
ANOS = 5
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"

log = logging.getLogger("mercado")


# ---------------------------------------------------------------- utilidades

def baixar(url: str, timeout=60, limite=60_000_000) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json,text/plain,*/*"})
    for tentativa in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read(limite)
        except Exception:
            if tentativa == 2:
                raise
            time.sleep(2 + tentativa * 3)


def baixar_json(url: str, timeout=60):
    return json.loads(baixar(url, timeout).decode("utf-8"))


def ler_lista(nome: str) -> list[dict]:
    with open(PASTA_LISTAS / nome, encoding="utf-8-sig", newline="") as f:
        return [{k.strip(): (v or "").strip() for k, v in row.items()} for row in csv.DictReader(f, delimiter=";")]


def r4(x):
    """Arredonda para 4 algarismos significativos depois da vírgula de forma estável (preços pequenos e grandes)."""
    if x is None:
        return None
    a = abs(x)
    casas = 2 if a >= 100 else 3 if a >= 10 else 4 if a >= 1 else 6
    return round(x, casas)


def arred4(x):
    return None if x is None else round(x, 4)


def salvar_json(caminho: Path, obj) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def br_num(s: str):
    s = (s or "").strip()
    if not s:
        return None
    return num(s.replace(".", "").replace(",", ".")) if "," in s else num(s)


# ---------------------------------------------------------------- séries de preço (Yahoo)

def baixar_series(simbolos: list[str]) -> dict:
    """{símbolo: {"precos": [(data, fechamento)], "provs": [(data, valor)], "vol": [(data, volume)]}}"""
    import yfinance as yf
    out = {}
    if not simbolos:
        return out
    for i in range(0, len(simbolos), 60):          # lotes menores: menos chance de bloqueio
        lote = simbolos[i:i + 60]
        df = yf.download(lote, period=f"{ANOS}y", interval="1d", group_by="ticker", auto_adjust=False,
                         actions=True, progress=False, threads=True)
        for s in lote:
            try:
                try:
                    sub = df[s]
                except KeyError:
                    sub = df                       # um único ativo: colunas sem o nível do símbolo
                c = sub["Close"].dropna()
                if len(c) < 5:
                    continue
                dv = sub["Dividends"] if "Dividends" in sub else None
                vol = sub["Volume"] if "Volume" in sub else None
                out[s] = {
                    "precos": [(ix.date(), float(v)) for ix, v in c.items() if num(v) and v > 0],
                    "provs": [(ix.date(), float(v)) for ix, v in dv.items() if num(v) and v > 0] if dv is not None else [],
                    "vol": [(ix.date(), float(v)) for ix, v in vol.dropna().items()] if vol is not None else [],
                }
            except Exception as e:
                log.info("   %s sem série: %s", s, e)
        time.sleep(1)
    return out


def info_yahoo(simbolo: str) -> dict:
    import yfinance as yf
    try:
        return yf.Ticker(simbolo).info or {}
    except Exception as e:
        log.info("   %s sem info: %s", simbolo, e)
        return {}


def resumo_serie(precos, provs, vol=None, com_proventos=True) -> dict:
    """Indicadores comuns a qualquer ativo, calculados a partir da série diária."""
    precos = sorted(precos)
    ult_d, ult = precos[-1]
    ant = precos[-2][1] if len(precos) > 1 else None

    def preco_em(d):
        cand = [c for dd, c in precos if dd <= d]
        return cand[-1] if cand else None

    def var_desde(d):
        p0 = preco_em(d)
        return (ult / p0 - 1) if p0 and (precos[0][0] <= d) else None

    um_ano = anos_atras(ult_d, 1)
    ano_ant = date(ult_d.year - 1, 12, 31)
    ret = retornos(precos, provs if com_proventos else [], ult_d)
    ult12 = [(d, v) for d, v in provs if d > um_ano]
    janela = [c for d, c in precos if d > um_ano]
    # minigráfico: um ponto por semana no último ano
    semanal, vista = [], None
    for d, c in precos:
        if d <= um_ano:
            continue
        k = d.isocalendar()[:2]
        if k != vista:
            semanal.append(c)
            vista = k
        else:
            semanal[-1] = c
    out = {
        "preco": r4(ult),
        "data": ult_d.isoformat(),
        "var": round(ult / ant - 1, 5) if ant else None,
        "r1m": arred4(var_desde(ult_d - timedelta(days=30))),
        "rytd": arred4(var_desde(ano_ant)),
        "r12": ret.get("1a", {}).get("p"),
        "rt12": ret.get("1a", {}).get("t") if com_proventos and provs else None,
        "r5a": ret.get("5a", {}).get("p"),
        "max52": r4(max(janela)) if janela else None,
        "min52": r4(min(janela)) if janela else None,
        "sp": [r4(x) for x in semanal],
    }
    if com_proventos:
        soma = sum(v for _, v in ult12)
        out["dy"] = round(soma / ult, 5) if ult else None
        out["prov12"] = round(soma, 6)
        if provs:
            d, v = sorted(provs)[-1]
            out["ult_prov"] = {"d": d.isoformat(), "v": round(v, 6)}
    if vol:
        ult21 = sorted(vol)[-21:]
        pr = dict(precos)
        fin = [v * pr[d] for d, v in ult21 if d in pr]
        out["liq"] = round(sum(fin) / len(fin)) if fin else None
    return out


def detalhe_serie(id_: str, precos, provs, extra=None) -> dict:
    precos = sorted(precos)
    ult_d = precos[-1][0]
    det = {
        "t": id_,
        "precos": {"d": [d.isoformat() for d, _ in precos], "c": [r4(c) for _, c in precos]},
        "proventos": [[d.isoformat(), round(v, 6)] for d, v in sorted(provs, reverse=True) if d >= anos_atras(ult_d, ANOS)],
        "retorno": retornos(precos, provs, ult_d),
    }
    if provs:
        por_mes = {}
        for d, v in provs:
            if d > anos_atras(ult_d, 2):
                k = d.strftime("%Y-%m")
                por_mes[k] = por_mes.get(k, 0) + v
        det["prov_mes"] = [[k, round(v, 6)] for k, v in sorted(por_mes.items())]
        por_ano = {}
        fech = {}
        for d, c in precos:
            fech[d.year] = c
        for d, v in provs:
            por_ano[d.year] = por_ano.get(d.year, 0) + v
        det["prov_ano"] = [{"ano": a, "total": round(t, 4), "dy": round(t / fech[a], 4) if fech.get(a) else None,
                            "parcial": a == ult_d.year} for a, t in sorted(por_ano.items())
                           if a >= ult_d.year - ANOS and precos[0][0] <= date(a, 1, 15)]   # só anos com histórico completo
    if extra:
        det.update(extra)
    return det


# ---------------------------------------------------------------- FIIs: patrimônio pela CVM

URL_CVM = "https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/inf_mensal_fii_{ano}.zip"


def dados_cvm(anos: list[int]) -> dict:
    """{ticker: {"cnpj", "nome", "segmento_cvm", "meses": {"AAAA-MM": {vp, pl, cotistas, dy}}}} a partir do informe mensal."""
    geral, compl = {}, {}
    for ano in anos:
        try:
            z = zipfile.ZipFile(io.BytesIO(baixar(URL_CVM.format(ano=ano), timeout=180)))
        except Exception as e:
            log.warning("CVM %s indisponível: %s", ano, e)
            continue
        for nome in z.namelist():
            linhas = csv.DictReader(io.StringIO(z.read(nome).decode("latin1")), delimiter=";")
            if "geral" in nome:
                for l in linhas:
                    isin = (l.get("Codigo_ISIN") or "").strip().upper()
                    if len(isin) == 12 and isin[6:9] == "CTF":
                        geral[l["CNPJ_Fundo_Classe"]] = {**l, "_isin": isin}
            elif "complemento" in nome:
                for l in linhas:
                    chave = (l["CNPJ_Fundo_Classe"], l["Data_Referencia"][:7])
                    v = int(l.get("Versao") or 0)
                    if chave not in compl or v >= compl[chave][0]:
                        compl[chave] = (v, l)
    out = {}
    for cnpj, g in geral.items():
        t = g["_isin"][2:6] + "11"
        out.setdefault(t, {"cnpj": cnpj, "nome": g.get("Nome_Fundo_Classe", "").strip(),
                           "segmento_cvm": (g.get("Segmento_Atuacao") or "").strip(),
                           "mandato": (g.get("Mandato") or "").strip(), "meses": {}})
    por_cnpj = {v["cnpj"]: v for v in out.values()}
    for (cnpj, mes), (_, l) in compl.items():
        f = por_cnpj.get(cnpj)
        if not f:
            continue
        f["meses"][mes] = {
            "vp": num(l.get("Valor_Patrimonial_Cotas")),
            "pl": num(l.get("Patrimonio_Liquido")),
            "cotistas": int(num(l.get("Total_Numero_Cotistas")) or 0) or None,
        }
    log.info("CVM: %d FIIs com informe mensal.", len(out))
    return out


def segmento_fii(nome: str, segmento_cvm: str, mandato: str) -> str:
    """Segmento para FIIs sem classificação manual: nome do fundo, mandato e segmento informados à CVM."""
    import re
    n = f"{nome} {segmento_cvm}".upper()
    regras = [
        (r"FUNDO DE FUNDOS|\bFOF\b|FUNDOS IMOBILI", "Fundo de fundos"),
        (r"\bCRI\b|RECEB|CR[EÉ]DITO|HIGH YIELD|\bHY\b|PAPEL|T[IÍ]TULOS E VAL|SECURIT|HIGH GRADE|\bRENDA FIXA", "Papel"),
        (r"LOG[IÍ]ST|\bLOG\b|GALP[OÕ]|INDUSTRIA", "Logística"),
        (r"SHOPPING|\bMALLS?\b|VAREJO", "Shoppings"),
        (r"LAJE|ESCRIT|CORPORATE|OFFICE|\bCORP\b", "Lajes corporativas"),
        (r"AGRO|TERRAS|RURAL", "Agro"),
        (r"HOTE[LI]|HOT[EÉ]IS", "Hotel"), (r"HOSPITAL|SA[UÚ]DE", "Hospitalar"), (r"EDUCA", "Educacional"),
        (r"RESIDENC|RENDA RESID", "Residencial"), (r"RENDA URBANA|VAREJO|AG[EÊ]NCIAS", "Renda urbana"),
        (r"DESENVOLV", "Desenvolvimento"),
    ]
    for padrao, seg in regras:
        if re.search(padrao, n):
            return seg
    if "TÍTULOS" in mandato.upper() or "TITULOS" in mandato.upper():
        return "Papel"
    seg = segmento_cvm.strip()
    return {"Multicategoria": "Híbrido", "Escritórios": "Lajes corporativas", "Outros": "Outros", "": "Outros"}.get(seg, seg)


def nome_fii(nome_cvm: str, t: str) -> str:
    import re
    n = nome_cvm.upper()
    for lixo in ["FUNDO DE INVESTIMENTO IMOBILIÁRIO", "FUNDO DE INVESTIMENTO IMOBILIARIO", "FUNDO DE INVESTIMENTO",
                 "RESPONSABILIDADE LIMITADA", "DE RESPONSABILIDADE", "CLASSE ÚNICA", "CLASSE UNICA"]:
        n = n.replace(lixo, " ")
    n = re.sub(r"\bFUNDO\b(\s+DE)?\s+\w+\s+IMOBILI\w*", " ", n)      # inclui grafias erradas da fonte
    n = re.sub(r"[-–]\s*FII\b|\bFII\b|\bFDO\b|\bINV\b|\bIMOB\b|\bRL\b|\bCI\b", " ", n)
    n = " ".join(n.split()).strip(" -–")
    if not n:
        return t
    pequenas = {"DE", "DA", "DO", "DAS", "DOS", "E"}
    siglas = {"XP", "BTG", "BB", "RBR", "CSHG", "HSI", "VBI", "TRX", "JS", "VX", "BTGP", "II", "III", "IV", "CRI", "CDI", "TG", "GGR", "HSML"}
    return " ".join(w if w in siglas else w.lower() if w in pequenas else w.capitalize() for w in n.split())


def coletar_fiis(series, cvm) -> tuple[list, dict]:
    itens, detalhes = [], {}
    for l in ler_lista("fiis.csv"):
        t = l["ticker"]
        s = series.get(f"{t}.SA")
        if not s:
            log.info("   FII %s sem cotação", t)
            continue
        base = resumo_serie(s["precos"], s["provs"], s["vol"])
        c = cvm.get(t, {})
        meses = c.get("meses", {})
        ult_mes = max((m for m, v in meses.items() if v.get("vp")), default=None)
        vp = meses[ult_mes]["vp"] if ult_mes else None
        pvp = base["preco"] / vp if vp else None
        if pvp is not None and not (0.1 <= pvp <= 5):
            pvp = None                             # cota sem valor patrimonial confiável
        # P/VP mês a mês: fechamento do último pregão do mês ÷ valor patrimonial informado à CVM
        fech_mes = {}
        for d, p in sorted(s["precos"]):
            fech_mes[d.strftime("%Y-%m")] = p
        hist_pvp = []
        for m in sorted(meses):
            v = meses[m].get("vp")
            if v and fech_mes.get(m) and 0.1 <= fech_mes[m] / v <= 5:
                hist_pvp.append([m, round(fech_mes[m] / v, 3), r4(v)])
        dy_mes = (base.get("ult_prov") or {}).get("v")
        nome = nome_fii(c.get("nome", ""), t) if c.get("nome") else None
        if not nome or pvp is None:
            # fundo sem informe na CVM com esse ISIN: nome e P/VP pelo Yahoo
            inf = info_yahoo(f"{t}.SA")
            nome = nome or nome_fii(inf.get("longName") or inf.get("shortName") or "", t)
            ptb = num(inf.get("priceToBook"))
            if pvp is None and ptb and 0.1 <= ptb <= 5:
                pvp = ptb
            time.sleep(0.3)
        item = {
            "t": t,
            "n": nome,
            "seg": l.get("segmento") or segmento_fii(nome or "", c.get("segmento_cvm", ""), c.get("mandato", "")),
            **base,
            "pvp": round(pvp, 3) if pvp else None,
            "vp": r4(vp),
            "vp_mes": ult_mes,
            "patrimonio": meses[ult_mes]["pl"] if ult_mes else None,
            "cotistas": meses[ult_mes]["cotistas"] if ult_mes else None,
            "dy_mes": round(dy_mes / base["preco"], 5) if dy_mes and base["preco"] else None,
        }
        itens.append(item)
        detalhes[t] = detalhe_serie(t, s["precos"], s["provs"], {"pvp_hist": hist_pvp, "cnpj": c.get("cnpj")})
    return itens, detalhes


# ---------------------------------------------------------------- ETFs, BDRs, stocks

def coletar_etfs(series) -> tuple[list, dict]:
    itens, detalhes = [], {}
    for l in ler_lista("etfs.csv"):
        t = l["ticker"]
        s = series.get(f"{t}.SA")
        if not s:
            log.info("   ETF %s sem cotação", t)
            continue
        base = resumo_serie(s["precos"], s["provs"], s["vol"])
        if not s["provs"]:
            for k in ("dy", "prov12", "rt12"):
                base.pop(k, None)
        itens.append({"t": t, "n": l["nome"], "cat": l["categoria"], "ref": l["indice"], **base})
        detalhes[t] = detalhe_serie(t, s["precos"], s["provs"])
    return itens, detalhes


def fundamentos(info: dict, preco: float) -> dict:
    pl = num(info.get("trailingPE"))
    eps = num(info.get("trailingEps"))
    if pl is None and eps:
        pl = preco / eps
    pvp = num(info.get("priceToBook"))
    return {
        "pl": round(pl, 2) if pl is not None and abs(pl) < 5000 else None,
        "pvp": round(pvp, 2) if pvp is not None and 0 < pvp < 1000 else None,
        "roe": num(info.get("returnOnEquity")),
        "ml": num(info.get("profitMargins")),
        "mc": num(info.get("marketCap")),
    }


def coletar_exterior(series, com_info=True) -> tuple[list, dict, list, dict]:
    stocks, det_s, bdrs, det_b = [], {}, [], {}
    usd = series.get("USDBRL=X")
    dolar = sorted(usd["precos"])[-1][1] if usd else None
    for l in ler_lista("exterior.csv"):
        st, bdr = l.get("stock"), l.get("bdr")
        s_st = series.get(st) if st else None
        s_bdr = series.get(f"{bdr}.SA") if bdr else None
        inf = info_yahoo(st) if (com_info and st and s_st) else {}
        if s_st:
            base = resumo_serie(s_st["precos"], s_st["provs"], s_st["vol"])
            stocks.append({"t": st, "n": l["nome"], "setor": l["setor"], "bdr": bdr if s_bdr else None,
                           "moeda": "USD", "brl": r4(base["preco"] * dolar) if dolar else None, **base, **fundamentos(inf, base["preco"])})
            det_s[st] = detalhe_serie(st, s_st["precos"], s_st["provs"])
            time.sleep(0.3)
        if s_bdr:
            base = resumo_serie(s_bdr["precos"], s_bdr["provs"], s_bdr["vol"])
            if not inf and com_info:
                inf = info_yahoo(f"{bdr}.SA")
                time.sleep(0.3)
            f = fundamentos(inf, base["preco"])
            f.pop("mc", None)                          # valor de mercado é da empresa, em dólar, não do BDR
            if not s_st:
                f["pvp"] = None                        # sem a ação americana, o P/VP do Yahoo mistura real e dólar
            bdrs.append({"t": bdr, "n": l["nome"], "setor": l["setor"], "stock": st if s_st else None, **base, **f})
            det_b[bdr] = detalhe_serie(bdr, s_bdr["precos"], s_bdr["provs"])
        elif bdr:
            log.info("   BDR %s sem cotação", bdr)
    return stocks, det_s, bdrs, det_b


# ---------------------------------------------------------------- índices e commodities

def cotacao_b3(indice: str) -> dict | None:
    """Fechamento do dia de um índice da B3 (IFIX, SMLL, IDIV...)."""
    try:
        d = baixar_json(f"https://cotacao.b3.com.br/mds/api/v1/InstrumentQuotation/{indice}", timeout=30)
        q = d["Trad"][0]["scty"]["SctyQtn"]
        return {"preco": num(q.get("curPrc")), "var": (num(q.get("prcFlcn")) or 0) / 100,
                "data": (d.get("Msg") or {}).get("dtTm", "")[:10]}
    except Exception as e:
        log.warning("B3 %s indisponível: %s", indice, e)
        return None


ARQ_HIST_B3 = PASTA_MERCADO / "hist_b3.json"


def indice_b3_sem_historico(l: dict, hist: dict):
    """Índice da B3 sem fonte de histórico: guarda o fechamento de cada dia e o gráfico cresce com o tempo."""
    q = cotacao_b3(l["b3"])
    if not q or not q["preco"]:
        return None, None
    serie = hist.setdefault(l["id"], [])
    dia = q["data"] or date.today().isoformat()
    if serie and serie[-1][0] == dia:
        serie[-1][1] = q["preco"]
    elif not serie or serie[-1][0] < dia:
        serie.append([dia, q["preco"]])
    precos = [(date.fromisoformat(d), v) for d, v in serie[-ANOS * 260:]]
    if len(precos) >= 2:
        base = resumo_serie(precos, [], com_proventos=False)
    else:
        base = {"preco": r4(q["preco"]), "data": dia, "var": None, "r1m": None, "rytd": None, "r12": None, "r5a": None,
                "max52": None, "min52": None, "sp": []}
    base["preco"], base["var"] = r4(q["preco"]), round(q["var"], 5)
    item = {"t": l["id"], "n": l["nome"], "grupo": l["grupo"], "un": l["unidade"], "aprox": None, "desde": serie[0][0], **base}
    det = detalhe_serie(l["id"], precos, [], {"un": l["unidade"], "desde": serie[0][0]}) if len(precos) >= 2 else None
    return item, det


def coletar_indices(series) -> tuple[list, dict]:
    itens, detalhes = [], {}
    try:
        hist = json.loads(ARQ_HIST_B3.read_text(encoding="utf-8"))
    except Exception:
        hist = {}
    for l in ler_lista("indices.csv"):
        id_, proxy = l["id"], l.get("proxy")
        if l.get("b3") and not proxy:
            item, det = indice_b3_sem_historico(l, hist)
            if item:
                itens.append(item)
                if det:
                    detalhes[id_] = det
            continue
        s = series.get(proxy or l["simbolo"])
        if not s:
            log.info("   índice %s sem série", id_)
            continue
        precos = s["precos"]
        aprox = None
        if proxy:
            q = cotacao_b3(l["b3"])
            if not q or not q["preco"]:
                continue
            # histórico aproximado pelo ETF que replica o índice, na escala do índice
            fator = q["preco"] / precos[-1][1]
            precos = [(d, c * fator) for d, c in precos]
            aprox = proxy.replace(".SA", "")
        base = resumo_serie(precos, [], com_proventos=False)
        if proxy and q:
            base["preco"], base["var"] = r4(q["preco"]), round(q["var"], 5)
        y = None if (proxy or l["simbolo"].startswith("B3:")) else l["simbolo"]   # símbolo no Yahoo (gráfico de candles)
        itens.append({"t": id_, "n": l["nome"], "grupo": l["grupo"], "un": l["unidade"], "aprox": aprox, "y": y, **base})
        detalhes[id_] = detalhe_serie(id_, precos, [], {"aprox": aprox, "un": l["unidade"]})
    salvar_json(ARQ_HIST_B3, hist)
    return itens, detalhes


def coletar_commodities(series) -> tuple[list, dict]:
    itens, detalhes = [], {}
    usd = series.get("USDBRL=X")
    dolar = sorted(usd["precos"])[-1][1] if usd else None
    for l in ler_lista("commodities.csv"):
        s = series.get(l["simbolo"])
        if not s:
            log.info("   commodity %s sem série", l["id"])
            continue
        base = resumo_serie(s["precos"], [], com_proventos=False)
        un = l["unidade"]
        brl = None
        if dolar and un.startswith("US"):
            brl = base["preco"] * dolar / (100 if un.startswith("US¢") else 1)       # centavos de dólar → dólar
        itens.append({"t": l["id"], "n": l["nome"], "grupo": l["grupo"], "un": un, "y": l["simbolo"],
                      "brl": r4(brl), "un_brl": "R$/" + un.split("/", 1)[1] if brl else None, **base})
        detalhes[l["id"]] = detalhe_serie(l["id"], s["precos"], [], {"un": l["unidade"]})
    return itens, detalhes


def coletar_moedas(series) -> tuple[list, dict]:
    """Câmbio em reais: R$ por unidade = (R$ por dólar) ÷ (unidades da moeda por dólar), dia a dia."""
    usd = series.get("USDBRL=X")
    if not usd:
        return [], {}
    usd_dia = sorted(usd["precos"])
    import bisect
    datas = [d for d, _ in usd_dia]

    def usd_em(d):
        i = bisect.bisect_right(datas, d) - 1
        return usd_dia[i][1] if i >= 0 and (d - usd_dia[i][0]).days <= 5 else None

    itens, detalhes = [], {}
    for l in ler_lista("moedas.csv"):
        cod, mult = l["codigo"], float(l.get("mult") or 1)
        if cod == "USD":
            precos = usd_dia
        else:
            s = series.get(f"{cod}=X")
            if not s:
                log.info("   moeda %s sem série", cod)
                continue
            precos = [(d, u / x) for d, x in s["precos"] if x and (u := usd_em(d))]
        precos = [(d, v * mult) for d, v in precos]
        if len(precos) < 5:
            continue
        base = resumo_serie(precos, [], com_proventos=False)
        rot = l["nome"].split()[0].lower()
        un = f"R$ por {int(mult) if mult > 1 else 1} {rot}{'s' if mult > 1 and not rot.endswith('s') else ''}"
        itens.append({"t": cod, "n": l["nome"], "grupo": l["grupo"], "un": "R$", "mult": int(mult), "unid": un,
                      "y": (l.get("yahoo") or None) if mult == 1 else None, **base})   # candles do Yahoo são por 1 unidade
        detalhes[cod] = detalhe_serie(cod, precos, [], {"un": "R$", "mult": int(mult)})
    return itens, detalhes


# ---------------------------------------------------------------- renda fixa

def coletar_renda_fixa(hoje: date) -> dict:
    out = {"atualizado_em": datetime.now(FUSO_BR).isoformat(timespec="minutes")}
    # Copom: meta Selic e histórico de decisões
    try:
        d = baixar_json("https://www.bcb.gov.br/api/servico/sitebcb/historicotaxasjuros")["conteudo"]
        dec = sorted(({"d": x["DataReuniaoCopom"][:10], "meta": x["MetaSelic"], "n": int(x["NumeroReuniaoCopom"])}
                      for x in d if x.get("MetaSelic") is not None), key=lambda x: x["d"])
        out["copom"] = [x for x in dec if x["d"] >= str(hoje.year - 10)]
        out["selic_meta"] = dec[-1]["meta"]
    except Exception as e:
        log.warning("Copom indisponível: %s", e)
    # CDI e Selic do dia (B3)
    try:
        b64 = base64.b64encode(b'{"language":"pt-br"}').decode()
        lst = baixar_json(f"https://sistemaswebb3-derivativos.b3.com.br/financialIndicatorsProxy/FinancialIndicators/GetFinancialIndicators/{b64}")
        for x in lst:
            desc = (x.get("description") or "").upper()
            if desc == "TAXA CDI CETIP":
                out["cdi"] = br_num(x.get("rate")); out["cdi_data"] = x.get("lastUpdate")
            elif desc == "TAXA SELIC":
                out["selic"] = br_num(x.get("rate"))
    except Exception as e:
        log.warning("CDI/Selic B3 indisponível: %s", e)
    # IPCA (IBGE): mês a mês e acumulado em 12 meses
    try:
        rows = baixar_json("https://apisidra.ibge.gov.br/values/t/1737/n1/all/v/63,2265/p/last%2061")[1:]
        mes, acum = {}, {}
        for r in rows:
            k = f"{r['D3C'][:4]}-{r['D3C'][4:]}"
            v = num(r.get("V"))
            if v is None:
                continue
            (mes if r["D2C"] == "63" else acum)[k] = v
        out["ipca_mes"] = [[k, mes[k]] for k in sorted(mes)][-24:]
        out["ipca_12m"] = [[k, acum[k]] for k in sorted(acum)]
        if acum:
            ult = sorted(acum)[-1]
            out["ipca12"], out["ipca_ref"] = acum[ult], ult
    except Exception as e:
        log.warning("IPCA indisponível: %s", e)
    # TR (para a poupança): procura a série no Ipeadata; sem ela, a poupança fica "0,5% ao mês + TR"
    try:
        meta = baixar_json("http://www.ipeadata.gov.br/api/odata4/Metadados?$filter=SERCODIGO%20eq%20'BM12_TJTR12'", timeout=40)
        if meta.get("value"):
            vals = baixar_json("http://www.ipeadata.gov.br/api/odata4/ValoresSerie(SERCODIGO='BM12_TJTR12')", timeout=60)["value"]
            ult = [v for v in vals if v.get("VALVALOR") is not None][-12:]
            out["tr_mes"] = [[v["VALDATA"][:7], v["VALVALOR"]] for v in ult]
        else:
            log.info("Ipeadata: série da TR não encontrada")
    except Exception as e:
        log.info("TR indisponível: %s", e)
    # Focus: mediana das projeções de Selic e IPCA para o fim de cada ano
    try:
        focus = {}
        for ind in ("Selic", "IPCA"):
            url = ("https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoAnuais"
                   f"?$top=20&$filter=Indicador%20eq%20'{ind}'%20and%20baseCalculo%20eq%200&$orderby=Data%20desc&$format=json")
            vals = baixar_json(url)["value"]
            if vals:
                ult = vals[0]["Data"]
                focus[ind.lower()] = {x["DataReferencia"]: x["Mediana"] for x in vals if x["Data"] == ult}
                focus["data"] = ult
        out["focus"] = focus
    except Exception as e:
        log.warning("Focus indisponível: %s", e)
    # poupança: 0,5% ao mês + TR quando a Selic está acima de 8,5%; senão 70% da Selic + TR
    meta = out.get("selic_meta")
    if meta is not None:
        tr = (out.get("tr_mes") or [[None, 0]])[-1][1] or 0
        if meta > 8.5:
            mensal = 0.005 + tr / 100
        else:
            mensal = (1 + meta * 0.7 / 100) ** (1 / 12) - 1 + tr / 100
        out["poupanca"] = round(((1 + mensal) ** 12 - 1) * 100, 2)
        out["poupanca_tr"] = bool(out.get("tr_mes"))
    return out


# ---------------------------------------------------------------- Tesouro Direto

URL_TD_INVESTIR = "https://www.tesourodireto.com.br/o/rentabilidade/investir"
URL_TD_RESGATAR = "https://www.tesourodireto.com.br/o/rentabilidade/resgatar"
URL_TD_HIST = ("https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/"
               "resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv")


def tipo_titulo(nome: str) -> str:
    n = nome.lower()
    if "selic" in n or "reserva" in n:
        return "Selic"
    if "renda+" in n:
        return "Renda+"
    if "educa+" in n:
        return "Educa+"
    if "ipca" in n:
        return "IPCA+"
    if "igpm" in n:
        return "IGP-M+"
    return "Prefixado"


def coletar_tesouro(hoje: date) -> dict:
    inv = baixar_json(URL_TD_INVESTIR)
    try:
        resg = baixar_json(URL_TD_RESGATAR)
        pu_resg = {x["isinCode"]: x.get("unitaryRedemptionValue") for g in resg.values() if isinstance(g, list) for x in g}
    except Exception:
        pu_resg = {}
    titulos = []
    for grupo in inv.values():
        if not isinstance(grupo, list):
            continue
        for x in grupo:
            venc = (x.get("maturityDate") or "")[:10]
            titulos.append({
                "nome": x.get("treasuryBondName"),
                "tipo": tipo_titulo(x.get("treasuryBondName") or ""),
                "venc": venc,
                "taxa": x.get("investmentProfitabilityIndexerName"),
                "taxa_resgate": x.get("redemptionProfitabilityFeeIndexerName"),
                "pu": x.get("unitaryInvestmentValue"),
                "pu_resgate": pu_resg.get(x.get("isinCode")) or x.get("unitaryRedemptionValue"),
                "minimo": x.get("investmentBondMinimumValue"),
                "juros_semestrais": x.get("typeReceiptInterest") == "S",
                "isin": x.get("isinCode"),
                "info": [s.strip() for s in (x.get("indication") or "").split("|") if s.strip()][:3],
                "atualizado": x.get("lastMarketPricingDate"),
            })
    # histórico das taxas de compra (uma amostra por semana nos últimos 5 anos)
    try:
        texto = baixar(URL_TD_HIST, timeout=300).decode("latin1")
        hist = {}
        corte = anos_atras(hoje, ANOS)
        for l in texto.splitlines()[1:]:
            p = l.split(";")
            if len(p) < 6:
                continue
            try:
                d = datetime.strptime(p[2], "%d/%m/%Y").date()
                venc = datetime.strptime(p[1], "%d/%m/%Y").date().isoformat()
            except ValueError:
                continue
            if d < corte:
                continue
            taxa = br_num(p[3])
            if taxa is None or taxa == 0 and "Selic" not in p[0]:
                continue
            chave = (p[0].strip(), venc)
            semana = d.isocalendar()[:2]
            serie = hist.setdefault(chave, {})
            if semana not in serie or d > serie[semana][0]:
                serie[semana] = (d, taxa, br_num(p[5]))
        for t in titulos:
            cand = [k for k in hist if k[1] == t["venc"] and tipo_titulo(k[0]) == t["tipo"]
                    and (("semestrais" in k[0].lower()) == t["juros_semestrais"])]
            if cand:
                pts = sorted(hist[cand[0]].values())
                t["hist"] = {"d": [p[0].isoformat() for p in pts], "taxa": [p[1] for p in pts], "pu": [p[2] for p in pts]}
    except Exception as e:
        log.warning("Histórico do Tesouro indisponível: %s", e)
    titulos.sort(key=lambda t: (["Selic", "Prefixado", "IPCA+", "Renda+", "Educa+", "IGP-M+"].index(t["tipo"]), t["venc"]))
    log.info("Tesouro: %d títulos à venda, %d com histórico.", len(titulos), sum(1 for t in titulos if t.get("hist")))
    return {"atualizado_em": datetime.now(FUSO_BR).isoformat(timespec="minutes"), "titulos": titulos}


# ---------------------------------------------------------------- proventos com data de pagamento e tipo (B3)

URL_B3_EMPRESA = "https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall/GetListedSupplementCompany/"
URL_B3_FUNDO = "https://sistemaswebb3-listados.b3.com.br/fundsProxy/fundsCall/GetListedSupplementFunds/"
TIPOS_B3 = {"DIVIDENDO": "Dividendo", "JRS CAP PROPRIO": "JCP", "RENDIMENTO": "Rendimento", "AMORTIZACAO": "Amortização",
            "AMORTIZAÇÃO": "Amortização", "RESTITUICAO DE CAPITAL": "Restituição", "RESTITUIÇÃO DE CAPITAL": "Restituição"}
# composição das units (ações ON, ações PN) quando a B3 não informa o provento da unit
UNITS = {"TAEE11": (1, 2), "SANB11": (1, 1), "SAPR11": (1, 4), "KLBN11": (1, 4), "ALUP11": (1, 2), "ENGI11": (1, 4),
         "IGTI11": (1, 2), "BPAC11": (1, 2), "BRBI11": (1, 2), "TIET11": (1, 4), "SULA11": (1, 2), "CPLE11": (1, 4)}


def _b64(o) -> str:
    return base64.b64encode(json.dumps(o, separators=(",", ":")).encode()).decode()


def _data_br(s: str):
    try:
        d = datetime.strptime((s or "").strip(), "%d/%m/%Y").date()
        return None if d.year >= 9000 else d
    except ValueError:
        return None


def _classe_isin(isin: str) -> str | None:
    """Classe da ação pelo ISIN: OR=ON, PR=PN, PA=PNA, PB=PNB, CTF=cota de FII, UNIT=unit."""
    if len(isin) != 12 or not isin.startswith("BR"):
        return None
    if isin[6:9] == "CTF":
        return "CTF"
    if isin[6:9] in ("CDA", "UNT", "CDB"):
        return "UNIT"
    return isin[9:11] if isin[9:11] in ("OR", "PR", "PA", "PB", "PC") else None


SUFIXO_CLASSE = {"3": "OR", "4": "PR", "5": "PA", "6": "PB", "7": "PC", "8": "PC"}


def proventos_b3(acoes: list[str], fiis: list[str], hoje: date, pausa=0.25) -> dict:
    """{ticker: [[data com, data de pagamento, valor, tipo], ...]} dos últimos 2 anos e dos já anunciados."""
    corte = hoje - timedelta(days=760)
    por_codigo: dict[str, list] = {}
    for t in acoes + fiis:
        por_codigo.setdefault(t[:4], []).append(t)
    out, falhas = {}, 0
    for codigo, tickers in por_codigo.items():
        eh_fii = all(t in fiis for t in tickers)
        url = URL_B3_FUNDO + _b64({"cnpj": "0", "identifierFund": codigo, "typeFund": 7}) if eh_fii \
            else URL_B3_EMPRESA + _b64({"issuingCompany": codigo, "language": "pt-br"})
        try:
            bruto = baixar(url, timeout=40).decode("utf-8")
            d = json.loads(bruto)
            if isinstance(d, str):                     # a B3 devolve o JSON dentro de uma string
                d = json.loads(d) if d else {}
            if isinstance(d, list):
                d = d[0] if d else {}
            lista = d.get("cashDividends") or []
        except Exception as e:
            falhas += 1
            log.info("   B3 proventos %s: %s", codigo, e)
            continue
        por_classe: dict[str, list] = {}
        for x in lista:
            cls = _classe_isin(x.get("isinCode") or x.get("assetIssued") or "")
            dc, dp = _data_br(x.get("lastDatePrior")), _data_br(x.get("paymentDate"))
            v = br_num(x.get("rate"))
            if not cls or not dc or not v:
                continue
            if dc < corte and not (dp and dp >= hoje):
                continue
            tipo = TIPOS_B3.get((x.get("label") or "").strip().upper(), (x.get("label") or "").strip().title())
            por_classe.setdefault(cls, []).append([dc.isoformat(), dp.isoformat() if dp else None, round(v, 8), tipo])
        for t in tickers:
            if t in fiis:
                linhas = por_classe.get("CTF", [])
            elif t.endswith("11"):
                linhas = por_classe.get("UNIT", [])
                if not linhas and t in UNITS:
                    on, pn = UNITS[t]
                    # soma ON + PN de cada evento (mesma data com, pagamento e tipo)
                    soma: dict[tuple, float] = {}
                    for cls, mult in (("OR", on), ("PR", pn), ("PA", pn)):
                        for dc, dp, v, tipo in por_classe.get(cls, []):
                            k = (dc, dp, tipo)
                            soma[k] = soma.get(k, 0) + v * mult
                        if cls == "PR" and por_classe.get("PR"):
                            break                              # PNA só entra se não houver PN
                    linhas = [[dc, dp, round(v, 8), tipo] for (dc, dp, tipo), v in soma.items()]
            else:
                linhas = por_classe.get(SUFIXO_CLASSE.get(t[4:5], ""), [])
            # a B3 repete o mesmo evento em ISINs antigos da mesma classe: tira duplicados
            unicas = sorted({tuple(l) for l in linhas}, key=lambda l: (l[0], l[1] or ""), reverse=True)
            if unicas:
                out[t] = [list(l) for l in unicas]
        if pausa:
            time.sleep(pausa)
    log.info("Proventos B3: %d ativos com dados, %d empresas/fundos sem resposta.", len(out), falhas)
    return out


# ---------------------------------------------------------------- saídas

CLASSES = {
    "fiis": "Fundos Imobiliários",
    "etfs": "ETFs",
    "bdrs": "BDRs",
    "stocks": "Stocks",
    "indices": "Índices",
    "commodities": "Commodities",
    "moedas": "Moedas",
}
POPULARES_ACOES = ["PETR4", "ITUB4", "VALE3", "BBAS3", "BBDC4", "WEGE3", "ABEV3", "ITSA4"]


def gravar_classe(classe: str, itens: list, detalhes: dict, agora) -> None:
    logos = PASTA_DOCS / "logos"
    for it in itens:
        it["logo"] = (logos / f"{it['t']}.svg").exists()
        if classe == "stocks" and not it["logo"] and it.get("bdr"):
            it["logo_de"] = it["bdr"] if (logos / f"{it['bdr']}.svg").exists() else None
    salvar_json(PASTA_MERCADO / f"{classe}.json", {"classe": classe, "nome": CLASSES[classe],
                                                    "atualizado_em": agora.isoformat(timespec="minutes"), "itens": itens})
    pasta = PASTA_MERCADO / classe
    for id_, det in detalhes.items():
        salvar_json(pasta / f"{id_}.json", det)
    log.info("%s: %d ativos gravados.", CLASSES[classe], len(itens))


def gravar_menu(agora) -> None:
    menu = {"atualizado_em": agora.isoformat(timespec="minutes")}
    try:
        acoes = json.loads((PASTA_DOCS / "dados.json").read_text(encoding="utf-8"))["acoes"]
        por_t = {a["t"]: a for a in acoes}
        menu["acoes"] = [{"t": t, "n": por_t[t]["n"], "preco": por_t[t]["preco"], "var": por_t[t].get("var"),
                          "logo": por_t[t].get("logo", False)} for t in POPULARES_ACOES if t in por_t]
    except Exception as e:
        log.info("menu sem ações: %s", e)
    for classe in CLASSES:
        arq = PASTA_MERCADO / f"{classe}.json"
        if not arq.exists():
            continue
        itens = json.loads(arq.read_text(encoding="utf-8"))["itens"]
        if classe in ("fiis", "etfs", "bdrs"):
            itens = sorted(itens, key=lambda x: -(x.get("liq") or 0))
        menu[classe] = [{k: it.get(k) for k in ("t", "n", "preco", "var", "logo", "logo_de", "un", "moeda", "mult")} for it in itens[:8]]
    try:
        rf = json.loads((PASTA_MERCADO / "rendafixa.json").read_text(encoding="utf-8"))
        menu["rendafixa"] = {k: rf.get(k) for k in ("selic_meta", "cdi", "ipca12", "poupanca")}
    except Exception:
        pass
    try:
        td = json.loads((PASTA_MERCADO / "tesouro.json").read_text(encoding="utf-8"))
        menu["tesouro"] = [{"nome": t["nome"], "taxa": t["taxa"], "tipo": t["tipo"]} for t in td["titulos"]
                           if t["tipo"] in ("Selic", "Prefixado", "IPCA+")][:8]
    except Exception:
        pass
    salvar_json(PASTA_MERCADO / "menu.json", menu)
    # índice da busca do topo: todos os ativos de todas as classes
    busca = []
    try:
        busca += [[a["t"], a["n"], "acoes"] for a in json.loads((PASTA_DOCS / "dados.json").read_text(encoding="utf-8"))["acoes"]]
    except Exception:
        pass
    for classe in CLASSES:
        arq = PASTA_MERCADO / f"{classe}.json"
        if arq.exists():
            busca += [[it["t"], it["n"], classe] for it in json.loads(arq.read_text(encoding="utf-8"))["itens"]]
    salvar_json(PASTA_MERCADO / "busca.json", busca)


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
    p = argparse.ArgumentParser(description="Coleta as outras classes de ativos do Radar B3")
    p.add_argument("--so", help="partes separadas por vírgula: fiis,etfs,exterior,indices,commodities,moedas,rendafixa,tesouro,proventos")
    p.add_argument("--sem-logos", action="store_true")
    args = p.parse_args(argv)
    configurar_log()
    partes = set((args.so or "fiis,etfs,exterior,indices,commodities,moedas,rendafixa,tesouro,proventos").split(","))
    agora = datetime.now(FUSO_BR)
    hoje = agora.date()
    erros = 0

    def etapa(nome, fn):
        nonlocal erros
        t0 = time.time()
        try:
            fn()
            log.info("== %s ok em %.0f s", nome, time.time() - t0)
        except Exception:
            erros += 1
            log.exception("== %s falhou", nome)

    if "proventos" in partes:
        def provs():
            try:
                acoes = [a["t"] for a in json.loads((PASTA_DOCS / "dados.json").read_text(encoding="utf-8"))["acoes"]]
            except Exception:
                acoes = []
            fiis = [l["ticker"] for l in ler_lista("fiis.csv")]
            itens = proventos_b3(acoes, fiis, hoje)
            datas = [l[0] for v in itens.values() for l in v]
            salvar_json(PASTA_MERCADO / "proventos.json", {"atualizado_em": agora.isoformat(timespec="minutes"),
                                                           "fonte": "B3", "mais_antigo": min(datas) if datas else None,
                                                           "itens": itens})
        etapa("Proventos B3", provs)
    if "rendafixa" in partes:
        etapa("Renda fixa", lambda: salvar_json(PASTA_MERCADO / "rendafixa.json", coletar_renda_fixa(hoje)))
    if "tesouro" in partes:
        etapa("Tesouro", lambda: salvar_json(PASTA_MERCADO / "tesouro.json", coletar_tesouro(hoje)))

    simbolos = []
    if "fiis" in partes:
        simbolos += [f"{l['ticker']}.SA" for l in ler_lista("fiis.csv")]
    if "etfs" in partes:
        simbolos += [f"{l['ticker']}.SA" for l in ler_lista("etfs.csv")]
    if "exterior" in partes:
        for l in ler_lista("exterior.csv"):
            simbolos += [x for x in (l.get("stock"), f"{l['bdr']}.SA" if l.get("bdr") else None) if x]
    if "indices" in partes:
        simbolos += [l.get("proxy") or l["simbolo"] for l in ler_lista("indices.csv") if not l["simbolo"].startswith("B3:") or l.get("proxy")]
    if "commodities" in partes:
        simbolos += [l["simbolo"] for l in ler_lista("commodities.csv")]
    if "moedas" in partes:
        simbolos += [f"{l['codigo']}=X" for l in ler_lista("moedas.csv") if l["codigo"] != "USD"]
    if simbolos:
        simbolos.append("USDBRL=X")       # dólar: câmbio das moedas e valor em reais de commodities e stocks
    series = {}
    if simbolos:
        t0 = time.time()
        series = baixar_series(list(dict.fromkeys(simbolos)))
        log.info("Yahoo: %d de %d séries em %.0f s.", len(series), len(set(simbolos)), time.time() - t0)

    if not args.sem_logos:
        tick = []
        if "fiis" in partes:
            tick += [l["ticker"] for l in ler_lista("fiis.csv")]
        if "etfs" in partes:
            tick += [l["ticker"] for l in ler_lista("etfs.csv")]
        if "exterior" in partes:
            tick += [x for l in ler_lista("exterior.csv") for x in (l.get("bdr"), l.get("stock")) if x and "-" not in x]
        if tick:
            # fundos da mesma gestora usam a mesma logo de propósito: não descartar como "genérica"
            etapa("Logos", lambda: atualizar_logos([{"t": t} for t in tick], descartar_genericas=False))

    if "fiis" in partes:
        def fiis():
            cvm = dados_cvm([hoje.year - 2, hoje.year - 1, hoje.year])
            gravar_classe("fiis", *coletar_fiis(series, cvm), agora)
        etapa("FIIs", fiis)
    if "etfs" in partes:
        etapa("ETFs", lambda: gravar_classe("etfs", *coletar_etfs(series), agora))
    if "exterior" in partes:
        def exterior():
            st, ds, bd, db = coletar_exterior(series)
            gravar_classe("stocks", st, ds, agora)
            gravar_classe("bdrs", bd, db, agora)
        etapa("Stocks e BDRs", exterior)
    if "indices" in partes:
        etapa("Índices", lambda: gravar_classe("indices", *coletar_indices(series), agora))
    if "moedas" in partes:
        etapa("Moedas", lambda: gravar_classe("moedas", *coletar_moedas(series), agora))
    if "commodities" in partes:
        etapa("Commodities", lambda: gravar_classe("commodities", *coletar_commodities(series), agora))
    etapa("Menu", lambda: gravar_menu(agora))
    log.info("Mercado concluído com %d etapa(s) com erro.", erros)
    return 0 if erros == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
