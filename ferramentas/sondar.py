import urllib.request, csv, io, collections
def nota(s): print("::notice::" + s.replace("\n", " ⏎ ")[:3000])
b = urllib.request.urlopen(urllib.request.Request("https://www.bcb.gov.br/conteudo/dadosabertos/BCBDepin/historico-atuacoes-mercado-cambio.csv", headers={"User-Agent": "Mozilla/5.0"}), timeout=90).read().decode("utf-8-sig")
R = list(csv.DictReader(io.StringIO(b)))
c = collections.Counter((r["Instrumento"], r["Modalidade"], r["Tipo Composto"]) for r in R)
nota("TIPOS " + str(c.most_common(40)))
c2 = collections.Counter((r["Data"][:4], r["Instrumento"]) for r in R if r["Data"] >= "2019")
nota("ANOS " + str(sorted(c2.items())))
nota("ULT VISTA/LINHA " + str([(r["Data"][:10], r["Instrumento"], r["Modalidade"], r["Volume USD Aceito"]) for r in R if "Swap" not in r["Instrumento"]][-12:]))
