"use strict";
/* Página de um ativo de qualquer classe (FII, ETF, BDR, stock, índice, commodity):
   cabeçalho com cotação, indicadores principais, gráfico de cotação/retorno, proventos e, nos FIIs, P/VP ao longo do tempo. */
const $ = id => document.getElementById(id);
const { esc, pct, sinal, brl, numero, f1, f2, logo } = R;
const f4 = R.nf(4);
const qs = new URLSearchParams(location.search);
const CLASSE = (qs.get("c") || "").toLowerCase();
const ID = (qs.get("t") || "").toUpperCase().replace(/[^A-Z0-9-]/g, "");
const nav = document.querySelector(".topbar .nav");
if (nav) nav.dataset.atual = CLASSE;

const NOMES = { fiis: "Fundo Imobiliário", etfs: "ETF", bdrs: "BDR", stocks: "Stock (EUA)", indices: "Índice", commodities: "Commodity", moedas: "Moeda" };
const LISTA = { fiis: "Fundos Imobiliários", etfs: "ETFs", bdrs: "BDRs", stocks: "Stocks", indices: "Índices", commodities: "Commodities", moedas: "Moedas" };
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const dataBR = s => { const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; };
const mesBR = s => { const [y, m] = s.split("-"); return `${m}/${y}`; };
const mult = (x, d = 2) => x == null ? "–" : R.nf(d).format(x);
const usd = x => x == null ? "–" : "US$ " + f2.format(x);
const bigUSD = x => { if (x == null) return "–"; const a = Math.abs(x);
  if (a >= 1e12) return "US$ " + f2.format(x / 1e12) + " tri"; if (a >= 1e9) return "US$ " + f1.format(x / 1e9) + " bi"; return "US$ " + f1.format(x / 1e6) + " mi"; };
const liq = x => x == null ? "–" : x >= 1e6 ? "R$ " + f1.format(x / 1e6) + " mi" : "R$ " + f1.format(x / 1e3) + " mil";
const cls = x => x == null ? "" : x >= 0 ? "pos" : "neg";

let A = null, DET = null, B3PROV = null, charts = {}, faixa = "1A", modo = "preco", tipo = "linha", GRAF = null;

function moeda(v) {
  if (CLASSE === "stocks") return usd(v);
  if (CLASSE === "indices" || CLASSE === "commodities") return A.un === "R$" ? brl(v) : A.un === "%" ? R.nf(2).format(v) + "%" : numero(v);
  if (CLASSE === "moedas") return "R$ " + R.nf(Math.abs(v) >= 10 ? 2 : 4).format(v);
  return brl(v);
}
function eixo(v) {
  if (CLASSE === "stocks") return "US$ " + R.f0.format(v);
  if (CLASSE === "indices" || CLASSE === "commodities") return A.un === "R$" ? "R$ " + f2.format(v) : numero(v);
  if (CLASSE === "moedas") return "R$ " + R.nf(Math.abs(v) >= 10 ? 2 : 4).format(v);
  return "R$ " + f2.format(v);
}

async function main() {
  if (!NOMES[CLASSE] || !R.idOk(ID)) return erro("Ativo não encontrado.");
  const lista = await R.carregar(`mercado/${CLASSE}.json`);
  A = lista?.itens?.find(x => x.t === ID);
  if (!A) return erro(`<b>${esc(ID)}</b> não está na lista de ${LISTA[CLASSE]}.`);
  DET = await R.carregar(`mercado/${CLASSE}/${ID}.json`);
  if (CLASSE === "fiis") B3PROV = (await R.carregar("mercado/proventos.json"))?.itens?.[ID] || null;
  document.title = `${A.t} · ${A.n} · Radar B3`;
  R.ligarBusca([]);
  desenharHero();
  desenharCards();
  const sym = simboloYahoo();
  if (sym) {
    $("tipo").hidden = false;
    try { tipo = localStorage.getItem("radar-tipo-grafico") || tipo; } catch (e) {}
    $("tipo").onclick = e => { const b = e.target.closest("button"); if (!b) return; tipo = b.dataset.t; try { localStorage.setItem("radar-tipo-grafico", tipo); } catch (e) {} desenharPreco(); };
  } else document.querySelectorAll("#ranges [data-vivo]").forEach(b => b.remove());
  if (DET?.precos?.d?.length || sym) {
    try { faixa = localStorage.getItem("radar-range") || faixa; } catch (e) {}
    $("ranges").onclick = e => { const b = e.target.closest("button"); if (!b) return; faixa = b.dataset.r; try { localStorage.setItem("radar-range", faixa); } catch (e) {} desenharPreco(); };
    if (DET?.proventos?.length) {
      $("modo").hidden = false;
      $("modo").onclick = e => { const b = e.target.closest("button"); if (!b) return; modo = b.dataset.m; desenharPreco(); };
    }
    desenharTudo();
    document.addEventListener("radar:tema", desenharTudo);
  } else {
    $("p-preco").hidden = true;
    if (A.desde) $("cards").insertAdjacentHTML("afterend", `<div class="msg">A B3 não publica o histórico deste índice. O site guarda o fechamento de cada dia desde ${A.desde.split("-").reverse().join("/")}, e o gráfico aparece a partir do segundo dia.</div>`);
  }
  configurarAssistente();
}

function erro(msg) { $("conteudo").innerHTML = `<div class="msg">${msg} Volte para <a href="mercado.html?c=${esc(CLASSE || "fiis")}">${esc(LISTA[CLASSE] || "Mercados")}</a>.</div>`; }

function desenharHero() {
  const grupo = A.seg || A.cat || A.setor || A.grupo;
  const semLogo = ["indices", "commodities", "moedas"].includes(CLASSE);
  const titulo = semLogo ? esc(A.n) : esc(A.t);
  const sub = CLASSE === "moedas" ? esc(A.unid || "R$") : semLogo ? (A.un === "pontos" ? "Pontos" : esc(A.un)) : esc(A.n);
  const pos = A.max52 && A.min52 && A.max52 > A.min52 ? (A.preco - A.min52) / (A.max52 - A.min52) * 100 : null;
  $("hero").innerHTML = `
    <div class="hero-id">${semLogo ? `<span class="logo mono hero-ic" style="--ls:64px;--h:170">${R.icone(CLASSE, "")}</span>` : logo(A, 64)}
      <div><h1>${titulo}</h1>
        <div class="sub">${sub} · <a href="mercado.html?c=${CLASSE}">${NOMES[CLASSE]}</a>${grupo ? ` · <span class="badge">${esc(grupo)}</span>` : ""}</div>
        ${links()}</div></div>
    ${pos != null ? `<div class="range52"><span class="label">Faixa de 52 semanas</span><div class="bar"><span class="dot" style="left:${Math.max(0, Math.min(100, pos))}%"></span></div>
      <div class="ends"><span>${moeda(A.min52)}</span><span>${moeda(A.max52)}</span></div></div>` : ""}
    <div class="price"><span class="v">${moeda(A.preco)}</span>${A.brl ? `<span class="note">≈ ${brl(A.brl)}${A.un_brl ? " " + esc(A.un_brl.replace("R$", "")) : ""}</span>` : ""}<span class="d ${cls(A.var)}">${sinal(A.var, 2)} no dia</span>
      <span class="note quando">Fechamento de ${dataBR(A.data)}</span></div>`;
  const sym = simboloYahoo();
  if (sym && window.Candles) Candles.topoAoVivo($("hero").querySelector(".price"), sym, v => moeda(v), new Date(A.data + "T23:59:00"));
}

function links() {
  const l = [];
  if (A.bdr) l.push(`<a class="btn" href="ativo.html?c=bdrs&t=${A.bdr}">BDR na B3: ${A.bdr}</a>`);
  if (A.stock) l.push(`<a class="btn" href="ativo.html?c=stocks&t=${A.stock}">Ação nos EUA: ${A.stock}</a>`);
  return l.length ? `<div class="links">${l.join("")}</div>` : "";
}

function card(l, v, cmp, tag) {
  return `<div class="card"><span class="label">${l}</span><span class="v">${v}</span>${tag || ""}${cmp ? `<span class="cmp">${cmp}</span>` : ""}</div>`;
}

function desenharCards() {
  const r = DET?.retorno || {};
  const rt = k => r[k] ? (r[k].t != null && DET.proventos?.length ? r[k].t : r[k].p) : null;
  let C = [];
  if (CLASSE === "fiis") {
    const up = A.ult_prov;
    C = [
      card("DY 12 meses", A.dy == null ? "–" : pct(A.dy), A.prov12 ? `${brl(A.prov12)} por cota em 12 meses` : ""),
      card("Último rendimento", up ? brl(up.v) : "–", up ? `${pct(A.dy_mes, 2)} da cotação · data com ${dataBR(up.d)}` : ""),
      card("P/VP", mult(A.pvp), A.vp ? `Valor patrimonial ${brl(A.vp)} por cota${A.vp_mes ? ` (${mesBR(A.vp_mes)})` : ""}` : "",
        A.pvp == null ? "" : `<span class="tag ${A.pvp < 0.95 ? "good" : A.pvp > 1.05 ? "bad" : "neu"}">${A.pvp < 0.95 ? "abaixo do patrimônio" : A.pvp > 1.05 ? "acima do patrimônio" : "perto do patrimônio"}</span>`),
      card("Liquidez diária", liq(A.liq), "Média negociada por dia no último mês"),
      card("Patrimônio líquido", A.patrimonio ? R.big(A.patrimonio) : "–", A.cotistas ? `${R.f0.format(A.cotistas)} cotistas` : ""),
      card("Retorno 12 meses", sinal(rt("1a")), "Cotação + rendimentos reinvestidos"),
    ];
  } else if (CLASSE === "etfs") {
    C = [
      card("Retorno 12 meses", sinal(A.r12), "Variação da cota"),
      card("No ano", sinal(A.rytd)),
      card("5 anos", sinal(A.r5a)),
      card("Liquidez diária", liq(A.liq), "Média negociada por dia no último mês"),
      card("Índice de referência", `<span style="font-size:17px">${esc(A.ref)}</span>`, esc(A.cat)),
    ];
    if (A.dy) C.splice(1, 0, card("DY 12 meses", pct(A.dy), "Este ETF distribui proventos"));
  } else if (CLASSE === "bdrs" || CLASSE === "stocks") {
    C = [
      card("P/L", A.pl == null ? "–" : mult(A.pl, 1), A.pl != null && A.pl < 0 ? "Prejuízo nos últimos 12 meses" : "Preço ÷ lucro por ação"),
      card("P/VP", mult(A.pvp), "Preço ÷ valor patrimonial"),
      card("DY 12 meses", A.dy == null ? "–" : pct(A.dy, 2), CLASSE === "bdrs" ? "Já descontado o imposto retido nos EUA" : ""),
      card("ROE", A.roe == null ? "–" : pct(A.roe), A.ml == null ? "Lucro ÷ patrimônio" : `Margem líquida ${pct(A.ml)}`),
      CLASSE === "stocks" ? card("Valor de mercado", bigUSD(A.mc)) : card("Liquidez diária", liq(A.liq), "Média negociada por dia no último mês"),
      card("Retorno 12 meses", sinal(rt("1a")), "Cotação + dividendos reinvestidos"),
    ];
  } else {
    C = [
      card("No ano", sinal(A.rytd)),
      card("1 mês", sinal(A.r1m)),
      card("12 meses", sinal(A.r12)),
      card("5 anos", sinal(A.r5a)),
      card("Máxima em 52 semanas", moeda(A.max52)),
      card("Mínima em 52 semanas", moeda(A.min52)),
    ];
  }
  $("cards").innerHTML = C.join("");
  $("cards").querySelectorAll(".card .v").forEach(el => { const t = el.textContent; if (/^[+-]/.test(t) && /%$/.test(t)) el.classList.add(t.startsWith("-") ? "neg" : "pos"); });
}

function base() {
  const ink = css("--muted"), line = css("--line");
  Chart.defaults.font.family = css("--font-num") || "monospace";
  Chart.defaults.font.size = 11;
  Chart.defaults.color = ink;
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: { legend: { display: false }, tooltip: { backgroundColor: css("--ink"), titleColor: css("--bg"), bodyColor: css("--bg"), padding: 10, displayColors: false } },
    scales: { x: { grid: { display: false }, border: { color: line }, ticks: { maxRotation: 0, autoSkipPadding: 18 } },
      y: { grid: { color: line }, border: { display: false } } },
  };
}

function desenharTudo() { if (GRAF) { GRAF.parar(); GRAF = null; } desenharPreco(); if (DET) { desenharProventos(); desenharPVP(); } }

function indiceRT(D, C, provs) {
  const P = [...provs].sort((a, b) => a[0] < b[0] ? -1 : 1);
  let j = 0; while (j < P.length && P[j][0] <= D[0]) j++;
  const idx = [1];
  for (let i = 1; i < D.length; i++) {
    let div = 0; while (j < P.length && P[j][0] <= D[i]) { div += P[j][1]; j++; }
    idx.push(idx[i - 1] * (C[i] + div) / C[i - 1]);
  }
  return idx;
}

// símbolo no Yahoo para os candles ao vivo (índices da B3 sem fonte de candles ficam só com a linha)
function simboloYahoo() {
  if (["fiis", "etfs", "bdrs"].includes(CLASSE)) return ID + ".SA";
  if (CLASSE === "stocks") return ID;
  return A.y || null;
}

function desenharCandles() {
  $("cx-preco").hidden = true; $("lwc").hidden = false; $("modo").hidden = true; $("aprox").hidden = true;
  const atualizar = info => {
    if (info.erro) { $("var-periodo").innerHTML = `<span class="na">${info.erro}</span>`; return; }
    const hora = info.quando.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const v = info.varPeriodo;
    $("var-periodo").innerHTML = `${info.aberto ? '<span class="vivo">ao vivo</span>' : ""}${v == null ? "" : `No período: <b class="${v >= 0 ? "pos" : "neg"}">${sinal(v)}</b> · `}<span title="Cotações da B3 têm até 15 minutos de atraso nas fontes gratuitas">último negócio ${hora}</span>`;
  };
  if (!GRAF) GRAF = Candles.montar($("lwc"), { simbolo: simboloYahoo(), tipo, faixa, formatar: v => eixo(v), aoAtualizar: atualizar });
  else GRAF.mudar({ tipo, faixa });
}

function desenharPreco() {
  document.querySelectorAll("#ranges button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.r === faixa)));
  document.querySelectorAll("#tipo button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.t === tipo)));
  if (simboloYahoo() && window.Candles && (tipo === "candle" || faixa === "1D" || faixa === "5D" || !DET?.precos?.d?.length)) {
    if (!DET?.precos?.d?.length && !["1D", "5D"].includes(faixa) && tipo !== "candle") tipo = "candle";
    return desenharCandles();
  }
  GRAF?.parar(); GRAF = null;
  $("cx-preco").hidden = false; $("lwc").hidden = true;
  if (DET?.proventos?.length) $("modo").hidden = false;
  document.querySelectorAll("#modo button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.m === modo)));
  const meses = { "1M": 1, "6M": 6, "1A": 12, "2A": 24, "5A": 60 }[faixa] || 12;
  const P = DET.precos;
  const fim = new Date(P.d[P.d.length - 1] + "T12:00:00");
  const ini = new Date(fim); ini.setMonth(ini.getMonth() - meses);
  const iniS = ini.toISOString().slice(0, 10);
  let i0 = P.d.findIndex(d => d >= iniS); if (i0 < 0) i0 = 0;
  const D = P.d.slice(i0), C = P.c.slice(i0);
  const comProv = (DET.proventos || []).length > 0;
  const RT = comProv ? indiceRT(D, C, DET.proventos) : null;
  const v = C.length > 1 ? C[C.length - 1] / C[0] - 1 : null;
  const sn = x => `<b class="${cls(x)}">${sinal(x)}</b>`;
  $("var-periodo").innerHTML = v == null ? "" : comProv ? `Só cotação: ${sn(v)} · Com proventos: ${sn(RT[RT.length - 1] - 1)}` : `No período: ${sn(v)}`;
  const o = base();
  o.scales.x.ticks.callback = function (val) { const d = this.getLabelForValue(val); const [y, m, dd] = d.split("-"); return meses <= 6 ? `${dd}/${m}` : `${m}/${y.slice(2)}`; };
  const ctx = $("c-preco");
  charts.preco?.destroy();
  if (modo === "retorno" && comProv) {
    const acc = css("--accent"), mut = css("--muted");
    o.plugins.legend = { display: true, position: "bottom", labels: { boxWidth: 14, boxHeight: 2 } };
    o.scales.y.ticks = { callback: x => (x > 0 ? "+" : "") + f1.format(x) + "%" };
    o.plugins.tooltip.callbacks = { title: it => dataBR(it[0].label), label: it => `${it.dataset.label}: ${it.parsed.y > 0 ? "+" : ""}${f1.format(it.parsed.y)}%` };
    o.plugins.tooltip.displayColors = true;
    charts.preco = new Chart(ctx, { type: "line", data: { labels: D, datasets: [
      { label: "Retorno total (proventos reinvestidos)", data: RT.map(x => (x - 1) * 100), borderColor: acc, backgroundColor: acc, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0 },
      { label: "Só cotação", data: C.map(c => (c / C[0] - 1) * 100), borderColor: mut, backgroundColor: mut, borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, pointHoverRadius: 3, tension: 0 },
    ] }, options: o });
  } else {
    const corL = v == null || v >= 0 ? css("--good") : css("--bad");
    o.scales.y.ticks = { callback: x => eixo(x) };
    o.plugins.tooltip.callbacks = { title: it => dataBR(it[0].label), label: it => moeda(it.parsed.y) };
    const g = ctx.getContext("2d").createLinearGradient(0, 0, 0, 300);
    g.addColorStop(0, corL + "33"); g.addColorStop(1, corL + "00");
    charts.preco = new Chart(ctx, { type: "line", data: { labels: D, datasets: [{ data: C, borderColor: corL, backgroundColor: g, fill: true, borderWidth: 1.75, pointRadius: 0, pointHoverRadius: 4, tension: 0 }] }, options: o });
  }
  $("aprox").hidden = !A.aprox;
  if (A.aprox) $("aprox").textContent = `Histórico aproximado pelo ETF ${A.aprox}, que replica o índice (inclui a taxa do fundo). O valor de hoje é o oficial da B3.`;
}

function desenharProventos() {
  const sec = $("p-prov");
  if (!DET.proventos?.length) { sec.hidden = true; return; }
  sec.hidden = false;
  const acc = css("--accent"), acc2 = css("--accent-2");
  const o = base();
  charts.prov?.destroy();
  if (CLASSE === "fiis" && DET.prov_mes?.length) {
    const M = DET.prov_mes.slice(-24);
    $("prov-tit").textContent = "Rendimentos mensais";
    $("prov-nota").textContent = "R$ por cota, pela data com (último dia para ter direito)";
    o.scales.y.ticks = { callback: v => "R$ " + f2.format(v) };
    o.plugins.tooltip.callbacks = { title: it => mesBR(M[it[0].dataIndex][0]), label: it => `R$ ${f4.format(it.parsed.y)} por cota` };
    o.scales.x.ticks.callback = function (v) { return mesBR(this.getLabelForValue(v)).replace("/20", "/"); };
    charts.prov = new Chart($("c-prov"), { type: "bar", data: { labels: M.map(x => x[0]), datasets: [{ data: M.map(x => x[1]), backgroundColor: acc, borderRadius: 3 }] }, options: o });
  } else {
    const Y = (DET.prov_ano || []).filter((x, i, arr) => arr.slice(0, i + 1).some(y => y.total > 0));
    $("prov-tit").textContent = "Proventos por ano";
    $("prov-nota").textContent = CLASSE === "stocks" ? "US$ por ação e dividend yield de cada ano" : "R$ por cota/ação e dividend yield de cada ano";
    const moedaP = CLASSE === "stocks" ? "US$ " : "R$ ";
    o.plugins.legend = { display: true, position: "bottom", labels: { boxWidth: 10, boxHeight: 10 } };
    o.scales.y.ticks = { callback: v => moedaP + f2.format(v) };
    o.scales.y2 = { position: "right", grid: { display: false }, border: { display: false }, ticks: { callback: v => f1.format(v) + "%" }, min: 0 };
    o.plugins.tooltip.callbacks = { title: it => { const x = Y[it[0].dataIndex]; return x.parcial ? `${x.ano} (até hoje)` : String(x.ano); },
      label: it => it.datasetIndex === 0 ? `Proventos: ${moedaP}${f4.format(it.parsed.y)}` : `DY: ${f1.format(it.parsed.y)}%` };
    charts.prov = new Chart($("c-prov"), { data: { labels: Y.map(x => x.parcial ? x.ano + "*" : String(x.ano)), datasets: [
      { type: "bar", label: "Proventos", data: Y.map(x => x.total), backgroundColor: Y.map(x => x.parcial ? acc + "66" : acc), borderRadius: 3, yAxisID: "y", order: 2 },
      { type: "line", label: "DY no ano", data: Y.map(x => x.dy == null ? null : x.dy * 100), borderColor: acc2, backgroundColor: acc2, borderWidth: 2, pointRadius: 3, yAxisID: "y2", order: 1, tension: 0 },
    ] }, options: o });
  }
  if (B3PROV?.length) {
    const hoje = new Date().toISOString().slice(0, 10);
    $("prov-tab").innerHTML = `<table><thead><tr><th>Data com</th><th>Pagamento</th><th>Valor</th><th>% da cotação</th></tr></thead><tbody>${B3PROV.slice(0, 14).map(([dc, dp, v]) => {
      const i = DET.precos.d.findIndex(x => x >= dc), p = i >= 0 ? DET.precos.c[i] : A.preco;
      return `<tr${dp && dp >= hoje ? ' class="futuro"' : ""}><td>${dataBR(dc)}</td><td>${dp ? dataBR(dp) : "a definir"}</td><td>R$ ${f4.format(v)}</td><td>${pct(v / p, 2)}</td></tr>`; }).join("")}</tbody></table>`;
    return;
  }
  const ult = DET.proventos.slice(0, 12);
  const ref = d => { const i = DET.precos.d.findIndex(x => x >= d); return i >= 0 ? DET.precos.c[i] : null; };
  $("prov-tab").innerHTML = `<table><thead><tr><th>Data com</th><th>Valor</th><th>% da cotação</th></tr></thead><tbody>${ult.map(([d, v]) => {
    const p = ref(d); return `<tr><td>${dataBR(d)}</td><td>${CLASSE === "stocks" ? "US$ " : "R$ "}${f4.format(v)}</td><td>${p ? pct(v / p, 2) : "–"}</td></tr>`; }).join("")}</tbody></table>`;
}

function desenharPVP() {
  const sec = $("p-pvp");
  const H = DET.pvp_hist || [];
  if (CLASSE !== "fiis" || H.length < 3) { sec.hidden = true; return; }
  sec.hidden = false;
  const vals = H.map(x => x[1]);
  const media = vals.reduce((s, v) => s + v, 0) / vals.length;
  $("pvp-stats").innerHTML = `
    <div><span class="label">Atual</span><span class="v">${mult(A.pvp ?? vals[vals.length - 1])}</span></div>
    <div><span class="label">Média do período</span><span class="v">${mult(media)}</span><span class="cmp">desde ${mesBR(H[0][0])}</span></div>
    <div><span class="label">Mínimo</span><span class="v">${mult(Math.min(...vals))}</span><span class="cmp">${mesBR(H[vals.indexOf(Math.min(...vals))][0])}</span></div>
    <div><span class="label">Máximo</span><span class="v">${mult(Math.max(...vals))}</span><span class="cmp">${mesBR(H[vals.indexOf(Math.max(...vals))][0])}</span></div>`;
  const o = base();
  o.scales.x.ticks.callback = function (v) { return mesBR(this.getLabelForValue(v)).replace("/20", "/"); };
  o.scales.y.ticks = { callback: v => mult(v) };
  o.plugins.tooltip.callbacks = { title: it => mesBR(it[0].label), label: it => it.datasetIndex ? "Patrimônio = 1,00" : `P/VP ${mult(it.parsed.y)} · VP ${brl(H[it.dataIndex][2])}` };
  charts.pvp?.destroy();
  charts.pvp = new Chart($("c-pvp"), { type: "line", data: { labels: H.map(x => x[0]), datasets: [
    { data: vals, borderColor: css("--accent"), backgroundColor: css("--accent"), borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0 },
    { data: H.map(() => 1), borderColor: css("--muted"), borderWidth: 1.25, borderDash: [5, 4], pointRadius: 0, pointHoverRadius: 0 },
  ] }, options: o });
}

function configurarAssistente() {
  if (!window.Assistente) return;
  const r = DET?.retorno || {};
  const linhas = [
    `${A.t} — ${A.n} (${NOMES[CLASSE]}${A.seg || A.cat || A.setor || A.grupo ? ", " + (A.seg || A.cat || A.setor || A.grupo) : ""}). Cotação ${moeda(A.preco)}${A.un && A.un !== "R$" && A.un !== "pontos" ? " " + A.un : ""} em ${dataBR(A.data)} (${sinal(A.var, 2)} no dia).`,
    `Variação: no ano ${sinal(A.rytd)}, 12 meses ${sinal(A.r12)}, 5 anos ${sinal(A.r5a)}.${r["1a"]?.t != null && DET?.proventos?.length ? ` Retorno total 12m com proventos ${sinal(r["1a"].t)}.` : ""}`,
    A.dy != null ? `DY 12m ${pct(A.dy)}.` : "",
    A.pvp != null ? `P/VP ${mult(A.pvp)}${A.vp ? ` (VP por cota ${brl(A.vp)})` : ""}.` : "",
    A.pl != null ? `P/L ${mult(A.pl, 1)}; ROE ${pct(A.roe)}; margem líquida ${pct(A.ml)}.` : "",
    A.liq != null ? `Liquidez média diária ${liq(A.liq)}.` : "",
  ].filter(Boolean);
  const nome = ["indices", "commodities", "moedas"].includes(CLASSE) ? A.n : A.t;
  Assistente.configurar({
    contexto: () => linhas.join("\n"),
    sugestoes: () => ({
      fiis: [`Quais as notícias mais recentes sobre ${A.t}?`, `Os rendimentos de ${A.t} são sustentáveis?`, `Quais os principais riscos de ${A.t}?`],
      etfs: [`O que compõe a carteira do ${A.t}?`, `Qual a taxa de administração do ${A.t} e como ela afeta o retorno?`, `Como é tributado o ${A.t}?`],
      bdrs: [`Quais as notícias mais recentes sobre ${A.n}?`, `Como funciona a tributação de dividendos do ${A.t}?`, `O que explica o desempenho de ${A.n} em 12 meses?`],
      stocks: [`Quais as notícias mais recentes sobre ${A.n}?`, `${A.t} está cara frente ao histórico? Quais os riscos?`, `Como investir em ${A.t} a partir do Brasil?`],
      indices: [`O que movimentou o ${nome} recentemente?`, `O que compõe o ${nome}?`, `Como o ${nome} se compara com o Ibovespa em 5 anos?`],
      moedas: [`O que explica a cotação do ${A.n.toLowerCase()} frente ao real?`, `Quais as perspectivas para o ${A.n.toLowerCase()}?`, `Como o ${A.n.toLowerCase()} afeta a economia brasileira?`],
      commodities: [`O que explica o preço do ${nome.toLowerCase()} recentemente?`, `Quais empresas da B3 são mais afetadas pelo ${nome.toLowerCase()}?`, `Quais as perspectivas para o ${nome.toLowerCase()}?`],
    }[CLASSE] || []),
  });
}

main();
