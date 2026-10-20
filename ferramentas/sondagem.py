"""Sondagem (manual): arquivo COTAHIST da B3, índices da B3, novos símbolos do Yahoo."""
import io, json, zipfile, urllib.request, collections, traceback
from datetime import date, timedelta
OUT = []
def p(*a):
    s = " ".join(str(x) for x in a); OUT.append(s); print(s, flush=True)
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"}
def get(url, timeout=120):
    with urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=timeout) as r:
        return r.status, r.read()
p("===== COTAHIST")
hoje = date.today()
mes = (hoje.replace(day=1) - timedelta(days=1))
urls = [f"https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_M{mes:%m%Y}.ZIP",
        f"https://www.b3.com.br/pesquisapregao/download?filelist=COTAHIST_M{mes:%m%Y}.ZIP"]
d = hoje - timedelta(days=1)
while d.weekday() >= 5: d -= timedelta(days=1)
urls += [f"https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_D{d:%d%m%Y}.ZIP"]
dados = None
for u in urls:
    try:
        st, b = get(u); p(u, st, len(b), b[:4])
        if b[:2] == b"PK" and dados is None:
            z = zipfile.ZipFile(io.BytesIO(b)); nm = z.namelist(); p("  zip", nm)
            dados = z.read(nm[0]).decode("latin1")
            if "pesquisapregao" in u and nm[0].lower().endswith(".zip"):
                z2 = zipfile.ZipFile(io.BytesIO(z.read(nm[0]))); dados = z2.read(z2.namelist()[0]).decode("latin1")
    except Exception as e: p(u, "ERRO", repr(e)[:150])
if dados:
    linhas = [l for l in dados.splitlines() if l[:2] == "01"]
    p("linhas", len(linhas)); p(linhas[0]); p(linhas[1])
    cont = collections.Counter(); vol = collections.defaultdict(float); dias = collections.defaultdict(set); info = {}
    for l in linhas:
        bdi, cod, tpm, nome, esp = l[10:12], l[12:24].strip(), l[24:27], l[27:39].strip(), l[39:49].strip()
        if tpm != "010": continue
        cont[(bdi, esp.split()[0] if esp else "")] += 1
        vol[cod] += int(l[170:188]) / 100; dias[cod].add(l[2:10]); info[cod] = (bdi, nome, esp, l[230:242])
    p("por BDI/especie (top 40):", cont.most_common(40))
    nd = max(len(v) for v in dias.values())
    media = {c: vol[c] / nd for c in vol}
    for bdi, rot in [("02", "acoes lote padrao"), ("12", "FII"), ("14", "?14"), ("13", "?13"), ("06", "?06"), ("09", "?09")]:
        cods = [c for c in media if info[c][0] == bdi]
        for lim in (1e5, 3e5, 1e6, 5e6):
            p(f"  BDI {bdi} {rot}: {len(cods)} papeis; media >= {lim:,.0f}: {sum(1 for c in cods if media[c] >= lim)}")
        top = sorted(cods, key=lambda c: -media[c])[:8]; p("   ex:", [(c, info[c][1], info[c][2], round(media[c]/1e6, 1)) for c in top])
    # BDRs e ETFs pela espécie
    for esp_ini in ("DRN", "DR3", "DR2", "CI", "UNT", "ON", "PN"):
        cods = [c for c in media if info[c][2].startswith(esp_ini)]
        p(f"  esp {esp_ini}: {len(cods)}; >=200k: {sum(1 for c in cods if media[c] >= 2e5)}; ex", sorted(cods, key=lambda c: -media[c])[:12])
    cis = [c for c in media if info[c][2].startswith("CI")]
    p("  CI amostra (BDI, nome, esp):", [(c, info[c]) for c in sorted(cis, key=lambda c: -media[c])[:40]])
p("===== Índices B3 (cotação)")
for idx in ["IBXX", "IBXL", "IBRA", "ICON", "IEEX", "IFNC", "IMAT", "INDX", "IMOB", "UTIL", "IGCX", "ITAG", "ISEE", "BDRX", "IVBX", "MLCX", "SMLL", "IFIX", "IDIV", "IFIL", "IAGRO", "ICO2", "GPTW", "IGNM"]:
    try:
        st, b = get(f"https://cotacao.b3.com.br/mds/api/v1/InstrumentQuotation/{idx}", 30)
        q = json.loads(b)["Trad"][0]["scty"]; p(idx, q["SctyQtn"]["curPrc"], q.get("desc"))
    except Exception as e: p(idx, "ERRO", repr(e)[:80])
p("===== Yahoo")
try:
    import yfinance as yf
    cand = "ZL=F ZM=F ZO=F ZR=F KE=F LBS=F LBR=F DC=F MTF=F UX=F BZ=F ^AXJO ^BSESN ^NSEI ^KS11 ^TWII ^GSPTSE ^IPSA ^IBEX FTSEMIB.MI ^AEX ^SSMI ^STOXX ^FVX ^TYX ^IRX CADBRL=X CHFBRL=X AUDBRL=X ARSBRL=X CNYBRL=X CNHBRL=X MXNBRL=X ^SPGSCI ^BCOM GD=F".split()
    df = yf.download(cand, period="1mo", interval="1d", group_by="ticker", progress=False, threads=True)
    for c in cand:
        try:
            s = df[c]["Close"].dropna(); p(c, len(s), round(float(s.iloc[-1]), 3) if len(s) else None)
        except Exception as e: p(c, "ERRO", repr(e)[:60])
    for t in ["KLBN4.SA", "TAEE11.SA", "BBAS3.SA"]:
        i = yf.Ticker(t).info; p(t, i.get("sector"), "|", i.get("industry"), "|", i.get("sectorKey"), i.get("industryKey"))
except Exception: p(traceback.format_exc()[-500:])
open("sondagem.txt", "w", encoding="utf-8").write("\n".join(OUT))
