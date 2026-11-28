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
  const estado = async () => (await KV.get("tg:estado", "json")) || { chat: null, alvo: 0.06, resumo: true, alertas: [] };
  const salvar = e => KV.put("tg:estado", JSON.stringify(e));
  const precos = async syms => { const out = {}; const l = [...new Set(syms.filter(Boolean))]; for (let i = 0; i < l.length; i += 20) Object.assign(out, await buscarLote(l.slice(i, i + 20).sort())); return out; };

  async function enviar(chat, texto, extra = {}) {
    // o Telegram aceita até 4.096 caracteres por mensagem: divide nos parágrafos
    const partes = []; let atual = "";
    for (const bloco of texto.split("\n\n")) { if ((atual + "\n\n" + bloco).length > 3800 && atual) { partes.push(atual); atual = bloco; } else atual = atual ? atual + "\n\n" + bloco : bloco; }
    if (atual) partes.push(atual);
    for (let i = 0; i < partes.length; i++) await api("sendMessage", { chat_id: chat, text: partes[i], disable_web_page_preview: true, ...(i === partes.length - 1 ? extra : {}) });
  }

  const TECLADO = { reply_markup: { keyboard: [["/mercado", "/barsi"], ["/agenda", "/alertas"], ["/ajuda"]], resize_keyboard: true, is_persistent: true } };
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

☀️ /resumo — liga ou desliga o resumo das 8h30 (agenda do dia e mercado)

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
    if (String(chat) !== String(est.chat)) return;
    if (cq) {
      await api("answerCallbackQuery", { callback_query_id: cq.id });
      if (cq.data?.startsWith("del:")) { est.alertas = (est.alertas || []).filter(a => a.id !== cq.data.slice(4)); await salvar(est); const r = listaAlertas(est); await enviar(chat, "Apagado. " + r.texto, r.extra || {}); }
      return;
    }
    const txt = (msg.text || "").trim();
    if (!txt) return;
    let [, cmd, arg] = /^\/?([^\s@]+)(?:@\S+)?\s*(.*)$/s.exec(txt) || [];
    cmd = sem(cmd).toLowerCase();
    let resp;
    try {
      if (cmd === "start" || cmd === "ajuda" || cmd === "help") return enviar(chat, AJUDA.replace("%DY%", pct(est.alvo, 0)), TECLADO);
      else if (cmd === "preco" || cmd === "cotacao") resp = await cmdPreco(arg, est);
      else if (cmd === "teto") resp = await cmdTeto(arg, est);
      else if (cmd === "barsi") resp = await cmdBarsi(est);
      else if (cmd === "proventos" || cmd === "dividendos") resp = await cmdProventos(arg);
      else if (cmd === "agenda") resp = await cmdAgenda(7, 2);
      else if (cmd === "mercado") resp = await cmdMercado();
      else if (cmd === "alerta") resp = await cmdAlerta(arg, est);
      else if (cmd === "alertas") { const r = listaAlertas(est); return enviar(chat, r.texto, r.extra || {}); }
      else if (cmd === "dy") { const v = parseFloat(String(arg).replace(",", ".")); if (!(v >= 1 && v <= 30)) resp = `DY desejado agora: ${pct(est.alvo, 1)}. Para mudar: /dy 7`; else { est.alvo = v / 100; await salvar(est); resp = `DY desejado: ${pct(est.alvo, 1)}. O preço-teto agora usa esse valor.`; } }
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
    if (est.resumo && hm >= 510 && hm < 520 && est.ultimoResumo !== hoje) {     // 8h30–8h39
      est.ultimoResumo = hoje; await salvar(est);
      const partes = [`☀️ Bom dia! Resumo de ${dataBR(hoje)}`];
      try { partes.push(await cmdMercado()); } catch (e) {}
      try { partes.push(await cmdAgenda(1, 2, "🗓️ Agenda de hoje (horário de Brasília)")); } catch (e) {}
      if (l.length) partes.push(`🔔 ${est.alertas.length} alerta(s) ligado(s). /alertas`);
      await enviar(est.chat, partes.join("\n\n"));
    }
  }

  return { atender, automaticos };
}
