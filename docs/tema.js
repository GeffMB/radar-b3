/* Tema do site: claro por padrão; o visitante pode trocar no botão sol/lua (fica salvo neste navegador). */
(function () {
  var CH = "radar-tema", raiz = document.documentElement;
  function ler() { try { return localStorage.getItem(CH); } catch (e) { return null; } }
  function aplicar(t) { raiz.setAttribute("data-theme", t === "dark" ? "dark" : "light"); }
  aplicar(ler());
  document.addEventListener("DOMContentLoaded", function () {
    var b = document.getElementById("tema");
    if (!b) return;
    function rotulo() {
      var esc = raiz.getAttribute("data-theme") === "dark";
      b.setAttribute("aria-label", esc ? "Usar modo claro" : "Usar modo escuro");
      b.title = esc ? "Modo claro" : "Modo escuro";
    }
    rotulo();
    b.addEventListener("click", function () {
      var novo = raiz.getAttribute("data-theme") === "dark" ? "light" : "dark";
      aplicar(novo);
      try { localStorage.setItem(CH, novo); } catch (e) {}
      rotulo();
      document.dispatchEvent(new Event("radar:tema"));
    });
  });
})();
