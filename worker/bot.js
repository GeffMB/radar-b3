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
  const palavras = q.split(/\s+/).filter(w => w.length >= 3);
  let it = busca.find(x => sem(x[0]) === qt) || busca.find(x => sem(x[0]).startsWith(qt) && qt.length >= 4)
    || busca.find(x => sem(x[1]).startsWith(q)) || busca.find(x => (" " + sem(x[1])).includes(" " + q))
    || (palavras.length ? busca.find(x => { const n = " " + sem(x[1]) + " "; return palavras.every(w => n.includes(" " + w)); }) : null);
  if (!it) return null;
  const [t, , classe] = it;
  if (classe === "acoes") { const d = await site("dados.json"); const a = d.acoes.find(x => x.t === t); return a ? { classe, a, sym: t + ".SA" } : null; }
  const d = await site(`mercado/${classe}.json`);
  const a = (d.itens || []).find(x => x.t === t);
  if (!a) return null;
  const sym = ["fiis", "etfs", "bdrs"].includes(classe) ? t + ".SA" : classe === "stocks" ? t : a.y || null;
  return { classe, a, sym };
}

// ---------------------------------------------------------------- notícias (Google Notícias, só manchete, fonte e link)
const desescapar = t => String(t || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).trim();
const nomeCurto = n => String(n || "").replace(/\s+(ON|PN|PNA|PNB|PNC|PND|UNT|UNIT|Unit|ON NM|PN N1|PN N2|NM|N1|N2|ED|EJ|ATZ|DR\d)\b.*$/i, "").trim();
const MEMO_NOT = new Map();
export async function buscarNoticias(t, nome, classe, dias = 3) {
  const chave = t + "|" + dias, m = MEMO_NOT.get(chave);
  if (m && m.ate > Date.now()) return m.itens;
  const n = classe === "acoes" ? nomeCurto(nome) : "";
  const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36", "Accept-Language": "pt-BR,pt;q=0.9" };
  const ler = (xml, fonteTag) => {
    const itens = [];
    for (const bloco of xml.split("<item>").slice(1)) {
      const tag = k => desescapar((new RegExp(`<${k}[^>]*>([\\s\\S]*?)</${k}>`).exec(bloco) || [])[1]);
      let link = tag("link"), fonte = tag(fonteTag), titulo = tag("title");
      const real = /[?&]url=([^&]+)/.exec(link);                 // o Bing embrulha o link: usa o endereço original
      if (real) { try { link = decodeURIComponent(real[1]); } catch (e) {} }
      if (fonte) titulo = titulo.replace(new RegExp("\\s+-\\s+" + fonte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"), "");
      const quando = Date.parse(tag("pubDate"));
      if (titulo && link) itens.push({ id: (tag("guid") || link).slice(-24), titulo, fonte, link, quando });
    }
    return itens;
  };
  let itens = [];
  // 1º Bing Notícias (responde ao servidor do site); 2º Google Notícias (às vezes bloqueia servidores em nuvem)
  try {
    const q = `"${t}"` + (n && n.length >= 4 ? ` OR "${n}"` : "");
    const r = await fetch(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setlang=pt-br&cc=BR&qft=${encodeURIComponent('sortbydate="1"')}`, { headers: UA, signal: AbortSignal.timeout(12000) });
    if (r.ok) itens = ler(await r.text(), "News:Source");
  } catch (e) {}
  if (!itens.length) {
    try {
      const q = `"${t}"` + (n && n.length >= 4 ? ` OR "${n}"` : "") + ` when:${dias}d`;
      const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`, { headers: UA, signal: AbortSignal.timeout(12000) });
      if (r.ok) itens = ler(await r.text(), "source");
    } catch (e) {}
  }
  const limite = Date.now() - dias * 864e5;
  itens = itens.filter(x => !x.quando || x.quando >= limite).sort((a, b) => (b.quando || 0) - (a.quando || 0));
  MEMO_NOT.set(chave, { itens, ate: Date.now() + 10 * 60e3 });
  return itens;
}
const quandoBR = ms => { const d = new Date(ms - 3 * 36e5); return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };

// ---------------------------------------------------------------- conversa com o Telegram
export function criarBot(env, ctx, buscarLote) {
  const token = env.TELEGRAM_TOKEN;
  const KV = env.LIMITES;
  const api = async (metodo, corpo) => {
    const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(15000) });
    return r.json();
  };
  const estado = async () => ({ chat: null, alvo: 0.06, resumo: true, lembretes: true, alertas: [], seguindo: [], variacao: 5, noticias: true, convidados: [], convites: [], ...((await KV.get("tg:estado", "json")) || {}) });
  // cada pessoa tem seus próprios alertas, ações seguidas e ajustes: o dono em "tg:estado", convidados em "tg:u:<chat>"
  const salvar = e => KV.put(e._k || "tg:estado", JSON.stringify(e));
  const PADRAO_U = { alvo: 0.06, resumo: true, lembretes: true, alertas: [], seguindo: [], variacao: 5, noticias: true, simples: true };
  const perfil = async chat => ({ ...PADRAO_U, ...((await KV.get("tg:u:" + chat, "json")) || {}), _k: "tg:u:" + chat, chat });
  const precos = async syms => { const out = {}; const l = [...new Set(syms.filter(Boolean))]; for (let i = 0; i < l.length; i += 20) Object.assign(out, await buscarLote(l.slice(i, i + 20).sort())); return out; };

  async function enviar(chat, texto, extra = {}) {
    // o Telegram aceita até 4.096 caracteres por mensagem: divide nos parágrafos
    const partes = []; let atual = "";
    for (const bloco of texto.split("\n\n")) { if ((atual + "\n\n" + bloco).length > 3800 && atual) { partes.push(atual); atual = bloco; } else atual = atual ? atual + "\n\n" + bloco : bloco; }
    if (atual) partes.push(atual);
    for (let i = 0; i < partes.length; i++) await api("sendMessage", { chat_id: chat, text: partes[i], disable_web_page_preview: true, ...(i === partes.length - 1 ? extra : {}) });
  }

  const AJUDA_CONVIDADO = `📈 Radar B3 no Telegram

/preco BBAS3 — cotação ao vivo e indicadores (ação, FII, ETF, BDR, stock, índice, moeda ou commodity)
/barsi — ações que passam no método Barsi agora
/teto BBAS3 — preço-teto e critérios do Barsi
/dy 7 — muda o DY desejado do preço-teto (agora em %DY%)
/proventos BBAS3 — próximos pagamentos e últimos 12 meses
/agenda — eventos importantes dos próximos 7 dias
/mercado — Ibovespa, dólar, S&P 500, petróleo, ouro e juros

🔔 Alertas de preço (conferidos a cada 5 min no pregão)
/alerta BBAS3 15,50 · /alerta BBAS3 -5% · /alerta BBAS3 teto
/alertas — lista e apaga

⭐ /seguir BBAS3 TAEE11 — lembretes de proventos, Barsi, variação forte e notícias
/seguindo — painel · /deixar BBAS3 · /variacao 5
📰 /noticias BBAS3 — últimas notícias

☀️ /resumo — liga ou desliga o resumo das 8h30
⏰ /lembretes — liga ou desliga o aviso 30 min antes de Copom, IPCA, payroll e Fed

Seus alertas e ações seguidas são só seus.
Dica: dá para mandar só o código, por exemplo "PETR4".
Material de estudo, não é recomendação de investimento.`;
  const TECLADO_CONVIDADO = { reply_markup: { keyboard: [["/mercado", "/barsi"], ["/agenda", "/alertas"], ["/seguindo", "/ajuda"]], resize_keyboard: true, is_persistent: true } };
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
/seguindo — painel com preço, DY, teto e Barsi · /deixar BBAS3 — para de seguir
/variacao 5 — aviso quando uma seguida subir ou cair 5% no dia
📰 /noticias BBAS3 — últimas notícias (as das seguidas chegam sozinhas)

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
    if (est.simples) return [`💰 Boas pagadoras pelo método Barsi`, `(${lista.length} ações passam em todos os critérios hoje)`, "",
      ...lista.slice(0, 12).map((x, i) => `${i + 1}. ${nomeCurto(x.a.n) || x.a.n} (${x.a.t}) — R$ ${nf(x.p)}\n    dividendos: em média ${nf(x.a.pm5 / x.p * 100, 1)}% ao ano (média de 5 anos)`),
      "", "Escreva o nome de uma delas para ver mais detalhes.", "Material de estudo, não é recomendação de compra."].join("\n");
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
    if (est.simples) return `🔔 Combinado! Aviso quando ${x.a.t} ${cond === ">=" ? "subir para" : "cair para"} R$ ${nf(alvo, alvo < 1 ? 4 : 2)} (agora está R$ ${nf(agora, agora < 1 ? 4 : 2)}).\nConfiro a cada 5 minutos nos dias de pregão. Para ver ou apagar, toque em 🔔 Meus alertas.`;
    return `🔔 Alerta criado: ${x.a.t} ${cond === ">=" ? "subir a" : "cair a"} ${nf(alvo, alvo < 1 ? 4 : 2)} (agora ${nf(agora, agora < 1 ? 4 : 2)}).\nConfiro a cada 5 minutos, de segunda a sexta, das 9h às 19h.`;
  }

  function listaAlertas(est) {
    const l = est.alertas || [];
    if (!l.length) return { texto: "Nenhum alerta ligado. Crie com /alerta BBAS3 15,50" };
    return { texto: "🔔 Alertas ligados (toque para apagar):\n\n" + l.map((a, i) => `${i + 1}. ${a.t} ${a.cond === ">=" ? "acima de" : "abaixo de"} ${nf(a.p, a.p < 1 ? 4 : 2)}${a.nota ? " · " + a.nota : ""}`).join("\n"),
      extra: { reply_markup: { inline_keyboard: l.map((a, i) => [{ text: `🗑 ${i + 1}. ${a.t} ${nf(a.p, a.p < 1 ? 4 : 2)}`, callback_data: "del:" + a.id }]) } } };
  }

  async function cmdSeguir(arg, u) { const est = u;
    const pedidos = String(arg || "").split(/[\s,;]+/).filter(Boolean).slice(0, 15);
    if (!pedidos.length) return "Mande os códigos, por exemplo: /seguir BBAS3 TAEE11 ITSA4";
    const ok = [], nao = [];
    for (const p of pedidos) { const x = await achar(p); if (x) { if (!est.seguindo.includes(x.a.t)) est.seguindo.push(x.a.t); ok.push(x.a.t); } else nao.push(p); }
    est.seguindo = est.seguindo.slice(-40); await salvar(est);
    if (u.simples) return (ok.length ? `⭐ Pronto! Agora acompanho ${ok.join(", ")} para você.\n\nVou avisar sozinho:\n• quando for pagar dividendo (na véspera e no dia)\n• se subir ou cair ${u.variacao || 5}% ou mais no dia\n• quando sair notícia\n\nPara ver suas ações, toque em ⭐ Minhas ações.` : "") + (nao.length ? `\nNão encontrei: ${nao.join(", ")}` : "");
    return (ok.length ? `⭐ Seguindo: ${ok.join(", ")}.\nAvisos: véspera e dia da data com, dia do pagamento, entrada ou saída do Barsi, variação de ±${u.variacao || 5}% no dia e notícias novas.` : "") + (nao.length ? `\nNão achei: ${nao.join(", ")}` : "");
  }
  async function cmdSeguindo(u) {
    if (!u.seguindo.length) return "Você não segue nenhuma ação ainda. Exemplo: /seguir BBAS3 TAEE11";
    const xs = (await Promise.all([...new Set(u.seguindo)].map(t => achar(t)))).filter(Boolean);
    const q = await precos(xs.map(x => x.sym));
    if (u.simples) {
      const S = ["⭐ Suas ações"];
      for (const { classe, a, sym } of xs) {
        const z = q[sym], p = z?.p > 0 ? z.p : a.preco, vd = z?.pc > 0 ? z.p / z.pc - 1 : a.var;
        const hoje = vd == null ? "" : vd > 0.0005 ? ` · hoje subiu ${nf(vd * 100, 1)}% 🟢` : vd < -0.0005 ? ` · hoje caiu ${nf(-vd * 100, 1)}% 🔴` : " · hoje estável";
        let extra = "";
        if (classe === "acoes") { const b = barsi({ ...a, preco: p }, u.alvo); if (b.teto) extra = `\n   Barsi: ${b.ok ? "✅ passa" : "❌ não passa"} · ${b.desconto >= 0 ? nf(b.desconto * 100, 0) + "% abaixo" : nf(-b.desconto * 100, 0) + "% acima"} do teto`; }
        else if (classe === "fiis" && a.ult_prov) extra = `\n   Último rendimento: R$ ${nf(a.ult_prov.v, 2)} por cota`;
        S.push("", `${nomeCurto(a.n) || a.n} (${a.t})\n   R$ ${nf(p, p < 1 ? 4 : 2)}${hoje}${extra}`);
      }
      S.push("", "Para ver os detalhes de uma ação, escreva o nome dela. Para parar de acompanhar, escreva: parar de seguir BBAS3");
      return S.join("\n");
    }
    const L = [`⭐ Você segue ${xs.length} (DY desejado ${pct(u.alvo, 0)})`];
    for (const { classe, a, sym } of xs) {
      const z = q[sym], p = z?.p > 0 ? z.p : a.preco, vd = z?.pc > 0 ? z.p / z.pc - 1 : a.var;
      const cor = vd == null ? "•" : vd >= 0 ? "🟢" : "🔴", un = ["acoes", "fiis", "etfs", "bdrs", "moedas"].includes(classe) ? "R$ " : classe === "stocks" ? "US$ " : "";
      let linha = `${cor} ${a.t} ${un}${nf(p, p < 1 ? 4 : 2)} (${sinal(vd)})`;
      if (classe === "acoes") {
        const b = barsi({ ...a, preco: p }, u.alvo), f = a.preco ? p / a.preco : 1;
        linha += `\n    DY 12m ${pct(a.dy != null ? a.dy / f : null)} · teto ${R$(b.teto)}${b.desconto != null ? ` (${pct(Math.abs(b.desconto), 0)} ${b.desconto >= 0 ? "abaixo" : "acima"})` : ""} · Barsi ${b.ok ? "✅" : "❌"}`;
      } else if (classe === "fiis") linha += `\n    DY 12m ${pct(a.dy)} · P/VP ${nf(a.pvp, 2)}`;
      L.push("", linha);
    }
    L.push("", `Avisos: variação de ${u.variacao ? "±" + u.variacao + "% no dia" : "dia desligada"} · notícias ${u.noticias ? "ligadas" : "desligadas"}`,
      "/seguir · /deixar · /variacao 5 · /noticias BBAS3");
    return L.join("\n");
  }
  async function cmdNoticias(arg, u) {
    const a0 = sem(arg).trim();
    if (a0 === "LIGA" || a0 === "LIGAR" || a0 === "ON") { u.noticias = true; await salvar(u); return "📰 Notícias das ações seguidas: ligadas (confiro a cada 30 min no horário do pregão)."; }
    if (a0 === "DESLIGA" || a0 === "DESLIGAR" || a0 === "OFF") { u.noticias = false; await salvar(u); return "Notícias automáticas desligadas. /noticias BBAS3 continua funcionando."; }
    if (!a0) return `📰 Notícias automáticas das ações seguidas: ${u.noticias ? "ligadas" : "desligadas"}.\n/noticias BBAS3 — últimas notícias de um ativo\n/noticias liga · /noticias desliga`;
    const x = await achar(arg);
    if (!x) return `Não achei "${arg}" no Radar B3.`;
    const itens = (await buscarNoticias(x.a.t, x.a.n, x.classe, 7)).slice(0, 8);
    if (!itens.length) return `Nenhuma notícia sobre ${x.a.t} nos últimos 7 dias.`;
    return [`📰 ${x.a.t} — últimas notícias`, ...itens.map(n => `\n• ${n.titulo}\n  ${n.fonte}${n.quando ? " · " + quandoBR(n.quando) : ""}\n  ${n.link}`), "\nFontes: Bing e Google Notícias. Confira sempre a notícia original."].join("\n");
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

  // ---------------------------------------------------------------- modo simples (linguagem do dia a dia, botões com palavras)
  const BOTOES = { "📊 Mercado hoje": "mercado", "💰 Boas pagadoras": "barsi", "⭐ Minhas ações": "seguindo", "🗓️ Agenda da semana": "agenda", "🔔 Meus alertas": "alertas", "❓ Como usar": "ajuda" };
  const TECLADO_SIMPLES = { reply_markup: { keyboard: [["📊 Mercado hoje", "💰 Boas pagadoras"], ["⭐ Minhas ações", "🗓️ Agenda da semana"], ["🔔 Meus alertas", "❓ Como usar"]], resize_keyboard: true, is_persistent: true } };
  const AJUDA_SIMPLES = `👋 Olá! Eu sou o robô do Radar B3.

É só escrever o nome ou o código de uma empresa que eu mostro o preço e se ela paga bons dividendos. Por exemplo:
• Petrobras
• Banco do Brasil
• BBAS3

Ou toque nos botões aqui embaixo 👇
📊 Mercado hoje — como estão a Bolsa e o dólar
💰 Boas pagadoras — ações que passam no método Barsi
⭐ Minhas ações — as que você acompanha
🗓️ Agenda da semana — datas importantes da economia
🔔 Meus alertas — avisos de preço que você criou

Para acompanhar uma ação, toque em "⭐ Seguir" embaixo do preço dela. Eu aviso sozinho quando ela for pagar dividendo, quando subir ou cair muito e quando sair notícia.

Todo dia útil, às 8h30, mando um resumo do mercado.

Isto é material de estudo, não é recomendação de compra ou venda.`;
  const teclado = u => u.simples ? TECLADO_SIMPLES : u === est0 ? TECLADO : TECLADO_CONVIDADO;
  let est0 = null;
  const botoesAtivo = (t, u) => ({ reply_markup: { inline_keyboard: [
    [(u.seguindo || []).includes(t) ? { text: "✖️ Parar de seguir", callback_data: "dx:" + t } : { text: "⭐ Seguir", callback_data: "seg:" + t }, { text: "📰 Notícias", callback_data: "not:" + t }],
    [{ text: "💰 Dividendos", callback_data: "prov:" + t }, { text: "🔔 Avisar preço", callback_data: "av:" + t }]] } });

  async function precoSimples(x, u) {
    const { classe, a, sym } = x;
    const q = sym ? (await precos([sym]))[sym] : null;
    const p = q?.p > 0 ? q.p : a.preco, vd = q?.pc > 0 ? q.p / q.pc - 1 : a.var;
    const un = ["acoes", "fiis", "etfs", "bdrs", "moedas"].includes(classe) ? "R$ " : classe === "stocks" ? "US$ " : "";
    const val = v => un + nf(v, v < 1 ? 4 : 2) + (classe === "indices" ? " pontos" : "");
    const mov = (v, d = 1) => v == null ? "—" : v > 0.0005 ? `subiu ${nf(v * 100, d)}% 🟢` : v < -0.0005 ? `caiu ${nf(-v * 100, d)}% 🔴` : "ficou estável";
    const L = [`${classe === "fiis" ? "🏢" : classe === "acoes" ? "🏦" : "📈"} ${nomeCurto(a.n) || a.n} (${a.t})`, "", `Preço agora: ${val(p)}`, `Hoje: ${mov(vd, 2)}`];
    const r12 = a.r12 ?? a.var12;
    if (r12 != null) L.push(`Em 12 meses: ${mov(r12)}${a.rt12 != null ? ` (somando os dividendos: ${mov(a.rt12).replace(/ 🟢| 🔴/, "")})` : ""}`);
    if (classe === "acoes") {
      const b = barsi({ ...a, preco: p }, u.alvo), f = a.preco ? p / a.preco : 1;
      if (a.prov12 > 0) L.push("", `💰 Dividendos: pagou R$ ${nf(a.prov12, 2)} por ação nos últimos 12 meses (cerca de ${nf(a.prov12 / p * 100, 1)}% do preço de hoje).`);
      else L.push("", "💰 Não pagou dividendos nos últimos 12 meses.");
      if (b.teto) {
        L.push("", "📏 Método Barsi", `Preço-teto: ${R$(b.teto)}. É o preço máximo para receber ${nf(u.alvo * 100, 0)}% ao ano em dividendos, pela média dos últimos 5 anos.`);
        L.push(b.desconto >= 0 ? `O preço está ${nf(b.desconto * 100, 0)}% abaixo do teto.` : `O preço está ${nf(-b.desconto * 100, 0)}% acima do teto (cara pelo método).`);
        L.push(b.ok ? "✅ Passa em todos os critérios do Barsi." : "❌ Não passa em todos os critérios do Barsi.");
      }
      void f;
    } else if (classe === "fiis") {
      if (a.ult_prov) L.push("", `💰 Último rendimento: R$ ${nf(a.ult_prov.v, 2)} por cota em ${dataBR(a.ult_prov.d)}.`);
      if (a.dy) L.push(`Em 12 meses rendeu cerca de ${nf(a.dy * 100, 1)}% do preço em rendimentos.`);
    }
    L.push("", "Toque nos botões abaixo 👇");
    return L.join("\n");
  }

  // entende frases simples: "petrobras", "quanto está o banco do brasil?", "seguir taesa", "notícias da vale"
  const PALAVRAS_VAZIAS = /\b(QUANTO|ESTA|TA|EST[AÁ]|PRECO|COTACAO|VALOR|ACAO|ACOES|DA|DO|DE|DAS|DOS|A|O|AS|OS|HOJE|AGORA|ME|MOSTRA|MOSTRE|QUERO|VER|SABER|POR|FAVOR|COMO)\b/g;
  function intencao(txt) {
    const t = sem(txt).replace(/[?!.,]/g, " ").replace(/\s+/g, " ").trim();
    let m;
    if ((m = /^(?:PARAR DE SEGUIR|DEIXAR DE SEGUIR|NAO SEGUIR) (.+)$/.exec(t))) return ["deixar", m[1]];
    if ((m = /^(?:SEGUIR|ACOMPANHAR) (.+)$/.exec(t))) return ["seguir", m[1]];
    if ((m = /^NOTICIAS? (?:D[AEO]S? )?(.+)$/.exec(t))) return ["noticias", m[1]];
    if ((m = /^(?:DIVIDENDOS?|PROVENTOS?|RENDIMENTOS?) (?:D[AEO]S? )?(.+)$/.exec(t))) return ["proventos", m[1]];
    if ((m = /^(?:AVISAR?|ALERTA|ME AVISE) (?:QUANDO )?(.+)$/.exec(t))) return ["alerta", m[1].replace(/\b(CHEGAR|CHEGAR A|EM|FOR|PARA)\b/g, " ").replace(/\s+/g, " ").trim()];
    if (/^(OI|OLA|BOM DIA|BOA TARDE|BOA NOITE|AJUDA|MENU|INICIO|COMECAR)$/.test(t)) return ["ajuda", ""];
    if (/^(MERCADO|BOLSA|COMO ESTA A BOLSA|COMO ESTA O MERCADO)$/.test(t)) return ["mercado", ""];
    if (/^(OBRIGAD[OA]|VALEU|BRIGADO|OK|BELEZA|TA BOM|ENTENDI)$/.test(t)) return ["obrigado", ""];
    return ["preco", t.replace(PALAVRAS_VAZIAS, " ").replace(/\s+/g, " ").trim() || t];
  }

  // ---------------------------------------------------------------- convidados
  function cmdConvidar(est) {
    const al = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", r = crypto.getRandomValues(new Uint8Array(8));
    const codigo = [...r].map(x => al[x % al.length]).join("");
    est.convites = (est.convites || []).filter(c => c.ate > Date.now()).slice(-9);
    est.convites.push({ codigo, ate: Date.now() + 24 * 36e5 });
    return `👥 Convite criado (vale 24 horas e uma única pessoa). Mande este link para a pessoa:\n\nhttps://t.me/GeffMB_bot?start=${codigo}\n\nEla abre o link e toca em Iniciar. (Ou, dentro do bot, envia /entrar ${codigo})\n\nEla poderá usar todos os comandos e terá os próprios alertas, ações seguidas, resumo e lembretes. Os seus continuam só seus.`;
  }
  function listaConvidados(est) {
    const l = est.convidados || [];
    if (!l.length) return { texto: "Nenhum convidado. Crie um convite com /convidar" };
    return { texto: "👥 Convidados:\n\n" + l.map((c, i) => `${i + 1}. ${c.nome || "sem nome"} — desde ${dataBR(c.desde)}`).join("\n"),
      extra: { reply_markup: { inline_keyboard: l.map((c, i) => [{ text: `🗑 Remover ${i + 1}. ${c.nome || ""}`.trim(), callback_data: "crm:" + c.chat }]) } } };
  }
  async function entrar(chat, de, arg, est) {
    const cod = String(arg || "").trim().toUpperCase();
    const c = (est.convites || []).find(x => x.codigo === cod && x.ate > Date.now());
    if (!c) return enviar(chat, "Este bot é privado. Se você recebeu um convite, envie /entrar seguido do código (ele vale 24 horas).");
    const nome = [de?.first_name, de?.last_name].filter(Boolean).join(" ") || (de?.username ? "@" + de.username : "");
    est.convites = est.convites.filter(x => x !== c);
    est.convidados = (est.convidados || []).filter(x => String(x.chat) !== String(chat)).concat([{ chat, nome, desde: new Date().toISOString().slice(0, 10) }]).slice(-10);
    await salvar(est);
    await enviar(chat, "✅ Bem-vindo! Você já pode usar o robô do Radar B3.\n\n" + AJUDA_SIMPLES, TECLADO_SIMPLES);
    await enviar(est.chat, `👥 ${nome || "Alguém"} entrou com o seu convite. /convidados para ver ou remover.`);
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
    const u = dono ? est : await perfil(chat);
    est0 = est;
    if (cq) {
      await api("answerCallbackQuery", { callback_query_id: cq.id });
      const [acao, tk] = String(cq.data || "").split(":");
      try {
        if (acao === "seg") return enviar(chat, await cmdSeguir(tk, u));
        if (acao === "dx") { u.seguindo = u.seguindo.filter(x => x !== tk); await salvar(u); return enviar(chat, `Você não segue mais ${tk}.`); }
        if (acao === "not") return enviar(chat, await cmdNoticias(tk, u));
        if (acao === "prov") return enviar(chat, await cmdProventos(tk));
        if (acao === "av") {
          u.pendente = { acao: "alerta", t: tk, ate: Date.now() + 15 * 60e3 }; await salvar(u);
          return enviar(chat, `🔔 Qual preço de ${tk} você quer que eu avise?\nEscreva só o número, por exemplo: 15,50\n(Eu aviso quando o preço chegar lá, subindo ou caindo.)`);
        }
      } catch (e) { return enviar(chat, "⚠️ Não consegui agora. Tente de novo em 1 minuto."); }
      if (cq.data?.startsWith("del:")) { u.alertas = (u.alertas || []).filter(a => a.id !== cq.data.slice(4)); await salvar(u); const r = listaAlertas(u); return enviar(chat, "Apagado. " + r.texto, r.extra || {}); }
      if (!dono) return;
      const alvoC = cq.data?.slice(4);
      if (cq.data?.startsWith("crm:")) { const c = est.convidados.find(x => String(x.chat) === alvoC); est.convidados = est.convidados.filter(x => String(x.chat) !== alvoC); await salvar(est); await KV.delete("tg:u:" + alvoC).catch(() => {}); if (c) await enviar(c.chat, "Seu acesso ao bot do Radar B3 foi encerrado pelo dono.").catch(() => {}); const r = listaConvidados(est); return enviar(chat, "Removido. " + r.texto, r.extra || {}); }
      if (cq.data?.startsWith("del:")) { est.alertas = (est.alertas || []).filter(a => a.id !== cq.data.slice(4)); await salvar(est); const r = listaAlertas(est); await enviar(chat, "Apagado. " + r.texto, r.extra || {}); }
      return;
    }
    let txt = (msg.text || "").trim();
    if (!txt) return;
    // resposta a "Qual preço você quer que eu avise?"
    if (u.pendente && u.pendente.ate > Date.now() && /^R?\$?\s*\d[\d.,]*$/.test(txt)) {
      const t = u.pendente.t; u.pendente = null;
      const r = await cmdAlerta(`${t} ${txt.replace(/^R?\$?\s*/, "")}`, u);
      return enviar(chat, r, u.simples ? TECLADO_SIMPLES : {});
    }
    if (BOTOES[txt]) txt = "/" + BOTOES[txt];
    let cmd, arg;
    if (txt.startsWith("/")) { [, cmd, arg] = /^\/([^\s@]+)(?:@\S+)?\s*(.*)$/s.exec(txt) || []; cmd = sem(cmd).toLowerCase(); }
    else [cmd, arg] = intencao(txt);
    let resp;
    try {
      const soDono = ["ligar", "convidar", "convidados", "remover"];
      if ((cmd === "start" || cmd === "ajuda" || cmd === "help") && u.simples) return enviar(chat, AJUDA_SIMPLES + "\n\n" + (convidado ? "Comandos para quem gosta: /comandos" : "Comandos completos: /comandos · /simples desliga este modo"), TECLADO_SIMPLES);
      if (cmd === "comandos") return enviar(chat, (convidado ? AJUDA_CONVIDADO : AJUDA).replace("%DY%", pct(u.alvo, 0)), teclado(u));
      if (cmd === "simples") { u.simples = !u.simples; await salvar(u); return enviar(chat, u.simples ? "Modo simples ligado: respostas em linguagem do dia a dia e botões com palavras." : "Modo simples desligado: respostas completas com indicadores.", teclado(u)); }
      if (convidado && (cmd === "start" || cmd === "ajuda" || cmd === "help")) return enviar(chat, AJUDA_CONVIDADO.replace("%DY%", pct(u.alvo, 0)), TECLADO_CONVIDADO);
      if (convidado && soDono.includes(cmd)) return enviar(chat, "Esse comando é só do dono do bot. Envie /ajuda para ver o que você pode usar.");
      if (cmd === "start" || cmd === "ajuda" || cmd === "help") return enviar(chat, AJUDA.replace("%DY%", pct(est.alvo, 0)), TECLADO);
      else if (cmd === "convidar") { resp = cmdConvidar(est); await salvar(est); }
      else if (cmd === "convidados" || cmd === "remover") { const r = listaConvidados(est); return enviar(chat, r.texto, r.extra || {}); }
      else if (cmd === "entrar") resp = "Você já tem acesso ao bot.";
      else if (cmd === "preco" || cmd === "cotacao") {
        if (!arg) resp = u.simples ? "Escreva o nome ou o código da empresa, por exemplo: Petrobras" : "Mande o código, por exemplo: /preco BBAS3";
        else {
          const x = await achar(arg);
          if (!x) resp = u.simples ? `Não encontrei "${arg}" 🤔\nTente o nome da empresa (por exemplo: Itaú, Vale, Petrobras) ou o código (ITUB4, VALE3, PETR4).` : `Não achei "${arg}" no Radar B3.`;
          else return enviar(chat, u.simples ? await precoSimples(x, u) : await cmdPreco(x.a.t, u), botoesAtivo(x.a.t, u));
        }
      }
      else if (cmd === "teto") resp = await cmdTeto(arg, u);
      else if (cmd === "barsi") resp = await cmdBarsi(u);
      else if (cmd === "proventos" || cmd === "dividendos") resp = await cmdProventos(arg);
      else if (cmd === "agenda") resp = await cmdAgenda(7, 2);
      else if (cmd === "mercado") resp = await cmdMercado();
      else if (cmd === "alerta") resp = await cmdAlerta(arg, u);
      else if (cmd === "alertas") { const r = listaAlertas(u); return enviar(chat, r.texto, r.extra || {}); }
      else if (cmd === "dy") { const v = parseFloat(String(arg).replace(",", ".")); if (!(v >= 1 && v <= 30)) resp = `DY desejado agora: ${pct(u.alvo, 1)}. Para mudar: /dy 7`; else { u.alvo = v / 100; await salvar(u); resp = `DY desejado: ${pct(u.alvo, 1)}. O preço-teto agora usa esse valor.`; } }
      else if (cmd === "seguir") resp = await cmdSeguir(arg, u);
      else if (cmd === "seguindo") resp = await cmdSeguindo(u);
      else if (cmd === "noticias" || cmd === "noticia") resp = await cmdNoticias(arg, u);
      else if (cmd === "variacao") { const v = parseFloat(String(arg).replace(",", ".").replace("%", "")); if (!(v >= 0 && v <= 50)) resp = `Aviso de variação forte: ${u.variacao ? "±" + u.variacao + "%" : "desligado"}. Para mudar: /variacao 5 (ou /variacao 0 para desligar)`; else { u.variacao = v; await salvar(u); resp = v ? `📈 Aviso quando uma ação seguida subir ou cair ${nf(v, v % 1 ? 1 : 0)}% ou mais no dia (e de novo no dobro disso).` : "Aviso de variação desligado."; } }
      else if (cmd === "deixar") { const xa = await achar(arg).catch(() => null), t = xa ? xa.a.t : sem(arg).replace(/[^A-Z0-9]/g, ""); const antes = u.seguindo.length; u.seguindo = u.seguindo.filter(x => x !== t); await salvar(u); resp = u.seguindo.length < antes ? `Deixou de seguir ${t}.` : `Você não seguia "${arg}". /seguindo mostra a lista.`; }
      else if (cmd === "ligar") resp = await cmdLigar(est);
      else if (cmd === "lembretes") { u.lembretes = !u.lembretes; await salvar(u); resp = u.lembretes ? "⏰ Lembretes 30 min antes de eventos de alto impacto: ligados." : "Lembretes de eventos desligados."; }
      else if (cmd === "resumo") { u.resumo = !u.resumo; await salvar(u); resp = u.resumo ? "☀️ Resumo das 8h30 ligado (dias úteis)." : "Resumo das 8h30 desligado."; }
      else if (cmd === "obrigado") resp = "De nada! 😊 Qualquer coisa é só escrever o nome de uma empresa.";
      else resp = u.simples ? "Não entendi 🙂 Escreva o nome de uma empresa (por exemplo: Petrobras) ou toque em ❓ Como usar." : "Não entendi. Envie /ajuda para ver os comandos.";
    } catch (e) { resp = "⚠️ Não consegui responder agora (" + e.message + "). Tente de novo em 1 minuto."; }
    await enviar(chat, resp);
  }

  // a cada 5 minutos (cron): alertas e lembretes; às 8h30 dos dias úteis: resumo — para o dono e cada convidado
  async function automaticos(quando) {
    const est = await estado();
    if (!est.chat) return;
    const pessoas = [est];
    for (const c of est.convidados || []) pessoas.push(await perfil(c.chat));
    const br = new Date(quando - 3 * 36e5), hm = br.getUTCHours() * 60 + br.getUTCMinutes(), hoje = br.toISOString().slice(0, 10);
    // alertas de preço: uma consulta só para todo mundo
    const todos = pessoas.flatMap(u => u.alertas || []);
    const q = todos.length ? await precos(todos.map(a => a.sym)) : {};
    let ag = null, mercado = null, agendaHoje = null;
    const seguidos = [...new Set(pessoas.flatMap(u => u.seguindo || []))], infos = {}, noticiasDe = {};
    let qs = {};
    if (seguidos.length && hm >= 600 && hm <= 1110) {
      for (const t of seguidos) { try { const x = await achar(t); if (x) infos[t] = x; } catch (e) {} }
      qs = await precos(Object.values(infos).map(x => x.sym)).catch(() => ({}));
      // notícias: cada ativo é consultado a cada 30 minutos (escalonado para não pedir tudo de uma vez)
      const fatia = Math.floor(hm / 5) % 6, hashT = t => [...t].reduce((h, c) => h * 31 + c.charCodeAt(0) >>> 0, 7) % 6;
      const querem = new Set(pessoas.filter(u => u.noticias).flatMap(u => u.seguindo || []));
      for (const t of seguidos) if (infos[t] && querem.has(t) && hashT(t) === fatia) { try { noticiasDe[t] = await buscarNoticias(t, infos[t].a.n, infos[t].classe, 1); } catch (e) { console.log("notícias", t, e.message); } }
    }
    for (const u of pessoas) {
      let mudou = false;
      const l = u.alertas || [];
      if (l.length) {
        const ficam = [];
        for (const a of l) {
          const p = q[a.sym]?.p;
          if (p > 0 && (a.cond === ">=" ? p >= a.p : p <= a.p)) await enviar(u.chat, `🔔 ${a.t} ${a.cond === ">=" ? "subiu a" : "caiu a"} ${nf(p, p < 1 ? 4 : 2)} (alerta: ${a.cond === ">=" ? "acima de" : "abaixo de"} ${nf(a.p, a.p < 1 ? 4 : 2)})${a.nota ? "\n" + a.nota : ""}`).catch(() => ficam.push(a));
          else ficam.push(a);
        }
        if (ficam.length !== l.length) { u.alertas = ficam; mudou = true; }
      }
      // ações seguidas: variação forte no dia e notícias novas
      if (u.seguindo?.length && hm >= 600 && hm <= 1110) {     // 10h–18h30, horário do pregão
        const dia = hoje;
        if (u.marcas?.dia !== dia) u.marcas = { dia, var: {}, not: {} };
        for (const t of new Set(u.seguindo)) {
          const x = infos[t]; if (!x) continue;
          if (u.variacao > 0) {
            const z = qs[x.sym];
            if (z?.p > 0 && z?.pc > 0) {
              const v = z.p / z.pc - 1, nivel = Math.floor(Math.abs(v * 100) / u.variacao), lado = v >= 0 ? "+" : "-";
              const k = t + lado, ja = u.marcas.var[k] || 0;
              if (nivel >= 1 && (nivel >= 2 * Math.max(ja, 1) || ja === 0)) {
                u.marcas.var[k] = nivel; mudou = true;
                await enviar(u.chat, `${v >= 0 ? "🚀" : "⚠️"} ${t} ${v >= 0 ? "sobe" : "cai"} ${nf(Math.abs(v * 100), 1)}% hoje: ${nf(z.p, z.p < 1 ? 4 : 2)} (fechou ontem a ${nf(z.pc, z.pc < 1 ? 4 : 2)})\n/noticias ${t} para ver o que saiu`).catch(() => {});
              }
            }
          }
          if (u.noticias && noticiasDe[t]) {
            const vistas = new Set(u.notVistas || []), enviadas = u.marcas.not[t] || 0;
            const novas = noticiasDe[t].filter(n => !vistas.has(n.id) && n.quando > quando - 4 * 36e5).slice(0, Math.max(0, 4 - enviadas));
            if (novas.length) {
              novas.forEach(n => vistas.add(n.id));
              u.notVistas = [...vistas].slice(-300); u.marcas.not[t] = enviadas + novas.length; mudou = true;
              await enviar(u.chat, `📰 ${t}\n` + novas.map(n => `\n• ${n.titulo}\n  ${n.fonte} · ${quandoBR(n.quando)}\n  ${n.link}`).join("\n")).catch(() => {});
            }
          }
        }
      }
      // lembrete 30 minutos antes dos eventos de alto impacto
      if (u.lembretes) {
        try {
          ag = ag || await site("mercado/agenda.json");
          const antes = (u.lembrados || []).filter(k => k.startsWith(hoje)), vistos = new Set(antes);
          for (const e of (ag.eventos || []).filter(e => e.d === hoje && (e.imp || 1) >= 3 && e.h)) {
            const [hh, mm] = e.h.split(":").map(Number), falta = hh * 60 + mm - hm, k = `${hoje} ${e.h} ${e.n}`;
            if (falta > 0 && falta <= 35 && !vistos.has(k)) {
              vistos.add(k);
              await enviar(u.chat, `⏰ Em ${falta} min (${e.h}): ${e.pais === "EUA" ? "🇺🇸" : "🇧🇷"} ${e.n}${e.prev ? `\nPrevisão: ${e.prev}${e.ant ? " · anterior: " + e.ant : ""}` : ""}`).catch(() => {});
            }
          }
          if (vistos.size !== antes.length) { u.lembrados = [...vistos]; mudou = true; }
        } catch (e) { console.log("lembretes:", e.message); }
      }
      // resumo das 8h30–8h39
      if (hm >= 510 && hm < 520 && u.ultimoResumo !== hoje) {
        u.ultimoResumo = hoje; mudou = true;
        let barsiTxt = [], provTxt = [];
        try { barsiTxt = await mudancasBarsi(u); } catch (e) {}
        try { provTxt = await lembretesProventos(u, hoje); } catch (e) {}
        if (u.resumo) {
          if (mercado === null) { try { mercado = await cmdMercado(); } catch (e) { mercado = ""; } }
          if (agendaHoje === null) { try { agendaHoje = await cmdAgenda(1, 2, "🗓️ Agenda de hoje (horário de Brasília)"); } catch (e) { agendaHoje = ""; } }
          const partes = [`☀️ Bom dia! Resumo de ${dataBR(hoje)}`, mercado, agendaHoje];
          if (provTxt.length) partes.push(provTxt.join("\n"));
          if (barsiTxt.length) partes.push(barsiTxt.join("\n") + "\n/barsi para a lista completa");
          if ((u.alertas || []).length) partes.push(`🔔 ${u.alertas.length} alerta(s) ligado(s). /alertas`);
          await enviar(u.chat, partes.filter(Boolean).join("\n\n")).catch(() => {});
        } else if (provTxt.length || barsiTxt.length) await enviar(u.chat, [...provTxt, ...barsiTxt].join("\n\n")).catch(() => {});
      }
      if (mudou) await salvar(u);
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
