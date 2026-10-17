"use strict";
const $ = id => document.getElementById(id);
const nf = d => new Intl.NumberFormat("pt-BR",{minimumFractionDigits:d,maximumFractionDigits:d});
const f1=nf(1), f2=nf(2);
const pct = (x,d=1) => x==null||!isFinite(x)? "–" : nf(d).format(x*100)+"%";
const brl = x => x==null? "–" : "R$ "+f2.format(x);
const big = x => { if(x==null) return "–"; const a=Math.abs(x);
  if(a>=1e12) return "R$ "+f2.format(x/1e12)+" tri"; if(a>=1e9) return "R$ "+f1.format(x/1e9)+" bi"; return "R$ "+f1.format(x/1e6)+" mi"; };
const esc = s => String(s).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const COR = i => css("--s"+(i+1));
const MAX = 4;

let ACOES = [], MAPA = {}, DET = {}, sel = [];
let perfPer = "1A", perfModo = "total", multK = "dy", charts = {};

const LINHAS = [
  {g:"Preço"},
  {l:"Cotação", v:a=>a.preco, fmt:brl},
  {l:"Variação no dia", v:a=>a.var, fmt:v=>(v>0?"+":"")+pct(v,2), sinal:true},
  {l:"Retorno total 12 meses", sub:"com proventos reinvestidos", v:(a,d)=>perf(d,12,true), fmt:v=>(v>0?"+":"")+pct(v), sinal:true, melhor:+1},
  {l:"Retorno total 5 anos", sub:"com proventos reinvestidos", v:(a,d)=>perf(d,60,true), fmt:v=>(v>0?"+":"")+pct(v), sinal:true, melhor:+1},
  {l:"Só cotação 12 meses", v:(a,d)=>perf(d,12), fmt:v=>(v>0?"+":"")+pct(v), sinal:true},
  {l:"Valor de mercado", v:a=>a.mc, fmt:big},
  {g:"Valuation"},
  {l:"P/L", v:a=>a.pl, fmt:v=>f1.format(v), melhor:-1, valido:v=>v>0},
  {l:"P/VP", v:a=>a.pvp, fmt:v=>f2.format(v), melhor:-1, valido:v=>v>0},
  {g:"Proventos"},
  {l:"DY 12m", v:a=>a.dy, fmt:v=>pct(v), melhor:+1},
  {l:"DY médio 5 anos", v:(a,d)=>dyMedio(d), fmt:v=>pct(v), melhor:+1},
  {l:"Proventos 12m", sub:"R$ por ação", v:(a,d)=>d?.proventos_12m, fmt:brl},
  {g:"Rentabilidade e dívida"},
  {l:"ROE", v:a=>a.roe, fmt:v=>pct(v), melhor:+1, sinal:true},
  {l:"Margem líquida", v:a=>a.ml, fmt:v=>pct(v), melhor:+1, sinal:true},
  {l:"Dív. líq./EBITDA", v:a=>a.fin? undefined : a.dle, fmt:v=>f1.format(v)+"x", melhor:-1},
  {g:"Empresa"},
  {l:"Setor", v:a=>a.setor, txt:true},
];

function perf(d, meses, total){
  if(!d) return null; const D=d.precos.d, C=d.precos.c; if(!D.length) return null;
  const ini=new Date(D[D.length-1]+"T12:00:00"); ini.setMonth(ini.getMonth()-meses);
  const s=ini.toISOString().slice(0,10); const i=D.findIndex(x=>x>=s);
  if(i<0 || (new Date(D[i])-ini) > 15*864e5) return null;
  if (!total) return C[C.length-1]/C[i]-1;
  const R = indiceRT(D.slice(i), C.slice(i), d.proventos||[]);
  return R[R.length-1]-1;
}
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
function dyMedio(d){
  if(!d) return null; const c=(d.proventos_anual||[]).filter(x=>!x.parcial && x.dy!=null).slice(-5);
  return c.length? c.reduce((s,x)=>s+x.dy,0)/c.length : null;
}

async function main(){
  try { const dados = await fetch("dados.json",{cache:"no-cache"}).then(r=>{ if(!r.ok) throw 0; return r.json(); });
        ACOES = dados.acoes; ACOES.forEach(a=>MAPA[a.t]=a); }
  catch(e){ $("conteudo").innerHTML='<div class="msg">Não foi possível carregar os dados do radar.</div>'; return; }
  $("lista").innerHTML = ACOES.map(a=>`<option value="${a.t}">${esc(a.n)}</option>`).join("");
  const q = (new URLSearchParams(location.search).get("t")||"").toUpperCase().split(",").map(s=>s.replace(/[^A-Z0-9]/g,"")).filter(t=>MAPA[t]);
  sel = [...new Set(q)].slice(0,MAX);
  $("add").onsubmit = e => { e.preventDefault(); adicionar($("add-t").value.trim().toUpperCase()); $("add-t").value=""; };
  try { perfModo = localStorage.getItem("radar-cmp-modo") || perfModo; perfPer = localStorage.getItem("radar-cmp-per") || perfPer; multK = localStorage.getItem("radar-cmp-mult") || multK; } catch(e){}
  atualizar();
}

function adicionar(t){
  if(!MAPA[t]){ $("add-t").setCustomValidity(t? `${t} não está no radar` : "Digite um ticker"); $("add-t").reportValidity(); setTimeout(()=>$("add-t").setCustomValidity(""),1500); return; }
  if(sel.includes(t) || sel.length>=MAX) return;
  sel.push(t); atualizar();
}
function remover(t){ sel = sel.filter(x=>x!==t); atualizar(); }

async function atualizar(){
  history.replaceState(null,"", sel.length? `?t=${sel.join(",")}` : location.pathname);
  document.title = sel.length? `${sel.join(" × ")} · Comparador` : "Comparador · Radar de Ações B3";
  $("chips").innerHTML = sel.map((t,i)=>`<span class="chip"><i style="background:${COR(i)}"></i>${t}<button type="button" aria-label="Remover ${t}" data-t="${t}">×</button></span>`).join("");
  $("chips").querySelectorAll("button").forEach(b=>b.onclick=()=>remover(b.dataset.t));
  $("add-btn").disabled = sel.length>=MAX; $("add-t").disabled = sel.length>=MAX;
  $("add-t").placeholder = sel.length>=MAX? "Máximo de 4" : "Ticker";
  sugestoes();
  if (sel.length<2){
    $("conteudo").innerHTML = `<div class="msg">${sel.length? `Adicione mais uma ação para comparar com ${sel[0]}.` : "Adicione pelo menos duas ações."} Os atalhos acima trazem empresas do mesmo setor.</div>`;
    Object.values(charts).forEach(c=>c?.destroy()); charts={}; return;
  }
  await Promise.all(sel.filter(t=>!(t in DET)).map(async t=>{
    try { DET[t] = await fetch(`acoes/${t}.json`,{cache:"no-cache"}).then(r=>r.ok? r.json(): null); } catch(e){ DET[t]=null; }
  }));
  render();
}

function sugestoes(){
  let pool;
  if (sel.length){
    const setores = new Set(sel.map(t=>MAPA[t].setor));
    pool = ACOES.filter(a=>setores.has(a.setor) && !sel.includes(a.t)).sort((a,b)=>(b.mc||0)-(a.mc||0)).slice(0,6);
  } else {
    const pares = [["PETR4","PRIO3","VALE3"],["ITUB4","BBDC4","BBAS3","SANB11"],["TAEE11","EGIE3","CMIG4","CPLE3"],["WEGE3","EMBJ3"]];
    $("sugest").innerHTML = `Exemplos: ${pares.map(p=>`<button type="button" data-p="${p.join(",")}">${p.join(" × ")}</button>`).join("")}`;
    $("sugest").querySelectorAll("button").forEach(b=>b.onclick=()=>{ sel=b.dataset.p.split(",").filter(t=>MAPA[t]).slice(0,MAX); atualizar(); });
    return;
  }
  if (!pool.length || sel.length>=MAX){ $("sugest").innerHTML=""; return; }
  $("sugest").innerHTML = `Mesmo setor: ${pool.map(a=>`<button type="button" data-t="${a.t}">+ ${a.t}</button>`).join("")}`;
  $("sugest").querySelectorAll("button").forEach(b=>b.onclick=()=>adicionar(b.dataset.t));
}

function render(){
  const A = sel.map(t=>MAPA[t]), D = sel.map(t=>DET[t]);
  let rows = "";
  for (const L of LINHAS){
    if (L.g){ rows += `<tr class="grp"><th colspan="${sel.length+1}">${L.g}</th></tr>`; continue; }
    const vals = A.map((a,i)=>L.v(a,D[i]));
    let best = -1;
    if (L.melhor){
      const ok = vals.map(v=> v!=null && isFinite(v) && (!L.valido || L.valido(v)));
      const cand = vals.map((v,i)=>ok[i]? v : null);
      if (cand.filter(v=>v!=null).length>=2){
        const alvo = L.melhor>0? Math.max(...cand.filter(v=>v!=null)) : Math.min(...cand.filter(v=>v!=null));
        best = cand.indexOf(alvo);
      }
    }
    rows += `<tr><th scope="row">${L.l}${L.sub?`<small>${L.sub}</small>`:""}</th>${vals.map((v,i)=>{
      if (L.txt) return `<td style="font-family:var(--font-body)">${esc(v)}</td>`;
      if (v===undefined) return `<td class="na" title="Não se aplica">n/a</td>`;
      if (v==null || !isFinite(v)) return `<td class="na">–</td>`;
      const cls = i===best? "best" : (L.sinal||L.l==="P/L") && v<0? "neg" : "";
      return `<td class="${cls}">${L.fmt(v)}</td>`;
    }).join("")}</tr>`;
  }
  const head = `<tr><th></th>${A.map((a,i)=>`<th><i style="background:${COR(i)}"></i><a href="acao.html?t=${a.t}">${a.t}</a>${(a.alertas||[]).length? ` <span class="conferir" title="${esc(a.alertas.map(x=>x.m).join("\n"))}">conferir</span>`:""}<span class="nm">${esc(a.n)}</span></th>`).join("")}</tr>`;
  const legenda = A.map((a,i)=>`<span><i style="background:${COR(i)}"></i>${a.t}</span>`).join("");
  const semHist = sel.filter(t=>!DET[t]);
  $("conteudo").innerHTML = `
  <div style="display:grid;gap:18px">
    <section class="panel">
      <div class="ph"><h2>Indicadores</h2><span class="note">Toque no ticker para abrir a página da ação</span></div>
      <div class="tablebox"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>
    </section>
    <section class="panel">
      <div class="ph"><h2>Desempenho</h2>
        <div class="ranges" id="perf-modo"><button type="button" data-m="total">Com proventos</button><button type="button" data-m="preco">Só cotação</button></div>
        <div class="ranges" id="perf-per">${["6M","1A","2A","5A"].map(r=>`<button type="button" data-r="${r}">${r}</button>`).join("")}</div></div>
      <div class="legend">${legenda}</div>
      <div class="chart"><canvas id="c-perf" aria-label="Desempenho comparado da cotação"></canvas></div>
      <p class="note" id="perf-nota"><span></span>${semHist.length? ` Sem histórico: ${semHist.join(", ")}.`:""}</p>
    </section>
    <section class="panel">
      <div class="ph"><h2>Indicadores ao longo do tempo</h2>
        <div class="ranges" id="mult-k">${[["dy","DY 12m"],["pl","P/L"],["pvp","P/VP"]].map(([k,l])=>`<button type="button" data-k="${k}">${l}</button>`).join("")}</div></div>
      <div class="legend">${legenda}</div>
      <div class="chart"><canvas id="c-mult" aria-label="Indicadores comparados ao longo do tempo"></canvas></div>
      <p class="note">Valores mensais dos últimos 5 anos. P/L e P/VP só existem a partir dos balanços disponíveis na fonte; meses com prejuízo ficam em branco.</p>
    </section>
    <section class="panel">
      <div class="ph"><h2>DY por ano</h2><span class="note">Proventos do ano ÷ cotação de fechamento do ano · * ano em curso</span></div>
      <div class="legend">${legenda}</div>
      <div class="chart"><canvas id="c-dy" aria-label="DY anual comparado"></canvas></div>
    </section>
  </div>`;
  if (!window.Chart){ document.querySelectorAll(".chart").forEach(c=>c.innerHTML='<p class="msg">Os gráficos não carregaram. Verifique a conexão e recarregue.</p>'); return; }
  $("perf-modo").onclick = e=>{ const b=e.target.closest("button"); if(!b) return; perfModo=b.dataset.m; try{localStorage.setItem("radar-cmp-modo",perfModo);}catch(_){} desenharPerf(); };
  $("perf-per").onclick = e=>{ const b=e.target.closest("button"); if(!b) return; perfPer=b.dataset.r; try{localStorage.setItem("radar-cmp-per",perfPer);}catch(_){} desenharPerf(); };
  $("mult-k").onclick = e=>{ const b=e.target.closest("button"); if(!b) return; multK=b.dataset.k; try{localStorage.setItem("radar-cmp-mult",multK);}catch(_){} desenharMult(); };
  desenharPerf(); desenharMult(); desenharDY();
  configurarAssistente();
}

function configurarAssistente(){
  if (!window.Assistente) return;
  const sinal = x => x==null? "–" : (x>0?"+":"")+f1.format(x*100)+"%";
  const linhas = sel.map(t=>{ const a=MAPA[t], d=DET[t];
    return `${t} (${a.n}, ${a.setor}): cotação ${brl(a.preco)}; P/L ${a.pl==null?"–":f1.format(a.pl)}; P/VP ${a.pvp==null?"–":f2.format(a.pvp)}; DY 12m ${pct(a.dy)}; ROE ${pct(a.roe)}; margem ${pct(a.ml)}; dív.líq./EBITDA ${a.fin||a.dle==null?"n/a":f1.format(a.dle)+"x"}; retorno total 12m ${sinal(perf(d,12,true))}, 5 anos ${sinal(perf(d,60,true))}.${(a.alertas||[]).length? " Alerta: "+a.alertas.map(x=>x.m).join(" ") : ""}`; });
  const lista = sel.join(", ").replace(/, ([^,]*)$/," e $1");
  Assistente.configurar({
    contexto: () => linhas.join("\n"),
    sugestoes: () => [
      `Compare ${lista}: quais têm fundamentos mais sólidos e quais os principais riscos de cada uma?`,
      `Quais notícias recentes afetam ${lista}?`,
      `Por que os retornos de ${lista} foram tão diferentes nos últimos 12 meses?`,
    ],
  });
}

function base(){
  Chart.defaults.font.family = css("--font-num") || "monospace";
  Chart.defaults.font.size = 11; Chart.defaults.color = css("--muted");
  return { responsive:true, maintainAspectRatio:false, animation:false, interaction:{mode:"index",intersect:false},
    plugins:{legend:{display:false}, tooltip:{backgroundColor:css("--ink"),titleColor:css("--bg"),bodyColor:css("--bg"),padding:10,boxPadding:4,usePointStyle:true}},
    scales:{x:{grid:{display:false},border:{color:css("--line")},ticks:{maxRotation:0,autoSkipPadding:18}}, y:{grid:{color:css("--line")},border:{display:false}}} };
}

function desenharPerf(){
  document.querySelectorAll("#perf-per button").forEach(b=>b.setAttribute("aria-pressed", String(b.dataset.r===perfPer)));
  document.querySelectorAll("#perf-modo button").forEach(b=>b.setAttribute("aria-pressed", String(b.dataset.m===perfModo)));
  $("perf-nota").firstChild && ($("perf-nota").firstChild.textContent = perfModo==="total"
    ? "Base 100 no início do período, com proventos brutos reinvestidos na data ex: 120 significa retorno de 20%."
    : "Base 100 no início do período, só a variação da cotação: 120 significa alta de 20%.");
  const meses = {"6M":6,"1A":12,"2A":24,"5A":60}[perfPer];
  // o período termina no último pregão coletado (não em "agora"), igual à tabela
  const ultimo = sel.map(t=>DET[t]?.precos.d.at(-1)).filter(Boolean).sort().at(-1);
  const datas = new Set(); const fim = new Date((ultimo||new Date().toISOString().slice(0,10))+"T12:00:00"); const ini = new Date(fim); ini.setMonth(ini.getMonth()-meses);
  const iniS = ini.toISOString().slice(0,10);
  const series = sel.map(t=>{ const d=DET[t]; if(!d) return null;
    const i0 = d.precos.d.findIndex(x=>x>=iniS); if(i0<0) return null;
    const D = d.precos.d.slice(i0), C = d.precos.c.slice(i0);
    const V = perfModo==="total"? indiceRT(D, C, d.proventos||[]) : C;
    const m=new Map(); D.forEach((x,i)=>{ m.set(x,V[i]); datas.add(x); }); return m; });
  const L = [...datas].sort();
  const ds = series.map((m,i)=>{
    if(!m||!m.size) return null; let b=null, ult=null;
    const data = L.map(x=>{ const v=m.get(x); if(v!=null){ if(b==null) b=v; ult=v/b*100; return ult; } return b==null? null : ult; });
    return {label:sel[i],data,borderColor:COR(i),backgroundColor:COR(i),borderWidth:2,pointRadius:0,pointHoverRadius:3,tension:0};
  }).filter(Boolean);
  const o = base();
  o.scales.x.ticks.callback = function(v){ const [y,m,d]=this.getLabelForValue(v).split("-"); return meses<=6? `${d}/${m}` : `${m}/${y.slice(2)}`; };
  o.scales.y.ticks = {callback:v=>f1.format(v)};
  o.plugins.tooltip.callbacks = {title:it=>{const [y,m,d]=it[0].label.split("-"); return `${d}/${m}/${y}`;}, label:it=>`${it.dataset.label}: ${it.parsed.y>=100?"+":""}${f1.format(it.parsed.y-100)}%`};
  charts.perf?.destroy();
  charts.perf = new Chart($("c-perf"),{type:"line",data:{labels:L,datasets:ds},options:o});
}

function desenharMult(){
  document.querySelectorAll("#mult-k button").forEach(b=>b.setAttribute("aria-pressed", String(b.dataset.k===multK)));
  const meses = new Set();
  sel.forEach(t=>DET[t]?.multiplos?.m.slice(-61).forEach(m=>meses.add(m)));
  const L = [...meses].sort();
  const ds = sel.map((t,i)=>{
    const M = DET[t]?.multiplos; if(!M) return null;
    const idx = new Map(M.m.map((m,j)=>[m,j]));
    return {label:t,data:L.map(m=> idx.has(m)? M[multK][idx.get(m)] : null),borderColor:COR(i),backgroundColor:COR(i),borderWidth:2,pointRadius:0,pointHoverRadius:3,spanGaps:false,tension:0};
  }).filter(Boolean);
  const fmt = multK==="dy"? v=>f1.format(v*100)+"%" : multK==="pl"? v=>f1.format(v) : v=>f2.format(v);
  const o = base();
  o.scales.x.ticks.callback = function(v){ const [y,m]=this.getLabelForValue(v).split("-"); return m==="01"? y : ""; };
  o.scales.x.ticks.autoSkip = false;
  o.scales.y.ticks = {callback:fmt};
  o.plugins.tooltip.callbacks = {title:it=>{const [y,m]=it[0].label.split("-"); return `${m}/${y}`;}, label:it=>`${it.dataset.label}: ${fmt(it.parsed.y)}`};
  charts.mult?.destroy();
  charts.mult = new Chart($("c-mult"),{type:"line",data:{labels:L,datasets:ds},options:o});
}

function desenharDY(){
  const anos = new Set();
  sel.forEach(t=>(DET[t]?.proventos_anual||[]).slice(-6).forEach(x=>anos.add(x.ano)));
  const L = [...anos].sort();
  const atual = new Date().getFullYear();
  const ds = sel.map((t,i)=>{
    const P = DET[t]?.proventos_anual; if(!P) return null; const m = new Map(P.map(x=>[x.ano,x.dy]));
    return {label:t,data:L.map(a=> m.has(a)&&m.get(a)!=null? m.get(a)*100 : null),backgroundColor:COR(i),borderRadius:3};
  }).filter(Boolean);
  const o = base();
  o.scales.y.ticks = {callback:v=>f1.format(v)+"%"}; o.scales.y.min = 0;
  o.plugins.tooltip.callbacks = {label:it=>`${it.dataset.label}: ${f1.format(it.parsed.y)}%`};
  charts.dy?.destroy();
  charts.dy = new Chart($("c-dy"),{type:"bar",data:{labels:L.map(a=>a===atual? a+"*" : String(a)),datasets:ds},options:o});
}

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", ()=>{ if(sel.length>=2) atualizar(); });
main();
