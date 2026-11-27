"use strict";
/* Relatório em texto da ação: junta o que o Radar B3 mostra (preço ao vivo, tendência por tempo gráfico,
   indicadores, método Barsi, proventos, sua posição e a agenda) num texto para copiar e colar numa conversa
   com IA, num grupo ou num caderno de estudos. Tudo é calculado no navegador com os dados já usados pelo site. */
(function () {
  const ENDPOINT = "https://radar-assistente.gefersonmarques.workers.dev/cotacao";
  const nf = d => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const n2 = v => v == null || !isFinite(v) ? "—" : nf(2).format(v);
  const n1 = v => v == null || !isFinite(v) ? "—" : nf(1).format(v);
  const R$ = v => v == null || !isFinite(v) ? "—" : (v < 0 ? "−" : "") + "R$ " + nf(2).format(Math.abs(v));
  const pc = (v, d = 1) => v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + nf(d).format(Math.abs(v * 100)) + "%";
  const pct = (v, d = 1) => v == null || !isFinite(v) ? "—" : nf(d).format(v * 100) + "%";
  const dataBR = s => s ? s.split("-").reverse().join("/") : "—";

  // ---------------------------------------------------------------- indicadores técnicos
  const mme = (v, n) => Candles.mme(v, n), mms = (v, n) => Candles.mms(v, n);
  function ifr(c, n = 14) {
    if (c.length <= n) return null; let g = 0, p = 0;
    for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1], a = Math.max(d, 0), b = Math.max(-d, 0);
      if (i <= n) { g += a / n; p += b / n; } else { g = (g * (n - 1) + a) / n; p = (p * (n - 1) + b) / n; } }
    return p === 0 ? 100 : 100 - 100 / (1 + g / p);
  }
  async function candles(simbolo, faixa) {
    try {
      const r = await fetch(`${ENDPOINT}?s=${encodeURIComponent(simbolo)}&f=${faixa}&aq=1`, { referrerPolicy: "no-referrer" });
      const d = await r.json();
      if (!r.ok || !d.c?.length) return null;
      return d;
    } catch (e) { return null; }
  }
  function linhaTempo(nome, d, unidade) {
    if (!d || d.c.length < 30) return `- ${nome}: sem dados suficientes`;
    const c = d.c, p = c[c.length - 1], ult = a => a[a.length - 1];
    const e9 = ult(mme(c, 9)), e21 = ult(mme(c, 21)), s50 = ult(mms(c, 50)), s200 = ult(mms(c, 200)), r = ifr(c);
    const m = Candles.macd(c, 12, 26, 9), h = m.hist.filter(x => x != null), hU = h[h.length - 1], hA = h[h.length - 2];
    let cruz = "";
    for (let i = Math.max(1, h.length - 3); i < h.length; i++) { if (h[i - 1] < 0 && h[i] >= 0) cruz = ", cruzou o sinal para cima há pouco"; if (h[i - 1] > 0 && h[i] <= 0) cruz = ", cruzou o sinal para baixo há pouco"; }
    const pos = x => x == null ? "" : p >= x ? " (preço acima)" : " (preço abaixo)";
    let tend = "lateral";
    if (e21 && s50) { if (p > e21 && e21 > s50) tend = "alta"; else if (p < e21 && e21 < s50) tend = "baixa"; }
    const zona = r == null ? "" : r >= 70 ? " — sobrecomprado" : r <= 30 ? " — sobrevendido" : "";
    const macdTxt = hU == null ? "MACD —" : `MACD ${n2(ult(m.linha))} / sinal ${n2(ult(m.sinal))} / histograma ${n2(hU)} (${hU > hA ? "subindo" : "caindo"}, ${ult(m.linha) >= 0 ? "acima" : "abaixo"} de zero${cruz})`;
    return `- ${nome}: tendência de ${tend} | MME 9 ${R$(e9)}${pos(e9)} | MME 21 ${R$(e21)}${pos(e21)} | MMS 50 ${s50 ? R$(s50) + pos(s50) : "—"} | MMS 200 ${s200 ? R$(s200) + pos(s200) : `— (menos de 200 ${unidade})`} | IFR 14 ${n1(r)}${zona} | ${macdTxt}`;
  }
  function niveis(d) {
    if (!d || d.c.length < 20) return [];
    const ext = n => { const h = d.h.slice(-n), l = d.l.slice(-n); return [Math.min(...l), Math.max(...h)]; };
    const [m20, x20] = ext(20), [m60, x60] = ext(60), [m250, x250] = ext(Math.min(250, d.c.length));
    return [`- Mínima e máxima de 20 pregões: ${R$(m20)} a ${R$(x20)}`, `- Mínima e máxima de 60 pregões: ${R$(m60)} a ${R$(x60)}`, `- Mínima e máxima de 52 semanas: ${R$(m250)} a ${R$(x250)}`];
  }

  // ---------------------------------------------------------------- texto
  async function gerar(ctx) {
    const { a, det, pares, prov, quando } = ctx;
    const sim = a.t + ".SA";
    const [d1, w1, h1, agenda] = await Promise.all([candles(sim, "1A"), candles(sim, "5A"), candles(sim, "1M"), R.carregar("mercado/agenda.json").catch(() => null)]);
    const agora = new Date();
    const vivo = d1?.p > 0 ? d1 : null;
    const preco = vivo?.p ?? a.preco, varDia = vivo?.pc > 0 ? vivo.p / vivo.pc - 1 : a.var;
    const quandoPreco = vivo?.tm ? new Date(vivo.tm * 1000).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : quando;
    const L = [];
    L.push(`RELATÓRIO ${a.t} — ${a.n}`);
    L.push(`Gerado pelo Radar B3 em ${agora.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}. Material de estudo, não é recomendação.`);
    L.push("");
    L.push("PREÇO");
    L.push(`- Cotação ${R$(preco)} (${pc(varDia, 2)} no dia), último negócio ${quandoPreco}. Cotações gratuitas da B3 podem ter até 15 min de atraso.`);
    L.push(`- Setor: ${a.setor}. Valor de mercado: ${a.mc ? "R$ " + nf(1).format(a.mc / 1e9) + " bi" : "—"}.`);
    const r = det?.retorno || {};
    if (r["1a"]) L.push(`- Retorno total em 12 meses ${pc(r["1a"].t)} (só cotação ${pc(r["1a"].p)})${r["5a"] ? `; em 5 anos ${pc(r["5a"].t)} (só cotação ${pc(r["5a"].p)})` : ""}.`);
    L.push("");
    L.push("TENDÊNCIA POR TEMPO GRÁFICO");
    L.push(linhaTempo("Semanal", w1, "semanas"));
    L.push(linhaTempo("Diário", d1, "pregões"));
    L.push(linhaTempo("60 minutos", h1, "candles"));
    const nv = niveis(d1);
    if (nv.length) { L.push(""); L.push("NÍVEIS DE PREÇO"); L.push(...nv); }
    L.push("");
    L.push("FUNDAMENTOS (últimos 12 meses, ajustados ao preço de agora)");
    const f = preco && a.preco ? preco / a.preco : 1;
    const med = k => { const v = pares.filter(p => p.t !== a.t).map(p => p[k]).filter(x => x != null && isFinite(x) && (k !== "pl" && k !== "pvp" || x > 0)).sort((x, y) => x - y); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
    const comSetor = (rot, v, k, fmt) => `${rot} ${fmt(v)}${med(k) != null ? ` (setor ${fmt(med(k))})` : ""}`;
    L.push(`- ${comSetor("P/L", a.pl != null ? a.pl * f : null, "pl", n1)} | ${comSetor("P/VP", a.pvp != null ? a.pvp * f : null, "pvp", n2)} | ${comSetor("DY 12m", a.dy != null ? a.dy / f : null, "dy", pct)}`);
    L.push(`- ${comSetor("ROE", a.roe, "roe", pct)} | ${comSetor("Margem líquida", a.ml, "ml", pct)} | ${a.fin ? "Dív. líq./EBITDA não se aplica (financeira)" : comSetor("Dív. líq./EBITDA", a.dle, "dle", v => v == null ? "—" : n1(v) + "x")}`);
    if (a.payout != null) L.push(`- Payout: ${pct(a.payout, 0)} do lucro distribuído.`);
    if ((a.alertas || []).length) L.push(`- Dados para conferir: ${a.alertas.map(x => x.m).join(" ")}`);
    L.push("");
    const alvo = R.dyAlvo(), b = R.barsi({ ...a, preco }, alvo), c = b.crit;
    const sn = v => v === true ? "sim" : v === false ? "não" : "sem dados";
    L.push(`MÉTODO BARSI (DY desejado ${pct(alvo, 1)})`);
    L.push(`- Preço-teto ${R$(b.teto)}${b.desconto != null ? ` — cotação ${pct(Math.abs(b.desconto), 0)} ${b.desconto >= 0 ? "abaixo" : "acima"} do teto` : ""}. Média de proventos de 5 anos: ${R$(a.pm5)} por ação (DY de ${pct(b.dy5)} no preço de hoje).`);
    L.push(`- Setor perene (BEST): ${sn(c.best)} | Proventos regulares: ${sn(c.reg)}${a.regb ? ` (${a.reg} de ${a.regb} anos)` : ""} | Abaixo do teto: ${sn(c.teto)} | Lucro consistente: ${sn(c.lucro)} | Payout sustentável: ${sn(c.payout)} | Dívida controlada: ${sn(c.divida)}`);
    L.push(`- Resultado: ${b.ok ? "atende a todos os critérios" : "não atende a todos os critérios"}.`);
    const anos = det?.dividendos?.anos || [];
    if (anos.length) L.push(`- Proventos por ano (R$ por ação): ${anos.slice(-8).map(([y, v]) => `${y} ${nf(2).format(v)}`).join(" · ")}`);
    L.push("");
    L.push("PROVENTOS");
    if (det?.proventos_12m != null) L.push(`- Pagos nos últimos 12 meses: ${R$(det.proventos_12m)} por ação.`);
    const hoje = agora.toISOString().slice(0, 10);
    const futuros = (prov || []).filter(p => (p[1] || "") >= hoje).sort((x, y) => (x[1] < y[1] ? -1 : 1));
    if (futuros.length) futuros.slice(0, 6).forEach(p => L.push(`- ${p[3] || "Provento"} de ${R$(p[2])} por ação: data com ${dataBR(p[0])}, pagamento em ${dataBR(p[1])}`));
    else L.push("- Nenhum pagamento futuro anunciado na B3 até agora.");
    let pos = null;
    try { pos = (JSON.parse(localStorage.getItem("radar-carteira") || "[]") || []).find(x => x.t === a.t); } catch (e) {}
    if (pos && pos.q > 0) {
      L.push("");
      L.push("MINHA POSIÇÃO (só neste navegador)");
      const valor = pos.q * preco, custo = pos.pm ? pos.q * pos.pm : null;
      L.push(`- ${nf(0).format(pos.q)} ações, preço médio ${R$(pos.pm)}, valor hoje ${R$(valor)}${custo ? `, resultado ${pc(valor / custo - 1)} (${R$(valor - custo)})` : ""}.`);
      if (pos.pm && a.pm5) L.push(`- Yield on cost pela média de 5 anos: ${pct(a.pm5 / pos.pm)}.`);
    }
    const ev = (agenda?.eventos || []).filter(e => e.d >= hoje).slice(0, 8);
    if (ev.length) {
      L.push("");
      L.push("AGENDA (próximos eventos)");
      ev.forEach(e => L.push(`- ${dataBR(e.d)}${e.h ? " " + e.h : ""} · ${e.pais === "BR" ? "Brasil" : e.pais === "EUA" ? "EUA" : e.pais || ""} · ${e.n}${e.imp === 3 ? " (alto impacto)" : ""}`));
    }
    return L.join("\n");
  }

  // ---------------------------------------------------------------- janela
  function abrir(ctx) {
    let dlg = document.getElementById("rel-dlg");
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "rel-dlg"; dlg.className = "rel-dlg";
      dlg.innerHTML = `<div class="rel-topo"><h2>Relatório em texto</h2><button type="button" class="rel-x" aria-label="Fechar">✕</button></div>
        <p class="rel-nota">Copie e cole numa conversa com uma IA, num grupo ou nas suas anotações. Nada é enviado a lugar nenhum.</p>
        <textarea id="rel-txt" readonly spellcheck="false" aria-label="Texto do relatório"></textarea>
        <div class="rel-acoes"><span id="rel-status" role="status"></span><button type="button" class="btn" id="rel-copiar">Copiar</button></div>`;
      document.body.append(dlg);
      dlg.querySelector(".rel-x").onclick = () => dlg.close();
      dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });
      dlg.querySelector("#rel-copiar").onclick = async () => {
        const t = dlg.querySelector("#rel-txt"), st = dlg.querySelector("#rel-status");
        try { await navigator.clipboard.writeText(t.value); st.textContent = "Copiado!"; }
        catch (e) { t.select(); document.execCommand?.("copy"); st.textContent = "Texto selecionado: use Ctrl+C."; }
        setTimeout(() => { st.textContent = ""; }, 3000);
      };
    }
    const t = dlg.querySelector("#rel-txt");
    t.value = "Montando o relatório…";
    dlg.showModal();
    gerar(ctx).then(txt => { t.value = txt; }).catch(e => { t.value = "Não foi possível montar o relatório agora. Tente de novo em instantes."; });
  }

  window.Relatorio = { abrir, gerar };
})();
