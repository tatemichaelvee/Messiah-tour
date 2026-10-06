/* Schedule tab: the tour week, rehearsal plan, each show night and set times.
   Data lives in schedule-data.js (window.MT_SCHEDULE); songs and sets come from the portal. */
(function () {
  "use strict";
  var COLORS = ["#D9A21B", "#C8102E", "#2F6F8F", "#9C3D7A", "#7A0A1A"]; // set colours, in running order
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  // ---------- time helpers ----------
  function toMin(t) { if (!t) return null; var p = t.split(":"); return +p[0] * 60 + +p[1]; }
  function clock(min) {
    min = Math.round(min);
    var h = Math.floor(min / 60) % 24, m = min % 60;
    if (h === 0 && m === 0) return "midnight";
    if (h === 12 && m === 0) return "noon";
    return (h % 12 || 12) + ":" + (m < 10 ? "0" : "") + m + (h < 12 ? " am" : " pm");
  }
  // whole hours without ":00" ("10 am", "6:30 pm"); midnight stays a word
  function hour(min) { var c = clock(min); return c === "noon" ? "12 pm" : c.replace(":00", ""); }
  // "10 am–6 pm", "12–2 pm" (drops a repeated am/pm)
  function span(a, b) {
    var A = hour(a), B = hour(b), sa = A.slice(-3), sb = B.slice(-3);
    if ((sa === " am" || sa === " pm") && sa === sb) A = A.slice(0, -3);
    return A + "–" + B;
  }
  function mmss(sec) {
    sec = Math.round(sec);
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }
  function hm(sec) {
    var m = Math.round(sec / 60), h = Math.floor(m / 60);
    return h ? h + " h" + (m % 60 ? " " + (m % 60) + " min" : "") : m + " min";
  }
  function dateOf(iso) { var p = iso.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function todayIso() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function dayParts(iso) {
    var d = dateOf(iso);
    return { wd: d.toLocaleDateString("en-CA", { weekday: "short" }), wdl: d.toLocaleDateString("en-CA", { weekday: "long" }), dd: d.getDate(), mon: d.toLocaleDateString("en-CA", { month: "short" }) };
  }
  function daysUntil(iso) { return Math.round((dateOf(iso) - dateOf(todayIso())) / 86400000); }

  // ---------- the running order, from the portal's songs and sets ----------
  function build(ctx) {
    var D = window.MT_SCHEDULE;
    var sets = ctx.sets.slice().sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); })
      .map(function (st) { return { st: st, songs: ctx.songs.filter(function (s) { return s.set_no === st.no; }).sort(function (a, b) { return (a.set_pos || 0) - (b.set_pos || 0); }) }; })
      .filter(function (x) { return x.songs.length; });
    var titles = sets.map(function (x) { return x.st.title.replace(/^Opening set:\s*/i, ""); });
    sets.forEach(function (x, i) {
      var t = titles[i], dup = titles.filter(function (y) { return y === t; }).length > 1;
      x.name = dup ? t + (titles.indexOf(t) === i ? " (first set)" : " (closing set)") : t;
      x.color = COLORS[i % COLORS.length];
      x.rows = x.songs.map(function (s) {
        var e = D.songs[s.id];
        return { id: s.id, title: s.title, sec: e ? e[0] : D.estimateSeconds, how: e ? e[1] : "estimate", note: e && e[2] || "" };
      });
      x.music = x.rows.reduce(function (a, r) { return a + r.sec; }, 0);
      x.total = x.music + D.songGap * Math.max(0, x.rows.length - 1);
      x.est = x.rows.filter(function (r) { return r.how === "estimate"; }).length;
      x.after = i < sets.length - 1 ? (D.setGapAfter[x.st.no] != null ? D.setGapAfter[x.st.no] : D.setGap) : 0;
      x.afterLabel = D.changeoverLabel[x.st.no] || "Handover, band stays on stage";
    });
    var show = sets.reduce(function (a, x) { return a + x.total + x.after; }, 0);
    return { D: D, sets: sets, show: show, music: sets.reduce(function (a, x) { return a + x.music; }, 0) };
  }
  // the night as a list of timed items, in minutes from midnight (or from 0 when the start isn't set)
  function night(R, day) {
    var t = toMin(day.start) || 0, items = [];
    (day.before || []).forEach(function (b) {
      items.push({ kind: "talk", label: b.label, from: t, len: b.min * 60, color: "#5E6B72" });
      t += b.min;
    });
    if (day.opener) {
      var om = day.opener.min;
      items.push({ kind: "opener", label: "Opening act: " + day.opener.name + (day.opener.range ? " (" + day.opener.range + ")" : "") + (day.opener.confirm ? " (to confirm)" : ""), from: t, len: om ? om * 60 : 0, color: "#8A8386", noLen: !om });
      t += om || 0;
    }
    R.sets.forEach(function (x) {
      items.push({ kind: "set", label: x.name, from: t, len: x.total, color: x.color });
      t += x.total / 60;
      if (x.after) { items.push({ kind: "gap", label: x.after >= 120 ? x.afterLabel : "Handover, band stays on stage", from: t, len: x.after }); t += x.after / 60; }
    });
    return { items: items, end: t, known: !!day.start };
  }

  // ---------- pieces ----------
  // A day's fixed timeline ({at, to} in "HH:MM", or {when} as free text) and notes.
  function timeline(d) {
    var tl = (d.timeline || []).map(function (e) {
      var t = e.at ? (e.to ? span(toMin(e.at), toMin(e.to)) : hour(toMin(e.at))) : (e.when || "");
      return '<li><span class="t">' + esc(t) + '</span><span class="what">' + esc(e.label) + (e.sub ? '<small>' + esc(e.sub) + '</small>' : '') + '</span></li>';
    }).join("");
    var notes = (d.notes || []).map(function (n) { return '<li>' + esc(n) + '</li>'; }).join("");
    return (tl ? '<ol class="sc-tl">' + tl + '</ol>' : '') + (notes ? '<ul class="sc-notes">' + notes + '</ul>' : '');
  }
  function weekStrip(R) {
    var today = todayIso(), nextId = null;
    R.D.days.some(function (d) { if (d.day >= today) { nextId = d.id; return true; } return false; });
    return '<nav class="sc-week" aria-label="Tour week">' + R.D.days.map(function (d) {
      var p = dayParts(d.day), n = daysUntil(d.day);
      var when = n < 0 ? "Done" : n === 0 ? "Today" : n === 1 ? "Tomorrow" : "In " + n + " days";
      var key = d.kind === "show" ? (d.start ? "Starts " + clock(toMin(d.start)) : "Doors " + clock(toMin(d.doors))) : span(toMin(d.start), toMin(d.end));
      return '<button type="button" class="sc-day ' + d.kind + (d.id === nextId ? ' next' : '') + (n < 0 ? ' past' : '') + (d.theme ? ' th-' + d.theme : '') + '" data-goto="' + esc(d.id) + '">' +
        '<span class="sc-day-date"><b>' + p.dd + '</b><span>' + p.wd + '</span></span>' +
        '<span class="sc-day-what"><b>' + esc(d.kind === "show" ? d.city : "Rehearsal") + '</b><span>' + esc(key) + '</span></span>' +
        '<span class="sc-day-when">' + when + '</span></button>';
    }).join("") + '</nav>';
  }

  function rehearsalCard(R, d) {
    if (d.timeline) {
      var q = dayParts(d.day);
      return '<article class="sc-reh" id="sc-' + esc(d.id) + '">' +
        '<header><div class="sc-reh-date"><b>' + q.wdl + ' ' + q.dd + ' ' + q.mon + '</b><span>' + esc(d.who) + '</span></div>' +
        '<div class="sc-reh-hours">' + span(toMin(d.start), toMin(d.end)) + '</div></header>' +
        timeline(d) + (d.note ? '<p class="sc-note">' + esc(d.note) + '</p>' : '') +
        '<p class="sc-where">' + esc(d.venue) + ', ' + esc(d.city) + '</p></article>';
    }
    var booked = (toMin(d.end) - toMin(d.start)) * 60;
    var blocks = d.plan.map(function (b) {
      if (b.set != null) { var x = R.sets.filter(function (y) { return y.st.no === b.set; })[0]; return x ? { label: x.name, sub: "Work through the set", sec: 2 * x.music, color: x.color } : null; }
      if (b.run) return { label: "Full run, no stops", sub: "The whole show, start to finish", sec: R.show, color: "#161213" };
      return { label: b.label, sub: "", sec: b.min * 60, color: "#B9AFB1" };
    }).filter(Boolean);
    var used = blocks.reduce(function (a, b) { return a + b.sec; }, 0), spare = booked - used;
    var p = dayParts(d.day);
    return '<article class="sc-reh" id="sc-' + esc(d.id) + '">' +
      '<header><div class="sc-reh-date"><b>' + p.wdl + ' ' + p.dd + ' ' + p.mon + '</b><span>' + esc(d.who) + '</span></div>' +
      '<div class="sc-reh-hours">' + span(toMin(d.start), toMin(d.end)) + '</div></header>' +
      '<div class="sc-bar" role="img" aria-label="' + hm(used) + ' planned of ' + hm(booked) + ' booked">' +
      blocks.map(function (b) { return '<span style="flex:' + b.sec + ';background:' + b.color + '" title="' + esc(b.label) + ' ' + mmss(b.sec) + '"></span>'; }).join("") +
      (spare > 0 ? '<span class="spare" style="flex:' + spare + '" title="Spare ' + hm(spare) + '"></span>' : '') + '</div>' +
      '<ol class="sc-plan">' + blocks.map(function (b) {
        return '<li><i style="background:' + b.color + '"></i><span>' + esc(b.label) + (b.sub ? '<small>' + esc(b.sub) + '</small>' : '') + '</span><b>' + hm(b.sec) + '</b></li>';
      }).join("") +
      '<li class="sum"><i class="spare"></i><span>' + (spare >= 0 ? 'Spare time' : 'Over the booking') + '</span><b>' + hm(Math.abs(spare)) + '</b></li></ol>' +
      (d.note ? '<p class="sc-note">' + esc(d.note) + '</p>' : '') +
      '<p class="sc-where">' + esc(d.venue) + ', ' + esc(d.city) + '</p></article>';
  }

  function ribbon(N, day) {
    var start = N.items[0].from, end = N.end, fin = toMin(day.finishBy);
    var stop = Math.max(end, fin || 0) + 5, len = stop - start;
    var pct = function (m) { return ((m - start) / len * 100).toFixed(3) + "%"; };
    var ticks = [], h = Math.ceil(start / 60) * 60;
    for (; h <= stop; h += 60) if (h !== fin) ticks.push('<span class="tick" style="left:' + pct(h) + '">' + clock(h).replace(":00", "") + '</span>');
    var segs = N.items.filter(function (it) { return it.len; }).map(function (it) {
      return '<span class="seg ' + it.kind + '" style="left:' + pct(it.from) + ';width:' + ((it.len / 60) / len * 100).toFixed(3) + '%' + (it.color ? ';background:' + it.color : '') + '" title="' + esc(it.label) + ' ' + mmss(it.len) + '"></span>';
    }).join("");
    var finMark = fin ? '<span class="fin" style="left:' + pct(fin) + '"><span>Finish by ' + clock(fin) + '</span></span>' : '';
    var margin = fin ? fin - end : null;
    return '<div class="sc-ribbon" role="img" aria-label="The night from ' + clock(start) + ' to about ' + clock(end) + (fin ? ', finish by ' + clock(fin) : '') + '">' +
      '<div class="ticks">' + ticks.join("") + '</div><div class="lane">' + segs + finMark + '</div></div>' +
      (fin ? '<p class="sc-margin ' + (margin < 0 ? 'over' : margin < 30 ? 'tight' : 'ok') + '">' +
        (margin < 0 ? 'Runs ' + hm(-margin * 60) + ' past the finish time.' : 'Ends about ' + clock(end) + ', ' + hm(margin * 60) + ' before ' + clock(fin) + '. MC links, offering and preaching have to fit in that.') + '</p>' : '');
  }

  var bust = {};
  function posterSrc(ctx, d) { return ctx.cfg.supabaseUrl + "/storage/v1/object/public/site-assets/" + d.poster + "?v=" + (bust[d.id] || ctx.cfg.posterV || "1"); }
  function posterBlock(ctx, d, p) {
    var alt = "Messiah Tour Canada " + d.city + " poster: Minister Michael Mahendere and Vimbai Mahendere, " + p.wdl + " " + p.dd + " " + p.mon + " at " + d.venue;
    return '<figure class="sc-poster">' +
      '<img src="' + esc(posterSrc(ctx, d)) + '" alt="' + esc(alt) + '" loading="lazy" data-poster="' + esc(d.id) + '">' +
      '<div class="sc-poster-alt" hidden aria-hidden="true"><span class="a1">Messiah</span><span class="a2">tour</span><span class="a3">Canada</span><span class="a4">' + esc(d.city) + '</span></div>' +
      (ctx.isAdmin ? '<label class="sc-up">Upload poster<input type="file" accept="image/jpeg,image/png,image/webp" data-up="' + esc(d.id) + '" hidden></label><span class="sc-up-msg" data-upmsg="' + esc(d.id) + '"></span>' : '') +
      '</figure>';
  }
  function showCard(R, d, ctx) {
    var p = dayParts(d.day), N = night(R, d);
    var facts = [];
    if (d.soundcheck) facts.push(["Soundcheck", span(toMin(d.soundcheck[0]), toMin(d.soundcheck[1]))]);
    if (d.doors) facts.push(["Doors open", clock(toMin(d.doors))]);
    if (d.call) facts.push(["Band call", clock(toMin(d.call)) + (d.callCheck && toMin(d.call) > toMin(d.doors) ? '<small>After doors open: confirm</small>' : '')]);
    facts.push(["Show starts", d.start ? clock(toMin(d.start)) : '<span class="tbc">To confirm</span>']);
    if (d.finishBy) facts.push(["Finish by", clock(toMin(d.finishBy))]);
    var map = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(d.venue + ", " + d.address);
    var rows = N.items.map(function (it) {
      var t = N.known ? clock(it.from) : "+" + mmss((it.from - N.items[0].from) * 60);
      return '<li class="' + it.kind + '"><span class="t">' + t + '</span><i' + (it.color ? ' style="background:' + it.color + '"' : '') + '></i><span class="what">' + esc(it.label) + '</span><span class="len">' + (it.noLen ? 'Length to confirm' : mmss(it.len)) + '</span></li>';
    }).join("");
    if (N.known) rows += '<li class="end"><span class="t">' + clock(N.end) + '</span><i></i><span class="what">Last song ends</span><span class="len"></span></li>';
    return '<article class="sc-show th-' + esc(d.theme) + '" id="sc-' + esc(d.id) + '">' +
      (d.poster ? posterBlock(ctx, d, p) : '') +
      '<div class="sc-show-body">' +
      '<header class="sc-show-head"><p class="sc-city">' + esc(d.city) + '</p>' +
      '<h2 class="sc-date">' + p.wd + ' ' + p.dd + ' ' + p.mon + '</h2>' +
      '<p class="sc-venue">' + esc(d.venue) + '</p>' +
      '<p class="sc-addr">' + esc(d.address) + ' <a href="' + map + '" target="_blank" rel="noopener">Open in Maps</a></p></header>' +
      '<dl class="sc-facts">' + facts.map(function (f) { return '<div><dt>' + f[0] + '</dt><dd>' + f[1] + '</dd></div>'; }).join("") + '</dl>' +
      (d.timeline || d.notes ? '<div class="sc-dayplan"><h3>Day plan</h3>' + timeline(d) + '</div>' : '') +
      (N.known ? ribbon(N, d) : '<p class="sc-margin">Start time not confirmed yet, so the run of show below counts from the first act. The music runs about ' + hm(R.show) + '.</p>') +
      '<details class="sc-ros"' + (N.known ? ' open' : '') + '><summary>Run of show</summary><ol>' + rows + '</ol></details>' +
      '</div></article>';
  }

  function setTimes(R) {
    var max = Math.max.apply(null, R.sets.map(function (x) { return Math.max.apply(null, x.rows.map(function (r) { return r.sec; })); }));
    var HOW = { stems: "stems", guide: "guide mix", reference: "reference track", estimate: "estimate, no audio yet" };
    return R.sets.map(function (x, i) {
      return '<details class="sc-set"' + (i === 0 ? ' open' : '') + ' style="--c:' + x.color + '"><summary><span class="sw"></span><span class="nm">' + esc(x.name) + '</span>' +
        '<span class="ct">' + x.rows.length + ' songs' + (x.est ? ', ' + x.est + ' estimated' : '') + '</span><span class="tt">' + mmss(x.total) + '</span></summary>' +
        '<ol>' + x.rows.map(function (r) {
          return '<li><span class="nm">' + esc(r.title) + (r.note ? '<small>' + esc(r.note) + '</small>' : '') + '</span>' +
            '<span class="ln"><span style="width:' + (r.sec / max * 100).toFixed(1) + '%"' + (r.how === "estimate" ? ' class="est"' : '') + '></span></span>' +
            '<span class="tm">' + mmss(r.sec) + (r.how === "estimate" ? '<small>est.</small>' : '') + '</span>' +
            '<span class="how">' + HOW[r.how] + '</span></li>';
        }).join("") + '</ol></details>';
    }).join("");
  }

  // ---------- page ----------
  function render(box, ctx) {
    if (!window.MT_SCHEDULE) { box.innerHTML = '<div class="sheet"><p>The schedule didn’t load. Refresh the page to try again.</p></div>'; return; }
    var R = build(ctx), D = R.D;
    var reh = D.days.filter(function (d) { return d.kind === "rehearsal"; }), shows = D.days.filter(function (d) { return d.kind === "show"; });
    var est = R.sets.reduce(function (a, x) { return a + x.est; }, 0);
    box.innerHTML =
      '<section class="sc-hero"><h1>Show <span>week</span></h1>' +
      '<p class="sc-lede">Two rehearsal days, then three cities in three nights. The music runs about <b>' + hm(R.show) + '</b> a night.</p>' +
      weekStrip(R) + '</section>' +
      '<section class="sheet sc-sec"><h2 class="sc-h">Rehearsals</h2><p class="sc-sub">' + esc(reh[0] ? reh[0].venue + ", " + reh[0].city : "") + '. Working time is twice each set’s music, to stop, fix and run sections again.</p>' +
      '<div class="sc-reh-grid">' + reh.map(function (d) { return rehearsalCard(R, d); }).join("") + '</div></section>' +
      shows.map(function (d) { return '<section class="sc-sec">' + showCard(R, d, ctx) + '</section>'; }).join("") +
      '<section class="sheet sc-sec" id="sc-sets"><h2 class="sc-h">Set times</h2><p class="sc-sub">' + R.sets.length + ' sets, ' + R.sets.reduce(function (a, x) { return a + x.rows.length; }, 0) + ' songs, ' + hm(R.music) + ' of music. Each set’s time includes ' + D.songGap + ' seconds between songs.</p>' +
      setTimes(R) +
      '<p class="sc-foot">Song lengths come from each song’s audio on the portal (stems with silence trimmed, or the guide or reference track). ' + (est ? est + ' songs have no audio yet and are set at ' + mmss(D.estimateSeconds) + '. ' : '') + 'Tickets: ' + esc(D.tickets) + '. Updated ' + esc(dayParts(D.updated).wdl + ' ' + dayParts(D.updated).dd + ' ' + dayParts(D.updated).mon) + '.</p></section>';
    // a poster that isn't uploaded yet shows the city panel instead
    box.querySelectorAll("img[data-poster]").forEach(function (img) {
      var fall = function () { img.hidden = true; img.nextElementSibling.hidden = false; img.closest(".sc-poster").classList.add("empty"); };
      img.addEventListener("error", fall);
      if (img.complete && !img.naturalWidth) fall();
    });
    box.querySelectorAll("input[data-up]").forEach(function (inp) {
      inp.onchange = async function () {
        var f = inp.files && inp.files[0], d = D.days.filter(function (x) { return x.id === inp.dataset.up; })[0];
        var msg = box.querySelector('[data-upmsg="' + d.id + '"]');
        if (!f) return;
        if (f.size > 10 * 1048576) { msg.textContent = "That image is over 10 MB. Use a smaller one."; return; }
        msg.textContent = "Uploading…";
        var up = await ctx.sb.storage.from("site-assets").upload(d.poster, f, { contentType: f.type, upsert: true, cacheControl: "300" });
        if (up.error) { msg.textContent = "Couldn’t upload: " + up.error.message; return; }
        bust[d.id] = String(Date.now());
        render(box, ctx);
      };
    });
    box.querySelectorAll("[data-goto]").forEach(function (b) {
      b.onclick = function () { var el = document.getElementById("sc-" + b.dataset.goto); if (el) el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); };
    });
  }
  window.MTSchedule = { render: render, _build: build, _night: night };
  window.MTPages = window.MTPages || {};
  window.MTPages.schedule = { nav: "Schedule", cls: "sched", render: render };
})();
