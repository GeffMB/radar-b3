"use strict";
/* Página de uma classe de ativos (FIIs, ETFs, BDRs, Stocks, Índices, Commodities):
   resumo do dia, painéis de destaque e tabela completa — ou cartões agrupados, para índices e commodities. */
const $ = id => document.getElementById(id);
const { esc, pct, sinal, brl, numero, f1, f2, logo, spark } = R;
const CLASSE = (new URLSearchParams(location.search).get("c") || "fiis").toLowerCase();
const nav = document.querySelector(".topbar .nav");
if (nav) nav.dataset.atual = CLASSE;

const usd = x => x == null ? "–" : "US$ " + f2.format(x);
const bigUSD = x => { if (x == null) return "–"; const a = Math.abs(x);
  if (a >= 1e12) return "US$ " + f2.format(x / 1e12) + " tri"; if (a >= 1e9) return "US$ " + f1.format(x / 1e9) + " bi"; return "US$ " + f1.format(x / 1e6) + " mi"; };
const liq = x => x == null ? "–" : x >= 1e6 ? "R$ " + f1.format(x / 1e6) + " mi" : "R$ " + f1.format(x / 1e3) + " mil";
const cor = x => x == null ? "" : x >= 0 ? "pos" : "neg";
const vs = (x, d = 1) => `<span class="${cor(x)}">${sinal(x, d)}</span>`;
const mult = (x, d = 2) => x == null ? "–" : R.nf(d).format(x);
const pill = x => x == null ? "–" : `<span class="pill ${x >= 0 ? "good" : "bad"}">${sinal(x, 2)}</span>`;

// Colunas: k = campo, l = rótulo, f = formato (HTML), dir = ordem inicial ao clicar (-1 maior primeiro)
const C = {
  preco: { k: "preco", l: "Cotação", f: a => brl(a.preco), dir: -1 },
  precoUS: { k: "preco", l: "Cotação", f: a => usd(a.preco), dir: -1 },
  var: { k: "var", l: "Dia", f: a => vs(a.var, 2), dir: -1 },
  r1m: { k: "r1m", l: "1 mês", f: a => vs(a.r1m), dir: -1 },
  rytd: { k: "rytd", l: "No ano", f: a => vs(a.rytd), dir: -1 },
  r12: { k: "r12", l: "12 meses", f: a => vs(a.r12), dir: -1 },
  rt12: { k: "rt12", l: "Retorno 12m", f: a => vs(a.rt12 ?? a.r12), dir: -1, t: "Cotação + proventos reinvestidos" },
  r5a: { k: "r5a", l: "5 anos", f: a => vs(a.r5a), dir: -1 },
  dy: { k: "dy", l: "DY 12m", f: a => a.dy == null ? "–" : pct(a.dy), dir: -1 },
  dymes: { k: "dy_mes", l: "Último rend.", f: a => a.ult_prov ? `${pct(a.dy_mes, 2)}` : "–", dir: -1, t: "Último rendimento ÷ cotação" },
  pvp: { k: "pvp", l: "P/VP", f: a => mult(a.pvp), dir: 1 },
  pl: { k: "pl", l: "P/L", f: a => a.pl == null ? "–" : a.pl < 0 ? `<span class="neg">${mult(a.pl, 1)}</span>` : mult(a.pl, 1), dir: 1 },
  roe: { k: "roe", l: "ROE", f: a => a.roe == null ? "–" : pct(a.roe), dir: -1 },
  ml: { k: "ml", l: "Mg. líq.", f: a => a.ml == null ? "–" : pct(a.ml), dir: -1 },
  mc: { k: "mc", l: "Valor de mercado", f: a => bigUSD(a.mc), dir: -1 },
  liq: { k: "liq", l: "Liquidez diária", f: a => liq(a.liq), dir: -1, t: "Média negociada por dia no último mês" },
  sp: { k: "r12", l: "12 meses", f: a => spark(a.sp), dir: -1, sp: true },
};

const CFG = {
  fiis: {
    titulo: "Fundos Imobiliários", sub: "Fundos que investem em imóveis ou em títulos de crédito imobiliário e distribuem renda todo mês. P/VP calculado com o valor patrimonial informado à CVM.",
    grupo: { k: "seg", l: "Todos os segmentos" }, moeda: "BRL", tmin: 1060,
    cols: [C.preco, C.var, C.dy, C.dymes, C.pvp, C.liq, C.rt12, C.sp],
    ranks: [
      { l: "Maiores Dividend Yield", ic: "rendafixa", k: "dy", dir: -1, f: a => pct(a.dy), filtro: a => a.liq > 500e3 },
      { l: "Menores P/VP", ic: "fiis", k: "pvp", dir: 1, f: a => mult(a.pvp), filtro: a => a.pvp > 0 && a.liq > 500e3 },
      { l: "Maior liquidez", ic: "indices", k: "liq", dir: -1, f: a => liq(a.liq) },
    ],
    medianas: [["dy", "DY 12m", pct], ["pvp", "P/VP", x => mult(x)]],
    nota: "Destaques consideram só fundos com liquidez acima de R$ 500 mil por dia.",
  },
  etfs: {
    titulo: "ETFs", sub: "Fundos de índice negociados na B3: com uma cota você compra uma carteira inteira (Ibovespa, S&P 500, ouro, títulos públicos…).",
    grupo: { k: "cat", l: "Todas as categorias" }, moeda: "BRL", tmin: 1000,
    sub2: a => a.ref,
    cols: [C.preco, C.var, C.rytd, C.r12, C.r5a, C.liq, C.sp],
    ranks: [
      { l: "Maiores altas em 12 meses", ic: "acoes", k: "r12", dir: -1, f: a => sinal(a.r12) },
      { l: "Maiores altas no ano", ic: "indices", k: "rytd", dir: -1, f: a => sinal(a.rytd) },
      { l: "Maior liquidez", ic: "etfs", k: "liq", dir: -1, f: a => liq(a.liq) },
    ],
    medianas: [["r12", "Retorno 12m", x => sinal(x)], ["rytd", "No ano", x => sinal(x)]],
  },
  bdrs: {
    titulo: "BDRs", sub: "Recibos de ações estrangeiras negociados na B3, em reais. A cotação acompanha a ação lá fora e o dólar.",
    grupo: { k: "setor", l: "Todos os setores" }, moeda: "BRL", tmin: 1100,
    cols: [C.preco, C.var, C.r12, C.dy, C.pl, C.pvp, C.liq, C.sp],
    ranks: [
      { l: "Maiores altas em 12 meses", ic: "acoes", k: "r12", dir: -1, f: a => sinal(a.r12) },
      { l: "Maiores Dividend Yield", ic: "rendafixa", k: "dy", dir: -1, f: a => pct(a.dy) },
      { l: "Maior liquidez", ic: "indices", k: "liq", dir: -1, f: a => liq(a.liq) },
    ],
    medianas: [["r12", "Retorno 12m", x => sinal(x)], ["pl", "P/L", x => mult(x, 1)]],
  },
  stocks: {
    titulo: "Stocks", sub: "Ações das maiores empresas listadas nas bolsas dos EUA, cotadas em dólar.",
    grupo: { k: "setor", l: "Todos os setores" }, moeda: "USD", tmin: 1180,
    cols: [C.precoUS, C.var, C.r12, C.dy, C.pl, C.pvp, C.roe, C.ml, C.mc, C.sp],
    ranks: [
      { l: "Maiores empresas", ic: "stocks", k: "mc", dir: -1, f: a => bigUSD(a.mc) },
      { l: "Maiores altas em 12 meses", ic: "acoes", k: "r12", dir: -1, f: a => sinal(a.r12) },
      { l: "Maiores Dividend Yield", ic: "rendafixa", k: "dy", dir: -1, f: a => pct(a.dy) },
    ],
    medianas: [["pl", "P/L", x => mult(x, 1)], ["dy", "DY 12m", pct]],
  },
  indices: { titulo: "Índices", sub: "Principais bolsas do mundo, moedas e juros americanos. Toque num índice para ver o histórico.", cartoes: true },
  moedas: { titulo: "Moedas", sub: "Quanto vale cada moeda em reais. Moedas de valor baixo aparecem em lotes de 100 ou 1.000 para facilitar a leitura.", cartoes: true, conversor: true },
  commodities: { titulo: "Commodities", sub: "Contratos futuros negociados nos EUA, em dólar. Afetam diretamente empresas como Petrobras, Vale e o agronegócio brasileiro.", cartoes: true },
};
const cfg = CFG[CLASSE] || CFG.fiis;

let recalcularConversor = null;
let DADOS = [], ordem = { k: null, dir: -1 }, filtroTxt = "", filtroGrupo = "", todos = false;

async function main() {
  document.title = `${cfg.titulo} · Radar B3`;
  $("titulo").textContent = cfg.titulo;
  $("sub").textContent = cfg.sub;
  const d = await R.carregar(`mercado/${CLASSE}.json`);
  if (!d || !d.itens?.length) { $("conteudo").innerHTML = `<div class="msg">Os dados de ${esc(cfg.titulo.toLowerCase())} ainda não foram coletados. Eles chegam na próxima atualização diária.</div>`; return; }
  DADOS = d.itens;
  const q = new Date(d.atualizado_em);
  $("meta").innerHTML = `${DADOS.length} ${CLASSE === "moedas" ? "moedas" : "ativos"} · atualizado em <b>${q.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</b>`;
  const metaColeta = $("meta").innerHTML;
  const vivo = quando => { $("meta").innerHTML = `${DADOS.length} ${CLASSE === "moedas" ? "moedas" : "ativos"} · ${R.rotuloVivo(quando)}`; };
  if (cfg.cartoes) {
    desenharCartoes(); configurarAssistente();
    R.aoVivo(DADOS.map(a => [a, R.simbolo(CLASSE, a)]), q => { vivo(q); desenharCartoes(); });
    return;
  }
  desenharResumo();
  desenharRanks();
  montarTabela();
  configurarAssistente();
  R.aoVivo(DADOS.map(a => [a, R.simbolo(CLASSE, a)]), q => { vivo(q); desenharResumo(); desenharRanks(); desenharTabela(); });
}

function link(a) { return `ativo.html?c=${CLASSE}&t=${encodeURIComponent(a.t)}`; }
function preco(a) { return CLASSE === "stocks" ? usd(a.preco) : brl(a.preco); }

function desenharResumo() {
  const com = DADOS.filter(a => a.var != null);
  const sobe = com.filter(a => a.var > 0).length, cai = com.filter(a => a.var < 0).length, est = com.length - sobe - cai;
  const max = [...com].sort((a, b) => b.var - a.var)[0], min = [...com].sort((a, b) => a.var - b.var)[0];
  const med = k => { const s = DADOS.map(a => a[k]).filter(v => v != null && isFinite(v)).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
  const tileAt = (rot, a) => `<a class="tile" href="${link(a)}"><span class="label">${rot}</span>
      <div class="linha">${logo(a, 40)}<div><span class="tk">${esc(a.t)}</span><span class="nm">${esc(a.n)}</span></div></div>
      <span class="big ${cor(a.var)}">${sinal(a.var, 2)}</span></a>`;
  $("resumo").innerHTML = `
    <div class="tile"><span class="label">Altas e quedas no dia</span>
      <span class="big"><span class="pos">${sobe}</span> <small class="note">sobem</small> · <span class="neg">${cai}</span> <small class="note">caem</small></span>
      <div class="split" aria-hidden="true"><i style="width:${sobe / com.length * 100}%;background:var(--good)"></i><i style="width:${est / com.length * 100}%;background:var(--silver)"></i><i style="width:${cai / com.length * 100}%;background:var(--bad)"></i></div>
      <span class="note">${est} estáveis</span></div>
    ${max ? tileAt("Maior alta do dia", max) : ""}
    ${min ? tileAt("Maior queda do dia", min) : ""}
    <div class="tile"><span class="label">Medianas da classe</span>
      <div class="legenda" style="font-size:15px;color:var(--ink)">${cfg.medianas.map(([k, l, f]) => `<span>${l} <b>${f(med(k))}</b></span>`).join("")}</div>
      ${cfg.medianas.some(([k]) => k === "r12") ? "" : `<span class="note">Retorno mediano em 12 meses: <b class="${cor(med("r12"))}">${sinal(med("r12"))}</b></span>`}</div>`;
}

function desenharRanks() {
  const chev = R.icone("seta", "chev");
  $("rk-grid").innerHTML = cfg.ranks.map(r => {
    const lista = DADOS.filter(a => a[r.k] != null && isFinite(a[r.k]) && (!r.filtro || r.filtro(a))).sort((a, b) => (a[r.k] - b[r.k]) * r.dir).slice(0, 5);
    return `<section class="rk"><header>${R.icone(r.ic)}<h3>${r.l}</h3></header><ol>${lista.map((a, i) => `
      <li><a href="${link(a)}"><span class="pos-n p${i + 1}">#${i + 1}</span>${logo(a, 36)}
        <span class="id"><span class="tk">${esc(a.t)}</span><span class="nm">${esc(a.n)}</span></span>
        <span class="val">${r.f(a)}</span>${chev}</a></li>`).join("")}</ol>
      <button class="btn ver" type="button" data-k="${r.k}" data-dir="${r.dir}">Ver ranking completo</button></section>`;
  }).join("");
  if (cfg.nota) $("rk-nota").textContent = cfg.nota;
  $("rk-grid").onclick = e => {
    const b = e.target.closest("button.ver"); if (!b) return;
    ordem = { k: b.dataset.k, dir: +b.dataset.dir };
    todos = true;
    desenharTabela();
    $("tabela").scrollIntoView({ behavior: "smooth", block: "start" });
  };
}

function montarTabela() {
  const grupos = [...new Set(DADOS.map(a => a[cfg.grupo.k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  $("grupo").innerHTML = `<option value="">${cfg.grupo.l}</option>` + grupos.map(g => `<option>${esc(g)}</option>`).join("");
  $("tabela").style.setProperty("--tmin", cfg.tmin + "px");
  const th = (c, i) => `<th scope="col"${c.t ? ` title="${esc(c.t)}"` : ""}><button type="button" data-i="${i}">${c.l}<span class="arr"></span></button></th>`;
  $("thead").innerHTML = `<th scope="col"><button type="button" data-i="-1">Ativo<span class="arr"></span></button></th>` + cfg.cols.map(th).join("");
  $("thead").onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    const i = +b.dataset.i, k = i < 0 ? "t" : cfg.cols[i].k;
    ordem = ordem.k === k ? { k, dir: -ordem.dir } : { k, dir: i < 0 ? 1 : cfg.cols[i].dir };
    desenharTabela();
  };
  $("busca").oninput = e => { filtroTxt = e.target.value.trim().toUpperCase(); desenharTabela(); };
  $("grupo").onchange = e => { filtroGrupo = e.target.value; desenharTabela(); };
  $("mais").onclick = () => { todos = true; desenharTabela(); };
  $("tbody").onclick = e => { if (e.target.closest("a")) return; const tr = e.target.closest("tr[data-t]"); if (tr) location.href = link({ t: tr.dataset.t }); };
  ordem = { k: cfg.ranks[0].k === "mc" ? "mc" : "liq" in DADOS[0] ? "liq" : "r12", dir: -1 };
  desenharTabela();
}

function desenharTabela() {
  let L = DADOS.filter(a => (!filtroGrupo || a[cfg.grupo.k] === filtroGrupo) &&
    (!filtroTxt || a.t.includes(filtroTxt) || String(a.n).toUpperCase().includes(filtroTxt)));
  const { k, dir } = ordem;
  L.sort((a, b) => {
    const x = a[k], y = b[k];
    if (k === "t") return a.t.localeCompare(b.t) * dir;
    if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
    return (x - y) * dir;
  });
  document.querySelectorAll("#thead th").forEach((th, i) => {
    const kk = i === 0 ? "t" : cfg.cols[i - 1].k, on = kk === k && !(i > 0 && cfg.cols[i - 1].sp && cfg.cols.some(c => c.k === k && !c.sp));
    th.toggleAttribute("aria-sort", false); th.querySelector(".arr").textContent = "";
    if (on) { th.setAttribute("aria-sort", dir > 0 ? "ascending" : "descending"); th.querySelector(".arr").textContent = dir > 0 ? "▲" : "▼"; }
  });
  const total = L.length;
  if (!todos && !filtroTxt && !filtroGrupo) L = L.slice(0, 30);
  $("mais").hidden = L.length >= total;
  $("mais").textContent = `Mostrar todos os ${total}`;
  $("tbody").innerHTML = L.map(a => `<tr data-t="${esc(a.t)}"><td><div class="at">${logo(a, 34)}<div><a class="tk" href="${link(a)}">${esc(a.t)}</a><span class="nm">${esc(cfg.sub2 ? cfg.sub2(a) : a.n)}</span></div>${a[cfg.grupo.k] ? `<span class="badge">${esc(a[cfg.grupo.k])}</span>` : ""}</div></td>${cfg.cols.map(c => `<td>${c.f(a)}</td>`).join("")}</tr>`).join("");
  $("vazio").hidden = L.length > 0;
  $("nsel").textContent = total;
}

function desenharCartoes() {
  $("resumo").hidden = true; $("destaques").hidden = true; $("tabela").hidden = true;
  const grupos = [...new Set(DADOS.map(a => a.grupo))];
  const valor = a => a.mult ? "R$ " + R.nf(a.preco < 1 ? 4 : 2).format(a.preco) : a.un === "R$" ? brl(a.preco) : a.un === "%" ? R.nf(2).format(a.preco) + "%" : numero(a.preco);
  const unidade = a => a.unid ? esc(a.unid) : a.un === "pontos" ? "pontos" : esc(a.un);
  if (cfg.conversor && !$("conv")) desenharConversor();
  else recalcularConversor?.();
  $("cartoes").innerHTML = grupos.map(g => `<section class="grupo"><h2>${esc(g)}</h2><div class="cartoes">${DADOS.filter(a => a.grupo === g).map(a => `
    <a class="cartao" href="${link(a)}">
      <div class="topo"><div><div class="nome">${esc(a.n)}</div><div class="un">${unidade(a)}${a.aprox ? " · histórico pelo ETF " + esc(a.aprox) : a.desde ? " · histórico desde " + a.desde.split("-").reverse().join("/") : ""}</div></div>${pill(a.var)}</div>
      <div class="valor">${valor(a)}</div>${a.brl ? `<div class="un">≈ ${brl(a.brl)} ${esc((a.un_brl || "").replace("R$", ""))}</div>` : ""}
      <div class="rodape"><span>No ano <b class="${cor(a.rytd)}">${sinal(a.rytd)}</b><br>12 meses <b class="${cor(a.r12)}">${sinal(a.r12)}</b></span>${spark(a.sp, 110, 36)}</div>
    </a>`).join("")}</div></section>`).join("");
}

// conversor: valor numa moeda → reais (ou o contrário), pela cotação do último fechamento
function desenharConversor() {
  const el = $("conversor"); el.hidden = false;
  el.innerHTML = `<div class="ph"><h2>Conversor</h2><span class="note">Pela cotação de fechamento; casas de câmbio e cartões cobram spread e IOF</span></div>
    <form class="conv" id="conv" autocomplete="off">
      <label class="f"><span>Valor</span><input id="cv-v" inputmode="decimal" value="100"></label>
      <label class="f"><span>De</span><select id="cv-de">${DADOS.map(a => `<option value="${esc(a.t)}">${esc(a.t)} · ${esc(a.n)}</option>`).join("")}<option value="BRL">BRL · Real</option></select></label>
      <button class="btn" type="button" id="cv-troca" aria-label="Inverter moedas">⇄</button>
      <label class="f"><span>Para</span><select id="cv-para"><option value="BRL">BRL · Real</option>${DADOS.map(a => `<option value="${esc(a.t)}">${esc(a.t)} · ${esc(a.n)}</option>`).join("")}</select></label>
      <output class="cv-res" id="cv-res" for="cv-v cv-de cv-para"></output>
    </form>`;
  const porUnidade = c => c === "BRL" ? 1 : (DADOS.find(a => a.t === c)?.preco || 0) / (DADOS.find(a => a.t === c)?.mult || 1);
  const calc = () => {
    const t = $("cv-v").value.trim(); const v = parseFloat(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t) || 0;
    const de = $("cv-de").value, para = $("cv-para").value;
    const r = v * porUnidade(de) / (porUnidade(para) || 1);
    const f = x => R.nf(Math.abs(x) >= 1 ? 2 : 4).format(x);
    $("cv-res").innerHTML = `<span>${f(v)} ${esc(de)} =</span><b>${f(r)} ${esc(para)}</b>`;
  };
  recalcularConversor = calc;
  $("conv").addEventListener("input", calc); $("conv").addEventListener("submit", e => e.preventDefault());
  $("cv-troca").onclick = () => { const a = $("cv-de").value; $("cv-de").value = $("cv-para").value; $("cv-para").value = a; calc(); };
  calc();
}

function configurarAssistente() {
  if (!window.Assistente) return;
  const top = [...DADOS].sort((a, b) => (b.r12 ?? -9) - (a.r12 ?? -9)).slice(0, 12);
  Assistente.configurar({
    contexto: () => `Página de ${cfg.titulo} do Radar B3 (${DADOS.length} ativos). Exemplos: ` +
      top.map(a => `${a.t} (${a.n}) cotação ${CLASSE === "stocks" ? usd(a.preco) : a.un && a.un !== "R$" ? numero(a.preco) + " " + a.un : brl(a.preco)}, dia ${sinal(a.var, 2)}, 12m ${sinal(a.r12)}${a.dy != null ? ", DY " + pct(a.dy) : ""}${a.pvp != null ? ", P/VP " + mult(a.pvp) : ""}`).join("; ") + ".",
    sugestoes: () => ({
      fiis: ["Qual a diferença entre FII de papel e de tijolo?", "O que observar além do Dividend Yield num FII?", "Como a queda da Selic afeta os fundos imobiliários?"],
      etfs: ["Vale mais a pena ETF ou ações individuais?", "Qual a diferença entre IVVB11 e investir direto no S&P 500?", "Como funciona o imposto sobre ETFs?"],
      bdrs: ["Como funciona a tributação de dividendos de BDRs?", "BDR ou conta no exterior: prós e contras", "Como o dólar afeta o preço de um BDR?"],
      stocks: ["Quais as notícias que mais movimentam a bolsa americana nesta semana?", "Como investir em ações americanas morando no Brasil?", "O que explica a alta das big techs?"],
      indices: ["Por que o Ibovespa subiu ou caiu hoje?", "O que é o VIX e como interpretar?", "Como o dólar afeta a bolsa brasileira?"],
      moedas: ["O que faz o dólar subir ou cair frente ao real?", "Vale a pena comprar dólar agora ou aos poucos?", "Como o câmbio afeta empresas exportadoras da B3?"],
      commodities: ["Como o petróleo afeta a Petrobras?", "O que explica o preço do minério de ferro?", "Por que o ouro sobe em crises?"],
    }[CLASSE] || []),
  });
}

main();
