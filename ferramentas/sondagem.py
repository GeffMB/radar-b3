"""Sondagem das fontes de dados (roda no GitHub Actions; o resultado vai para o branch 'sondagem')."""
import io, json, sys, time, zipfile, urllib.request, traceback
OUT = []
def p(*a):
    s = " ".join(str(x) for x in a); OUT.append(s); print(s, flush=True)
def get(url, n=None, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 radar-b3"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, (r.read(n) if n else r.read())

def secao(nome, fn):
    p("\n=====", nome)
    try: fn()
    except Exception as e: p("ERRO", repr(e)); p(traceback.format_exc()[-800:])

def cvm():
    st, b = get("https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/")
    p(st, b.decode("latin1")[-1500:])
    st, b = get("https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/inf_mensal_fii_2026.zip", timeout=180)
    p("zip", st, len(b))
    z = zipfile.ZipFile(io.BytesIO(b))
    for nm in z.namelist():
        txt = z.read(nm).decode("latin1")
        linhas = txt.splitlines()
        p("--", nm, len(linhas)); p(linhas[0])
        alvo = [l for l in linhas if "MXRF" in l or "HGLG" in l][:3]
        for l in (alvo or linhas[1:3]): p("   ", l[:700])
        if "geral" in nm:
            mx = [l for l in linhas if "97.521.225" in l or "11.728.688" in l][:2]
            for l in mx: p("  CNPJ", l[:900])
        if "complemento" in nm:
            mx = [l for l in linhas if "97.521.225" in l][-2:]
            for l in mx: p("  CNPJcomp", l[:900])

def bcb():
    for s in [432, 11, 12, 4389, 1178, 433, 13522, 189, 195, 7811, 226, 25433]:
        try:
            st, b = get(f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{s}/dados/ultimos/3?formato=json", timeout=30)
            p(s, b.decode()[:300])
        except Exception as e: p(s, "ERRO", repr(e))
    try:
        st, b = get("https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoAnuais?$top=8&$filter=Indicador%20eq%20'Selic'&$orderby=Data%20desc&$format=json", timeout=30)
        p("focus", b.decode()[:900])
    except Exception as e: p("focus ERRO", repr(e))

def tesouro():
    u = "https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv"
    st, b = get(u, timeout=240)
    t = b.decode("latin1"); ls = t.splitlines()
    p("csv", st, len(b), len(ls)); p(ls[0]); [p("  ", l) for l in ls[1:4]]
    datas = sorted({l.split(";")[2] for l in ls[1:] if l.count(";") > 3}, key=lambda d: d[6:]+d[3:5]+d[:2])
    p("ultima data base", datas[-3:])
    ult = [l for l in ls if l.split(";")[2:3] == [datas[-1]]]
    for l in ult: p("  ", l)
    for u2 in ["https://www.tesourodireto.com.br/json/br/com/b3/tesourodireto/service/api/treasurybondsinfo.json",
               "https://www.tesourodireto.com.br/o/rentabilidade/investir"]:
        try:
            st, b = get(u2, 3000, timeout=30); p(u2, st, b[:600])
        except Exception as e: p(u2, "ERRO", repr(e))

def yahoo():
    import yfinance as yf
    cand = {
     "fii": "MXRF11 HGLG11 KNRI11 XPML11 VISC11 BTLG11 HGRU11 KNCR11 KNIP11 CPTS11 IRDM11 VGHF11 RECR11 HGBS11 XPLG11 BRCO11 TRXF11 VILG11 ALZR11 PVBI11 RBRF11 HFOF11 KNSC11 MCCI11 VGIR11 RBRR11 TGAR11 GGRC11 LVBI11 HSML11 JSRE11 RZTR11 KNHF11 BTCI11 SNCI11 VINO11 RBRP11 GARE11 KFOF11 BRCR11 HGCR11 CVBI11 RZAK11 VGIP11 KNHY11 HGRE11 RBVA11 HGPO11 XPCI11 BCRI11 MALL11 HCTR11 DEVA11 VSLH11 KISU11 RVBI11 BRCO11 PATL11 TVRI11 SARE11 HABT11 CPSH11 KCRE11 BTAL11 TRBL11 RBRY11 RBHG11 VRTA11 FATN11 XPSF11 GTWR11 OUJP11 PORD11 AFHI11 BLMG11 RECT11 JSAF11 KORE11 PMIS11 HGFF11 BPML11 PSEC11 BBPO11 BBRC11 FIIB11 RNGO11 VCJR11 URPR11 NEWL11 SNFF11 BROF11 XPPR11 ICRI11 BTHF11 RZAT11 KNUQ11 MCRE11 TOPP11 GZIT11 HSAF11 CACR11 RCRB11",
     "etf": "BOVA11 BOVV11 BOVX11 SMAL11 IVVB11 SPXI11 NASD11 DIVO11 GOLD11 XFIX11 IMAB11 B5P211 FIXA11 BRAX11 ECOO11 PIBB11 ACWI11 EURP11 XINA11 WRLD11 TECK11 DIVD11 NDIV11 LFTS11 IB5M11 SMAC11 HASH11 BBSD11 IRFM11 TRIG11 AGRI11 BOVB11 GOVE11 SPXB11 QDFI11 USTK11 WEB311 ALUG11 BITH11 MATB11 UTEC11 SMAB11 BDIV11 B5MB11 IMBB11 GLDX11 IBOB11 META11 JOGO11 SHOT11 NBOV11 PEVC11 LVOL11",
     "bdr": "AAPL34 MSFT34 AMZO34 GOGL34 M1TA34 NVDC34 TSLA34 NFLX34 DISB34 JPMC34 BERK34 COCA34 MCDC34 NIKE34 PFIZ34 JNJB34 VISA34 MSCD34 WALM34 ITLC34 A1MD34 BABA34 MELI34 XPBR31 ROXO34 INBR32 PGCO34 HOME34 ORCL34 CSCO34 BOAC34 EXXO34 CHVX34 ABBV34 UNHH34 SBUB34 PYPL34 U1BE34 AVGO34 L1LY34 COST34 PEPB34 S1PO34 B1TI34 TSMC34 ASML34 AURA33 GDBR34 GOLL54 STOC31 BIDU34 JDCO34 IBMB34 CRMB34 ADBE34 VERZ34 ATTB34 BOEI34 CATP34 GEOO34 HONB34 MMMC34 QCOM34 TXSA34 ABTT34 MRCK34 CMCS34 AXPB34 GSGI34 MSBR34 CTGP34 WFCO34 USBC34 SCHW34 BLAK34 SPGI34 PLTR34 SNOW34 SHOP34 ARMH34 C2OI34 N1OW34 AIRB34 SSFO34",
     "stock": "AAPL MSFT NVDA AMZN GOOGL META TSLA BRK-B JPM V MA UNH JNJ XOM PG KO PEP HD COST WMT NFLX DIS AMD INTC ORCL CSCO ADBE CRM AVGO LLY PFE MRK ABBV BAC WFC MCD NKE BA CAT T VZ O PLTR TSM ASML BABA MELI NU SPOT UBER ABNB SHOP SBUX IBM QCOM TXN GE HON MMM CVX GS MS C AXP BLK SCHW SPGI MO PM ABT TMO DHR AMGN GILD BMY CVS UPS FDX LMT RTX DE",
     "idx": "^BVSP ^IFIX IFIX.SA ^SMLL SMLL.SA ^IDIV ^GSPC ^IXIC ^DJI ^RUT ^VIX ^STOXX50E ^GDAXI ^FTSE ^FCHI ^N225 ^HSI 000001.SS ^MERV ^MXX USDBRL=X EURBRL=X GBPBRL=X JPYBRL=X CNYBRL=X DX-Y.NYB ^TNX ^IRX",
     "cmd": "BZ=F CL=F GC=F SI=F HG=F PL=F PA=F NG=F ZS=F ZC=F ZW=F KC=F SB=F CC=F CT=F LE=F GF=F HE=F OJ=F TIO=F ALI=F RB=F HO=F",
    }
    for cl, s in cand.items():
        tks = list(dict.fromkeys(s.split()))
        sym = [t + ".SA" if cl in ("fii", "etf", "bdr") else t for t in tks]
        df = yf.download(sym, period="5y", interval="1d", group_by="ticker", auto_adjust=False, actions=True, progress=False, threads=True)
        ok, ruim = [], []
        for t, y in zip(tks, sym):
            try:
                c = df[y]["Close"].dropna()
                dv = df[y]["Dividends"]; dv = dv[dv > 0] if dv is not None else []
                if len(c) > 5: ok.append(f"{t}:{len(c)}:{c.index[0].date()}:{round(float(c.iloc[-1]),2)}:d{len(dv)}")
                else: ruim.append(t)
            except Exception: ruim.append(t)
        p(f"[{cl}] ok {len(ok)} ruim {len(ruim)}: {' '.join(ruim)}")
        p("   ", " ".join(ok))
    keys = ["longName","shortName","quoteType","currency","category","fundFamily","sector","industry","marketCap","trailingPE","priceToBook","bookValue","dividendYield","trailingAnnualDividendYield","returnOnEquity","profitMargins","totalAssets","netAssets","navPrice","yield","expenseRatio","annualReportExpenseRatio","fundInceptionDate","averageVolume","averageDailyVolume3Month","exchange","longBusinessSummary","underlyingSymbol","debtToEquity","enterpriseToEbitda","ytdReturn","threeYearAverageReturn"]
    for t in ["MXRF11.SA","HGLG11.SA","BOVA11.SA","IVVB11.SA","AAPL34.SA","AAPL","KO","^BVSP","BZ=F","USDBRL=X"]:
        try:
            i = yf.Ticker(t).info or {}
            p(t, json.dumps({k: (str(i.get(k))[:80] if i.get(k) is not None else None) for k in keys if i.get(k) is not None}, ensure_ascii=False))
        except Exception as e: p(t, "info ERRO", repr(e))
        time.sleep(0.5)

def logos():
    for t in "MXRF11 HGLG11 KNRI11 XPML11 BOVA11 IVVB11 SMAL11 AAPL34 MSFT34 NVDC34 AAPL MSFT KO NVDA BRK-B BRKB TIO".split():
        try:
            st, b = get(f"https://icons.brapi.dev/icons/{t}.svg", 400, timeout=15); p("logo", t, st, len(b), b[:60])
        except Exception as e: p("logo", t, "ERRO", repr(e)[:80])

for nome, fn in [("BCB", bcb), ("LOGOS", logos), ("TESOURO", tesouro), ("CVM", cvm), ("YAHOO", yahoo)]:
    secao(nome, fn)
open("sondagem.txt", "w", encoding="utf-8").write("\n".join(OUT))
