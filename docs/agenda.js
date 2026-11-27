"use strict";
/* Agenda econômica: eventos do Brasil e dos EUA (coletados toda noite) + datas com e de pagamento dos proventos. */
const $ = id => document.getElementById(id);
const { esc, f2 } = R;
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const estado = { pais: "todos", imp: 1, prov: "cart" };
try { Object.assign(estado, JSON.parse(localStorage.getItem("radar-agenda") || "{}")); } catch (e) {}
let EV = [], PROV = {}, CART = new Set(), CLASSE = {};

const hojeISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const somaDias = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const tituloDia = iso => {
  const h = hojeISO();
  if (iso === h) return "Hoje";
  if (iso === somaDias(h, 1)) return "Amanhã";
  const d = new Date(iso + "T12:00:00");
  return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? " de " + d.getFullYear() : ""}`;
};
const faltam = (iso, h) => {
  const alvo = new Date(`${iso}T${h || "12:00"}:00-03:00`), ms = alvo - Date.now();
  if (ms < 0) return "agora";
  const d = Math.floor(ms / 864e5), hr = Math.floor(ms / 36e5);
  return d >= 2 ? `em ${d} dias` : hr >= 1 ? `em ${hr} ${hr === 1 ? "hora" : "horas"}` : "em menos de 1 hora";
};

async function main() {
  R.ligarBusca([]);
  const [ag, pv, bz] = await Promise.all([R.carregar("mercado/agenda.json"), R.carregar("mercado/proventos.json"), R.buscaDados()]);
  for (const [t, , c] of bz || []) CLASSE[t] = c;
  EV = ag?.eventos || [];
  PROV = pv?.itens || {};
  try { CART = new Set((JSON.parse(localStorage.getItem("radar-carteira") || "[]") || []).map(p => p.t)); } catch (e) {}
  if (!CART.size && estado.prov === "cart") estado.prov = "todos";
  controles(); desenhar(); configurarAssistente();
  $("rodape").textContent = ag?.atualizado_em ? `Agenda atualizada em ${new Date(ag.atualizado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}. Datas podem mudar; confira na fonte oficial antes de operar.` : "";
  setInterval(desenhar, 60e3);        // "em X horas" e eventos que já passaram
}

function proventos(ini, fim) {
  if (estado.prov === "nao") return [];
  const out = [];
  for (const [t, lista] of Object.entries(PROV)) {
    if (estado.prov === "cart" && !CART.has(t)) continue;
    for (const [dc, pg, v, tipo] of lista) {
      if (dc && dc >= ini && dc <= fim) out.push({ d: dc, n: `${t}: data com de ${tipo || "provento"}`, det: `Quem tiver a ação no fim deste dia recebe R$ ${R.nf(4).format(v)} por ação${pg ? ` em ${pg.split("-").reverse().join("/")}` : ""}`, pais: "PROV", imp: CART.has(t) ? 2 : 1, t });
      if (pg && pg >= ini && pg <= fim) out.push({ d: pg, n: `${t}: pagamento de ${tipo || "provento"}`, det: `R$ ${R.nf(4).format(v)} por ação`, pais: "PROV", imp: CART.has(t) ? 2 : 1, t });
    }
  }
  // agrupa vários tipos da mesma ação no mesmo dia (ex.: JCP e dividendo)
  const m = new Map();
  for (const e of out) { const k = e.d + e.n; if (!m.has(k)) m.set(k, e); }
  return [...m.values()];
}

function desenhar() {
  const h = hojeISO(), fim = somaDias(h, 90);
  let lista = EV.filter(e => e.d >= h && e.d <= fim && (estado.pais === "todos" || e.pais === estado.pais) && (e.imp || 1) >= estado.imp);
  if (estado.pais !== "EUA" && estado.imp < 3) lista = lista.concat(proventos(h, somaDias(h, 45)));
  lista.sort((a, b) => a.d.localeCompare(b.d) || (a.h || "99").localeCompare(b.h || "99") || (b.imp || 1) - (a.imp || 1));
  // destaque: próximo evento de alto impacto (independe dos filtros)
  const agoraH = new Date().toTimeString().slice(0, 5);
  const prox = EV.find(e => (e.imp || 1) >= 3 && (e.d > h || (e.d === h && (e.h || "23:59") >= agoraH)));
  const px = $("prox");
  if (prox) { px.hidden = false; px.innerHTML = `<span class="rot">Próximo evento de alto impacto</span><b>${esc(prox.n)}</b><span class="quanto">${tituloDia(prox.d)}${prox.h ? " às " + prox.h : ""} · ${faltam(prox.d, prox.h)}</span>`; }
  const porDia = new Map();
  for (const e of lista) { if (!porDia.has(e.d)) porDia.set(e.d, []); porDia.get(e.d).push(e); }
  const imp = n => `<span class="imp i${n}" title="${n === 3 ? "Alto" : n === 2 ? "Médio" : "Baixo"} impacto">${"●".repeat(n)}<i>${"●".repeat(3 - n)}</i></span>`;
  const rotPais = { BR: "BR", EUA: "EUA", PROV: "PROV" };
  $("lista").innerHTML = porDia.size ? [...porDia].map(([d, evs]) => `<div class="dia"><h3 class="${d === h ? "hoje" : ""}">${tituloDia(d).replace(/^./, c => c.toUpperCase())}</h3>
    ${evs.map(e => {
      const passou = d === h && e.h && e.h < agoraH;
      const nome = e.t ? `<a href="${R.linkAtivo(CLASSE[e.t] || "acoes", e.t)}"><b>${esc(e.n)}</b></a>` : `<b>${esc(e.n)}</b>`;
      const extra = e.det || [e.fonte, e.prev ? `previsão ${e.prev}` : "", e.ant ? `anterior ${e.ant}` : ""].filter(Boolean).join(" · ");
      return `<div class="ev${passou ? " passou" : ""}"><span class="hora">${e.h || "—"}</span><span class="pais ${e.pais}">${rotPais[e.pais] || e.pais}</span><div class="nome">${nome}<span>${esc(extra)}</span></div>${imp(e.imp || 1)}</div>`;
    }).join("")}</div>`).join("")
    : '<p class="vazio">Nenhum evento com esses filtros nos próximos 90 dias.</p>';
}

function controles() {
  const grupos = [["f-pais", "pais", String], ["f-imp", "imp", Number], ["f-prov", "prov", String]];
  const marcar = () => grupos.forEach(([id, k]) => document.querySelectorAll(`#${id} button`).forEach(b => b.setAttribute("aria-pressed", String(String(estado[k]) === b.dataset.v))));
  grupos.forEach(([id, k, conv]) => $(id).addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    estado[k] = conv(b.dataset.v); marcar(); desenhar();
    try { localStorage.setItem("radar-agenda", JSON.stringify(estado)); } catch (e) {}
  }));
  if (!CART.size) document.querySelector('#f-prov button[data-v="cart"]').title = "Sua carteira está vazia neste navegador";
  marcar();
}

function configurarAssistente() {
  if (!window.Assistente) return;
  const h = hojeISO();
  const prox = EV.filter(e => e.d >= h).slice(0, 25).map(e => `${e.d} ${e.h || ""} ${e.pais} ${e.n}${e.imp === 3 ? " (alto impacto)" : ""}`).join("; ");
  Assistente.configurar({
    contexto: () => `Agenda econômica (horário de Brasília): ${prox}.`,
    sugestoes: () => ["O que esperar da próxima reunião do Copom?", "Como o payroll americano costuma mexer com a bolsa brasileira?", "Quais eventos desta semana podem mexer com o dólar?"],
  });
}

main();
