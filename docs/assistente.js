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

  const css = `
  .ast-btn{position:fixed;right:calc(16px + env(safe-area-inset-right,0px));bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:50;
    font:700 14px/1 var(--font-body,system-ui,sans-serif);color:var(--accent-ink,#fff);background:var(--accent,#2C55E0);border:0;border-radius:999px;
    padding:13px 18px;cursor:pointer;box-shadow:0 8px 24px rgba(23,32,51,.25);display:flex;gap:8px;align-items:center;transition:transform .15s,filter .15s}
  .ast-btn:hover{filter:brightness(1.08);transform:translateY(-1px)}
  .ast-btn svg{width:18px;height:18px}
  .ast-pan{position:fixed;right:calc(16px + env(safe-area-inset-right,0px));bottom:calc(76px + env(safe-area-inset-bottom,0px));z-index:51;
    width:min(430px,calc(100vw - 32px));height:min(640px,calc(100vh - 110px));background:var(--surface,#fff);color:var(--ink,#172033);
    border:1px solid var(--line,#E2E6EF);border-radius:16px;box-shadow:0 18px 50px rgba(23,32,51,.28);display:flex;flex-direction:column;overflow:hidden;
    font:14.5px/1.5 var(--font-body,system-ui,sans-serif)}
  .ast-pan[hidden]{display:none}
  @media (max-width:520px){.ast-pan{right:8px;left:8px;width:auto;bottom:calc(72px + env(safe-area-inset-bottom,0px));height:calc(100vh - 96px)}}
  .ast-top{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--line,#E2E6EF);background:var(--surface-2,#F1F3F9)}
  .ast-top b{font-family:var(--font-display,inherit);font-size:16px;display:flex;gap:8px;align-items:center}
  .ast-top b i{width:8px;height:8px;border-radius:50%;background:var(--good,#0B9467);display:inline-block}
  .ast-acoes{display:flex;gap:6px}
  .ast-x{border:0;background:var(--soft,#EDF0F6);color:var(--muted,#5D6880);height:30px;min-width:30px;padding:0 10px;border-radius:999px;cursor:pointer;font:inherit;font-size:12px;font-weight:700}
  .ast-x:hover{color:var(--ink,#172033)}
  .ast-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;overscroll-behavior:contain}
  .ast-m{max-width:90%;padding:10px 13px;border-radius:14px;overflow-wrap:anywhere}
  .ast-m p{margin:0 0 6px} .ast-m p:last-child{margin:0}
  .ast-m ul,.ast-m ol{margin:4px 0 6px;padding-left:20px}
  .ast-m .ast-h{font-weight:800}
  .ast-u{align-self:flex-end;background:var(--accent,#2C55E0);color:var(--accent-ink,#fff);border-bottom-right-radius:4px;white-space:pre-wrap}
  .ast-a{align-self:flex-start;background:var(--soft,#EDF0F6);border-bottom-left-radius:4px}
  .ast-erro{align-self:center;background:var(--warn-bg,#FCF1DD);color:var(--ink,#172033);font-size:13px;text-align:center}
  .ast-fontes{margin-top:8px;display:flex;flex-wrap:wrap;gap:6px}
  .ast-fontes a{font-size:12px;font-weight:700;color:var(--accent,#2C55E0);background:var(--surface,#fff);border:1px solid var(--line,#E2E6EF);border-radius:999px;padding:2px 9px;text-decoration:none;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ast-fontes a:hover{border-color:var(--accent,#2C55E0)}
  .ast-sb{font-size:11.5px;color:var(--muted,#5D6880);margin-top:6px!important}
  .ast-boas{color:var(--muted,#5D6880);font-size:13.5px;display:grid;gap:10px}
  .ast-sug{display:flex;flex-direction:column;gap:6px}
  .ast-sug button{font:inherit;font-size:13px;text-align:left;border:1px solid var(--line,#E2E6EF);background:var(--surface,#fff);color:var(--ink,#172033);border-radius:12px;padding:8px 11px;cursor:pointer;transition:border-color .15s,color .15s}
  .ast-sug button:hover{border-color:var(--accent,#2C55E0);color:var(--accent,#2C55E0)}
  .ast-dig{display:inline-flex;gap:4px;align-items:center;padding:4px 2px}
  .ast-dig i{width:7px;height:7px;border-radius:50%;background:var(--muted,#5D6880);opacity:.4;animation:astd 1s infinite}
  .ast-dig i:nth-child(2){animation-delay:.15s} .ast-dig i:nth-child(3){animation-delay:.3s}
  @keyframes astd{0%,60%,100%{opacity:.25;transform:none}30%{opacity:.9;transform:translateY(-3px)}}
  @media (prefers-reduced-motion:reduce){.ast-dig i{animation:none;opacity:.6}}
  .ast-form{display:flex;gap:8px;padding:12px;border-top:1px solid var(--line,#E2E6EF)}
  .ast-form textarea{flex:1;font:inherit;font-size:14px;color:inherit;background:var(--soft,#EDF0F6);border:1px solid transparent;border-radius:12px;padding:10px 12px;resize:none;height:44px;max-height:120px}
  .ast-form textarea:focus{background:var(--surface,#fff);border-color:var(--line,#E2E6EF)}
  .ast-env{border:0;border-radius:12px;width:44px;flex:none;background:var(--accent,#2C55E0);color:var(--accent-ink,#fff);cursor:pointer;display:grid;place-items:center}
  .ast-env:disabled{opacity:.45;cursor:not-allowed}
  .ast-env svg{width:18px;height:18px}
  .ast-nota{font-size:11px;color:var(--muted,#5D6880);margin:0;padding:0 14px 10px}
  .ast-pan :focus-visible,.ast-btn:focus-visible{outline:2px solid var(--accent,#2C55E0);outline-offset:2px}
  @media print{.ast-btn,.ast-pan{display:none}}`;

  function iniciar() {
    const st = document.createElement("style"); st.textContent = css; document.head.append(st);
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "ast-btn"; btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", "ast-pan");
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>Assistente';
    const pan = document.createElement("section");
    pan.className = "ast-pan"; pan.id = "ast-pan"; pan.hidden = true; pan.setAttribute("aria-label", "Assistente");
    pan.innerHTML = `
      <div class="ast-top"><b><i aria-hidden="true"></i>Assistente</b>
        <div class="ast-acoes"><button type="button" class="ast-x" id="ast-limpar" title="Começar nova conversa">Nova conversa</button><button type="button" class="ast-x" id="ast-fechar" aria-label="Fechar">×</button></div></div>
      <div class="ast-msgs" id="ast-msgs" aria-live="polite"></div>
      <form class="ast-form" id="ast-form">
        <textarea id="ast-q" maxlength="${LIMITE_PERGUNTA}" placeholder="Pergunte sobre ações ou notícias" aria-label="Sua pergunta" rows="1"></textarea>
        <button type="submit" class="ast-env" id="ast-env" aria-label="Enviar" disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
      </form>
      <p class="ast-nota">Respostas geradas por IA (Google Gemini, plano gratuito: o Google pode usar o conteúdo para melhorar seus produtos). Não escreva dados pessoais. Confira as fontes. Não é recomendação de investimento.</p>`;
    document.body.append(btn, pan);

    const msgs = pan.querySelector("#ast-msgs"), q = pan.querySelector("#ast-q"), env = pan.querySelector("#ast-env");
    const rolar = () => { msgs.scrollTop = msgs.scrollHeight; };

    function desenhar(extra) {
      if (!conversa.length && !extra) {
        const sug = (cfg.sugestoes() || []).slice(0, 4);
        msgs.innerHTML = `<div class="ast-boas"><p style="margin:0">Pergunte sobre as ações, os indicadores ou as notícias do mercado. Os dados desta página vão junto com a pergunta.</p>
          ${sug.length ? `<div class="ast-sug">${sug.map((s, i) => `<button type="button" data-i="${i}">${esc(s)}</button>`).join("")}</div>` : ""}</div>`;
        msgs.querySelectorAll(".ast-sug button").forEach(b => b.onclick = () => enviar(sug[+b.dataset.i]));
        return;
      }
      msgs.innerHTML = conversa.map(m => m.papel === "usuario"
        ? `<div class="ast-m ast-u">${esc(m.texto)}</div>`
        : m.papel === "erro" ? `<div class="ast-m ast-erro">${esc(m.texto)}</div>`
        : `<div class="ast-m ast-a">${md(m.texto)}${(m.fontes || []).length ? `<div class="ast-fontes">${m.fontes.map(f => `<a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer nofollow" referrerpolicy="no-referrer">${esc(f.titulo)}</a>`).join("")}</div>` : ""}${m.semBusca ? `<p class="ast-sb">Respondido sem busca na web: notícias recentes podem não estar incluídas.</p>` : ""}</div>`
      ).join("") + (extra || "");
      rolar();
    }

    async function enviar(texto) {
      const pergunta = String(texto || "").trim().slice(0, LIMITE_PERGUNTA);
      if (!pergunta || ocupado) return;
      if (!ENDPOINT) { conversa.push({ papel: "usuario", texto: pergunta }, { papel: "erro", texto: "O assistente ainda está sendo ativado. Tente de novo mais tarde." }); desenhar(); return; }
      const historico = conversa.filter(m => m.papel !== "erro").slice(-HISTORICO).map(m => ({ papel: m.papel, texto: m.texto }));
      conversa.push({ papel: "usuario", texto: pergunta });
      q.value = ""; env.disabled = true; ocupado = true;
      desenhar('<div class="ast-m ast-a"><span class="ast-dig" aria-label="Pensando"><i></i><i></i><i></i></span></div>');
      try {
        const r = await fetch(ENDPOINT + "/perguntar", {
          method: "POST", headers: { "Content-Type": "application/json" }, referrerPolicy: "no-referrer", credentials: "omit", cache: "no-store",
          body: JSON.stringify({ pergunta, contexto: (cfg.contexto() || "").slice(0, LIMITE_CONTEXTO), historico }),
        });
        let d = {}; try { d = await r.json(); } catch (e) { }
        if (!r.ok || !d.resposta) conversa.push({ papel: "erro", texto: d.erro || "Não foi possível responder agora. Tente de novo." });
        else conversa.push({ papel: "assistente", texto: String(d.resposta), semBusca: !!d.sem_busca, fontes: Array.isArray(d.fontes) ? d.fontes.filter(f => /^https:\/\//.test(f.url || "")) : [] });
      } catch (e) {
        conversa.push({ papel: "erro", texto: "Sem conexão com o assistente. Verifique a internet e tente de novo." });
      }
      ocupado = false; desenhar(); q.focus();
    }

    const abrir = on => {
      pan.hidden = !on; btn.setAttribute("aria-expanded", String(on));
      if (on) { desenhar(); q.focus(); } else btn.focus();
    };
    btn.onclick = () => abrir(pan.hidden);
    pan.querySelector("#ast-fechar").onclick = () => abrir(false);
    pan.querySelector("#ast-limpar").onclick = () => { if (ocupado) return; conversa.length = 0; desenhar(); q.focus(); };
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !pan.hidden) abrir(false); });
    q.addEventListener("input", () => { env.disabled = !q.value.trim() || ocupado; q.style.height = "44px"; q.style.height = Math.min(q.scrollHeight, 120) + "px"; });
    q.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(q.value); } });
    pan.querySelector("#ast-form").addEventListener("submit", e => { e.preventDefault(); enviar(q.value); });
  }

  window.Assistente = { configurar(c) { cfg = { ...cfg, ...c }; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
