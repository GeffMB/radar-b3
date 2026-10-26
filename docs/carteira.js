"use strict";
/* Minha carteira: posições salvas só neste navegador (exportar/importar para levar a outro computador),
   renda estimada, yield on cost, preço-teto e número mágico, proventos previstos por mês e simulador "bola de neve". */
const $ = id => document.getElementById(id);
const { esc, pct, sinal, brl, f0, f1, f2, logo } = R;
const nav = document.querySelector(".topbar .nav");
if (nav) nav.dataset.atual = "carteira";
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const CHAVE = "radar-carteira";
const CLASSES = { acoes: "Ação", fiis: "FII", etfs: "ETF", bdrs: "BDR" };
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
// aceita "1.234,56", "1234,56", "1234.56" e "23.830" (ponto como separador de milhar)
const num = v => { const t = String(v ?? "").trim().replace(/\s|R\$/g, ""); const x = parseFloat(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t); return isFinite(x) ? x : NaN; };
const curto = v => { const a = Math.abs(v); return a >= 1e6 ? "R$ " + f1.format(v / 1e6) + " mi" : a >= 1e3 ? "R$ " + f0.format(v / 1e3) + " mil" : "R$ " + f0.format(v); };
const dataBR = s => { const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; };

let ATIVOS = {}, PROV = {}, POS = [], charts = {};

function ler() { try { const v = JSON.parse(localStorage.getItem(CHAVE) || "[]"); return Array.isArray(v) ? v.filter(p => p && R.idOk(p.t) && p.q > 0) : []; } catch (e) { return []; } }
function gravar() { try { localStorage.setItem(CHAVE, JSON.stringify(POS)); } catch (e) { aviso("Não foi possível salvar neste navegador (modo anônimo?). Use Exportar para guardar a carteira."); } }
function aviso(t) { $("aviso").textContent = t; $("aviso").hidden = !t; }

async function main() {
  const [dados, fiis, etfs, bdrs, prov] = await Promise.all([
    R.carregar("dados.json"), R.carregar("mercado/fiis.json"), R.carregar("mercado/etfs.json"), R.carregar("mercado/bdrs.json"), R.carregar("mercado/proventos.json")]);
  (dados?.acoes || []).forEach(a => ATIVOS[a.t] = { ...a, c: "acoes" });
  [["fiis", fiis], ["etfs", etfs], ["bdrs", bdrs]].forEach(([c, d]) => (d?.itens || []).forEach(a => { if (!ATIVOS[a.t]) ATIVOS[a.t] = { ...a, c }; }));
  PROV = prov?.itens || {};
  $("lista-ativos").innerHTML = Object.values(ATIVOS).map(a => `<option value="${esc(a.t)}">${esc(a.n)} · ${CLASSES[a.c]}</option>`).join("");
  R.ligarBusca(dados?.acoes || []);
  POS = ler();
  $("form").addEventListener("submit", adicionar);
  $("exportar").onclick = exportar;
  $("importar").onclick = () => $("arquivo").click();
  $("arquivo").onchange = importar;
  $("exemplo").onclick = () => { POS = [{ t: "BBAS3", q: 200, pm: 21 }, { t: "TAEE11", q: 100, pm: 36 }, { t: "BBSE3", q: 80, pm: 33 }, { t: "CMIG4", q: 300, pm: 10.5 }, { t: "MXRF11", q: 500, pm: 9.8 }, { t: "HGLG11", q: 20, pm: 160 }].filter(p => ATIVOS[p.t]); gravar(); desenhar(); };
  $("limpar").onclick = () => { if (!POS.length) return; POS = []; gravar(); desenhar(); aviso("Carteira apagada deste navegador. Se exportou antes, pode importar de volta."); };
  $("tbody").addEventListener("change", editar);
  $("tbody").addEventListener("click", e => { const b = e.target.closest("button[data-rm]"); if (b) { POS = POS.filter(p => p.t !== b.dataset.rm); gravar(); desenhar(); } });
  $("sim").addEventListener("input", () => { simEditado = true; simular(); });
  $("sim").addEventListener("submit", e => e.preventDefault());
  document.addEventListener("radar:tema", desenhar);
  document.addEventListener("radar:dy-alvo", desenhar);
  desenhar();
  configurarAssistente();
  // cotações ao vivo dos ativos da carteira (a cada minuto, com a aba visível)
  const vivo = async () => {
    if (document.hidden || !POS.length) return;
    const pares = POS.map(p => ATIVOS[p.t]).filter(Boolean).map(a => [a, R.simbolo(a.c, a)]);
    const q = await R.cotacoesAgora(pares.map(([, s]) => s));
    let n = 0;
    for (const [a, s] of pares) if (R.aplicarCotacao(a, q[s])) n++;
    if (n) { desenhar(); $("vivo").innerHTML = R.rotuloVivo(new Date()); }
  };
  vivo(); setInterval(vivo, 60e3);
}

function adicionar(e) {
  e.preventDefault();
  const t = $("f-t").value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const q = num($("f-q").value), pm = num($("f-pm").value);
  if (!ATIVOS[t]) return aviso(`${t || "Ticker"} não está no site. Use ações, FIIs, ETFs ou BDRs da lista.`);
  if (!(q > 0)) return aviso("Informe a quantidade.");
  const pmFinal = pm > 0 ? pm : ATIVOS[t].preco;
  const i = POS.findIndex(p => p.t === t);
  if (i >= 0) {
    // mesma ação de novo: soma a quantidade e recalcula o preço médio
    const p = POS[i], qt = p.q + q;
    POS[i] = { t, q: qt, pm: (p.q * p.pm + q * pmFinal) / qt };
  } else POS.push({ t, q, pm: pmFinal });
  gravar(); aviso(""); $("form").reset(); $("f-t").focus(); desenhar();
}

function editar(e) {
  const el = e.target, t = el.closest("tr")?.dataset.t; if (!t) return;
  const p = POS.find(x => x.t === t); const v = num(el.value);
  if (el.dataset.k === "q" && v > 0) p.q = v;
  if (el.dataset.k === "pm" && v > 0) p.pm = v;
  gravar(); desenhar();
}

function exportar() {
  const blob = new Blob([JSON.stringify({ app: "radar-b3", versao: 1, exportado_em: new Date().toISOString(), posicoes: POS }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `carteira-radar-b3-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function importar(e) {
  const f = e.target.files?.[0]; if (!f) return;
  if (f.size > 200000) return aviso("Arquivo grande demais para ser uma carteira exportada pelo site.");
  f.text().then(txt => {
    const d = JSON.parse(txt);
    const lista = (Array.isArray(d) ? d : d.posicoes || []).map(p => ({ t: String(p.t || "").toUpperCase().replace(/[^A-Z0-9]/g, ""), q: +p.q, pm: +p.pm }))
      .filter(p => R.idOk(p.t) && p.q > 0 && p.q < 1e9 && p.pm > 0 && p.pm < 1e7);
    if (!lista.length) throw new Error("vazio");
    POS = lista; gravar(); desenhar(); aviso(`Carteira importada: ${lista.length} ativos.`);
  }).catch(() => aviso("Não reconheci esse arquivo. Use um arquivo gerado pelo botão Exportar.")).finally(() => { e.target.value = ""; });
}

// ---------------------------------------------------------------- cálculos
function linhas() {
  return POS.map(p => {
    const a = ATIVOS[p.t]; if (!a) return { p, a: null };
    const valor = p.q * a.preco, custo = p.q * p.pm;
    const prov12 = a.prov12 ?? (a.dy != null ? a.dy * a.preco : 0);
    const renda = p.q * (prov12 || 0);
    const bz = a.c === "acoes" ? R.barsi(a) : null;
    const base = a.pm5 || prov12;
    const magico = base > 0 ? Math.ceil(a.preco / base) : null;
    return { p, a, valor, custo, res: valor - custo, renda, yoc: custo ? renda / custo : null, dy: valor ? renda / valor : null, bz, magico };
  });
}

// proventos previstos por mês: pagamentos já anunciados (B3) + repetição dos últimos 12 meses
function previsao() {
  const hoje = new Date(), ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const meses = Array.from({ length: 12 }, (_, i) => ({ d: new Date(ini.getFullYear(), ini.getMonth() + i, 1), conf: 0, est: 0 }));
  const idx = d => { const k = (d.getFullYear() - ini.getFullYear()) * 12 + d.getMonth() - ini.getMonth(); return k >= 0 && k < 12 ? k : -1; };
  const proximos = [];
  const umAno = new Date(hoje); umAno.setFullYear(umAno.getFullYear() - 1);
  for (const p of POS) {
    const a = ATIVOS[p.t]; if (!a) continue;
    const ev = PROV[p.t];
    if (ev?.length) {
      for (const [dc, dp, v, tipo] of ev) {
        const pag = dp ? new Date(dp + "T12:00:00") : null, com = new Date(dc + "T12:00:00");
        if (pag && pag >= new Date(hoje.toDateString())) {
          const k = idx(pag); if (k >= 0) meses[k].conf += v * p.q;
          proximos.push({ t: p.t, dc, dp, v, tipo, total: v * p.q });
        }
        if (com > umAno) {
          // o mesmo provento, um ano depois (pela data de pagamento, ou um mês após a data com)
          const base = pag || new Date(com.getFullYear(), com.getMonth() + 1, 15);
          const k = idx(new Date(base.getFullYear() + 1, base.getMonth(), 15));
          if (k >= 0) meses[k].est += v * p.q;
        }
      }
    } else {
      const prov12 = a.prov12 ?? (a.dy != null ? a.dy * a.preco : 0);
      meses.forEach(m => m.est += prov12 * p.q / 12);
    }
  }
  proximos.sort((x, y) => x.dp < y.dp ? -1 : 1);
  return { meses, proximos };
}

// ---------------------------------------------------------------- telas
function desenhar() {
  const L = linhas().filter(l => l.a);
  const vazio = !L.length;
  $("vazia").hidden = !vazio; $("cheia").hidden = vazio;
  if (vazio) { simular(); return; }
  const tot = L.reduce((s, l) => ({ valor: s.valor + l.valor, custo: s.custo + l.custo, renda: s.renda + l.renda }), { valor: 0, custo: 0, renda: 0 });
  $("resumo").innerHTML = `
    <div class="tile"><span class="label">Patrimônio</span><span class="big">${brl(tot.valor)}</span><span class="note">${L.length} ativos</span></div>
    <div class="tile"><span class="label">Resultado</span><span class="big ${tot.valor >= tot.custo ? "pos" : "neg"}">${brl(tot.valor - tot.custo)}</span><span class="note">${sinal(tot.valor / tot.custo - 1)} sobre ${brl(tot.custo)} investidos</span></div>
    <div class="tile destaque"><span class="label">Renda estimada</span><span class="big">${brl(tot.renda / 12)}<small>/mês</small></span><span class="note">${brl(tot.renda)} por ano, pelos proventos dos últimos 12 meses</span></div>
    <div class="tile"><span class="label">Yield on cost</span><span class="big">${pct(tot.renda / tot.custo)}</span><span class="note">DY da carteira a preços de hoje: ${pct(tot.renda / tot.valor)}</span></div>`;
  const ord = [...L].sort((a, b) => b.renda - a.renda);
  $("tbody").innerHTML = ord.map(l => {
    const { p, a } = l;
    const teto = l.bz?.teto;
    const prog = l.magico ? Math.min(1, p.q / l.magico) : null;
    return `<tr data-t="${esc(p.t)}">
      <td><div class="at">${logo(a, 32)}<div><a class="tk" href="${R.linkAtivo(a.c, a.t)}">${esc(a.t)}</a>${a.best ? '<span class="best">BEST</span>' : ""}<span class="nm">${esc(a.n)} · ${CLASSES[a.c]}</span></div></div></td>
      <td><input class="ed" data-k="q" inputmode="decimal" value="${R.nf(0).format(p.q)}" aria-label="Quantidade de ${esc(a.t)}"></td>
      <td><input class="ed" data-k="pm" inputmode="decimal" value="${f2.format(p.pm)}" aria-label="Preço médio de ${esc(a.t)}"></td>
      <td>${brl(a.preco)}<span class="sub ${a.var >= 0 ? "pos" : "neg"}">${sinal(a.var, 2)}</span></td>
      <td>${brl(l.valor)}<span class="sub ${l.res >= 0 ? "pos" : "neg"}">${sinal(l.valor / l.custo - 1)}</span></td>
      <td><b>${brl(l.renda)}</b><span class="sub">${pct(tot.renda ? l.renda / tot.renda : 0, 0)} da renda</span></td>
      <td>${l.yoc == null ? "–" : pct(l.yoc)}<span class="sub">DY hoje ${pct(l.dy)}</span></td>
      <td>${teto ? `${brl(teto)}<span class="sub ${l.bz.desconto >= 0 ? "pos" : "neg"}">${l.bz.desconto >= 0 ? pct(l.bz.desconto, 0) + " abaixo" : pct(-l.bz.desconto, 0) + " acima"}</span>` : '<span class="na">–</span>'}</td>
      <td>${l.magico ? `<span class="mg"><span>${f0.format(p.q)} de ${f0.format(l.magico)}</span><i style="--p:${prog * 100}%"></i></span>` : '<span class="na">–</span>'}</td>
      <td><button type="button" class="rm" data-rm="${esc(p.t)}" aria-label="Tirar ${esc(a.t)} da carteira">×</button></td></tr>`;
  }).join("");
  const { meses, proximos } = previsao();
  desenharMeses(meses);
  $("proximos").innerHTML = proximos.length ? proximos.slice(0, 12).map(x => `<li><span class="dt">${dataBR(x.dp)}</span><span><b>${esc(x.t)}</b> · ${esc(x.tipo)}<small>Data com ${dataBR(x.dc)} · R$ ${R.nf(4).format(x.v)} por cota/ação</small></span><b class="pos">${brl(x.total)}</b></li>`).join("")
    : '<li class="vz">Nenhum pagamento já anunciado para os seus ativos.</li>';
  desenharSetores(L, tot);
  simular();
}

function base() {
  Chart.defaults.font.family = css("--font-num") || "monospace"; Chart.defaults.font.size = 11; Chart.defaults.color = css("--muted");
  return { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false },
    plugins: { legend: { display: true, position: "bottom", labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: { backgroundColor: css("--ink"), titleColor: css("--bg"), bodyColor: css("--bg"), padding: 10 } },
    scales: { x: { stacked: true, grid: { display: false }, border: { color: css("--line") } }, y: { stacked: true, grid: { color: css("--line") }, border: { display: false }, ticks: { callback: v => "R$ " + f0.format(v) } } } };
}

function desenharMeses(meses) {
  const o = base();
  o.plugins.tooltip.callbacks = { label: it => `${it.dataset.label}: ${brl(it.parsed.y)}`, footer: it => `Total: ${brl(it.reduce((s, x) => s + x.parsed.y, 0))}` };
  charts.meses?.destroy();
  charts.meses = new Chart($("c-meses"), { type: "bar", data: { labels: meses.map(m => `${MESES[m.d.getMonth()]}/${String(m.d.getFullYear()).slice(2)}`), datasets: [
    { label: "Já anunciado (B3)", data: meses.map(m => m.conf), backgroundColor: css("--accent"), borderRadius: 3 },
    { label: "Estimado (repete os últimos 12 meses)", data: meses.map(m => m.est), backgroundColor: css("--accent") + "55", borderRadius: 3 },
  ] }, options: o });
}

function desenharSetores(L, tot) {
  const por = {};
  L.forEach(l => { const k = l.a.c === "acoes" ? l.a.setor : l.a.c === "fiis" ? "FIIs · " + (l.a.seg || "outros") : CLASSES[l.a.c] + "s"; por[k] = (por[k] || 0) + l.renda; });
  const lista = Object.entries(por).sort((a, b) => b[1] - a[1]);
  const best = L.filter(l => l.a.best).reduce((s, l) => s + l.renda, 0);
  $("setores").innerHTML = lista.map(([k, v]) => `<div class="sb"><span>${esc(k)}</span><b>${pct(tot.renda ? v / tot.renda : 0, 0)}</b><i style="--p:${tot.renda ? v / tot.renda * 100 : 0}%"></i></div>`).join("") +
    `<p class="note">${pct(tot.renda ? best / tot.renda : 0, 0)} da renda vem de setores perenes (BEST).</p>`;
}

// ---------------------------------------------------------------- simulador bola de neve
let simEditado = false;   // enquanto o usuário não mexer, o simulador parte da carteira
function simular() {
  const L = linhas().filter(l => l.a);
  const tot = L.reduce((s, l) => ({ valor: s.valor + l.valor, renda: s.renda + l.renda }), { valor: 0, renda: 0 });
  if (!simEditado) {
    $("s-pat").value = f0.format(tot.valor ? Math.round(tot.valor) : 10000);
    $("s-dy").value = f1.format(tot.valor && tot.renda ? Math.min(15, tot.renda / tot.valor * 100) : R.dyAlvo() * 100);
  }
  const P0 = num($("s-pat").value) || 0, ap = num($("s-ap").value) || 0, dy = (num($("s-dy").value) || 0) / 100,
    g = (num($("s-g").value) || 0) / 100, meta = num($("s-meta").value) || 0;
  let P = P0, investido = P0, anos = null;
  const serie = [{ ano: 0, P, renda: P * dy / 12, inv: investido }];
  for (let m = 1; m <= 50 * 12; m++) {
    const prov = P * dy / 12;
    P = (P + ap + prov) * Math.pow(1 + g, 1 / 12);
    investido += ap;
    if (anos == null && meta > 0 && P * dy / 12 >= meta) anos = m / 12;
    if (m % 12 === 0) serie.push({ ano: m / 12, P, renda: P * dy / 12, inv: investido });
  }
  const em = n => serie[Math.min(n, serie.length - 1)];
  $("s-res").innerHTML = `
    <div class="s-big"><span class="label">Renda de ${brl(meta)} por mês</span><b>${anos == null ? "mais de 50 anos" : anos < 1 ? "menos de 1 ano" : `${f1.format(anos)} anos`}</b><span class="note">${anos == null ? "Aumente o aporte ou reduza a meta." : `por volta de ${new Date().getFullYear() + Math.ceil(anos)}, com patrimônio de ${brl(meta * 12 / dy)}`}</span></div>
    <div class="s-tab">${[5, 10, 20, 30].map(n => `<div><span class="label">Em ${n} anos</span><b>${brl(em(n).renda)}<small>/mês</small></b><span class="note">patrimônio ${brl(em(n).P)} · você aportou ${brl(em(n).inv)}</span></div>`).join("")}</div>`;
  const ate = Math.min(50, Math.max(10, Math.ceil((anos || 30) * 1.2)));
  const S = serie.slice(0, ate + 1);
  const o = base();
  o.scales.x.stacked = false; o.scales.y.stacked = false;
  o.scales.y.ticks = { callback: curto };
  o.scales.y2 = { position: "right", grid: { display: false }, border: { display: false }, ticks: { callback: curto } };
  o.plugins.tooltip.callbacks = { title: it => `Ano ${it[0].label}`, label: it => it.datasetIndex === 2 ? `Renda mensal: ${brl(it.parsed.y)}` : `${it.dataset.label}: ${brl(it.parsed.y)}` };
  charts.sim?.destroy();
  charts.sim = new Chart($("c-sim"), { data: { labels: S.map(x => x.ano), datasets: [
    { type: "bar", label: "Você aportou", data: S.map(x => x.inv), backgroundColor: css("--muted") + "44", borderRadius: 2, yAxisID: "y", order: 3 },
    { type: "bar", label: "Patrimônio", data: S.map(x => x.P), backgroundColor: css("--accent") + "66", borderRadius: 2, yAxisID: "y", order: 2 },
    { type: "line", label: "Renda mensal", data: S.map(x => x.renda), borderColor: css("--accent-2"), backgroundColor: css("--accent-2"), borderWidth: 2.5, pointRadius: 0, yAxisID: "y2", order: 1 },
  ] }, options: o });
}

function configurarAssistente() {
  if (!window.Assistente) return;
  Assistente.configurar({
    contexto: () => {
      const L = linhas().filter(l => l.a);
      if (!L.length) return "O usuário ainda não montou a carteira no site.";
      const tot = L.reduce((s, l) => ({ valor: s.valor + l.valor, renda: s.renda + l.renda }), { valor: 0, renda: 0 });
      return `Carteira do usuário (${L.length} ativos, patrimônio ${brl(tot.valor)}, renda estimada ${brl(tot.renda)} por ano): ` +
        L.map(l => `${l.a.t} (${l.a.c === "acoes" ? l.a.setor : CLASSES[l.a.c]}) peso ${pct(l.valor / tot.valor, 0)}, DY ${pct(l.dy)}${l.bz?.teto ? `, preço-teto ${brl(l.bz.teto)}` : ""}`).join("; ") + ".";
    },
    sugestoes: () => ["Minha carteira está diversificada para viver de dividendos?", "Quais riscos de concentração você vê na minha carteira?", "Como funciona a tributação de dividendos, JCP e rendimentos de FIIs?"],
  });
}

main();
