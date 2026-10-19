"use strict";
/* Renda fixa: taxas de hoje (Selic, CDI, IPCA, poupança), simulador comparando aplicações com IR e custos,
   histórico da Selic com a projeção do Focus e IPCA em 12 meses frente à meta. */
const $ = id => document.getElementById(id);
const { esc, f1, f2, brl } = R;
const nav = document.querySelector(".topbar .nav");
if (nav) nav.dataset.atual = "rendafixa";
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const p2 = x => x == null || !isFinite(x) ? "–" : f2.format(x) + "%";
const mesBR = s => { const [y, m] = s.split("-"); return `${m}/${y}`; };
const dataBR = s => { const [y, m, d] = s.slice(0, 10).split("-"); return `${d}/${m}/${y}`; };
const num = el => { const t = String(el.value).trim(); const v = parseFloat(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t); return isFinite(v) ? v : 0; };

let RF = null, TD = null, charts = {};

async function main() {
  [RF, TD] = await Promise.all([R.carregar("mercado/rendafixa.json"), R.carregar("mercado/tesouro.json")]);
  if (!RF) { $("conteudo").innerHTML = '<div class="msg">As taxas ainda não foram coletadas. Elas chegam na próxima atualização diária.</div>'; return; }
  R.ligarBusca([]);
  desenharTaxas();
  prepararSimulador();
  desenharSelic();
  desenharIPCA();
  desenharFocus();
  document.addEventListener("radar:tema", () => { desenharSelic(); desenharIPCA(); simular(); });
  configurarAssistente();
}

function juroReal() { return RF.cdi != null && RF.ipca12 != null ? ((1 + RF.cdi / 100) / (1 + RF.ipca12 / 100) - 1) * 100 : null; }

function desenharTaxas() {
  const cop = RF.copom || [];
  const ult = cop[cop.length - 1], ant = cop[cop.length - 2];
  const dif = ult && ant ? ult.meta - ant.meta : null;
  const decisao = dif == null ? "" : dif === 0 ? "manteve" : dif < 0 ? `cortou ${f2.format(-dif)} p.p.` : `subiu ${f2.format(dif)} p.p.`;
  const tile = (rot, v, nota, destaque) => `<div class="tile${destaque ? " destaque" : ""}"><span class="label">${rot}</span><span class="big">${v}</span><span class="note">${nota}</span></div>`;
  $("taxas").innerHTML = [
    tile("Selic (meta)", p2(RF.selic_meta), ult ? `Copom de ${dataBR(ult.d)} ${decisao}` : "", true),
    tile("CDI", p2(RF.cdi), RF.cdi_data ? `Taxa de ${RF.cdi_data}, ao ano` : "Ao ano"),
    tile("IPCA 12 meses", p2(RF.ipca12), RF.ipca_ref ? `Inflação até ${mesBR(RF.ipca_ref)}` : ""),
    tile("Poupança", p2(RF.poupanca), RF.poupanca_tr ? "0,5% ao mês + TR, ao ano" : "0,5% ao mês + TR (TR não incluída)"),
    tile("Juro real", p2(juroReal()), "CDI descontada a inflação de 12 meses"),
  ].join("");
}

// ---------------------------------------------------------------- simulador
const IR = dias => dias <= 180 ? 0.225 : dias <= 360 ? 0.20 : dias <= 720 ? 0.175 : 0.15;
const PRODUTOS = [
  { id: "poup", l: "Poupança", ir: false, cust: 0, nota: "Isenta de IR. Rende 0,5% ao mês + TR com a Selic acima de 8,5%." },
  { id: "tsel", l: "Tesouro Selic", ir: true, cust: 0.002, isentoAte: 10000, nota: "Taxa de custódia da B3 de 0,20% ao ano sobre o que passar de R$ 10 mil. Sem marcação a mercado relevante." },
  { id: "cdb", l: "CDB", ir: true, cust: 0, nota: "Garantido pelo FGC até R$ 250 mil por banco." },
  { id: "lci", l: "LCI / LCA", ir: false, cust: 0, carencia: 9, nota: "Isentas de IR. Carência mínima de 9 meses (LCA) e 12 meses (LCI). FGC até R$ 250 mil." },
  { id: "pre", l: "Tesouro Prefixado", ir: true, cust: 0.002, nota: "Taxa travada na compra. Se vender antes do vencimento, recebe o preço de mercado do dia." },
  { id: "ipca", l: "Tesouro IPCA+", ir: true, cust: 0.002, nota: "Inflação (projeção do Focus) + taxa real. Venda antes do vencimento sujeita a preço de mercado." },
];

function prepararSimulador() {
  const pre = (TD?.titulos || []).find(t => t.tipo === "Prefixado" && !t.juros_semestrais);
  const ipca = (TD?.titulos || []).find(t => t.tipo === "IPCA+" && !t.juros_semestrais);
  const taxaDe = s => { const m = String(s || "").match(/([\d.,]+)%/); return m ? m[1] : ""; };
  $("s-cdi").value = RF.cdi != null ? f2.format(RF.cdi) : "13,65";
  if (pre) { $("s-pre").value = taxaDe(pre.taxa); $("s-pre-ref").textContent = pre.nome; }
  if (ipca) { $("s-ipca").value = taxaDe(ipca.taxa); $("s-ipca-ref").textContent = ipca.nome; }
  $("sim").addEventListener("submit", e => e.preventDefault());
  $("sim").addEventListener("input", simular);
  $("sim").addEventListener("change", simular);
  $("s-prazos").onclick = e => { const b = e.target.closest("button"); if (!b) return; $("s-meses").value = b.dataset.m; simular(); };
  $("s-cen").onclick = e => { const b = e.target.closest("button"); if (!b) return; $("s-cen").dataset.v = b.dataset.v; simular(); };
  simular();
}

// trajetória anual da Selic e do IPCA: constante ou pela mediana do Focus para o fim de cada ano
function caminho(meses, cenario, cdiFixo) {
  const hoje = new Date(), F = RF.focus || {};
  const anoAtual = hoje.getFullYear();
  const out = [];
  for (let m = 0; m < meses; m++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() + m, 15);
    let cdi = cdiFixo, ipca = RF.ipca12 ?? 4;
    if (cenario === "focus" && F.selic) {
      // interpolação linear entre a Selic de hoje e a mediana de dezembro de cada ano
      const pts = [[0, RF.selic_meta ?? cdiFixo]];
      Object.keys(F.selic).sort().forEach(a => { const k = (+a - anoAtual) * 12 + (11 - hoje.getMonth()); if (k >= 0) pts.push([k, F.selic[a]]); });
      let s = pts[pts.length - 1][1];
      for (let i = 1; i < pts.length; i++) if (m <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; s = y0 + (y1 - y0) * (m - x0) / ((x1 - x0) || 1); break; }
      cdi = s - ((RF.selic_meta ?? s) - (RF.cdi ?? s));        // mantém a diferença atual entre CDI e Selic
    }
    if (F.ipca && F.ipca[String(d.getFullYear())] != null) ipca = F.ipca[String(d.getFullYear())];
    out.push({ cdi: cdi / 100, ipca: ipca / 100, selic: (cenario === "focus" ? cdi + 0.1 : RF.selic_meta ?? cdiFixo) / 100 });
  }
  return out;
}

function taxaMensal(p, c, opt) {
  const diaria = Math.pow(1 + c.cdi, 1 / 252) - 1;
  switch (p.id) {
    case "poup": { const tr = RF.tr_mes?.length ? RF.tr_mes[RF.tr_mes.length - 1][1] / 100 : 0;
      return (c.selic > 0.085 ? 0.005 : Math.pow(1 + c.selic * 0.7, 1 / 12) - 1) + tr; }
    case "tsel": return Math.pow(1 + diaria, 21) - 1;
    case "cdb": return Math.pow(1 + diaria * opt.cdb, 21) - 1;
    case "lci": return Math.pow(1 + diaria * opt.lci, 21) - 1;
    case "pre": return Math.pow(1 + opt.pre, 1 / 12) - 1;
    case "ipca": return Math.pow((1 + c.ipca) * (1 + opt.ipca), 1 / 12) - 1;
  }
  return 0;
}

function tir(fluxos) {
  // taxa mensal que zera o valor presente dos fluxos (aportes negativos, resgate positivo)
  let lo = -0.5, hi = 0.5;
  const vp = r => fluxos.reduce((s, f, i) => s + f / Math.pow(1 + r, i), 0);
  for (let k = 0; k < 100; k++) { const mid = (lo + hi) / 2; if (vp(mid) > 0) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

function simular() {
  const ini = num($("s-ini")), ap = num($("s-ap")), meses = Math.max(1, Math.min(600, Math.round(num($("s-meses")))));
  const cen = $("s-cen").dataset.v || "fixo";
  document.querySelectorAll("#s-cen button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === cen)));
  document.querySelectorAll("#s-prazos button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.m === meses)));
  const opt = { cdb: num($("s-cdb")) / 100, lci: num($("s-lci")) / 100, pre: num($("s-pre")) / 100, ipca: num($("s-ipca")) / 100 };
  const path = caminho(meses, cen, num($("s-cdi")));
  const investido = ini + ap * (meses - 1);
  if (investido <= 0) { $("s-res").innerHTML = '<p class="note">Informe um valor inicial ou um aporte mensal.</p>'; return; }
  const res = PRODUTOS.map(p => {
    // cada aporte é um lote com o próprio prazo (o IR regressivo depende de quanto tempo ficou aplicado)
    const lotes = [];
    let custo = 0;
    for (let m = 0; m < meses; m++) {
      const v = m === 0 ? ini : ap;
      if (v > 0) lotes.push({ m, aplicado: v, saldo: v });
      const tm = taxaMensal(p, path[m], opt);
      lotes.forEach(l => { l.saldo *= 1 + tm; });
      if (p.cust) {
        const total = lotes.reduce((s, l) => s + l.saldo, 0);
        const base = Math.max(0, total - (p.isentoAte || 0));
        const c = base * p.cust / 12;
        if (total > 0) lotes.forEach(l => { l.saldo -= c * l.saldo / total; });
        custo += c;
      }
    }
    const bruto = lotes.reduce((s, l) => s + l.saldo, 0);
    const ir = p.ir ? lotes.reduce((s, l) => s + Math.max(0, l.saldo - l.aplicado) * IR((meses - l.m) * 30.4), 0) : 0;
    const liq = bruto - ir;
    const fl = Array.from({ length: meses + 1 }, (_, i) => i === 0 ? -ini : i < meses ? -ap : liq);
    const r = tir(fl);
    return { p, bruto, ir, custo, liq, ganho: liq - investido, aa: (Math.pow(1 + r, 12) - 1) * 100, aviso: p.carencia && meses < p.carencia };
  }).sort((a, b) => b.liq - a.liq);
  const melhor = res[0].liq;
  $("s-res").innerHTML = `
    <div class="s-resumo">Investindo <b>${brl(investido)}</b> por <b>${meses} ${meses === 1 ? "mês" : "meses"}</b>${cen === "focus" ? " com a Selic seguindo o Focus" : ` com CDI de ${p2(num($("s-cdi")))} o período todo`}:</div>
    <div class="tablebox"><table class="s-tab"><thead><tr><th>Aplicação</th><th>Valor líquido</th><th>Ganho líquido</th><th>Rentab. líquida a.a.</th><th>IR</th><th>Custódia</th></tr></thead><tbody>
    ${res.map((x, i) => `<tr${i === 0 ? ' class="top"' : ""}><td><b>${x.p.l}</b>${x.p.id === "cdb" ? ` <span class="note">${f1.format(opt.cdb * 100)}% do CDI</span>` : x.p.id === "lci" ? ` <span class="note">${f1.format(opt.lci * 100)}% do CDI</span>` : x.p.id === "pre" ? ` <span class="note">${p2(opt.pre * 100)} a.a.</span>` : x.p.id === "ipca" ? ` <span class="note">IPCA + ${p2(opt.ipca * 100)}</span>` : ""}
      ${x.aviso ? `<span class="tag bad">prazo abaixo da carência</span>` : ""}
      <div class="barra"><i style="width:${Math.max(4, x.ganho / Math.max(...res.map(y => y.ganho), 1) * 100)}%"></i></div></td>
      <td><b>${brl(x.liq)}</b>${i > 0 ? `<span class="dif">${brl(x.liq - melhor)}</span>` : '<span class="tag good">melhor</span>'}</td>
      <td class="pos">${brl(x.ganho)}</td><td>${p2(x.aa)}</td><td>${x.ir ? brl(x.ir) : "isento"}</td><td>${x.custo ? brl(x.custo) : "–"}</td></tr>`).join("")}
    </tbody></table></div>
    <ul class="s-notas">${PRODUTOS.map(p => `<li><b>${p.l}:</b> ${p.nota}</li>`).join("")}<li>IR regressivo: 22,5% até 180 dias, 20% até 360, 17,5% até 720 e 15% acima disso, sobre o ganho de cada aporte. IOF só existe em resgates com menos de 30 dias e não foi considerado.</li></ul>`;
}

// ---------------------------------------------------------------- gráficos
function base() {
  Chart.defaults.font.family = css("--font-num") || "monospace";
  Chart.defaults.font.size = 11;
  Chart.defaults.color = css("--muted");
  return {
    responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false },
    plugins: { legend: { display: false }, tooltip: { backgroundColor: css("--ink"), titleColor: css("--bg"), bodyColor: css("--bg"), padding: 10, displayColors: false } },
    scales: { x: { grid: { display: false }, border: { color: css("--line") }, ticks: { maxRotation: 0, autoSkipPadding: 18 } }, y: { grid: { color: css("--line") }, border: { display: false } } },
  };
}

function desenharSelic() {
  const cop = RF.copom || [];
  if (!cop.length) { $("p-selic").hidden = true; return; }
  // meta em vigor no fim de cada mês
  const L = [], V = [], P = [];
  const ini = new Date(cop[0].d + "T12:00:00"), hoje = new Date();
  for (let d = new Date(ini.getFullYear(), ini.getMonth(), 28); d <= hoje; d.setMonth(d.getMonth() + 1)) {
    const k = d.toISOString().slice(0, 7);
    const vig = [...cop].reverse().find(c => c.d <= d.toISOString().slice(0, 10));
    if (vig) { L.push(k); V.push(vig.meta); P.push(null); }
  }
  const F = RF.focus?.selic || {};
  const anos = Object.keys(F).sort();
  if (anos.length) {
    P[P.length - 1] = V[V.length - 1];
    let ult = new Date(hoje.getFullYear(), hoje.getMonth(), 28), atual = V[V.length - 1], mesesAte;
    for (const a of anos) {
      const alvo = new Date(+a, 11, 28);
      if (alvo <= ult) continue;
      mesesAte = (alvo.getFullYear() - ult.getFullYear()) * 12 + alvo.getMonth() - ult.getMonth();
      for (let i = 1; i <= mesesAte; i++) {
        const d = new Date(ult.getFullYear(), ult.getMonth() + i, 28);
        L.push(d.toISOString().slice(0, 7)); V.push(null); P.push(atual + (F[a] - atual) * i / mesesAte);
      }
      ult = alvo; atual = F[a];
    }
  }
  const o = base();
  o.scales.x.ticks.callback = function (v) { const s = this.getLabelForValue(v); return s.endsWith("-01") ? s.slice(0, 4) : ""; };
  o.scales.x.ticks.autoSkip = false;
  o.scales.y.ticks = { callback: v => f1.format(v) + "%" };
  o.plugins.legend = { display: true, position: "bottom", labels: { boxWidth: 14, boxHeight: 2 } };
  o.plugins.tooltip.callbacks = { title: it => mesBR(it[0].label), label: it => it.parsed.y == null ? "" : `${it.dataset.label}: ${f2.format(it.parsed.y)}%` };
  charts.selic?.destroy();
  charts.selic = new Chart($("c-selic"), { type: "line", data: { labels: L, datasets: [
    { label: "Selic (meta)", data: V, borderColor: css("--accent"), backgroundColor: css("--accent"), borderWidth: 2, pointRadius: 0, stepped: true, spanGaps: false },
    { label: `Projeção do Focus (${RF.focus?.data ? dataBR(RF.focus.data) : ""})`, data: P, borderColor: css("--accent-2"), backgroundColor: css("--accent-2"), borderWidth: 2, borderDash: [5, 4], pointRadius: 0, spanGaps: false },
  ] }, options: o });
}

function desenharIPCA() {
  const H = RF.ipca_12m || [];
  if (!H.length) { $("p-ipca").hidden = true; return; }
  const o = base();
  o.scales.x.ticks.callback = function (v) { const s = this.getLabelForValue(v); return s.endsWith("-01") ? s.slice(0, 4) : ""; };
  o.scales.x.ticks.autoSkip = false;
  o.scales.y.ticks = { callback: v => f1.format(v) + "%" };
  o.plugins.legend = { display: true, position: "bottom", labels: { boxWidth: 14, boxHeight: 2, filter: i => i.datasetIndex < 2 } };
  o.plugins.tooltip.callbacks = { title: it => mesBR(it[0].label), label: it => it.datasetIndex === 0 ? `IPCA 12 meses: ${f2.format(it.parsed.y)}%` : it.datasetIndex === 1 ? "Meta: 3,00% (tolerância de 1,50% a 4,50%)" : "" };
  const good = css("--good");
  charts.ipca?.destroy();
  charts.ipca = new Chart($("c-ipca"), { type: "line", data: { labels: H.map(x => x[0]), datasets: [
    { label: "IPCA em 12 meses", data: H.map(x => x[1]), borderColor: css("--accent"), backgroundColor: css("--accent"), borderWidth: 2, pointRadius: 0, tension: 0 },
    { label: "Meta de inflação (3%)", data: H.map(() => 3), borderColor: good, borderWidth: 1.25, borderDash: [5, 4], pointRadius: 0 },
    { data: H.map(() => 4.5), borderColor: "transparent", backgroundColor: good + "1A", pointRadius: 0, fill: "+1" },
    { data: H.map(() => 1.5), borderColor: "transparent", pointRadius: 0 },
  ] }, options: o });
}

function desenharFocus() {
  const F = RF.focus;
  if (!F?.selic) { $("p-focus").hidden = true; return; }
  const anos = Object.keys(F.selic).sort();
  $("focus-data").textContent = F.data ? `Mediana das projeções do mercado, boletim de ${dataBR(F.data)}` : "";
  $("focus").innerHTML = `<table class="ftab"><thead><tr><th></th>${anos.map(a => `<th>${a}</th>`).join("")}</tr></thead><tbody>
    <tr><th>Selic no fim do ano</th>${anos.map(a => `<td>${p2(F.selic[a])}</td>`).join("")}</tr>
    <tr><th>IPCA no ano</th>${anos.map(a => `<td>${p2(F.ipca?.[a])}</td>`).join("")}</tr>
    <tr><th>Juro real implícito</th>${anos.map(a => `<td>${F.ipca?.[a] != null ? p2(((1 + F.selic[a] / 100) / (1 + F.ipca[a] / 100) - 1) * 100) : "–"}</td>`).join("")}</tr></tbody></table>`;
}

function configurarAssistente() {
  if (!window.Assistente) return;
  const F = RF.focus || {};
  Assistente.configurar({
    contexto: () => `Renda fixa no Brasil hoje: Selic meta ${p2(RF.selic_meta)}, CDI ${p2(RF.cdi)}, IPCA 12 meses ${p2(RF.ipca12)} (até ${RF.ipca_ref || "–"}), poupança ${p2(RF.poupanca)} ao ano, juro real ${p2(juroReal())}. Focus (${F.data || "–"}): Selic fim de ano ${JSON.stringify(F.selic || {})}, IPCA ${JSON.stringify(F.ipca || {})}.`,
    sugestoes: () => ["CDB, LCI ou Tesouro Selic: qual compensa mais hoje?", "Quando vale a pena travar uma taxa prefixada?", "O que o mercado espera para a Selic nos próximos anos?"],
  });
}

main();
