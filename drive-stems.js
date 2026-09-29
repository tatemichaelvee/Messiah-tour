/* Messiah Tour Google Drive practice mixer.
   Shared Drive audio is mixed directly in the browser with native <audio>
   elements so mute, solo, level, speed, scrub and loop work without copying
   the files into GitHub. */
(function () {
  "use strict";

  function tr(label, id, kind) { return { label: label, id: id, kind: kind || "stem" }; }

  var SONGS = {
    "chiiko": [tr("Cue / stem bounce", "1tx54Du8eQRcAgWmUrQ6sxi5AnJw33VFV", "guide")],
    "bako": [tr("Cue / stem bounce", "11l-MqgOZTEi3afEwx__PNcY7Y5FZmi0c", "guide")],
    "bako rangu": [tr("Cue / stem bounce", "11l-MqgOZTEi3afEwx__PNcY7Y5FZmi0c", "guide")],
    "my declaration": [tr("Cue / stem bounce", "13FqvaLGRbk9bq4-wwspsBuRwfbf2VrRL", "guide")],
    "declaration": [tr("Cue / stem bounce", "13FqvaLGRbk9bq4-wwspsBuRwfbf2VrRL", "guide")],
    "ndinobuda": [tr("Cue / stem bounce", "1H-JlJG9ZouaDkHfqRT8q5y-Xo3yJZETv", "guide")],
    "salt": [tr("Cue / stem bounce", "1IVJL1G-z9UfwqDlDGdvAb4NopwtxlW72", "guide")],
    "salt of the earth": [tr("Cue / stem bounce", "1IVJL1G-z9UfwqDlDGdvAb4NopwtxlW72", "guide")],
    "zvichanaka": [tr("Cue / stem bounce", "1ukW85wGG4Hpf1dW5pOM2vs-QWSOm35SV", "guide")],
    "kudzai mwari": [tr("Cue / stem bounce", "10_vD7TiF2-sAdkQflRP_2tVBVpgtfroq", "guide")],
    "rarama": [tr("Cue / stem bounce", "1C97ivIwKZe38frk6FfIPExThPyPrmSbR", "guide")],
    "guta": [tr("Cue / stem bounce", "1BEA-tr9ClBAmd1IkLwEOXdjVrDWBMu9c", "guide")],
    "hakuna hama": [tr("Cue / stem bounce", "15ostq70mLyIsPBpbXFdf_mYq5me1D02A", "guide")],
    "hallelujah": [tr("Cue / stem bounce", "1nmpDQUS2EbBwsJ9GLbVt8vcexkQP-Fws", "guide")],
    "tangai neni": [tr("Cue / stem bounce", "1GCC_HqM7rQmlD3hVj1xVMrS2jBKaSnfs", "guide")],

    "makanaka jesu": [
      tr("Keys Bus", "1kjOuyzd7FBdYjo_SWhs28vLcGMgWRMKD"),
      tr("Guitar Bus", "1r4RiDOoIwt5jumwWubFOR4IJAG6TVcvx"),
      tr("Lead Guitar Move", "1_RGhQFuu69HJEdzlGHLiNfoiEw2UeZ1X"),
      tr("Click", "1m1ZnTQBXsQO1OwZoWmOavfxrVpaWwBWJ"),
      tr("Lead Guitar Spread", "1JpfL_TfNZ0-UtU6AdR6CGzl47m1Swesu"),
      tr("Sax", "1rJMb42GY3NqQ9QQwj_F07SREXo4nOuwX"),
      tr("Percussion Loop", "1jQ7ic1KEc6yv8_sDfDKwgouQWDZ14XW9")
    ],

    "my witness": [
      tr("BVs", "1aDJMKuSaKcGIk6Os_xV2kSnM23Ff5Z8x"),
      tr("Pad Bus", "1IJroy2CkTnbj_qXNctP04BiVEHIBOeoL"),
      tr("Rhythm Guitar 1", "1pEDrVvxBP9cfTAAwyhEbyzEUGe9f_sSU"),
      tr("Brass", "1mlYUGrQfV6A9bMoTI4OT0l_H7PFdGDCL"),
      tr("Rhythm Guitar 2", "1PDrQAqNVe6O0ePW-_sDapJ1X7VLfKtgs"),
      tr("Strings", "1iNz322AvooRuOE5qQ6hrZp7w7_1AVxq-"),
      tr("Percussion Loop", "1Ey67b_X5hoCVV07Joa3mHIEFLJe8A5Sz"),
      tr("Click", "1PEKgyGrx7o11eDp6Mpoj_5o4iXQkkfXi"),
      tr("Sax", "1Y-WthW5cOlJfPTmBQkhQ6oBlYAlVWHQz"),
      tr("Organ", "1POhJDW8QeVy06xgy9Pdl0ShkoJiNUkal"),
      tr("Piano", "1tnrNJDaga8nQKaq8cSxlrSxNlEJU60zi")
    ],

    "ndamuona": [
      tr("Afro Percussion", "1X6a3gU9Q46TK035uuHzS6Hhb98YmmPiN"),
      tr("All BVs", "1iplZ4sJLWUi0-Wh-gt9bcbJTx7UaYWB5"),
      tr("Brass Bus", "1-LaS0KtCP468eLz81L8R1VqDymXPkIT-"),
      tr("Click", "1-ol785NT0KgfYKJk5CQ0Q-Tgh5rHUH-z"),
      tr("Keys Bus", "1aW1maJcQCT0f_Pchpr1PaJINB3Gl6J5G"),
      tr("Lead Guitar Bus", "1wBk3oihoDaNd5-AFMvfBsOwJk_J4g2S1"),
      tr("Pad Bus", "1xE1Xb4yEllZ8CFzjAKHnTJ3gNHns23-J"),
      tr("Percussion Bus", "1CvcDSYFMSxreQSFpjm1M5e0Ts1OT_YmY"),
      tr("Piano Bus", "13grw2mERlmIMMsoB7N5yEzb5hly3AVlV"),
      tr("Strings Bus", "1ZN57WomGYp2TFppt5sHD5rsJAFDMppvg")
    ],

    "makomborero": [
      tr("Lead Guitar", "1KDzuOE1DdqT7rg4cc1GWxhnQYmoSOAS7"),
      tr("Rhythm Harmony", "1UV6LnaJ9M9NDTWj5OC88p7LtGwNTTubw"),
      tr("Rhythm Guitar 2", "1yhygyYcc63jqqxFKUhtlIJpL2STXt779"),
      tr("Rhythm Guitar", "15b5iup2LPPtGabDfSnIh10b6WaUKENf6"),
      tr("BVs", "1_bFiSkivXSBp9vCJzRpyqnN-EVbMKiek"),
      tr("Brass", "1Rfz0aW2qj4OcMLDxx4Y1A-v5k0SUPJAY"),
      tr("Percussion Loop", "1wb2ik1jnAS3TN_uVMyyVaPfWIjGj4gJz"),
      tr("Click", "1zxlEGeg2O0u4z52gL-zSFxVaXVq8cO9w"),
      tr("Strings", "1geglj4gthS8Xw_qHvN9dvVQ5WZ2EU_KY")
    ],

    "mumoyo": [
      tr("Click", "1ueUVuoD1H6ydxXmKlwHUCR_7ONG2IsG3"),
      tr("Guitars Bus", "1kXxtGki6w3m5b9qA4bISKC2Jm0qY09ao"),
      tr("Keys Bus", "1GHE6VkteQGkPImIyC_x8qrYZzpCFExGc"),
      tr("Lead Guitar", "16tOQnbF4Rouquwj-seJc-3fPLQ_eGtBQ"),
      tr("Loop", "1iLdPqJnExR73aaCGQZiFt7AwCOGRVa3p"),
      tr("Studio Guitar 2", "17k2JbzPcDM3j5NRfmF1WLmyXsxgS4t2U"),
      tr("BV Bus", "1_aYjlxT8dWMvP8dMqfS3YjAyXYhRywnj")
    ],

    "tawanirwa nyasha": [
      tr("All BVs", "1PlqL-4zynzWO3ln14QQ8l3x82Gh4Cnbo"),
      tr("Clean Guitar Bus", "1cLm0O_3ib1R1zaPMHWuVS3bWzQb_6Xof"),
      tr("Click", "1D3mZGJ1f0-q-tqLfYQRpL_eUevONAv-Y"),
      tr("Keys", "1E0NsC0y7k5pWSwM4IJXDx_ufr2lD9ZF-"),
      tr("Pad", "1QxyV3PVFNleai8VNUpflx6BFj4RpSBAq"),
      tr("Percussion", "10tVO58QTAJ_hrzCJ-miK5KeOUOF5W9xh"),
      tr("Sax Bus", "18Dx1dD1_Thm4XsTbD2LEh-w6wvoPdB4L"),
      tr("Strings Bus", "1cYq84XT-qW6ReLGcdF-yNxABLKQh-4BW"),
      tr("Trumpet Section", "1v1ajvw3oi4w0XC0DXn8QPrNUnnP7rRMe")
    ],
    "tawanirwe nyasha": [
      tr("All BVs", "1PlqL-4zynzWO3ln14QQ8l3x82Gh4Cnbo"),
      tr("Clean Guitar Bus", "1cLm0O_3ib1R1zaPMHWuVS3bWzQb_6Xof"),
      tr("Click", "1D3mZGJ1f0-q-tqLfYQRpL_eUevONAv-Y"),
      tr("Keys", "1E0NsC0y7k5pWSwM4IJXDx_ufr2lD9ZF-"),
      tr("Pad", "1QxyV3PVFNleai8VNUpflx6BFj4RpSBAq"),
      tr("Percussion", "10tVO58QTAJ_hrzCJ-miK5KeOUOF5W9xh"),
      tr("Sax Bus", "18Dx1dD1_Thm4XsTbD2LEh-w6wvoPdB4L"),
      tr("Strings Bus", "1cYq84XT-qW6ReLGcdF-yNxABLKQh-4BW"),
      tr("Trumpet Section", "1v1ajvw3oi4w0XC0DXn8QPrNUnnP7rRMe")
    ],

    "mweya mutsvene": [tr("Stem / cue bounce", "1ZD30hB8T-bDwcFH7wSNSDhanl3nX4sp0", "guide")],
    "ndinokuda mweya mutsvene": [tr("Stem / cue bounce", "1ZD30hB8T-bDwcFH7wSNSDhanl3nX4sp0", "guide")],
    "messiah": [tr("Stem / cue bounce", "1jpU6MMMpBbvzn66r6buloH10QL-xjrfz", "guide")]
  };

  function norm(s) {
    return String(s || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  }

  function tracksForTitle(title) {
    var n = norm(title);
    if (SONGS[n]) return SONGS[n];
    var keys = Object.keys(SONGS);
    for (var i = 0; i < keys.length; i++) {
      if (n.indexOf(keys[i]) !== -1 || keys[i].indexOf(n) !== -1) return SONGS[keys[i]];
    }
    return null;
  }

  function url(id) {
    return "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(id);
  }
  function fmt(t) {
    if (!isFinite(t) || t < 0) t = 0;
    var m = Math.floor(t / 60), s = Math.floor(t % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  var PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>';
  var PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z" fill="currentColor"/></svg>';

  var active = null;

  function DriveMixer(meta, host) {
    this.meta = meta;
    this.host = host;
    this.tracks = [];
    this.duration = 0;
    this.playing = false;
    this.rate = 1;
    this.loopA = null;
    this.loopB = null;
    this.raf = 0;
    this.seeking = false;
  }

  DriveMixer.prototype.build = function () {
    var self = this;
    var rows = this.meta.map(function (t, i) {
      return '<div class="trk" data-dm-i="' + i + '">' +
        '<span class="tname"><span class="tkind">' + (t.kind === "guide" ? "Guide mix" : "Drive stem") + '</span>' + t.label + '</span>' +
        '<span class="ms"><button class="m" data-dm-mute="' + i + '" aria-pressed="false">M</button><button class="s" data-dm-solo="' + i + '" aria-pressed="false">S</button></span>' +
        '<input type="range" min="0" max="1" step="0.01" value="1" data-dm-vol="' + i + '" aria-label="Volume ' + t.label.replace(/"/g, "&quot;") + '">' +
        '<span class="dl" aria-hidden="true"></span></div>';
    }).join("");

    this.host.innerHTML = '<h3>Practice mixer</h3><div class="desk">' +
      '<div class="transport"><div class="tp-row"><button class="play" data-dm-play aria-label="Play" disabled>' + PLAY + '</button>' +
      '<span class="clock" data-dm-clock>0:00 / 0:00</span><input class="scrub" data-dm-scrub type="range" min="0" max="1000" value="0" step="1" aria-label="Position"></div>' +
      '<div class="tp-row"><span class="tp-label">Speed</span><span class="seg" data-dm-speed>' +
      [0.75, 0.9, 1].map(function (v) { return '<button data-dm-rate="' + v + '" aria-pressed="' + (v === 1) + '">' + (v === 1 ? '1×' : v + '×') + '</button>'; }).join("") +
      '</span><span class="tp-label">Loop</span><span class="seg"><button data-dm-a>Set A</button><button data-dm-b>Set B</button><button data-dm-clear>Clear</button></span><span class="loopinfo" data-dm-loopinfo></span></div>' +
      '<div class="loadbar" data-dm-load>Loading Drive stems…</div></div><div class="tracks">' + rows + '</div></div>' +
      '<p class="muted" style="font-size:13px">These tracks stream from the shared Messiah Tour Google Drive folder. M = mute, S = solo.</p>';

    this.meta.forEach(function (m, i) {
      var a = new Audio();
      a.preload = "metadata";
      a.src = url(m.id);
      var t = { el: a, vol: 1, mute: false, solo: false, ready: false, broken: false };
      self.tracks.push(t);
      a.addEventListener("loadedmetadata", function () {
        self.duration = Math.max(self.duration, a.duration || 0);
        t.ready = true; self.updateLoad(); self.tick();
      });
      a.addEventListener("canplay", function () { t.ready = true; self.updateLoad(); });
      a.addEventListener("error", function () { t.broken = true; t.ready = true; self.updateLoad(); });
      a.addEventListener("ended", function () { if (i === self.master() && !self.loopOn()) self.pause(); });
      a.load();
    });
    this.bind();
  };

  DriveMixer.prototype.master = function () {
    var best = 0, d = -1;
    this.tracks.forEach(function (t, i) { if (!t.broken && (t.el.duration || 0) > d) { d = t.el.duration || 0; best = i; } });
    return best;
  };
  DriveMixer.prototype.now = function () { var t = this.tracks[this.master()]; return t ? t.el.currentTime || 0 : 0; };
  DriveMixer.prototype.loopOn = function () { return this.loopA != null && this.loopB != null && this.loopB > this.loopA; };
  DriveMixer.prototype.updateLoad = function () {
    var n = this.tracks.filter(function (t) { return t.ready; }).length;
    var broken = this.tracks.filter(function (t) { return t.broken; }).length;
    var load = this.host.querySelector("[data-dm-load]");
    var play = this.host.querySelector("[data-dm-play]");
    if (n === this.tracks.length) {
      if (load) { load.textContent = broken ? broken + " Drive track" + (broken === 1 ? "" : "s") + " couldn't load; the others can still play." : ""; load.hidden = !broken; }
      if (play && n > broken) play.disabled = false;
    } else if (load) load.textContent = "Loading Drive stems… " + n + " of " + this.tracks.length;
  };
  DriveMixer.prototype.apply = function () {
    var solo = this.tracks.some(function (t) { return t.solo; });
    var self = this;
    this.tracks.forEach(function (t, i) {
      var audible = solo ? t.solo : !t.mute;
      t.el.muted = !audible;
      t.el.volume = t.vol;
      var row = self.host.querySelector('[data-dm-i="' + i + '"]');
      if (row) {
        row.classList.toggle("silent", !audible);
        row.querySelector("[data-dm-mute]").setAttribute("aria-pressed", String(t.mute));
        row.querySelector("[data-dm-solo]").setAttribute("aria-pressed", String(t.solo));
      }
    });
  };
  DriveMixer.prototype.play = function () {
    var self = this, t0 = this.now();
    if (this.duration && t0 >= this.duration - 0.2) t0 = this.loopOn() ? this.loopA : 0;
    this.tracks.forEach(function (t) {
      if (t.broken) return;
      t.el.playbackRate = self.rate;
      try { t.el.currentTime = t0; } catch (e) {}
      t.el.play().catch(function () {});
    });
    this.playing = true; this.icon(); this.loop();
  };
  DriveMixer.prototype.pause = function () {
    this.playing = false; this.icon(); cancelAnimationFrame(this.raf);
    this.tracks.forEach(function (t) { t.el.pause(); }); this.tick();
  };
  DriveMixer.prototype.seek = function (v) {
    var self = this;
    this.tracks.forEach(function (t) { if (!t.broken) { try { t.el.currentTime = Math.max(0, Math.min(v, t.el.duration || self.duration || 0)); } catch (e) {} } });
    this.tick();
  };
  DriveMixer.prototype.sync = function () {
    var n = this.now(), mi = this.master();
    this.tracks.forEach(function (t, i) {
      if (i === mi || t.broken || n > (t.el.duration || 0)) return;
      if (Math.abs((t.el.currentTime || 0) - n) > 0.09) { try { t.el.currentTime = n; } catch (e) {} }
      if (t.el.paused) t.el.play().catch(function () {});
    });
  };
  DriveMixer.prototype.loop = function () {
    var self = this, last = 0;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(function step(ts) {
      if (!self.playing) return;
      var n = self.now();
      if (self.loopOn() && n >= self.loopB) self.seek(self.loopA);
      else if (ts - last > 700) { last = ts; self.sync(); }
      self.tick(); self.raf = requestAnimationFrame(step);
    });
  };
  DriveMixer.prototype.tick = function () {
    var n = this.now(), c = this.host.querySelector("[data-dm-clock]"), s = this.host.querySelector("[data-dm-scrub]");
    if (c) c.textContent = fmt(n) + " / " + fmt(this.duration);
    if (s && !this.seeking && this.duration) s.value = Math.round(n / this.duration * 1000);
    var li = this.host.querySelector("[data-dm-loopinfo]");
    if (li) li.textContent = this.loopA != null ? "A " + fmt(this.loopA) + (this.loopB != null ? " → B " + fmt(this.loopB) : "") : "";
  };
  DriveMixer.prototype.icon = function () {
    var p = this.host.querySelector("[data-dm-play]");
    if (p) { p.innerHTML = this.playing ? PAUSE : PLAY; p.setAttribute("aria-label", this.playing ? "Pause" : "Play"); }
  };
  DriveMixer.prototype.bind = function () {
    var self = this;
    this.host.querySelector("[data-dm-play]").onclick = function () { self.playing ? self.pause() : self.play(); };
    var scrub = this.host.querySelector("[data-dm-scrub]");
    scrub.oninput = function () { self.seeking = true; var c = self.host.querySelector("[data-dm-clock]"); if (c) c.textContent = fmt(scrub.value / 1000 * self.duration) + " / " + fmt(self.duration); };
    scrub.onchange = function () { self.seeking = false; self.seek(scrub.value / 1000 * self.duration); };
    this.host.querySelectorAll("[data-dm-rate]").forEach(function (b) { b.onclick = function () {
      self.rate = parseFloat(b.dataset.dmRate);
      self.host.querySelectorAll("[data-dm-rate]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      self.tracks.forEach(function (t) { t.el.playbackRate = self.rate; });
    }; });
    this.host.querySelector("[data-dm-a]").onclick = function () { self.loopA = self.now(); if (self.loopB != null && self.loopB <= self.loopA) self.loopB = null; self.tick(); };
    this.host.querySelector("[data-dm-b]").onclick = function () { var n = self.now(); if (self.loopA == null || n <= self.loopA) return; self.loopB = n; self.seek(self.loopA); };
    this.host.querySelector("[data-dm-clear]").onclick = function () { self.loopA = self.loopB = null; self.tick(); };
    this.host.querySelectorAll("[data-dm-mute]").forEach(function (b) { b.onclick = function () { var t = self.tracks[+b.dataset.dmMute]; t.mute = !t.mute; self.apply(); }; });
    this.host.querySelectorAll("[data-dm-solo]").forEach(function (b) { b.onclick = function () { var t = self.tracks[+b.dataset.dmSolo]; t.solo = !t.solo; self.apply(); }; });
    this.host.querySelectorAll("[data-dm-vol]").forEach(function (r) { r.oninput = function () { self.tracks[+r.dataset.dmVol].vol = parseFloat(r.value); self.apply(); }; });
  };
  DriveMixer.prototype.destroy = function () {
    this.pause();
    this.tracks.forEach(function (t) { t.el.removeAttribute("src"); try { t.el.load(); } catch (e) {} });
  };

  function inject() {
    var title = document.querySelector(".songhead h1");
    var col = document.querySelector(".songgrid .col-main");
    if (!title || !col) { if (active) { active.destroy(); active = null; } return; }
    var meta = tracksForTitle(title.textContent);
    if (!meta || !meta.length) return;
    var currentKey = norm(title.textContent);
    var existing = document.getElementById("drive-practice-mixer");
    if (existing && existing.dataset.song === currentKey) return;
    if (active) { active.destroy(); active = null; }
    if (existing) existing.remove();

    var original = col.querySelector(".block");
    if (original) original.style.display = "none";

    var block = document.createElement("div");
    block.className = "block";
    block.id = "drive-practice-mixer";
    block.dataset.song = currentKey;
    if (original) col.insertBefore(block, original);
    else col.prepend(block);
    active = new DriveMixer(meta, block);
    active.build();
  }

  var observer = new MutationObserver(function () { setTimeout(inject, 0); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("hashchange", function () { if (active) { active.destroy(); active = null; } setTimeout(inject, 50); });
  inject();
})();
