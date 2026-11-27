import urllib.request, json, time
def nota(s): print("::notice::" + str(s)[:900])
canal = "radarb3-9s670t2t3fdmo84o80kkgs7g"
for i in range(20):
    msgs = urllib.request.urlopen(urllib.request.Request(f"https://ntfy.sh/{canal}/json?poll=1&since=all", headers={"User-Agent": "Mozilla/5.0"}), timeout=30).read().decode().strip().splitlines()
    evs = [json.loads(l) for l in msgs if l.strip()]
    if len(evs) >= 2 or i == 19:
        for e in evs: nota(f"ntfy {time.strftime('%H:%M', time.gmtime(e.get('time', 0)))}: {e.get('title')} | {e.get('message')}")
        break
    time.sleep(30)
