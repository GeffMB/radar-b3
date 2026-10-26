"use strict";
/* Funções compartilhadas pelas páginas do Radar B3: formatação, logos, minigráficos, menu "Mercados" e busca do topo. */
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
  // número com casas conforme a grandeza (cotações de 0,03 a 200.000)
  const numero = x => {
    if (x == null || !isFinite(x)) return "–";
    const a = Math.abs(x);
    return nf(a >= 1000 ? 2 : a >= 1 ? 2 : a >= 0.1 ? 3 : 4).format(x);
  };
  const tickerOk = t => /^[A-Z0-9]{2,7}$/.test(String(t || ""));
  const idOk = t => /^[A-Z0-9-]{1,12}$/.test(String(t || ""));

  // Logo do ativo (arquivo do próprio site) ou monograma colorido quando não há logo.
  function logo(a, tamanho) {
    const t = String(a.t || "");
    const st = tamanho ? ` style="--ls:${tamanho}px"` : "";
    const arq = a.logo ? t : a.logo_de;
    if (arq && tickerOk(arq)) return `<span class="logo"${st}><img src="logos/${arq}.svg" alt="" loading="lazy" decoding="async"></span>`;
    let h = 0; for (const c of t.slice(0, 4)) h = (h * 31 + c.charCodeAt(0)) % 360;
    return `<span class="logo mono" style="--h:${h};${tamanho ? `--ls:${tamanho}px` : ""}" aria-hidden="true">${esc(t.replace(/[^A-Z0-9]/g, "").slice(0, 2))}</span>`;
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

  // ---------------------------------------------------------------- categorias e ícones
  const IC = {
    acoes: '<path d="M3 17l5-5 4 4 8-8"/><path d="M15 8h5v5"/>',
    fiis: '<path d="M4 21V8l8-5 8 5v13"/><path d="M9 21v-6h6v6"/><path d="M9 10h.01M15 10h.01"/>',
    stocks: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    etfs: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
    bdrs: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
    indices: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    moedas: '<circle cx="9" cy="9" r="6"/><path d="M15.5 9.5a6 6 0 1 1-6 6"/><path d="M9 6.5v5M7.5 7.5h2.2a1.1 1.1 0 0 1 0 2.2H8.3a1.1 1.1 0 0 0 0 2.2h2.2"/>',
    commodities: '<path d="M7 3h10M8 3v4a6 6 0 0 0-2 4.5V19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-7.5A6 6 0 0 0 16 7V3"/><path d="M6 14h12"/>',
    rendafixa: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9.5 9.5h.01M14.5 14.5h.01"/>',
    tesouro: '<path d="M3 21h18M5 21V10M19 21V10M9 21V10M15 21V10M2 10l10-6 10 6z"/>',
    comparar: '<rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="16" rx="1.5"/>',
    carteira: '<path d="M3 7h18v12H3z"/><path d="M3 7l2-3h14l2 3"/><path d="M16 13h2"/>',
    chev: '<path d="M6 9l6 6 6-6"/>',
    seta: '<path d="M9 6l6 6-6 6"/>',
  };
  const icone = (k, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k] || ""}</svg>`;
  const CATS = [
    { id: "acoes", l: "Ações", d: "Empresas listadas na B3", href: "./" },
    { id: "fiis", l: "Fundos Imobiliários", d: "Renda mensal com imóveis e CRIs", href: "mercado.html?c=fiis" },
    { id: "stocks", l: "Stocks", d: "Ações nas bolsas dos EUA", href: "mercado.html?c=stocks" },
    { id: "etfs", l: "ETFs", d: "Fundos de índice da B3", href: "mercado.html?c=etfs" },
    { id: "bdrs", l: "BDRs", d: "Empresas de fora, negociadas em reais", href: "mercado.html?c=bdrs" },
    { id: "indices", l: "Índices", d: "Bolsas do mundo e moedas", href: "mercado.html?c=indices" },
    { id: "commodities", l: "Commodities", d: "Petróleo, ouro, soja, café…", href: "mercado.html?c=commodities" },
    { id: "moedas", l: "Moedas", d: "Câmbio em reais e conversor", href: "mercado.html?c=moedas" },
    { id: "rendafixa", l: "Renda Fixa", d: "Selic, CDI, IPCA e simulador", href: "renda-fixa.html" },
    { id: "tesouro", l: "Tesouro Direto", d: "Títulos públicos à venda hoje", href: "tesouro.html" },
  ];
  const linkAtivo = (classe, t) => classe === "acoes" ? `acao.html?t=${encodeURIComponent(t)}` : `ativo.html?c=${classe}&t=${encodeURIComponent(t)}`;

  let MENU = null, BUSCA = null;
  const carregar = (url) => fetch(url, { cache: "no-cache" }).then(r => r.ok ? r.json() : null).catch(() => null);
  const menuDados = () => MENU || (MENU = carregar("mercado/menu.json"));
  const buscaDados = () => BUSCA || (BUSCA = carregar("mercado/busca.json"));

  function listaPopulares(cat, dados) {
    if (!dados) return `<p class="mm-vazio">Carregando…</p>`;
    if (cat === "rendafixa") {
      const rf = dados.rendafixa || {};
      const lin = (n, v) => `<div class="mm-rate"><span>${n}</span><b>${v == null ? "–" : f2.format(v) + "% a.a."}</b></div>`;
      return lin("Selic (meta)", rf.selic_meta) + lin("CDI", rf.cdi) + lin("IPCA 12 meses", rf.ipca12) + lin("Poupança", rf.poupanca);
    }
    if (cat === "tesouro") {
      const ts = dados.tesouro || [];
      if (!ts.length) return `<p class="mm-vazio">Sem dados agora.</p>`;
      return ts.map(t => `<a class="mm-it mm-td" href="tesouro.html"><span class="mm-nm">${esc(t.nome)}</span><b>${esc(t.taxa)}</b></a>`).join("");
    }
    const it = dados[cat] || [];
    if (!it.length) return `<p class="mm-vazio">Sem dados agora.</p>`;
    return it.map(a => {
      const v = a.var, cls = v == null ? "" : v >= 0 ? "up" : "down";
      const preco = a.un && a.un !== "R$" ? numero(a.preco) : a.moeda === "USD" ? "US$ " + numero(a.preco) : "R$ " + numero(a.preco);
      if (cat === "moedas") return `<a class="mm-it" href="${linkAtivo(cat, a.t)}"><span class="logo mono" style="--ls:26px;--h:150" aria-hidden="true">${esc(a.t)}</span><span class="mm-tk">${esc(a.n)}</span><span class="mm-pr">R$ ${numero(a.preco)}</span><span class="mm-var ${cls}">${sinal(v, 2)}</span></a>`;
      return `<a class="mm-it" href="${linkAtivo(cat, a.t)}">${logo(a, 26)}<span class="mm-tk">${esc(a.t)}</span><span class="mm-pr">${preco}</span><span class="mm-var ${cls}">${sinal(v, 2)}</span></a>`;
    }).join("");
  }

  function montarMenu() {
    const nav = document.querySelector(".topbar .nav");
    if (!nav || nav.dataset.montado) return;
    nav.dataset.montado = "1";
    const atual = nav.dataset.atual || "";
    const cats = CATS.map(c => `<li><a href="${c.href}" data-cat="${c.id}"${c.id === atual ? ' aria-current="page"' : ""}>${icone(c.id, "mm-ic")}<span><b>${c.l}</b><small>${c.d}</small></span></a></li>`).join("");
    nav.innerHTML = `
      <div class="mm">
        <button class="mm-btn" type="button" aria-expanded="false" aria-controls="mm-pan">Mercados ${icone("chev", "mm-chev")}</button>
        <div class="mm-pan" id="mm-pan" hidden>
          <ul class="mm-cats">${cats}
            <li class="mm-sep" aria-hidden="true"></li>
            <li><a href="carteira.html" data-cat="carteira"${atual === "carteira" ? ' aria-current="page"' : ""}>${icone("carteira", "mm-ic")}<span><b>Minha carteira</b><small>Renda passiva e simulador</small></span></a></li>
            <li><a href="comparar.html" data-cat="comparar"${atual === "comparar" ? ' aria-current="page"' : ""}>${icone("comparar", "mm-ic")}<span><b>Comparar ações</b><small>Até 4 lado a lado</small></span></a></li>
          </ul>
          <div class="mm-pop" aria-live="polite"><h3 id="mm-tit">Mais negociados</h3><div class="mm-list" id="mm-list"></div><a class="btn mm-ver" id="mm-ver" href="./">Ver todos ${icone("seta", "mm-seta")}</a></div>
        </div>
      </div>
      <a class="nav-l" href="./"${atual === "acoes" ? ' aria-current="page"' : ""}>Ações</a>
      <a class="nav-l" href="mercado.html?c=fiis"${atual === "fiis" ? ' aria-current="page"' : ""}>FIIs</a>
      <a class="nav-l" href="carteira.html"${atual === "carteira" ? ' aria-current="page"' : ""}>Carteira</a>
      <a class="nav-l" href="comparar.html"${atual === "comparar" ? ' aria-current="page"' : ""}>Comparar</a>`;

    const btn = nav.querySelector(".mm-btn"), pan = nav.querySelector(".mm-pan");
    const lista = nav.querySelector("#mm-list"), tit = nav.querySelector("#mm-tit"), ver = nav.querySelector("#mm-ver");
    let catAtiva = CATS.some(c => c.id === atual) ? atual : "acoes";
    const mostrar = async cat => {
      catAtiva = cat;
      const c = CATS.find(x => x.id === cat);
      nav.querySelectorAll(".mm-cats a").forEach(a => a.classList.toggle("ativo", a.dataset.cat === cat));
      tit.textContent = cat === "rendafixa" ? "Taxas de hoje" : cat === "tesouro" ? "Títulos à venda" : cat === "indices" || cat === "commodities" || cat === "moedas" ? "Principais" : "Mais negociados";
      ver.href = c.href; ver.firstChild.textContent = cat === "rendafixa" ? "Abrir renda fixa " : `Ver ${c.l.toLowerCase()} `;
      lista.innerHTML = listaPopulares(cat, null);
      const d = await menuDados();
      if (catAtiva === cat) lista.innerHTML = listaPopulares(cat, d || {});
      vivoMenu(cat, d);
    };
    // cotações do menu: busca ao abrir/trocar de categoria e repete a cada minuto enquanto o menu está aberto
    const quandoMenu = {};
    const vivoMenu = async (cat, d, forcar) => {
      const itens = (d || {})[cat];
      if (!Array.isArray(itens) || !itens.length) return;
      if (!forcar && quandoMenu[cat] && Date.now() - quandoMenu[cat] < 55e3) return mostrarQuando(cat);
      quandoMenu[cat] = Date.now();
      const q = await cotacoesAgora(itens.map(a => simbolo(cat, a)));
      let n = 0;
      itens.forEach(a => { if (aplicarCotacao(a, q[simbolo(cat, a)])) n++; });
      if (!n) { delete quandoMenu[cat]; return; }
      quandoMenu[cat] = Date.now();
      if (catAtiva === cat && !pan.hidden) { lista.innerHTML = listaPopulares(cat, d); mostrarQuando(cat); }
    };
    const mostrarQuando = cat => { if (catAtiva === cat && quandoMenu[cat] && !lista.querySelector(".mm-quando")) lista.insertAdjacentHTML("beforeend", `<p class="mm-quando">${rotuloVivo(new Date(quandoMenu[cat]))}</p>`); };
    setInterval(async () => { if (!pan.hidden && !document.hidden) vivoMenu(catAtiva, await menuDados(), true); }, 60e3);
    const abrir = () => { if (!pan.hidden) return; const tb = document.querySelector(".topbar"); if (tb) pan.style.setProperty("--mm-top", Math.round(tb.getBoundingClientRect().bottom) + "px"); pan.hidden = false; btn.setAttribute("aria-expanded", "true"); document.body.classList.add("mm-aberto"); mostrar(catAtiva); };
    const fechar = () => { if (pan.hidden) return; pan.hidden = true; btn.setAttribute("aria-expanded", "false"); document.body.classList.remove("mm-aberto"); };
    btn.addEventListener("click", () => pan.hidden ? abrir() : fechar());
    const fino = matchMedia("(hover: hover) and (pointer: fine)");
    let t;
    nav.querySelector(".mm").addEventListener("pointerenter", () => { if (fino.matches && innerWidth > 760) { clearTimeout(t); t = setTimeout(abrir, 120); } });
    nav.querySelector(".mm").addEventListener("pointerleave", () => { if (fino.matches && innerWidth > 760) { clearTimeout(t); t = setTimeout(fechar, 220); } });
    nav.querySelectorAll(".mm-cats a[data-cat]").forEach(a => {
      const c = a.dataset.cat;
      if (c === "comparar" || c === "carteira") return;
      a.addEventListener("pointerenter", () => { if (innerWidth > 760) mostrar(c); });
      a.addEventListener("focus", () => { if (innerWidth > 760) mostrar(c); });
    });
    document.addEventListener("click", e => { if (!nav.contains(e.target)) fechar(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !pan.hidden) { fechar(); btn.focus(); } });
  }

  // ---------------------------------------------------------------- busca do topo (todas as classes)
  function ligarBusca(acoes) {
    const f = document.getElementById("jump"), i = document.getElementById("jump-t"), dl = document.getElementById("jump-lista");
    if (!f || !i) return;
    let indice = (acoes || []).map(a => [a.t, a.n, "acoes"]);
    const preencher = () => { if (dl) dl.innerHTML = indice.map(([t, n]) => `<option value="${esc(t)}">${esc(n)}</option>`).join(""); };
    preencher();
    buscaDados().then(b => { if (Array.isArray(b) && b.length) { indice = b; preencher(); } });
    if (f.dataset.ligado) return;
    f.dataset.ligado = "1";
    f.addEventListener("submit", e => {
      e.preventDefault();
      const q = i.value.trim().toUpperCase();
      const t = q.replace(/[^A-Z0-9-]/g, "");
      if (!t) return;
      const achado = indice.find(([x]) => x === t) || indice.find(([, n]) => String(n).toUpperCase() === q)
        || indice.find(([x, n]) => x.startsWith(t) || String(n).toUpperCase().includes(q));
      location.href = achado ? linkAtivo(achado[2], achado[0]) : "acao.html?t=" + encodeURIComponent(t);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", montarMenu); else montarMenu();
  document.addEventListener("DOMContentLoaded", () => { if (!document.getElementById("jump")?.dataset.ligado) ligarBusca([]); });

  // ---------------------------------------------------------------- cotações ao vivo para listas e tabelas
  // Busca no servidor do site (que consulta o Yahoo e guarda por 1 minuto) e repete a cada minuto com a aba visível.
  const URL_COTACOES = "https://radar-assistente.gefersonmarques.workers.dev/cotacoes";
  function simbolo(classe, a) {
    if (["acoes", "fiis", "etfs", "bdrs"].includes(classe)) return a.t + ".SA";
    if (classe === "stocks") return a.t;
    if (a.y) return a.y;
    // moedas sem par direto com o real: cruza pelo dólar (R$ por US$ ÷ moeda por US$) × unidades
    if (classe === "moedas" && /^[A-Z]{3}$/.test(a.t || "") && a.t !== "USD") return `USDBRL=X/${a.t}=X*${a.mult || 1}`;
    return null;
  }
  // "A/B*m" = cotação cruzada; demais são símbolos simples
  const partes = s => { const m = /^([^/]+)\/([^*]+)\*(\d+)$/.exec(s); return m ? { a: m[1], b: m[2], m: +m[3] } : null; };
  async function cotacoesAgora(simbolos) {
    const pedidos = [...new Set(simbolos.filter(Boolean))];
    const lista = [...new Set(pedidos.flatMap(s => { const x = partes(s); return x ? [x.a, x.b] : [s]; }))];
    const out = {};
    for (let i = 0; i < lista.length; i += 200) {
      try {
        const r = await fetch(`${URL_COTACOES}?s=${encodeURIComponent(lista.slice(i, i + 200).join(","))}`, { referrerPolicy: "no-referrer" });
        if (r.ok) Object.assign(out, await r.json());
      } catch (e) { /* sem cotação ao vivo: a página segue com o último fechamento */ }
    }
    for (const s of pedidos) {
      const x = partes(s); if (!x) continue;
      const A = out[x.a], B = out[x.b];
      if (A?.p > 0 && B?.p > 0) out[s] = { p: A.p / B.p * x.m, pc: A.pc > 0 && B.pc > 0 ? A.pc / B.pc * x.m : null, tm: Math.min(A.tm || 0, B.tm || 0) || null };
    }
    return out;
  }
  // Atualiza preço, variação do dia e indicadores que dependem do preço; devolve quantos itens mudaram.
  function aplicarCotacao(a, q) {
    if (!q || !(q.p > 0) || !(a.preco > 0)) return false;
    const f = q.p / a.preco;
    if (a._fech == null) a._fech = a.preco;          // fechamento da coleta, para referência
    a.preco = q.p;
    if (q.pc > 0) a.var = q.p / q.pc - 1;
    if (Math.abs(f - 1) > 1e-9) {
      for (const k of ["pl", "pvp", "mc"]) if (a[k] != null) a[k] *= f;
      if (a.dy != null) a.dy /= f;
    }
    a._vivo = true;
    return true;
  }
  // Liga a atualização periódica: itens = [[objeto, símbolo]], aoMudar() redesenha a página.
  function aoVivo(itens, aoMudar, intervalo = 60e3) {
    const pares = itens.filter(([, s]) => s);
    if (!pares.length) return;
    const passo = async () => {
      if (document.hidden) return;
      const q = await cotacoesAgora(pares.map(([, s]) => s));
      let n = 0;
      for (const [a, s] of pares) if (aplicarCotacao(a, q[s])) n++;
      if (n) aoMudar(new Date(), n);
    };
    passo();
    setInterval(passo, intervalo);
  }
  const rotuloVivo = (quando) => `<span class="vivo">ao vivo</span><span title="Cotações da B3 com até 15 minutos de atraso nas fontes gratuitas">cotações de ${quando.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>`;

  // ---------------------------------------------------------------- método Barsi: DY desejado e preço-teto
  // DY desejado fica salvo neste navegador e vale para todas as páginas.
  const dyAlvo = () => { try { const v = parseFloat(localStorage.getItem("radar-dy-alvo")); return v >= 1 && v <= 30 ? v / 100 : 0.06; } catch (e) { return 0.06; } };
  const definirDyAlvo = v => { try { localStorage.setItem("radar-dy-alvo", String(v * 100)); } catch (e) {} document.dispatchEvent(new Event("radar:dy-alvo")); };
  // teto = média dos proventos dos últimos 5 anos ÷ DY desejado; desconto > 0 quando a cotação está abaixo do teto
  // concessões reguladas (energia e saneamento) têm receita previsível e operam com mais dívida
  const limiteDivida = o => o.setor === "Energia Elétrica" || o.setor === "Saneamento" ? 4.5 : 3;
  function barsi(o, alvo = dyAlvo()) {
    const teto = o.pm5 > 0 ? o.pm5 / alvo : null;
    const desconto = teto && o.preco ? 1 - o.preco / teto : null;
    const crit = {
      best: !!o.best,
      reg: o.regb >= 5 ? o.reg >= o.regb - 1 : null,
      teto: desconto == null ? null : desconto >= 0,
      lucro: o.lucro_n ? o.lucro_pos === o.lucro_n : o.pl != null ? o.pl > 0 : null,
      divida: o.fin ? true : o.dle == null ? null : o.dle <= limiteDivida(o),
      payout: o.payout == null ? null : o.payout <= 1,
    };
    // setor, regularidade e teto precisam ser confirmados; lucro, dívida e payout só excluem quando o dado existe e reprova
    const ok = crit.best && crit.reg === true && crit.teto === true && crit.lucro !== false && crit.divida !== false && crit.payout !== false;
    return { teto, desconto, dy5: o.pm5 && o.preco ? o.pm5 / o.preco : null, crit, ok, limiteDiv: limiteDivida(o) };
  }

  window.R = { simbolo, cotacoesAgora, aplicarCotacao, aoVivo, rotuloVivo, dyAlvo, definirDyAlvo, barsi, nf, f0, f1, f2, esc, pct, sinal, brl, big, numero, logo, spark, ligarBusca, tickerOk, idOk, icone, CATS, linkAtivo, carregar };
})();
