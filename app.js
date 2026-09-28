/* Messiah Tour Music Room — band site on Supabase.
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
  var MAX_UPLOAD = 50 * 1024 * 1024;

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
  function mb(n) { return (n / 1048576).toFixed(n > 10485760 ? 0 : 1) + " MB"; }
  var ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z" fill="currentColor"/></svg>';

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
    return { view: "list" };
  }
  window.addEventListener("hashchange", function () { S.editing = false; render(); window.scrollTo(0, 0); });

  async function render() {
    if (mixer && route().view !== "song") { mixer.destroy(); mixer = null; }
    if (!S.session) return renderLogin();
    if (!S.member) return renderNotListed();
    var r = route();
    if (r.view === "song") return renderSong(r.id);
    if (r.view === "band" && isAdmin()) return renderBand();
    return renderList();
  }

  // ---------- login ----------
  function renderLogin(msg, kind) {
    var signup = S.loginMode === "signup";
    app.innerHTML =
      '<div class="login">' +
      '<div class="top"><div class="eyebrow">Messiah Tour Canada · BVs &amp; Band</div><h1>Music <span>Room</span></h1></div>' +
      '<form class="card form" id="login-form" novalidate>' +
      '<h2>' + (signup ? "First time here" : "Sign in") + '</h2>' +
      (signup ? '<p class="muted" style="margin:0">Use the email ' + esc(CFG.adminName) + ' added to the band list, and choose a password.</p>' : '') +
      '<label class="f" for="email">Email<input id="email" type="email" autocomplete="email" required></label>' +
      '<label class="f" for="password">' + (signup ? "Choose a password" : "Password") + '<input id="password" type="password" minlength="8" autocomplete="' + (signup ? "new-password" : "current-password") + '" required></label>' +
      (msg ? '<div class="msg ' + (kind || "err") + '">' + esc(msg) + '</div>' : '') +
      '<button class="btn primary" type="submit" id="login-btn">' + (signup ? "Create my account" : "Sign in") + '</button>' +
      '<button class="linkbtn" type="button" id="mode">' + (signup ? "I already have a password" : "First time? Create your password") + '</button>' +
      '<p class="muted" style="margin:0;font-size:13px">Forgot your password? Message ' + esc(CFG.adminName) + ' to reset your account.</p>' +
      '</form></div>';
    $("#mode").onclick = function () { S.loginMode = signup ? "signin" : "signup"; renderLogin(); };
    $("#login-form").onsubmit = async function (e) {
      e.preventDefault();
      var email = $("#email").value.trim().toLowerCase(), pw = $("#password").value;
      if (!email || !pw) return renderLogin("Enter your email and password.");
      if (signup && pw.length < 8) return renderLogin("Use at least 8 characters for your password.");
      $("#login-btn").disabled = true;
      var res = signup ? await sb.auth.signUp({ email: email, password: pw }) : await sb.auth.signInWithPassword({ email: email, password: pw });
      if (res.error) {
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
  function header() {
    return '<header class="top">' +
      '<div class="topline"><div class="eyebrow">Messiah Tour Canada · BVs &amp; Band</div>' +
      '<div class="who"><span>' + esc(S.member.name || S.session.user.email) + '</span>' +
      (isAdmin() ? '<a href="#/band">Band list</a>' : '') +
      '<button class="linkbtn" id="signout">Sign out</button></div></div>' +
      '<h1>Music <span>Room</span></h1>' +
      '<div class="dates"><span><b>Edmonton</b> Fri Oct 9</span><span><b>Toronto</b> Sat Oct 10</span><span><b>Vancouver</b> Sun Oct 11</span></div>' +
      '</header>';
  }
  function bindHeader() { var b = $("#signout"); if (b) b.onclick = function () { sb.auth.signOut(); }; }

  // ---------- library ----------
  function renderList() {
    var total = S.songs.length, ready = S.songs.filter(function (s) { return status(s).cls === "ok"; }).length;
    var h = header();
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
      '<footer><span>“Ready” means stems and lyrics are in. “Partial” means some files are in.</span></footer>';
    app.innerHTML = h;
    bindHeader();
    drawList();
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
        return !q || (s.title + " " + (s.lyrics || "")).toLowerCase().indexOf(q) > -1;
      });
      if (!list.length) return; any = true;
      out += '<section class="artist"><h2>' + esc(a.name) + '</h2><div class="sub">' + a.role + ' · ' + list.length + ' song' + (list.length > 1 ? "s" : "") + '</div><ol class="songs">';
      list.forEach(function (s) {
        var st = status(s), meta = [s.key ? esc(s.key) : "", s.bpm ? s.bpm + " bpm" : ""].filter(Boolean).join(" · ");
        out += '<li><a class="row" href="#/song/' + encodeURIComponent(s.id) + '"><span class="num">' + String(all.indexOf(s) + 1).padStart(2, "0") + '</span><span class="name">' + esc(s.title) + '</span><span class="meta">' + meta + '</span><span class="pill ' + st.cls + '">' + st.text + '</span></a></li>';
      });
      out += '</ol></section>';
    });
    $("#list").innerHTML = any ? out : '<div class="none-found">No songs match “' + esc(S.q) + '”.</div>';
  }

  // ---------- song page ----------
  function renderSong(id) {
    var s = S.songs.find(function (x) { return x.id === id; });
    if (!s) { app.innerHTML = header() + '<p>That song isn’t in the library. <a href="#/">Back to all songs</a></p>'; bindHeader(); return; }
    var stems = tracksFor(id, "stem"), guides = tracksFor(id, "guide"), charts = tracksFor(id, "chart");
    var mixTracks = stems.concat(guides);
    var facts = [];
    if (s.key) facts.push("Key <b>" + esc(s.key) + "</b>");
    if (s.bpm) facts.push("BPM <b>" + esc(s.bpm) + "</b>");
    facts.push("<b>" + esc(s.artist) + "</b>");
    var h = header() +
      '<a class="back" href="#/">← All songs</a>' +
      '<div class="songhead"><h1>' + esc(s.title) + '</h1><div class="facts">' + facts.join("") + '</div></div>';

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
            '<button class="linkbtn dl" data-dl="' + esc(t.id) + '">Download</button></div>';
        }).join("") + '</div></div>';
      if (stems.length && guides.length) h += '<p class="muted" style="font-size:14px">The guide mix starts muted so it doesn’t double the stems. Unmute it to hear the full recording.</p>';
    }
    h += '</div>';

    if (charts.length) {
      h += '<div class="block"><h3>Charts</h3><div class="charts">' + charts.map(function (c) { return '<button class="btn quiet" data-chart="' + esc(c.id) + '">' + esc(c.label) + ' ↗</button>'; }).join("") + '</div></div>';
    }
    if (s.bv_notes) h += '<div class="block"><h3>BV parts &amp; cues</h3><div class="bvnotes">' + esc(s.bv_notes) + '</div></div>';
    h += '<div class="block"><h3>Lyrics</h3>' + (s.lyrics ? '<p class="lyrics">' + esc(s.lyrics) + '</p>' : '<p class="empty">Lyrics not added yet.</p>') + '</div>';

    if (isAdmin()) h += adminSongPanel(s, mixTracks.concat(charts));
    app.innerHTML = h;
    bindHeader();

    if (mixTracks.length) {
      if (mixer) mixer.destroy();
      mixer = new Mixer(mixTracks, stems.length > 0);
      mixer.start();
    }
    app.querySelectorAll("[data-dl]").forEach(function (b) { b.onclick = function () { openFile(b.dataset.dl, true); }; });
    app.querySelectorAll("[data-chart]").forEach(function (b) { b.onclick = function () { openFile(b.dataset.chart, false); }; });
    if (isAdmin()) bindAdminSong(s);
  }

  async function openFile(trackId, download) {
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
    var r = await sb.storage.from(BUCKET).createSignedUrls(this.tracks.map(function (t) { return t.meta.path; }), 6 * 3600);
    if (this.dead) return;
    if (r.error) { this.setLoad("Couldn't load the audio: " + r.error.message); return; }
    var urls = {}; r.data.forEach(function (d) { urls[d.path] = d.signedUrl; });
    this.tracks.forEach(function (t, i) {
      var el = new Audio();
      el.crossOrigin = "anonymous"; el.preload = "auto"; el.src = urls[t.meta.path];
      if ("preservesPitch" in el) el.preservesPitch = true;
      el.addEventListener("loadedmetadata", function () { self.duration = Math.max(self.duration, el.duration || 0); self.tick(true); });
      el.addEventListener("canplay", function () { if (!t.ready) { t.ready = true; self.updateLoad(); } });
      el.addEventListener("error", function () { self.setLoad("One track failed to load (" + t.meta.label + "). The rest will still play."); t.ready = true; t.broken = true; self.updateLoad(); });
      el.addEventListener("ended", function () { if (i === self.master() && !self.loopOn()) self.pause(); });
      t.el = el; el.load();
    });
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
    if (n === this.tracks.length) { this.setLoad(""); if (p) p.disabled = false; }
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
  Mixer.prototype.play = async function () {
    this.ensureGraph();
    if (this.ctx && this.ctx.state === "suspended") { try { await this.ctx.resume(); } catch (e) {} }
    var t0 = this.now();
    if (this.duration && t0 >= this.duration - 0.2) t0 = this.loopOn() ? this.loopA : 0;
    var self = this;
    this.tracks.forEach(function (t) { if (!t.broken) { t.el.playbackRate = self.rate; t.el.currentTime = t0; } });
    this.playing = true; this.setIcon();
    await Promise.all(this.tracks.map(function (t) { return t.broken ? null : t.el.play().catch(function () {}); }));
    this.loop();
  };
  Mixer.prototype.pause = function () {
    this.playing = false; this.setIcon();
    this.tracks.forEach(function (t) { if (t.el) t.el.pause(); });
    cancelAnimationFrame(this.raf); this.tick(true);
  };
  Mixer.prototype.seek = function (time) {
    time = Math.max(0, Math.min(time, this.duration || 0));
    this.tracks.forEach(function (t) { if (t.el && !t.broken) t.el.currentTime = time; });
    this.tick(true);
  };
  Mixer.prototype.setIcon = function () { var p = document.getElementById("play"); if (p) { p.innerHTML = this.playing ? ICON_PAUSE : ICON_PLAY; p.setAttribute("aria-label", this.playing ? "Pause" : "Play"); } };
  Mixer.prototype.loop = function () {
    var self = this;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(function step(ts) {
      if (!self.playing || self.dead) return;
      var now = self.now();
      if (self.loopOn() && now >= self.loopB) { self.seek(self.loopA); }
      else if (ts - self.lastSync > 700) { self.lastSync = ts; self.sync(now); }
      self.tick(false);
      self.raf = requestAnimationFrame(step);
    });
  };
  Mixer.prototype.sync = function (now) {
    var mi = this.master();
    this.tracks.forEach(function (t, i) {
      if (i === mi || t.broken || !t.el || t.el.ended) return;
      if (now > (t.el.duration || 0)) return;
      if (Math.abs(t.el.currentTime - now) > 0.06) t.el.currentTime = now;
      if (t.el.paused) t.el.play().catch(function () {});
    });
  };
  Mixer.prototype.tick = function (force) {
    var c = document.getElementById("clock"), sc = document.getElementById("scrub");
    var now = this.now();
    if (c) c.textContent = fmt(now) + " / " + fmt(this.duration);
    if (sc && !this.seeking && this.duration) sc.value = Math.round(now / this.duration * 1000);
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
    this.dead = true; this.playing = false; cancelAnimationFrame(this.raf);
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
      '<label class="f" for="a-bv">BV parts &amp; cues<textarea id="a-bv">' + esc(s.bv_notes || "") + '</textarea></label>' +
      '<label class="f" for="a-lyrics">Lyrics<textarea id="a-lyrics" style="min-height:220px">' + esc(s.lyrics || "") + '</textarea></label>' +
      '<div class="tp-row"><button class="btn primary" id="a-save">Save song details</button><span id="a-save-msg" class="muted"></span></div></div>' +
      '<hr style="border:0;border-top:1px solid var(--line);width:100%">' +
      '<div class="form"><h3 style="margin:0">Upload files</h3>' +
      '<div class="two"><label class="f" for="a-kind">What are you uploading?<select id="a-kind"><option value="stem">Stems (pick several at once)</option><option value="guide">Guide / full mix</option><option value="chart">Chord chart (PDF or image)</option></select></label>' +
      '<label class="f" for="a-files">Files<input id="a-files" type="file" multiple accept="audio/*,.pdf,image/png,image/jpeg"></label></div>' +
      '<p class="muted" style="margin:0;font-size:13px">Each file must be under 50 MB. MP3 or M4A stems keep well under that; long WAV stems often won’t fit.</p>' +
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
        var up = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || undefined, upsert: false });
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
    app.innerHTML = header() + '<a class="back" href="#/">← All songs</a>' +
      '<div class="card admin"><span class="admin-tag">Admin</span><h2>Band list</h2>' +
      '<p class="muted" style="margin:0">Only these emails can create an account and open the music. Add someone, then send them the site link; they choose their own password on first visit.</p>' +
      '<form class="form" id="add-form"><div class="two"><label class="f" for="m-name">Name<input id="m-name" placeholder="e.g. Rudo (BV alto)"></label>' +
      '<label class="f" for="m-email">Email<input id="m-email" type="email" required></label>' +
      '<label class="f" for="m-role">Access<select id="m-role"><option value="band">Band (listen &amp; download)</option><option value="admin">Admin (can upload &amp; edit)</option></select></label></div>' +
      (msg ? '<div class="msg ' + (kind || "err") + '">' + esc(msg) + '</div>' : '') +
      '<div><button class="btn primary" type="submit">Add to band list</button></div></form>' +
      '<div class="tablewrap"><table class="band"><thead><tr><th>Name</th><th>Email</th><th>Access</th><th></th></tr></thead><tbody>' +
      rows.map(function (m) {
        var me = m.email === S.session.user.email.toLowerCase();
        return '<tr><td>' + esc(m.name || "") + '</td><td>' + esc(m.email) + '</td><td>' + (m.role === "admin" ? "Admin" : "Band") + '</td><td>' + (me ? '<span class="muted">you</span>' : '<button class="btn danger" data-remove="' + esc(m.email) + '">Remove</button>') + '</td></tr>';
      }).join("") + '</tbody></table></div>' +
      '<p class="muted" style="margin:0;font-size:13px">Removing someone blocks the music for them straight away. To reset a forgotten password, delete their account under Authentication → Users in Supabase; they can then create a new password here.</p></div>';
    bindHeader();
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

  // ---------- boot ----------
  async function onSession(session) {
    S.session = session;
    if (!session) { S.member = null; render(); return; }
    try {
      await loadMember();
      if (S.member) await loadAll();
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
