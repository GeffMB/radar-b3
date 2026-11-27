import urllib.request, json, time, random, string
W = "https://radar-assistente.gefersonmarques.workers.dev"
H = {"Origin": "https://geffmb.github.io", "Content-Type": "application/json", "User-Agent": "Mozilla/5.0"}
def nota(s): print("::notice::" + str(s)[:900])
def req(u, corpo=None):
    r = urllib.request.Request(u, data=json.dumps(corpo).encode() if corpo is not None else None, headers=H, method="POST" if corpo is not None else "GET")
    try:
        with urllib.request.urlopen(r, timeout=60) as x: return x.status, x.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()
for aq in ("", "&aq=1"):
    st, b = req(f"{W}/cotacao?s=BBAS3.SA&f=1A{aq}"); d = json.loads(b); nota(f"cotacao 1A{aq}: {st} {len(d.get('t', []))} candles")
canal = "radarb3-" + "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(24))
nota(f"canal {canal}")
nota(("teste", req(f"{W}/avisos/teste", {"topico": canal})))
nota(("salvar", req(f"{W}/avisos", {"topico": canal, "avisos": [{"id": "abc123", "t": "BBAS3", "sym": "BBAS3.SA", "cond": ">=", "p": 1, "nota": "teste automático"}]})))
nota(("invalido", req(f"{W}/avisos", {"topico": "qualquer", "avisos": []})))
for i in range(16):
    time.sleep(30)
    msgs = urllib.request.urlopen(urllib.request.Request(f"https://ntfy.sh/{canal}/json?poll=1&since=all", headers={"User-Agent": "Mozilla/5.0"}), timeout=30).read().decode().strip().splitlines()
    evs = [json.loads(l) for l in msgs if l.strip()]
    if len([e for e in evs if e.get("event") == "message"]) >= 2:
        for e in evs: nota(f"ntfy: {e.get('title')} | {e.get('message')}")
        break
else:
    nota("cron ainda não disparou em 8 min; mensagens: " + str(len(msgs)))
