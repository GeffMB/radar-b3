/* Assistente do Radar B3 — chat dentro do site.
 *
 * O navegador envia a pergunta (e os dados da página) para o servidor intermediário do site
 * (Cloudflare Worker, pasta worker/), que consulta o Google Gemini com busca na web e devolve
 * a resposta. Nenhuma chave fica no site. Nada é guardado: a conversa vive só nesta aba.
 *
 * Cada página chama:
 *   Assistente.configurar({ contexto: () => "dados da página", sugestoes: () => ["pergunta", ...] })
 */
(function () {
  // Impede que o site seja exibido dentro de uma página de terceiros (clickjacking).
  // O GitHub Pages não permite o cabeçalho X-Frame-Options, então a proteção é feita aqui.
  // Navegadores bloqueiam o redirecionamento da página de cima, então o conteúdo é escondido.
  if (window.top !== window.self) {
    document.documentElement.style.display = "none";
    try { window.top.location = window.self.location.href; } catch (e) { /* bloqueado: segue escondido */ }
  }

  // Endereço do servidor do assistente. Vazio = ainda não ativado.
  const ENDPOINT = "https://radar-assistente.gefersonmarques.workers.dev";
  const LIMITE_PERGUNTA = 500, LIMITE_CONTEXTO = 2500, HISTORICO = 6;
  let cfg = { contexto: () => "", sugestoes: () => [] };
  const conversa = [];          // [{papel:"usuario"|"assistente"|"erro", texto, fontes?}]
  let ocupado = false;

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Markdown simples e seguro: tudo é escapado antes; só negrito, itálico, listas e títulos viram HTML.
  function md(t) {
    const linhas = esc(t).split("\n");
    let html = "", lista = null;
    const fecha = () => { if (lista) { html += `</${lista}>`; lista = null; } };
    const inline = s => s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
    for (const l of linhas) {
      let m;
      if ((m = l.match(/^\s*[-*•]\s+(.*)/))) { if (lista !== "ul") { fecha(); html += "<ul>"; lista = "ul"; } html += `<li>${inline(m[1])}</li>`; }
      else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (lista !== "ol") { fecha(); html += "<ol>"; lista = "ol"; } html += `<li>${inline(m[1])}</li>`; }
      else if ((m = l.match(/^\s*#{1,4}\s+(.*)/))) { fecha(); html += `<p class="ast-h">${inline(m[1])}</p>`; }
      else if (l.trim() === "") { fecha(); }
      else { fecha(); html += `<p>${inline(l)}</p>`; }
    }
    fecha();
    return html;
  }

  // Ícones desenhados para o site (traço simples, herdam a cor do texto)
  const IC = {
    brilho: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5c.6 3.9 1.9 6.4 3.6 7.9 1.5 1.3 3.5 2 5.9 2.1-2.4.2-4.4.9-5.9 2.2-1.7 1.5-3 4-3.6 7.8-.6-3.8-1.9-6.3-3.6-7.8C6.9 13.4 4.9 12.7 2.5 12.5c2.4-.1 4.4-.8 5.9-2.1 1.7-1.5 3-4 3.6-7.9z"/><path fill="currentColor" opacity=".65" d="M19 2.8c.25 1.3.7 2.1 1.3 2.6.5.45 1.2.7 2 .75-.8.05-1.5.3-2 .75-.6.5-1.05 1.3-1.3 2.6-.25-1.3-.7-2.1-1.3-2.6-.5-.45-1.2-.7-2-.75.8-.05 1.5-.3 2-.75.6-.5 1.05-1.3 1.3-2.6z"/></svg>',
    novo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h8"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/></svg>',
    fechar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    enviar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
    seta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    alerta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17v.5"/><path d="M10.3 3.9L2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  };

  const css = `
  .ast-btn,.ast-pan{--ag1:#29656A;--ag2:#45857A}
  .ast-btn{position:fixed;right:calc(18px + env(safe-area-inset-right,0px));bottom:calc(18px + env(safe-area-inset-bottom,0px));z-index:50;
    height:56px;min-width:56px;padding:0 16px;border:0;border-radius:999px;cursor:pointer;color:#fff;
    background:linear-gradient(135deg,var(--ag1),var(--ag2));box-shadow:0 10px 28px color-mix(in srgb,var(--ag2) 40%,transparent),0 2px 6px rgba(0,0,0,.12);
    display:flex;align-items:center;gap:0;font:700 15px/1 var(--font-body,system-ui,sans-serif);transition:transform .2s,box-shadow .2s,gap .25s}
  .ast-btn svg{width:24px;height:24px;flex:none}
  .ast-btn span{max-width:0;overflow:hidden;white-space:nowrap;transition:max-width .3s ease}
  .ast-btn:hover{transform:translateY(-2px);gap:8px}
  .ast-btn:hover span,.ast-btn:focus-visible span{max-width:120px}
  .ast-btn[aria-expanded=true]{transform:scale(.92)}
  .ast-pan{position:fixed;right:calc(18px + env(safe-area-inset-right,0px));bottom:calc(86px + env(safe-area-inset-bottom,0px));z-index:51;
    width:min(410px,calc(100vw - 32px));height:min(640px,calc(100vh - 120px));display:flex;flex-direction:column;overflow:hidden;
    background:var(--surface,#fff);color:var(--ink,#22302E);border:1px solid color-mix(in srgb,var(--line,#E2E9E5) 70%,transparent);border-radius:22px;
    box-shadow:0 24px 60px rgba(20,34,32,.28),0 2px 8px rgba(20,34,32,.08);font:15px/1.55 var(--font-body,system-ui,sans-serif);transform-origin:bottom right}
  .ast-pan[hidden]{display:none}
  @media (prefers-reduced-motion:no-preference){.ast-pan:not([hidden]){animation:astin .22s cubic-bezier(.2,.8,.2,1)}}
  @keyframes astin{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}

  .ast-top{display:flex;align-items:center;gap:10px;padding:14px 12px 10px 16px}
  .ast-orb{flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,var(--ag1),var(--ag2))}
  .ast-orb svg{width:18px;height:18px}
  .ast-orb.p{width:26px;height:26px}.ast-orb.p svg{width:14px;height:14px}
  .ast-tit{flex:1;min-width:0;line-height:1.2}
  .ast-tit b{display:block;font-family:var(--font-display,inherit);font-size:16px;letter-spacing:-.01em}
  .ast-tit small{font-size:12px;color:var(--muted,#5F6F6B);display:flex;align-items:center;gap:5px}
  .ast-tit small i{width:6px;height:6px;border-radius:50%;background:var(--good,#24704F)}
  .ast-ic{border:0;background:none;color:var(--muted,#5F6F6B);width:36px;height:36px;border-radius:50%;cursor:pointer;display:grid;place-items:center;transition:background .15s,color .15s}
  .ast-ic:hover{background:var(--soft,#EDF2EF);color:var(--ink,#22302E)}
  .ast-ic svg{width:19px;height:19px}
  .ast-info{margin:0 14px 6px;padding:10px 12px;border-radius:12px;background:var(--soft,#EDF2EF);font-size:12.5px;color:var(--muted,#5F6F6B);line-height:1.5}
  .ast-info[hidden]{display:none}

  .ast-msgs{flex:1;overflow-y:auto;padding:8px 16px 16px;display:flex;flex-direction:column;gap:18px;overscroll-behavior:contain;scroll-behavior:smooth}
  .ast-u{align-self:flex-end;max-width:85%;padding:10px 14px;border-radius:18px 18px 6px 18px;color:#fff;background:linear-gradient(135deg,var(--ag1),color-mix(in srgb,var(--ag1) 60%,var(--ag2)));white-space:pre-wrap;overflow-wrap:anywhere}
  .ast-a{display:grid;grid-template-columns:26px minmax(0,1fr);gap:10px;align-items:start}
  .ast-txt{overflow-wrap:anywhere}
  .ast-txt p{margin:0 0 8px} .ast-txt p:last-child{margin:0}
  .ast-txt ul,.ast-txt ol{margin:4px 0 8px;padding-left:20px} .ast-txt li{margin:2px 0}
  .ast-txt .ast-h{font-weight:800;font-family:var(--font-display,inherit);margin-top:4px}
  .ast-txt strong{font-weight:700}
  .ast-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .ast-meta a,.ast-meta span{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;border-radius:999px;padding:4px 10px;text-decoration:none;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ast-meta a{color:var(--ink,#22302E);background:var(--soft,#EDF2EF)}
  .ast-meta a:hover{color:var(--accent,#2F6F74)}
  .ast-meta a svg{width:12px;height:12px;flex:none;opacity:.6}
  .ast-meta span{color:var(--muted,#5F6F6B);border:1px dashed var(--line,#E2E9E5);cursor:help}
  .ast-erro{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:14px;background:var(--warn-bg,#FAF1DE);font-size:13.5px}
  .ast-erro svg{width:18px;height:18px;flex:none;color:var(--warn,#86601C);margin-top:1px}

  .ast-boas{margin:auto 0;display:grid;gap:18px;padding:10px 2px}
  .ast-boas .ast-orb{width:52px;height:52px}.ast-boas .ast-orb svg{width:26px;height:26px}
  .ast-boas h3{margin:0;font-family:var(--font-display,inherit);font-size:22px;letter-spacing:-.02em;line-height:1.2}
  .ast-boas h3 em{font-style:normal;background:linear-gradient(90deg,var(--ag1),var(--ag2));-webkit-background-clip:text;background-clip:text;color:transparent}
  .ast-boas p{margin:4px 0 0;color:var(--muted,#5F6F6B);font-size:14px}
  .ast-sug{display:grid;gap:8px}
  .ast-sug button{display:flex;align-items:center;gap:10px;justify-content:space-between;font:inherit;font-size:13.5px;text-align:left;color:var(--ink,#22302E);
    background:var(--soft,#EDF2EF);border:1px solid transparent;border-radius:14px;padding:11px 14px;cursor:pointer;transition:border-color .15s,background .15s,transform .15s}
  .ast-sug button svg{width:16px;height:16px;flex:none;color:var(--muted,#5F6F6B);transition:transform .15s,color .15s}
  .ast-sug button:hover{background:var(--surface,#fff);border-color:color-mix(in srgb,var(--ag1) 45%,transparent)}
  .ast-sug button:hover svg{transform:translateX(3px);color:var(--accent,#2F6F74)}

  .ast-esp .ast-txt{display:flex;align-items:center;min-height:26px}
  .ast-et{font-size:14px;font-weight:600;background:linear-gradient(90deg,var(--muted,#5F6F6B) 0%,var(--ink,#22302E) 45%,var(--muted,#5F6F6B) 90%);background-size:220% 100%;
    -webkit-background-clip:text;background-clip:text;color:transparent;animation:astbrilho 1.8s linear infinite}
  @keyframes astbrilho{from{background-position:120% 0}to{background-position:-120% 0}}
  .ast-esp .ast-orb{animation:astpulso 1.6s ease-in-out infinite}
  @keyframes astpulso{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--ag2) 45%,transparent)}50%{box-shadow:0 0 0 7px transparent}}
  @media (prefers-reduced-motion:reduce){.ast-et,.ast-esp .ast-orb{animation:none;color:var(--muted,#5F6F6B)}}

  .ast-form{padding:10px 14px 14px}
  .ast-campo{display:flex;align-items:flex-end;gap:8px;background:var(--soft,#EDF2EF);border:1.5px solid transparent;border-radius:24px;padding:6px 6px 6px 16px;transition:border-color .15s,background .15s}
  .ast-campo:focus-within{background:var(--surface,#fff);border-color:color-mix(in srgb,var(--ag1) 55%,transparent)}
  .ast-campo textarea{flex:1;font:inherit;font-size:15px;color:inherit;background:none;border:0;outline:none;resize:none;height:40px;max-height:120px;padding:9px 0;line-height:1.45}
  .ast-env{flex:none;width:40px;height:40px;border:0;border-radius:50%;cursor:pointer;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,var(--ag1),var(--ag2));transition:opacity .15s,transform .15s}
  .ast-env:hover:not(:disabled){transform:scale(1.06)}
  .ast-env:disabled{opacity:.35;cursor:not-allowed}
  .ast-env svg{width:18px;height:18px}
  .ast-rod{margin:8px 0 0;text-align:center;font-size:11px;color:var(--muted,#5F6F6B)}
  .ast-pan :focus-visible,.ast-btn:focus-visible{outline:2px solid var(--accent,#2F6F74);outline-offset:2px}
  .ast-pan .ast-campo textarea:focus-visible{outline:none}   /* o contorno fica na caixa inteira */

  /* celular: tela cheia que acompanha a área visível (teclado e barra do navegador) */
  @media (max-width:640px){
    .ast-pan{left:0;right:0;top:0;bottom:auto;width:auto;height:100dvh;max-height:none;border-radius:0;border:0;box-shadow:none;
      padding-top:env(safe-area-inset-top,0px);padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px)}
    .ast-pan .ast-form{padding-bottom:calc(10px + env(safe-area-inset-bottom,0px))}
    .ast-pan .ast-campo textarea{font-size:16px}           /* 16px evita o zoom automático do iPhone ao tocar */
    html.ast-aberto,html.ast-aberto body{overflow:hidden;overscroll-behavior:none}
    html.ast-aberto .ast-btn{display:none}
    .ast-btn span{display:none}
  }
  @media print{.ast-btn,.ast-pan{display:none}}`;

  function iniciar() {
    const st = document.createElement("style"); st.textContent = css; document.head.append(st);
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "ast-btn"; btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", "ast-pan");
    btn.setAttribute("aria-label", "Abrir o assistente");
    btn.innerHTML = IC.brilho + "<span>Assistente</span>";
    const pan = document.createElement("section");
    pan.className = "ast-pan"; pan.id = "ast-pan"; pan.hidden = true; pan.setAttribute("aria-label", "Assistente");
    pan.innerHTML = `
      <div class="ast-top">
        <span class="ast-orb">${IC.brilho}</span>
        <div class="ast-tit"><b>Assistente</b><small><i aria-hidden="true"></i>Ações, indicadores e notícias</small></div>
        <button type="button" class="ast-ic" id="ast-limpar" title="Nova conversa" aria-label="Nova conversa">${IC.novo}</button>
        <button type="button" class="ast-ic" id="ast-sobre" title="Sobre o assistente" aria-label="Sobre o assistente" aria-expanded="false" aria-controls="ast-info">${IC.info}</button>
        <button type="button" class="ast-ic" id="ast-fechar" title="Fechar" aria-label="Fechar">${IC.fechar}</button>
      </div>
      <div class="ast-info" id="ast-info" hidden>As respostas são geradas por IA (Google Gemini, plano gratuito: o Google pode usar o conteúdo para melhorar seus produtos). Os dados da página vão junto com a pergunta. Não escreva dados pessoais e confira as fontes. Não é recomendação de investimento.</div>
      <div class="ast-msgs" id="ast-msgs" aria-live="polite"></div>
      <form class="ast-form" id="ast-form">
        <div class="ast-campo">
          <textarea id="ast-q" maxlength="${LIMITE_PERGUNTA}" placeholder="Pergunte algo…" aria-label="Sua pergunta" rows="1"></textarea>
          <button type="submit" class="ast-env" id="ast-env" aria-label="Enviar" disabled>${IC.enviar}</button>
        </div>
        <p class="ast-rod">IA pode errar · não é recomendação de investimento</p>
      </form>`;
    document.body.append(btn, pan);

    const msgs = pan.querySelector("#ast-msgs"), q = pan.querySelector("#ast-q"), env = pan.querySelector("#ast-env");
    const rolar = () => { msgs.scrollTop = msgs.scrollHeight; };
    const orb = '<span class="ast-orb p" aria-hidden="true">' + IC.brilho + "</span>";

    function desenhar(extra) {
      if (!conversa.length && !extra) {
        const sug = (cfg.sugestoes() || []).slice(0, 3);
        msgs.innerHTML = `<div class="ast-boas">
          <span class="ast-orb" aria-hidden="true">${IC.brilho}</span>
          <div><h3>Olá! <em>Como posso ajudar?</em></h3><p>Pergunte sobre ações, indicadores ou notícias do mercado.</p></div>
          ${sug.length ? `<div class="ast-sug">${sug.map((s, i) => `<button type="button" data-i="${i}"><span>${esc(s)}</span>${IC.seta}</button>`).join("")}</div>` : ""}</div>`;
        msgs.querySelectorAll(".ast-sug button").forEach(b => b.onclick = () => enviar(sug[+b.dataset.i]));
        return;
      }
      msgs.innerHTML = conversa.map(m => {
        if (m.papel === "usuario") return `<div class="ast-u">${esc(m.texto)}</div>`;
        if (m.papel === "erro") return `<div class="ast-erro" role="alert">${IC.alerta}<span>${esc(m.texto)}</span></div>`;
        const fontes = (m.fontes || []).map(f => `<a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer nofollow" referrerpolicy="no-referrer">${IC.link}${esc(f.titulo)}</a>`).join("");
        const sb = m.semBusca ? `<span title="O modelo respondeu sem consultar a web; notícias muito recentes podem não estar incluídas.">Sem busca na web</span>` : "";
        return `<div class="ast-a">${orb}<div class="ast-txt">${md(m.texto)}${fontes || sb ? `<div class="ast-meta">${fontes}${sb}</div>` : ""}</div></div>`;
      }).join("") + (extra || "");
      rolar();
    }

    async function enviar(texto) {
      const pergunta = String(texto || "").trim().slice(0, LIMITE_PERGUNTA);
      if (!pergunta || ocupado) return;
      if (!ENDPOINT) { conversa.push({ papel: "usuario", texto: pergunta }, { papel: "erro", texto: "O assistente ainda está sendo ativado. Tente de novo mais tarde." }); desenhar(); return; }
      const historico = conversa.filter(m => m.papel !== "erro").slice(-HISTORICO).map(m => ({ papel: m.papel, texto: m.texto }));
      conversa.push({ papel: "usuario", texto: pergunta });
      q.value = ""; q.style.height = ""; env.disabled = true; ocupado = true;
      // Enquanto espera: mensagens de andamento que mudam com o tempo, para não parecer travado.
      const ETAPAS = [[0, "Buscando informações…"], [6, "Pesquisando notícias e dados na web…"], [15, "Analisando o que encontrou…"],
        [28, "Organizando a resposta…"], [45, "Está demorando um pouco mais, mas continua buscando…"]];
      const inicio = Date.now();
      desenhar(`<div class="ast-a ast-esp">${orb}<div class="ast-txt"><span class="ast-et" id="ast-et">${ETAPAS[0][1]}</span></div></div>`);
      const relogio = setInterval(() => {
        const seg = (Date.now() - inicio) / 1000, el = document.getElementById("ast-et");
        if (el) el.textContent = ETAPAS.filter(([t]) => seg >= t).pop()[1];
      }, 1000);
      const ctrl = new AbortController();
      const limite = setTimeout(() => ctrl.abort(), 100000);   // nunca fica esperando para sempre
      try {
        const r = await fetch(ENDPOINT + "/perguntar", {
          signal: ctrl.signal,
          method: "POST", headers: { "Content-Type": "application/json" }, referrerPolicy: "no-referrer", credentials: "omit", cache: "no-store",
          body: JSON.stringify({ pergunta, contexto: (cfg.contexto() || "").slice(0, LIMITE_CONTEXTO), historico }),
        });
        let d = {}; try { d = await r.json(); } catch (e) { }
        if (!r.ok || !d.resposta) conversa.push({ papel: "erro", texto: d.erro || "Não foi possível responder agora. Tente de novo." });
        else conversa.push({ papel: "assistente", texto: String(d.resposta), semBusca: !!d.sem_busca, fontes: Array.isArray(d.fontes) ? d.fontes.filter(f => /^https:\/\//.test(f.url || "")) : [] });
      } catch (e) {
        conversa.push({ papel: "erro", texto: e && e.name === "AbortError"
          ? "A busca demorou demais e foi interrompida. Tente de novo ou faça uma pergunta mais específica."
          : "Sem conexão com o assistente. Verifique a internet e tente de novo." });
      } finally { clearInterval(relogio); clearTimeout(limite); }
      ocupado = false; desenhar(); if (!celular()) q.focus();
    }

    // No celular, o painel ocupa exatamente a área visível, que encolhe quando o teclado abre.
    const celular = () => matchMedia("(max-width:640px)").matches;
    const ajustar = () => {
      if (pan.hidden || !celular() || !window.visualViewport) { pan.style.height = ""; pan.style.top = ""; return; }
      pan.style.height = Math.round(visualViewport.height) + "px";
      pan.style.top = Math.round(visualViewport.offsetTop) + "px";
      rolar();
    };
    if (window.visualViewport) { visualViewport.addEventListener("resize", ajustar); visualViewport.addEventListener("scroll", ajustar); }
    window.addEventListener("orientationchange", () => setTimeout(ajustar, 250));

    const abrir = on => {
      pan.hidden = !on; btn.setAttribute("aria-expanded", String(on));
      btn.setAttribute("aria-label", on ? "Fechar o assistente" : "Abrir o assistente");
      document.documentElement.classList.toggle("ast-aberto", on);
      if (on) { desenhar(); ajustar(); if (!celular()) q.focus(); } else { ajustar(); btn.focus(); }
    };
    btn.onclick = () => abrir(pan.hidden);
    pan.querySelector("#ast-fechar").onclick = () => abrir(false);
    pan.querySelector("#ast-limpar").onclick = () => { if (ocupado) return; conversa.length = 0; desenhar(); if (!celular()) q.focus(); };
    pan.querySelector("#ast-sobre").onclick = e => { const i = pan.querySelector("#ast-info"); i.hidden = !i.hidden; e.currentTarget.setAttribute("aria-expanded", String(!i.hidden)); };
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !pan.hidden) abrir(false); });
    q.addEventListener("input", () => { env.disabled = !q.value.trim() || ocupado; q.style.height = "40px"; q.style.height = Math.min(q.scrollHeight, 120) + "px"; });
    q.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(q.value); } });
    pan.querySelector("#ast-form").addEventListener("submit", e => { e.preventDefault(); enviar(q.value); });
  }

  window.Assistente = { configurar(c) { cfg = { ...cfg, ...c }; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
