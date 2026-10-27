import json, urllib.request, urllib.parse
def get(u, t=40):
    r = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 radar-b3", "Accept": "application/json"}), timeout=t)
    return r.read()
def nota(s): print("::notice::" + s.replace("\n", " ")[:900])
for cod in (13762, 13761, 4513, 4478, 4505):
    try: nota(f"SGS {cod}: " + get(f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{cod}/dados/ultimos/2?formato=json").decode()[:200])
    except Exception as e: nota(f"SGS {cod} falhou: {e}")
for termo in ("bruta do governo geral", "líquida do setor público", "Dívida líquida", "DBGG"):
    try:
        f = urllib.parse.quote(f"contains(SERNOME,'{termo}')")
        d = json.loads(get(f"http://www.ipeadata.gov.br/api/odata4/Metadados?$filter={f}&$select=SERCODIGO,SERNOME,PERNOME,UNINOME,SERMAXDATA,SERSTATUS&$top=60", 60))["value"]
        for x in d:
            if x.get("PERNOME") == "Mensal" and x.get("SERSTATUS") == "A": nota(f"IPEA [{termo}] {x['SERCODIGO']} | {x['SERNOME']} | {x['UNINOME']} | {x['SERMAXDATA']}")
        nota(f"IPEA [{termo}] total {len(d)}")
    except Exception as e: nota(f"IPEA {termo} falhou: {e}")
