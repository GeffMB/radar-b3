"use strict";
/* Dívida pública: Dívida Bruta do Governo Geral e Dívida Líquida do Setor Público, em R$ e % do PIB (Banco Central, mensal). */
const $ = id => document.getElementById(id);
const { f1, f2 } = R;
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesBR = s => { const [y, m] = s.split("-"); return `${MESES[+m - 1]}/${y}`; };
const tri = v => v == null ? "–" : "R$ " + f2.format(v / 1e6) + " tri";          // séries do BC vêm em R$ milhões
const pp = v => v == null ? "–" : f1.format(v) + "%";
const IND = {
  dbgg: { l: "Dívida bruta", longo: "Dívida Bruta do Governo Geral", cor: "--accent" },
  dlsp: { l: "Dívida líquida", longo: "Dívida Líquida do Setor Público", cor: "--accent-2" },
};
let D = null, chart = null;
const estado = { unid: "pib", per: 120 };
try { const s = JSON.parse(localStorage.getItem("radar-divida") || "{}"); if (s.unid) estado.unid = s.unid; if (s.per != null) estado.per = s.per; } catch (e) {}

async function main() {
  D = await R.carregar("mercado/divida.json");
  if (!D?.dbgg?.pib?.length) { $("conteudo").innerHTML = '<div class="msg">Os dados da dívida ainda não foram coletados. Eles chegam na próxima atualização diária.</div>'; return; }
  R.ligarBusca([]);
  numeros(); tabela(); controles(); grafico();
  document.addEventListener("radar:tema", grafico);
  configurarAssistente();
}

// valor de N meses antes do último ponto da série
const antes = (serie, n) => { if (!serie?.length) return null; const [ym] = serie[serie.length - 1]; const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 - n, 1); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; return serie.find(x => x[0] === k)?.[1] ?? null; };
const ult = s => s?.length ? s[s.length - 1] : null;

function numeros() {
  const tile = (rot, v, nota, delta, destaque) => `<div class="tile${destaque ? " destaque" : ""}"><span class="label">${rot}</span><span class="big">${v}</span>${delta}<span class="note">${nota}</span></div>`;
  const dlt = (atual, ant, fmt, rot) => atual == null || ant == null ? "" : `<span class="delta ${atual > ant ? "up" : "down"}">${atual >= ant ? "+" : "−"}${fmt(Math.abs(atual - ant))} ${rot}</span>`;
  const out = [];
  for (const k of ["dbgg", "dlsp"]) {
    const p = ult(D[k].pib), b = ult(D[k].brl);
    if (p) {
      const max = Math.max(...D[k].pib.map(x => x[1]));
      out.push(tile(`${IND[k].l} · % do PIB`, pp(p[1]), `${mesBR(p[0])}${p[1] >= max ? " · maior da série" : ` · máxima ${pp(max)}`}`,
        dlt(p[1], antes(D[k].pib, 12), v => f1.format(v) + " p.p.", "em 12 meses"), k === "dbgg"));
    }
    if (b) out.push(tile(`${IND[k].l} · em reais`, tri(b[1]), mesBR(b[0]),
      dlt(b[1], antes(D[k].brl, 12), v => "R$ " + f2.format(v / 1e6) + " tri", "em 12 meses")));
  }
  $("numeros").innerHTML = out.join("");
  const ref = ult(D.dbgg.pib)?.[0];
  $("ref").textContent = ref ? `Último dado: ${mesBR(ref)} · fonte Banco Central` : "";
}

function tabela() {
  const meses = [...new Set([...(D.dbgg.pib || []), ...(D.dlsp.pib || [])].map(x => x[0]))].sort().slice(-12).reverse();
  const mapa = s => Object.fromEntries(s || []);
  const a = mapa(D.dbgg.pib), b = mapa(D.dbgg.brl), c = mapa(D.dlsp.pib), d = mapa(D.dlsp.brl);
  $("tab").innerHTML = `<table class="dtab"><thead><tr><th>Mês</th><th>Bruta % PIB</th><th>Bruta R$</th><th>Líquida % PIB</th><th>Líquida R$</th></tr></thead><tbody>
    ${meses.map(m => `<tr><td>${mesBR(m)}</td><td><b>${pp(a[m])}</b></td><td>${tri(b[m])}</td><td><b>${pp(c[m])}</b></td><td>${tri(d[m])}</td></tr>`).join("")}</tbody></table>`;
}

function controles() {
  const marcar = () => {
    document.querySelectorAll("#unid button").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.v === estado.unid)));
    document.querySelectorAll("#per button").forEach(x => x.setAttribute("aria-pressed", String(+x.dataset.v === estado.per)));
  };
  const ligar = (id, campo, conv) => $(id).addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    estado[campo] = conv(b.dataset.v); marcar(); grafico();
    try { localStorage.setItem("radar-divida", JSON.stringify(estado)); } catch (e) {}
  });
  ligar("unid", "unid", v => v); ligar("per", "per", Number); marcar();
}

function grafico() {
  Chart.defaults.font.family = css("--font-num") || "monospace";
  Chart.defaults.font.size = 11;
  Chart.defaults.color = css("--muted");
  const u = estado.unid;
  let meses = [...new Set(["dbgg", "dlsp"].flatMap(k => (D[k][u] || []).map(x => x[0])))].sort();
  if (estado.per) meses = meses.slice(-estado.per);
  const conv = v => v == null ? null : u === "brl" ? v / 1e6 : v;
  const ds = ["dbgg", "dlsp"].map(k => { const m = Object.fromEntries(D[k][u] || []); const cor = css(IND[k].cor);
    return { label: IND[k].longo, data: meses.map(x => conv(m[x])), borderColor: cor, backgroundColor: cor, borderWidth: 2, pointRadius: 0, spanGaps: true, tension: 0 }; });
  const fmt = v => u === "brl" ? "R$ " + f2.format(v) + " tri" : f1.format(v) + "%";
  const longo = meses.length > 72;
  chart?.destroy();
  chart = new Chart($("c-div"), { type: "line", data: { labels: meses, datasets: ds }, options: {
    responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: true, position: "bottom", labels: { boxWidth: 14, boxHeight: 2 } },
      tooltip: { backgroundColor: css("--ink"), titleColor: css("--bg"), bodyColor: css("--bg"), padding: 10, displayColors: true, boxHeight: 2,
        callbacks: { title: it => mesBR(it[0].label), label: it => it.parsed.y == null ? "" : ` ${it.dataset.label}: ${fmt(it.parsed.y)}` } },
    },
    scales: {
      x: { grid: { display: false }, border: { color: css("--line") }, ticks: { maxRotation: 0, autoSkip: false,
        callback: function (v) { const s = this.getLabelForValue(v); const [y, m] = s.split("-"); return m === "01" && (!longo || +y % 2 === 0) ? y : ""; } } },
      y: { grid: { color: css("--line") }, border: { display: false }, ticks: { callback: v => u === "brl" ? "R$ " + f1.format(v) + " tri" : f1.format(v) + "%" } },
    },
  } });
}

function configurarAssistente() {
  if (!window.Assistente) return;
  const linha = k => { const p = ult(D[k].pib), b = ult(D[k].brl); return `${IND[k].longo}: ${p ? pp(p[1]) + " do PIB em " + mesBR(p[0]) : "–"} (12 meses antes: ${pp(antes(D[k].pib, 12))}), ${b ? tri(b[1]) : "–"}`; };
  Assistente.configurar({
    contexto: () => `Dívida pública do Brasil (Banco Central): ${linha("dbgg")}. ${linha("dlsp")}. Série da bruta em % do PIB nos últimos 24 meses: ${(D.dbgg.pib || []).slice(-24).map(x => x[0] + " " + x[1]).join(", ")}.`,
    sugestoes: () => ["Por que a dívida bruta está subindo?", "Qual a diferença entre dívida bruta e líquida?", "Como a dívida pública afeta a bolsa e os juros?"],
  });
}

main();
