/* Assistente do Radar de Ações B3
 *
 * Botão flutuante que monta uma pergunta com os dados da página e a abre numa conversa nova em
 * claude.ai (parâmetro ?q=), na conta de quem clicou. Não há chave de API no site.
 *
 * Cada página chama:
 *   Assistente.configurar({ contexto: () => "texto com os dados da página",
 *                           sugestoes: () => ["pergunta 1", "pergunta 2"] })
 */
(function () {
  const LIMITE_CONTEXTO = 1500;   // caracteres; a URL inteira precisa ficar abaixo de ~4000
  const LIMITE_PERGUNTA = 400;
  let cfg = { contexto: () => "", sugestoes: () => [] };

  const INSTRUCOES =
    "Você é o assistente do meu Radar de Ações B3. Responda em português do Brasil, de forma direta e organizada. " +
    "Para notícias, fatos relevantes, resultados recentes ou qualquer coisa que possa ter mudado, pesquise na web e cite as fontes com data. " +
    "Use os dados abaixo como ponto de partida, mas avise se a busca mostrar números diferentes. " +
    "Não faça recomendação de compra ou venda: explique fatos, riscos e o que observar.";

  const css = `
  .ast-btn{position:fixed;right:calc(16px + env(safe-area-inset-right,0px));bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:50;
    font:600 14px/1 var(--font-body,system-ui,sans-serif);color:var(--accent-ink,#fff);background:var(--accent,#0E6E55);border:0;border-radius:999px;
    padding:12px 18px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.18);display:flex;gap:8px;align-items:center}
  .ast-btn:hover{filter:brightness(1.08)}
  .ast-btn svg{width:18px;height:18px}
  .ast-pan{position:fixed;right:calc(16px + env(safe-area-inset-right,0px));bottom:calc(72px + env(safe-area-inset-bottom,0px));z-index:51;
    width:min(400px,calc(100vw - 32px));max-height:calc(100vh - 110px);overflow:auto;background:var(--surface,#fff);color:var(--ink,#13201C);
    border:1px solid var(--line,#DCE3E0);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.22);padding:16px;display:grid;gap:12px;
    font:14px/1.45 var(--font-body,system-ui,sans-serif)}
  .ast-pan[hidden]{display:none}
  .ast-top{display:flex;justify-content:space-between;align-items:center}
  .ast-top b{font-family:var(--font-display,inherit);font-size:17px}
  .ast-x{border:0;background:var(--soft,#E9EEEC);color:var(--muted,#5B6B65);width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:16px}
  .ast-ctx{font-size:12px;color:var(--muted,#5B6B65);background:var(--bg,#F3F5F4);border-radius:8px;padding:8px 10px;white-space:pre-wrap;max-height:110px;overflow:auto}
  .ast-pan textarea{font:inherit;color:inherit;background:var(--bg,#F3F5F4);border:1px solid var(--line,#DCE3E0);border-radius:8px;padding:10px;min-height:76px;resize:vertical}
  .ast-sug{display:flex;flex-wrap:wrap;gap:6px}
  .ast-sug button{font:inherit;font-size:12px;text-align:left;border:1px solid var(--line,#DCE3E0);background:none;color:inherit;border-radius:8px;padding:5px 9px;cursor:pointer}
  .ast-sug button:hover{border-color:var(--accent,#0E6E55);color:var(--accent,#0E6E55)}
  .ast-go{font:inherit;font-weight:700;border:0;border-radius:8px;padding:10px 14px;background:var(--accent,#0E6E55);color:var(--accent-ink,#fff);cursor:pointer}
  .ast-go:disabled{opacity:.5;cursor:not-allowed}
  .ast-nota{font-size:11px;color:var(--muted,#5B6B65);margin:0}
  .ast-pan :focus-visible,.ast-btn:focus-visible{outline:2px solid var(--accent,#0E6E55);outline-offset:2px}
  @media print{.ast-btn,.ast-pan{display:none}}`;

  function montarPergunta(q) {
    let ctx = (cfg.contexto() || "").trim();
    if (ctx.length > LIMITE_CONTEXTO) ctx = ctx.slice(0, LIMITE_CONTEXTO - 1) + "…";
    return `${INSTRUCOES}\n\n${ctx ? `Dados do radar (Yahoo Finance):\n${ctx}\n\n` : ""}Minha pergunta: ${q.trim().slice(0, LIMITE_PERGUNTA)}`;
  }

  function iniciar() {
    const st = document.createElement("style"); st.textContent = css; document.head.append(st);
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "ast-btn"; btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", "ast-pan");
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>Assistente';
    const pan = document.createElement("div");
    pan.className = "ast-pan"; pan.id = "ast-pan"; pan.hidden = true; pan.setAttribute("role", "dialog"); pan.setAttribute("aria-label", "Assistente");
    pan.innerHTML = `
      <div class="ast-top"><b>Assistente</b><button type="button" class="ast-x" aria-label="Fechar">×</button></div>
      <p class="ast-nota" style="font-size:13px">Pergunte sobre ações, indicadores ou notícias. Os dados desta página vão junto com a pergunta.</p>
      <div class="ast-sug" id="ast-sug"></div>
      <label for="ast-q" class="ast-nota" style="font-weight:600">Sua pergunta</label>
      <textarea id="ast-q" maxlength="${LIMITE_PERGUNTA}" placeholder="Ex.: Quais foram as últimas notícias da empresa?"></textarea>
      <details><summary class="ast-nota" style="cursor:pointer">Ver os dados que serão enviados</summary><div class="ast-ctx" id="ast-ctx"></div></details>
      <button type="button" class="ast-go" id="ast-go" disabled>Perguntar</button>
      <p class="ast-nota">A resposta abre em uma nova aba, no claude.ai, onde é preciso estar logado. Informação para estudo, não é recomendação de investimento.</p>`;
    document.body.append(btn, pan);

    const q = pan.querySelector("#ast-q"), go = pan.querySelector("#ast-go");
    const abrir = (on) => {
      pan.hidden = !on; btn.setAttribute("aria-expanded", String(on));
      if (on) {
        const sug = (cfg.sugestoes() || []).slice(0, 4);
        pan.querySelector("#ast-sug").innerHTML = sug.map(s => `<button type="button">${s.replace(/</g, "&lt;")}</button>`).join("");
        pan.querySelectorAll("#ast-sug button").forEach((b, i) => b.onclick = () => { q.value = sug[i]; go.disabled = false; q.focus(); });
        pan.querySelector("#ast-ctx").textContent = (cfg.contexto() || "Sem dados específicos nesta página.").slice(0, LIMITE_CONTEXTO);
        q.focus();
      } else btn.focus();
    };
    btn.onclick = () => abrir(pan.hidden);
    pan.querySelector(".ast-x").onclick = () => abrir(false);
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !pan.hidden) abrir(false); });
    q.addEventListener("input", () => { go.disabled = !q.value.trim(); });
    q.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && q.value.trim()) go.click(); });
    go.onclick = () => {
      const url = "https://claude.ai/new?q=" + encodeURIComponent(montarPergunta(q.value));
      const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener"; document.body.append(a); a.click(); a.remove();
    };
  }

  window.Assistente = {
    configurar(c) { cfg = { ...cfg, ...c }; },
    _montarPergunta: montarPergunta,
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
