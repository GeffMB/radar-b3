import urllib.request, json, os, time
T = os.environ["CF"]; A = "7f0fc8c419470051d61e87f8c684333e"
def nota(s): print("::notice::" + str(s)[:1500])
def cf(path, corpo=None):
    r = urllib.request.Request("https://api.cloudflare.com/client/v4" + path, data=json.dumps(corpo).encode() if corpo else None,
        headers={"Authorization": "Bearer " + T, "Content-Type": "application/json"}, method="POST" if corpo else "GET")
    try:
        with urllib.request.urlopen(r, timeout=60) as x: return json.loads(x.read())
    except urllib.error.HTTPError as e: return {"http": e.code, "corpo": e.read().decode()[:600]}
nota(("schedules", cf(f"/accounts/{A}/workers/scripts/radar-assistente/schedules")))
agora = int(time.time() * 1000)
q = {"queryId": "ad-hoc", "timeframe": {"from": agora - 3 * 3600e3, "to": agora}, "view": "events", "limit": 30,
     "parameters": {"datasets": ["cloudflare-workers"], "filters": [{"key": "$metadata.service", "operation": "eq", "type": "string", "value": "radar-assistente"}]}}
r = cf(f"/accounts/{A}/workers/observability/telemetry/query", q)
try:
    evs = r["result"]["events"]["events"]
    for e in evs:
        m = e.get("$metadata", {}); w = e.get("$workers", {})
        if w.get("eventType") == "scheduled" or m.get("error") or "aviso" in json.dumps(e):
            nota(f"{m.get('trigger')} {w.get('eventType')} {w.get('outcome')} {m.get('message')} {m.get('error')}")
    nota(f"eventos {len(evs)}; tipos {sorted(set(e.get('$workers',{}).get('eventType','?') for e in evs))}")
except Exception as ex:
    nota(("telemetria", str(r)[:1200]))
