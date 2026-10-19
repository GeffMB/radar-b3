"use strict";
/* Página inicial do Radar B3: resumo do dia, painéis de ranking e tabela completa. */
const { esc, pct, sinal, brl, big, logo, spark, f1, f2 } = window.R;
const $ = id => document.getElementById(id);

const PAYLOAD = (() => { try { return JSON.parse($("dados").textContent); } catch (e) { return null; } })();
const DATA = (PAYLOAD && PAYLOAD.acoes) || [];
const median = a => { const s = a.filter(v => v != null && isFinite(v)).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const temAlerta = (o, k) => (o.alertas || []).some(a => !k || a.k === k);
const CHEV = '<svg class="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>';

/* ---------- cabeçalho e rodapé ---------- */
let quando = "–";
(function cabecalho() {
  if (!PAYLOAD) { $("meta").textContent = "Sem dados ainda. Rode a coleta para gerar a página."; return; }
  const d = new Date(PAYLOAD.atualizado_em);
  quando = isNaN(d) ? PAYLOAD.atualizado_em : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  $("meta").innerHTML = `${DATA.length} ações · indicadores dos últimos 12 meses · atualizado em <b>${esc(quando)}</b>`;
  const f = PAYLOAD.falhas || [];
  if (f.length) { const el = $("falhas"); el.hidden = false; el.textContent = "Sem dados hoje: " + f.map(x => x.t).join(", ") + "."; }
  R.ligarBusca(DATA);
})();

/* ---------- resumo do dia ---------- */
(function resumo() {
  if (!DATA.length) return;
  const comVar = DATA.filter(o => o.var != null);
  const altas = comVar.filter(o => o.var > 0.0005).length, quedas = comVar.filter(o => o.var < -0.0005).length, est = comVar.length - altas - quedas;
  const top = [...comVar].sort((a, b) => b.var - a.var);
  const maior = top[0], menor = top[top.length - 1];
  const tot = comVar.length || 1;
  const linhaAtivo = (o, cls) => `<a class="tile rise" href="acao.html?t=${encodeURIComponent(o.t)}">
      <span class="label">${cls === "pos" ? "Maior alta do dia" : "Maior queda do dia"}</span>
      <div class="linha">${logo(o, 40)}<div><span class="tk">${esc(o.t)}</span><span class="nm">${esc(o.n)}</span></div></div>
      <span class="big ${cls}">${sinal(o.var, 2)}</span></a>`;
  $("resumo").innerHTML = `
    <div class="tile rise">
      <span class="label">Altas e quedas no dia</span>
      <span class="big">${altas} <span class="pos" style="font-size:15px">sobem</span> · ${quedas} <span class="neg" style="font-size:15px">caem</span></span>
      <div class="split" role="img" aria-label="${altas} em alta, ${quedas} em queda, ${est} estáveis"><i style="width:${altas / tot * 100}%;background:var(--good)"></i><i style="width:${est / tot * 100}%;background:var(--silver)"></i><i style="width:${quedas / tot * 100}%;background:var(--bad)"></i></div>
      <span class="note">${est} estáveis</span>
    </div>
    ${maior ? linhaAtivo(maior, "pos") : ""}
    ${menor ? linhaAtivo(menor, "neg") : ""}
    <div class="tile rise">
      <span class="label">Medianas do radar</span>
      <div class="legenda" style="font-size:14px;color:var(--ink)">
        <span>DY <b>${pct(median(DATA.map(o => o.dy)))}</b></span>
        <span>P/L <b>${f1.format(median(DATA.filter(o => o.pl > 0).map(o => o.pl)) || 0)}</b></span>
        <span>P/VP <b>${f2.format(median(DATA.filter(o => o.pvp > 0).map(o => o.pvp)) || 0)}</b></span>
        <span>ROE <b>${pct(median(DATA.map(o => o.roe)))}</b></span>
      </div>
      <span class="note">Retorno mediano em 12 meses: <b class="${(median(DATA.map(o => o.rt12)) || 0) >= 0 ? "pos" : "neg"}">${sinal(median(DATA.map(o => o.rt12)))}</b></span>
    </div>`;
})();

/* ---------- painéis de ranking ---------- */
const ICONES = {
  dy: '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"/><path d="M14.5 9.2c-.4-.9-1.4-1.4-2.5-1.4-1.5 0-2.6.8-2.6 2s1.1 1.7 2.6 2c1.5.3 2.6.9 2.6 2.1s-1.1 2-2.6 2c-1.2 0-2.2-.6-2.6-1.5M12 6.3v1.5M12 16.2v1.5"/>',
  mc: '<path d="M4 20h16"/><path d="M6 20V11M10 20V7M14 20v-6M18 20V4"/>',
  receita: '<path d="M4 20h16"/><path d="M5 16l4-4 3 3 6-7"/><path d="M14 8h4v4"/>',
  pl: '<path d="M7 17L17 7"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
  roe: '<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4l-5.2 2.7 1-5.8L3.5 9.2l5.9-.9z"/>',
  rt12: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
};
const PAINEIS = [
  { id: "dy", t: "Maiores Dividend Yield", k: "dy", dir: -1, fmt: v => pct(v, 2), so: o => o.dy > 0 },
  { id: "mc", t: "Maiores valor de mercado", k: "mc", dir: -1, fmt: big, empresa: true },
  { id: "receita", t: "Maiores receitas", k: "receita12m", dir: -1, fmt: big, so: o => o.receita12m > 0, empresa: true },
  { id: "pl", t: "Menores P/L", k: "pl", dir: 1, fmt: v => f1.format(v), so: o => o.pl > 0 },
  { id: "roe", t: "Maiores ROE", k: "roe", dir: -1, fmt: v => pct(v), so: o => o.roe != null },
  { id: "rt12", t: "Maiores retornos em 12 meses", k: "rt12", dir: -1, fmt: v => sinal(v), so: o => o.rt12 != null },
];
(function paineis() {
  if (!DATA.length) return;
  $("rk-grid").innerHTML = PAINEIS.map((p, i) => {
    let lista = DATA.filter(o => o[p.k] != null && (!p.so || p.so(o))).sort((a, b) => p.dir * (a[p.k] - b[p.k]));
    // valor de mercado e receita são da empresa: PETR3 e PETR4 contam uma vez só
    if (p.empresa) { const vistos = new Set(); lista = lista.filter(o => { const e = o.t.slice(0, 4); if (vistos.has(e)) return false; vistos.add(e); return true; }); }
    lista = lista.slice(0, 5);
    return `<article class="rk rise" style="animation-delay:${i * 50}ms">
      <header><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[p.id]}</svg><h3>${p.t}</h3></header>
      <ol>${lista.map((o, j) => `<li><a href="acao.html?t=${encodeURIComponent(o.t)}">
          <span class="pos-n p${j + 1}">#${j + 1}</span>${logo(o, 38)}
          <span class="id"><span class="tk">${esc(o.t)}</span><span class="nm">${esc(o.n)}</span></span>
          <span class="val">${temAlerta(o, p.k) ? `<span class="al" title="${esc(o.alertas.filter(a => a.k === p.k).map(a => a.m).join("\n"))}" aria-label="Dado para conferir">!</span>` : ""}${p.fmt(o[p.k])}</span>${CHEV}</a></li>`).join("")}</ol>
      <button type="button" class="btn ver" data-rank="${p.id}">Ver ranking completo</button>
    </article>`;
  }).join("");
  $("rk-grid").querySelectorAll("button[data-rank]").forEach(b => b.onclick = () => {
    const r = RANKS.find(x => x.id === b.dataset.rank);
    state.rank = r.id; state.sort = r.sort[0]; state.dir = r.sort[1]; state.todas = false; render();
    $("tabela").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });
})();

/* ---------- tabela ---------- */
const COLS = [
  { k: "t", l: "Ativo", dir: 1 },
  { k: "preco", l: "Cotação", dir: -1 },
  { k: "var", l: "Dia", dir: -1 },
  { k: "sp", l: "12 meses", dir: -1 },
  { k: "pl", l: "P/L", dir: 1 },
  { k: "pvp", l: "P/VP", dir: 1 },
  { k: "dy", l: "DY 12m", dir: -1 },
  { k: "roe", l: "ROE", dir: -1 },
  { k: "ml", l: "Mg. líquida", dir: -1 },
  { k: "dle", l: "Dív. líq./EBITDA", dir: 1 },
  { k: "rt12", l: "Retorno 12m", dir: -1 },
  { k: "receita12m", l: "Receita 12m", dir: -1 },
  { k: "mc", l: "Valor de mercado", dir: -1 },
];
const RANKS = [
  { id: "dy", l: "Maiores DY", sort: ["dy", -1] },
  { id: "pl", l: "Menores P/L", sort: ["pl", 1], only: o => o.pl > 0 },
  { id: "pvp", l: "Menores P/VP", sort: ["pvp", 1], only: o => o.pvp > 0 },
  { id: "roe", l: "Maiores ROE", sort: ["roe", -1] },
  { id: "ml", l: "Maiores margens", sort: ["ml", -1] },
  { id: "dle", l: "Menos endividadas", sort: ["dle", 1], only: o => o.dle != null },
  { id: "rt12", l: "Maiores retornos 12m", sort: ["rt12", -1], only: o => o.rt12 != null },
  { id: "receita", l: "Maiores receitas", sort: ["receita12m", -1], only: o => o.receita12m > 0 },
  { id: "mc", l: "Maior valor de mercado", sort: ["mc", -1] },
];
const LIMITE = 40;   // linhas iniciais; "Mostrar todas" exibe o resto

let state = { q: "", setor: "", rank: null, sort: "mc", dir: -1, f: {}, lucro: false, semfin: false, semalerta: false, soalerta: false, open: null, todas: false };
try { const s = JSON.parse(localStorage.getItem("radar-b3") || "null"); if (s) state = { ...state, ...s, open: null, todas: false }; } catch (e) { }
const save = () => { try { localStorage.setItem("radar-b3", JSON.stringify({ ...state, open: null, todas: false })); } catch (e) { } };

[...new Set(DATA.map(d => d.setor))].sort((a, b) => a.localeCompare(b, "pt-BR")).forEach(s => {
  const o = document.createElement("option"); o.value = s; o.textContent = s; $("setor").append(o);
});
RANKS.forEach(r => {
  const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.textContent = r.l; b.dataset.id = r.id;
  b.onclick = () => { if (state.rank === r.id) state.rank = null; else { state.rank = r.id; state.sort = r.sort[0]; state.dir = r.sort[1]; } render(); };
  $("rankings").append(b);
});
COLS.forEach(c => {
  const th = document.createElement("th"); th.scope = "col"; th.dataset.k = c.k;
  const b = document.createElement("button"); b.type = "button"; b.innerHTML = `<span>${c.l}</span><span class="arr"></span>`;
  b.onclick = () => { if (state.sort === c.k) state.dir *= -1; else { state.sort = c.k; state.dir = c.dir; } state.rank = null; render(); };
  th.append(b); $("thead").append(th);
});

const FKEYS = { "f-plmax": ["pl", "max", 1], "f-pvpmax": ["pvp", "max", 1], "f-dymin": ["dy", "min", 100], "f-roemin": ["roe", "min", 100], "f-mlmin": ["ml", "min", 100], "f-dlmax": ["dle", "max", 1] };
Object.keys(FKEYS).forEach(id => {
  const el = $(id); if (state.f[id] != null) el.value = state.f[id];
  el.addEventListener("input", () => { const v = el.value.replace(",", "."); state.f[id] = v === "" ? null : +v; render(); });
});
if (Object.values(state.f).some(v => v != null) || state.lucro || state.semfin || state.semalerta) $("avancado").open = true;
$("busca").value = state.q; $("setor").value = state.setor;
$("f-lucro").checked = state.lucro; $("f-semfin").checked = state.semfin; $("f-semalerta").checked = state.semalerta;
$("busca").addEventListener("input", e => { state.q = e.target.value; render(); });
$("setor").addEventListener("change", e => { state.setor = e.target.value; render(); });
$("f-lucro").addEventListener("change", e => { state.lucro = e.target.checked; render(); });
$("f-semfin").addEventListener("change", e => { state.semfin = e.target.checked; render(); });
$("f-semalerta").addEventListener("change", e => { state.semalerta = e.target.checked; if (state.semalerta) state.soalerta = false; render(); });
$("limpar").onclick = () => {
  state = { ...state, f: {}, lucro: false, semfin: false, semalerta: false, soalerta: false, q: "", setor: "", rank: null };
  Object.keys(FKEYS).forEach(id => $(id).value = ""); ["f-lucro", "f-semfin", "f-semalerta"].forEach(id => $(id).checked = false);
  $("busca").value = ""; $("setor").value = ""; render();
};
$("mais").onclick = () => { state.todas = true; render(); };

const norm = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
function filtered() {
  const q = norm(state.q.trim());
  const rk = RANKS.find(r => r.id === state.rank);
  return DATA.filter(o => {
    if (q && !norm(o.t + " " + o.n).includes(q)) return false;
    if (state.setor && o.setor !== state.setor) return false;
    if (state.lucro && !(o.pl > 0)) return false;
    if (state.semfin && o.fin) return false;
    if (state.semalerta && temAlerta(o)) return false;
    if (state.soalerta && !temAlerta(o)) return false;
    if (rk && rk.only && !rk.only(o)) return false;
    for (const [id, [k, mode, mul]] of Object.entries(FKEYS)) {
      const lim = state.f[id]; if (lim == null || isNaN(lim)) continue;
      const v = o[k]; if (v == null) return false;
      if (mode === "max" && (v > lim || (k === "pl" && v <= 0))) return false;
      if (mode === "min" && v * mul < lim) return false;
    }
    return true;
  });
}
const valorOrdem = (o, k) => k === "sp" ? (o.sp && o.sp.length > 1 ? o.sp[o.sp.length - 1] / o.sp[0] - 1 : null) : o[k];
function sorted(arr) {
  const { sort: k, dir } = state;
  return arr.slice().sort((a, b) => {
    if (k === "t") return dir * a.t.localeCompare(b.t);
    let x = valorOrdem(a, k), y = valorOrdem(b, k);
    if (k === "pl") { if (x != null && x <= 0) x = null; if (y != null && y <= 0) y = null; }
    if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
    return dir * (x - y);
  });
}

function cell(k, o) {
  const v = o[k];
  switch (k) {
    case "preco": return brl(v);
    case "var": return v == null ? "–" : `<span class="${v > 0 ? "pos" : v < 0 ? "neg" : "na"}">${sinal(v, 2)}</span>`;
    case "sp": return spark(o.sp);
    case "pl": if (v == null) return '<span class="na">–</span>'; if (v < 0) return `<span class="pill bad" title="Prejuízo nos últimos 12 meses">${f1.format(v)}</span>`;
      return v > 40 ? `<span class="pill warn">${f1.format(v)}</span>` : f1.format(v);
    case "pvp": return v == null ? "–" : f2.format(v);
    case "dy": return v >= 0.06 ? `<span class="pill good">${pct(v)}</span>` : v === 0 ? '<span class="na">0,0%</span>' : pct(v);
    case "roe": case "ml": return v == null ? "–" : v < 0 ? `<span class="pill bad">${pct(v)}</span>` : v >= 0.15 ? `<span class="pill good">${pct(v)}</span>` : pct(v);
    case "dle": if (o.fin) return '<span class="na" title="Não se aplica a bancos e seguradoras">n/a</span>';
      if (v == null) return '<span class="na">–</span>';
      if (v < 0) return `<span class="pill good" title="Caixa maior que a dívida">${f1.format(v)}</span>`;
      return v > 3 ? `<span class="pill bad">${f1.format(v)}x</span>` : v > 2 ? `<span class="pill warn">${f1.format(v)}x</span>` : f1.format(v) + "x";
    case "rt12": return v == null ? '<span class="na">–</span>' : `<span class="${v > 0 ? "pos" : v < 0 ? "neg" : "na"}" title="Só cotação: ${sinal(o.var12)}">${sinal(v)}</span>`;
    case "receita12m": case "mc": return big(v);
  }
  return "";
}

function detail(o) {
  const notes = [];
  if (o.banco) notes.push("Bancos não usam dívida líquida/EBITDA: captar e emprestar dinheiro é o próprio negócio. Para eles, P/VP e ROE costumam ser os indicadores centrais.");
  else if (o.fin) notes.push("Seguradoras e a B3 operam com caixa elevado; compare-as entre si.");
  if (o.pl != null && o.pl < 0) notes.push("P/L negativo: a empresa teve prejuízo nos últimos 12 meses, então o múltiplo não serve para medir se está barata.");
  if (o.dle != null && o.dle < 0) notes.push("Dívida líquida negativa: o caixa supera a dívida total.");
  const al = (o.alertas || []).map(a => `<li>${esc(a.m)}</li>`).join("");
  const t = encodeURIComponent(o.t);
  return `<div class="dgrid">
    ${al ? `<div class="alertas"><b>Dados para conferir</b><ul>${al}</ul></div>` : ""}
    <div><span class="label">Setor</span><span class="v">${esc(o.setor)}</span></div>
    <div><span class="label">LPA (lucro/ação)</span><span class="v">${o.lpa == null ? "–" : brl(o.lpa)}</span></div>
    <div><span class="label">Dívida total</span><span class="v">${big(o.div)}</span></div>
    <div><span class="label">Caixa</span><span class="v">${big(o.cx)}</span></div>
    <div><span class="label">Dívida líquida</span><span class="v">${big(o.dl)}</span></div>
    <div><span class="label">EBITDA 12m</span><span class="v">${big(o.ebitda)}</span></div>
    ${notes.length ? `<p class="dnote">${notes.join(" ")}</p>` : ""}
    <p class="dnote"><a href="acao.html?t=${t}">Abrir a página de ${esc(o.t)} →</a> · <a href="comparar.html?t=${t}">Comparar com outras →</a></p>
  </div>`;
}

function render() {
  const todas = sorted(filtered());
  const rows = state.todas ? todas : todas.slice(0, LIMITE);
  document.querySelectorAll("#rankings .chip").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.id === state.rank)));
  document.querySelectorAll("#thead th").forEach(th => {
    const on = th.dataset.k === state.sort;
    if (on) th.setAttribute("aria-sort", state.dir > 0 ? "ascending" : "descending"); else th.removeAttribute("aria-sort");
    th.querySelector(".arr").textContent = on ? (state.dir > 0 ? "↑" : "↓") : "";
  });
  const tb = $("tbody"); tb.innerHTML = "";
  rows.forEach(o => {
    const tr = document.createElement("tr"); if (state.open === o.t) tr.className = "open";
    const al = o.alertas || [], ks = new Set(al.map(a => a.k));
    const pill = al.length ? ` <span class="conferir" title="${esc(al.map(a => a.m).join("\n"))}">conferir</span>` : "";
    tr.innerHTML = `<td><div class="at">${logo(o, 32)}<div><a class="tk" href="acao.html?t=${encodeURIComponent(o.t)}">${esc(o.t)}</a>${pill}<span class="nm">${esc(o.n)}</span></div></div></td>` +
      COLS.slice(1).map(c => {
        const sus = ks.has(c.k);
        return `<td${sus ? ` class="sus" title="${esc(al.filter(a => a.k === c.k).map(a => a.m).join("\n"))}"` : ""}>${cell(c.k, o)}</td>`;
      }).join("");
    tr.onclick = e => { if (e.target.closest("a")) return; state.open = state.open === o.t ? null : o.t; render(); };
    tb.append(tr);
    if (state.open === o.t) { const d = document.createElement("tr"); d.className = "detail"; d.innerHTML = `<td colspan="${COLS.length}">${detail(o)}</td>`; tb.append(d); }
  });
  $("vazio").hidden = todas.length > 0;
  $("mais").hidden = state.todas || todas.length <= LIMITE;
  $("mais").textContent = `Mostrar todas as ${todas.length}`;
  $("nsel").textContent = todas.length;
  const nAl = DATA.filter(o => temAlerta(o)).length;
  $("alerta-meta").innerHTML = nAl ? `<button type="button" class="btn-alerta" id="ver-alertas" aria-pressed="${state.soalerta}">${state.soalerta ? "Mostrar todas" : `${nAl} com dados para conferir`}</button>` : "";
  if (nAl) $("ver-alertas").onclick = () => { state.soalerta = !state.soalerta; if (state.soalerta) { state.semalerta = false; $("f-semalerta").checked = false; } render(); };
  const M = [
    ["P/L", median(todas.filter(o => o.pl > 0).map(o => o.pl)), v => f1.format(v)],
    ["P/VP", median(todas.map(o => o.pvp)), v => f2.format(v)],
    ["DY 12m", median(todas.map(o => o.dy)), v => pct(v)],
    ["ROE", median(todas.map(o => o.roe)), v => pct(v)],
    ["Mg. líquida", median(todas.map(o => o.ml)), v => pct(v)],
    ["Dív. líq./EBITDA", median(todas.filter(o => !o.fin).map(o => o.dle)), v => f1.format(v) + "x"],
    ["Retorno 12m", median(todas.map(o => o.rt12)), v => sinal(v)],
  ];
  $("medianas").innerHTML = M.map(([k, v, fmt]) => `<div class="med"><span class="label">${k}</span><span class="v">${v == null ? "–" : fmt(v)}</span></div>`).join("");
  save();
}
render();

/* ---------- assistente ---------- */
if (window.Assistente) Assistente.configurar({
  contexto: () => {
    const rows = sorted(filtered());
    const filtros = [state.setor && `setor ${state.setor}`, state.rank && `ranking "${(RANKS.find(r => r.id === state.rank) || {}).l}"`, state.q && `busca "${state.q}"`].filter(Boolean).join(", ");
    const top = rows.slice(0, 12).map(o => `${o.t}: P/L ${o.pl == null ? "–" : f1.format(o.pl)}, P/VP ${o.pvp == null ? "–" : f2.format(o.pvp)}, DY ${pct(o.dy)}, ROE ${pct(o.roe)}, ret.12m ${sinal(o.rt12)}`).join("\n");
    return `Lista do radar com ${rows.length} de ${DATA.length} ações${filtros ? " (filtros: " + filtros + ")" : ""}, atualizada em ${quando}.\nPrimeiras da lista:\n${top}`;
  },
  sugestoes: () => {
    const s = ["Quais notícias movimentaram a bolsa brasileira nesta semana?", "Explique P/L, P/VP e DY e quando cada um pode enganar."];
    if (state.setor) s.unshift(`Como está o setor de ${state.setor} na B3 hoje e quais os principais riscos?`);
    if (state.rank) s.unshift("Analise as primeiras ações deste ranking: o que explica os números e quais cuidados ter?");
    return s;
  },
});
