"use strict";
const PAYLOAD = (()=>{ try { return JSON.parse(document.getElementById("dados").textContent); } catch(e){ return null; } })();
const DATA = (PAYLOAD && PAYLOAD.acoes) || [];
(function cabecalho(){
  if (!PAYLOAD) { document.querySelector(".meta").textContent = "Sem dados ainda. Rode coletar.py para gerar a página."; return; }
  const d = new Date(PAYLOAD.atualizado_em);
  const quando = isNaN(d) ? PAYLOAD.atualizado_em : d.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
  document.getElementById("quando").textContent = quando;
  document.getElementById("fonte").textContent = PAYLOAD.fonte + ", coleta de " + quando + ".";
  const f = PAYLOAD.falhas || [];
  if (f.length) { const el = document.getElementById("falhas"); el.hidden = false;
    el.textContent = "Não coletadas nesta atualização: " + f.map(x=>x.t).join(", ") + ". Confira se o ticker mudou e ajuste tickers.csv."; }
})();

const COLS = [
  {k:"t",   l:"Ativo",          dir:1},
  {k:"preco",l:"Cotação",       dir:-1},
  {k:"var", l:"Dia",            dir:-1},
  {k:"pl",  l:"P/L",            dir:1},
  {k:"pvp", l:"P/VP",           dir:1},
  {k:"dy",  l:"DY 12m",         dir:-1},
  {k:"roe", l:"ROE",            dir:-1},
  {k:"ml",  l:"Mg. líq.",       dir:-1},
  {k:"dle", l:"Dív. líq./EBITDA",dir:1},
  {k:"rt12",l:"Retorno 12m",   dir:-1},
  {k:"mc",  l:"Valor de mercado",dir:-1},
];

const RANKS = [
  {id:"dy",  l:"Maiores DY",        sort:["dy",-1]},
  {id:"pl",  l:"Menores P/L",       sort:["pl",1],  only:o=>o.pl>0},
  {id:"pvp", l:"Menores P/VP",      sort:["pvp",1], only:o=>o.pvp>0},
  {id:"roe", l:"Maiores ROE",       sort:["roe",-1]},
  {id:"ml",  l:"Maiores margens",   sort:["ml",-1]},
  {id:"dle", l:"Menos endividadas", sort:["dle",1], only:o=>o.dle!=null},
  {id:"rt12",l:"Maiores retornos 12m", sort:["rt12",-1], only:o=>o.rt12!=null},
  {id:"mc",  l:"Maiores empresas",  sort:["mc",-1]},
];

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const nf = (d)=> new Intl.NumberFormat("pt-BR",{minimumFractionDigits:d,maximumFractionDigits:d});
const f2 = nf(2), f1 = nf(1);
const pct = x => x==null? "–" : f1.format(x*100)+"%";
const brl = x => "R$ "+f2.format(x);
const big = x => { if(x==null) return "–"; const a=Math.abs(x);
  if(a>=1e12) return "R$ "+f2.format(x/1e12)+" tri"; if(a>=1e9) return "R$ "+f1.format(x/1e9)+" bi"; return "R$ "+f1.format(x/1e6)+" mi"; };

let state = {q:"",setor:"",rank:null,sort:"mc",dir:-1,f:{},lucro:false,semfin:false,semalerta:false,soalerta:false,open:null};
try { const s = JSON.parse(localStorage.getItem("radar-b3")||"null"); if (s) state = {...state, ...s, open:null}; } catch(e){}
const save = ()=>{ try{ localStorage.setItem("radar-b3", JSON.stringify({...state,open:null})); }catch(e){} };

// setores
[...new Set(DATA.map(d=>d.setor))].sort((a,b)=>a.localeCompare(b,"pt-BR")).forEach(s=>{
  const o=document.createElement("option"); o.value=s; o.textContent=s; $("setor").append(o);
});
// rankings
RANKS.forEach(r=>{ const b=document.createElement("button"); b.type="button"; b.className="chip"; b.textContent=r.l; b.dataset.id=r.id;
  b.onclick=()=>{ if(state.rank===r.id){state.rank=null;} else {state.rank=r.id; state.sort=r.sort[0]; state.dir=r.sort[1];} render(); };
  $("rankings").append(b); });
// cabeçalho
COLS.forEach(c=>{ const th=document.createElement("th"); th.scope="col"; th.dataset.k=c.k;
  const b=document.createElement("button"); b.type="button"; b.innerHTML=`<span>${c.l}</span><span class="arr"></span>`;
  b.onclick=()=>{ if(state.sort===c.k) state.dir*=-1; else {state.sort=c.k; state.dir=c.dir;} state.rank=null; render(); };
  th.append(b); $("thead").append(th); });

const FKEYS = {"f-plmax":["pl","max",1],"f-pvpmax":["pvp","max",1],"f-dymin":["dy","min",100],"f-roemin":["roe","min",100],"f-mlmin":["ml","min",100],"f-dlmax":["dle","max",1]};
Object.keys(FKEYS).forEach(id=>{ const el=$(id); if(state.f[id]!=null) el.value=state.f[id];
  el.addEventListener("input",()=>{ const v=el.value.replace(",","."); state.f[id]= v===""? null : +v; render(); }); });
if (Object.values(state.f).some(v=>v!=null) || state.lucro || state.semfin) $("avancado").open = true;
$("busca").value=state.q; $("setor").value=state.setor; $("f-lucro").checked=state.lucro; $("f-semfin").checked=state.semfin;
$("busca").addEventListener("input",e=>{state.q=e.target.value; render();});
$("setor").addEventListener("change",e=>{state.setor=e.target.value; render();});
$("f-lucro").addEventListener("change",e=>{state.lucro=e.target.checked; render();});
$("f-semfin").addEventListener("change",e=>{state.semfin=e.target.checked; render();});
$("f-semalerta").checked=state.semalerta;
$("f-semalerta").addEventListener("change",e=>{state.semalerta=e.target.checked; if(state.semalerta) state.soalerta=false; render();});
$("limpar").onclick=()=>{ state.f={}; state.lucro=false; state.semfin=false; state.semalerta=false; state.soalerta=false; $("f-semalerta").checked=false; state.q=""; state.setor=""; state.rank=null;
  Object.keys(FKEYS).forEach(id=>$(id).value=""); $("f-lucro").checked=false; $("f-semfin").checked=false; $("busca").value=""; $("setor").value=""; render(); };

const norm = s => s.normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
function filtered(){
  const q = norm(state.q.trim());
  const rk = RANKS.find(r=>r.id===state.rank);
  return DATA.filter(o=>{
    if (q && !norm(o.t+" "+o.n).includes(q)) return false;
    if (state.setor && o.setor!==state.setor) return false;
    if (state.lucro && !(o.pl>0)) return false;
    if (state.semfin && o.fin) return false;
    const temAlerta = (o.alertas||[]).length>0;
    if (state.semalerta && temAlerta) return false;
    if (state.soalerta && !temAlerta) return false;
    if (rk && rk.only && !rk.only(o)) return false;
    for (const [id,[k,mode,mul]] of Object.entries(FKEYS)) {
      const lim = state.f[id]; if (lim==null || isNaN(lim)) continue;
      const v = o[k]; if (v==null) return false;
      if (mode==="max" && (v>lim || (k==="pl"&&v<=0))) return false;   // P/L negativo não passa no filtro de P/L
      if (mode==="min" && v*mul < lim) return false;
    }
    return true;
  });
}
function sorted(arr){
  const {sort:k,dir} = state;
  return arr.slice().sort((a,b)=>{
    let x=a[k], y=b[k];
    if (k==="t") return dir*x.localeCompare(y);
    if (k==="pl"||k==="dle") { if (x!=null&&x<=0&&k==="pl") x=null; if (y!=null&&y<=0&&k==="pl") y=null; } // prejuízo vai para o fim
    if (x==null && y==null) return 0; if (x==null) return 1; if (y==null) return -1;
    return dir*(x-y);
  });
}
const median = a => { const s=a.filter(v=>v!=null&&isFinite(v)).sort((x,y)=>x-y); if(!s.length) return null; const m=s.length>>1; return s.length%2? s[m] : (s[m-1]+s[m])/2; };

function cell(k,o){
  const v=o[k];
  switch(k){
    case "preco": return brl(v);
    case "var": return v==null?"–":`<span class="${v>0?"pos":v<0?"neg":"na"}">${v>0?"+":""}${f2.format(v*100)}%</span>`;
    case "pl": if(v==null) return '<span class="na">–</span>'; if(v<0) return `<span class="pill bad" title="Prejuízo nos últimos 12 meses">${f1.format(v)}</span>`;
               return v>40? `<span class="pill warn">${f1.format(v)}</span>` : f1.format(v);
    case "pvp": return v==null?"–": f2.format(v);
    case "dy": return v>=0.06? `<span class="pill good">${pct(v)}</span>` : v===0? '<span class="na">0,0%</span>' : pct(v);
    case "roe": return v==null?"–": v<0? `<span class="pill bad">${pct(v)}</span>` : v>=0.15? `<span class="pill good">${pct(v)}</span>` : pct(v);
    case "ml": return v==null?"–": v<0? `<span class="pill bad">${pct(v)}</span>` : v>=0.15? `<span class="pill good">${pct(v)}</span>` : pct(v);
    case "dle": if(o.banco) return '<span class="na" title="Não se aplica a bancos">n/a</span>';
                if(v==null) return '<span class="na">–</span>';
                if(v<0) return `<span class="pill good" title="Caixa maior que a dívida">${f1.format(v)}</span>`;
                return v>3? `<span class="pill bad">${f1.format(v)}x</span>` : v>2? `<span class="pill warn">${f1.format(v)}x</span>` : f1.format(v)+"x";
    case "rt12": return v==null? '<span class="na">–</span>' : `<span class="${v>0?"pos":v<0?"neg":"na"}" title="Só cotação: ${o.var12==null?"–":(o.var12>0?"+":"")+f1.format(o.var12*100)+"%"}">${v>0?"+":""}${f1.format(v*100)}%</span>`;
    case "mc": return big(v);
  }
}
function detail(o){
  const notes=[];
  const al = (o.alertas||[]).map(a=>`<li>${esc(a.m)}</li>`).join("");
  if (o.banco) notes.push("Bancos não usam dívida líquida/EBITDA: captar e emprestar dinheiro é o próprio negócio. Para eles, P/VP e ROE costumam ser os indicadores centrais.");
  else if (o.fin) notes.push("Seguradoras e a B3 operam com caixa elevado; compare-as entre si.");
  if (o.pl!=null && o.pl<0) notes.push("P/L negativo: a empresa teve prejuízo nos últimos 12 meses, então o múltiplo não serve para medir se está barata.");
  if (o.dle!=null && o.dle<0) notes.push("Dívida líquida negativa: o caixa supera a dívida total.");
  return `<div class="dgrid">
    ${al? `<div class="alertas"><b>Dados para conferir</b><ul>${al}</ul></div>` : ""}
    <div><span class="k">Setor</span><span class="v" style="font-family:var(--font-body)">${esc(o.setor)}</span></div>
    <div><span class="k">LPA (lucro/ação)</span><span class="v">${o.lpa==null?"–":brl(o.lpa)}</span></div>
    <div><span class="k">Dívida total</span><span class="v">${big(o.div)}</span></div>
    <div><span class="k">Caixa</span><span class="v">${big(o.cx)}</span></div>
    <div><span class="k">Dívida líquida</span><span class="v">${big(o.dl)}</span></div>
    <div><span class="k">EBITDA 12m</span><span class="v">${big(o.ebitda)}</span></div>
    ${notes.length?`<p class="dnote">${notes.join(" ")}</p>`:""}
    <p class="dnote"><a href="acao.html?t=${esc(o.t)}">Abrir a página de ${esc(o.t)}: cotação, proventos e resultados →</a> · <a href="comparar.html?t=${esc(o.t)}">Comparar com outras →</a></p>
  </div>`;
}

function render(){
  const rows = sorted(filtered());
  document.querySelectorAll("#rankings .chip").forEach(b=>b.setAttribute("aria-pressed", String(b.dataset.id===state.rank)));
  document.querySelectorAll("#thead th").forEach(th=>{
    const on = th.dataset.k===state.sort;
    if (on) th.setAttribute("aria-sort", state.dir>0?"ascending":"descending"); else th.removeAttribute("aria-sort");
    th.querySelector(".arr").textContent = on? (state.dir>0?"↑":"↓") : "";
  });
  const tb=$("tbody"); tb.innerHTML="";
  rows.forEach(o=>{
    const tr=document.createElement("tr"); if(state.open===o.t) tr.className="open";
    const al = o.alertas||[], ks = new Set(al.map(a=>a.k));
    const pill = al.length? ` <span class="conferir" title="${esc(al.map(a=>a.m).join("\n"))}">conferir</span>` : "";
    tr.innerHTML = `<td><a class="tk" href="acao.html?t=${encodeURIComponent(o.t)}">${esc(o.t)}</a>${pill} <span class="setor-tag">· ${esc(o.setor)}</span><span class="nm">${esc(o.n)}</span></td>` +
      COLS.slice(1).map(c=>{ const sus = ks.has(c.k); const msg = sus? esc(al.filter(a=>a.k===c.k).map(a=>a.m).join("\n")) : "";
        return `<td${sus?` class="sus" title="${msg}"`:""}>${cell(c.k,o)}</td>`; }).join("");
    tr.onclick=(e)=>{ if(e.target.closest('a')) return; state.open = state.open===o.t? null : o.t; render(); };
    tb.append(tr);
    if (state.open===o.t){ const d=document.createElement("tr"); d.className="detail"; d.innerHTML=`<td colspan="${COLS.length}">${detail(o)}</td>`; tb.append(d); }
  });
  $("vazio").hidden = rows.length>0;
  const nAl = DATA.filter(o=>(o.alertas||[]).length).length;
  $("alerta-meta").innerHTML = nAl? ` · <button type="button" class="btn-alerta" id="ver-alertas" aria-pressed="${state.soalerta}">${state.soalerta? "Mostrar todas" : `${nAl} com dados para conferir`}</button>` : "";
  if (nAl) $("ver-alertas").onclick = ()=>{ state.soalerta=!state.soalerta; if(state.soalerta){ state.semalerta=false; $("f-semalerta").checked=false; } render(); };
  $("nsel").textContent = rows.length; $("total").textContent = DATA.length;
  const lucr = rows.filter(o=>o.pl>0);
  const M = [
    ["P/L", median(lucr.map(o=>o.pl)), v=>f1.format(v)],
    ["P/VP", median(rows.map(o=>o.pvp)), v=>f2.format(v)],
    ["DY 12m", median(rows.map(o=>o.dy)), pct],
    ["ROE", median(rows.map(o=>o.roe)), pct],
    ["Mg. líquida", median(rows.map(o=>o.ml)), pct],
    ["Dív. líq./EBITDA", median(rows.filter(o=>!o.banco).map(o=>o.dle)), v=>f1.format(v)+"x"],
  ];
  $("medianas").innerHTML = M.map(([k,v,fmt])=>`<div class="med"><span class="k">${k}</span><span class="v">${v==null?"–":fmt(v)}</span></div>`).join("");
  save();
}
render();

if (window.Assistente) Assistente.configurar({
  contexto: () => {
    const rows = sorted(filtered());
    const filtros = [state.setor && `setor ${state.setor}`, state.rank && `ranking "${(RANKS.find(r=>r.id===state.rank)||{}).l}"`, state.q && `busca "${state.q}"`].filter(Boolean).join(", ");
    const top = rows.slice(0,12).map(o=>`${esc(o.t)}: P/L ${o.pl==null?"–":f1.format(o.pl)}, P/VP ${o.pvp==null?"–":f2.format(o.pvp)}, DY ${pct(o.dy)}, ROE ${pct(o.roe)}, ret.12m ${o.rt12==null?"–":pct(o.rt12)}`).join("\n");
    return `Lista do radar com ${rows.length} de ${DATA.length} ações${filtros? " (filtros: "+filtros+")" : ""}, atualizada em ${$("quando").textContent}.\nPrimeiras da lista:\n${top}`;
  },
  sugestoes: () => {
    const s = ["Quais notícias movimentaram a bolsa brasileira nesta semana?", "Explique P/L, P/VP e DY e quando cada um pode enganar."];
    if (state.setor) s.unshift(`Como está o setor de ${state.setor} na B3 hoje e quais os principais riscos?`);
    if (state.rank) s.unshift(`Analise as primeiras ações deste ranking: o que explica os números e quais cuidados ter?`);
    return s;
  },
});
