"""Sondagem das fontes de dados (roda no GitHub Actions; o resultado vai para o branch 'sondagem')."""
import base64, json, traceback, urllib.request
from datetime import date, timedelta
OUT = []
def p(*a):
    s = " ".join(str(x) for x in a); OUT.append(s); print(s, flush=True)
def get(url, n=None, timeout=60, hdr=None):
    h = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36", "Accept": "application/json,text/plain,*/*"}
    h.update(hdr or {})
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
        return r.status, (r.read(n) if n else r.read())
def tenta(rotulo, url, n=1200, **kw):
    try:
        st, b = get(url, **kw); p(rotulo, st, len(b), b[:n].decode("utf-8", "replace"))
    except Exception as e: p(rotulo, "ERRO", repr(e)[:200])

hoje = date.today(); ini = hoje - timedelta(days=40)
f = lambda d: d.strftime("%d/%m/%Y")
p("===== BCB")
for s in [432, 11, 12, 4389, 1178, 433, 13522, 189, 195, 7811, 226, 4390]:
    tenta(f"sgs{s}", f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{s}/dados?formato=json&dataInicial={f(ini)}&dataFinal={f(hoje)}", 400)
tenta("sgs432-10a", f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados?formato=json&dataInicial={f(hoje-timedelta(days=3650))}&dataFinal={f(hoje)}", 200)
tenta("sgs432-ult", "https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/3?formato=json", 300)
tenta("focus-ipca", "https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoAnuais?$top=6&$filter=Indicador%20eq%20'IPCA'%20and%20baseCalculo%20eq%200&$orderby=Data%20desc&$format=json", 900)

p("===== B3 indices")
def b64(o): return base64.b64encode(json.dumps(o, separators=(",", ":")).encode()).decode()
for idx in ["IFIX", "SMLL", "IDIV", "IBOV"]:
    for nome, url in [
        ("daily", "https://sistemaswebb3-listados.b3.com.br/indexStatisticsProxy/IndexCall/GetDailyEvolution/" + b64({"index": idx, "language": "pt-br", "year": str(hoje.year)})),
        ("yearly", "https://sistemaswebb3-listados.b3.com.br/indexStatisticsProxy/IndexCall/GetYearlyEvolution/" + b64({"index": idx, "language": "pt-br"})),
        ("portfolio", "https://sistemaswebb3-listados.b3.com.br/indexProxy/indexCall/GetPortfolioDay/" + b64({"language": "pt-br", "pageNumber": 1, "pageSize": 5, "index": idx, "segment": "1"})),
        ("quote", f"https://cotacao.b3.com.br/mds/api/v1/InstrumentQuotation/{idx}"),
        ("intraday", f"https://cotacao.b3.com.br/mds/api/v1/DailyFluctuationHistory/{idx}"),
    ]:
        tenta(f"{idx}-{nome}", url, 700, timeout=30)

p("===== TESOURO investir")
try:
    st, b = get("https://www.tesourodireto.com.br/o/rentabilidade/investir", timeout=30)
    d = json.loads(b); p("chaves", list(d.keys()))
    for k, v in d.items():
        p(k, type(v).__name__, len(v) if hasattr(v, "__len__") else "")
        if isinstance(v, list) and v: p("  ex", json.dumps(v[0], ensure_ascii=False)[:1500]); p("  nomes", [x.get("treasuryBondName") for x in v])
except Exception as e: p("ERRO", repr(e)); p(traceback.format_exc()[-600:])
tenta("resgatar", "https://www.tesourodireto.com.br/o/rentabilidade/resgatar", 600, timeout=30)
p("===== CVM")
tenta("cvm-lista", "https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/", 4000)
open("sondagem.txt", "w", encoding="utf-8").write("\n".join(OUT))
