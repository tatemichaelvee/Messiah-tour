/* Messiah Tour Band Portal — page transitions.
   Plays a short slide or fade whenever the page (route) changes:
   going into a song or admin page slides in from the right, going back
   slides in from the left, anything else fades up. In-page updates
   (filters, saving, uploads) are not animated.
   Loaded BEFORE app.js so its hashchange listener runs first. */
(function () {
  "use strict";
  var app = document.getElementById("app");
  if (!app) return;
  var reduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  var pending = "fade"; // also animate the first real page after loading

  function depth(url) {
    var h = String(url || "").split("#")[1] || "";
    h = h.replace(/^\/+/, "");
    return h === "" ? 0 : 1;
  }

  window.addEventListener("hashchange", function (e) {
    var a = depth(e.oldURL), b = depth(e.newURL || location.href);
    pending = b > a ? "fwd" : b < a ? "back" : "fade";
  });

  function play(dir) {
    if (reduce.matches) return;
    app.classList.remove("pt-enter");
    app.setAttribute("data-pt", dir);
    void app.offsetWidth; // restart the animation
    app.classList.add("pt-enter");
  }

  app.addEventListener("animationend", function (e) {
    if (e.target === app) app.classList.remove("pt-enter");
  });

  new MutationObserver(function () {
    if (!pending) return;
    if (app.querySelector(".loading")) return; // wait for real content
    var dir = pending;
    pending = null;
    play(dir);
  }).observe(app, { childList: true });
})();
