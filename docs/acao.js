"use strict";
const $ = id => document.getElementById(id);
const nf = d => new Intl.NumberFormat("pt-BR",{minimumFractionDigits:d,maximumFractionDigits:d});
const f1=nf(1), f2=nf(2), f4=nf(4);
const pct = (x,d=1) => x==null? "–" : nf(d).format(x*100)+"%";
const brl = x => x==null? "–" : "R$ "+f2.format(x);
const big = x => { if(x==null) return "–"; const a=Math.abs(x);
  if(a>=1e12) return "R$ "+f2.format(x/1e12)+" tri"; if(a>=1e9) return "R$ "+f1.format(x/1e9)+" bi"; return "R$ "+f1.format(x/1e6)+" mi"; };
const dataBR = s => { const [y,m,d]=s.split("-"); return `${d}/${m}/${y}`; };
const esc = s => String(s).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const median = a => { const s=a.filter(v=>v!=null&&isFinite(v)).sort((x,y)=>x-y); if(!s.length) return null; const m=s.length>>1; return s.length%2? s[m] : (s[m-1]+s[m])/2; };

const ticker = (new URLSearchParams(location.search).get("t") || location.hash.slice(1) || "").toUpperCase().replace(/[^A-Z0-9]/g,"");

// Como ler cada indicador: dir -1 = menor é melhor, +1 = maior é melhor
const IND = [
  {k:"pl",  l:"P/L",              fmt:v=>f1.format(v), dir:-1, valido:v=>v>0},
  {k:"pvp", l:"P/VP",             fmt:v=>f2.format(v), dir:-1, valido:v=>v>0},
  {k:"dy",  l:"DY 12m",           fmt:v=>pct(v),       dir:+1},
  {k:"roe", l:"ROE",              fmt:v=>pct(v),       dir:+1},
  {k:"ml",  l:"Margem líquida",   fmt:v=>pct(v),       dir:+1},
  {k:"dle", l:"Dív. líq./EBITDA", fmt:v=>f1.format(v)+"x", dir:-1},
];

let charts = {};
let B3PROV = null;   // proventos da B3: [data com, pagamento, valor, tipo]
let precoRange = "1A", precoModo = "preco", tipoGraf = "linha", GRAF = null;

// Índice de retorno total: proventos reinvestidos na data ex (mesma conta do coletor).
function indiceRT(D, C, provs){
  const P = provs.map(([d,v])=>[d,v]).sort((a,b)=>a[0]<b[0]?-1:1);
  let j = 0; while (j<P.length && P[j][0]<=D[0]) j++;
  const idx=[1];
  for (let i=1;i<D.length;i++){
    let div=0; while (j<P.length && P[j][0]<=D[i]) { div+=P[j][1]; j++; }
    idx.push(idx[i-1]*(C[i]+div)/C[i-1]);
  }
  return idx;
}
let multK = "dy", multPer = "5A", ATUAL = null;
const MULT = [
  {k:"dy",  l:"DY 12m", fmt:v=>f1.format(v*100)+"%", eixo:v=>f1.format(v*100)+"%", melhor:+1,
   nota:"DY de cada mês = proventos pagos nos 12 meses anteriores ÷ cotação no fim do mês."},
  {k:"pl",  l:"P/L",    fmt:v=>f1.format(v),         eixo:v=>f1.format(v),          melhor:-1,
   nota:"P/L de cada mês = valor de mercado no fim do mês ÷ lucro dos últimos 12 meses já publicado naquela data. Meses com prejuízo ficam em branco."},
  {k:"pvp", l:"P/VP",   fmt:v=>f2.format(v),         eixo:v=>f2.format(v),          melhor:-1,
   nota:"P/VP de cada mês = valor de mercado no fim do mês ÷ patrimônio líquido do último balanço já publicado naquela data."},
];

async function main(){
  let dados;
  try { dados = await fetch("dados.json",{cache:"no-cache"}).then(r=>{ if(!r.ok) throw 0; return r.json(); }); }
  catch(e){ $("conteudo").innerHTML = '<div class="msg">Não foi possível carregar os dados do radar.</div>'; return; }
  const acoes = dados.acoes;
  R.ligarBusca(acoes);

  const a = acoes.find(x=>x.t===ticker);
  if(!a){ $("conteudo").innerHTML = `<div class="msg">${ticker? `<b>${esc(ticker)}</b> não está no radar.` : "Nenhum ticker informado."} Volte ao <a href="./">radar</a> e escolha uma ação, ou adicione o ticker em tickers.csv.</div>`; return; }
  document.title = `${a.t} · Radar de Ações B3`;

  let det = null;
  try { det = await fetch(`acoes/${a.t}.json`,{cache:"no-cache"}).then(r=> r.ok? r.json() : null); } catch(e){}
  const pb3 = await R.carregar("mercado/proventos.json");
  B3PROV = pb3?.itens?.[a.t] || null;

  const pares = acoes.filter(x=>x.setor===a.setor);
  render(a, det, pares, dados);
}

function cardHTML(ind, a, pares){
  const sus = (a.alertas||[]).some(x=>x.k===ind.k);
  return cardBase(ind, a, pares).replace('<span class="label">', sus? '<span class="label">⚠ ' : '<span class="label">');
}
function cardBase(ind, a, pares){
  if(ind.k==="dle" && a.fin) return `<div class="card"><span class="label">${ind.l}</span><span class="v na">n/a</span><span class="cmp">Não se aplica a ${a.banco?"bancos":"seguradoras"}</span></div>`;
  const v = a[ind.k];
  const ok = x => x!=null && isFinite(x) && (!ind.valido || ind.valido(x));
  const med = median(pares.filter(p=>p.t!==a.t).map(p=>p[ind.k]).filter(ok));
  let tag = "";
  if (v==null) tag = "";
  else if (ind.k==="pl" && v<0) tag = '<span class="tag bad">prejuízo em 12 meses</span>';
  else if (med!=null && ok(v)) {
    const melhor = ind.dir>0 ? v>med : v<med;
    const igual = Math.abs(v-med) <= Math.abs(med)*0.05;
    tag = igual? '<span class="tag neu">em linha com o setor</span>'
        : melhor? '<span class="tag good">melhor que o setor</span>' : '<span class="tag bad">pior que o setor</span>';
  }
  const n = pares.length-1;
  const cmp = med==null? (n? "Sem base no setor" : "Única do setor no radar") : `Mediana do setor: ${ind.fmt(med)} <span class="na">(${n} ${n===1?"empresa":"empresas"})</span>`;
  return `<div class="card"><span class="label">${ind.l}</span><span class="v">${v==null?"–":ind.fmt(v)}</span>${tag}<span class="cmp">${cmp}</span></div>`;
}

function render(a, det, pares, dados){
  const at = new Date(dados.atualizado_em);
  const quando = isNaN(at)? dados.atualizado_em : at.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
  const varCls = a.var>0?"pos":a.var<0?"neg":"na";
  let r52 = "";
  if (det && det.min52!=null && det.max52>det.min52) {
    const p = Math.min(100, Math.max(0, (a.preco-det.min52)/(det.max52-det.min52)*100));
    r52 = `<div class="range52"><span class="label">Faixa de 52 semanas</span><div class="bar"><span class="dot" style="left:${p}%"></span></div><div class="ends"><span>${brl(det.min52)}</span><span>${brl(det.max52)}</span></div></div>`;
  }
  let html = `
  <div class="hero">
    <div class="hero-id">
      ${R.logo(a, 64)}
      <div>
        <h1>${esc(a.t)}</h1>
        <div class="sub"><b>${esc(a.n)}</b> · ${esc(a.setor)} · valor de mercado ${big(a.mc)}</div>
        <a class="btn" id="cmp" href="comparar.html?t=${encodeURIComponent(a.t)}" style="margin-top:10px;font-size:13px;padding:6px 12px">Comparar com outras</a>
      </div>
    </div>
    ${r52}
    <div class="price">
      <span class="v">${brl(a.preco)}</span>
      <span class="d ${varCls}">${a.var>0?"+":""}${a.var==null?"–":f2.format(a.var*100)+"%"} no dia</span>
      <span class="label" style="text-transform:none;letter-spacing:0;font-weight:400">Atualizado em ${quando}</span>
    </div>
  </div>
  ${(a.alertas||[]).length? `<div class="alertas" role="note"><b>Dados para conferir</b><ul>${a.alertas.map(x=>`<li>${esc(x.m)}</li>`).join("")}</ul><span class="small">Os números vêm do Yahoo Finance. Antes de usar, compare com o RI da empresa ou com o balanço na CVM.</span></div>` : ""}
  <div class="cards">${IND.map(i=>cardHTML(i,a,pares)).join("")}</div>
  <section class="panel bz" id="bz" aria-labelledby="t-bz"></section>`;

  if (!det) {
    html += `<div class="msg">O histórico de cotação e proventos de ${a.t} ainda não foi coletado. Ele aparece depois da próxima coleta diária.</div>`;
    $("conteudo").innerHTML = html; desenharBarsi(a, null); configurarAssistente(a, null, pares, quando); return;
  }

  // período da cotação
  html += `
  <section class="panel">
    <div class="ph">
      <h2>Cotação e retorno</h2>
      <div class="ranges" id="modo"><button type="button" data-m="preco">Preço</button><button type="button" data-m="retorno">Retorno total</button></div>
      <span class="note" id="var-periodo"></span>
      <div class="ranges" id="tipo"><button type="button" data-t="linha">Linha</button><button type="button" data-t="candle">Candles</button></div>
      <div class="ranges" id="ranges">${["1D","5D","1M","6M","1A","2A","5A"].map(r=>`<button type="button" data-r="${r}">${r}</button>`).join("")}</div>
    </div>
    <div class="chart" id="cx-preco"><canvas id="c-preco" aria-label="Gráfico de cotação de ${a.t}"></canvas></div>
    <div class="chart lwc" id="lwc" hidden aria-label="Gráfico de candles de ${a.t}"></div>
  </section>`;

  if (det.multiplos) html += `
  <section class="panel">
    <div class="ph">
      <h2>Indicadores ao longo do tempo</h2>
      <div class="ranges" id="mult-ind">${MULT.map(m=>`<button type="button" data-k="${m.k}">${m.l}</button>`).join("")}</div>
      <div class="ranges" id="mult-per">${["3A","5A","10A"].map(r=>`<button type="button" data-r="${r}">${r}</button>`).join("")}</div>
    </div>
    <div class="stats" id="mult-stats"></div>
    <div class="chart short"><canvas id="c-mult" aria-label="Evolução dos indicadores de ${a.t}"></canvas></div>
    <p class="note small" id="mult-nota"></p>
  </section>`;

  const anual = det.proventos_anual || [];
  const pagos = anual.filter(x=>x.total>0);
  const dyMedio = (()=>{ const c = anual.filter(x=>!x.parcial && x.dy!=null).slice(-5); return c.length? c.reduce((s,x)=>s+x.dy,0)/c.length : null; })();
  html += `
  <section class="panel">
    <div class="ph">
      <h2>Proventos</h2>
      <span class="note">Últimos 12 meses: <b>${brl(det.proventos_12m)}</b> por ação · DY médio de 5 anos: <b>${pct(dyMedio)}</b></span>
    </div>
    ${pagos.length? `<div class="two">
      <div class="chart short"><canvas id="c-prov" aria-label="Proventos por ano de ${a.t}"></canvas></div>
      ${tabelaProventos(det)}
    </div>` : `<div class="empty">O Yahoo não registra proventos de ${a.t} nos últimos 10 anos.</div>`}
  </section>`;

  const res = det.resultados || [];
  html += `
  <section class="panel">
    <div class="ph">
      <h2>Receita e lucro por ano</h2>
      <span class="note">Exercícios fiscais completos${det.resultados_convertidos_de? ` · convertidos de ${det.resultados_convertidos_de} pelo câmbio médio de cada ano` : det.resultados_moeda? ` · valores em ${det.resultados_moeda}` : ""}</span>
    </div>
    ${res.length? `<div class="chart short"><canvas id="c-res" aria-label="Receita e lucro anuais de ${a.t}"></canvas></div>` : `<div class="empty">O Yahoo não traz o resultado anual de ${a.t}.</div>`}
  </section>`;

  $("conteudo").innerHTML = html;
  desenharBarsi(a, det);
  document.addEventListener("radar:dy-alvo", () => desenharBarsi(a, det));
  configurarAssistente(a, det, pares, quando);

  if (!window.Chart) { document.querySelectorAll(".chart").forEach(c=>c.innerHTML='<div class="empty">Os gráficos não carregaram. Verifique a conexão e recarregue a página.</div>'); return; }
  try { precoRange = localStorage.getItem("radar-range") || precoRange; } catch(e){}
  ATUAL = a;
  try { multK = localStorage.getItem("radar-mult") || multK; multPer = localStorage.getItem("radar-mult-per") || multPer; } catch(e){}
  desenharTudo(det);
  if ($("mult-ind")) {
    $("mult-ind").onclick = e => { const b=e.target.closest("button"); if(!b) return; multK=b.dataset.k; try{localStorage.setItem("radar-mult",multK);}catch(e){} desenharMultiplos(det); };
    $("mult-per").onclick = e => { const b=e.target.closest("button"); if(!b) return; multPer=b.dataset.r; try{localStorage.setItem("radar-mult-per",multPer);}catch(e){} desenharMultiplos(det); };
  }
  try { precoModo = localStorage.getItem("radar-modo") || precoModo; } catch(e){}
  $("modo").onclick = e => { const b=e.target.closest("button"); if(!b) return; precoModo=b.dataset.m; try{localStorage.setItem("radar-modo",precoModo);}catch(e){} desenharPreco(det); };
  $("ranges").onclick = e => { const b=e.target.closest("button"); if(!b) return; precoRange=b.dataset.r; try{localStorage.setItem("radar-range",precoRange);}catch(e){} desenharPreco(det); };
  try { tipoGraf = localStorage.getItem("radar-tipo-grafico") || tipoGraf; } catch(e){}
  $("tipo").onclick = e => { const b=e.target.closest("button"); if(!b) return; tipoGraf=b.dataset.t; try{localStorage.setItem("radar-tipo-grafico",tipoGraf);}catch(e){} desenharPreco(det); };
  document.addEventListener("radar:tema", ()=>{ GRAF?.parar(); GRAF=null; desenharTudo(det); });
}

// Tabela de proventos: com data de pagamento e tipo quando a B3 informa; senão, pela data ex do Yahoo
function tabelaProventos(det){
  const hoje = new Date().toISOString().slice(0,10);
  if (B3PROV?.length){
    const futuros = B3PROV.filter(x=>x[1] && x[1]>=hoje);
    return `<div style="display:grid;gap:10px;align-content:start">
      ${futuros.length? `<div class="prox-pag"><span class="label">Já anunciado</span>${futuros.slice(0,4).map(([dc,dp,v,t])=>`<div><b>R$ ${f4.format(v)}</b> · ${esc(t)} · paga em <b>${dataBR(dp)}</b><small>data com ${dataBR(dc)}</small></div>`).join("")}</div>` : ""}
      <div class="tablebox"><table><thead><tr><th>Data com</th><th>Pagamento</th><th>Tipo</th><th>R$ por ação</th></tr></thead><tbody>
      ${B3PROV.slice(0,40).map(([dc,dp,v,t])=>`<tr${dp && dp>=hoje? ' class="futuro"' : ""}><td>${dataBR(dc)}</td><td>${dp? dataBR(dp) : "a definir"}</td><td>${esc(t)}</td><td>${f4.format(v)}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="note small">Fonte: B3, últimos 12 meses e pagamentos já anunciados. JCP com valor bruto (antes do IR de 15%).</p></div>`;
  }
  return `<div class="tablebox"><table><thead><tr><th>Data ex</th><th>R$ por ação</th></tr></thead><tbody>
    ${det.proventos.slice(0,40).map(([d,v])=>`<tr><td>${dataBR(d)}</td><td>${f4.format(v)}</td></tr>`).join("")}
  </tbody></table></div>`;
}

// Painel do método Barsi: preço-teto, número mágico e checklist dos critérios
function desenharBarsi(a, det){
  const el = $("bz"); if (!el) return;
  const alvo = R.dyAlvo(), b = R.barsi(a, alvo), c = b.crit;
  const alvoTxt = R.nf(1).format(alvo*100).replace(",0","");
  const item = (ok, titulo, detalhe) => `<li class="${ok===true?"ok":ok===false?"no":"nd"}"><span class="ic" aria-hidden="true">${ok===true?"✓":ok===false?"✕":"–"}</span><div><b>${titulo}</b><span>${detalhe}</span></div></li>`;
  const anos = det?.dividendos?.anos || [];
  const maxAno = Math.max(...anos.map(x=>x[1]), 0) || 1;
  const prov = a.pm5 || a.prov12;
  const magico = prov > 0 ? Math.ceil(a.preco / prov) : null;
  const sinal1 = x => x==null? "–" : (x>0?"+":"")+f1.format(x*100)+"%";
  el.innerHTML = `
    <div class="ph"><div><h2 id="t-bz">Método Barsi</h2><p class="note">Critérios de quem investe para viver de proventos. Ponto de partida para estudo, não recomendação.</p></div>
      <label class="bz-alvo">DY desejado <input id="bz-alvo" inputmode="decimal" value="${alvoTxt}" aria-label="Dividend yield desejado, em porcentagem"> %</label></div>
    <div class="bz-wrap">
      <div class="bz-teto">
        <span class="label">Preço-teto</span>
        <span class="v">${b.teto? brl(b.teto) : "–"}</span>
        ${b.teto? `<span class="tag ${b.desconto>=0?"good":"bad"}">cotação ${pct(Math.abs(b.desconto),0)} ${b.desconto>=0?"abaixo":"acima"} do teto</span>` : ""}
        <span class="cmp">${a.pm5? `Média dos proventos de 5 anos (${brl(a.pm5)} por ação) / ${alvoTxt}%` : "Precisa de 5 anos completos de histórico de proventos"}</span>
        ${a.dist5? `<span class="aviso">⚠ Um dos 5 anos teve provento muito acima dos outros (possível extraordinário): o teto pode estar inflado.</span>` : ""}
        <div class="bz-mini">
          <div><span class="label">DY médio de 5 anos na cotação de hoje</span><b>${pct(b.dy5)}</b></div>
          <div><span class="label">Número mágico</span><b>${magico? R.f0.format(magico)+" ações" : "–"}</b></div>
        </div>
        ${magico? `<span class="cmp">Com ${R.f0.format(magico)} ações (${brl(magico*a.preco)} hoje), os proventos de um ano compram uma ação nova, pela média de 5 anos.</span>` : ""}
      </div>
      <ul class="bz-check">
        ${item(c.best, "Setor perene", c.best? `${esc(a.setor)}: está entre Bancos, Energia, Saneamento, Seguros e Telecom` : `${esc(a.setor)} não está entre os setores perenes do método`)}
        ${item(c.reg, "Proventos regulares", a.regb? `Pagou em ${a.reg} dos últimos ${a.regb} anos completos${a.quedas5? ` · ${a.quedas5} ${a.quedas5===1?"ano":"anos"} de queda forte (mais de 25%) nos últimos 5` : ""}` : "Sem histórico suficiente")}
        ${item(c.teto, "Abaixo do preço-teto", b.teto? `Cotação ${brl(a.preco)} · teto ${brl(b.teto)} para DY de ${alvoTxt}%` : "Sem 5 anos completos de proventos")}
        ${item(c.lucro, "Lucro consistente", a.lucro_n? `Lucro em ${a.lucro_pos} de ${a.lucro_n} exercícios${a.lucro_cagr!=null? ` · crescimento de ${sinal1(a.lucro_cagr)} ao ano` : ""}` : a.pl!=null? (a.pl>0? "Lucro nos últimos 12 meses" : "Prejuízo nos últimos 12 meses") : "Sem dados de lucro")}
        ${item(c.payout, "Payout sustentável", a.payout!=null? `Distribui ${pct(a.payout,0)} do lucro${a.payout>1? ": paga mais do que lucra" : ""}` : "Payout não informado pela fonte (comum em units)")}
        ${item(c.divida, "Dívida controlada", a.fin? "Não se aplica a bancos e seguradoras" : a.dle!=null? `Dív. líq./EBITDA de ${f1.format(a.dle)}x (limite ${f1.format(b.limiteDiv)}x${b.limiteDiv>3? " para concessões reguladas" : ""})` : "Sem dados de dívida")}
      </ul>
    </div>
    ${anos.length? `<div class="bz-anos" role="img" aria-label="Proventos por ano">${anos.map(([y,v])=>`<div class="${v>0?"":"zero"}" title="${y}: ${v>0? "R$ "+f4.format(v)+" por ação" : "sem proventos"}"><i style="height:${Math.max(4, v/maxAno*100)}%"></i><span>${String(y).slice(2)}</span></div>`).join("")}</div>
      <p class="note small">Proventos por ano completo${a.cagr5!=null? ` · crescimento médio de ${sinal1(a.cagr5)} ao ano nos últimos 5 anos` : ""}. Dividendos e JCP somados, valores brutos.</p>` : ""}`;
  $("bz-alvo").onchange = e => {
    const v = parseFloat(String(e.target.value).replace(",", "."));
    if (v>=1 && v<=30) R.definirDyAlvo(v/100); else e.target.value = alvoTxt;
  };
}

function configurarAssistente(a, det, pares, quando){
  if (!window.Assistente) return;
  const sinal = x => x==null? "–" : (x>0?"+":"")+f1.format(x*100)+"%";
  const ind = i => { const v=a[i.k]; if (i.k==="dle" && a.fin) return `${i.l} n/a`; return `${i.l} ${v==null?"–":i.fmt(v)}`; };
  const med = i => { const v = median(pares.filter(p=>p.t!==a.t).map(p=>p[i.k]).filter(x=>x!=null && isFinite(x) && (!i.valido||i.valido(x)))); return `${i.l} ${v==null?"–":i.fmt(v)}`; };
  const r = det?.retorno || {};
  const linhas = [
    `${a.t} (${a.n}), setor ${a.setor}. Cotação ${brl(a.preco)} em ${quando} (${sinal(a.var)} no dia). Valor de mercado ${big(a.mc)}.`,
    `Indicadores: ${IND.map(ind).join(" | ")}.`,
    pares.length>1? `Medianas do setor no radar (${pares.length-1} empresas): ${IND.map(med).join(" | ")}.` : "",
    r["1a"]? `Retorno total 12m ${sinal(r["1a"].t)} (só cotação ${sinal(r["1a"].p)})${r["5a"]? `; 5 anos ${sinal(r["5a"].t)} (só cotação ${sinal(r["5a"].p)})` : ""}.` : "",
    det? `Proventos 12m: ${brl(det.proventos_12m)} por ação. Faixa de 52 semanas: ${brl(det.min52)} a ${brl(det.max52)}.` : "",
    a.pm5? `Método Barsi: média de proventos de 5 anos ${brl(a.pm5)} por ação; preço-teto ${brl(a.pm5/R.dyAlvo())} para DY desejado de ${pct(R.dyAlvo())}; pagou proventos em ${a.reg}/${a.regb} anos; payout ${a.payout==null?"–":pct(a.payout,0)}; setor ${a.best?"perene (BEST)":"fora do BEST"}.` : "",
    (a.alertas||[]).length? `Alertas de dados: ${a.alertas.map(x=>x.m).join(" ")}` : "",
  ].filter(Boolean);
  const r12 = r["1a"]? sinal(r["1a"].t) : null;
  Assistente.configurar({
    contexto: () => linhas.join("\n"),
    sugestoes: () => [
      `Quais as notícias mais recentes sobre ${a.t} e como podem afetar a ação?`,
      r12? `Por que ${a.t} teve retorno total de ${r12} em 12 meses?` : `O que explica o desempenho recente de ${a.t}?`,
      `${a.t} está cara ou barata frente ao próprio histórico e ao setor? Quais os riscos?`,
      `${a.t} se encaixa no método Barsi? Analise setor, regularidade dos dividendos e preço-teto.`,
      `Os proventos de ${a.t} são sustentáveis? Explique a política de dividendos.`,
    ],
  });
}

function base(){
  const ink=css("--muted"), line=css("--line");
  Chart.defaults.font.family = css("--font-num") || "monospace";
  Chart.defaults.font.size = 11;
  Chart.defaults.color = ink;
  return {
    responsive:true, maintainAspectRatio:false, animation:false,
    interaction:{mode:"index",intersect:false},
    plugins:{legend:{display:false}, tooltip:{backgroundColor:css("--ink"),titleColor:css("--bg"),bodyColor:css("--bg"),padding:10,displayColors:false}},
    scales:{x:{grid:{display:false},border:{color:line},ticks:{maxRotation:0,autoSkipPadding:18}},
            y:{grid:{color:line},border:{display:false}}}
  };
}

function desenharTudo(det){ desenharPreco(det); desenharMultiplos(det); desenharProventos(det); desenharResultados(det); }

function desenharMultiplos(det){
  const el=$("c-mult"); if(!el) return;
  const M = det.multiplos, cfg = MULT.find(m=>m.k===multK) || MULT[0];
  document.querySelectorAll("#mult-ind button").forEach(b=>b.setAttribute("aria-pressed", String(b.dataset.k===cfg.k)));
  document.querySelectorAll("#mult-per button").forEach(b=>b.setAttribute("aria-pressed", String(b.dataset.r===multPer)));
  const n = {"3A":36,"5A":60,"10A":120}[multPer];
  const ini = Math.max(0, M.m.length - n - 1);
  let L = M.m.slice(ini), V = M[cfg.k].slice(ini);
  const primeiro = V.findIndex(v=>v!=null);
  if (primeiro>0) { L = L.slice(primeiro); V = V.slice(primeiro); }   // começa onde há dado
  const val = V.filter(v=>v!=null);
  $("mult-nota").textContent = cfg.nota;
  el.parentElement.hidden = !val.length;
  if (!val.length) {
    const motivo = cfg.k==="dy"? `O Yahoo não registra proventos de ${ATUAL.t} no período.` : `O Yahoo não traz balanços suficientes de ${ATUAL.t} para calcular o ${cfg.l} no período.`;
    $("mult-stats").innerHTML = `<div class="empty" style="grid-column:1/-1">${motivo}</div>`;
    charts.mult?.destroy(); charts.mult=null; return;
  }
  const media = val.reduce((s,v)=>s+v,0)/val.length;
  const atual = [...V].reverse().find(v=>v!=null);
  const desde = L[V.findIndex(v=>v!=null)];
  const dif = media? atual/media-1 : null;
  const bom = dif!=null && Math.abs(dif)>0.05 && (cfg.melhor>0 ? dif>0 : dif<0);
  const ruim = dif!=null && Math.abs(dif)>0.05 && !bom;
  const leitura = dif==null? "" : Math.abs(dif)<=0.05? "em linha com a média" : `${f1.format(Math.abs(dif)*100)}% ${dif>0?"acima":"abaixo"} da média`;
  const mesBR = s => { const [y,m]=s.split("-"); return `${m}/${y}`; };
  $("mult-stats").innerHTML = `
    <div><span class="label">Atual</span><span class="v">${cfg.fmt(atual)}</span><span class="tag ${bom?"good":ruim?"bad":"neu"}">${leitura}</span></div>
    <div><span class="label">Média do período</span><span class="v">${cfg.fmt(media)}</span><span class="cmp">desde ${mesBR(desde)}</span></div>
    <div><span class="label">Mínima</span><span class="v">${cfg.fmt(Math.min(...val))}</span><span class="cmp">${mesBR(L[V.indexOf(Math.min(...val))])}</span></div>
    <div><span class="label">Máxima</span><span class="v">${cfg.fmt(Math.max(...val))}</span><span class="cmp">${mesBR(L[V.indexOf(Math.max(...val))])}</span></div>`;
  const acc = css("--accent"), mut = css("--muted");
  const o = base();
  const curto = L.length<=40;
  o.scales.x.ticks.callback = function(v){ const s=this.getLabelForValue(v); const [y,m]=s.split("-"); return curto? `${m}/${y.slice(2)}` : (m==="01"? y : ""); };
  o.scales.x.ticks.autoSkip = curto;
  o.scales.y.ticks = {callback:cfg.eixo};
  o.plugins.tooltip.callbacks = {title:it=>mesBR(it[0].label), label:it=> it.datasetIndex? `Média: ${cfg.fmt(media)}` : `${cfg.l}: ${cfg.fmt(it.parsed.y)}`};
  charts.mult?.destroy();
  charts.mult = new Chart(el,{type:"line",data:{labels:L,datasets:[
    {data:V,borderColor:acc,backgroundColor:acc,borderWidth:2,pointRadius:V.map((v,i)=>i===V.length-1?4:0),pointHoverRadius:4,spanGaps:false,tension:0},
    {data:L.map(()=>media),borderColor:mut,borderWidth:1.25,borderDash:[5,4],pointRadius:0,pointHoverRadius:0}
  ]},options:o});
}

// Candles e "ao vivo": dados do servidor do site (Yahoo), atualizados a cada minuto no 1D
function desenharCandles(){
  $("cx-preco").hidden = true; $("lwc").hidden = false; $("modo").hidden = true;
  const atualizar = info => {
    if (info.erro) { $("var-periodo").innerHTML = `<span class="na">${info.erro}</span>`; return; }
    const hora = info.quando.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
    const v = info.varPeriodo;
    $("var-periodo").innerHTML = `${info.aberto? '<span class="vivo">ao vivo</span>' : ""}${v==null? "" : `No período: <b class="${v>=0?"pos":"neg"}">${v>0?"+":""}${f1.format(v*100)}%</b> · `}<span title="Cotações da B3 têm até 15 minutos de atraso nas fontes gratuitas">último negócio ${hora}</span>`;
  };
  if (!GRAF) GRAF = Candles.montar($("lwc"), { simbolo: ATUAL.t + ".SA", tipo: tipoGraf, faixa: precoRange, formatar: v => "R$ " + f2.format(v), aoAtualizar: atualizar });
  else GRAF.mudar({ tipo: tipoGraf, faixa: precoRange });
}

function desenharPreco(det){
  document.querySelectorAll("#ranges button").forEach(b=>b.setAttribute("aria-pressed", String(b.dataset.r===precoRange)));
  document.querySelectorAll("#modo button").forEach(b=>b.setAttribute("aria-pressed", String(b.dataset.m===precoModo)));
  document.querySelectorAll("#tipo button").forEach(b=>b.setAttribute("aria-pressed", String(b.dataset.t===tipoGraf)));
  if (window.Candles && (tipoGraf==="candle" || precoRange==="1D" || precoRange==="5D")) return desenharCandles();
  GRAF?.parar(); GRAF = null;
  $("cx-preco").hidden = false; $("lwc").hidden = true; $("modo").hidden = false;
  const meses = {"1M":1,"6M":6,"1A":12,"2A":24,"5A":60}[precoRange];
  const fim = new Date(det.precos.d[det.precos.d.length-1]+"T12:00:00");
  const ini = new Date(fim); ini.setMonth(ini.getMonth()-meses);
  const iniS = ini.toISOString().slice(0,10);
  let i0 = det.precos.d.findIndex(d=>d>=iniS); if(i0<0) i0=0;
  const D = det.precos.d.slice(i0), C = det.precos.c.slice(i0);
  const R = indiceRT(D, C, det.proventos||[]);
  const v = C.length>1? C[C.length-1]/C[0]-1 : null;
  const t = R.length>1? R[R.length-1]-1 : null;
  const sinal = x => `<b class="${x>=0?"pos":"neg"}">${x>0?"+":""}${f1.format(x*100)}%</b>`;
  const curto = D.length && (new Date(D[0]) - ini) > 10*864e5 ? ` <span class="na">(histórico desde ${dataBR(D[0])})</span>` : "";
  $("var-periodo").innerHTML = v==null? "" : `Só cotação: ${sinal(v)} · Com proventos: ${sinal(t)}${curto}`;
  const o = base();
  o.scales.x.ticks.callback = function(val){ const d=this.getLabelForValue(val); const [y,m,dd]=d.split("-"); return meses<=6? `${dd}/${m}` : `${m}/${y.slice(2)}`; };
  const ctx = $("c-preco");
  charts.preco?.destroy();
  if (precoModo==="retorno"){
    const acc=css("--accent"), mut=css("--muted");
    o.plugins.legend = {display:true,position:"bottom",labels:{boxWidth:14,boxHeight:2}};
    o.scales.y.ticks = {callback:x=>(x>0?"+":"")+f1.format(x)+"%"};
    o.plugins.tooltip.callbacks = {title:it=>dataBR(it[0].label), label:it=>`${it.dataset.label}: ${it.parsed.y>0?"+":""}${f1.format(it.parsed.y)}%`};
    o.plugins.tooltip.displayColors = true;
    charts.preco = new Chart(ctx,{type:"line",data:{labels:D,datasets:[
      {label:"Retorno total (proventos reinvestidos)",data:R.map(x=>(x-1)*100),borderColor:acc,backgroundColor:acc,borderWidth:2,pointRadius:0,pointHoverRadius:4,tension:0},
      {label:"Só cotação",data:C.map(c=>(c/C[0]-1)*100),borderColor:mut,backgroundColor:mut,borderWidth:1.5,borderDash:[5,4],pointRadius:0,pointHoverRadius:3,tension:0}
    ]},options:o});
  } else {
    const cor = v==null||v>=0? css("--good") : css("--bad");
    o.scales.y.ticks = {callback:x=>"R$ "+f2.format(x)};
    o.plugins.tooltip.callbacks = {title:it=>dataBR(it[0].label), label:it=>brl(it.parsed.y)};
    const g = ctx.getContext("2d").createLinearGradient(0,0,0,300);
    g.addColorStop(0, cor+"33"); g.addColorStop(1, cor+"00");
    charts.preco = new Chart(ctx,{type:"line",data:{labels:D,datasets:[{data:C,borderColor:cor,backgroundColor:g,fill:true,borderWidth:1.75,pointRadius:0,pointHoverRadius:4,tension:0}]},options:o});
  }
}

function desenharProventos(det){
  const el=$("c-prov"); if(!el) return;
  const A = det.proventos_anual.filter((x,i,arr)=> arr.slice(0,i+1).some(y=>y.total>0)); // começa no 1º ano com pagamento
  const acc=css("--accent"), acc2=css("--accent-2");
  const o = base();
  o.plugins.legend = {display:true,position:"bottom",labels:{boxWidth:10,boxHeight:10,usePointStyle:false}};
  o.scales.y.ticks = {callback:v=>"R$ "+f2.format(v)};
  o.scales.y.title = {display:false};
  o.scales.y2 = {position:"right",grid:{display:false},border:{display:false},ticks:{callback:v=>f1.format(v)+"%"},min:0};
  o.plugins.tooltip.callbacks = {
    title:it=>{ const x=A[it[0].dataIndex]; return x.parcial? `${x.ano} (até hoje)` : String(x.ano); },
    label:it=> it.datasetIndex===0? `Proventos: R$ ${f4.format(it.parsed.y)} por ação` : `DY: ${f1.format(it.parsed.y)}%`
  };
  charts.prov?.destroy();
  charts.prov = new Chart(el,{data:{labels:A.map(x=>x.parcial? x.ano+"*" : String(x.ano)),datasets:[
    {type:"bar",label:"R$ por ação",data:A.map(x=>x.total),backgroundColor:A.map(x=>x.parcial? acc+"66" : acc),borderRadius:3,yAxisID:"y",order:2},
    {type:"line",label:"DY no ano",data:A.map(x=>x.dy==null?null:x.dy*100),borderColor:acc2,backgroundColor:acc2,borderWidth:2,pointRadius:3,yAxisID:"y2",order:1,tension:0}
  ]},options:o});
}

function desenharResultados(det){
  const el=$("c-res"); if(!el) return;
  const R = det.resultados;
  const div = Math.max(...R.map(r=>Math.abs(r.receita||0)), ...R.map(r=>Math.abs(r.lucro||0))) >= 1e9 ? 1e9 : 1e6;
  const un = div===1e9? "bi" : "mi";
  const cur = det.resultados_moeda && !det.resultados_convertidos_de ? det.resultados_moeda+" " : "R$ ";
  const o = base();
  o.plugins.legend = {display:true,position:"bottom",labels:{boxWidth:10,boxHeight:10,
    generateLabels:ch=>Chart.defaults.plugins.legend.labels.generateLabels(ch).map((l,i)=>({...l, fillStyle: i? css("--accent") : css("--muted")+"55", strokeStyle:"transparent"}))}};
  o.scales.y.ticks = {callback:v=>cur+f1.format(v)+" "+un};
  o.plugins.tooltip.callbacks = {
    label:it=>`${it.dataset.label}: ${cur}${f2.format(it.parsed.y)} ${un}`,
    afterBody:it=>{ const r=R[it[0].dataIndex]; return r.receita&&r.lucro!=null? `Margem líquida: ${f1.format(r.lucro/r.receita*100)}%` : ""; }
  };
  charts.res?.destroy();
  charts.res = new Chart(el,{type:"bar",data:{labels:R.map(r=>String(r.ano)),datasets:[
    {label:"Receita",data:R.map(r=>r.receita==null?null:r.receita/div),backgroundColor:css("--muted")+"55",borderRadius:3},
    {label:"Lucro líquido",data:R.map(r=>r.lucro==null?null:r.lucro/div),backgroundColor:R.map(r=>(r.lucro||0)<0? css("--bad") : css("--accent")),borderRadius:3}
  ]},options:o});
}

main();
