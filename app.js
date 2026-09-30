/* Messiah Tour Band Portal — band site on Supabase.
   Routes: #/ (library), #/song/<id>, #/band (admin only). */
(function () {
  "use strict";
  var CFG = window.MUSIC_ROOM_CONFIG;
  var sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
  var BUCKET = CFG.bucket;
  // "All" lists songs by artist in this order; the Setlist view follows the show's running order.
  var ARTISTS = [
    { name: "Michael Mahendere", short: "Michael", role: "Main set" },
    { name: "Eleana Makombe", short: "Eleana", role: "Supporting set" },
    { name: "Misheck Mahendere", short: "Misheck", role: "Supporting set" },
    { name: "Vimbai Mahendere", short: "Vimbai", role: "Supporting set" }
  ];
  var CHIP_ORDER = ["Michael Mahendere", "Misheck Mahendere", "Eleana Makombe", "Vimbai Mahendere"];
  var MAX_UPLOAD = 1024 * 1024 * 1024; // 1 GB per file (Supabase Pro)
  var CHUNK = 6 * 1024 * 1024; // Supabase resumable uploads need exactly 6 MB chunks

  var app = document.getElementById("app");
  var S = {
    session: null, member: null, songs: [], tracks: [], notice: "",
    q: "", view: "all", sets: [], practice: {}, log: [], loginMode: "signin", editing: false
  };
  var mixer = null;

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function $(sel) { return app.querySelector(sel); }
  function fmt(t) { if (!isFinite(t) || t < 0) t = 0; var m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ":" + (s < 10 ? "0" : "") + s; }
  function isAdmin() { return S.member && S.member.role === "admin"; }
  function tracksFor(id, kind) { return S.tracks.filter(function (t) { return t.song_id === id && (!kind || t.kind === kind); }).sort(function (a, b) { return a.sort - b.sort || (a.created_at < b.created_at ? -1 : 1); }); }
  function status(song) {
    var st = tracksFor(song.id, "stem").length, gd = tracksFor(song.id, "guide").length;
    if (st && song.lyrics) return { cls: "ok", text: "Ready" };
    if (st || gd || song.lyrics || tracksFor(song.id, "chart").length) return { cls: "part", text: "Partial" };
    return { cls: "none", text: "Waiting" };
  }
  function prettyName(filename) {
    return filename.replace(/\.[a-z0-9]+$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  }
  function safeFile(filename) { return filename.toLowerCase().replace(/[^a-z0-9.\-]+/g, "-").replace(/-+/g, "-"); }
  // BV cues can carry part markers from the MD's colour-coded sheet:
  // {{u|text}} unison, {{h|text}} harmony, {{i|text}} inversion.
  var PARTS = { u: "Unison", h: "Harmony", i: "Inversion" };
  function plainLyrics(t) { return String(t || "").replace(/\{\{[uhi]\||\}\}/g, ""); }
  function lyricsHtml(t) {
    return esc(t).replace(/\{\{([uhi])\|([^}]*)\}\}/g, function (_, p, x) { return '<mark class="pt pt-' + p + '" title="' + PARTS[p] + '">' + x + '</mark>'; });
  }
  function partsLegend(t) {
    var used = Object.keys(PARTS).filter(function (p) { return String(t || "").indexOf("{{" + p + "|") > -1; });
    if (!used.length) return "";
    return '<div class="legend" aria-label="Part colours">' + used.map(function (p) { return '<span class="pt pt-' + p + '">' + PARTS[p] + '</span>'; }).join("") + '</div>';
  }
  function mb(n) { return n >= 1073741824 ? (n / 1073741824).toFixed(1) + " GB" : (n / 1048576).toFixed(n > 10485760 ? 0 : 1) + " MB"; }
  // Big files go up in resumable 6 MB chunks (tus), so a dropped connection
  // retries the chunk instead of restarting a 500 MB upload.
  var tusLoading = null;
  function loadTus() {
    if (window.tus) return Promise.resolve(window.tus);
    if (!tusLoading) tusLoading = new Promise(function (res) {
      var sc = document.createElement("script");
      sc.src = "https://cdn.jsdelivr.net/npm/tus-js-client@4/dist/tus.min.js";
      sc.onload = function () { res(window.tus || null); };
      sc.onerror = function () { res(null); };
      document.head.appendChild(sc);
    });
    return tusLoading;
  }
  async function uploadFile(path, file, contentType, onProgress) {
    if (file.size <= CHUNK) return sb.storage.from(BUCKET).upload(path, file, { contentType: contentType, upsert: false });
    var tus = await loadTus();
    var sess = await sb.auth.getSession();
    var token = sess.data && sess.data.session && sess.data.session.access_token;
    if (!tus || !token || !tus.isSupported) return sb.storage.from(BUCKET).upload(path, file, { contentType: contentType, upsert: false });
    var endpoint = CFG.supabaseUrl.replace(".supabase.co", ".storage.supabase.co") + "/storage/v1/upload/resumable";
    return new Promise(function (resolve) {
      var up = new tus.Upload(file, {
        endpoint: endpoint,
        retryDelays: [0, 3000, 5000, 10000, 20000, 30000],
        headers: { authorization: "Bearer " + token, apikey: CFG.supabaseKey, "x-upsert": "false" },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        chunkSize: CHUNK,
        metadata: { bucketName: BUCKET, objectName: path, contentType: contentType || "application/octet-stream", cacheControl: "3600" },
        onError: function (err) { var m = String((err && err.message) || err); var r = m.match(/response text: (.*?)(,|$)/); resolve({ error: { message: r ? r[1] : m } }); },
        onProgress: function (sent, total) { if (onProgress) onProgress(sent / total); },
        onSuccess: function () { resolve({ data: { path: path } }); }
      });
      up.start();
    });
  }
  // Signed audio links are reused for up to 6 h (saved in this browser), so a song you've
  // opened before comes from the browser cache instead of downloading every stem again.
  var URL_TTL = 6 * 3600, urlCache = {};
  try { urlCache = JSON.parse(localStorage.getItem("mt-signed-v1") || "{}") || {}; } catch (e) { urlCache = {}; }
  async function signedUrls(paths) {
    var now = Date.now(), need = paths.filter(function (p) { var c = urlCache[p]; return !c || c.e < now + 45 * 60 * 1000; });
    if (need.length) {
      var r = await sb.storage.from(BUCKET).createSignedUrls(need, URL_TTL);
      if (r.error) return { error: r.error };
      (r.data || []).forEach(function (d) { if (d.signedUrl) urlCache[d.path] = { u: d.signedUrl, e: now + URL_TTL * 1000 }; });
      Object.keys(urlCache).forEach(function (k) { if (urlCache[k].e < now) delete urlCache[k]; });
      try { localStorage.setItem("mt-signed-v1", JSON.stringify(urlCache)); } catch (e) {}
    }
    var out = {}; paths.forEach(function (p) { if (urlCache[p]) out[p] = urlCache[p].u; });
    return { data: out };
  }
  function warmSong(id) {
    var paths = S.tracks.filter(function (t) { return t.song_id === id && (t.kind === "stem" || t.kind === "guide"); }).map(function (t) { return t.path; });
    if (paths.length) signedUrls(paths);
  }
  var ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>';
  var ICON_EXPAND = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z" fill="currentColor"/></svg>';
  var posterV = "";
  function poster(cls) {
    if (!CFG.posterUrl) return "";
    return '<img class="' + cls + '" src="' + esc(CFG.posterUrl + (posterV ? "?v=" + posterV : "")) + '" alt="Messiah Tour Canada poster: Michael Mahendere and Direct Worship" onerror="this.remove()">';
  }
  // Activity log: who signs in, opens songs and presses play. Only admins can read it.
  function logEvent(event, songId) {
    if (!S.session || !S.member) return;
    sb.from("activity").insert({ event: event, song_id: songId || null }).then(function () {}, function () {});
  }
  function ago(ts) {
    if (!ts) return "never";
    var d = (Date.now() - new Date(ts).getTime()) / 1000;
    if (d < 60) return "just now";
    if (d < 3600) return Math.floor(d / 60) + " min ago";
    if (d < 86400) return Math.floor(d / 3600) + " h ago";
    if (d < 7 * 86400) return Math.floor(d / 86400) + " d ago";
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  function when(ts) { return ts ? new Date(ts).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""; }
  var ICON_THUMB = '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M19.5 15.5v17l13.5-8.5z" fill="currentColor"/></svg>';
  var TITLE = 'Band <span>Portal</span>';
  var EYEBROW = 'Messiah Tour Canada 2026 · BVs &amp; Band';

  // ---------- data ----------
  async function loadAll() {
    var r = await Promise.all([
      sb.from("songs").select("*").order("artist_order").order("set_order"),
      sb.from("tracks").select("*"),
      sb.from("site_notice").select("body").eq("id", 1).maybeSingle(),
      sb.from("sets").select("*").order("sort"),
      sb.from("practice").select("*").eq("email", S.session.user.email.toLowerCase()),
      sb.from("practice_log").select("*").eq("email", S.session.user.email.toLowerCase()).order("day", { ascending: false }).order("created_at", { ascending: false })
    ]);
    if (r[0].error) throw r[0].error;
    S.songs = r[0].data || [];
    S.tracks = (r[1].data) || [];
    S.notice = r[2].data ? r[2].data.body : "";
    S.sets = r[3].data || [];
    S.practice = {}; (r[4].data || []).forEach(function (p) { S.practice[p.song_id] = p; });
    S.log = (r[5] && r[5].data) || [];
  }
  // The show's running order: songs grouped by set (from Michael's confirmed setlist).
  // Songs with no set are kept in a separate "Not on the setlist" group at the end.
  function setOf(song) { return S.sets.find(function (x) { return x.no === song.set_no; }) || null; }
  function setGroups() {
    var groups = S.sets.map(function (st) {
      return { key: String(st.no), title: st.title, short: st.short, sub: st.subtitle || "", songs: S.songs.filter(function (s) { return s.set_no === st.no; }).sort(function (a, b) { return (a.set_pos || 0) - (b.set_pos || 0); }) };
    }).filter(function (g) { return g.songs.length; });
    var other = S.songs.filter(function (s) { return !setOf(s); }).sort(function (a, b) { return a.title.localeCompare(b.title); });
    if (other.length) groups.push({ key: "other", title: "Not on the setlist", short: "Other", sub: "Kept here in case they come back in", songs: other, other: true });
    return groups;
  }
  // onlySet: artist filter chips list only songs on the setlist (the rest live under "Other")
  function artistGroups(onlySet) {
    var known = ARTISTS.map(function (a) { return a.name; });
    var extra = S.songs.map(function (s) { return s.artist; }).filter(function (n, i, arr) { return n && known.indexOf(n) < 0 && arr.indexOf(n) === i; });
    return ARTISTS.concat(extra.map(function (n) { return { name: n, short: n.split(" ")[0], role: "" }; })).map(function (a) {
      return { key: a.name, title: a.name, short: a.short, sub: a.role, songs: S.songs.filter(function (s) { return s.artist === a.name && (!onlySet || setOf(s)); }).sort(function (x, y) { return (x.set_order || 0) - (y.set_order || 0); }) };
    }).filter(function (g) { return g.songs.length; });
  }
  // what the list shows for the chosen filter chip
  function viewGroups() {
    if (S.view === "setlist") return setGroups().filter(function (g) { return !g.other; }).map(function (g) { g.setlist = true; return g; });
    if (S.view === "other") return setGroups().filter(function (g) { return g.other; });
    if (S.view === "all") return artistGroups();
    return artistGroups(true).filter(function (g) { return g.key === S.view; });
  }
  async function loadMember() {
    var email = S.session.user.email.toLowerCase();
    var r = await sb.from("band_members").select("*").eq("email", email).maybeSingle();
    S.member = r.data || null;
  }

  // ---------- routing ----------
  function route() {
    var h = location.hash.replace(/^#\/?/, "");
    var parts = h.split("/");
    if (parts[0] === "song" && parts[1]) return { view: "song", id: decodeURIComponent(parts[1]) };
    if (parts[0] === "band") return { view: "band" };
    if (parts[0] === "upload") return { view: "upload" };
    if (parts[0] === "activity") return { view: "activity" };
    if (parts[0] === "practice") return { view: "practice", log: parts[1] === "log" ? decodeURIComponent(parts[2] || "") || true : null };
    return { view: "list" };
  }
  window.addEventListener("hashchange", function () { S.editing = false; if (!/^#\/song\//.test(location.hash)) S.loggedSong = null; render(); window.scrollTo(0, 0); });

  // Leaving a song page: a mixer that has been played keeps going in the floating
  // player; one that was only loaded is dropped.
  function leavePage() {
    if (!mixer) return;
    var m = mixer; mixer = null;
    m.detach();
    if (m !== active) m.destroy(); else floatUpdate();
  }
  async function render() {
    closeViewer();
    if (route().view !== "song") leavePage();
    if (!S.session) return renderLogin();
    if (!S.member) return renderNotListed();
    var r = route();
    if (r.view === "song") return renderSong(r.id);
    if (r.view === "band" && isAdmin()) return renderBand();
    if (r.view === "upload" && isAdmin()) return renderBulk();
    if (r.view === "activity" && isAdmin()) return renderActivity();
    if (r.view === "practice") return renderPractice();
    return renderList();
  }

  // ---------- login ----------
  function renderLogin(msg, kind) {
    var signup = S.loginMode === "signup";
    app.innerHTML =
      '<div class="login">' + poster("login-poster") +
      '<div class="top"><div class="eyebrow">' + EYEBROW + '</div><h1>' + TITLE + '</h1></div>' +
      '<form class="card form" id="login-form" novalidate>' +
      '<h2>' + (signup ? "First time here" : "Sign in") + '</h2>' +
      (signup ? '<p class="muted" style="margin:0">Use the email ' + esc(CFG.adminName) + ' added to the band list, and choose a password.</p>' : '') +
      '<label class="f" for="email">Email<input id="email" type="email" autocomplete="email" required></label>' +
      '<label class="f" for="password">' + (signup ? "Choose a password" : "Password") + '<input id="password" type="password" minlength="8" autocomplete="' + (signup ? "new-password" : "current-password") + '" required></label>' +
      (msg ? '<div class="msg ' + (kind || "err") + '">' + esc(msg) + '</div>' : '') +
      '<button class="btn primary" type="submit" id="login-btn">' + (signup ? "Create my account" : "Sign in") + '</button>' +
      '<button class="linkbtn" type="button" id="mode">' + (signup ? "I already have a password" : "First time? Create your password") + '</button>' +
      '<p class="muted" style="margin:0;font-size:13px">Forgot your password? Message ' + esc(CFG.adminName) + ' to reset your account.</p>' +
      '<p class="muted" style="margin:0;font-size:13px">Sign-ins, song views and plays are logged for the tour team.</p>' +
      '</form></div>';
    $("#mode").onclick = function () { S.loginMode = signup ? "signin" : "signup"; renderLogin(); };
    $("#login-form").onsubmit = async function (e) {
      e.preventDefault();
      var email = $("#email").value.trim().toLowerCase(), pw = $("#password").value;
      if (!email || !pw) return renderLogin("Enter your email and password.");
      if (signup && pw.length < 8) return renderLogin("Use at least 8 characters for your password.");
      $("#login-btn").disabled = true;
      S.justSignedIn = true;
      var res = signup ? await sb.auth.signUp({ email: email, password: pw }) : await sb.auth.signInWithPassword({ email: email, password: pw });
      if (res.error) {
        S.justSignedIn = false;
        var m = res.error.message || "";
        if (signup && /database error|not on the/i.test(m)) return renderLogin("That email isn't on the band list. Ask " + CFG.adminName + " to add it, then try again.");
        if (/already registered|already exists/i.test(m)) { S.loginMode = "signin"; return renderLogin("You already have an account. Sign in with your password."); }
        if (/invalid login/i.test(m)) return renderLogin("Email or password is wrong. First time here? Use “Create your password”.");
        return renderLogin(m);
      }
      if (signup && !res.data.session) return renderLogin("Account created, but Supabase is waiting for an email confirmation that can't be sent. Ask " + CFG.adminName + " to turn off “Confirm email” in Supabase.");
    };
  }
  function renderNotListed() {
    app.innerHTML = '<div class="login card"><h2>You’re signed in, but not on the band list</h2><p>Ask ' + esc(CFG.adminName) + ' to add ' + esc(S.session.user.email) + '.</p><button class="btn" id="out">Sign out</button></div>';
    $("#out").onclick = function () { sb.auth.signOut(); };
  }

  // ---------- header ----------
  function header(full) {
    return '<header class="top' + (full ? '' : ' compact') + '">' +
      '<div class="topline"><div class="eyebrow">' + EYEBROW + '</div>' +
      '<div class="who"><span>' + esc(S.member.name || S.session.user.email) + '</span>' +
      (isAdmin() ? '<button class="online-pill" id="online-pill" type="button" hidden aria-controls="online-panel" aria-expanded="false"><span class="dot on" aria-hidden="true"></span><span>online</span></button>' : '') +
      '<a href="#/practice">My practice</a>' +
      (isAdmin() ? '<a href="#/band">Band list</a><a href="#/upload">Bulk upload</a><a href="#/activity">Activity</a>' : '') +
      '<button class="linkbtn" id="signout">Sign out</button></div></div>' +
      (full ? '<div class="hero"><div class="hero-text">' +
      '<span class="hero-tag">Vialy Studios Inc &amp; Grateful Events</span>' +
      '<h1>' + TITLE + '</h1>' +
      '<div class="presenters">Michael Mahendere &amp; Direct Worship · with Misheck Mahendere and Eleana Makombe</div>' +
      '<div class="dates"><span><b>Edmonton</b> Fri Oct 9</span><span><b>Toronto</b> Sat Oct 10</span><span><b>Vancouver</b> Sun Oct 11</span></div>' +
      '</div>' + poster("hero-poster") + '</div>' : '<a class="brand" href="#/">Messiah Tour ' + TITLE + '</a>') +
      '</header>';
  }
  function bindHeader() {
    var b = $("#signout"); if (b) b.onclick = function () { sb.auth.signOut(); };
    var op = $("#online-pill"); if (op) op.onclick = function () { presence.open = !presence.open; drawOnline(); };
    drawOnline(); trackPresence();
  }

  // ---------- library ----------
  function renderList() {
    var total = S.songs.length, ready = S.songs.filter(function (s) { return status(s).cls === "ok"; }).length;
    var ag = artistGroups(true), inSet = S.songs.filter(function (s) { return setOf(s); }).length, other = S.songs.length - inSet;
    var chips = [{ key: "all", label: "All " + total }]
      .concat(CHIP_ORDER.map(function (n) { return ag.find(function (g) { return g.key === n; }); }).filter(Boolean)
        .concat(ag.filter(function (g) { return CHIP_ORDER.indexOf(g.key) < 0; }))
        .map(function (g) { return { key: g.key, label: g.short + " " + g.songs.length }; }))
      .concat(inSet ? [{ key: "setlist", label: "Setlist " + inSet, cls: "setlist" }] : [])
      .concat(other ? [{ key: "other", label: "Other " + other, cls: "other" }] : []);
    if (!chips.some(function (c) { return c.key === S.view; })) S.view = "all";
    var h = header(true) + '<main class="sheet">';
    if (isAdmin() && S.editing) {
      h += '<div class="card admin form"><span class="admin-tag">Admin</span><label class="f" for="notice">Note to the band<textarea id="notice">' + esc(S.notice) + '</textarea></label><div class="tp-row"><button class="btn primary" id="save-notice">Save note</button><button class="btn quiet" id="cancel-notice">Cancel</button></div></div>';
    } else if (S.notice) {
      h += '<div class="notice"><strong>From the MD desk</strong>' + esc(S.notice) + (isAdmin() ? ' <button class="linkbtn" id="edit-notice">Edit</button>' : '') + '</div>';
    } else if (isAdmin()) {
      h += '<button class="linkbtn" id="edit-notice">Add a note to the band</button>';
    }
    h += '<div class="finder"><input class="search" id="q" type="search" placeholder="Find a song or a lyric line" aria-label="Search songs and lyrics" value="' + esc(S.q) + '">' +
      '<div class="chips" role="group" aria-label="Show songs">' +
      chips.map(function (c) { return '<button class="chip' + (c.cls ? ' ' + c.cls : '') + '" data-view="' + esc(c.key) + '" aria-pressed="' + (S.view === c.key) + '">' + esc(c.label) + '</button>'; }).join("") +
      '<span class="progress">' + ready + '/' + total + ' ready</span></div></div><div id="list"></div>' +
      '<footer><span>“Ready” means stems and lyrics are in. “Partial” means some files are in.</span></footer></main>';
    app.innerHTML = h;
    bindHeader();
    drawList();
    // Pressing the play button on a thumbnail opens the song and starts the mixer.
    var warm = function (e) { var a = e.target.closest && e.target.closest("a.row"); if (a && !a.dataset.warm) { a.dataset.warm = "1"; warmSong(decodeURIComponent((a.getAttribute("href") || "").replace(/^#\/song\//, ""))); } };
    $("#list").addEventListener("pointerover", warm);
    $("#list").addEventListener("touchstart", warm, { passive: true });
    $("#list").addEventListener("click", function (e) {
      var th = e.target.closest && e.target.closest(".thumb");
      var a = th && th.closest("a.row");
      if (a) S.autoplay = decodeURIComponent((a.getAttribute("href") || "").replace(/^#\/song\//, ""));
    });
    $("#q").oninput = function (e) { S.q = e.target.value; drawList(); };
    app.querySelectorAll("[data-view]").forEach(function (b) { b.onclick = function () { S.view = b.dataset.view; renderList(); }; });
    var en = $("#edit-notice"); if (en) en.onclick = function () { S.editing = true; renderList(); };
    var cn = $("#cancel-notice"); if (cn) cn.onclick = function () { S.editing = false; renderList(); };
    var sn = $("#save-notice"); if (sn) sn.onclick = async function () {
      sn.disabled = true;
      var body = $("#notice").value;
      var r = await sb.from("site_notice").upsert({ id: 1, body: body, updated_at: new Date().toISOString() });
      if (r.error) { alert(r.error.message); sn.disabled = false; return; }
      S.notice = body; S.editing = false; renderList();
    };
  }
  function drawList() {
    var q = S.q.toLowerCase(), out = "", any = false;
    viewGroups().forEach(function (g) {
      var list = g.songs.filter(function (s) { return !q || (s.title + " " + plainLyrics(s.lyrics)).toLowerCase().indexOf(q) > -1; });
      if (!list.length) return; any = true;
      out += '<section class="artist' + (g.other ? ' other' : '') + '"><div class="artist-head"><h2>' + esc(g.title) + '</h2><span class="sub">' + (g.sub ? esc(g.sub) + ' · ' : '') + list.length + ' song' + (list.length > 1 ? "s" : "") + '</span></div><ol class="songs">';
      list.forEach(function (s) {
        var st = status(s), meta = [s.key ? esc(s.key) : "", s.bpm ? s.bpm + " bpm" : ""].filter(Boolean).join(" · ");
        var by = g.setlist || g.other ? esc(s.artist) + (s.credit ? " · orig. " + esc(s.credit) : "") : (s.credit ? "orig. " + esc(s.credit) : esc(s.artist));
        out += '<li><a class="row" href="#/song/' + encodeURIComponent(s.id) + '" aria-label="Open ' + esc(s.title) + '">' +
          '<span class="thumb">' + (CFG.posterUrl ? '<img src="' + esc(CFG.posterUrl + (posterV ? "?v=" + posterV : "")) + '" alt="" loading="lazy" onerror="this.remove()">' : '') +
          '<span class="thumb-play" title="Play ' + esc(s.title) + '">' + ICON_THUMB + '</span></span>' +
          '<span class="title-block"><span class="name">' + esc(s.title) + '</span><span class="by">' + (g.other ? '' : '<span class="num">' + String(g.songs.indexOf(s) + 1).padStart(2, "0") + '</span> ') + by + (meta ? ' · ' + meta : '') + (myStatus(s.id) !== "none" ? ' <span class="pmark ' + PR[myStatus(s.id)].cls + '">' + PR[myStatus(s.id)].label + '</span>' : '') + '</span></span>' +
          '<span class="pill ' + st.cls + '">' + st.text + '</span></a></li>';
      });
      out += '</ol></section>';
    });
    $("#list").innerHTML = any ? out : '<div class="none-found">No songs match “' + esc(S.q) + '”.</div>';
  }

  // ---------- song page ----------
  function renderSong(id) {
    var s = S.songs.find(function (x) { return x.id === id; });
    if (!s) { app.innerHTML = header() + '<main class="sheet"><p>That song isn’t in the library. <a href="#/">Back to all songs</a></p></main>'; bindHeader(); return; }
    var stems = tracksFor(id, "stem"), guides = tracksFor(id, "guide"), charts = tracksFor(id, "chart");
    var mixTracks = myOrder(id);
    // a mixer that's already loaded for this song is put in the same order, so rows line up with it
    var live = [mixer, active].filter(function (m) { return m && !m.dead && m.songId === id && m.sig === trackSig(mixTracks); })[0];
    if (live) reorderLive(live, mixTracks);
    var facts = [];
    if (s.key) facts.push("<span>Key <b>" + esc(s.key) + "</b></span>");
    if (s.bpm) facts.push("<span>BPM <b>" + esc(s.bpm) + "</b></span>");
    var sg = setOf(s);
    if (sg) facts.unshift("<span>" + esc(sg.title) + " · <b>#" + (S.songs.filter(function (x) { return x.set_no === s.set_no && (x.set_pos || 0) < (s.set_pos || 0); }).length + 1) + "</b></span>");
    else facts.unshift('<span>Not on the setlist</span>');
    facts.push("<span><b>" + esc(s.artist) + "</b></span>");
    if (s.credit) facts.push("<span>Original by <b>" + esc(s.credit) + "</b></span>");
    var h = header() + '<main class="sheet">' +
      '<a class="back" href="#/"><span class="arr" aria-hidden="true">←</span> All songs</a>' +
      '<div class="songhead"><h1>' + esc(s.title) + '</h1><div class="facts">' + facts.join("") + '</div></div>' +
      '<div class="songgrid"><div class="col-main">';

    // mixer
    h += '<div class="block"><h3>Practice mixer</h3>';
    if (!mixTracks.length) {
      h += '<p class="empty">No audio uploaded for this song yet.</p>';
    } else {
      h += '<div class="desk">' +
        '<div class="transport">' +
        '<div class="tp-row"><button class="play" id="play" aria-label="Play" disabled>' + ICON_PLAY + '</button>' +
        '<span class="clock" id="clock">0:00 / 0:00</span>' +
        '<input class="scrub" id="scrub" type="range" min="0" max="1000" value="0" step="1" aria-label="Position"></div>' +
        '<div class="wave-row"><canvas class="wave" id="wave" role="slider" tabindex="0" aria-valuemin="0" aria-label="Song waveform. Tap to jump, drag across a section to repeat it."></canvas><span class="wave-note" id="wave-note"></span></div>' +
        '<div class="tp-row"><span class="tp-label">Speed</span><span class="seg" id="speed">' +
        [0.75, 0.9, 1].map(function (v) { return '<button data-rate="' + v + '" aria-pressed="' + (v === 1) + '">' + (v === 1 ? "1×" : v + "×") + '</button>'; }).join("") + '</span>' +
        '<span class="tp-label">Loop</span><span class="seg"><button id="loop-rep" aria-pressed="false" title="Repeat the song, or the section you picked">⟲ Repeat</button><button id="loop-a">Set A</button><button id="loop-b">Set B</button><button id="loop-clear">Clear</button></span>' +
        '<span class="loopinfo" id="loopinfo"></span></div>' +
        '<div class="tp-row part-row"><button type="button" class="part-btn" id="part-on" aria-pressed="false">★ My part louder</button>' +
        '<label class="lvl"><span>My part</span><input type="range" id="part-lvl" min="0" max="1.5" step="0.01" value="1"></label>' +
        '<label class="lvl"><span>Rest of the band</span><input type="range" id="band-lvl" min="0" max="1" step="0.01" value="0.35"></label>' +
        '<span class="part-hint" id="part-hint"></span></div>' +
        '<div class="loadbar" id="loadbar">Loading audio…</div>' +
        '</div><div class="tracks" id="tracks">' +
        mixTracks.map(function (t, i) {
          return '<div class="trk" data-i="' + i + '" data-id="' + esc(t.id) + '">' +
            '<span class="tname" data-hold><button type="button" class="grip" data-grip aria-label="Move ' + esc(t.label) + ' (hold and drag, or use the arrow keys)">⋮⋮</button><span class="tkind">' + (t.kind === "guide" ? "Guide mix" : "Stem") + '</span>' + esc(t.label) + '</span>' +
            '<span class="ms"><button class="m" data-mute="' + i + '" aria-pressed="false" aria-label="Mute ' + esc(t.label) + '">M</button><button class="s" data-solo="' + i + '" aria-pressed="false" aria-label="Solo ' + esc(t.label) + '">S</button><button class="p" data-part="' + i + '" aria-pressed="false" aria-label="My part: ' + esc(t.label) + '" title="This is my part">★</button></span>' +
            '<input type="range" min="0" max="1" step="0.01" value="1" data-vol="' + i + '" aria-label="Volume ' + esc(t.label) + '">' +
            (isAdmin() ? '<button class="linkbtn dl" data-dl="' + esc(t.id) + '">Download</button>' : '<span class="dl" aria-hidden="true"></span>') + '</div>';
        }).join("") + '</div></div>' +
        (mixTracks.length > 1 ? '<p class="order-note">' + (hasMyOrder(id) ? 'You’re using your own track order. <button type="button" class="linkbtn" id="reset-order">Use the band order</button>' : 'Hold a track and drag it to put them in your own order.') + '</p>' : '');
      if (stems.length && guides.length) h += '<p class="muted" style="font-size:14px">The guide mix starts muted so it doesn’t double the stems. Unmute it to hear the full recording.</p>';
    }
    h += '</div>';
    var myNote = S.practice[s.id] && S.practice[s.id].note;
    h += '<div class="block"><h3>My progress</h3>' + practiceControl(s.id, false) +
      '<details class="p-notes"' + (myNote ? ' open' : '') + '><summary>' + (myNote ? 'My notes' : 'Add a practice note') + '</summary><textarea data-pnote="' + esc(s.id) + '" rows="2" placeholder="What to work on, e.g. second chorus harmony">' + esc(myNote || "") + '</textarea><span class="pnote-msg muted"></span></details>' +
      songLogHtml(s.id) +
      '<p class="muted" style="margin:6px 0 0;font-size:13px">Only you' + (isAdmin() ? '' : ' and the tour admins') + ' see this. All your songs are on <a href="#/practice">My practice</a>.</p></div>';

    if (charts.length) {
      h += '<div class="block"><h3>Charts</h3><div class="charts">' + charts.map(function (c) { return '<button class="btn quiet" data-chart="' + esc(c.id) + '">' + esc(c.label) + ' ↗</button>'; }).join("") + '</div></div>';
    }
    h += '</div><div class="col-side">';
    if (s.bv_notes) h += '<div class="block"><h3>BV parts &amp; cues</h3>' + partsLegend(s.bv_notes) + '<div class="bvnotes">' + lyricsHtml(s.bv_notes) + '</div></div>';
    var sheet = pickSheet(charts);
    h += '<div class="block"><h3>Lyrics</h3>' + (s.lyrics ? '<p class="lyrics">' + esc(plainLyrics(s.lyrics)) + '</p>' : '<p class="empty">Lyrics not added yet.</p>') +
      (sheet ? '<button class="btn sheetbtn" data-sheet="' + esc(sheet.id) + '">' + ICON_EXPAND + ' Open Ruva’s coloured sheet</button>' : '') + '</div>';
    h += '</div></div>';

    if (isAdmin()) h += adminSongPanel(s, audioTracks(id).concat(charts));
    h += '</main>';
    app.innerHTML = h;
    bindHeader();

    // Reuse the live mixer if this song is already loaded or playing, so the page and the
    // floating player stay on the same audio. Otherwise start a fresh one.
    var sig = trackSig(mixTracks);
    if (mixer && (mixer.songId !== id || mixer.sig !== sig)) leavePage();
    if (active && active.songId === id && active.sig !== sig) active.destroy();
    if (mixTracks.length) {
      if (!mixer) mixer = active && active.songId === id ? active : null;
      if (!mixer) {
        mixer = new Mixer(mixTracks, stems.length > 0, s);
        mixer.onFirstPlay = function () { logEvent("play", s.id); };
        mixer.start();
      }
      mixer.attach();
      if (S.autoplay === s.id && !mixer.playing) { if (mixer.allReady()) mixer.play(true); else mixer.autoplay = true; }
    } else floatUpdate();
    S.autoplay = null;
    if (S.loggedSong !== s.id) { S.loggedSong = s.id; logEvent("song", s.id); }
    if (isAdmin()) app.querySelectorAll("[data-dl]").forEach(function (b) { b.onclick = function () { openFile(b.dataset.dl, true); }; });
    app.querySelectorAll("[data-chart],[data-sheet]").forEach(function (b) {
      b.onclick = function () {
        var t = S.tracks.find(function (x) { return x.id === (b.dataset.chart || b.dataset.sheet); });
        if (t && (isPdf(t) || isImg(t))) openViewer(t, s.title); else openFile(b.dataset.chart, false);
      };
    });
    if (isAdmin()) bindAdminSong(s);
    // your own track order: hold and drag in the mixer
    var tb = $("#tracks");
    if (tb && window.MTSort) MTSort(tb, { rows: ".trk", onDrop: function (ids, moved, kb) {
      var band = audioTracks(id).map(function (t) { return t.id; });
      saveMyOrder(id, ids.join(",") === band.join(",") ? null : ids);
      renderSong(id); refocusGrip(moved, kb);
    } });
    var ro = $("#reset-order"); if (ro) ro.onclick = function () { saveMyOrder(id, null); renderSong(id); };
    // the band order (everyone): drag in the admin file table
    var ft = $("#a-files-order");
    if (ft && window.MTSort) MTSort(ft, { rows: "tr[data-id]", onDrop: function (ids, moved, kb) { saveBandOrder(id, ids); refocusGrip(moved, kb); } });
  }
  function refocusGrip(id, kb) { if (!kb) return; var g = app.querySelector('[data-id="' + CSS.escape(id) + '"] [data-grip]'); if (g) g.focus(); }
  // Stems and guide mixes play in one admin-set order (tracks.sort), the same for everyone.
  function audioTracks(id) {
    return S.tracks.filter(function (t) { return t.song_id === id && (t.kind === "stem" || t.kind === "guide"); })
      .sort(function (a, b) { return (a.sort || 0) - (b.sort || 0) || (a.kind === b.kind ? 0 : a.kind === "stem" ? -1 : 1) || (a.created_at < b.created_at ? -1 : 1); });
  }
  function trackSig(list) { return list.map(function (t) { return t.id; }).sort().join(","); }
  function nextSort(songId) { var a = audioTracks(songId); return a.length ? Math.max.apply(null, a.map(function (t) { return t.sort || 0; })) + 1 : 0; }
  // Each person can keep their own order per song (saved in this browser); otherwise the band order.
  var ORDER_KEY = "mt-order-v1";
  function orderStore() { try { return JSON.parse(localStorage.getItem(ORDER_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function hasMyOrder(id) { var m = orderStore()[id]; return !!(m && m.length); }
  function saveMyOrder(id, ids) {
    var st = orderStore(); if (ids) st[id] = ids; else delete st[id];
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(st)); } catch (e) {}
  }
  function myOrder(id) {
    var band = audioTracks(id), mine = orderStore()[id];
    if (!mine || !mine.length) return band;
    var pos = {}; mine.forEach(function (x, i) { pos[x] = i; });
    var rank = function (t) { return t.id in pos ? pos[t.id] : 1e6 + band.indexOf(t); }; // new uploads go to the end
    return band.slice().sort(function (a, b) { return rank(a) - rank(b); });
  }
  function reorderLive(m, list) {
    var pos = {}; list.forEach(function (t, i) { pos[t.id] = i; });
    m.tracks.sort(function (a, b) { return pos[a.meta.id] - pos[b.meta.id]; });
  }
  async function saveBandOrder(songId, ids) {
    var changed = [];
    ids.forEach(function (tid, k) { var t = S.tracks.find(function (x) { return x.id === tid; }); if (t && t.sort !== k) { t.sort = k; changed.push(t); } });
    renderSong(songId);
    var res = await Promise.all(changed.map(function (t) { return sb.from("tracks").update({ sort: t.sort }).eq("id", t.id); }));
    var bad = res.filter(function (r) { return r.error; })[0];
    var msg = document.getElementById("a-order-msg");
    if (bad) alert("Couldn't save the new order: " + bad.error.message);
    else if (msg) msg.textContent = "Saved. This is now the order everyone sees.";
  }

  // ---------- full-screen sheet viewer ----------
  // PDFs are drawn with PDF.js so every page shows on phones too (iOS only shows
  // page 1 of a PDF in a frame). The floating player stays on top while it's open.
  var PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/", pdfjsP = null, viewer = null;
  function loadPdfjs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!pdfjsP) pdfjsP = new Promise(function (ok, bad) {
      var sc = document.createElement("script"); sc.src = PDFJS + "pdf.min.js";
      sc.onload = function () { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js"; ok(window.pdfjsLib); };
      sc.onerror = function () { pdfjsP = null; bad(new Error("The PDF viewer didn't load.")); };
      document.head.appendChild(sc);
    });
    return pdfjsP;
  }
  function isPdf(t) { return /\.pdf$/i.test(t.path); }
  function isImg(t) { return /\.(png|jpe?g|webp|gif)$/i.test(t.path); }
  function pickSheet(charts) {
    var v = charts.filter(function (c) { return isPdf(c) || isImg(c); });
    return v.find(function (c) { return /ruva|lyric sheet/i.test(c.label + " " + c.path); }) || v.find(isPdf) || v[0] || null;
  }
  function closeViewer() {
    if (!viewer) return;
    var v = viewer; viewer = null; v.dead = true;
    v.el.remove(); document.documentElement.classList.remove("pv-open");
    document.removeEventListener("keydown", v.key); window.removeEventListener("resize", v.resize);
    if (v.opener && v.opener.isConnected) v.opener.focus();
    floatUpdate();
  }
  async function openViewer(t, songTitle) {
    closeViewer();
    var el = document.createElement("div");
    el.className = "pv";
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", t.label);
    el.innerHTML = '<div class="pv-bar"><strong class="pv-title">' + esc(t.label) + '</strong>' +
      '<span class="pv-zoom"><button data-z="-1" aria-label="Zoom out">−</button><button data-z="0" aria-label="Fit to width">Fit</button><button data-z="1" aria-label="Zoom in">+</button></span>' +
      '<button class="pv-close" aria-label="Close sheet">×</button></div>' +
      '<div class="pv-body" tabindex="0"><div class="pv-pages"><p class="pv-msg">Opening the sheet…</p></div></div>';
    var v = viewer = { el: el, zoom: 1, dead: false, opener: document.activeElement, t: t };
    document.body.appendChild(el);
    document.documentElement.classList.add("pv-open");
    v.key = function (e) { if (e.key === "Escape") closeViewer(); };
    document.addEventListener("keydown", v.key);
    var rt = 0;
    v.resize = function () { clearTimeout(rt); rt = setTimeout(function () { if (!v.dead) drawSheet(v); }, 250); };
    window.addEventListener("resize", v.resize);
    el.querySelector(".pv-close").onclick = closeViewer;
    el.querySelectorAll("[data-z]").forEach(function (b) {
      b.onclick = function () { var z = +b.dataset.z; v.zoom = z === 0 ? 1 : Math.max(0.5, Math.min(3, v.zoom * (z > 0 ? 1.25 : 0.8))); drawSheet(v); };
    });
    el.querySelector(".pv-close").focus();
    floatDismissed = false; floatUpdate(); // the floating player sits on top of the sheet
    try {
      var r = await signedUrls([t.path]);
      if (r.error || !r.data[t.path]) throw new Error((r.error && r.error.message) || "No link for this file.");
      if (v.dead) return;
      v.url = r.data[t.path];
      if (isPdf(t)) { var lib = await loadPdfjs(); v.doc = await lib.getDocument({ url: v.url }).promise; }
      if (!v.dead) drawSheet(v);
    } catch (e) {
      if (!v.dead) el.querySelector(".pv-pages").innerHTML = '<p class="pv-msg">Couldn’t open the sheet: ' + esc(e.message || String(e)) + '</p>';
    }
  }
  async function drawSheet(v) {
    if (!v.url) return;
    var body = v.el.querySelector(".pv-body"), box = v.el.querySelector(".pv-pages");
    var w = Math.max(200, Math.min(body.clientWidth - 24, 1000) * v.zoom);
    var pos = body.scrollHeight > body.clientHeight ? body.scrollTop / body.scrollHeight : 0;
    var token = v.token = (v.token || 0) + 1;
    if (!v.doc) { // image sheet
      box.innerHTML = '<img class="pv-img" alt="' + esc(v.t.label) + '" src="' + esc(v.url) + '" style="width:' + Math.round(w) + 'px">';
      return;
    }
    var dpr = Math.min(window.devicePixelRatio || 1, 2), canvases = [];
    for (var i = 1; i <= v.doc.numPages; i++) {
      var page = await v.doc.getPage(i);
      if (v.dead || token !== v.token) return;
      var base = page.getViewport({ scale: 1 }), cssScale = w / base.width, px = cssScale * dpr;
      if (base.width * base.height * px * px > 16e6) px = Math.sqrt(16e6 / (base.width * base.height));
      var vp = page.getViewport({ scale: px });
      var c = document.createElement("canvas");
      c.className = "pv-page"; c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      c.style.width = Math.round(w) + "px"; c.style.height = Math.round(base.height * cssScale) + "px";
      c.setAttribute("aria-label", "Page " + i + " of " + v.doc.numPages);
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      if (v.dead || token !== v.token) return;
      canvases.push(c);
      if (i === 1) { box.innerHTML = ""; }
      box.appendChild(c);
      if (i === 1 && pos) body.scrollTop = pos * body.scrollHeight;
    }
    if (pos) body.scrollTop = pos * body.scrollHeight;
  }

  async function openFile(trackId, download) {
    if (download && !isAdmin()) return; // only admins can download audio
    var t = S.tracks.find(function (x) { return x.id === trackId; });
    if (!t) return;
    var win = window.open("", "_blank");
    var opts = download ? { download: t.label + (t.path.match(/\.[a-z0-9]+$/i) || [""])[0] } : undefined;
    var r = await sb.storage.from(BUCKET).createSignedUrl(t.path, 3600, opts);
    if (r.error) { if (win) win.close(); alert("Couldn't open that file: " + r.error.message); return; }
    if (win) win.location = r.data.signedUrl; else location.href = r.data.signedUrl;
  }

  // ---------- practice tracker ----------
  // Everyone marks their own progress per song (Not started → Learning → Almost there →
  // Show-ready, or "Not my part"). Only you see your own marks; admins also get a team view.
  var PR = {
    none: { label: "Not started", cls: "p-none" },
    learning: { label: "Learning", cls: "p-learn" },
    almost: { label: "Almost there", cls: "p-almost" },
    ready: { label: "Show-ready", cls: "p-ready" },
    skip: { label: "Not my part", cls: "p-skip" }
  };
  var PR_ORDER = ["none", "learning", "almost", "ready"];
  var FIRST_SHOW = new Date("2026-10-09T19:00:00-06:00"); // Edmonton
  function myStatus(id) { var p = S.practice[id]; return p ? p.status : "none"; }
  function bandPlaysSet(no) { var st = S.sets.find(function (x) { return x.no === no; }); return !!st && st.band_plays !== false; }
  // the songs the band has to learn: setlist sets the band plays, in running order
  function practiceGroups() {
    return setGroups().filter(function (g) { return !g.other && bandPlaysSet(+g.key); });
  }
  function practiceSongs() { return [].concat.apply([], practiceGroups().map(function (g) { return g.songs; })); }
  function daysToShow() { return Math.max(0, Math.ceil((FIRST_SHOW - Date.now()) / 86400000)); }
  function tally(statusOf, songs) {
    var c = { none: 0, learning: 0, almost: 0, ready: 0, skip: 0 };
    songs.forEach(function (s) { c[statusOf(s.id)]++; });
    c.total = songs.length - c.skip;
    return c;
  }
  function stackBar(c) {
    if (!c.total) return '<div class="pbar"></div>';
    return '<div class="pbar" role="img" aria-label="' + c.ready + ' show-ready, ' + c.almost + ' almost there, ' + c.learning + ' learning, ' + c.none + ' not started">' +
      ["ready", "almost", "learning"].map(function (k) { return c[k] ? '<span class="' + PR[k].cls + '" style="width:' + (c[k] / c.total * 100) + '%"></span>' : ''; }).join("") + '</div>';
  }
  function practiceControl(id, compact) {
    var cur = myStatus(id);
    return '<span class="pseg' + (compact ? ' compact' : '') + '" role="group" aria-label="My progress" data-psong="' + esc(id) + '">' +
      PR_ORDER.map(function (k) { return '<button type="button" class="' + PR[k].cls + '" data-pstat="' + k + '" aria-pressed="' + (cur === k) + '">' + PR[k].label + '</button>'; }).join("") +
      '<button type="button" class="p-skip" data-pstat="skip" aria-pressed="' + (cur === "skip") + '" title="Not something you play or sing">Not my part</button></span>';
  }
  async function setPractice(songId, status, note) {
    var me = S.session.user.email.toLowerCase(), cur = S.practice[songId];
    var n = note === undefined ? (cur ? cur.note : null) : ((note || "").trim() || null);
    if (status === "none" && !n) {
      delete S.practice[songId];
      return sb.from("practice").delete().eq("email", me).eq("song_id", songId);
    }
    var row = { email: me, song_id: songId, status: status, note: n, updated_at: new Date().toISOString() };
    S.practice[songId] = row;
    return sb.from("practice").upsert(row, { onConflict: "email,song_id" });
  }
  // one listener for every progress control on any page
  app.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-pstat]"); if (!b) return;
    var grp = b.closest("[data-psong]"), id = grp.dataset.psong, k = b.dataset.pstat;
    if (k === myStatus(id) && k !== "none") k = "none"; // tap the lit one again to clear it
    setPractice(id, k).then(function (r) { if (r && r.error) alert("Couldn't save your progress: " + r.error.message); });
    app.querySelectorAll('[data-psong="' + CSS.escape(id) + '"] [data-pstat]').forEach(function (x) { x.setAttribute("aria-pressed", String(x.dataset.pstat === k)); });
    var sm = document.getElementById("p-summary"); if (sm) sm.innerHTML = practiceSummary();
  });
  app.addEventListener("change", function (e) {
    var t = e.target; if (!t.dataset || !t.dataset.pnote) return;
    setPractice(t.dataset.pnote, myStatus(t.dataset.pnote), t.value).then(function (r) {
      var m = t.parentNode.querySelector(".pnote-msg"); if (m) m.textContent = r && r.error ? "Couldn't save: " + r.error.message : "Saved";
    });
  });
  function practiceSummary() {
    var songs = practiceSongs(), c = tally(myStatus, songs), d = daysToShow();
    return '<div class="p-hero"><div><b class="p-big">' + c.ready + '<small>/' + c.total + '</small></b><span>songs show-ready</span></div>' +
      '<div><b class="p-big">' + d + '</b><span>day' + (d === 1 ? '' : 's') + ' to Edmonton</span></div></div>' + stackBar(c) +
      '<div class="plegend">' + ["ready", "almost", "learning", "none", "skip"].map(function (k) { return '<span><i class="' + PR[k].cls + '"></i>' + PR[k].label + ' ' + c[k] + '</span>'; }).join("") + '</div>';
  }
  // ---------- practice log (diary) ----------
  // Log what you practised on a given day: which songs, which part, which sections and
  // whether you learnt it. Logging moves the song's progress forward (never backwards):
  // any practice → at least "Learning"; learnt the whole song → at least "Almost there".
  // "Show-ready" stays your call.
  var LOG_PARTS = ["Guitar", "Bass", "Keys", "Drums", "Vocals", "BVs", "Other"];
  var SECTIONS = ["Whole song", "Intro", "Verse", "Pre-chorus", "Chorus", "Bridge", "Solo", "Outro"];
  function pad2(n) { return String(n).padStart(2, "0"); }
  function localDay(d) { d = d || new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function dayShift(iso, n) { var d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return localDay(d); }
  function dayLabel(iso) {
    var t = localDay();
    if (iso === t) return "Today";
    if (iso === dayShift(t, -1)) return "Yesterday";
    return new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }
  function dayPhrase(iso) { var d = dayLabel(iso); return /^(Today|Yesterday)$/.test(d) ? d.toLowerCase() : d; }
  function songTitle(id) { var s = S.songs.find(function (x) { return x.id === id; }); return s ? s.title : id; }
  function whatText(sections, outcome) {
    var whole = sections.indexOf("Whole song") !== -1;
    var what = whole ? "the whole song" : sections.map(function (x) { return x.toLowerCase(); }).join(", ");
    return (outcome === "learnt" ? "Learnt " : "Worked on ") + what;
  }
  // what I've learnt so far on a song, per part: "Guitar: whole song" / "Guitar: chorus, verse"
  function learntText(id) {
    var by = {};
    S.log.forEach(function (l) {
      if (l.song_id !== id || l.outcome !== "learnt") return;
      var p = by[l.part] = by[l.part] || [];
      l.sections.forEach(function (x) { if (p.indexOf(x) === -1) p.push(x); });
    });
    return Object.keys(by).map(function (p) {
      var secs = by[p];
      return p + ": " + (secs.indexOf("Whole song") !== -1 ? "whole song" : SECTIONS.filter(function (x) { return secs.indexOf(x) !== -1; }).map(function (x) { return x.toLowerCase(); }).join(", "));
    }).join(" · ");
  }
  function lastPractised(id) { var l = S.log.find(function (x) { return x.song_id === id; }); return l ? l.day : null; }
  function songLogHtml(id) {
    var lt = learntText(id), mine = S.log.filter(function (l) { return l.song_id === id; }).slice(0, 4);
    return '<div class="p-songlog">' +
      (lt ? '<div class="p-learnt">✓ Learnt so far: ' + esc(lt) + '</div>' : '') +
      (mine.length ? '<ul>' + mine.map(function (l) { return '<li><b>' + esc(dayLabel(l.day)) + '</b> · ' + esc(l.part) + ' · ' + esc(whatText(l.sections, l.outcome)) + (l.note ? ' <span class="muted">— ' + esc(l.note) + '</span>' : '') + '</li>'; }).join("") + '</ul>' : '') +
      '<a class="btn quiet p-logbtn" href="#/practice/log/' + encodeURIComponent(id) + '">＋ Log practice for this song</a></div>';
  }
  // group rows saved together (same day, same save) into one diary entry
  function sessions(rows) {
    var out = [], key = {};
    rows.forEach(function (l) {
      var k = l.email + "|" + l.day + "|" + l.created_at + "|" + l.part + "|" + l.outcome + "|" + l.sections.join(",");
      if (!key[k]) { key[k] = { email: l.email, day: l.day, part: l.part, outcome: l.outcome, sections: l.sections, note: l.note, minutes: 0, songs: [], ids: [], at: l.created_at }; out.push(key[k]); }
      key[k].songs.push(l.song_id); key[k].ids.push(l.id); key[k].minutes += l.minutes || 0;
    });
    return out;
  }
  function streak(days) {
    var set = {}; days.forEach(function (d) { set[d] = 1; });
    var d = localDay(); if (!set[d]) d = dayShift(d, -1);
    var n = 0; while (set[d]) { n++; d = dayShift(d, -1); }
    return n;
  }
  function logStats() {
    var days = {}; S.log.forEach(function (l) { days[l.day] = (days[l.day] || 0) + 1; });
    var list = Object.keys(days), mins = S.log.reduce(function (a, l) { return a + (l.minutes || 0); }, 0);
    var t = localDay(), strip = "";
    for (var i = 13; i >= 0; i--) {
      var d = dayShift(t, -i), n = days[d] || 0;
      strip += '<span class="p-day' + (n ? ' on' : '') + (i === 0 ? ' today' : '') + '" title="' + esc(dayLabel(d)) + (n ? ': ' + n + ' song' + (n === 1 ? '' : 's') : ': no practice logged') + '"><i style="opacity:' + (n ? Math.min(1, .45 + n * .15) : 1) + '"></i><small>' + new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "narrow" }) + '</small></span>';
    }
    return '<div class="p-hero"><div><b class="p-big">' + list.length + '</b><span>days practised</span></div>' +
      '<div><b class="p-big">' + streak(list) + '</b><span>day streak</span></div>' +
      (mins ? '<div><b class="p-big">' + (mins >= 60 ? Math.floor(mins / 60) + '<small>h</small> ' + (mins % 60 ? (mins % 60) + '<small>m</small>' : '') : mins + '<small>m</small>') + '</b><span>logged</span></div>' : '') +
      '</div><div class="p-strip" aria-label="Last 14 days">' + strip + '</div>';
  }

  // the "Log practice" form
  var LOGF = null;
  function newLogForm(songId) {
    var last = S.log[0];
    LOGF = { day: localDay(), part: last ? last.part : "", songs: songId && songId !== true ? [songId] : [], sections: ["Whole song"], outcome: "learnt", minutes: "", note: "", msg: "" };
  }
  function logFormHtml() {
    var f = LOGF, t = localDay(), y = dayShift(t, -1);
    var pick = function (attr, val, on, label, cls) { return '<button type="button" class="lf-chip' + (cls ? ' ' + cls : '') + '" data-lf="' + attr + '" data-v="' + esc(val) + '" aria-pressed="' + on + '">' + esc(label || val) + '</button>'; };
    var h = '<div class="p-top"><h3>Log practice</h3><button type="button" class="linkbtn" data-lf="close">Cancel</button></div>' +
      '<div class="lf-row"><span class="lf-lab">When</span><div class="lf-chips">' + pick("day", t, f.day === t, "Today") + pick("day", y, f.day === y, "Yesterday") +
      '<input type="date" class="lf-date" data-lfin="day" value="' + f.day + '" max="' + t + '" min="2026-08-01" aria-label="Pick another day"></div></div>' +
      '<div class="lf-row"><span class="lf-lab">Part</span><div class="lf-chips">' + LOG_PARTS.map(function (p) { return pick("part", p, f.part === p); }).join("") + '</div></div>' +
      '<div class="lf-row"><span class="lf-lab">Songs <em>' + (f.songs.length ? f.songs.length + ' picked' : 'pick one or more') + '</em></span><div class="lf-songs">' +
      practiceGroups().map(function (g) {
        return '<div class="lf-set"><small>' + esc(g.short || g.title) + '</small><div class="lf-chips">' + g.songs.map(function (s) { return pick("song", s.id, f.songs.indexOf(s.id) !== -1, s.title); }).join("") + '</div></div>';
      }).join("") + '</div></div>' +
      '<div class="lf-row"><span class="lf-lab">What</span><div class="lf-chips">' + SECTIONS.map(function (x) { return pick("sec", x, f.sections.indexOf(x) !== -1); }).join("") + '</div></div>' +
      '<div class="lf-row"><span class="lf-lab">How did it go</span><div class="lf-chips">' + pick("out", "learnt", f.outcome === "learnt", "Learnt it ✓", "p-ready") + pick("out", "worked", f.outcome === "worked", "Still working on it", "p-learn") + '</div></div>' +
      '<div class="lf-row two"><label><span class="lf-lab">Minutes <em>optional, total</em></span><input type="number" inputmode="numeric" min="1" max="600" data-lfin="minutes" value="' + esc(f.minutes) + '" placeholder="e.g. 45"></label>' +
      '<label><span class="lf-lab">Note <em>optional</em></span><input type="text" maxlength="300" data-lfin="note" value="' + esc(f.note) + '" placeholder="e.g. the guitar line in the chorus"></label></div>' +
      '<div class="lf-foot"><button type="button" class="btn" data-lf="save">Save to my diary</button><span class="muted lf-msg" role="status">' + esc(f.msg) + '</span></div>';
    return h;
  }
  function drawLogForm() { var el = document.getElementById("p-logform"); if (el) el.innerHTML = logFormHtml(); }
  function toggleIn(arr, v) { var i = arr.indexOf(v); if (i === -1) arr.push(v); else arr.splice(i, 1); }
  async function saveLog() {
    var f = LOGF;
    var err = !f.part ? "Pick the part you practised." : !f.songs.length ? "Pick at least one song." : !f.sections.length ? "Pick what you worked on." : f.day > localDay() ? "That day hasn’t happened yet." : "";
    if (err) { f.msg = err; drawLogForm(); return; }
    var me = S.session.user.email.toLowerCase(), m = parseInt(f.minutes, 10);
    // split the session's minutes across the songs so they add back up to the total
    var n = f.songs.length, base = m > 0 ? Math.floor(m / n) : 0, extra = m > 0 ? m % n : 0;
    var rows = f.songs.map(function (id, i) { var mm = m > 0 ? base + (i < extra ? 1 : 0) : 0; return { email: me, day: f.day, song_id: id, part: f.part, sections: f.sections.slice(), outcome: f.outcome, minutes: mm > 0 ? mm : null, note: f.note.trim() || null }; });
    f.msg = "Saving…"; drawLogForm();
    var r = await sb.from("practice_log").insert(rows).select();
    if (r.error) { f.msg = "Couldn’t save: " + r.error.message; drawLogForm(); return; }
    S.log = (r.data || []).concat(S.log).sort(function (a, b) { return a.day < b.day ? 1 : a.day > b.day ? -1 : (a.created_at < b.created_at ? 1 : -1); });
    // move progress forward, never back
    var whole = f.outcome === "learnt" && f.sections.indexOf("Whole song") !== -1, moved = [];
    for (var i = 0; i < f.songs.length; i++) {
      var id = f.songs[i], cur = myStatus(id), next = cur;
      if (cur === "none" || cur === "skip") next = "learning";
      if (whole && next === "learning") next = "almost";
      if (next !== cur) { moved.push(songTitle(id) + " → " + PR[next].label); await setPractice(id, next); }
    }
    PFLASH = "Logged " + f.songs.length + " song" + (f.songs.length === 1 ? "" : "s") + " for " + dayPhrase(f.day) + "." +
      (moved.length ? " Progress updated: " + moved.join(", ") + "." : "") + (whole ? " When you can play it through with the track, mark it Show-ready." : "");
    LOGF = null;
    if (/^#\/practice\/log/.test(location.hash)) history.replaceState(null, "", "#/practice");
    renderPractice();
  }
  var PFLASH = "";
  app.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-lf]"); if (!b) return;
    var a = b.dataset.lf, v = b.dataset.v;
    if (a === "open") { newLogForm(); var el = document.getElementById("p-logform"); el.hidden = false; drawLogForm(); el.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (a === "close") { LOGF = null; var c = document.getElementById("p-logform"); if (c) { c.hidden = true; c.innerHTML = ""; } if (/^#\/practice\/log/.test(location.hash)) history.replaceState(null, "", "#/practice"); return; }
    if (a === "save") { saveLog(); return; }
    if (a === "del") {
      if (!confirm("Delete this diary entry? Your progress marks stay as they are.")) return;
      var ids = v.split(",");
      sb.from("practice_log").delete().in("id", ids).then(function (r) {
        if (r.error) return alert("Couldn’t delete: " + r.error.message);
        S.log = S.log.filter(function (l) { return ids.indexOf(l.id) === -1; }); renderPractice();
      });
      return;
    }
    if (!LOGF) return;
    if (a === "day") LOGF.day = v;
    else if (a === "part") LOGF.part = v;
    else if (a === "song") toggleIn(LOGF.songs, v);
    else if (a === "out") LOGF.outcome = v;
    else if (a === "sec") {
      if (v === "Whole song") LOGF.sections = LOGF.sections.indexOf(v) === -1 ? ["Whole song"] : [];
      else { LOGF.sections = LOGF.sections.filter(function (x) { return x !== "Whole song"; }); toggleIn(LOGF.sections, v); }
    }
    LOGF.msg = ""; drawLogForm();
  });
  app.addEventListener("input", function (e) {
    var t = e.target; if (!LOGF || !t.dataset || !t.dataset.lfin) return;
    LOGF[t.dataset.lfin] = t.value;
    if (t.dataset.lfin === "day" && t.value) drawLogForm();
  });
  function diaryHtml(rows, showWho, nameOf) {
    var ss = sessions(rows);
    if (!ss.length) return '<p class="muted">' + (showWho ? 'Nobody has logged any practice yet.' : 'Nothing logged yet. Tap “Log practice” after each session and it’ll build up here.') + '</p>';
    var h = '', lastDay = null;
    ss.forEach(function (x) {
      if (x.day !== lastDay) { if (lastDay) h += '</ul>'; h += '<h4 class="p-dayhead">' + esc(dayLabel(x.day)) + '</h4><ul class="p-diary">'; lastDay = x.day; }
      h += '<li><div class="p-entry"><span class="pmark ' + (x.outcome === "learnt" ? 'p-ready' : 'p-learn') + '">' + esc(x.part) + '</span>' +
        (showWho ? '<b>' + esc(nameOf(x.email)) + '</b> ' : '') + esc(whatText(x.sections, x.outcome)) + (x.minutes ? ' <span class="muted">· ' + x.minutes + ' min</span>' : '') +
        (!showWho ? '<button type="button" class="linkbtn p-del" data-lf="del" data-v="' + esc(x.ids.join(",")) + '" aria-label="Delete this entry">Delete</button>' : '') + '</div>' +
        '<div class="p-entry-songs">' + x.songs.map(function (id) { return '<a href="#/song/' + encodeURIComponent(id) + '">' + esc(songTitle(id)) + '</a>'; }).join("") + '</div>' +
        (x.note ? '<div class="muted p-entry-note">' + esc(x.note) + '</div>' : '') + '</li>';
    });
    return h + '</ul>';
  }
  var PVIEW = { tab: "mine" };
  async function renderPractice() {
    app.innerHTML = header() + '<main class="sheet"><a class="back" href="#/"><span class="arr" aria-hidden="true">←</span> All songs</a><p class="muted">Loading your practice…</p></main>';
    bindHeader();
    var me = S.session.user.email.toLowerCase();
    var q = [sb.from("listens").select("song_id,seconds").eq("email", me)];
    if (isAdmin()) q.push(sb.from("practice").select("*"), sb.from("band_members").select("email,name,role"),
      sb.from("practice_log").select("*").order("day", { ascending: false }).order("created_at", { ascending: false }).limit(500));
    var r = await Promise.all(q);
    if (route().view !== "practice") return;
    var mins = {}; (r[0].data || []).forEach(function (l) { mins[l.song_id] = (mins[l.song_id] || 0) + (l.seconds || 0); });
    var admin = isAdmin(), rt = route(), tab = admin && !rt.log ? PVIEW.tab : "mine";
    if (rt.log && !LOGF) newLogForm(rt.log);
    var h = header() + '<main class="sheet"><a class="back" href="#/"><span class="arr" aria-hidden="true">←</span> All songs</a>' +
      '<div class="p-top"><h2>' + (tab === "team" ? "Team readiness" : "My practice") + '</h2>' +
      (admin ? '<span class="seg dark" role="group" aria-label="View"><button data-ptab="mine" aria-pressed="' + (tab === "mine") + '">Mine</button><button data-ptab="team" aria-pressed="' + (tab === "team") + '">Team</button></span>' : '') + '</div>';
    if (tab === "mine") {
      h += '<p class="muted" style="margin:6px 0 16px">Mark where you are with each song on the setlist. Only you see your marks' + (admin ? '' : ' (and the tour admins, so they know what to run at rehearsal)') + '. Tap a lit button again to clear it.</p>' +
        '<div class="card p-card" id="p-summary">' + practiceSummary() + '</div>' +
        (PFLASH ? '<div class="p-flash" role="status">' + esc(PFLASH) + '</div>' : '') +
        '<div class="card p-card p-diarycard" style="margin-top:16px"><div class="p-top"><h3>Practice diary</h3>' + (LOGF ? '' : '<button type="button" class="btn" data-lf="open">＋ Log practice</button>') + '</div>' + logStats() + '</div>' +
        '<div class="card p-card p-logform" id="p-logform"' + (LOGF ? '' : ' hidden') + '>' + (LOGF ? logFormHtml() : '') + '</div>';
      PFLASH = "";
      practiceGroups().forEach(function (g) {
        h += '<section class="p-set"><div class="artist-head"><h2>' + esc(g.title) + '</h2><span class="sub">' + (g.sub ? esc(g.sub) + ' · ' : '') + g.songs.length + ' songs</span></div><ol class="p-list">';
        g.songs.forEach(function (s, i) {
          var note = S.practice[s.id] && S.practice[s.id].note;
          h += '<li><div class="p-song"><span class="num">' + String(i + 1).padStart(2, "0") + '</span><a href="#/song/' + encodeURIComponent(s.id) + '">' + esc(s.title) + '</a>' +
            '<span class="meta">' + (lastPractised(s.id) ? 'practised ' + esc(dayPhrase(lastPractised(s.id))) + ' · ' : '') + (mins[s.id] ? 'listened ' + fmtDur(mins[s.id]) : 'not played yet') + '</span></div>' +
            (learntText(s.id) ? '<div class="p-learnt">✓ ' + esc(learntText(s.id)) + '</div>' : '') +
            practiceControl(s.id, true) +
            '<details class="p-notes"' + (note ? ' open' : '') + '><summary>' + (note ? 'My notes' : 'Add a note') + '</summary><textarea data-pnote="' + esc(s.id) + '" rows="2" placeholder="e.g. second chorus harmony, key change at the bridge">' + esc(note || "") + '</textarea><span class="pnote-msg muted"></span></details></li>';
        });
        h += '</ol></section>';
      });
      h += '<section class="p-set" id="p-diary"><div class="artist-head"><h2>My diary</h2><span class="sub">every session you’ve logged</span></div>' + diaryHtml(S.log, false) + '</section>';
    } else {
      var allLog = r[3].data || [], all = r[1].data || [], members = (r[2].data || []).slice().sort(function (a, b) { return (a.name || a.email).localeCompare(b.name || b.email); });
      var by = {}; all.forEach(function (p) { (by[p.email] = by[p.email] || {})[p.song_id] = p; });
      var songs = practiceSongs();
      var rows = members.map(function (m) {
        var mine = by[m.email] || {}, st = function (id) { return mine[id] ? mine[id].status : "none"; };
        var c = tally(st, songs), last = Object.keys(mine).map(function (k) { return mine[k].updated_at; }).sort().pop();
        var wk = dayShift(localDay(), -6), logs = allLog.filter(function (l) { return l.email === m.email; });
        var days7 = {}; logs.forEach(function (l) { if (l.day >= wk) days7[l.day] = 1; });
        return { m: m, c: c, st: st, last: last, pct: c.total ? c.ready / c.total : 0, days7: Object.keys(days7).length, lastDay: logs.length ? logs[0].day : null };
      }).sort(function (a, b) { return b.pct - a.pct || b.c.almost - a.c.almost; });
      h += '<p class="muted" style="margin:6px 0 16px">Everyone’s own marks on the ' + songs.length + ' setlist songs the band plays. “Not my part” songs don’t count against anyone.</p>' +
        '<div class="card p-card"><h3>By person</h3><div class="tablewrap"><table class="band act p-team"><thead><tr><th>Name</th><th>Progress</th><th>Ready</th><th>Almost</th><th>Learning</th><th>Not started</th><th>Practice days<br><small>last 7</small></th><th>Last practised</th><th>Updated</th></tr></thead><tbody>' +
        rows.map(function (x) {
          return '<tr><td><span class="dot off" data-online="' + esc(x.m.email) + '" aria-hidden="true"></span><b>' + esc(x.m.name || x.m.email) + '</b></td><td style="min-width:140px">' + stackBar(x.c) + '<div class="meta">' + Math.round(x.pct * 100) + '% show-ready</div></td>' +
            '<td class="n">' + x.c.ready + '</td><td class="n">' + x.c.almost + '</td><td class="n">' + x.c.learning + '</td><td class="n">' + x.c.none + '</td><td class="n">' + x.days7 + '</td><td>' + (x.lastDay ? esc(dayLabel(x.lastDay)) : '<span class="muted">—</span>') + '</td><td>' + (x.last ? ago(x.last) : '<span class="muted">not yet</span>') + '</td></tr>';
        }).join("") + '</tbody></table></div></div>' +
        '<div class="card p-card" style="margin-top:20px"><h3>Songs that need the most work</h3><ol class="p-needs">' +
        songs.map(function (s) {
          var who = rows.map(function (x) { return { name: x.m.name || x.m.email, st: x.st(s.id) }; }).filter(function (w) { return w.st !== "skip"; });
          var ready = who.filter(function (w) { return w.st === "ready"; }).length;
          return { s: s, who: who, ready: ready, score: who.length ? ready / who.length : 1 };
        }).sort(function (a, b) { return a.score - b.score; }).map(function (x) {
          var behind = x.who.filter(function (w) { return w.st !== "ready"; });
          return '<li><div class="ts-line"><a href="#/song/' + encodeURIComponent(x.s.id) + '">' + esc(x.s.title) + '</a><b>' + x.ready + '/' + x.who.length + ' ready</b></div>' +
            (behind.length ? '<div class="p-who">' + behind.map(function (w) { return '<span class="pmark ' + PR[w.st].cls + '">' + esc(w.name) + ' · ' + PR[w.st].label + '</span>'; }).join("") + '</div>' : '<div class="meta">Everyone is show-ready</div>') + '</li>';
        }).join("") + '</ol></div>' +
        '<div class="card p-card" style="margin-top:20px"><h3>Recent practice</h3>' +
        diaryHtml(allLog.slice(0, 80), true, function (e) { var m = members.find(function (x) { return x.email === e; }); return m ? (m.name || e) : e; }) + '</div>';
    }
    h += '</main>';
    app.innerHTML = h;
    bindHeader();
    app.querySelectorAll("[data-ptab]").forEach(function (b) { b.onclick = function () { PVIEW.tab = b.dataset.ptab; renderPractice(); }; });
    drawOnline();
    if (rt.log) { var lf = document.getElementById("p-logform"); if (lf) lf.scrollIntoView({ block: "start" }); }
  }

  // ---------- who's online ----------
  // Everyone signed in joins a private Realtime presence channel ("online"). Only band
  // members can join it (database rule). Admins see the list: green dot = on the site now,
  // grey = offline, with what they're playing or when they were last seen.
  var presence = { ch: null, status: "", online: {}, members: [], summary: {}, left: {}, last: "", open: false, timer: 0 };
  function startPresence() {
    if (presence.ch || !S.session || !S.member) return;
    var me = S.session.user.email.toLowerCase();
    var ch = sb.channel("online", { config: { private: true, presence: { key: me } } });
    presence.ch = ch;
    ch.on("presence", { event: "sync" }, function () { presence.online = ch.presenceState(); drawOnline(); });
    ch.on("presence", { event: "leave" }, function (e) { if (e && e.key) presence.left[e.key] = new Date().toISOString(); });
    ch.subscribe(function (st) { presence.status = st; if (st === "SUBSCRIBED") trackPresence(true); drawOnline(); });
    if (isAdmin()) { loadPresenceMembers(); presence.timer = setInterval(loadPresenceMembers, 120000); }
  }
  function stopPresence() {
    clearInterval(presence.timer);
    if (presence.ch) { try { sb.removeChannel(presence.ch); } catch (e) {} }
    presence.ch = null; presence.status = ""; presence.online = {}; presence.last = "";
    var p = document.getElementById("online-panel"); if (p) p.remove();
    document.documentElement.classList.remove("online-side");
  }
  async function loadPresenceMembers() {
    var r = await Promise.all([sb.from("band_members").select("email,name,role"), sb.rpc("admin_activity_summary")]);
    presence.members = r[0].data || [];
    presence.summary = {}; (r[1].data || []).forEach(function (m) { presence.summary[m.email] = m; });
    drawOnline();
  }
  // tell everyone what this person is doing (only sent when it changes)
  function trackPresence(force) {
    if (!presence.ch || presence.status !== "SUBSCRIBED") return;
    var m = active && !active.dead ? active : null, r = route(), page = "";
    if (r.view === "song") { var s = S.songs.find(function (x) { return x.id === r.id; }); page = s ? s.title : ""; }
    var st = { name: S.member.name || "", song: m ? m.title : "", playing: !!(m && m.playing), page: page };
    var key = JSON.stringify(st);
    if (!force && key === presence.last) return;
    presence.last = key;
    presence.ch.track(st);
  }
  function onlineNow() {
    var out = {};
    Object.keys(presence.online || {}).forEach(function (k) {
      var metas = presence.online[k] || [];
      if (!metas.length) return;
      out[k] = metas.find(function (x) { return x.playing; }) || metas.find(function (x) { return x.page; }) || metas[0];
    });
    return out;
  }
  function onlineRows() {
    var on = onlineNow(), seen = {};
    var rows = presence.members.map(function (m) { seen[m.email] = 1; return { email: m.email, name: m.name || m.email, role: m.role, on: on[m.email] || null }; });
    Object.keys(on).forEach(function (k) { if (!seen[k]) rows.push({ email: k, name: on[k].name || k, on: on[k] }); });
    rows.forEach(function (r) {
      var sm = presence.summary[r.email] || {};
      var lastSeen = [sm.last_seen, sm.last_sign_in, presence.left[r.email]].filter(Boolean).sort().pop();
      r.what = r.on ? (r.on.playing ? "▶ " + r.on.song : r.on.page ? "Viewing " + r.on.page : "On the site")
        : lastSeen ? "Seen " + ago(lastSeen) : sm.has_account === false ? "No account yet" : "Not seen yet";
    });
    rows.sort(function (a, b) { return (!!b.on - !!a.on) || a.name.localeCompare(b.name); });
    return rows;
  }
  function drawOnline() {
    if (!isAdmin() || !presence.ch) return;
    var rows = onlineRows(), n = rows.filter(function (r) { return r.on; }).length;
    var pill = document.getElementById("online-pill");
    if (pill) { pill.hidden = false; pill.querySelector("span:last-child").textContent = n + " online"; pill.setAttribute("aria-expanded", String(presence.open)); }
    var p = document.getElementById("online-panel");
    if (!p) {
      p = document.createElement("aside");
      p.id = "online-panel"; p.setAttribute("aria-label", "Who's online");
      document.body.appendChild(p);
      document.addEventListener("click", function (e) {
        if (!presence.open) return;
        if (e.target.closest && (e.target.closest("#online-panel") || e.target.closest("#online-pill"))) return;
        presence.open = false; drawOnline();
      });
    }
    document.documentElement.classList.add("online-side");
    p.classList.toggle("open", presence.open);
    p.innerHTML = '<div class="op-head"><strong>Band online</strong><span>' + n + ' of ' + rows.length + '</span></div>' +
      (presence.status && presence.status !== "SUBSCRIBED" ? '<p class="op-note">Connecting…</p>' : '') +
      '<ul>' + rows.map(function (r) {
        return '<li class="' + (r.on ? "is-on" : "") + '"><span class="dot ' + (r.on ? "on" : "off") + '" aria-hidden="true"></span>' +
          '<span class="op-who"><b>' + esc(r.name) + '</b><span>' + esc(r.what) + '</span></span></li>';
      }).join("") + '</ul>';
    p.querySelectorAll("li").forEach(function (li, i) { li.title = rows[i].email + (rows[i].on ? " · online now" : " · offline"); });
    // live dots on the Activity page
    document.querySelectorAll("[data-online]").forEach(function (d) { var on = !!onlineNow()[d.dataset.online]; d.className = "dot " + (on ? "on" : "off"); d.title = on ? "Online now" : "Offline"; });
  }

  // ---------- listening time ----------
  // Each time someone plays a song, one row in `listens` counts the seconds it actually
  // played (paused and buffering time don't count). Saved every 20 s and on pause/leave.
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, function (c) { return (c ^ (Math.random() * 16) >> (c / 4)).toString(16); });
  }
  function fmtDur(s) {
    s = Math.round(s || 0);
    if (s < 60) return s + " s";
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? h + " h " + (m ? m + " m" : "") : m + " m" + (s % 60 && m < 10 ? " " + (s % 60) + " s" : "");
  }
  document.addEventListener("visibilitychange", function () {
    if (!active) return;
    if (document.hidden) { active.saveListen(); return; }
    // back in the app: wake the audio engine if the phone paused it, and redraw
    var m = active;
    if (m.playing && m.ctx && m.ctx.state !== "running") { try { m.ctx.resume().catch(function () {}); } catch (e) {} }
    if (m.playing) { m.sync(m.now()); m.loop(); }
    m.tick(true);
  });
  window.addEventListener("pagehide", function () { if (active) active.saveListen(); });

  // ---------- mixer engine ----------
  // One <audio> element per track, all routed through Web Audio gain nodes so
  // mute, solo and volume work on phones too. Elements stream, so long stems
  // don't have to fit in memory. A drift check keeps them locked together.
  //
  // There is only ever one live mixer per song. The song page's transport and the
  // floating player are two views of the same mixer, so they always show the same
  // song, position and play state. `mixer` is the one on the current song page;
  // `active` is the one holding playback (it keeps playing when you leave its page).
  var active = null;
  function Mixer(tracks, hasStems, song) {
    this.tracks = tracks.map(function (t) {
      return { meta: t, el: null, gain: null, vol: 1, mute: t.kind === "guide" && hasStems, solo: false, ready: false };
    });
    this.songId = song.id; this.title = song.title;
    this.sig = trackSig(tracks);
    this.ctx = null; this.playing = false; this.rate = 1; this.loopA = null; this.loopB = null;
    this.duration = 0; this.raf = 0; this.lastSync = 0; this.dead = false; this.seeking = false;
    this.attached = false; this.loadMsg = "Loading audio…";
    // repeat + "my part louder" (remembered per song in this browser)
    this.repeat = false; this.wavesVer = 0; this._wcache = {};
    var pref = partPrefs(song.id), ids = tracks.map(function (t) { return t.id; });
    this.focus = {}; (pref.ids || []).forEach(function (id) { if (ids.indexOf(id) > -1) this.focus[id] = true; }, this);
    this.focusOn = !!pref.on && Object.keys(this.focus).length > 0;
    this.partLevel = pref.part != null ? pref.part : 1; this.bandLevel = pref.band != null ? pref.band : 0.35;
  }
  var PART_KEY = "mt-mypart-v1";
  function partStore() { try { return JSON.parse(localStorage.getItem(PART_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function partPrefs(songId) {
    var st = partStore(), p = st[songId] || {};
    if (p.part == null && st._last) { p.part = st._last.part; p.band = st._last.band; }
    return p;
  }
  // page elements, only while this mixer is the one shown on the song page
  Mixer.prototype.$ = function (id) { return this.attached ? document.getElementById(id) : null; };
  Mixer.prototype.allReady = function () { return this.tracks.length > 0 && this.tracks.every(function (t) { return t.ready; }); };
  Mixer.prototype.start = async function () {
    var self = this;
    var r = await signedUrls(this.tracks.map(function (t) { return t.meta.path; }));
    if (this.dead) return;
    if (r.error) { this.setLoad("Couldn't load the audio: " + r.error.message); return; }
    var urls = r.data;
    this.tracks.forEach(function (t, i) {
      var el = new Audio();
      el.crossOrigin = "anonymous"; el.preload = "auto"; el.src = urls[t.meta.path];
      if ("preservesPitch" in el) el.preservesPitch = true;
      el.addEventListener("loadedmetadata", function () { self.duration = Math.max(self.duration, el.duration || 0); self.tick(true); });
      el.addEventListener("canplay", function () { if (!t.ready) { t.ready = true; self.updateLoad(); } });
      el.addEventListener("error", function () {
        if (self.dead) return;
        if (!t.retried && urlCache[t.meta.path]) { t.retried = true; delete urlCache[t.meta.path]; signedUrls([t.meta.path]).then(function (r2) { if (!self.dead && r2.data && r2.data[t.meta.path]) { el.src = r2.data[t.meta.path]; el.load(); } }); return; }
        self.setLoad("One track failed to load (" + t.meta.label + "). The rest will still play."); t.ready = true; t.broken = true; self.updateLoad();
      });
      el.addEventListener("ended", function () { if (self.tracks[self.master()] !== t || self.loopOn()) return; if (self.repeat && self.playing) self.play(); else self.pause(); });
      // one stem ran out of downloaded audio: hold everything until it catches up
      el.addEventListener("waiting", function () {
        if (!self.playing || t.broken || el.ended || Date.now() - (t.lastSeek || 0) < 1500) return;
        setTimeout(function () { if (self.playing && !self.stalled && el.readyState < 3 && !el.paused) self.stall(); }, 250);
      });
      t.el = el; el.load();
    });
    this.applyGains();
    loadPeaks(this);
  };
  // Connect this mixer to the song page that was just drawn (first open, or coming
  // back to a song that is still playing in the floating player).
  Mixer.prototype.attach = function () {
    var self = this;
    this.attached = true;
    this.bind();
    this.tracks.forEach(function (t, i) { var r = document.querySelector('[data-vol="' + i + '"]'); if (r) r.value = t.vol; });
    document.querySelectorAll("#speed [data-rate]").forEach(function (x) { x.setAttribute("aria-pressed", String(parseFloat(x.dataset.rate) === self.rate)); });
    var p = this.$("play"); if (p) p.disabled = !this.allReady();
    this.setLoad(this.loadMsg); this.applyGains(); this.setIcon(); this.partUI(); this.repeatUI(); this.waveNote(); this.tick(true);
    transportVisible = true;
    if (this.io) this.io.disconnect();
    var tr = document.querySelector(".transport");
    if (tr && "IntersectionObserver" in window) {
      this.io = new IntersectionObserver(function (es) { if (!self.attached) return; transportVisible = es[es.length - 1].isIntersecting; floatUpdate(); });
      this.io.observe(tr);
    }
    floatUpdate();
  };
  Mixer.prototype.detach = function () {
    this.attached = false; this.seeking = false;
    if (this.io) { this.io.disconnect(); this.io = null; }
  };
  Mixer.prototype.master = function () {
    var best = 0, d = -1;
    this.tracks.forEach(function (t, i) { if (!t.broken && t.el && (t.el.duration || 0) > d) { d = t.el.duration || 0; best = i; } });
    return best;
  };
  Mixer.prototype.setLoad = function (msg) { this.loadMsg = msg; var lb = this.$("loadbar"); if (lb) { lb.textContent = msg; lb.hidden = !msg; } };
  Mixer.prototype.updateLoad = function () {
    var n = this.tracks.filter(function (t) { return t.ready; }).length;
    var p = this.$("play");
    if (n === this.tracks.length) {
      this.setLoad(""); if (p) p.disabled = false;
      if (this.autoplay && !this.playing) { this.autoplay = false; this.play(true); }
    }
    else if (this.autoplay) this.setLoad("Loading audio… " + n + " of " + this.tracks.length + " tracks ready · starts playing when loaded");
    else this.setLoad("Loading audio… " + n + " of " + this.tracks.length + " tracks ready");
    floatUpdate();
  };
  Mixer.prototype.ensureGraph = function () {
    if (this.ctx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    var ctx = this.ctx;
    this.tracks.forEach(function (t) {
      try { var src = ctx.createMediaElementSource(t.el); t.gain = ctx.createGain(); src.connect(t.gain).connect(ctx.destination); } catch (e) { t.gain = null; }
    });
    this.applyGains();
  };
  // what each track plays at: its own fader, times the "my part" balance when that's on
  Mixer.prototype.level = function (t, anySolo) {
    if (anySolo ? !t.solo : t.mute) return 0;
    if (this.focusOn && !anySolo) return t.vol * (this.focus[t.meta.id] ? this.partLevel : this.bandLevel);
    return t.vol;
  };
  Mixer.prototype.applyGains = function () {
    var self = this, anySolo = this.tracks.some(function (t) { return t.solo; });
    var ctx = this.ctx, attached = this.attached;
    this.tracks.forEach(function (t, i) {
      var audible = anySolo ? t.solo : !t.mute;
      var g = self.level(t, anySolo);
      if (t.gain && ctx) t.gain.gain.setTargetAtTime(g, ctx.currentTime, 0.015);
      else if (t.el) { t.el.muted = g === 0; t.el.volume = Math.min(1, g); }
      var row = attached && document.querySelector('.trk[data-i="' + i + '"]');
      if (row) {
        row.classList.toggle("silent", !audible);
        row.classList.toggle("is-part", !!self.focus[t.meta.id]);
        row.querySelector("[data-mute]").setAttribute("aria-pressed", String(t.mute));
        row.querySelector("[data-solo]").setAttribute("aria-pressed", String(t.solo));
        var pb = row.querySelector("[data-part]"); if (pb) pb.setAttribute("aria-pressed", String(!!self.focus[t.meta.id]));
      }
    });
    this.drawWaves();
  };
  Mixer.prototype.savePart = function () {
    var st = partStore();
    st[this.songId] = { ids: Object.keys(this.focus), on: this.focusOn, part: this.partLevel, band: this.bandLevel };
    st._last = { part: this.partLevel, band: this.bandLevel };
    try { localStorage.setItem(PART_KEY, JSON.stringify(st)); } catch (e) {}
  };
  Mixer.prototype.partNames = function () { var self = this; return this.tracks.filter(function (t) { return self.focus[t.meta.id]; }).map(function (t) { return t.meta.label; }); };
  Mixer.prototype.toggleFocus = function () {
    if (!this.partNames().length) { this.focusOn = false; this.partUI(true); return false; }
    this.focusOn = !this.focusOn; this.applyGains(); this.partUI(); this.savePart();
    return true;
  };
  Mixer.prototype.partUI = function (nudge) {
    var names = this.partNames();
    var on = this.$("part-on"); if (on) on.setAttribute("aria-pressed", String(this.focusOn));
    var pl = this.$("part-lvl"), bl = this.$("band-lvl");
    if (pl) { pl.value = this.partLevel; pl.disabled = !this.focusOn; }
    if (bl) { bl.value = this.bandLevel; bl.disabled = !this.focusOn; }
    var h = this.$("part-hint");
    if (h) {
      h.textContent = names.length ? "My part: " + names.join(", ") : "Tap ★ next to your track below to mark your part.";
      if (nudge) { h.classList.remove("flash"); void h.offsetWidth; h.classList.add("flash"); }
    }
    var fp = document.getElementById("mt-float-part");
    if (fp && this === floatTarget()) { fp.setAttribute("aria-pressed", String(this.focusOn)); fp.title = names.length ? (this.focusOn ? "My part louder: on" : "Make my part louder") : "Mark your part with ★ on the song page"; }
  };
  // ---- repeat ----
  Mixer.prototype.repeatUI = function () {
    var b = this.$("loop-rep"); if (b) b.setAttribute("aria-pressed", String(this.repeat));
    var fr = document.getElementById("mt-float-rep");
    if (fr && this === floatTarget()) { fr.setAttribute("aria-pressed", String(this.repeat)); fr.title = this.repeat ? (this.loopOn() ? "Repeating your section" : "Repeating the song") : "Repeat"; }
    this.tick(true);
  };
  Mixer.prototype.setRegion = function (a, b) {
    this.loopA = a; this.loopB = b; this.repeat = true;
    this.seek(a); this.repeatUI();
  };
  // ---- waveform ----
  // Loudness per column across the tracks you can hear (so muting a stem changes the shape),
  // with your part drawn on top in gold.
  Mixer.prototype.waveCols = function (n) {
    var self = this, anySolo = this.tracks.some(function (t) { return t.solo; });
    var key = n + "|" + this.wavesVer + "|" + Math.round(this.duration) + "|" + this.tracks.map(function (t) { return self.level(t, anySolo).toFixed(2) + (self.focus[t.meta.id] ? "p" : ""); }).join(",");
    if (key in this._wcache) return this._wcache[key];
    var have = this.tracks.filter(function (t) { return peaksCache[t.meta.id]; }), cols = null;
    if (have.length && this.duration) {
      var band = new Float32Array(n), part = have.some(function (t) { return self.focus[t.meta.id]; }) ? new Float32Array(n) : null, c;
      have.forEach(function (t) {
        var pk = peaksCache[t.meta.id], d = pk.dur || (t.el && t.el.duration) || self.duration, g = self.level(t, anySolo), isPart = self.focus[t.meta.id];
        if (!g) return;
        for (c = 0; c < n; c++) {
          var f = (c + 0.5) / n * self.duration / d; if (f >= 1) continue;
          var a = pk.q[Math.floor(f * pk.q.length)] * g;
          band[c] += a * a; if (isPart) part[c] += a * a;
        }
      });
      var max = 0.02;
      for (c = 0; c < n; c++) { band[c] = Math.sqrt(band[c]); if (band[c] > max) max = band[c]; if (part) part[c] = Math.sqrt(part[c]); }
      for (c = 0; c < n; c++) { band[c] = Math.sqrt(band[c] / max); if (part) part[c] = Math.sqrt(part[c] / max); }
      cols = { band: band, part: part };
    }
    var ks = Object.keys(this._wcache); if (ks.length > 6) this._wcache = {};
    this._wcache[key] = cols;
    return cols;
  };
  Mixer.prototype.drawWaves = function () {
    if (!window.MTWave) return;
    var cans = [], self = this, dur = this.duration || 0, now = this.now();
    var mc = this.$("wave"); if (mc) cans.push(mc);
    var fp = document.getElementById("mt-float-player"), fc = document.getElementById("mt-fwave");
    if (fc && fp && !fp.hidden && this === floatTarget()) cans.push(fc);
    cans.forEach(function (cv) {
      var n = Math.max(40, Math.min(300, Math.round(cv.clientWidth / 4)));
      MTWave.draw(cv, { cols: self.waveCols(n), progress: dur ? Math.min(1, now / dur) : 0,
        loopA: self.loopA != null && dur ? self.loopA / dur : null, loopB: self.loopB != null && dur ? self.loopB / dur : null });
      cv.setAttribute("aria-valuemax", String(Math.round(dur))); cv.setAttribute("aria-valuenow", String(Math.round(now))); cv.setAttribute("aria-valuetext", fmt(now) + " of " + fmt(dur));
    });
  };
  Mixer.prototype.waveNote = function () {
    var el = this.$("wave-note"); if (!el) return;
    var n = this.tracks.length, have = 0, busy = 0;
    this.tracks.forEach(function (t) { if (peaksCache[t.meta.id]) have++; if (peaksBuilding[t.meta.id]) busy++; });
    el.textContent = busy ? "Drawing the waveform… " + have + " of " + n + " tracks done" :
      !have ? (isAdmin() ? "No waveform yet. Draw them all from Bulk upload (on a computer)." : "The waveform for this song is on its way.") :
      (have < n ? "Waveform covers " + have + " of " + n + " tracks. " : "") + "Tap to jump. Drag across a section to repeat it.";
  };
  Mixer.prototype.now = function () { var m = this.tracks[this.master()]; return m && m.el ? m.el.currentTime : 0; };
  Mixer.prototype.loopOn = function () { return this.repeat && this.loopA != null && this.loopB != null && this.loopB > this.loopA; };
  Mixer.prototype.play = async function (auto) {
    if (this.dead) return;
    var pb = this.$("play"); if (pb) pb.classList.remove("nudge");
    // Only one song plays at a time: starting this one stops the one that was playing.
    if (active && active !== this) { var old = active; active = null; old.destroy(); }
    active = this; floatDismissed = false;
    // iPhone/iPad: a "playback" audio session keeps the mix going with the screen locked or
    // in another app (iOS 17.5+), in Safari and in the home-screen app.
    try { if (navigator.audioSession && navigator.audioSession.type !== "playback") navigator.audioSession.type = "playback"; } catch (e) {}
    this.ensureGraph();
    if (this.ctx && this.ctx.state === "suspended") { try { await this.ctx.resume(); } catch (e) {} }
    if (auto && this.ctx && this.ctx.state !== "running") return this.blocked();
    var t0 = this.now();
    if (this.duration && t0 >= this.duration - 0.2) t0 = this.loopOn() ? this.loopA : 0;
    var self = this;
    this.stalled = false; clearInterval(this.stallTimer);
    this.tracks.forEach(function (t) { if (!t.broken) { t.el.playbackRate = self.rate; t.el.currentTime = t0; t.lastSeek = Date.now(); } });
    this.playing = true; this.setIcon();
    var res = await Promise.all(this.tracks.map(function (t) { return t.broken ? true : t.el.play().then(function () { return true; }, function (e) { return !(e && e.name === "NotAllowedError"); }); }));
    if (this.dead) return;
    if (res.indexOf(false) > -1) return this.blocked();
    if (!this.playLogged) { this.playLogged = true; if (this.onFirstPlay) this.onFirstPlay(); }
    this.startListen();
    mediaSession(this);
    this.loop();
    this.bgLoop();
  };
  // requestAnimationFrame stops while the page is in the background, so a slower timer keeps
  // section repeat and stem sync going when you're in another app or the screen is locked.
  Mixer.prototype.bgLoop = function () {
    var self = this;
    clearInterval(this.bgTimer);
    this.bgTimer = setInterval(function () {
      if (!self.playing || self.dead) { clearInterval(self.bgTimer); return; }
      if (!document.hidden) return;
      var now = self.now();
      if (self.loopOn() && now >= self.loopB - 0.15) self.seek(self.loopA);
      else if (!self.stalled) self.sync(now);
      posState(self);
    }, 200);
  };
  Mixer.prototype.startListen = function () {
    var self = this;
    if (!this.listen) this.listen = { id: uuid(), secs: 0, saved: 0, created: false };
    if (this.listenTimer) return;
    var last = Date.now();
    this.listenTimer = setInterval(function () {
      var now = Date.now(), dt = Math.min((now - last) / 1000, 2); last = now;
      if (self.dead) return;
      if (self.playing && !self.stalled) self.listen.secs += dt;
      if (self.listen.secs - self.listen.saved >= 20) self.saveListen();
    }, 1000);
  };
  Mixer.prototype.saveListen = function () {
    var L = this.listen; if (!L || !S.member) return;
    var secs = Math.min(Math.round(L.secs), 43200);
    if (secs < 3 || secs === L.saved) return;
    L.saved = secs;
    if (!L.created) {
      L.created = true;
      sb.from("listens").insert({ id: L.id, song_id: this.songId, seconds: secs }).then(function (r) { if (r && r.error) { L.created = false; L.saved = 0; } }, function () { L.created = false; L.saved = 0; });
    } else sb.from("listens").update({ seconds: secs, updated_at: new Date().toISOString() }).eq("id", L.id).then(function () {}, function () {});
  };
  Mixer.prototype.toggle = function () { if (this.playing) this.pause(); else this.play(); };
  // The browser refused to start sound without a direct tap (mostly Safari). Ask for one tap.
  Mixer.prototype.blocked = function () {
    this.tracks.forEach(function (t) { if (t.el) t.el.pause(); });
    this.playing = false; this.setIcon();
    this.setLoad("Tap play to start. Your browser needs one tap before it will play sound.");
    var p = this.$("play"); if (p) { p.classList.add("nudge"); p.focus(); }
  };
  Mixer.prototype.pause = function () {
    this.playing = false; this.stalled = false; clearInterval(this.stallTimer); clearInterval(this.bgTimer); this.setIcon();
    this.saveListen();
    this.tracks.forEach(function (t) { if (t.el) t.el.pause(); });
    cancelAnimationFrame(this.raf); this.tick(true);
  };
  Mixer.prototype.seek = function (time) {
    time = Math.max(0, Math.min(time, this.duration || 0));
    this.tracks.forEach(function (t) { if (t.el && !t.broken) { t.el.currentTime = time; t.lastSeek = Date.now(); } });
    this.tick(true);
  };
  Mixer.prototype.setIcon = function () {
    var p = this.$("play");
    if (p) { p.innerHTML = this.playing ? ICON_PAUSE : ICON_PLAY; p.setAttribute("aria-label", this.playing ? "Pause" : "Play"); }
    if (this === active && "mediaSession" in navigator) { try { navigator.mediaSession.playbackState = this.playing ? "playing" : "paused"; } catch (e) {} posState(this); }
    floatUpdate();
  };
  Mixer.prototype.loop = function () {
    var self = this;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(function step(ts) {
      if (!self.playing || self.dead) return;
      var now = self.now();
      if (self.loopOn() && now >= self.loopB) { self.seek(self.loopA); }
      else if (!self.stalled && ts - self.lastSync > 250) { self.lastSync = ts; self.sync(now); }
      self.tick(false);
      self.raf = requestAnimationFrame(step);
    });
  };
  // Keep stems locked to the master without audible jumps: small drift is pulled in by
  // playing that stem 1.5% faster or slower for a moment; only a big gap (e.g. after the
  // tab was in the background) gets a real seek, and never more than once every 3 s.
  Mixer.prototype.sync = function (now) {
    var mi = this.master(), rate = this.rate, clock = Date.now();
    this.tracks.forEach(function (t, i) {
      if (i === mi || t.broken || !t.el || t.el.ended) return;
      if (now > (t.el.duration || 0)) return;
      var diff = t.el.currentTime - now, ad = Math.abs(diff);
      if (ad > 0.35 && t.el.readyState >= 3 && clock - (t.lastSeek || 0) > 3000) { t.el.currentTime = now; t.lastSeek = clock; t.el.playbackRate = rate; }
      else if (ad > 0.025) t.el.playbackRate = rate * (diff > 0 ? 0.985 : 1.015);
      else if (t.el.playbackRate !== rate) t.el.playbackRate = rate;
      if (t.el.paused) t.el.play().catch(function () {});
    });
  };
  Mixer.prototype.stall = function () {
    if (this.stalled) return;
    var self = this;
    this.stalled = true;
    this.tracks.forEach(function (t) { if (t.el && !t.broken) t.el.pause(); });
    this.setLoad("Buffering…");
    clearInterval(this.stallTimer);
    this.stallTimer = setInterval(function () {
      if (!self.playing || self.dead) { clearInterval(self.stallTimer); self.stalled = false; return; }
      var ready = self.tracks.every(function (t) { return t.broken || t.el.ended || t.el.readyState >= 3; });
      if (!ready) return;
      clearInterval(self.stallTimer);
      var t0 = self.now();
      self.tracks.forEach(function (t) {
        if (t.broken || t.el.ended) return;
        if (Math.abs(t.el.currentTime - t0) > 0.05) { t.el.currentTime = t0; t.lastSeek = Date.now(); }
        t.el.playbackRate = self.rate; t.el.play().catch(function () {});
      });
      self.stalled = false; self.setLoad("");
    }, 200);
  };
  Mixer.prototype.tick = function (force) {
    var now = this.now();
    var c = this.$("clock"), sc = this.$("scrub");
    if (c && !this.seeking) c.textContent = fmt(now) + " / " + fmt(this.duration);
    if (sc && !this.seeking && this.duration) sc.value = Math.round(now / this.duration * 1000);
    var li = this.$("loopinfo");
    if (li) li.textContent = this.loopA != null ? ((this.loopOn() ? "Repeating " : "") + fmt(this.loopA) + (this.loopB != null ? " → " + fmt(this.loopB) : " → set B")) : (this.repeat ? "Repeating the whole song" : "");
    if (this === floatTarget()) floatTime(this);
    this.drawWaves();
  };
  Mixer.prototype.bind = function () {
    var self = this;
    document.getElementById("play").onclick = function () { self.toggle(); };
    var sc = document.getElementById("scrub");
    sc.addEventListener("input", function () { self.seeking = true; var c = self.$("clock"); if (c) c.textContent = fmt(sc.value / 1000 * self.duration) + " / " + fmt(self.duration); });
    sc.addEventListener("change", function () { self.seeking = false; self.seek(sc.value / 1000 * self.duration); });
    document.querySelectorAll("#speed [data-rate]").forEach(function (b) {
      b.onclick = function () {
        self.rate = parseFloat(b.dataset.rate);
        document.querySelectorAll("#speed [data-rate]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        self.tracks.forEach(function (t) { if (t.el) t.el.playbackRate = self.rate; });
      };
    });
    document.getElementById("loop-a").onclick = function () { self.loopA = self.now(); if (self.loopB != null && self.loopB <= self.loopA) self.loopB = null; self.tick(true); };
    document.getElementById("loop-b").onclick = function () { var n = self.now(); if (self.loopA == null || n <= self.loopA) return; self.setRegion(self.loopA, n); };
    document.getElementById("loop-clear").onclick = function () { self.loopA = self.loopB = null; self.repeat = false; self.repeatUI(); };
    document.getElementById("loop-rep").onclick = function () { self.repeat = !self.repeat; self.repeatUI(); };
    document.getElementById("part-on").onclick = function () { self.toggleFocus(); };
    document.getElementById("part-lvl").oninput = function () { self.partLevel = parseFloat(this.value); self.applyGains(); self.savePart(); };
    document.getElementById("band-lvl").oninput = function () { self.bandLevel = parseFloat(this.value); self.applyGains(); self.savePart(); };
    document.querySelectorAll("[data-part]").forEach(function (b) {
      b.onclick = function () {
        var id = self.tracks[+b.dataset.part].meta.id;
        if (self.focus[id]) delete self.focus[id]; else { self.focus[id] = true; self.focusOn = true; }
        if (!self.partNames().length) self.focusOn = false;
        self.applyGains(); self.partUI(); self.savePart();
      };
    });
    bindWave(document.getElementById("wave"), function () { return self; });
    document.querySelectorAll("[data-mute]").forEach(function (b) { b.onclick = function () { var t = self.tracks[+b.dataset.mute]; t.mute = !t.mute; self.applyGains(); }; });
    document.querySelectorAll("[data-solo]").forEach(function (b) { b.onclick = function () { var t = self.tracks[+b.dataset.solo]; t.solo = !t.solo; self.applyGains(); }; });
    document.querySelectorAll("[data-vol]").forEach(function (r) { r.oninput = function () { self.tracks[+r.dataset.vol].vol = parseFloat(r.value); self.applyGains(); }; });
  };
  Mixer.prototype.destroy = function () {
    this.saveListen(); clearInterval(this.listenTimer);
    this.dead = true; this.playing = false; clearInterval(this.stallTimer); clearInterval(this.bgTimer); cancelAnimationFrame(this.raf);
    this.detach();
    if (active === this) active = null;
    this.tracks.forEach(function (t) { if (t.el) { t.el.pause(); t.el.removeAttribute("src"); t.el.load(); } });
    if (this.ctx) { try { this.ctx.close().catch(function () {}); } catch (e) {} }
    floatUpdate();
  };

  // ---------- floating player ----------
  // Shows the mixer that is playing (or the page's mixer while you're scrolled past its
  // controls or reading a sheet). Every button acts on that same mixer.
  var transportVisible = true, floatDismissed = false;
  function floatTarget() {
    if (active && !active.dead) return active;
    return mixer && !mixer.dead ? mixer : null;
  }
  function floatEl() {
    var p = document.getElementById("mt-float-player");
    if (p) return p;
    p = document.createElement("section");
    p.id = "mt-float-player"; p.hidden = true; p.setAttribute("aria-label", "Now playing");
    p.innerHTML = '<div class="mt-float-main"><button class="mt-float-play" aria-label="Play">' + ICON_PLAY + '</button>' +
      '<div class="mt-float-info"><strong id="mt-float-title">Practice mixer</strong><span id="mt-float-clock">0:00 / 0:00</span></div>' +
      '<div class="mt-float-wave"><canvas id="mt-fwave" role="slider" tabindex="0" aria-valuemin="0" aria-label="Song waveform. Tap to jump, drag across a section to repeat it."></canvas></div>' +
      '<a id="mt-float-back" href="#/">Open mixer</a>' +
      '<span class="mt-float-tools"><button id="mt-float-part" type="button" aria-pressed="false" aria-label="My part louder">★</button><button id="mt-float-rep" type="button" aria-pressed="false" aria-label="Repeat">⟲</button></span>' +
      '<button id="mt-float-close" aria-label="Stop and close player">×</button></div>';
    document.body.appendChild(p);
    p.querySelector(".mt-float-play").onclick = function () {
      var m = floatTarget(); if (!m) return;
      if (!m.playing && !m.allReady()) { p.querySelector("#mt-float-clock").textContent = "Still loading the audio…"; return; }
      m.toggle();
    };
    p.querySelector("#mt-float-close").onclick = function () {
      var m = floatTarget(); if (!m) return;
      m.pause();
      if (m.attached) { floatDismissed = true; floatUpdate(); } else m.destroy();
    };
    p.querySelector("#mt-float-rep").onclick = function () { var m = floatTarget(); if (!m) return; m.repeat = !m.repeat; m.repeatUI(); };
    p.querySelector("#mt-float-part").onclick = function () {
      var m = floatTarget(); if (!m) return;
      if (!m.toggleFocus()) { var c = p.querySelector("#mt-float-clock"); c.textContent = "Tap ★ next to your track on the song page first"; setTimeout(function () { if (floatTarget()) floatTime(floatTarget()); }, 3000); }
    };
    bindWave(p.querySelector("#mt-fwave"), floatTarget);
    return p;
  }
  function floatTime(m) {
    var p = document.getElementById("mt-float-player"); if (!p || p.hidden) return;
    var now = m.now();
    if (!m.seeking) p.querySelector("#mt-float-clock").textContent = fmt(now) + " / " + fmt(m.duration);
  }
  function floatUpdate() {
    trackPresence();
    var m = floatTarget();
    var show = !!m && !floatDismissed && (!m.attached || !transportVisible || !!viewer);
    if (!show && !document.getElementById("mt-float-player")) { document.documentElement.classList.remove("float-on"); return; }
    var p = floatEl();
    p.hidden = !show;
    document.documentElement.classList.toggle("float-on", show);
    if (!show) return;
    p.querySelector("#mt-float-title").textContent = m.title;
    var back = p.querySelector("#mt-float-back");
    back.href = "#/song/" + encodeURIComponent(m.songId); back.hidden = m.attached;
    var b = p.querySelector(".mt-float-play");
    b.innerHTML = m.playing ? ICON_PAUSE : ICON_PLAY; b.setAttribute("aria-label", m.playing ? "Pause" : "Play");
    floatTime(m);
    m.partUI(); p.querySelector("#mt-float-rep").setAttribute("aria-pressed", String(m.repeat));
    m.drawWaves();
  }
  // Waveform as a scrubber: tap to jump, drag across to pick a section to repeat,
  // arrow keys move 5 s (15 s with Shift).
  function bindWave(cv, getM) {
    if (!cv) return;
    var down = null;
    function at(e) { var r = cv.getBoundingClientRect(), m = getM(); return m && m.duration ? Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * m.duration : 0; }
    cv.addEventListener("pointerdown", function (e) {
      var m = getM(); if (!m || !m.duration) return;
      down = { x: e.clientX, t: at(e), sel: false, a: m.loopA, b: m.loopB };
      try { cv.setPointerCapture(e.pointerId); } catch (x) {}
    });
    cv.addEventListener("pointermove", function (e) {
      var m = getM(); if (!down || !m) return;
      if (!down.sel && Math.abs(e.clientX - down.x) > 8) down.sel = true;
      if (down.sel) { var b = at(e); m.loopA = Math.min(down.t, b); m.loopB = Math.max(down.t, b); m.drawWaves(); }
    });
    cv.addEventListener("pointerup", function (e) {
      var m = getM(), d = down; down = null; if (!d || !m) return;
      if (d.sel && m.loopB - m.loopA >= 1) m.setRegion(m.loopA, m.loopB);
      else {
        if (d.sel) { m.loopA = d.a; m.loopB = d.b; }
        var t = at(e);
        // tapping outside the section you're repeating lets go of it
        if (m.loopOn() && (t < m.loopA || t > m.loopB)) { m.loopA = m.loopB = null; m.repeat = false; m.repeatUI(); }
        m.seek(t);
      }
    });
    cv.addEventListener("pointercancel", function () { var m = getM(); if (down && m && down.sel) { m.loopA = down.a; m.loopB = down.b; m.drawWaves(); } down = null; });
    cv.addEventListener("keydown", function (e) {
      var m = getM(); if (!m) return;
      var step = e.shiftKey ? 15 : 5;
      if (e.key === "ArrowRight") m.seek(m.now() + step);
      else if (e.key === "ArrowLeft") m.seek(m.now() - step);
      else if (e.key === "Home") m.seek(0);
      else if (e.key === " " || e.key === "Enter") m.toggle();
      else return;
      e.preventDefault();
    });
  }
  var waveResize = 0;
  window.addEventListener("resize", function () { clearTimeout(waveResize); waveResize = setTimeout(function () { [active, mixer].forEach(function (m) { if (m && !m.dead) m.drawWaves(); }); }, 120); });

  // ---------- waveform data ----------
  // Each track's shape (300 loudness points) is measured once and saved for everyone.
  // Admins' computers measure missing ones in the background; new uploads are measured
  // from the file on your computer as they go up.
  var peaksCache = {}, peaksBuilding = {}, peakQueue = Promise.resolve();
  function finePointer() { return !window.matchMedia || window.matchMedia("(pointer:fine)").matches; }
  function peaksChanged() { [active, mixer].forEach(function (m) { if (m && !m.dead) { m.wavesVer++; m.waveNote(); m.tick(true); } }); }
  async function loadPeaks(m) {
    if (!window.MTWave) return;
    var ids = m.tracks.map(function (t) { return t.meta.id; }).filter(function (id) { return !(id in peaksCache); });
    if (ids.length) {
      var r = await sb.from("track_peaks").select("track_id,peaks,duration").in("track_id", ids);
      (r.data || []).forEach(function (p) { try { peaksCache[p.track_id] = { q: MTWave.decodePeaks(p.peaks), dur: p.duration }; } catch (e) {} });
      if (!r.error) ids.forEach(function (id) { if (!(id in peaksCache)) peaksCache[id] = null; });
    }
    if (m.dead) return;
    m.wavesVer++; m.waveNote(); m.tick(true);
    var missing = m.tracks.map(function (t) { return t.meta; }).filter(function (t) { return !peaksCache[t.id]; });
    if (missing.length && isAdmin() && finePointer()) buildPeaks(missing);
  }
  async function savePeaks(t, res) {
    var txt = MTWave.encode(res.peaks);
    var r = await sb.from("track_peaks").upsert({ track_id: t.id, peaks: txt, duration: res.duration, method: res.method });
    if (r.error) throw r.error;
    peaksCache[t.id] = { q: MTWave.decodePeaks(txt), dur: res.duration };
  }
  function buildPeaks(list, onEach) {
    if (!window.MTWave) return Promise.resolve({ ok: 0, fail: list.length });
    list = list.filter(function (t) { return t.kind !== "chart" && !peaksCache[t.id] && !peaksBuilding[t.id]; });
    list.forEach(function (t) { peaksBuilding[t.id] = true; });
    peaksChanged();
    var job = peakQueue.then(async function () {
      var ok = 0, fail = 0;
      for (var i = 0; i < list.length; i++) {
        var t = list[i];
        try {
          var u = await signedUrls([t.path]);
          if (u.error || !u.data[t.path]) throw new Error("No link for this file");
          await savePeaks(t, await MTWave.sample(MTWave.urlReader(u.data[t.path], t.size_bytes, t.path)));
          ok++;
        } catch (e) { fail++; if (window.console) console.warn("Waveform failed for " + t.label, e); }
        delete peaksBuilding[t.id];
        if (onEach) onEach(ok, fail, list.length);
        peaksChanged();
      }
      return { ok: ok, fail: fail };
    });
    peakQueue = job.catch(function () {});
    return job;
  }
  function peaksFromFile(track, file) {
    if (!window.MTWave || track.kind === "chart") return;
    peaksBuilding[track.id] = true;
    peakQueue = peakQueue.then(function () { return MTWave.sample(MTWave.fileReader(file)).then(function (res) { return savePeaks(track, res); }); })
      .catch(function () {}).then(function () { delete peaksBuilding[track.id]; peaksChanged(); });
  }
  // lock-screen position bar
  function posState(m) {
    if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState || !m.duration) return;
    try { navigator.mediaSession.setPositionState({ duration: m.duration, playbackRate: m.rate, position: Math.min(m.duration, Math.max(0, m.now())) }); } catch (e) {}
  }
  function mediaSession(m) {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: m.title, artist: "Messiah Tour Canada", album: "Band Portal", artwork: CFG.posterUrl ? [{ src: CFG.posterUrl, sizes: "512x512", type: "image/jpeg" }] : [] });
      var go = function (f) { return function (d) { var t = floatTarget(); if (t) f(t, d || {}); }; };
      navigator.mediaSession.setActionHandler("play", go(function (t) { t.play(); }));
      navigator.mediaSession.setActionHandler("pause", go(function (t) { t.pause(); }));
      navigator.mediaSession.setActionHandler("seekbackward", go(function (t, d) { t.seek(t.now() - (d.seekOffset || 10)); posState(t); }));
      navigator.mediaSession.setActionHandler("seekforward", go(function (t, d) { t.seek(t.now() + (d.seekOffset || 10)); posState(t); }));
      navigator.mediaSession.setActionHandler("seekto", go(function (t, d) { if (d.seekTime != null) t.seek(d.seekTime); posState(t); }));
      posState(m);
    } catch (e) {}
  }

  // ---------- admin: song editing & uploads ----------
  function adminSongPanel(s, files) {
    return '<div class="block"><div class="card admin">' +
      '<span class="admin-tag">Admin · only you see this</span>' +
      '<div class="form"><div class="two">' +
      '<label class="f" for="a-key">Key<input id="a-key" value="' + esc(s.key || "") + '" placeholder="e.g. Bb"></label>' +
      '<label class="f" for="a-bpm">BPM<input id="a-bpm" type="number" inputmode="numeric" value="' + esc(s.bpm || "") + '"></label>' +
      '<label class="f" for="a-set">Setlist section<select id="a-set"><option value="">Not on the setlist</option>' + S.sets.map(function (x) { return '<option value="' + x.no + '"' + (s.set_no === x.no ? " selected" : "") + '>' + esc(x.title) + '</option>'; }).join("") + '</select></label>' +
      '<label class="f" for="a-pos">Position in set<input id="a-pos" type="number" min="1" inputmode="numeric" value="' + esc(s.set_pos || "") + '"></label>' +
      '<label class="f" for="a-credit">Original artist (covers)<input id="a-credit" value="' + esc(s.credit || "") + '" placeholder="e.g. Victoria Orenze"></label></div>' +
      '<label class="f" for="a-bv">BV parts &amp; cues<textarea id="a-bv" style="min-height:220px">' + esc(s.bv_notes || "") + '</textarea></label>' +
      '<p class="muted" style="margin:0;font-size:13px">In the cues, colour a part by wrapping it: {{u|words}} for unison, {{h|words}} for harmony, {{i|words}} for inversion.</p>' +
      '<label class="f" for="a-lyrics">Lyrics<textarea id="a-lyrics" style="min-height:220px">' + esc(s.lyrics || "") + '</textarea></label>' +
      '<div class="tp-row"><button class="btn primary" id="a-save">Save song details</button><span id="a-save-msg" class="muted"></span></div></div>' +
      '<hr style="border:0;border-top:1px solid var(--line);width:100%">' +
      '<div class="form"><h3 style="margin:0">Upload files</h3>' +
      '<div class="two"><label class="f" for="a-kind">What are you uploading?<select id="a-kind"><option value="stem">Stems (pick several at once)</option><option value="guide">Guide / full mix</option><option value="chart">Chord chart (PDF or image)</option></select></label>' +
      '<label class="f" for="a-files">Files<input id="a-files" type="file" multiple accept="audio/*,.pdf,image/png,image/jpeg"></label></div>' +
      '<p class="muted" style="margin:0;font-size:13px">Files up to 1 GB. Big WAVs upload in resumable chunks, so keep this tab open until they finish.</p>' +
      '<div class="tp-row"><button class="btn primary" id="a-upload">Upload</button></div><ul class="uplist" id="a-uplog" style="list-style:none;padding:0;margin:0"></ul></div>' +
      (files.length ? '<hr style="border:0;border-top:1px solid var(--line);width:100%"><div class="form"><h3 style="margin:0">Files on this song</h3><div class="tablewrap"><table class="band files-order"><thead><tr><th><span class="sr">Order</span></th><th>Name</th><th>Type</th><th>Size</th><th></th></tr></thead><tbody id="a-files-order">' +
        files.map(function (t) { var audio = t.kind !== "chart"; return '<tr' + (audio ? ' data-id="' + esc(t.id) + '"' : '') + '><td>' + (audio ? '<button type="button" class="grip" data-grip aria-label="Move ' + esc(t.label) + ' in the band order (drag, or use the arrow keys)">⋮⋮</button>' : '') + '</td><td><input class="f-rename" data-id="' + esc(t.id) + '" value="' + esc(t.label) + '" aria-label="Track name" style="width:100%;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--surface)"></td><td>' + t.kind + '</td><td class="meta">' + (t.size_bytes ? mb(t.size_bytes) : "") + '</td><td><button class="btn danger" data-del="' + esc(t.id) + '">Delete</button></td></tr>'; }).join("") +
        '</tbody></table></div><p class="muted" style="margin:0;font-size:13px">Drag ⋮⋮ to set the track order everyone sees in the mixer (people who arranged their own order keep theirs). Rename a track by editing its name; it saves when you leave the box. <span id="a-order-msg" style="color:var(--ok);font-weight:700"></span></p></div>' : '') +
      '</div></div>';
  }
  function bindAdminSong(s) {
    $("#a-save").onclick = async function () {
      var b = $("#a-save"); b.disabled = true;
      var bpm = parseInt($("#a-bpm").value, 10);
      var pos = parseInt($("#a-pos").value, 10), setNo = parseInt($("#a-set").value, 10);
      var patch = { set_no: isFinite(setNo) ? setNo : null, set_pos: isFinite(pos) ? pos : (s.set_pos || null), credit: $("#a-credit").value.trim() || null,
        key: $("#a-key").value.trim() || null, bpm: isFinite(bpm) ? bpm : null, bv_notes: $("#a-bv").value.trim() || null, lyrics: $("#a-lyrics").value.replace(/\s+$/, "") || null };
      var r = await sb.from("songs").update(patch).eq("id", s.id).select().single();
      b.disabled = false;
      if (r.error) { $("#a-save-msg").textContent = "Couldn't save: " + r.error.message; return; }
      Object.assign(s, r.data);
      renderSong(s.id);
      var m = $("#a-save-msg"); if (m) m.textContent = "Saved.";
    };
    $("#a-upload").onclick = async function () {
      var files = Array.from($("#a-files").files || []), kind = $("#a-kind").value, log = $("#a-uplog");
      if (!files.length) { log.innerHTML = '<li class="msg err">Choose one or more files first.</li>'; return; }
      $("#a-upload").disabled = true; log.innerHTML = "";
      var base = kind === "chart" ? tracksFor(s.id, kind).length : nextSort(s.id), uploaded = 0;
      for (var i = 0; i < files.length; i++) {
        var f = files[i], li = document.createElement("li");
        li.innerHTML = "<span>" + esc(f.name) + "</span><span class='meta'>uploading…</span>"; log.appendChild(li);
        if (f.size > MAX_UPLOAD) { li.lastChild.textContent = "too big (" + mb(f.size) + ")"; continue; }
        var path = s.id + "/" + kind + "/" + Date.now() + "-" + safeFile(f.name);
        var status = li.lastChild;
        var up = await uploadFile(path, f, f.type || undefined, function (p) { status.textContent = "uploading " + Math.round(p * 100) + "%"; });
        if (up.error) { li.lastChild.textContent = "failed: " + up.error.message; continue; }
        var ins = await sb.from("tracks").insert({ song_id: s.id, kind: kind, label: prettyName(f.name), path: path, sort: base + i, size_bytes: f.size }).select().single();
        if (ins.error) { li.lastChild.textContent = "saved file but not listed: " + ins.error.message; continue; }
        S.tracks.push(ins.data); uploaded++;
        peaksFromFile(ins.data, f);
        li.lastChild.textContent = "done";
      }
      $("#a-upload").disabled = false;
      if (uploaded) setTimeout(function () { renderSong(s.id); }, 600);
    };
    app.querySelectorAll("[data-del]").forEach(function (b) {
      b.onclick = async function () {
        if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Tap again to delete"; return; }
        b.disabled = true;
        var t = S.tracks.find(function (x) { return x.id === b.dataset.del; });
        var rm = await sb.storage.from(BUCKET).remove([t.path]);
        if (rm.error) { alert("Couldn't delete: " + rm.error.message); b.disabled = false; return; }
        await sb.from("tracks").delete().eq("id", t.id);
        S.tracks = S.tracks.filter(function (x) { return x.id !== t.id; });
        renderSong(s.id);
      };
    });
    app.querySelectorAll(".f-rename").forEach(function (inp) {
      inp.onchange = async function () {
        var v = inp.value.trim(); if (!v) return;
        var r = await sb.from("tracks").update({ label: v }).eq("id", inp.dataset.id);
        if (!r.error) { var t = S.tracks.find(function (x) { return x.id === inp.dataset.id; }); if (t) t.label = v; }
      };
    });
  }

  // ---------- admin: band list ----------
  async function renderBand(msg, kind) {
    var r = await sb.from("band_members").select("*").order("role").order("name");
    var rows = r.data || [];
    app.innerHTML = header() + '<main class="sheet"><a class="back" href="#/"><span class="arr" aria-hidden="true">←</span> All songs</a>' +
      '<div class="card admin"><span class="admin-tag">Admin</span><h2>Band list</h2>' +
      '<p class="muted" style="margin:0">Only these emails can create an account and open the music. Add someone, then send them the site link; they choose their own password on first visit.</p>' +
      '<form class="form" id="add-form"><div class="two"><label class="f" for="m-name">Name<input id="m-name" placeholder="e.g. Rudo (BV alto)"></label>' +
      '<label class="f" for="m-email">Email<input id="m-email" type="email" required></label>' +
      '<label class="f" for="m-role">Access<select id="m-role"><option value="band">Band (listen only)</option><option value="admin">Admin (can upload &amp; edit)</option></select></label></div>' +
      (msg ? '<div class="msg ' + (kind || "err") + '">' + esc(msg) + '</div>' : '') +
      '<div><button class="btn primary" type="submit">Add to band list</button></div></form>' +
      '<div class="tablewrap"><table class="band"><thead><tr><th>Name</th><th>Email</th><th>Access</th><th></th></tr></thead><tbody>' +
      rows.map(function (m) {
        var me = m.email === S.session.user.email.toLowerCase();
        return '<tr><td>' + esc(m.name || "") + '</td><td>' + esc(m.email) + '</td><td>' + (m.role === "admin" ? "Admin" : "Band") + '</td><td>' + (me ? '<span class="muted">you</span>' : '<button class="btn danger" data-remove="' + esc(m.email) + '">Remove</button>') + '</td></tr>';
      }).join("") + '</tbody></table></div>' +
      '<p class="muted" style="margin:0;font-size:13px">Removing someone blocks the music for them straight away. To reset a forgotten password, delete their account under Authentication → Users in Supabase; they can then create a new password here.</p></div>' +
      '<div class="card admin" style="margin-top:20px"><span class="admin-tag">Admin</span><h2>Tour poster</h2>' +
      '<div class="poster-admin">' + poster("admin-poster") +
      '<div class="form"><p class="muted" style="margin:0">Shown on the sign-in screen and at the top of the song list. Anyone with the link can see it, so use public artwork only. JPG, PNG or WebP under 10 MB.</p>' +
      '<label class="f" for="p-file">Poster image<input id="p-file" type="file" accept="image/jpeg,image/png,image/webp"></label>' +
      '<div class="tp-row"><button class="btn primary" id="p-upload">Upload poster</button><span id="p-msg" class="muted"></span></div></div></div></div></main>';
    bindHeader();
    $("#p-upload").onclick = async function () {
      var f = ($("#p-file").files || [])[0], msg = $("#p-msg");
      if (!f) { msg.textContent = "Choose an image first."; return; }
      $("#p-upload").disabled = true; msg.textContent = "Uploading…";
      var up = await sb.storage.from("site-assets").upload("poster.jpg", f, { contentType: f.type, upsert: true, cacheControl: "300" });
      $("#p-upload").disabled = false;
      if (up.error) { msg.textContent = "Couldn't upload: " + up.error.message; return; }
      posterV = String(Date.now());
      renderBand("Poster updated.", "ok");
    };
    $("#add-form").onsubmit = async function (e) {
      e.preventDefault();
      var email = $("#m-email").value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return renderBand("Enter a valid email address.");
      var ins = await sb.from("band_members").insert({ email: email, name: $("#m-name").value.trim() || null, role: $("#m-role").value });
      if (ins.error) return renderBand(/duplicate/i.test(ins.error.message) ? "That email is already on the list." : ins.error.message);
      renderBand("Added " + email + ". Send them the site link.", "ok");
    };
    app.querySelectorAll("[data-remove]").forEach(function (b) {
      b.onclick = async function () {
        if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Tap again to remove"; return; }
        var d = await sb.from("band_members").delete().eq("email", b.dataset.remove);
        renderBand(d.error ? d.error.message : "Removed " + b.dataset.remove + ".", d.error ? "err" : "ok");
      };
    });
  }

  // ---------- admin: activity ----------
  var EVENT_TEXT = { sign_in: "signed in", visit: "opened the portal", song: "opened", play: "pressed play on" };
  var STAT = { days: 30, admins: false };
  async function renderActivity() {
    app.innerHTML = header() + '<main class="sheet"><a class="back" href="#/"><span class="arr" aria-hidden="true">←</span> All songs</a><p class="muted">Loading activity…</p></main>';
    bindHeader();
    var r = await Promise.all([
      sb.rpc("admin_activity_summary"),
      sb.from("activity").select("*").order("created_at", { ascending: false }).limit(150),
      sb.from("band_members").select("email,name"),
      sb.rpc("admin_listen_stats", { days: STAT.days, include_admins: STAT.admins })
    ]);
    if (route().view !== "activity") return;
    var names = {}; (r[2].data || []).forEach(function (m) { names[m.email] = m.name || m.email; });
    var titles = {}; S.songs.forEach(function (s) { titles[s.id] = s.title; });
    var sum = r[0].data || [], feed = r[1].data || [];
    var st = r[3].data || { totals: {}, songs: [], people: [], recent: [] };
    var err = r[0].error || r[1].error || r[3].error;
    var dot = function (email) { return '<span class="dot off" data-online="' + esc(email) + '" aria-hidden="true"></span>'; };
    var t = st.totals || {}, maxSong = Math.max.apply(null, (st.songs || []).map(function (x) { return x.seconds; }).concat([1]));
    var range = [[7, "7 days"], [30, "30 days"], [0, "All time"]];

    var h = header() + '<main class="sheet"><a class="back" href="#/"><span class="arr" aria-hidden="true">←</span> All songs</a>' +
      (err ? '<div class="msg err" style="margin-bottom:16px">' + esc(err.message) + '</div>' : '') +

      // listening stats
      '<div class="card admin"><span class="admin-tag">Admin</span>' +
      '<div class="stat-head"><h2>Listening stats</h2><div class="stat-controls"><span class="seg dark" role="group" aria-label="Time range">' +
      range.map(function (x) { return '<button data-days="' + x[0] + '" aria-pressed="' + (STAT.days === x[0]) + '">' + x[1] + '</button>'; }).join("") + '</span>' +
      '<label class="chk"><input type="checkbox" id="st-admins"' + (STAT.admins ? " checked" : "") + '> Include admins</label></div></div>' +
      '<div class="tiles"><div class="tile"><b>' + fmtDur(t.seconds) + '</b><span>listened</span></div><div class="tile"><b>' + (t.sessions || 0) + '</b><span>plays</span></div>' +
      '<div class="tile"><b>' + (t.listeners || 0) + '</b><span>people listening</span></div><div class="tile"><b>' + (t.songs || 0) + '</b><span>songs played</span></div></div>' +
      '<div class="stat-grid"><section><h3>Top songs</h3>' +
      ((st.songs || []).length ? '<ol class="topsongs">' + st.songs.map(function (x, i) {
        return '<li><span class="rank">' + (i + 1) + '</span><div class="ts-main"><div class="ts-line"><a href="#/song/' + encodeURIComponent(x.song_id) + '">' + esc(x.title) + '</a><b>' + fmtDur(x.seconds) + '</b></div>' +
          '<div class="bar"><span style="width:' + Math.max(2, Math.round(x.seconds / maxSong * 100)) + '%"></span></div>' +
          '<div class="meta">' + x.sessions + ' play' + (x.sessions === 1 ? "" : "s") + ' · ' + x.listeners + ' ' + (x.listeners === 1 ? "person" : "people") + ' · avg ' + fmtDur(x.avg_seconds) + ' a play · last ' + ago(x.last_played) + '</div></div></li>';
      }).join("") + '</ol>' : '<p class="empty">No listening yet in this range. Stats start counting from today’s update, whenever someone presses play.</p>') +
      '</section><section><h3>Who’s listening most</h3>' +
      ((st.people || []).length ? '<div class="tablewrap"><table class="band act"><thead><tr><th>Name</th><th>Time</th><th>Plays</th><th>Most played</th><th>Last</th></tr></thead><tbody>' +
        st.people.map(function (p) {
          return '<tr><td>' + dot(p.email) + '<b>' + esc(p.name) + '</b></td><td class="n">' + fmtDur(p.seconds) + '</td><td class="n">' + p.sessions + '</td><td>' + esc(p.top_song || "") + '<div class="meta">' + p.songs + ' song' + (p.songs === 1 ? "" : "s") + '</div></td><td>' + ago(p.last_played) + '</td></tr>';
        }).join("") + '</tbody></table></div>' : '<p class="empty">Nobody yet.</p>') +
      '</section></div>' +
      ((st.recent || []).length ? '<section><h3>Recent listening</h3><ul class="feed">' + st.recent.map(function (x) {
        return '<li><span class="feed-time" title="' + esc(when(x.started_at)) + '">' + ago(x.started_at) + '</span><span><b>' + esc(x.name) + '</b> played <a href="#/song/' + encodeURIComponent(x.song_id) + '">' + esc(x.title) + '</a> for ' + fmtDur(x.seconds) + '</span></li>';
      }).join("") + '</ul></section>' : '') +
      '<p class="muted" style="margin:0;font-size:13px">Time counts only while a song is actually playing (not paused or buffering). A “play” is one listen from pressing play until they leave the song.</p></div>' +

      // accounts
      '<div class="card admin" style="margin-top:20px"><span class="admin-tag">Admin</span><h2>Who’s using the portal</h2>' +
      '<div class="tablewrap"><table class="band act"><thead><tr><th>Name</th><th>Account</th><th>Last sign-in</th><th>Last active</th><th>Visits (7 days)</th><th>Songs opened</th><th>Plays</th></tr></thead><tbody>' +
      sum.map(function (m) {
        return '<tr><td>' + dot(m.email) + '<b>' + esc(m.name || m.email) + '</b><div class="meta">' + esc(m.email) + '</div></td>' +
          '<td>' + (m.has_account ? '<span class="pill ok">Created</span>' : '<span class="pill none">Not yet</span>') + '</td>' +
          '<td title="' + esc(when(m.last_sign_in)) + '">' + ago(m.last_sign_in) + '</td>' +
          '<td title="' + esc(when(m.last_seen)) + '">' + ago(m.last_seen) + '</td>' +
          '<td class="n">' + m.visits_7d + '</td><td class="n">' + m.songs_7d + '</td><td class="n">' + m.plays_7d + '</td></tr>';
      }).join("") + '</tbody></table></div>' +
      '<p class="muted" style="margin:0;font-size:13px">Green dot = on the portal right now. Last sign-in comes from the login system. Visits, songs opened and plays are counted from when activity logging started.</p></div>' +
      '<div class="card admin" style="margin-top:20px"><span class="admin-tag">Admin</span><h2>Recent activity</h2>' +
      (feed.length ? '<ul class="feed">' + feed.map(function (a) {
        return '<li><span class="feed-time" title="' + esc(when(a.created_at)) + '">' + ago(a.created_at) + '</span><span><b>' + esc(names[a.email] || a.email) + '</b> ' + (EVENT_TEXT[a.event] || a.event) +
          (a.song_id ? ' <a href="#/song/' + encodeURIComponent(a.song_id) + '">' + esc(titles[a.song_id] || a.song_id) + '</a>' : '') + '</span></li>';
      }).join("") + '</ul>' : '<p class="empty">No activity yet. It appears here as people sign in and open songs.</p>') +
      '</div></main>';
    app.innerHTML = h;
    bindHeader();
    app.querySelectorAll("[data-days]").forEach(function (b) { b.onclick = function () { STAT.days = +b.dataset.days; renderActivity(); }; });
    var ca = $("#st-admins"); if (ca) ca.onchange = function () { STAT.admins = ca.checked; renderActivity(); };
    drawOnline();
  }

  // ---------- admin: bulk upload ----------
  // Pick or drop whole folders (or loose files). Each file is matched to a song by
  // its folder names first, then its file name ("Stems/02 Bako Rangu/Keys.wav" -> Bako).
  function norm(x) { return String(x || "").toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z]/g, ""); }
  var ALIASES = { "chiuyai": ["chiuyamweya", "chiuya"], "huvepo-hwenyu": ["muhuvepo", "huvepo"], "tawanirwa-nyasha": ["tawanirwe", "tawanirwa"], "salt": ["saltoftheearth"], "armour-of-god": ["armorofgod"], "ndinobuda": ["pakaoma"], "guta": ["rehutiziro"], "mweya-mutsvene": ["mweyamutsvene", "ndinokudai"], "covenant-keeping-god": ["covenantkeeping", "covenant"], "yahweh-sabaoth": ["yahwesabaoth", "sabaoth"], "heiyaya-chant": ["heiyaya"], "africa-for-jesus": ["africaforjesus"] };
  function matchName(name) {
    var f = norm(name), best = null, bestLen = 0;
    if (!f) return null;
    S.songs.forEach(function (s) {
      [norm(s.title)].concat(ALIASES[s.id] || []).forEach(function (t) {
        if (!t) return;
        if ((f.indexOf(t) > -1 || (f.length >= 5 && t.indexOf(f) > -1)) && Math.min(t.length, f.length) > bestLen) { best = s; bestLen = Math.min(t.length, f.length); }
      });
    });
    if (best && best.id === "messiah" && /tour|canada|stems|performance/.test(f)) return null; // "Messiah Tour Stems" is the parent folder, not the song
    return bestLen >= 3 ? best : null;
  }
  function guessSong(path) {
    var parts = String(path).split("/"), file = parts.pop();
    for (var i = parts.length - 1; i >= 0; i--) { var m = matchName(parts[i]); if (m) return m; }
    return matchName(file);
  }
  var AUDIO_EXT = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", ogg: "audio/ogg", aif: "audio/aiff", aiff: "audio/aiff", mp4: "audio/mp4" };
  var OTHER_EXT = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };
  function extOf(n) { var m = String(n).toLowerCase().match(/\.([a-z0-9]+)$/); return m ? m[1] : ""; }
  function guessKind(name) {
    var e = extOf(name);
    if (OTHER_EXT[e]) return "chart";
    if (/guide|full ?mix|mixdown|reference|\bref\b|master|bounce|cue mix/i.test(name)) return "guide";
    return "stem";
  }
  function usable(name) { var e = extOf(name); return !!(AUDIO_EXT[e] || OTHER_EXT[e]) && !/^\._|^\./.test(String(name).split("/").pop()); }
  var bulk = { files: [], note: "" };
  function addFiles(list) {
    var skipped = 0, added = 0;
    list.forEach(function (x) {
      var path = x.path || x.file.webkitRelativePath || x.file.name;
      if (!usable(path)) { skipped++; return; }
      if (bulk.files.some(function (b) { return b.path === path && b.file.size === x.file.size; })) return;
      var g = guessSong(path);
      bulk.files.push({ file: x.file, path: path, songId: g ? g.id : "", kind: guessKind(x.file.name), status: "" });
      added++;
    });
    var unmatched = bulk.files.filter(function (b) { return !b.songId; }).length;
    renderBulk(added + " file" + (added === 1 ? "" : "s") + " added" + (skipped ? " (" + skipped + " non-audio file" + (skipped === 1 ? "" : "s") + " ignored)" : "") + "." +
      (unmatched ? " " + unmatched + " couldn’t be matched to a song; pick them below or leave them skipped." : " Everything is matched to a song."), unmatched ? "err" : "ok");
  }
  // walk dropped folders
  function readEntry(entry, prefix) {
    return new Promise(function (resolve) {
      if (entry.isFile) { entry.file(function (f) { resolve([{ file: f, path: prefix + f.name }]); }, function () { resolve([]); }); return; }
      if (!entry.isDirectory) { resolve([]); return; }
      var reader = entry.createReader(), all = [];
      (function next() {
        reader.readEntries(function (ents) {
          if (!ents.length) { Promise.all(all.map(function (e) { return readEntry(e, prefix + entry.name + "/"); })).then(function (r) { resolve([].concat.apply([], r)); }); return; }
          all = all.concat(Array.from(ents)); next();
        }, function () { resolve([]); });
      })();
    });
  }
  function renderBulk(msg, kind) {
    var opts = S.songs.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.title) + ' (' + esc(s.artist.split(" ")[0]) + ')</option>'; }).join("");
    var kinds = [["stem", "Stem"], ["guide", "Guide mix"], ["chart", "Chart"]];
    var groups = {}, order = [];
    bulk.files.forEach(function (b, i) { var k = b.songId || ""; if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(i); });
    order.sort(function (a, b) { if (!a) return 1; if (!b) return -1; var ia = S.songs.findIndex(function (s) { return s.id === a; }), ib = S.songs.findIndex(function (s) { return s.id === b; }); return ia - ib; });
    var songTitle = function (id) { var s = S.songs.find(function (x) { return x.id === id; }); return s ? s.title : id; };
    var total = bulk.files.length, big = bulk.files.filter(function (b) { return b.file.size > MAX_UPLOAD; }).length;
    var table = order.map(function (k) {
      var idx = groups[k];
      return '<tbody class="bulk-group"><tr class="bulk-head"><th colspan="4">' + (k ? esc(songTitle(k)) + ' <span class="muted">· ' + idx.length + ' file' + (idx.length > 1 ? "s" : "") + '</span>' : '<span style="color:var(--bad)">Not matched · ' + idx.length + ' file' + (idx.length > 1 ? "s" : "") + '</span>') + '</th></tr>' +
        idx.map(function (i) {
          var b = bulk.files[i];
          return '<tr><td style="overflow-wrap:anywhere">' + esc(b.file.name) + '<div class="meta" style="white-space:normal">' + esc(b.path.split("/").slice(0, -1).join(" / ")) + (b.path.indexOf("/") > -1 ? " · " : "") + mb(b.file.size) + '</div></td>' +
            '<td><select data-bulk="' + i + '" aria-label="Song for ' + esc(b.file.name) + '" class="bulk-sel"><option value="">Skip this file</option>' + opts + '</select></td>' +
            '<td><select data-bkind="' + i + '" aria-label="Type for ' + esc(b.file.name) + '" class="bulk-sel">' + kinds.map(function (x) { return '<option value="' + x[0] + '"' + (b.kind === x[0] ? " selected" : "") + '>' + x[1] + '</option>'; }).join("") + '</select></td>' +
            '<td class="meta" id="bulk-st-' + i + '">' + esc(b.status || (b.file.size > MAX_UPLOAD ? "too big (max 1 GB)" : "")) + '</td></tr>';
        }).join("") + '</tbody>';
    }).join("");
    app.innerHTML = header() + '<main class="sheet"><a class="back" href="#/"><span class="arr" aria-hidden="true">←</span> All songs</a>' +
      '<div class="card admin"><span class="admin-tag">Admin</span><h2>Bulk upload</h2>' +
      '<p class="muted" style="margin:0">Drop whole stem folders here, or pick them. A folder named after a song (e.g. “Bako Rangu Stems”) sends every file inside it to that song. You can also drop one big folder that holds a folder per song. Check the matches, fix any, then upload.</p>' +
      '<div class="dropzone" id="b-drop" tabindex="0"><strong>Drop folders or files here</strong><span class="muted">Audio (WAV, MP3, M4A, AIFF, FLAC), PDF charts and images · up to 1 GB each</span>' +
      '<span class="tp-row" style="justify-content:center"><label class="btn primary" for="b-folder">Choose folder</label><label class="btn quiet" for="b-files">Choose files</label></span>' +
      '<input id="b-folder" type="file" webkitdirectory directory multiple hidden><input id="b-files" type="file" multiple accept="audio/*,.aif,.aiff,.pdf,image/png,image/jpeg" hidden></div>' +
      (msg ? '<div class="msg ' + (kind || "err") + '">' + esc(msg) + '</div>' : '') +
      (total ? '<div class="tablewrap"><table class="band bulk"><thead><tr><th>File</th><th>Song</th><th>Type</th><th>Status</th></tr></thead>' + table + '</table></div>' +
        (big ? '<p class="msg err" style="margin:0">' + big + ' file' + (big > 1 ? "s are" : " is") + ' over 1 GB and will be skipped. Export those as MP3 or M4A and add them again.</p>' : '') +
        '<div class="tp-row"><button class="btn primary" id="b-go">Upload ' + bulk.files.filter(function (b) { return b.songId && b.status !== "done"; }).length + ' matched file(s)</button><button class="btn quiet" id="b-clear">Clear list</button><span class="muted" id="b-progress"></span></div>' : '') +
      '</div>' +
      '<div class="card admin" style="margin-top:20px"><span class="admin-tag">Admin</span><h2>Waveforms</h2><div id="wave-admin"><p class="muted" style="margin:0">Checking…</p></div></div></main>';
    bindHeader();
    waveAdmin();
    bulk.files.forEach(function (b, i) {
      var sel = app.querySelector('[data-bulk="' + i + '"]'); if (sel) { sel.value = b.songId || ""; sel.onchange = function () { b.songId = sel.value; renderBulk(); }; }
      var ks = app.querySelector('[data-bkind="' + i + '"]'); if (ks) ks.onchange = function () { b.kind = ks.value; };
    });
    $("#b-folder").onchange = function (e) { addFiles(Array.from(e.target.files || []).map(function (f) { return { file: f, path: f.webkitRelativePath || f.name }; })); };
    $("#b-files").onchange = function (e) { addFiles(Array.from(e.target.files || []).map(function (f) { return { file: f, path: f.name }; })); };
    var dz = $("#b-drop");
    dz.ondragover = function (e) { e.preventDefault(); dz.classList.add("over"); };
    dz.ondragleave = function () { dz.classList.remove("over"); };
    dz.ondrop = async function (e) {
      e.preventDefault(); dz.classList.remove("over");
      var items = Array.from(e.dataTransfer.items || []).map(function (it) { return it.webkitGetAsEntry ? it.webkitGetAsEntry() : null; }).filter(Boolean);
      if (items.length) { var r = await Promise.all(items.map(function (en) { return readEntry(en, ""); })); addFiles([].concat.apply([], r)); }
      else addFiles(Array.from(e.dataTransfer.files || []).map(function (f) { return { file: f, path: f.name }; }));
    };
    var clr = $("#b-clear"); if (clr) clr.onclick = function () { bulk.files = []; renderBulk(); };
    var go = $("#b-go"); if (go) go.onclick = async function () {
      go.disabled = true; clr.disabled = true;
      var queue = bulk.files.map(function (b, i) { return i; }).filter(function (i) { var b = bulk.files[i]; return b.songId && b.status !== "done"; });
      var done = 0, failed = 0, skipped = 0, n = queue.length, prog = $("#b-progress");
      var setSt = function (i, t) { bulk.files[i].status = t; var el = document.getElementById("bulk-st-" + i); if (el) el.textContent = t; };
      async function one(i) {
        var b = bulk.files[i];
        if (b.file.size > MAX_UPLOAD) { setSt(i, "too big (max 1 GB)"); failed++; return; }
        var label = prettyName(b.file.name);
        if (S.tracks.some(function (t) { return t.song_id === b.songId && t.label === label && t.size_bytes === b.file.size; })) { setSt(i, "already on the song"); skipped++; return; }
        setSt(i, "uploading…");
        var e = extOf(b.file.name), type = b.file.type || AUDIO_EXT[e] || OTHER_EXT[e] || undefined;
        if (type === "audio/x-m4a") type = "audio/mp4";
        var path = b.songId + "/" + b.kind + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 6) + "-" + safeFile(b.file.name);
        var up = await uploadFile(path, b.file, type, function (p) { setSt(i, "uploading " + Math.round(p * 100) + "%"); });
        if (up.error) { setSt(i, "failed: " + up.error.message); failed++; return; }
        var ins = await sb.from("tracks").insert({ song_id: b.songId, kind: b.kind, label: b.kind === "guide" && !/guide|mix/i.test(label) ? "Guide mix" : label, path: path, sort: b.kind === "chart" ? tracksFor(b.songId, b.kind).length : nextSort(b.songId), size_bytes: b.file.size }).select().single();
        if (ins.error) { setSt(i, "failed: " + ins.error.message); failed++; return; }
        S.tracks.push(ins.data); peaksFromFile(ins.data, b.file); setSt(i, "done"); done++;
      }
      var cursor = 0;
      async function worker() { while (cursor < queue.length) { var i = queue[cursor++]; await one(i); if (prog) prog.textContent = (done + failed + skipped) + " of " + n + " processed…"; } }
      await Promise.all([worker(), worker(), worker()]);
      var songsTouched = {}; bulk.files.forEach(function (b) { if (b.status === "done") songsTouched[b.songId] = 1; });
      var m = "Uploaded " + done + " file" + (done === 1 ? "" : "s") + " to " + Object.keys(songsTouched).length + " song" + (Object.keys(songsTouched).length === 1 ? "" : "s") + "." + (skipped ? " " + skipped + " were already there." : "") + (failed ? " " + failed + " failed; see the Status column." : "");
      if (!failed) bulk.files = bulk.files.filter(function (b) { return b.status !== "done" && b.status !== "already on the song"; });
      renderBulk(m, failed ? "err" : "ok");
    };
  }

  // Waveform status for the whole library, with a button to draw the missing ones.
  var WAVEJOB = null;
  async function waveAdmin() {
    var box = document.getElementById("wave-admin"); if (!box) return;
    var audio = S.tracks.filter(function (t) { return t.kind !== "chart"; });
    var r = await sb.from("track_peaks").select("track_id");
    var have = {}; (r.data || []).forEach(function (p) { have[p.track_id] = 1; });
    var missing = audio.filter(function (t) { return !have[t.id] && !peaksCache[t.id]; });
    var mbEst = missing.reduce(function (a, t) { var e = (t.path.match(/\.([a-z0-9]+)$/i) || [])[1] || ""; e = e.toLowerCase(); return a + (e === "wav" ? 7 : e === "mp3" ? 4.5 : (t.size_bytes || 0) / 1048576); }, 0);
    box = document.getElementById("wave-admin"); if (!box) return;
    var done = audio.length - missing.length;
    box.innerHTML = '<p style="margin:0"><b>' + done + ' of ' + audio.length + '</b> tracks have a waveform.</p>' +
      (missing.length ? '<p class="muted" style="margin:0;font-size:14px">Drawing the other ' + missing.length + ' reads small slices of each file (about ' + (mbEst >= 1024 ? (mbEst / 1024).toFixed(1) + ' GB' : Math.max(1, Math.round(mbEst)) + ' MB') + ' in all, not the full ' + mb(missing.reduce(function (a, t) { return a + (t.size_bytes || 0); }, 0)) + '). Do it once on a computer with good Wi-Fi and keep this tab open; the whole library takes roughly 20–30 minutes. New uploads get their waveform automatically.</p>' +
        '<div class="tp-row"><button class="btn primary" id="wave-go"' + (WAVEJOB ? ' disabled' : '') + '>' + (WAVEJOB ? 'Drawing…' : 'Draw the missing waveforms') + '</button><span class="muted" id="wave-prog">' + (WAVEJOB ? esc(WAVEJOB.msg) : '') + '</span></div>' :
        '<p class="muted" style="margin:0;font-size:14px">All done. New uploads get their waveform automatically.</p>');
    var go = document.getElementById("wave-go");
    if (go) go.onclick = function () {
      go.disabled = true; go.textContent = "Drawing…";
      WAVEJOB = { msg: "Starting…" };
      buildPeaks(missing, function (ok, fail, n) {
        WAVEJOB.msg = (ok + fail) + " of " + n + " done" + (fail ? " · " + fail + " couldn’t be read" : "");
        var pr = document.getElementById("wave-prog"); if (pr) pr.textContent = WAVEJOB.msg;
      }).then(function (res) { WAVEJOB = null; var pr = document.getElementById("wave-prog"); if (pr) { waveAdmin(); } });
    };
  }

  // ---------- boot ----------
  async function onSession(session) {
    S.session = session;
    if (!session) { S.member = null; S.loggedVisit = false; stopPresence(); render(); return; }
    try {
      await loadMember();
      if (S.member) {
        await loadAll();
        if (!S.loggedVisit) { S.loggedVisit = true; logEvent(S.justSignedIn ? "sign_in" : "visit"); }
        S.justSignedIn = false;
        startPresence();
        try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
      }
    } catch (e) {
      app.innerHTML = '<div class="login card"><h2>Couldn’t load the library</h2><p>' + esc(e.message || e) + '</p><button class="btn" onclick="location.reload()">Try again</button></div>';
      return;
    }
    render();
  }
  var lastUser = undefined;
  sb.auth.onAuthStateChange(function (event, session) {
    var uid = session ? session.user.id : null;
    if (uid === lastUser && event !== "SIGNED_OUT") { S.session = session; return; }
    lastUser = uid;
    setTimeout(function () { onSession(session); }, 0);
  });
})();
