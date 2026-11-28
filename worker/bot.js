// Bot do Telegram do Radar B3 (só do dono): cotações, método Barsi, proventos, agenda e alertas de preço.
// O token fica como segredo do Cloudflare (TELEGRAM_TOKEN), nunca no site. O Telegram entrega as mensagens
// em /tg com um cabeçalho secreto derivado do token; quem conversa primeiro com o bot vira o dono
// (o chat fica guardado no KV) e o bot ignora qualquer outra pessoa.

const SITE = "https://geffmb.github.io/radar-b3/";
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const nf = (v, d = 2) => v == null || !isFinite(v) ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const R$ = v => v == null || !isFinite(v) ? "—" : (v < 0 ? "−" : "") + "R$ " + nf(Math.abs(v), Math.abs(v) < 1 ? 4 : 2);
const pct = (v, d = 1) => v == null || !isFinite(v) ? "—" : nf(v * 100, d) + "%";
const sinal = (v, d = 2) => v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + nf(Math.abs(v * 100), d) + "%";
const dataBR = s => s ? s.slice(0, 10).split("-").reverse().join("/") : "—";
const sem = x => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const UN_MOEDA = { stocks: "US$ ", commodities: "", indices: "", moedas: "R$ " };

export async function segredoTG(token) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("radar-b3-tg|" + token));
  return [...new Uint8Array(h)].slice(0, 24).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- dados do site (com memória de 10 minutos)
const MEMO = new Map();
async function site(caminho) {
  const m = MEMO.get(caminho);
  if (m && m.ate > Date.now()) return m.d;
  const r = await fetch(SITE + caminho, { cf: { cacheTtl: 300 }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("site " + r.status);
  const d = await r.json();
  MEMO.set(caminho, { d, ate: Date.now() + 600e3 });
  return d;
}

const limiteDivida = o => o.setor === "Energia Elétrica" || o.setor === "Saneamento" ? 4.5 : 3;
function barsi(o, alvo) {    // mesma regra do site (docs/comum.js)
  const teto = o.pm5 > 0 ? o.pm5 / alvo : null;
  const desconto = teto && o.preco ? 1 - o.preco / teto : null;
  const crit = {
    best: !!o.best, reg: o.regb >= 5 ? o.reg >= o.regb - 1 : null, teto: desconto == null ? null : desconto >= 0,
    lucro: o.lucro_n ? o.lucro_pos === o.lucro_n : o.pl != null ? o.pl > 0 : null,
    divida: o.fin ? true : o.dle == null ? null : o.dle <= limiteDivida(o), payout: o.payout == null ? null : o.payout <= 1,
  };
  const ok = crit.best && crit.reg === true && crit.teto === true && crit.lucro !== false && crit.divida !== false && crit.payout !== false;
  return { teto, desconto, crit, ok };
}

// acha o ativo pelo código (ou pelo nome, sem acento) em todas as classes do site
async function achar(texto) {
  const q = sem(texto).trim(), qt = q.replace(/[^A-Z0-9^=.-]/g, "");
  if (!q) return null;
  const busca = await site("mercado/busca.json");
  let it = busca.find(x => sem(x[0]) === qt) || busca.find(x => sem(x[0]).startsWith(qt) && qt.length >= 4)
    || busca.find(x => sem(x[1]).startsWith(q)) || busca.find(x => (" " + sem(x[1])).includes(" " + q));
  if (!it) return null;
  const [t, , classe] = it;
  if (classe === "acoes") { const d = await site("dados.json"); const a = d.acoes.find(x => x.t === t); return a ? { classe, a, sym: t + ".SA" } : null; }
  const d = await site(`mercado/${classe}.json`);
  const a = (d.itens || []).find(x => x.t === t);
  if (!a) return null;
  const sym = ["fiis", "etfs", "bdrs"].includes(classe) ? t + ".SA" : classe === "stocks" ? t : a.y || null;
  return { classe, a, sym };
}

// ---------------------------------------------------------------- conversa com o Telegram
export function criarBot(env, ctx, buscarLote) {
  const token = env.TELEGRAM_TOKEN;
  const KV = env.LIMITES;
  const api = async (metodo, corpo) => {
    const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(15000) });
    return r.json();
  };
  const estado = async () => ({ chat: null, alvo: 0.06, resumo: true, lembretes: true, alertas: [], seguindo: [], convidados: [], convites: [], ...((await KV.get("tg:estado", "json")) || {}) });
  const salvar = e => KV.put("tg:estado", JSON.stringify(e));
  const precos = async syms => { const out = {}; const l = [...new Set(syms.filter(Boolean))]; for (let i = 0; i < l.length; i += 20) Object.assign(out, await buscarLote(l.slice(i, i + 20).sort())); return out; };

  async function enviar(chat, texto, extra = {}) {
    // o Telegram aceita até 4.096 caracteres por mensagem: divide nos parágrafos
    const partes = []; let atual = "";
    for (const bloco of texto.split("\n\n")) { if ((atual + "\n\n" + bloco).length > 3800 && atual) { partes.push(atual); atual = bloco; } else atual = atual ? atual + "\n\n" + bloco : bloco; }
    if (atual) partes.push(atual);
    for (let i = 0; i < partes.length; i++) await api("sendMessage", { chat_id: chat, text: partes[i], disable_web_page_preview: true, ...(i === partes.length - 1 ? extra : {}) });
  }

  const AJUDA_CONVIDADO = `📈 Radar B3 no Telegram (convidado)

/preco BBAS3 — cotação ao vivo e indicadores (ação, FII, ETF, BDR, stock, índice, moeda ou commodity)
/barsi — ações que passam no método Barsi agora
/teto BBAS3 — preço-teto e critérios do Barsi
/proventos BBAS3 — próximos pagamentos e últimos 12 meses
/agenda — eventos importantes dos próximos 7 dias
/mercado — Ibovespa, dólar, S&P 500, petróleo, ouro e juros

Dica: dá para mandar só o código, por exemplo "PETR4".
Material de estudo, não é recomendação de investimento.`;
  const TECLADO_CONVIDADO = { reply_markup: { keyboard: [["/mercado", "/barsi"], ["/agenda", "/ajuda"]], resize_keyboard: true, is_persistent: true } };
  const TECLADO = { reply_markup: { keyboard: [["/mercado", "/barsi"], ["/agenda", "/alertas"], ["/seguindo", "/ajuda"]], resize_keyboard: true, is_persistent: true } };
  const AJUDA = `📈 Radar B3 no Telegram

/preco BBAS3 — cotação ao vivo e indicadores (ação, FII, ETF, BDR, stock, índice, moeda ou commodity)
/barsi — ações que passam no método Barsi agora
/teto BBAS3 — preço-teto e critérios do Barsi
/dy 7 — muda o DY desejado do preço-teto (agora em %DY%)
/proventos BBAS3 — próximos pagamentos e últimos 12 meses
/agenda — eventos importantes dos próximos 7 dias
/mercado — Ibovespa, dólar, S&P 500, petróleo, ouro e juros

🔔 Alertas de preço (conferidos a cada 5 min no pregão)
/alerta BBAS3 15,50 — avisa quando chegar a R$ 15,50 (acima ou abaixo, conforme o preço de agora)
/alerta BBAS3 -5% — 5% abaixo do preço atual (ou +5%)
/alerta BBAS3 teto — quando cair até o preço-teto
/alertas — lista e apaga

⭐ Ações seguidas (lembretes de proventos e do Barsi)
/seguir BBAS3 TAEE11 — passa a seguir
/seguindo — lista · /deixar BBAS3 — para de seguir

🔗 /ligar — código para os avisos do site (botão 🔔 Avisar) chegarem aqui
👥 /convidar — código para outra pessoa usar o bot · /convidados — lista, avisos e remover

☀️ /resumo — liga ou desliga o resumo das 8h30 (mercado, agenda, proventos e mudanças no Barsi)
⏰ /lembretes — liga ou desliga o aviso 30 min antes de Copom, IPCA, payroll e Fed

Dica: dá para mandar só o código, por exemplo "PETR4".
Material de estudo, não é recomendação de investimento.`;

  // ---------------------------------------------------------------- respostas
  async function cmdPreco(arg, est) {
    if (!arg) return "Mande o código, por exemplo: /preco BBAS3";
    const x = await achar(arg);
    if (!x) return `Não achei "${arg}" no Radar B3.`;
    const { classe, a, sym } = x;
    const q = sym ? (await precos([sym]))[sym] : null;
    const p = q?.p > 0 ? q.p : a.preco, vd = q?.pc > 0 ? q.p / q.pc - 1 : a.var;
    const un = classe === "acoes" || classe === "fiis" || classe === "etfs" || classe === "bdrs" ? "R$ " : (UN_MOEDA[classe] ?? "");
    const fmt = v => v == null ? "—" : un + nf(v, v < 1 ? 4 : 2) + (classe === "indices" ? " pts" : classe === "commodities" && a.un ? " " + a.un : "");
    const L = [`${a.t} — ${a.n}`, `${fmt(p)} (${sinal(vd)} no dia)${q?.p > 0 ? "" : " · fechamento de " + dataBR(a.data || "")}`];
    if (classe === "acoes") {
      const f = a.preco ? p / a.preco : 1, b = barsi({ ...a, preco: p }, est.alvo);
      L.push("", `${a.setor}`, `P/L ${nf(a.pl * f, 1)} · P/VP ${nf(a.pvp * f, 2)} · DY 12m ${pct(a.dy / f)}`, `ROE ${pct(a.roe)} · Margem ${pct(a.ml)}${a.fin ? "" : " · Dív.líq/EBITDA " + nf(a.dle, 1) + "x"}`);
      L.push("", `Preço-teto ${R$(b.teto)} (DY ${pct(est.alvo, 0)})${b.desconto != null ? ` — ${pct(Math.abs(b.desconto), 0)} ${b.desconto >= 0 ? "abaixo" : "acima"} do teto` : ""}`, b.ok ? "✅ Passa em todos os critérios do Barsi" : "Barsi: não passa em todos os critérios (/teto " + a.t + ")");
    } else if (classe === "fiis") {
      L.push("", `${a.seg || "FII"} · DY 12m ${pct(a.dy)} · P/VP ${nf(a.pvp, 2)}`, a.ult_prov ? `Último rendimento: R$ ${nf(a.ult_prov.v, 4)} em ${dataBR(a.ult_prov.d)}` : "");
    }
    if (a.max52 && a.min52) L.push(`Faixa de 52 semanas: ${fmt(a.min52)} a ${fmt(a.max52)}`);
    if (a.r12 != null) L.push(`12 meses: ${sinal(a.r12, 1)}${a.rt12 != null ? ` (com proventos ${sinal(a.rt12, 1)})` : ""}`);
    else if (a.var12 != null) L.push(`12 meses: ${sinal(a.var12, 1)}${a.rt12 != null ? ` (com proventos ${sinal(a.rt12, 1)})` : ""}`);
    L.push("", `${SITE}${classe === "acoes" ? "acao.html?t=" + a.t : `ativo.html?c=${classe}&t=${encodeURIComponent(a.t)}`}`);
    return L.filter(l => l !== undefined).join("\n");
  }

  async function cmdTeto(arg, est) {
    const x = arg ? await achar(arg) : null;
    if (!x || x.classe !== "acoes") return "Mande o código de uma ação, por exemplo: /teto BBAS3";
    const a = x.a, q = (await precos([x.sym]))[x.sym], p = q?.p > 0 ? q.p : a.preco, b = barsi({ ...a, preco: p }, est.alvo), c = b.crit;
    const s = v => v === true ? "✅" : v === false ? "❌" : "➖";
    return [`${a.t} — método Barsi (DY desejado ${pct(est.alvo, 1)})`, "",
      `Cotação ${R$(p)} · preço-teto ${R$(b.teto)}`, `Média de proventos de 5 anos: ${R$(a.pm5)} por ação`, "",
      `${s(c.best)} Setor perene (BEST)`, `${s(c.reg)} Proventos regulares${a.regb ? ` (${a.reg} de ${a.regb} anos)` : ""}`, `${s(c.teto)} Abaixo do preço-teto`,
      `${s(c.lucro)} Lucro consistente`, `${s(c.payout)} Payout sustentável`, `${s(c.divida)} Dívida controlada`, "",
      b.ok ? "Resultado: passa em todos os critérios." : "Resultado: não passa em todos os critérios.", "➖ = sem dado para conferir"].join("\n");
  }

  async function cmdBarsi(est) {
    const d = await site("dados.json");
    const syms = d.acoes.filter(a => a.best && a.pm5 > 0).map(a => a.t + ".SA");
    const q = await precos(syms);
    const lista = d.acoes.filter(a => a.best && a.pm5 > 0).map(a => { const p = q[a.t + ".SA"]?.p > 0 ? q[a.t + ".SA"].p : a.preco; return { a, p, b: barsi({ ...a, preco: p }, est.alvo) }; })
      .filter(x => x.b.ok).sort((x, y) => y.b.desconto - x.b.desconto);
    if (!lista.length) return `Nenhuma ação passa em todos os critérios com DY desejado de ${pct(est.alvo, 1)}. Experimente /dy 5`;
    return [`✅ ${lista.length} ações passam no método Barsi (DY ${pct(est.alvo, 1)})`, "",
      ...lista.slice(0, 15).map((x, i) => `${i + 1}. ${x.a.t} ${R$(x.p)} · teto ${R$(x.b.teto)} (${pct(x.b.desconto, 0)} abaixo) · DY 5a ${pct(x.a.pm5 / x.p)}`),
      lista.length > 15 ? `\n…e mais ${lista.length - 15}. Lista completa: ${SITE}` : ""].join("\n");
  }

  async function cmdProventos(arg) {
    const x = arg ? await achar(arg) : null;
    if (!x) return "Mande o código, por exemplo: /proventos TAEE11";
    const pv = (await site("mercado/proventos.json")).itens?.[x.a.t] || [];
    const hoje = new Date().toISOString().slice(0, 10), ano = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
    const fut = pv.filter(p => (p[1] || p[0]) >= hoje).sort((a, b) => (a[1] || a[0]).localeCompare(b[1] || b[0]));
    const pagos = pv.filter(p => p[1] && p[1] < hoje && p[1] >= ano);
    const soma = pagos.reduce((s, p) => s + (p[2] || 0), 0);
    return [`💰 ${x.a.t} — proventos`, "", fut.length ? "Anunciados:" : "Nenhum pagamento futuro anunciado na B3.",
      ...fut.slice(0, 8).map(p => `• ${p[3] || "Provento"} R$ ${nf(p[2], 4)} — data com ${dataBR(p[0])}, paga ${p[1] ? dataBR(p[1]) : "a definir"}`),
      "", `Pagos nos últimos 12 meses: R$ ${nf(soma, 2)} por ação${pagos.length ? ` (${pagos.length} pagamentos)` : ""}`].join("\n");
  }

  async function cmdAgenda(dias = 7, minImp = 2, titulo) {
    const ag = await site("mercado/agenda.json");
    const hoje = new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10), fim = new Date(Date.now() - 3 * 36e5 + dias * 864e5).toISOString().slice(0, 10);
    const ev = (ag.eventos || []).filter(e => e.d >= hoje && e.d <= fim && (e.imp || 1) >= minImp);
    if (!ev.length) return dias === 1 ? "🗓️ Nenhum evento importante hoje." : "Nenhum evento importante nos próximos dias.";
    const L = [titulo || `🗓️ Agenda — próximos ${dias} dias (horário de Brasília)`]; let dia = "";
    for (const e of ev) {
      if (e.d !== dia) { dia = e.d; const d = new Date(e.d + "T12:00:00Z"); L.push("", `${["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][d.getUTCDay()]}, ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`); }
      L.push(`${e.imp === 3 ? "🔴" : "🟠"} ${e.h || "--:--"} ${e.pais === "EUA" ? "🇺🇸" : "🇧🇷"} ${e.n}${e.prev ? ` (prev. ${e.prev})` : ""}`);
    }
    return L.join("\n");
  }

  async function cmdMercado() {
    const itens = [["Ibovespa", "^BVSP", "pts"], ["Dólar", "USDBRL=X", "R$"], ["Euro", "EURBRL=X", "R$"], ["S&P 500", "^GSPC", "pts"], ["Nasdaq", "^IXIC", "pts"], ["Petróleo Brent", "BZ=F", "US$"], ["Ouro", "GC=F", "US$"], ["Bitcoin", "BTC-USD", "US$"]];
    const q = await precos(itens.map(i => i[1]));
    const L = ["📊 Mercado agora", ""];
    for (const [n, s, u] of itens) { const x = q[s]; if (!x?.p) continue; const v = x.pc ? x.p / x.pc - 1 : null; L.push(`${v == null ? "•" : v >= 0 ? "🟢" : "🔴"} ${n}: ${u === "pts" ? nf(x.p, 0) + " pts" : u + " " + nf(x.p, u === "R$" ? 4 : 2)} (${sinal(v)})`); }
    try { const rf = await site("mercado/rendafixa.json"); if (rf.selic_meta != null) L.push("", `Selic ${nf(rf.selic_meta, 2)}% · CDI ${nf(rf.cdi, 2)}% · IPCA 12m ${nf(rf.ipca12, 2)}%`); } catch (e) {}
    return L.join("\n");
  }

  async function cmdAlerta(arg, est) {
    const m = /^(\S+)\s+(.+)$/.exec(arg || "");
    if (!m) return "Exemplos:\n/alerta BBAS3 15,50\n/alerta BBAS3 -5%\n/alerta BBAS3 teto";
    const x = await achar(m[1]);
    if (!x || !x.sym) return `Não achei "${m[1]}" ou ele não tem cotação ao vivo.`;
    const q = (await precos([x.sym]))[x.sym], agora = q?.p > 0 ? q.p : x.a.preco;
    let alvo, resto = m[2].trim(), nota = "";
    const pc = /^([+-]\d+(?:[.,]\d+)?)\s*%\s*(.*)$/.exec(resto);
    if (pc) { alvo = agora * (1 + parseFloat(pc[1].replace(",", ".")) / 100); nota = pc[2]; }
    else if (/^teto\b/i.test(resto)) {
      if (x.classe !== "acoes") return "Preço-teto só existe para ações.";
      alvo = barsi(x.a, est.alvo).teto; nota = "chegou ao preço-teto (Barsi)" + resto.slice(4);
      if (!alvo) return "Essa ação não tem preço-teto (faltam proventos de 5 anos).";
      if (agora <= alvo) return `${x.a.t} já está abaixo do preço-teto (cotação ${nf(agora)}, teto ${nf(alvo)}). Veja /teto ${x.a.t}`;
    } else {
      const v = /^([\d.]+(?:,\d+)?|\d+(?:\.\d+)?)\s*(.*)$/.exec(resto);
      if (!v) return "Não entendi o preço. Exemplo: /alerta BBAS3 15,50";
      const s = v[1]; alvo = parseFloat(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s); nota = v[2];
    }
    if (!(alvo > 0)) return "Preço inválido.";
    const cond = alvo >= agora ? ">=" : "<=";
    est.alertas = (est.alertas || []).slice(-39);
    est.alertas.push({ id: Date.now().toString(36), t: x.a.t, sym: x.sym, cond, p: +alvo.toFixed(alvo < 1 ? 4 : 2), nota: nota.trim().slice(0, 80) });
    await salvar(est);
    return `🔔 Alerta criado: ${x.a.t} ${cond === ">=" ? "subir a" : "cair a"} ${nf(alvo, alvo < 1 ? 4 : 2)} (agora ${nf(agora, agora < 1 ? 4 : 2)}).\nConfiro a cada 5 minutos, de segunda a sexta, das 9h às 19h.`;
  }

  function listaAlertas(est) {
    const l = est.alertas || [];
    if (!l.length) return { texto: "Nenhum alerta ligado. Crie com /alerta BBAS3 15,50" };
    return { texto: "🔔 Alertas ligados (toque para apagar):\n\n" + l.map((a, i) => `${i + 1}. ${a.t} ${a.cond === ">=" ? "acima de" : "abaixo de"} ${nf(a.p, a.p < 1 ? 4 : 2)}${a.nota ? " · " + a.nota : ""}`).join("\n"),
      extra: { reply_markup: { inline_keyboard: l.map((a, i) => [{ text: `🗑 ${i + 1}. ${a.t} ${nf(a.p, a.p < 1 ? 4 : 2)}`, callback_data: "del:" + a.id }]) } } };
  }

  async function cmdSeguir(arg, est) {
    const pedidos = String(arg || "").split(/[\s,;]+/).filter(Boolean).slice(0, 15);
    if (!pedidos.length) return "Mande os códigos, por exemplo: /seguir BBAS3 TAEE11 ITSA4";
    const ok = [], nao = [];
    for (const p of pedidos) { const x = await achar(p); if (x) { if (!est.seguindo.includes(x.a.t)) est.seguindo.push(x.a.t); ok.push(x.a.t); } else nao.push(p); }
    est.seguindo = est.seguindo.slice(-40); await salvar(est);
    return (ok.length ? `⭐ Seguindo: ${ok.join(", ")}.\nAviso na véspera e no dia da data com, no dia do pagamento e quando entrarem ou saírem do Barsi.` : "") + (nao.length ? `\nNão achei: ${nao.join(", ")}` : "");
  }
  function cmdSeguindo(est) {
    return est.seguindo.length ? `⭐ Você segue ${est.seguindo.length}: ${est.seguindo.join(", ")}\n\n/seguir BBAS3 para incluir · /deixar BBAS3 para tirar` : "Você não segue nenhuma ação ainda. Exemplo: /seguir BBAS3 TAEE11";
  }
  async function cmdLigar(est) {
    if (!est.canalSite) {
      const al = "abcdefghijklmnopqrstuvwxyz0123456789", r = crypto.getRandomValues(new Uint8Array(24));
      est.canalSite = "radarb3-" + [...r].map(x => al[x % al.length]).join(""); await salvar(est);
      await KV.put("tg:canal", est.canalSite);
    }
    return `🔗 Para os avisos do site chegarem aqui:\n\n1. Abra o Radar B3 → Carteira → 🔔 Avisos de preço\n2. Toque em "Já tenho um código" e cole:\n\n${est.canalSite}\n\nDá para usar o mesmo código no computador e no celular. Não compartilhe com ninguém.`;
  }

  // proventos das ações seguidas: véspera e dia da data com, dia do pagamento (dias úteis)
  async function lembretesProventos(est, hoje) {
    if (!est.seguindo.length) return [];
    const pv = (await site("mercado/proventos.json")).itens || {};
    const util = d => { const x = new Date(d + "T12:00:00Z"); do x.setUTCDate(x.getUTCDate() + 1); while ([0, 6].includes(x.getUTCDay())); return x.toISOString().slice(0, 10); };
    const amanha = util(hoje), L = [];
    for (const t of new Set(est.seguindo)) for (const [dc, pg, v, tipo] of pv[t] || []) {
      const val = `${tipo || "provento"} de R$ ${nf(v, 4)}`;
      if (dc === hoje) L.push(`📌 ${t}: HOJE é a data com (${val}). Quem tiver a ação no fechamento de hoje recebe${pg ? " em " + dataBR(pg) : ""}.`);
      else if (dc === amanha) L.push(`📌 ${t}: amanhã (${dataBR(dc)}) é a data com (${val}).`);
      if (pg === hoje) L.push(`💰 ${t}: pagamento hoje (${val} por ação).`);
    }
    return L;
  }
  // entrou ou saiu do Barsi (pelo fechamento do dia anterior, para não oscilar durante o pregão)
  async function mudancasBarsi(est) {
    const d = await site("dados.json");
    const agora = d.acoes.filter(a => barsi(a, est.alvo).ok).map(a => a.t).sort();
    const antes = est.barsiOk;
    est.barsiOk = agora;
    if (!antes) return [];
    const entrou = agora.filter(t => !antes.includes(t)), saiu = antes.filter(t => !agora.includes(t));
    const marca = t => est.seguindo.includes(t) ? "⭐" : "";
    const L = [];
    if (entrou.length) L.push(`✅ Entraram no Barsi: ${entrou.map(t => marca(t) + t).join(", ")}`);
    if (saiu.length) L.push(`❌ Saíram do Barsi: ${saiu.map(t => marca(t) + t).join(", ")}`);
    return L;
  }

  // ---------------------------------------------------------------- convidados
  function cmdConvidar(est) {
    const al = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", r = crypto.getRandomValues(new Uint8Array(8));
    const codigo = [...r].map(x => al[x % al.length]).join("");
    est.convites = (est.convites || []).filter(c => c.ate > Date.now()).slice(-9);
    est.convites.push({ codigo, ate: Date.now() + 24 * 36e5 });
    return `👥 Convite criado (vale 24 horas e uma única pessoa). Mande este link para a pessoa:\n\nhttps://t.me/GeffMB_bot?start=${codigo}\n\nEla abre o link e toca em Iniciar. (Ou, dentro do bot, envia /entrar ${codigo})\n\nEla poderá consultar cotações, Barsi, proventos, agenda e mercado. Seus alertas, ações seguidas e códigos continuam só seus.`;
  }
  function listaConvidados(est) {
    const l = est.convidados || [];
    if (!l.length) return { texto: "Nenhum convidado. Crie um convite com /convidar" };
    return { texto: "👥 Convidados:\n\n" + l.map((c, i) => `${i + 1}. ${c.nome || "sem nome"} — desde ${dataBR(c.desde)} · resumo e lembretes ${c.avisos ? "ligados" : "desligados"}`).join("\n"),
      extra: { reply_markup: { inline_keyboard: l.map((c, i) => [{ text: `${c.avisos ? "🔕 Desligar" : "🔔 Ligar"} avisos ${i + 1}`, callback_data: "cav:" + c.chat }, { text: `🗑 Remover ${i + 1}`, callback_data: "crm:" + c.chat }]) } } };
  }
  async function entrar(chat, de, arg, est) {
    const cod = String(arg || "").trim().toUpperCase();
    const c = (est.convites || []).find(x => x.codigo === cod && x.ate > Date.now());
    if (!c) return enviar(chat, "Este bot é privado. Se você recebeu um convite, envie /entrar seguido do código (ele vale 24 horas).");
    const nome = [de?.first_name, de?.last_name].filter(Boolean).join(" ") || (de?.username ? "@" + de.username : "");
    est.convites = est.convites.filter(x => x !== c);
    est.convidados = (est.convidados || []).filter(x => String(x.chat) !== String(chat)).concat([{ chat, nome, desde: new Date().toISOString().slice(0, 10), avisos: false }]).slice(-10);
    await salvar(est);
    await enviar(chat, "✅ Bem-vindo! Você agora pode usar o bot do Radar B3.\n\n" + AJUDA_CONVIDADO, TECLADO_CONVIDADO);
    await enviar(est.chat, `👥 ${nome || "Alguém"} entrou com o seu convite. /convidados para ligar o resumo das 8h30 e os lembretes para essa pessoa, ou para remover.`);
  }

  // ---------------------------------------------------------------- entrada
  async function atender(upd) {
    let est = await estado();
    const cq = upd.callback_query, msg = upd.message || cq?.message, chat = msg?.chat?.id;
    if (!chat) return;
    if (!est.chat) {    // primeira conversa: quem mandar a primeira mensagem vira o dono do bot
      est.chat = chat; await salvar(est);
      await enviar(chat, "✅ Pronto! Este bot agora responde só para você.\n\n" + AJUDA.replace("%DY%", pct(est.alvo, 0)), TECLADO);
      return;
    }
    const dono = String(chat) === String(est.chat);
    const convidado = !dono && (est.convidados || []).some(c => String(c.chat) === String(chat));
    if (!dono && !convidado) {
      // desconhecido: só aceita /entrar CÓDIGO (e responde a /start explicando)
      const t = (msg.text || "").trim(), m = /^\/(entrar|start)(?:@\S+)?\s*(.*)$/i.exec(t);
      if (m && (m[1].toLowerCase() === "entrar" || m[2])) return entrar(chat, msg.from, m[2], est);   // /start CÓDIGO vem do link de convite
      if (m) return enviar(chat, "Este bot é privado. Se você recebeu um convite, envie /entrar seguido do código.");
      return;
    }
    if (cq) {
      await api("answerCallbackQuery", { callback_query_id: cq.id });
      if (!dono) return;
      const alvoC = cq.data?.slice(4);
      if (cq.data?.startsWith("cav:")) { const c = est.convidados.find(x => String(x.chat) === alvoC); if (c) { c.avisos = !c.avisos; await salvar(est); await enviar(c.chat, c.avisos ? "☀️ O dono do bot ligou para você o resumo das 8h30 e os lembretes de eventos." : "O resumo das 8h30 e os lembretes foram desligados para você."); } const r = listaConvidados(est); return enviar(chat, r.texto, r.extra || {}); }
      if (cq.data?.startsWith("crm:")) { const c = est.convidados.find(x => String(x.chat) === alvoC); est.convidados = est.convidados.filter(x => String(x.chat) !== alvoC); await salvar(est); if (c) await enviar(c.chat, "Seu acesso ao bot do Radar B3 foi encerrado pelo dono.").catch(() => {}); const r = listaConvidados(est); return enviar(chat, "Removido. " + r.texto, r.extra || {}); }
      if (cq.data?.startsWith("del:")) { est.alertas = (est.alertas || []).filter(a => a.id !== cq.data.slice(4)); await salvar(est); const r = listaAlertas(est); await enviar(chat, "Apagado. " + r.texto, r.extra || {}); }
      return;
    }
    const txt = (msg.text || "").trim();
    if (!txt) return;
    let [, cmd, arg] = /^\/?([^\s@]+)(?:@\S+)?\s*(.*)$/s.exec(txt) || [];
    cmd = sem(cmd).toLowerCase();
    let resp;
    try {
      const soDono = ["alerta", "alertas", "dy", "seguir", "seguindo", "deixar", "ligar", "lembretes", "resumo", "convidar", "convidados"];
      if (convidado && (cmd === "start" || cmd === "ajuda" || cmd === "help")) return enviar(chat, AJUDA_CONVIDADO, TECLADO_CONVIDADO);
      if (convidado && soDono.includes(cmd)) return enviar(chat, "Esse comando é só do dono do bot. Envie /ajuda para ver o que você pode usar.");
      if (cmd === "start" || cmd === "ajuda" || cmd === "help") return enviar(chat, AJUDA.replace("%DY%", pct(est.alvo, 0)), TECLADO);
      else if (cmd === "convidar") { resp = cmdConvidar(est); await salvar(est); }
      else if (cmd === "convidados" || cmd === "remover") { const r = listaConvidados(est); return enviar(chat, r.texto, r.extra || {}); }
      else if (cmd === "entrar") resp = "Você já tem acesso ao bot.";
      else if (cmd === "preco" || cmd === "cotacao") resp = await cmdPreco(arg, est);
      else if (cmd === "teto") resp = await cmdTeto(arg, est);
      else if (cmd === "barsi") resp = await cmdBarsi(est);
      else if (cmd === "proventos" || cmd === "dividendos") resp = await cmdProventos(arg);
      else if (cmd === "agenda") resp = await cmdAgenda(7, 2);
      else if (cmd === "mercado") resp = await cmdMercado();
      else if (cmd === "alerta") resp = await cmdAlerta(arg, est);
      else if (cmd === "alertas") { const r = listaAlertas(est); return enviar(chat, r.texto, r.extra || {}); }
      else if (cmd === "dy") { const v = parseFloat(String(arg).replace(",", ".")); if (!(v >= 1 && v <= 30)) resp = `DY desejado agora: ${pct(est.alvo, 1)}. Para mudar: /dy 7`; else { est.alvo = v / 100; await salvar(est); resp = `DY desejado: ${pct(est.alvo, 1)}. O preço-teto agora usa esse valor.`; } }
      else if (cmd === "seguir") resp = await cmdSeguir(arg, est);
      else if (cmd === "seguindo") resp = cmdSeguindo(est);
      else if (cmd === "deixar") { const t = sem(arg).replace(/[^A-Z0-9]/g, ""); const antes = est.seguindo.length; est.seguindo = est.seguindo.filter(x => x !== t); await salvar(est); resp = est.seguindo.length < antes ? `Deixou de seguir ${t}.` : `Você não seguia "${arg}". /seguindo mostra a lista.`; }
      else if (cmd === "ligar") resp = await cmdLigar(est);
      else if (cmd === "lembretes") { est.lembretes = !est.lembretes; await salvar(est); resp = est.lembretes ? "⏰ Lembretes 30 min antes de eventos de alto impacto: ligados." : "Lembretes de eventos desligados."; }
      else if (cmd === "resumo") { est.resumo = !est.resumo; await salvar(est); resp = est.resumo ? "☀️ Resumo das 8h30 ligado (dias úteis)." : "Resumo das 8h30 desligado."; }
      else if (!txt.startsWith("/") && /^[A-Za-z0-9]{4,7}$/.test(txt)) resp = await cmdPreco(txt, est);   // só o código: mostra a cotação
      else resp = "Não entendi. Envie /ajuda para ver os comandos.";
    } catch (e) { resp = "⚠️ Não consegui responder agora (" + e.message + "). Tente de novo em 1 minuto."; }
    await enviar(chat, resp);
  }

  // a cada 5 minutos (cron): alertas; às 8h30 dos dias úteis: resumo
  async function automaticos(quando) {
    const est = await estado();
    if (!est.chat) return;
    const l = est.alertas || [];
    if (l.length) {
      const q = await precos(l.map(a => a.sym));
      const ficam = [];
      for (const a of l) {
        const p = q[a.sym]?.p;
        if (p > 0 && (a.cond === ">=" ? p >= a.p : p <= a.p)) await enviar(est.chat, `🔔 ${a.t} ${a.cond === ">=" ? "subiu a" : "caiu a"} ${nf(p, p < 1 ? 4 : 2)} (alerta: ${a.cond === ">=" ? "acima de" : "abaixo de"} ${nf(a.p, a.p < 1 ? 4 : 2)})${a.nota ? "\n" + a.nota : ""}`);
        else ficam.push(a);
      }
      if (ficam.length !== l.length) { est.alertas = ficam; await salvar(est); }
    }
    const br = new Date(quando - 3 * 36e5), hm = br.getUTCHours() * 60 + br.getUTCMinutes(), hoje = br.toISOString().slice(0, 10);
    // lembrete 30 minutos antes dos eventos de alto impacto
    if (est.lembretes) {
      try {
        const ag = await site("mercado/agenda.json");
        const vistos = new Set((est.lembrados || []).filter(k => k.startsWith(hoje)));
        for (const e of (ag.eventos || []).filter(e => e.d === hoje && (e.imp || 1) >= 3 && e.h)) {
          const [hh, mm] = e.h.split(":").map(Number), falta = hh * 60 + mm - hm, k = `${hoje} ${e.h} ${e.n}`;
          if (falta > 0 && falta <= 35 && !vistos.has(k)) {
            vistos.add(k);
            const txtLem = `⏰ Em ${falta} min (${e.h}): ${e.pais === "EUA" ? "🇺🇸" : "🇧🇷"} ${e.n}${e.prev ? `\nPrevisão: ${e.prev}${e.ant ? " · anterior: " + e.ant : ""}` : ""}`;
            await enviar(est.chat, txtLem);
            for (const c of (est.convidados || []).filter(c => c.avisos)) await enviar(c.chat, txtLem).catch(() => {});
          }
        }
        if (vistos.size !== (est.lembrados || []).filter(k => k.startsWith(hoje)).length) { est.lembrados = [...vistos]; await salvar(est); }
      } catch (e) { console.log("lembretes:", e.message); }
    }
    if (hm >= 510 && hm < 520 && est.ultimoResumo !== hoje) {     // 8h30–8h39
      est.ultimoResumo = hoje;
      let barsiTxt = [], provTxt = [];
      try { barsiTxt = await mudancasBarsi(est); } catch (e) {}
      try { provTxt = await lembretesProventos(est, hoje); } catch (e) {}
      await salvar(est);
      if (est.resumo) {
        const partes = [`☀️ Bom dia! Resumo de ${dataBR(hoje)}`];
        try { partes.push(await cmdMercado()); } catch (e) {}
        try { partes.push(await cmdAgenda(1, 2, "🗓️ Agenda de hoje (horário de Brasília)")); } catch (e) {}
        if (provTxt.length) partes.push(provTxt.join("\n"));
        if (barsiTxt.length) partes.push(barsiTxt.join("\n") + "\n/barsi para a lista completa");
        // convidados com avisos ligados recebem a parte geral (sem alertas nem ações seguidas do dono)
        const geral = partes.filter(x => !provTxt.length || x !== provTxt.join("\n")).map(x => x.replace(/⭐/g, ""));
        for (const c of (est.convidados || []).filter(c => c.avisos)) await enviar(c.chat, geral.join("\n\n")).catch(() => {});
        if (est.alertas.length) partes.push(`🔔 ${est.alertas.length} alerta(s) ligado(s). /alertas`);
        await enviar(est.chat, partes.join("\n\n"));
      } else if (provTxt.length || barsiTxt.length) await enviar(est.chat, [...provTxt, ...barsiTxt].join("\n\n"));
    }
  }

  // avisos do site cujo código foi ligado a este bot (/ligar) também chegam aqui
  async function avisoDoSite(topico, texto) {
    const est = await estado();
    if (!est.chat || !est.canalSite || topico !== est.canalSite) return false;
    await enviar(est.chat, "🔔 " + texto);
    return true;
  }

  return { atender, automaticos, avisoDoSite };
}
