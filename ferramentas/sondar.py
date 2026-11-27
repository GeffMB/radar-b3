import urllib.request, urllib.error, json
UA = {"User-Agent": "Mozilla/5.0 radar-b3", "Accept": "application/json"}
def nota(s): print("::notice::" + s.replace("\n", " ⏎ ")[:2000])
def ver(u):
    try: r = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60); return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, e.read()
    except Exception as e: return "ERR", str(e).encode()
for u in ["https://servicodados.ibge.gov.br/api/v3/calendario/?qtd=100&de=11-27-2026&ate=03-31-2027",
          "https://servicodados.ibge.gov.br/api/v3/calendario/1737?qtd=5"]:
    st, b = ver(u)
    nota(f"{u[:70]} {st} {len(b)}")
    try:
        d = json.loads(b); it = d.get("items", d) if isinstance(d, dict) else d
        nota("chaves " + str(list(d.keys()) if isinstance(d, dict) else type(d)))
        for x in (it or [])[:60]:
            nota(" | ".join(str(x.get(k)) for k in ("data_divulgacao", "titulo", "nome_produto", "id_produto", "tipo_release") if x.get(k) is not None)[:200])
    except Exception as e: nota(f"json? {e} {b[:300]!r}")
for u in ["https://www.bcb.gov.br/api/servico/sitebcb/copomcalendarios", "https://www.bcb.gov.br/api/servico/sitebcb/copom/calendarios",
          "https://www.bcb.gov.br/api/servico/sitebcb/agendaCopom", "https://www.bcb.gov.br/api/servico/sitebcb/copomreunioes?quantidade=12",
          "https://www.bcb.gov.br/api/servico/sitebcb/copom/comunicados?quantidade=1"]:
    st, b = ver(u); nota(f"BCB {u[45:]}: {st} {b[:600]!r}")
