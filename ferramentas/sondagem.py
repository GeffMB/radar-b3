"""Sondagem de fontes (manual): proventos da B3 com data de pagamento e tipo."""
import base64, json, urllib.request
OUT = []
def p(*a):
    s = " ".join(str(x) for x in a); OUT.append(s); print(s, flush=True)
def b64(o): return base64.b64encode(json.dumps(o, separators=(",", ":")).encode()).decode()
def tenta(rot, url, n=2500):
    h = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36", "Accept": "application/json"}
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=40) as r:
            b = r.read(); p(rot, r.status, len(b), b[:n].decode("utf-8", "replace").replace("\n", " "))
    except Exception as e: p(rot, "ERRO", repr(e)[:200])
B = "https://sistemaswebb3-listados.b3.com.br"
for emp in ["PETR", "TAEE", "BBAS"]:
    tenta(f"supl-{emp}", f"{B}/listedCompaniesProxy/CompanyCall/GetListedSupplementCompany/" + b64({"issuingCompany": emp, "language": "pt-br"}), 3000)
    tenta(f"cash-{emp}", f"{B}/listedCompaniesProxy/CompanyCall/GetListedCashDividends/" + b64({"language": "pt-br", "pageNumber": 1, "pageSize": 20, "tradingName": emp}), 1500)
tenta("initial-PETR", f"{B}/listedCompaniesProxy/CompanyCall/GetInitialCompanies/" + b64({"language": "pt-br", "pageNumber": 1, "pageSize": 5, "company": "PETR"}), 1500)
for f in ["MXRF", "HGLG"]:
    tenta(f"fii-{f}", f"{B}/fundsProxy/fundsCall/GetListedSupplementFunds/" + b64({"cnpj": "0", "identifierFund": f, "typeFund": 7}), 3000)
    tenta(f"fii2-{f}", f"{B}/fundsProxy/fundsCall/GetDetailFundSIG/" + b64({"typeFund": 7, "identifierFund": f}), 1500)
open("sondagem.txt", "w", encoding="utf-8").write("\n".join(OUT))
