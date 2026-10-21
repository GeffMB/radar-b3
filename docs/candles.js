"use strict";
/* Gráfico de candles com cotação ao vivo (durante o pregão), usando TradingView Lightweight Charts.
   Os candles vêm do servidor do site (Cloudflare), que consulta o Yahoo e guarda a resposta por 1 minuto.
   Uso: const g = Candles.montar(elemento, { simbolo: "PETR4.SA", tipo: "candle"|"linha", faixa: "1D", formatar, aoAtualizar }) */
(function () {
  const ENDPOINT = "https://radar-assistente.gefersonmarques.workers.dev/cotacao";
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const INTRADAY = { "1D": 1, "5D": 1, "1M": 1 };
  const ATUALIZA = { "1D": 60e3, "5D": 120e3 };

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
    let estado = { faixa: op.faixa || "1D", tipo: op.tipo || "candle" }, timer = null, ultimo = null, chart, serie, vol;
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
        localization: { locale: "pt-BR", priceFormatter: fmt },
      });
      const sobe = css("--good"), desce = css("--bad");
      serie = estado.tipo === "candle"
        ? chart.addSeries(L.CandlestickSeries, { upColor: sobe, downColor: desce, wickUpColor: sobe, wickDownColor: desce, borderVisible: false, priceLineColor: css("--accent") })
        : chart.addSeries(L.AreaSeries, { lineColor: css("--accent"), topColor: css("--accent") + "40", bottomColor: css("--accent") + "05", lineWidth: 2, priceLineColor: css("--accent") });
      vol = chart.addSeries(L.HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      chart.subscribeCrosshairMove(p => mostrarLegenda(p));
      el.append(legenda);
    }

    function mostrarLegenda(p) {
      const d = p && p.time != null ? p.seriesData.get(serie) : null;
      const x = d || ultimo;
      if (!x) { legenda.innerHTML = ""; return; }
      const v = d ? p.seriesData.get(vol)?.value : null;
      legenda.innerHTML = x.open != null
        ? `<span>A <b>${fmt(x.open)}</b></span><span>M <b>${fmt(x.high)}</b></span><span>m <b>${fmt(x.low)}</b></span><span>F <b>${fmt(x.close)}</b></span>${v ? `<span>Vol <b>${R.nf(0).format(v)}</b></span>` : ""}`
        : `<span><b>${fmt(x.value)}</b></span>${v ? `<span>Vol <b>${R.nf(0).format(v)}</b></span>` : ""}`;
    }

    async function carregar(manterZoom) {
      let d;
      try {
        const r = await fetch(`${ENDPOINT}?s=${encodeURIComponent(op.simbolo)}&f=${estado.faixa}`, { referrerPolicy: "no-referrer" });
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
      ultimo = pts[pts.length - 1];
      mostrarLegenda(null);
      if (!manterZoom) chart.timeScale().fitContent();
      const atraso = (Date.now() / 1000 - d.tm) / 60;
      op.aoAtualizar?.({ preco: d.p, anterior: d.pc, quando: new Date(d.tm * 1000), aberto: atraso < 25 && intra, moeda: d.cur, bolsa: d.ex,
        varPeriodo: pts.length > 1 ? (estado.tipo === "candle" ? ultimo.close / pts[0].open : ultimo.value / pts[0].value) - 1 : null });
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
      parar() { clearInterval(timer); chart?.remove(); chart = null; },
    };
  }

  window.Candles = { montar };
})();
