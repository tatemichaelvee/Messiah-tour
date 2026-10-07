/* Wires the Schedule tab (schedule.js) into the portal header and the #/schedule route.
   It steps aside when app.js already handles window.MTPages itself. */
(function () {
  "use strict";
  var app = document.getElementById("app");
  var CFG = window.MUSIC_ROOM_CONFIG;
  if (!app || !CFG || !window.supabase || !window.MTPages) return;
  var sb = null, data = null, loading = null, busy = false;

  // A read-through client that borrows the signed-in session token (it never refreshes it,
  // so it can't disturb the portal's own sign-in).
  function client() {
    var tok = "";
    try { var raw = localStorage.getItem("sb-" + CFG.supabaseUrl.split("//")[1].split(".")[0] + "-auth-token"); tok = raw ? (JSON.parse(raw).access_token || "") : ""; } catch (e) {}
    var opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
    if (tok) opts.global = { headers: { Authorization: "Bearer " + tok } };
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, opts);
    sb._mtEmail = "";
    try { sb._mtEmail = JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).email || ""; } catch (e) {}
    return sb;
  }
  function load() {
    if (data) return Promise.resolve(data);
    if (loading) return loading;
    var c = client();
    loading = Promise.resolve(c._mtEmail.toLowerCase()).then(function (email) {
      return Promise.all([
        c.from("songs").select("*").order("artist_order").order("set_order"),
        c.from("sets").select("*").order("sort"),
        c.from("band_members").select("*").eq("email", email).maybeSingle()
      ]);
    }).then(function (r) {
      if (r[0].error) throw r[0].error;
      data = { songs: r[0].data || [], sets: r[1].data || [], member: r[2].data || null };
      return data;
    }).catch(function (e) { loading = null; throw e; });
    return loading;
  }
  function pageName() { var m = /^#\/([^\/?]+)/.exec(location.hash || ""); return m && Object.prototype.hasOwnProperty.call(window.MTPages, m[1]) ? m[1] : null; }

  function addLinks() {
    var who = app.querySelector(".who");
    if (!who) return;
    var before = who.querySelector('a[href="#/practice"]');
    Object.keys(window.MTPages).forEach(function (k) {
      var pg = window.MTPages[k];
      if (!pg.nav || pg.admin) return;
      var a = who.querySelector('a[href="#/' + k + '"]');
      if (!a) {
        a = document.createElement("a");
        a.href = "#/" + k; a.textContent = pg.nav;
        who.insertBefore(a, before || who.querySelector("#signout"));
      }
      if (pageName() === k) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
  }
  function showPage() {
    var k = pageName();
    if (!k || app.querySelector("#page-main")) return;
    var head = app.querySelector("header.top");
    if (!head || !app.querySelector(".who")) return;
    var pg = window.MTPages[k];
    // Keep the header (compact, like the other inner pages) and replace the song list with the page.
    var hero = head.querySelector(".hero");
    if (hero) {
      hero.remove(); head.classList.add("compact");
      if (!head.querySelector(".brand")) head.insertAdjacentHTML("beforeend", '<a class="brand" href="#/">Messiah Tour Band <span>Portal</span></a>');
    }
    Array.prototype.slice.call(app.children).forEach(function (n) { if (n !== head) n.remove(); });
    var box = document.createElement("main");
    box.id = "page-main"; box.className = pg.cls || "";
    box.innerHTML = '<p class="loading">Loading…</p>';
    var back = document.createElement("a");
    back.className = "back"; back.href = "#/";
    back.innerHTML = '<span class="arr" aria-hidden="true">←</span> All songs';
    app.appendChild(back);
    app.appendChild(box);
    window.scrollTo(0, 0);
    load().then(function (d) {
      if (!box.isConnected) return;
      var parts = (location.hash.replace(/^#\/?/, "") || "").split("/");
      box.innerHTML = "";
      pg.render(box, { songs: d.songs, sets: d.sets, tracks: [], member: d.member, sb: client(), cfg: CFG, isAdmin: !!(d.member && d.member.role === "admin"), parts: parts });
    }).catch(function (e) {
      if (box.isConnected) box.innerHTML = '<div class="sheet"><p>This page didn’t load: ' + String(e && e.message || e).replace(/</g, "&lt;") + '. Refresh to try again.</p></div>';
    });
  }
  function tick() {
    if (busy) return; busy = true;
    try { addLinks(); showPage(); } finally { busy = false; }
  }
  new MutationObserver(tick).observe(app, { childList: true });
  window.addEventListener("hashchange", function () { setTimeout(tick, 0); });
  tick();
})();
