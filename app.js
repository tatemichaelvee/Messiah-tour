/* Messiah Tour Band Portal — band site on Supabase.
   Routes: #/ (library), #/song/<id>, #/band (admin only). */
(function () {
  "use strict";
  var CFG = window.MUSIC_ROOM_CONFIG;
  var sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
  var BUCKET = CFG.bucket;
  var ARTISTS = [
    { name: "Michael Mahendere", short: "Michael", role: "Main set" },
    { name: "Eleana Makombe", short: "Eleana", role: "Supporting set" },
    { name: "Misheck Mahendere", short: "Misheck", role: "Supporting set" }
  ];
  var MAX_UPLOAD = 1024 * 1024 * 1024; // 1 GB per file (Supabase Pro)
  var CHUNK = 6 * 1024 * 1024; // Supabase resumable uploads need exactly 6 MB chunks

  var app = document.getElementById("app");
  var S = {
    session: null, member: null, songs: [], tracks: [], notice: "",
    q: "", artist: "all", loginMode: "signin", editing: false
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
      sb.from("site_notice").select("body").eq("id", 1).maybeSingle()
    ]);
    if (r[0].error) throw r[0].error;
    S.songs = r[0].data || [];
    S.tracks = (r[1].data) || [];
    S.notice = r[2].data ? r[2].data.body : "";
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
    return { view: "list" };
  }
  window.addEventListener("hashchange", function () { S.editing = false; if (!/^#\/song\//.test(location.hash)) S.loggedSong = null; render(); window.scrollTo(0, 0); });

  async function render() {
    closeViewer();
    if (mixer && route().view !== "song") { mixer.destroy(); mixer = null; }
    if (!S.session) return renderLogin();
    if (!S.member) return renderNotListed();
    var r = route();
    if (r.view === "song") return renderSong(r.id);
    if (r.view === "band" && isAdmin()) return renderBand();
    if (r.view === "upload" && isAdmin()) return renderBulk();
    if (r.view === "activity" && isAdmin()) return renderActivity();
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
  function bindHeader() { var b = $("#signout"); if (b) b.onclick = function () { sb.auth.signOut(); }; }

  // ---------- library ----------
  function renderList() {
    var total = S.songs.length, ready = S.songs.filter(function (s) { return status(s).cls === "ok"; }).length;
    var h = header(true) + '<main class="sheet">';
    if (isAdmin() && S.editing) {
      h += '<div class="card admin form"><span class="admin-tag">Admin</span><label class="f" for="notice">Note to the band<textarea id="notice">' + esc(S.notice) + '</textarea></label><div class="tp-row"><button class="btn primary" id="save-notice">Save note</button><button class="btn quiet" id="cancel-notice">Cancel</button></div></div>';
    } else if (S.notice) {
      h += '<div class="notice"><strong>From the MD desk</strong>' + esc(S.notice) + (isAdmin() ? ' <button class="linkbtn" id="edit-notice">Edit</button>' : '') + '</div>';
    } else if (isAdmin()) {
      h += '<button class="linkbtn" id="edit-notice">Add a note to the band</button>';
    }
    h += '<div class="finder"><input class="search" id="q" type="search" placeholder="Find a song or a lyric line" aria-label="Search songs and lyrics" value="' + esc(S.q) + '">' +
      '<div class="chips" role="group" aria-label="Filter by artist"><button class="chip" data-artist="all" aria-pressed="' + (S.artist === "all") + '">All ' + total + '</button>' +
      ARTISTS.map(function (a) { var n = S.songs.filter(function (s) { return s.artist === a.name; }).length; return '<button class="chip" data-artist="' + esc(a.name) + '" aria-pressed="' + (S.artist === a.name) + '">' + a.short + ' ' + n + '</button>'; }).join("") +
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
    app.querySelectorAll("[data-artist]").forEach(function (b) { b.onclick = function () { S.artist = b.dataset.artist; renderList(); }; });
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
    ARTISTS.forEach(function (a) {
      var all = S.songs.filter(function (s) { return s.artist === a.name; });
      var list = all.filter(function (s) {
        if (S.artist !== "all" && S.artist !== a.name) return false;
        return !q || (s.title + " " + plainLyrics(s.lyrics)).toLowerCase().indexOf(q) > -1;
      });
      if (!list.length) return; any = true;
      out += '<section class="artist"><div class="artist-head"><h2>' + esc(a.name) + '</h2><span class="sub">' + a.role + ' · ' + list.length + ' song' + (list.length > 1 ? "s" : "") + '</span></div><ol class="songs">';
      list.forEach(function (s) {
        var st = status(s), meta = [s.key ? esc(s.key) : "", s.bpm ? s.bpm + " bpm" : ""].filter(Boolean).join(" · ");
        out += '<li><a class="row" href="#/song/' + encodeURIComponent(s.id) + '" aria-label="Open ' + esc(s.title) + '">' +
          '<span class="thumb">' + (CFG.posterUrl ? '<img src="' + esc(CFG.posterUrl + (posterV ? "?v=" + posterV : "")) + '" alt="" loading="lazy" onerror="this.remove()">' : '') +
          '<span class="thumb-play" title="Play ' + esc(s.title) + '">' + ICON_THUMB + '</span></span>' +
          '<span class="title-block"><span class="name">' + esc(s.title) + '</span><span class="by"><span class="num">' + String(all.indexOf(s) + 1).padStart(2, "0") + '</span> ' + esc(a.name) + (meta ? ' · ' + meta : '') + '</span></span>' +
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
    var mixTracks = stems.concat(guides);
    var facts = [];
    if (s.key) facts.push("<span>Key <b>" + esc(s.key) + "</b></span>");
    if (s.bpm) facts.push("<span>BPM <b>" + esc(s.bpm) + "</b></span>");
    facts.push("<span><b>" + esc(s.artist) + "</b></span>");
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
        '<div class="tp-row"><span class="tp-label">Speed</span><span class="seg" id="speed">' +
        [0.75, 0.9, 1].map(function (v) { return '<button data-rate="' + v + '" aria-pressed="' + (v === 1) + '">' + (v === 1 ? "1×" : v + "×") + '</button>'; }).join("") + '</span>' +
        '<span class="tp-label">Loop</span><span class="seg"><button id="loop-a">Set A</button><button id="loop-b">Set B</button><button id="loop-clear">Clear</button></span>' +
        '<span class="loopinfo" id="loopinfo"></span></div>' +
        '<div class="loadbar" id="loadbar">Loading audio…</div>' +
        '</div><div class="tracks" id="tracks">' +
        mixTracks.map(function (t, i) {
          return '<div class="trk" data-i="' + i + '"><span class="tname"><span class="tkind">' + (t.kind === "guide" ? "Guide mix" : "Stem") + '</span>' + esc(t.label) + '</span>' +
            '<span class="ms"><button class="m" data-mute="' + i + '" aria-pressed="false" aria-label="Mute ' + esc(t.label) + '">M</button><button class="s" data-solo="' + i + '" aria-pressed="false" aria-label="Solo ' + esc(t.label) + '">S</button></span>' +
            '<input type="range" min="0" max="1" step="0.01" value="1" data-vol="' + i + '" aria-label="Volume ' + esc(t.label) + '">' +
            (isAdmin() ? '<button class="linkbtn dl" data-dl="' + esc(t.id) + '">Download</button>' : '<span class="dl" aria-hidden="true"></span>') + '</div>';
        }).join("") + '</div></div>';
      if (stems.length && guides.length) h += '<p class="muted" style="font-size:14px">The guide mix starts muted so it doesn’t double the stems. Unmute it to hear the full recording.</p>';
    }
    h += '</div>';

    if (charts.length) {
      h += '<div class="block"><h3>Charts</h3><div class="charts">' + charts.map(function (c) { return '<button class="btn quiet" data-chart="' + esc(c.id) + '">' + esc(c.label) + ' ↗</button>'; }).join("") + '</div></div>';
    }
    h += '</div><div class="col-side">';
    if (s.bv_notes) h += '<div class="block"><h3>BV parts &amp; cues</h3>' + partsLegend(s.bv_notes) + '<div class="bvnotes">' + lyricsHtml(s.bv_notes) + '</div></div>';
    var sheet = pickSheet(charts);
    h += '<div class="block"><h3>Lyrics</h3>' + (s.lyrics ? '<p class="lyrics">' + esc(plainLyrics(s.lyrics)) + '</p>' : '<p class="empty">Lyrics not added yet.</p>') +
      (sheet ? '<button class="btn sheetbtn" data-sheet="' + esc(sheet.id) + '">' + ICON_EXPAND + ' Open Ruva’s coloured sheet</button>' : '') + '</div>';
    h += '</div></div>';

    if (isAdmin()) h += adminSongPanel(s, mixTracks.concat(charts));
    h += '</main>';
    app.innerHTML = h;
    bindHeader();

    if (mixTracks.length) {
      if (mixer) mixer.destroy();
      mixer = new Mixer(mixTracks, stems.length > 0);
      mixer.onFirstPlay = function () { logEvent("play", s.id); };
      mixer.autoplay = S.autoplay === s.id;
      mixer.start();
    }
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
  }

  // ---------- full-screen sheet viewer ----------
  // PDFs are drawn with PDF.js so every page shows on phones too (iOS only shows
  // page 1 of a PDF in a frame). While it's open, a player bar at the bottom keeps
  // the song's mixer in reach; if another song is playing in the floating player,
  // that player stays on top instead.
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
  }
  async function openViewer(t, songTitle) {
    closeViewer();
    var fl = document.getElementById("mt-float-player"), floatOn = !!(fl && !fl.hidden);
    var hasMix = !!(mixer && document.getElementById("play")) && !floatOn;
    var el = document.createElement("div");
    el.className = "pv" + (floatOn ? " pv-float" : "");
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", t.label);
    el.innerHTML = '<div class="pv-bar"><strong class="pv-title">' + esc(t.label) + '</strong>' +
      '<span class="pv-zoom"><button data-z="-1" aria-label="Zoom out">−</button><button data-z="0" aria-label="Fit to width">Fit</button><button data-z="1" aria-label="Zoom in">+</button></span>' +
      '<button class="pv-close" aria-label="Close sheet">×</button></div>' +
      '<div class="pv-body" tabindex="0"><div class="pv-pages"><p class="pv-msg">Opening the sheet…</p></div></div>' +
      (hasMix ? '<div class="pv-player"><button class="pv-play" id="pv-play" aria-label="Play">' + ICON_PLAY + '</button>' +
        '<div class="pv-info"><strong>' + esc(songTitle || "") + '</strong><span id="pv-clock">0:00 / 0:00</span></div>' +
        '<input id="pv-scrub" type="range" min="0" max="1000" value="0" step="1" aria-label="Position"></div>' : '');
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
    if (hasMix) {
      el.querySelector("#pv-play").onclick = function () { var p = document.getElementById("play"); if (!p) return; if (p.disabled) { var c = document.getElementById("pv-clock"); if (c) c.textContent = "Still loading the audio…"; return; } p.click(); };
      var sc = el.querySelector("#pv-scrub");
      sc.addEventListener("input", function () { mixer.seeking = true; var c = document.getElementById("pv-clock"); if (c) c.textContent = fmt(sc.value / 1000 * mixer.duration) + " / " + fmt(mixer.duration); });
      sc.addEventListener("change", function () { mixer.seeking = false; mixer.seek(sc.value / 1000 * mixer.duration); });
      mixer.setIcon(); mixer.tick(true);
    }
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

  // ---------- mixer engine ----------
  // One <audio> element per track, all routed through Web Audio gain nodes so
  // mute, solo and volume work on phones too. Elements stream, so long stems
  // don't have to fit in memory. A drift check keeps them locked together.
  function Mixer(tracks, hasStems) {
    this.tracks = tracks.map(function (t) {
      return { meta: t, el: null, gain: null, vol: 1, mute: t.kind === "guide" && hasStems, solo: false, ready: false };
    });
    this.ctx = null; this.playing = false; this.rate = 1; this.loopA = null; this.loopB = null;
    this.duration = 0; this.raf = 0; this.lastSync = 0; this.dead = false; this.seeking = false;
  }
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
        if (!t.retried && urlCache[t.meta.path]) { t.retried = true; delete urlCache[t.meta.path]; signedUrls([t.meta.path]).then(function (r2) { if (!self.dead && r2.data && r2.data[t.meta.path]) { el.src = r2.data[t.meta.path]; el.load(); } }); return; }
        self.setLoad("One track failed to load (" + t.meta.label + "). The rest will still play."); t.ready = true; t.broken = true; self.updateLoad();
      });
      el.addEventListener("ended", function () { if (i === self.master() && !self.loopOn()) self.pause(); });
      // one stem ran out of downloaded audio: hold everything until it catches up
      el.addEventListener("waiting", function () {
        if (!self.playing || t.broken || el.ended || Date.now() - (t.lastSeek || 0) < 1500) return;
        setTimeout(function () { if (self.playing && !self.stalled && el.readyState < 3 && !el.paused) self.stall(); }, 250);
      });
      t.el = el; el.load();
    });
    // tell the floating player exactly which audio belongs to this song
    this.bank = this.tracks.map(function (t) { return t.el; });
    window.mtCurrentBank = this.bank;
    this.bind(); this.applyGains();
  };
  Mixer.prototype.master = function () {
    var best = 0, d = -1;
    this.tracks.forEach(function (t, i) { if (!t.broken && t.el && (t.el.duration || 0) > d) { d = t.el.duration || 0; best = i; } });
    return best;
  };
  Mixer.prototype.setLoad = function (msg) { var lb = document.getElementById("loadbar"); if (lb) { lb.textContent = msg; lb.hidden = !msg; } };
  Mixer.prototype.updateLoad = function () {
    var n = this.tracks.filter(function (t) { return t.ready; }).length;
    var p = document.getElementById("play");
    if (n === this.tracks.length) {
      this.setLoad(""); if (p) p.disabled = false;
      if (this.autoplay && !this.playing) { this.autoplay = false; this.play(true); }
    }
    else if (this.autoplay) this.setLoad("Loading audio… " + n + " of " + this.tracks.length + " tracks ready · starts playing when loaded");
    else this.setLoad("Loading audio… " + n + " of " + this.tracks.length + " tracks ready");
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
  Mixer.prototype.applyGains = function () {
    var anySolo = this.tracks.some(function (t) { return t.solo; });
    var ctx = this.ctx;
    this.tracks.forEach(function (t, i) {
      var audible = anySolo ? t.solo : !t.mute;
      var g = audible ? t.vol : 0;
      if (t.gain && ctx) t.gain.gain.setTargetAtTime(g, ctx.currentTime, 0.015);
      else if (t.el) { t.el.muted = !audible; t.el.volume = t.vol; }
      var row = document.querySelector('.trk[data-i="' + i + '"]');
      if (row) {
        row.classList.toggle("silent", !audible);
        row.querySelector("[data-mute]").setAttribute("aria-pressed", String(t.mute));
        row.querySelector("[data-solo]").setAttribute("aria-pressed", String(t.solo));
      }
    });
  };
  Mixer.prototype.now = function () { var m = this.tracks[this.master()]; return m && m.el ? m.el.currentTime : 0; };
  Mixer.prototype.loopOn = function () { return this.loopA != null && this.loopB != null && this.loopB > this.loopA; };
  Mixer.prototype.play = async function (auto) {
    var pb = document.getElementById("play"); if (pb) pb.classList.remove("nudge");
    // Only one song plays at a time: starting this one stops whatever the floating player holds.
    var fl = document.getElementById("mt-float-player");
    if (fl && !fl.hidden) { var fx = fl.querySelector("#mt-float-close"); if (fx) fx.click(); }
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
    if (res.indexOf(false) > -1) return this.blocked();
    if (!this.playLogged) { this.playLogged = true; if (this.onFirstPlay) this.onFirstPlay(); }
    this.loop();
  };
  // The browser refused to start sound without a direct tap (mostly Safari). Ask for one tap.
  Mixer.prototype.blocked = function () {
    this.tracks.forEach(function (t) { if (t.el) t.el.pause(); });
    this.playing = false; this.setIcon();
    this.setLoad("Tap play to start. Your browser needs one tap before it will play sound.");
    var p = document.getElementById("play"); if (p) { p.classList.add("nudge"); p.focus(); }
  };
  Mixer.prototype.pause = function () {
    this.playing = false; this.stalled = false; clearInterval(this.stallTimer); this.setIcon();
    this.tracks.forEach(function (t) { if (t.el) t.el.pause(); });
    cancelAnimationFrame(this.raf); this.tick(true);
  };
  Mixer.prototype.seek = function (time) {
    time = Math.max(0, Math.min(time, this.duration || 0));
    this.tracks.forEach(function (t) { if (t.el && !t.broken) { t.el.currentTime = time; t.lastSeek = Date.now(); } });
    this.tick(true);
  };
  Mixer.prototype.setIcon = function () {
    var self = this;
    ["play", "pv-play"].forEach(function (id) { var p = document.getElementById(id); if (p) { p.innerHTML = self.playing ? ICON_PAUSE : ICON_PLAY; p.setAttribute("aria-label", self.playing ? "Pause" : "Play"); } });
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
    var now = this.now(), self = this;
    [["clock", "scrub"], ["pv-clock", "pv-scrub"]].forEach(function (ids) {
      var c = document.getElementById(ids[0]), sc = document.getElementById(ids[1]);
      if (c) c.textContent = fmt(now) + " / " + fmt(self.duration);
      if (sc && !self.seeking && self.duration) sc.value = Math.round(now / self.duration * 1000);
    });
    var li = document.getElementById("loopinfo");
    if (li && (force || true)) li.textContent = this.loopA != null ? ("A " + fmt(this.loopA) + (this.loopB != null ? " → B " + fmt(this.loopB) : "")) : "";
  };
  Mixer.prototype.bind = function () {
    var self = this;
    document.getElementById("play").onclick = function () { self.playing ? self.pause() : self.play(); };
    var sc = document.getElementById("scrub");
    sc.addEventListener("input", function () { self.seeking = true; var c = document.getElementById("clock"); if (c) c.textContent = fmt(sc.value / 1000 * self.duration) + " / " + fmt(self.duration); });
    sc.addEventListener("change", function () { self.seeking = false; self.seek(sc.value / 1000 * self.duration); });
    document.querySelectorAll("#speed [data-rate]").forEach(function (b) {
      b.onclick = function () {
        self.rate = parseFloat(b.dataset.rate);
        document.querySelectorAll("#speed [data-rate]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        self.tracks.forEach(function (t) { if (t.el) t.el.playbackRate = self.rate; });
      };
    });
    document.getElementById("loop-a").onclick = function () { self.loopA = self.now(); if (self.loopB != null && self.loopB <= self.loopA) self.loopB = null; self.tick(true); };
    document.getElementById("loop-b").onclick = function () { var n = self.now(); if (self.loopA == null || n <= self.loopA) return; self.loopB = n; self.seek(self.loopA); };
    document.getElementById("loop-clear").onclick = function () { self.loopA = self.loopB = null; self.tick(true); };
    document.querySelectorAll("[data-mute]").forEach(function (b) { b.onclick = function () { var t = self.tracks[+b.dataset.mute]; t.mute = !t.mute; self.applyGains(); }; });
    document.querySelectorAll("[data-solo]").forEach(function (b) { b.onclick = function () { var t = self.tracks[+b.dataset.solo]; t.solo = !t.solo; self.applyGains(); }; });
    document.querySelectorAll("[data-vol]").forEach(function (r) { r.oninput = function () { self.tracks[+r.dataset.vol].vol = parseFloat(r.value); self.applyGains(); }; });
  };
  Mixer.prototype.destroy = function () {
    this.dead = true; this.playing = false; clearInterval(this.stallTimer); cancelAnimationFrame(this.raf);
    if (this.bank && window.mtCurrentBank === this.bank) window.mtCurrentBank = null;
    this.tracks.forEach(function (t) { if (t.el) { t.el.pause(); t.el.removeAttribute("src"); t.el.load(); } });
    if (this.ctx) { try { this.ctx.close(); } catch (e) {} }
  };

  // ---------- admin: song editing & uploads ----------
  function adminSongPanel(s, files) {
    return '<div class="block"><div class="card admin">' +
      '<span class="admin-tag">Admin · only you see this</span>' +
      '<div class="form"><div class="two">' +
      '<label class="f" for="a-key">Key<input id="a-key" value="' + esc(s.key || "") + '" placeholder="e.g. Bb"></label>' +
      '<label class="f" for="a-bpm">BPM<input id="a-bpm" type="number" inputmode="numeric" value="' + esc(s.bpm || "") + '"></label></div>' +
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
      (files.length ? '<hr style="border:0;border-top:1px solid var(--line);width:100%"><div class="form"><h3 style="margin:0">Files on this song</h3><div class="tablewrap"><table class="band"><thead><tr><th>Name</th><th>Type</th><th>Size</th><th></th></tr></thead><tbody>' +
        files.map(function (t) { return '<tr><td><input class="f-rename" data-id="' + esc(t.id) + '" value="' + esc(t.label) + '" aria-label="Track name" style="width:100%;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--surface)"></td><td>' + t.kind + '</td><td class="meta">' + (t.size_bytes ? mb(t.size_bytes) : "") + '</td><td><button class="btn danger" data-del="' + esc(t.id) + '">Delete</button></td></tr>'; }).join("") +
        '</tbody></table></div><p class="muted" style="margin:0;font-size:13px">Rename a track by editing its name; it saves when you leave the box.</p></div>' : '') +
      '</div></div>';
  }
  function bindAdminSong(s) {
    $("#a-save").onclick = async function () {
      var b = $("#a-save"); b.disabled = true;
      var bpm = parseInt($("#a-bpm").value, 10);
      var patch = { key: $("#a-key").value.trim() || null, bpm: isFinite(bpm) ? bpm : null, bv_notes: $("#a-bv").value.trim() || null, lyrics: $("#a-lyrics").value.replace(/\s+$/, "") || null };
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
      var base = tracksFor(s.id, kind).length, uploaded = 0;
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
  async function renderActivity() {
    app.innerHTML = header() + '<main class="sheet"><a class="back" href="#/"><span class="arr" aria-hidden="true">←</span> All songs</a><p class="muted">Loading activity…</p></main>';
    bindHeader();
    var r = await Promise.all([
      sb.rpc("admin_activity_summary"),
      sb.from("activity").select("*").order("created_at", { ascending: false }).limit(150),
      sb.from("band_members").select("email,name")
    ]);
    if (route().view !== "activity") return;
    var names = {}; (r[2].data || []).forEach(function (m) { names[m.email] = m.name || m.email; });
    var titles = {}; S.songs.forEach(function (s) { titles[s.id] = s.title; });
    var sum = r[0].data || [], feed = r[1].data || [];
    var err = r[0].error || r[1].error;
    var h = header() + '<main class="sheet"><a class="back" href="#/"><span class="arr" aria-hidden="true">←</span> All songs</a>' +
      '<div class="card admin"><span class="admin-tag">Admin</span><h2>Who’s using the portal</h2>' +
      (err ? '<div class="msg err">' + esc(err.message) + '</div>' : '') +
      '<div class="tablewrap"><table class="band act"><thead><tr><th>Name</th><th>Account</th><th>Last sign-in</th><th>Last active</th><th>Visits (7 days)</th><th>Songs opened</th><th>Plays</th></tr></thead><tbody>' +
      sum.map(function (m) {
        return '<tr><td><b>' + esc(m.name || m.email) + '</b><div class="meta">' + esc(m.email) + '</div></td>' +
          '<td>' + (m.has_account ? '<span class="pill ok">Created</span>' : '<span class="pill none">Not yet</span>') + '</td>' +
          '<td title="' + esc(when(m.last_sign_in)) + '">' + ago(m.last_sign_in) + '</td>' +
          '<td title="' + esc(when(m.last_seen)) + '">' + ago(m.last_seen) + '</td>' +
          '<td class="n">' + m.visits_7d + '</td><td class="n">' + m.songs_7d + '</td><td class="n">' + m.plays_7d + '</td></tr>';
      }).join("") + '</tbody></table></div>' +
      '<p class="muted" style="margin:0;font-size:13px">Last sign-in comes from the login system. Visits, songs opened and plays are counted from when activity logging started.</p></div>' +
      '<div class="card admin" style="margin-top:20px"><span class="admin-tag">Admin</span><h2>Recent activity</h2>' +
      (feed.length ? '<ul class="feed">' + feed.map(function (a) {
        return '<li><span class="feed-time" title="' + esc(when(a.created_at)) + '">' + ago(a.created_at) + '</span><span><b>' + esc(names[a.email] || a.email) + '</b> ' + (EVENT_TEXT[a.event] || a.event) +
          (a.song_id ? ' <a href="#/song/' + encodeURIComponent(a.song_id) + '">' + esc(titles[a.song_id] || a.song_id) + '</a>' : '') + '</span></li>';
      }).join("") + '</ul>' : '<p class="empty">No activity yet. It appears here as people sign in and open songs.</p>') +
      '</div></main>';
    app.innerHTML = h;
    bindHeader();
  }

  // ---------- admin: bulk upload ----------
  // Pick or drop whole folders (or loose files). Each file is matched to a song by
  // its folder names first, then its file name ("Stems/02 Bako Rangu/Keys.wav" -> Bako).
  function norm(x) { return String(x || "").toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z]/g, ""); }
  var ALIASES = { "chiuyai": ["chiuyamweya", "chiuya"], "huvepo-hwenyu": ["muhuvepo", "huvepo"], "tawanirwa-nyasha": ["tawanirwe", "tawanirwa"], "salt": ["saltoftheearth"], "armour-of-god": ["armorofgod"], "ndinobuda": ["pakaoma"], "guta": ["rehutiziro"] };
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
      '</div></main>';
    bindHeader();
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
        var ins = await sb.from("tracks").insert({ song_id: b.songId, kind: b.kind, label: b.kind === "guide" && !/guide|mix/i.test(label) ? "Guide mix" : label, path: path, sort: tracksFor(b.songId, b.kind).length, size_bytes: b.file.size }).select().single();
        if (ins.error) { setSt(i, "failed: " + ins.error.message); failed++; return; }
        S.tracks.push(ins.data); setSt(i, "done"); done++;
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

  // ---------- boot ----------
  async function onSession(session) {
    S.session = session;
    if (!session) { S.member = null; S.loggedVisit = false; render(); return; }
    try {
      await loadMember();
      if (S.member) {
        await loadAll();
        if (!S.loggedVisit) { S.loggedVisit = true; logEvent(S.justSignedIn ? "sign_in" : "visit"); }
        S.justSignedIn = false;
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
