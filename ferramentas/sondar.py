import urllib.request, io
def get(u, t=60):
    return urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 radar-b3"}), timeout=t).read()
def nota(s): print("::notice::" + s.replace("\n", " ⏎ ")[:1500])
for cod in (13982, 13621, 3546):
    try: nota(f"SGS {cod}: " + get(f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{cod}/dados/ultimos/3?formato=json").decode())
    except Exception as e: nota(f"SGS {cod} falhou {e}")
try:
    b = get("https://www.bcb.gov.br/conteudo/dadosabertos/BCBDepin/historico-atuacoes-mercado-cambio.csv", 90)
    for enc in ("utf-8-sig", "latin-1"):
        try: t = b.decode(enc); break
        except Exception: pass
    L = t.splitlines()
    nota(f"CSV {len(b)} bytes, {len(L)} linhas, enc {enc}")
    nota("CAB " + L[0]); nota("A " + " || ".join(L[1:4])); nota("Z " + " || ".join(L[-6:]))
    import collections
    cols = L[0].split(";")
    nota("COLS " + str(cols))
    c = collections.Counter()
    for l in L[1:]:
        p = l.split(";")
        c[tuple(p[i] for i in range(len(p)) if cols[i].lower().strip() in ("tipo instrumento", "tipo", "instrumento", "operação", "operacao", "mercado", "posição bcb", "posicao bcb"))] += 1
    nota("TIPOS " + str(c.most_common(30)))
except Exception as e: nota(f"CSV falhou {e}")
