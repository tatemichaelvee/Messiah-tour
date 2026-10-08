/* Songs hidden from the portal without deleting them (their stems and files stay in storage).
   To bring an artist or song back, remove it from the lists below. */
(function () {
  "use strict";
  var HIDE_ARTISTS = ["Misheck Mahendere"]; // Pastor Misheck isn't on this tour
  var HIDE_SONGS = [];                      // song ids, e.g. "africa-for-jesus"
  var orig = window.fetch;
  if (!orig) return;
  function hidden(row) {
    return row && typeof row === "object" && (HIDE_ARTISTS.indexOf(row.artist) >= 0 || HIDE_SONGS.indexOf(row.id) >= 0);
  }
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
    var p = orig.apply(this, arguments);
    if (method !== "GET" || !/\/rest\/v1\/songs(\?|$)/.test(url)) return p;
    return p.then(function (res) {
      if (!res.ok) return res;
      return res.clone().json().then(function (body) {
        if (!Array.isArray(body)) return res;
        var kept = body.filter(function (r) { return !hidden(r); });
        if (kept.length === body.length) return res;
        var h = new Headers(res.headers); h.delete("content-length");
        return new Response(JSON.stringify(kept), { status: res.status, statusText: res.statusText, headers: h });
      }).catch(function () { return res; });
    });
  };
})();
