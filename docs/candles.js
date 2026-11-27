"use strict";
/* Gráfico de candles com cotação ao vivo (durante o pregão), usando TradingView Lightweight Charts.
   Os candles vêm do servidor do site (Cloudflare), que consulta o Yahoo e guarda a resposta por 1 minuto.
   Uso: const g = Candles.montar(elemento, { simbolo: "PETR4.SA", tipo: "candle"|"linha", faixa: "1D", formatar, aoAtualizar }) */
(function () {
  const ENDPOINT = "https://radar-assistente.gefersonmarques.workers.dev/cotacao";
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const INTRADAY = { "1D": 1, "5D": 1, "1M": 1 };
  const ATUALIZA = { "1D": 60e3, "5D": 120e3 };
  const JANELA = { "1M": 31, "6M": 183, "1A": 366, "2A": 731, "5A": 1827 };   // dias mostrados de cada faixa

  // ---------------------------------------------------------------- indicadores (médias móveis e MACD)
  const PADRAO = { mme: [9, 21], mms: [50, 200], macd: false, mr: 12, ml: 26, ms: 9 };
  const CORES_MM = ["#d08a2c", "#7b5ea7", "#2f86b8", "#b8475c", "#4d8f5b"];
  function config() {
    try { return { ...PADRAO, ...JSON.parse(localStorage.getItem("radar-indicadores") || "{}") }; } catch (e) { return { ...PADRAO }; }
  }
  function salvarConfig(c) { try { localStorage.setItem("radar-indicadores", JSON.stringify(c)); } catch (e) {} }
  const temIndicador = c => c.mme.length || c.mms.length || c.macd;
  function mms(v, n) { const out = new Array(v.length).fill(null); let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= n) s -= v[i - n]; if (i >= n - 1) out[i] = s / n; } return out; }
  function mme(v, n) { const out = new Array(v.length).fill(null), k = 2 / (n + 1); let e = null, s = 0;
    for (let i = 0; i < v.length; i++) { if (i < n) { s += v[i]; if (i === n - 1) { e = s / n; out[i] = e; } } else { e = v[i] * k + e * (1 - k); out[i] = e; } } return out; }
  function macd(v, r, l, sn) {
    const a = mme(v, r), b = mme(v, l), linha = v.map((_, i) => a[i] != null && b[i] != null ? a[i] - b[i] : null);
    const ini = linha.findIndex(x => x != null), sinal = new Array(v.length).fill(null);
    if (ini >= 0) { const s = mme(linha.slice(ini), sn); s.forEach((x, i) => { sinal[ini + i] = x; }); }
    return { linha, sinal, hist: linha.map((x, i) => x != null && sinal[i] != null ? x - sinal[i] : null) };
  }
  const lista = t => [...new Set(String(t || "").split(/[^0-9]+/).map(Number).filter(n => n >= 2 && n <= 400))].slice(0, 4);

  // Painel de escolha dos indicadores (botão + caixa), usado nas páginas de ação e de outros ativos
  function painelIndicadores(botao, caixa, aoMudar) {
    const desenhar = () => {
      const c = config();
      caixa.innerHTML = `<label>MME (exponencial) <input id="ind-mme" inputmode="numeric" value="${c.mme.join(", ")}" placeholder="ex.: 9, 21"></label>
        <label>MMS (simples, tracejada) <input id="ind-mms" inputmode="numeric" value="${c.mms.join(", ")}" placeholder="ex.: 50, 200"></label>
        <label class="ind-chk"><input type="checkbox" id="ind-macd" ${c.macd ? "checked" : ""}> MACD em painel</label>
        <div class="ind-macd" ${c.macd ? "" : "hidden"}><label>Rápida <input id="ind-mr" inputmode="numeric" value="${c.mr}"></label><label>Lenta <input id="ind-ml" inputmode="numeric" value="${c.ml}"></label><label>Sinal <input id="ind-ms" inputmode="numeric" value="${c.ms}"></label></div>
        <div class="ind-acoes"><button type="button" id="ind-limpar" class="sec">Sem indicadores</button><button type="button" id="ind-padrao" class="sec">Padrão</button></div>
        <p class="ind-nota">Separe os períodos por vírgula (até 4 de cada). Em gráficos diários, 21 = cerca de um mês de pregões e 200 = cerca de 10 meses.</p>`;
    };
    const ler = () => {
      const n = (id, d) => { const x = parseInt(caixa.querySelector(id)?.value, 10); return x >= 2 && x <= 100 ? x : d; };
      const c = { mme: lista(caixa.querySelector("#ind-mme").value), mms: lista(caixa.querySelector("#ind-mms").value), macd: caixa.querySelector("#ind-macd").checked,
        mr: n("#ind-mr", 12), ml: n("#ind-ml", 26), ms: n("#ind-ms", 9) };
      if (c.mr >= c.ml) c.ml = c.mr + 1;
      salvarConfig(c); caixa.querySelector(".ind-macd").hidden = !c.macd; marcar(); aoMudar(c);
    };
    const marcar = () => { const c = config(), n = c.mme.length + c.mms.length + (c.macd ? 1 : 0); botao.textContent = n ? `Indicadores (${n})` : "Indicadores"; };
    desenhar(); marcar();
    botao.addEventListener("click", () => { caixa.hidden = !caixa.hidden; botao.setAttribute("aria-expanded", String(!caixa.hidden)); });
    caixa.addEventListener("change", e => { if (e.target.matches("input")) ler(); });
    caixa.addEventListener("click", e => {
      if (e.target.id === "ind-limpar") { salvarConfig({ ...PADRAO, mme: [], mms: [], macd: false }); desenhar(); marcar(); aoMudar(config()); }
      if (e.target.id === "ind-padrao") { salvarConfig({ ...PADRAO }); desenhar(); marcar(); aoMudar(config()); }
    });
  }

  // diferença (segundos) entre o fuso da bolsa e UTC, para o eixo mostrar o horário local do pregão
  function deslocamento(ts, tz) {
    try {
      const d = new Date(ts * 1000);
      const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(d).map(x => [x.type, x.value]));
      return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - d.getTime()) / 1000;
    } catch (e) { return 0; }
  }

  function montar(el, op) {
    if (!window.LightweightCharts) { el.innerHTML = '<div class="empty">O gráfico de candles não carregou.</div>'; return null; }
    const L = window.LightweightCharts;
    let estado = { faixa: op.faixa || "1D", tipo: op.tipo || "candle" }, timer = null, ultimo = null, chart, serie, vol, linhasMM = [], seriesMacd = null, ultMM = [];
    const legenda = document.createElement("div");
    legenda.className = "lwc-leg";
    el.innerHTML = ""; el.append(legenda);
    const fmt = op.formatar || (v => v.toFixed(2));

    function criar() {
      chart?.remove();
      chart = L.createChart(el, {
        autoSize: true,
        layout: { background: { color: "transparent" }, textColor: css("--muted"), fontFamily: css("--font-num") || "sans-serif", fontSize: 11, attributionLogo: true },
        grid: { vertLines: { color: css("--line") + "88" }, horzLines: { color: css("--line") } },
        rightPriceScale: { borderColor: css("--line"), scaleMargins: { top: 0.08, bottom: 0.22 } },
        timeScale: { borderColor: css("--line"), timeVisible: !!INTRADAY[estado.faixa], secondsVisible: false, rightOffset: 3 },
        crosshair: { mode: L.CrosshairMode.Normal },
        localization: { locale: "pt-BR" },
      });
      const sobe = css("--good"), desce = css("--bad"), pf = { type: "custom", formatter: fmt, minMove: 0.0001 };
      serie = estado.tipo === "candle"
        ? chart.addSeries(L.CandlestickSeries, { priceFormat: pf, upColor: sobe, downColor: desce, wickUpColor: sobe, wickDownColor: desce, borderVisible: false, priceLineColor: css("--accent") })
        : chart.addSeries(L.AreaSeries, { priceFormat: pf, lineColor: css("--accent"), topColor: css("--accent") + "40", bottomColor: css("--accent") + "05", lineWidth: 2, priceLineColor: css("--accent") });
      vol = chart.addSeries(L.HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      linhasMM = []; seriesMacd = null;
      const c = config();
      el.classList.toggle("com-macd", !!c.macd);
      c.mme.forEach((n, i) => linhasMM.push({ n, tipo: "mme", s: chart.addSeries(L.LineSeries, { color: CORES_MM[i % 5], lineWidth: 1.5, priceFormat: pf, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }) }));
      c.mms.forEach((n, i) => linhasMM.push({ n, tipo: "mms", s: chart.addSeries(L.LineSeries, { color: CORES_MM[(i + 2) % 5], lineWidth: 1.5, lineStyle: L.LineStyle.Dashed, priceFormat: pf, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }) }));
      if (c.macd) {
        const num = v => (Math.abs(v) < 1 ? v.toFixed(3) : v.toFixed(2)).replace(".", ",");
        const o = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: { type: "custom", formatter: num, minMove: 0.001 } };
        seriesMacd = { hist: chart.addSeries(L.HistogramSeries, o, 1),
          linha: chart.addSeries(L.LineSeries, { ...o, color: css("--accent"), lineWidth: 1.5 }, 1),
          sinal: chart.addSeries(L.LineSeries, { ...o, color: "#d08a2c", lineWidth: 1.5 }, 1) };
        try { chart.panes()[1]?.setHeight(Math.round(el.clientHeight * 0.26)); } catch (e) {}
      }
      chart.subscribeCrosshairMove(p => mostrarLegenda(p));
      el.append(legenda);
    }

    function mostrarLegenda(p) {
      const d = p && p.time != null ? p.seriesData.get(serie) : null;
      const x = d || ultimo;
      if (!x) { legenda.innerHTML = ""; return; }
      const v = d ? p.seriesData.get(vol)?.value : null;
      const mm = linhasMM.map((l, i) => { const val = d ? p.seriesData.get(l.s)?.value : ultMM[i]; return val != null ? `<span style="color:${l.s.options().color}">${l.tipo.toUpperCase()} ${l.n} <b>${fmt(val)}</b></span>` : ""; }).join("");
      legenda.innerHTML = mm + (x.open != null
        ? `<span>A <b>${fmt(x.open)}</b></span><span>M <b>${fmt(x.high)}</b></span><span>m <b>${fmt(x.low)}</b></span><span>F <b>${fmt(x.close)}</b></span>${v ? `<span>Vol <b>${R.nf(0).format(v)}</b></span>` : ""}`
        : `<span><b>${fmt(x.value)}</b></span>${v ? `<span>Vol <b>${R.nf(0).format(v)}</b></span>` : ""}`);
    }

    async function carregar(manterZoom) {
      let d;
      try {
        const aq = temIndicador(config()) ? "&aq=1" : "";
        const r = await fetch(`${ENDPOINT}?s=${encodeURIComponent(op.simbolo)}&f=${estado.faixa}${aq}`, { referrerPolicy: "no-referrer" });
        d = await r.json();
        if (!r.ok || !d.t?.length) throw new Error(d.erro || "sem dados");
      } catch (e) {
        op.aoAtualizar?.({ erro: "Cotação ao vivo indisponível agora. Tente de novo em instantes." });
        return;
      }
      const off = deslocamento(d.t[d.t.length - 1], d.tz || "UTC");
      const intra = !!INTRADAY[estado.faixa];
      const tempo = (ts) => {
        if (intra) return ts + off;
        const dt = new Date((ts + off) * 1000);
        return dt.toISOString().slice(0, 10);
      };
      const vistos = new Set(), pts = [], vs = [];
      const sobe = css("--good"), desce = css("--bad");
      for (let i = 0; i < d.t.length; i++) {
        const t = tempo(d.t[i]);
        if (vistos.has(t)) continue;           // o Yahoo às vezes repete o último candle do dia
        vistos.add(t);
        pts.push(estado.tipo === "candle" ? { time: t, open: d.o[i], high: d.h[i], low: d.l[i], close: d.c[i] } : { time: t, value: d.c[i] });
        vs.push({ time: t, value: d.v[i], color: (d.c[i] >= d.o[i] ? sobe : desce) + "55" });
      }
      serie.setData(pts); vol.setData(vs);
      // indicadores calculados sobre todo o histórico baixado (inclusive o aquecimento antes da janela)
      const fech = pts.map(x => x.close ?? x.value), tempos = pts.map(x => x.time);
      const c = config(); ultMM = [];
      linhasMM.forEach(l => { const v = (l.tipo === "mme" ? mme : mms)(fech, l.n); l.s.setData(tempos.map((t, i) => v[i] != null ? { time: t, value: v[i] } : { time: t })); ultMM.push(v[v.length - 1]); });
      if (seriesMacd) {
        const m = macd(fech, c.mr, c.ml, c.ms);
        seriesMacd.linha.setData(tempos.map((t, i) => m.linha[i] != null ? { time: t, value: m.linha[i] } : { time: t }));
        seriesMacd.sinal.setData(tempos.map((t, i) => m.sinal[i] != null ? { time: t, value: m.sinal[i] } : { time: t }));
        seriesMacd.hist.setData(tempos.map((t, i) => m.hist[i] != null ? { time: t, value: m.hist[i], color: (m.hist[i] >= 0 ? sobe : desce) + "99" } : { time: t }));
      }
      ultimo = pts[pts.length - 1];
      mostrarLegenda(null);
      // com aquecimento, mostra só a janela pedida (o resto fica disponível ao arrastar para a esquerda)
      let de = null;
      if (pts.length && temIndicador(c)) {
        if (estado.faixa === "1D" || estado.faixa === "5D") {
          const dia = x => new Date(x.time * 1000).toISOString().slice(0, 10);   // x.time já está no horário da bolsa
          const dias = [...new Set(pts.map(dia))];
          const alvo = dias[Math.max(0, dias.length - (estado.faixa === "1D" ? 1 : 5))];
          de = pts.find(x => dia(x) === alvo)?.time;
        } else if (JANELA[estado.faixa]) {
          const seg = x => intra ? x.time : Date.parse(x.time) / 1000;
          const ini = seg(ultimo) - JANELA[estado.faixa] * 86400;
          de = pts.find(x => seg(x) >= ini)?.time;
        }
      }
      const p0 = de != null ? pts.find(x => x.time === de) : pts[0];
      if (!manterZoom) {
        if (de != null) chart.timeScale().setVisibleRange({ from: de, to: ultimo.time }); else chart.timeScale().fitContent();
      }
      const atraso = (Date.now() / 1000 - d.tm) / 60;
      op.aoAtualizar?.({ preco: d.p, anterior: d.pc, quando: new Date(d.tm * 1000), aberto: atraso < 25 && intra, moeda: d.cur, bolsa: d.ex,
        varPeriodo: pts.length > 1 && p0 ? (estado.tipo === "candle" ? ultimo.close / p0.open : ultimo.value / p0.value) - 1 : null });
    }

    function agendar() {
      clearInterval(timer);
      const ms = ATUALIZA[estado.faixa];
      if (ms) timer = setInterval(() => { if (!document.hidden) carregar(true); }, ms);
    }

    criar(); carregar(); agendar();
    return {
      mudar(novo) { const recria = novo.tipo && novo.tipo !== estado.tipo || novo.faixa && !!INTRADAY[novo.faixa] !== !!INTRADAY[estado.faixa]; estado = { ...estado, ...novo }; if (recria) criar(); carregar(); agendar(); },
      redesenhar() { criar(); carregar(); },
      indicadores() { criar(); carregar(); },
      parar() { clearInterval(timer); chart?.remove(); chart = null; },
    };
  }

  // Cotação de agora (para o topo da página): preço, fechamento anterior e hora do último negócio.
  async function agora(simbolo) {
    try {
      const r = await fetch(`${ENDPOINT}?s=${encodeURIComponent(simbolo)}&f=1D`, { referrerPolicy: "no-referrer" });
      const d = await r.json();
      if (!r.ok || d.p == null) return null;
      return { preco: d.p, anterior: d.pc, quando: new Date(d.tm * 1000), aberto: (Date.now() / 1000 - d.tm) / 60 < 25 };
    } catch (e) { return null; }
  }

  // Troca o preço do topo pelo de agora quando ele é mais novo que a coleta diária; repete a cada minuto.
  function topoAoVivo(caixa, simbolo, formatar, dataColeta) {
    if (!caixa) return;
    const v = caixa.querySelector(".v"), d = caixa.querySelector(".d"), rot = caixa.querySelector(".quando");
    const passo = async () => {
      if (document.hidden) return;
      const q = await agora(simbolo);
      if (!q || (dataColeta && q.quando <= dataColeta)) return;
      const varDia = q.anterior ? q.preco / q.anterior - 1 : null;
      v.textContent = formatar(q.preco);
      if (d && varDia != null) { d.className = "d " + (varDia >= 0 ? "pos" : "neg"); d.textContent = `${varDia > 0 ? "+" : ""}${R.nf(2).format(varDia * 100)}% no dia`; }
      if (rot) rot.innerHTML = `${q.aberto ? '<span class="vivo">ao vivo</span>' : ""}<span title="Cotações da B3 têm até 15 minutos de atraso nas fontes gratuitas">${q.aberto ? "" : "Último negócio "}${q.quando.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>`;
    };
    passo();
    setInterval(passo, 60e3);
  }

  window.Candles = { montar, agora, topoAoVivo, painelIndicadores, config, mme, mms, macd };
})();
