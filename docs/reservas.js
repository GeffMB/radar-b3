"use strict";
/* Reservas internacionais do Brasil (Banco Central) e compras/vendas de dólar do BC no mercado de câmbio. */
const $ = id => document.getElementById(id);
const { f1, f2, esc } = R;
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesBR = s => { const [y, m] = s.split("-"); return `${MESES[+m - 1]}/${y}`; };
const diaBR = s => { const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; };
const bi = v => v == null ? "–" : "US$ " + f1.format(v / 1e3) + " bi";            // séries do BC vêm em US$ milhões
const biS = v => v == null ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + f2.format(Math.abs(v) / 1e3);
let D = null, cRes = null, cBc = null;
const estado = { perRes: 60, perBc: 24, tipo: "caixa" };
try { Object.assign(estado, JSON.parse(localStorage.getItem("radar-reservas") || "{}")); } catch (e) {}
const guardar = () => { try { localStorage.setItem("radar-reservas", JSON.stringify(estado)); } catch (e) {} };

async function main() {
  D = await R.carregar("mercado/reservas.json");
  if (!D?.diaria?.length && !D?.mensal?.length) { $("conteudo").innerHTML = '<div class="msg">Os dados das reservas ainda não foram coletados. Eles chegam na próxima atualização diária.</div>'; return; }
  R.ligarBusca([]);
  numeros(); tabela(); controles(); graficoReservas(); graficoBC();
  document.addEventListener("radar:tema", () => { graficoReservas(); graficoBC(); });
  configurarAssistente();
  // valor aproximado em reais com o dólar de agora (só um complemento: se não vier, o card fica em dólar)
  const q = await R.cotacoesAgora(["USDBRL=X"]);
  const usd = q["USDBRL=X"]?.p, hoje = D.diaria?.at(-1);
  if (usd > 0 && hoje) { const el = $("em-reais"); if (el) el.textContent = `≈ R$ ${f2.format(hoje[1] * usd / 1e6)} tri com o dólar a R$ ${f2.format(usd)}`; }
}

const mesesAtuacao = () => Object.keys(D.atuacoes || {}).sort();
// todos os meses entre o primeiro e o último com atuação (meses sem leilão contam como zero)
function serieMeses() {
  const ks = mesesAtuacao(); if (!ks.length) return [];
  const out = []; let [y, m] = ks[0].split("-").map(Number); const [yf, mf] = ks.at(-1).split("-").map(Number);
  while (y < yf || (y === yf && m <= mf)) { out.push(`${y}-${String(m).padStart(2, "0")}`); if (++m > 12) { m = 1; y++; } }
  return out;
}
const at = k => (D.atuacoes || {})[k] || { vista: 0, linhas: 0, swap_venda: 0, swap_compra: 0 };
const valorEm = (serie, alvo) => { let r = null; for (const [d, v] of serie) { if (d <= alvo) r = v; else break; } return r; };   // último valor até a data

function numeros() {
  const tile = (rot, v, nota, extra = "", destaque = false) => `<div class="tile${destaque ? " destaque" : ""}"><span class="label">${rot}</span><span class="big">${v}</span>${extra}<span class="note">${nota}</span></div>`;
  const out = [];
  const dia = D.diaria || [], hoje = dia.at(-1);
  if (hoje) {
    out.push(tile("Reservas hoje", bi(hoje[1]), `${diaBR(hoje[0])} · conceito liquidez`, '<span class="delta" id="em-reais"></span>', true));
    const d = new Date(hoje[0] + "T12:00:00"); d.setFullYear(d.getFullYear() - 1);
    const ha1 = valorEm(dia, d.toISOString().slice(0, 10));
    const m = new Date(hoje[0] + "T12:00:00"); m.setDate(m.getDate() - 30);
    const ha30 = valorEm(dia, m.toISOString().slice(0, 10));
    const dl = (a, b, rot) => a == null || b == null ? "" : `<span class="delta ${a >= b ? "pos" : "neg"}">${biS(a - b)} bi ${rot}</span>`;
    out.push(tile("Variação", ha1 != null ? `${biS(hoje[1] - ha1)} bi` : "–", "em 12 meses (inclui juros e câmbio)", dl(hoje[1], ha30, "em 30 dias")));
  }
  const ks = mesesAtuacao();
  if (ks.length) {
    const ult = ks.at(-1), a = at(ult);
    const verbo = v => v > 0 ? `comprou ${bi(v)}` : v < 0 ? `vendeu ${bi(-v)}` : "não comprou nem vendeu";
    const fala = a.vista ? verbo(a.vista) : "sem compra ou venda à vista";
    out.push(tile(`BC em ${mesBR(ult)}`, a.vista ? (a.vista > 0 ? "Comprou" : "Vendeu") + " dólar" : "Sem leilão à vista",
      `${fala}${a.linhas ? ` · linhas ${bi(-a.linhas)}` : ""}`, a.vista ? `<span class="delta ${a.vista > 0 ? "pos" : "neg"}">${biS(a.vista)} bi à vista</span>` : ""));
    const doze = ks.slice(-12), sv = doze.reduce((s, k) => s + at(k).vista, 0), sl = doze.reduce((s, k) => s + at(k).linhas, 0);
    out.push(tile("BC em 12 meses", `${biS(sv)} bi`, `à vista, de ${mesBR(doze[0])} a ${mesBR(ult)} · linhas ${biS(sl)} bi`,
      `<span class="delta ${sv >= 0 ? "pos" : "neg"}">${sv > 0 ? "comprador líquido" : sv < 0 ? "vendedor líquido" : "neutro"}</span>`));
  }
  $("numeros").innerHTML = out.join("");
  $("ref-res").textContent = hoje ? `Último dado: ${diaBR(hoje[0])}` : "";
  $("ref-bc").textContent = ks.length ? `Até ${mesBR(ks.at(-1))} · o BC publica o mês anterior no fim de cada mês` : "";
}

function tabela() {
  const ks = serieMeses().slice(-12).reverse();
  const cel = v => `<td class="${v > 0 ? "pos" : v < 0 ? "neg" : ""}">${v ? biS(v) : "–"}</td>`;
  const mens = Object.fromEntries(D.mensal || []);
  $("tab").innerHTML = ks.length ? `<table class="dtab"><thead><tr><th>Mês</th><th>À vista</th><th>Linhas</th><th>Swap trad.</th><th>Swap rev.</th><th>Reservas</th></tr></thead><tbody>
    ${ks.map(k => { const a = at(k); return `<tr><td>${mesBR(k)}</td>${cel(a.vista)}${cel(a.linhas)}${cel(-a.swap_venda)}${cel(a.swap_compra)}<td>${mens[k] != null ? f1.format(mens[k] / 1e3) : "–"}</td></tr>`; }).join("")}</tbody></table>`
    : '<div class="msg">Sem dados de atuação.</div>';
}

function controles() {
  const grupos = [["per-res", "perRes", Number, graficoReservas], ["per-bc", "perBc", Number, graficoBC], ["tipo-bc", "tipo", String, graficoBC]];
  const marcar = () => grupos.forEach(([id, k]) => document.querySelectorAll(`#${id} button`).forEach(b => b.setAttribute("aria-pressed", String(String(estado[k]) === b.dataset.v))));
  grupos.forEach(([id, k, conv, f]) => $(id).addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; estado[k] = conv(b.dataset.v); marcar(); guardar(); f(); }));
  marcar();
}

function base() {
  Chart.defaults.font.family = css("--font-num") || "monospace";
  Chart.defaults.font.size = 11;
  Chart.defaults.color = css("--muted");
}
const dica = () => ({ backgroundColor: css("--ink"), titleColor: css("--bg"), bodyColor: css("--bg"), padding: 10 });

function graficoReservas() {
  base();
  let pts;
  if (estado.perRes === 12 && D.diaria?.length) {
    const ult = new Date(D.diaria.at(-1)[0] + "T12:00:00"); ult.setFullYear(ult.getFullYear() - 1);
    const corte = ult.toISOString().slice(0, 10);
    pts = D.diaria.filter(x => x[0] >= corte);
  } else {
    pts = (D.mensal || []).slice();
    if (estado.perRes) pts = pts.slice(-estado.perRes);
  }
  const diario = estado.perRes === 12;
  const cor = css("--accent");
  cRes?.destroy();
  cRes = new Chart($("c-res"), { type: "line", data: { labels: pts.map(x => x[0]), datasets: [{ data: pts.map(x => x[1] / 1e3), borderColor: cor, backgroundColor: cor + "22", fill: true, borderWidth: 2, pointRadius: 0, tension: 0 }] }, options: {
    responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false },
    plugins: { legend: { display: false }, tooltip: { ...dica(), displayColors: false,
      callbacks: { title: it => diario ? diaBR(it[0].label) : mesBR(it[0].label), label: it => ` Reservas: US$ ${f1.format(it.parsed.y)} bi` } } },
    scales: {
      x: { grid: { display: false }, border: { color: css("--line") }, ticks: { maxRotation: 0, autoSkip: false, callback: function (v) {
        const s = this.getLabelForValue(v), [y, m, d] = s.split("-");
        if (diario) { const prev = v > 0 ? this.getLabelForValue(v - 1).slice(0, 7) : ""; return s.slice(0, 7) !== prev && +m % 2 === 1 ? `${MESES[+m - 1]}/${y.slice(2)}` : ""; }
        const n = pts.length; return m === "01" && (n <= 72 || +y % (n > 300 ? 5 : 2) === 0) ? y : ""; } } },
      y: { grid: { color: css("--line") }, border: { display: false }, ticks: { callback: v => "US$ " + f1.format(v) + " bi" } },
    },
  } });
}

function graficoBC() {
  base();
  let ks = serieMeses();
  if (estado.perBc) ks = ks.slice(-estado.perBc);
  const verde = css("--good"), verm = css("--bad"), amb = css("--warn") || "#c98a2b";
  let ds, leg, aviso;
  if (estado.tipo === "swap") {
    ds = [
      { label: "Swap reverso (equivale a comprar)", data: ks.map(k => at(k).swap_compra / 1e3), backgroundColor: verde + "cc" },
      { label: "Swap tradicional (equivale a vender)", data: ks.map(k => -at(k).swap_venda / 1e3), backgroundColor: verm + "cc" },
    ];
    leg = [[verde, "Swap reverso: o BC assume posição comprada em dólar"], [verm, "Swap tradicional: o BC assume posição vendida em dólar"]];
    aviso = "Os volumes de swap incluem as rolagens de contratos que vencem; não mexem nas reservas.";
  } else {
    ds = [
      { label: "À vista", data: ks.map(k => at(k).vista / 1e3), backgroundColor: ks.map(k => (at(k).vista >= 0 ? verde : verm) + "dd") },
      { label: "Linhas (venda com recompra)", data: ks.map(k => at(k).linhas / 1e3), backgroundColor: amb + "bb" },
    ];
    leg = [[verde, "Compra de dólar à vista (reservas sobem)"], [verm, "Venda de dólar à vista (reservas caem)"], [amb, "Linhas: venda com recompra, o dólar volta depois"]];
    aviso = "Barra acima de zero: o BC comprou dólar no mês. Abaixo de zero: vendeu.";
  }
  $("leg-bc").innerHTML = leg.map(([c, t]) => `<span><i style="background:${c}"></i>${esc(t)}</span>`).join("");
  $("aviso-bc").textContent = aviso;
  const longo = ks.length > 72;
  cBc?.destroy();
  cBc = new Chart($("c-bc"), { type: "bar", data: { labels: ks, datasets: ds }, options: {
    responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false },
    plugins: { legend: { display: false }, tooltip: { ...dica(), boxHeight: 8,
      filter: it => it.parsed.y !== 0,
      callbacks: { title: it => mesBR(it[0].label), label: it => ` ${it.dataset.label}: ${biS(it.parsed.y * 1e3)} bi` } } },
    scales: {
      x: { stacked: true, grid: { display: false }, border: { color: css("--line") }, ticks: { maxRotation: 0, autoSkip: false, callback: function (v) {
        const [y, m] = this.getLabelForValue(v).split("-"); return m === "01" && (!longo || +y % (ks.length > 200 ? 4 : 2) === 0) ? y : (ks.length <= 30 && m === "07" ? `jul/${y.slice(2)}` : ""); } } },
      y: { stacked: true, grid: { color: ctx => ctx.tick.value === 0 ? css("--muted") : css("--line") }, border: { display: false }, ticks: { callback: v => f1.format(v) + " bi" } },
    },
  } });
}

function configurarAssistente() {
  if (!window.Assistente) return;
  const ks = mesesAtuacao().slice(-12);
  Assistente.configurar({
    contexto: () => `Reservas internacionais do Brasil (Banco Central, conceito liquidez): ${D.diaria?.length ? bi(D.diaria.at(-1)[1]) + " em " + diaBR(D.diaria.at(-1)[0]) : "–"}. `
      + `Atuações do BC no câmbio por mês (US$ milhões; vista + = compra, − = venda; linhas = vendas com recompra; swaps incluem rolagens): `
      + ks.map(k => `${k}: vista ${at(k).vista}, linhas ${at(k).linhas}, swap tradicional ${at(k).swap_venda}, swap reverso ${at(k).swap_compra}`).join("; ") + ".",
    sugestoes: () => ["Por que o Banco Central está vendendo dólar?", "As reservas do Brasil são altas ou baixas?", "Qual a diferença entre vender dólar à vista e fazer swap?"],
  });
}

main();
