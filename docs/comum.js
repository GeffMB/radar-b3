"use strict";
/* Funções compartilhadas pelas páginas do Radar B3: formatação, logos, minigráficos e busca do topo. */
(function () {
  const nf = d => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const f0 = nf(0), f1 = nf(1), f2 = nf(2);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (x, d = 1) => x == null || !isFinite(x) ? "–" : nf(d).format(x * 100) + "%";
  const sinal = (x, d = 1) => x == null || !isFinite(x) ? "–" : (x > 0 ? "+" : "") + nf(d).format(x * 100) + "%";
  const brl = x => x == null ? "–" : "R$ " + f2.format(x);
  const big = x => {
    if (x == null) return "–"; const a = Math.abs(x);
    if (a >= 1e12) return "R$ " + f2.format(x / 1e12) + " tri";
    if (a >= 1e9) return "R$ " + f1.format(x / 1e9) + " bi";
    return "R$ " + f0.format(x / 1e6) + " mi";
  };
  const tickerOk = t => /^[A-Z0-9]{4,7}$/.test(String(t || ""));

  // Logo do ativo (arquivo do próprio site) ou monograma colorido quando não há logo.
  function logo(a, tamanho) {
    const t = String(a.t || "");
    const st = tamanho ? ` style="--ls:${tamanho}px"` : "";
    if (a.logo && tickerOk(t)) return `<span class="logo"${st}><img src="logos/${t}.svg" alt="" loading="lazy" decoding="async"></span>`;
    let h = 0; for (const c of t.slice(0, 4)) h = (h * 31 + c.charCodeAt(0)) % 360;
    return `<span class="logo mono" style="--h:${h};${tamanho ? `--ls:${tamanho}px` : ""}" aria-hidden="true">${esc(t.slice(0, 2))}</span>`;
  }

  // Minigráfico em SVG; a cor segue o resultado do período.
  function spark(v, w = 96, h = 30) {
    const s = (v || []).filter(x => x != null && isFinite(x));
    if (s.length < 3) return `<span class="na">–</span>`;
    const min = Math.min(...s), max = Math.max(...s), r = max - min || 1;
    const pts = s.map((y, i) => [(i / (s.length - 1)) * (w - 4) + 2, h - 3 - ((y - min) / r) * (h - 6)]);
    const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("");
    const up = s[s.length - 1] >= s[0];
    const cor = up ? "var(--good)" : "var(--bad)";
    const [lx, ly] = pts[pts.length - 1];
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
      <path d="${d}L${(w - 2).toFixed(1)} ${h}L2 ${h}Z" fill="${cor}" fill-opacity=".10"/>
      <path d="${d}" fill="none" stroke="${cor}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.2" fill="${cor}"/></svg>`;
  }

  // Busca do topo: lista de tickers e ida direta para a página da ação.
  function ligarBusca(acoes) {
    const f = document.getElementById("jump"), i = document.getElementById("jump-t"), dl = document.getElementById("jump-lista");
    if (!f || !i) return;
    if (dl && acoes) dl.innerHTML = acoes.map(a => `<option value="${esc(a.t)}">${esc(a.n)}</option>`).join("");
    f.addEventListener("submit", e => {
      e.preventDefault();
      const t = i.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (t) location.href = "acao.html?t=" + encodeURIComponent(t);
    });
  }

  window.R = { nf, f0, f1, f2, esc, pct, sinal, brl, big, logo, spark, ligarBusca, tickerOk };
})();
