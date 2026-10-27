import json, urllib.request, time
def get(u, t=40):
    r = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 radar-b3", "Accept": "application/json"}), timeout=t)
    return r.read()
def nota(s): print("::notice::" + s.replace("\n", " ")[:600])
for cod in (13762, 13761, 4513, 4478, 4536, 4537, 13760, 13763, 13764, 4382):
    for u in (f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{cod}/dados/ultimos/2?formato=json",
              f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{cod}/dados?formato=json&dataInicial=01/01/2026&dataFinal=31/12/2026"):
        for k in range(2):
            try: nota(f"SGS {cod} {'ult' if 'ultimos' in u else 'per'}: " + get(u).decode()[-260:]); break
            except Exception as e:
                if k: nota(f"SGS {cod} falhou: {e}")
                time.sleep(3)
