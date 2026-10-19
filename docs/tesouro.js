"use strict";
/* Tesouro Direto: títulos à venda hoje, agrupados por tipo, com a taxa de compra, preço, investimento mínimo
   e o histórico da taxa de cada título (toque na linha). */
const $ = id => document.getElementById(id);
const { esc, f1, f2, brl } = R;
const nav = document.querySelector(".topbar .nav");
if (nav) nav.dataset.atual = "tesouro";
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const dataBR = s => { const [y, m, d] = s.slice(0, 10).split("-"); return `${d}/${m}/${y}`; };
const p2 = x => x == null || !isFinite(x) ? "–" : f2.format(x) + "%";

const TIPOS = {
  "Selic": "Acompanha a Selic. Ideal para reserva de emergência: oscila pouco e pode ser resgatado a qualquer dia.",
  "Prefixado": "Taxa travada na compra: você sabe quanto terá no vencimento. Ganha se os juros caírem; perde no meio do caminho se subirem.",
  "IPCA+": "Inflação + uma taxa real. Protege o poder de compra no longo prazo. Oscila bastante antes do vencimento.",
  "Renda+": "Para aposentadoria: depois do ano escolhido, paga uma renda mensal corrigida pela inflação por 20 anos.",
  "Educa+": "Para educação: a partir do ano escolhido, paga 60 parcelas mensais corrigidas pela inflação.",
  "IGP-M+": "Corrigido pelo IGP-M + taxa real.",
};
let TD = null, RF = null, filtro = "", aberto = null, chart = null;

async function main() {
  [TD, RF] = await Promise.all([R.carregar("mercado/tesouro.json"), R.carregar("mercado/rendafixa.json")]);
  if (!TD?.titulos?.length) { $("conteudo").innerHTML = '<div class="msg">Os títulos ainda não foram coletados. Eles chegam na próxima atualização diária.</div>'; return; }
  R.ligarBusca([]);
  const att = TD.titulos.find(t => t.atualizado)?.atualizado;
  $("meta").innerHTML = `${TD.titulos.length} títulos à venda${att ? ` · preços de <b>${dataBR(att)}</b>` : ""}`;
  if (RF) $("taxas").innerHTML = [["Selic (meta)", RF.selic_meta], ["CDI", RF.cdi], ["IPCA 12 meses", RF.ipca12]].map(([l, v]) => `<span class="badge grande">${l} <b>${p2(v)}</b></span>`).join("");
  const tipos = [...new Set(TD.titulos.map(t => t.tipo))];
  $("tipos").innerHTML = `<button class="chip" type="button" data-t="" aria-pressed="true">Todos</button>` + tipos.map(t => `<button class="chip" type="button" data-t="${esc(t)}" aria-pressed="false">${esc(t)}</button>`).join("");
  $("tipos").onclick = e => { const b = e.target.closest("button"); if (!b) return; filtro = b.dataset.t; aberto = null; desenhar(); };
  $("lista").onclick = e => {
    const tr = e.target.closest("tr[data-i]"); if (!tr) return;
    aberto = aberto === +tr.dataset.i ? null : +tr.dataset.i; desenhar();
  };
  $("lista").onkeydown = e => { if ((e.key === "Enter" || e.key === " ") && e.target.matches("tr[data-i]")) { e.preventDefault(); e.target.click(); } };
  desenhar();
  document.addEventListener("radar:tema", desenhar);
  configurarAssistente();
}

function desenhar() {
  document.querySelectorAll("#tipos .chip").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.t === filtro)));
  const grupos = [...new Set(TD.titulos.map(t => t.tipo))].filter(t => !filtro || t === filtro);
  $("lista").innerHTML = grupos.map(g => {
    const ts = TD.titulos.map((t, i) => ({ ...t, i })).filter(t => t.tipo === g);
    return `<section class="panel tgrupo"><div class="ph"><h2>Tesouro ${esc(g)}</h2><span class="note">${esc(TIPOS[g] || "")}</span></div>
      <div class="tablebox"><table class="ttab"><thead><tr><th>Título</th><th>Rentabilidade</th><th>Vencimento</th><th>Preço unitário</th><th>Mínimo</th><th></th></tr></thead><tbody>
      ${ts.map(t => `<tr data-i="${t.i}" tabindex="0" aria-expanded="${aberto === t.i}"><td><b>${esc(t.nome)}</b>${t.juros_semestrais ? ' <span class="badge">juros semestrais</span>' : ""}</td>
        <td class="taxa">${esc(t.taxa || "–")}</td><td>${dataBR(t.venc)}</td><td>${brl(t.pu)}</td><td>${brl(t.minimo)}</td>
        <td class="mais-ic">${t.hist ? R.icone("chev", "chev" + (aberto === t.i ? " gira" : "")) : ""}</td></tr>
        ${aberto === t.i ? `<tr class="det"><td colspan="6"><div class="tdet">
          <div class="chart"><canvas id="c-hist" aria-label="Histórico da taxa"></canvas></div>
          <div class="tinfo">${(t.info || []).map(x => `<p>${esc(x)}</p>`).join("")}
            ${t.pu_resgate ? `<p class="note">Preço de venda hoje (resgate antecipado): <b>${brl(t.pu_resgate)}</b>${t.taxa_resgate ? ` · taxa ${esc(t.taxa_resgate)}` : ""}</p>` : ""}
            <p class="note">Investimento mínimo de 1% do título (${brl(t.minimo)}). Custódia da B3: 0,20% ao ano${t.tipo === "Selic" ? ", isenta até R$ 10 mil" : ""}.</p></div></div></td></tr>` : ""}`).join("")}
      </tbody></table></div></section>`;
  }).join("");
  if (aberto != null) desenharHist(TD.titulos[aberto]);
}

function desenharHist(t) {
  chart?.destroy(); chart = null;
  const el = $("c-hist"); if (!el || !t.hist) return;
  const H = t.hist;
  Chart.defaults.font.family = css("--font-num") || "monospace";
  Chart.defaults.font.size = 11;
  Chart.defaults.color = css("--muted");
  const sel = t.tipo === "Selic";
  chart = new Chart(el, { type: "line", data: { labels: H.d, datasets: [{ data: H.taxa, borderColor: css("--accent"), backgroundColor: css("--accent"), borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false }, title: { display: true, text: sel ? "Ágio/deságio sobre a Selic (% a.a.)" : "Taxa de compra (% a.a.)", align: "start", color: css("--muted"), font: { size: 12 } },
        tooltip: { backgroundColor: css("--ink"), titleColor: css("--bg"), bodyColor: css("--bg"), padding: 10, displayColors: false,
          callbacks: { title: it => dataBR(it[0].label), label: it => `${sel ? "Selic + " : t.tipo === "Prefixado" ? "" : "IPCA + "}${f2.format(it.parsed.y)}% · PU ${brl(H.pu[it.dataIndex])}` } } },
      scales: { x: { grid: { display: false }, border: { color: css("--line") }, ticks: { maxRotation: 0, autoSkipPadding: 24, callback: function (v) { const [y, m] = this.getLabelForValue(v).split("-"); return `${m}/${y.slice(2)}`; } } },
        y: { grid: { color: css("--line") }, border: { display: false }, ticks: { callback: v => f2.format(v) + "%" } } } } });
}

function configurarAssistente() {
  if (!window.Assistente) return;
  const top = TD.titulos.filter(t => ["Selic", "Prefixado", "IPCA+"].includes(t.tipo)).map(t => `${t.nome}: ${t.taxa}, vence ${dataBR(t.venc)}`);
  Assistente.configurar({
    contexto: () => `Tesouro Direto hoje: ${top.join("; ")}.${RF ? ` Selic ${p2(RF.selic_meta)}, CDI ${p2(RF.cdi)}, IPCA 12m ${p2(RF.ipca12)}.` : ""}`,
    sugestoes: () => ["Qual título do Tesouro escolher para a reserva de emergência?", "Prefixado ou IPCA+: qual faz mais sentido agora?", "O que é marcação a mercado e quando eu perco dinheiro no Tesouro?"],
  });
}

main();
