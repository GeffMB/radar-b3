"""Sondagem das fontes de dados (roda no GitHub Actions; o resultado vai para o branch 'sondagem')."""
import json, urllib.request
OUT = []
def p(*a):
    s = " ".join(str(x) for x in a); OUT.append(s); print(s, flush=True)
def tenta(rotulo, url, n=900, hdr=None, timeout=40):
    h = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}
    if hdr is not None: h = hdr
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
            b = r.read(); p(rotulo, r.status, len(b), b[:n].decode("utf-8", "replace").replace("\n", " "))
    except Exception as e: p(rotulo, "ERRO", repr(e)[:200])
tenta("sgs-semhdr", "https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/2?formato=json", hdr={})
tenta("sgs-curl", "https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/2?formato=json", hdr={"User-Agent": "curl/8.5.0", "Accept": "*/*"})
tenta("bcb-site-juros", "https://www.bcb.gov.br/api/servico/sitebcb/historicotaxasjuros", 1200)
tenta("bcb-site-ind", "https://www.bcb.gov.br/api/servico/sitebcb/indicadores", 1200)
tenta("bcb-copom", "https://www.bcb.gov.br/api/servico/sitebcb/copomcomunicados?quantidade=2", 800)
tenta("cetip-di", "https://www2.cetip.com.br/ConsultarTaxaDi/ConsultarTaxaDICetip.aspx", 400)
tenta("b3-di", "https://sistemaswebb3-derivativos.b3.com.br/financialIndicatorsProxy/FinancialIndicators/GetFinancialIndicators/eyJsYW5ndWFnZSI6InB0LWJyIn0=", 2500)
tenta("sidra-ipca", "https://apisidra.ibge.gov.br/values/t/1737/n1/all/v/63,2265/p/last%203", 1500)
tenta("sidra-ipca-24", "https://apisidra.ibge.gov.br/values/t/1737/n1/all/v/2265/p/last%2024?formato=json", 300)
tenta("ipea-selic", "http://www.ipeadata.gov.br/api/odata4/ValoresSerie(SERCODIGO='BM12_TJOVER12')", 600)
tenta("olinda-servicos", "https://olinda.bcb.gov.br/olinda/servico/", 1500)
tenta("focus-selic-reuniao", "https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoSelic?$top=3&$orderby=Data%20desc&$format=json", 900)
tenta("olinda-sgs?", "https://olinda.bcb.gov.br/olinda/servico/SGS/versao/v1/odata/", 600)
open("sondagem.txt", "w", encoding="utf-8").write("\n".join(OUT))
