/* Waveforms for the practice mixer.
   Measures how loud a track is at 300 points through the song without downloading the
   whole file: WAVs are read straight from small byte ranges, MP3s by decoding short
   slices, anything else (M4A) by decoding the whole (small) file at a low sample rate.
   The result is 300 bytes per track, saved once in the database for everyone. */
(function () {
  "use strict";
  var B = 300;                 // points per track
  var WAV_WIN = 0.08;          // seconds read at each WAV point
  var MP3_WIN = 14000;         // bytes decoded at each MP3 point
  var FULL_MAX = 80 * 1048576; // decode whole files only up to this size

  function str(dv, p, n) { var s = ""; for (var i = 0; i < n; i++) s += String.fromCharCode(dv.getUint8(p + i)); return s; }
  function extOf(name) { var m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/); return m ? m[1] : ""; }

  // readers: read(start, end) -> ArrayBuffer of bytes [start, end)
  function fileReader(file) {
    return { size: file.size, name: file.name, read: function (s, e) { return file.slice(s, e).arrayBuffer(); } };
  }
  function urlReader(url, size, name) {
    var rd = { size: size || 0, name: name, read: async function (s, e) {
      var r = await fetch(url, { headers: { Range: "bytes=" + s + "-" + (e - 1) } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      var cr = r.headers.get("Content-Range"), m = cr && cr.match(/\/(\d+)\s*$/);
      if (m) rd.size = +m[1];
      var buf = await r.arrayBuffer();
      if (r.status === 200) { rd.size = buf.byteLength; return buf.slice(s, e); } // server ignored the range
      return buf;
    } };
    return rd;
  }

  async function pool(n, count, fn) {
    var next = 0;
    async function worker() { while (next < count) { var i = next++; await fn(i); } }
    var ws = []; for (var k = 0; k < Math.min(n, count); k++) ws.push(worker());
    await Promise.all(ws);
  }

  // ---- WAV: read PCM directly ----
  function parseWav(buf) {
    var dv = new DataView(buf);
    if (buf.byteLength < 12 || str(dv, 0, 4) !== "RIFF" || str(dv, 8, 4) !== "WAVE") return null;
    var p = 12, fmt = null;
    while (p + 8 <= buf.byteLength) {
      var id = str(dv, p, 4), sz = dv.getUint32(p + 4, true);
      if (id === "fmt " && p + 24 <= buf.byteLength) {
        fmt = { format: dv.getUint16(p + 8, true), ch: dv.getUint16(p + 10, true), rate: dv.getUint32(p + 12, true), block: dv.getUint16(p + 20, true), bits: dv.getUint16(p + 22, true) };
        if (fmt.format === 0xFFFE && sz >= 26 && p + 34 <= buf.byteLength) fmt.format = dv.getUint16(p + 32, true);
      } else if (id === "data") {
        return fmt ? { fmt: fmt, start: p + 8, size: sz } : null;
      }
      p += 8 + sz + (sz & 1);
    }
    return null;
  }
  function pcmPeak(buf, f) {
    var dv = new DataView(buf), bps = f.bits / 8, n = Math.floor(buf.byteLength / bps), max = 0, v, i, o;
    for (i = 0; i < n; i++) {
      o = i * bps;
      if (f.format === 3 && f.bits === 32) v = dv.getFloat32(o, true);
      else if (f.bits === 16) v = dv.getInt16(o, true) / 32768;
      else if (f.bits === 24) { v = dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getInt8(o + 2) << 16); v /= 8388608; }
      else if (f.bits === 32) v = dv.getInt32(o, true) / 2147483648;
      else if (f.bits === 8) v = (dv.getUint8(o) - 128) / 128;
      else return 0;
      if (v < 0) v = -v;
      if (v > max) max = v;
    }
    return max;
  }
  async function sampleWav(rd, head) {
    var w = parseWav(head);
    if (!w) {
      if (head.byteLength < 1048576 && rd.size > head.byteLength) { head = await rd.read(0, Math.min(rd.size, 1048576)); w = parseWav(head); }
      if (!w) return null;
    }
    var f = w.fmt;
    if ([1, 3].indexOf(f.format) < 0 || !f.block || !f.rate) return null;
    var dataSize = Math.min(w.size, rd.size - w.start), frames = Math.floor(dataSize / f.block);
    var win = Math.max(1, Math.round(f.rate * WAV_WIN)), out = new Float32Array(B);
    await pool(6, B, async function (i) {
      var fr = Math.floor(((i + 0.5) / B) * Math.max(0, frames - win));
      var s = w.start + fr * f.block;
      out[i] = pcmPeak(await rd.read(s, s + win * f.block), f);
    });
    return { peaks: out, duration: frames / f.rate, method: "wav" };
  }

  // ---- decoding helpers ----
  var decCtx = null;
  function decoder() {
    if (!decCtx) { var OC = window.OfflineAudioContext || window.webkitOfflineAudioContext; decCtx = new OC(1, 1, 22050); }
    return decCtx;
  }
  function decode(buf, ctx) {
    ctx = ctx || decoder();
    return new Promise(function (ok, bad) {
      try { var p = ctx.decodeAudioData(buf, ok, bad); if (p && p.then) p.then(ok, bad); } catch (e) { bad(e); }
    });
  }
  function bufPeak(ab, from) {
    var max = 0;
    for (var c = 0; c < ab.numberOfChannels; c++) {
      var d = ab.getChannelData(c);
      for (var i = from || 0; i < d.length; i++) { var v = d[i] < 0 ? -d[i] : d[i]; if (v > max) max = v; }
    }
    return max;
  }

  // ---- MP3: decode short slices ----
  async function sampleMp3(rd, head) {
    var dv = new DataView(head), start = 0;
    if (head.byteLength >= 10 && str(dv, 0, 3) === "ID3") {
      start = 10 + ((dv.getUint8(6) & 127) << 21 | (dv.getUint8(7) & 127) << 14 | (dv.getUint8(8) & 127) << 7 | (dv.getUint8(9) & 127));
      if (dv.getUint8(5) & 16) start += 10;
    }
    var len = rd.size - start;
    if (len < MP3_WIN * 4) return null;
    var out = new Float32Array(B), fails = 0;
    await pool(4, B, async function (i) {
      var s = start + Math.floor(((i + 0.5) / B) * (len - MP3_WIN));
      try { var ab = await decode(await rd.read(s, s + MP3_WIN)); out[i] = bufPeak(ab, Math.min(2400, Math.floor(ab.length / 3))); }
      catch (e) { fails++; out[i] = -1; }
    });
    if (fails > B * 0.3) return null;
    // fill the odd slice that didn't decode from its neighbours
    for (var i = 0; i < B; i++) if (out[i] < 0) { var a = out[i - 1] >= 0 ? out[i - 1] : 0, b = out[i + 1] >= 0 ? out[i + 1] : a; out[i] = Math.max(a, b); }
    return { peaks: out, duration: null, method: "mp3" };
  }

  // ---- anything else: decode the whole file at a low rate ----
  async function sampleFull(rd) {
    if (!rd.size || rd.size > FULL_MAX) return null;
    var OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var ab = await decode(await rd.read(0, rd.size), new OC(1, 1, 8000));
    var out = new Float32Array(B), n = ab.length;
    for (var c = 0; c < ab.numberOfChannels; c++) {
      var d = ab.getChannelData(c);
      for (var i = 0; i < B; i++) {
        var a = Math.floor(i / B * n), b = Math.floor((i + 1) / B * n), max = out[i];
        for (var k = a; k < b; k++) { var v = d[k] < 0 ? -d[k] : d[k]; if (v > max) max = v; }
        out[i] = max;
      }
    }
    return { peaks: out, duration: ab.duration, method: "full" };
  }

  async function sample(rd) {
    var ext = extOf(rd.name);
    var head = await rd.read(0, Math.min(rd.size || 131072, 131072));
    var res = null;
    if (ext === "wav" || ext === "wave") res = await sampleWav(rd, head);
    else if (ext === "mp3") res = await sampleMp3(rd, head).catch(function () { return null; });
    if (!res) res = await sampleFull(rd);
    if (!res) throw new Error("Couldn't read this file's audio");
    return res;
  }

  // 300 loudness points -> 400-character text (square-root scale keeps quiet parts visible)
  function encode(peaks) {
    var s = "";
    for (var i = 0; i < peaks.length; i++) s += String.fromCharCode(Math.round(Math.sqrt(Math.min(1, Math.max(0, peaks[i]))) * 255));
    return btoa(s);
  }
  function decodePeaks(txt) {
    var s = atob(txt), a = new Float32Array(s.length);
    for (var i = 0; i < s.length; i++) { var q = s.charCodeAt(i) / 255; a[i] = q * q; }
    return a;
  }

  // Draw the song shape. cols: {band, part} loudness per column (0-1), plus playhead and loop.
  function draw(canvas, o) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2), cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!cw || !ch) return;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
    var g = canvas.getContext("2d"), W = canvas.width, H = canvas.height;
    g.clearRect(0, 0, W, H);
    var mid = H / 2, x;
    if (o.loopA != null) {
      var la = o.loopA * W, lb = (o.loopB != null ? o.loopB : o.loopA) * W;
      g.fillStyle = "rgba(255,211,107,.18)"; g.fillRect(la, 0, Math.max(2 * dpr, lb - la), H);
      g.fillStyle = "#FFD36B"; g.fillRect(la - dpr, 0, 2 * dpr, H); if (o.loopB != null) g.fillRect(lb - dpr, 0, 2 * dpr, H);
    }
    var cols = o.cols, n = cols ? cols.band.length : 0, px = o.progress * W;
    if (!n) {
      g.fillStyle = "rgba(255,255,255,.28)"; g.fillRect(0, mid - dpr, W, 2 * dpr);
      g.fillStyle = "#fff"; g.fillRect(0, mid - dpr, px, 2 * dpr);
    } else {
      var bw = W / n, gap = bw > 3 * dpr ? dpr : 0;
      for (var i = 0; i < n; i++) {
        x = i * bw;
        var hb = Math.max(dpr, cols.band[i] * (H - 2 * dpr)), played = x + bw / 2 <= px;
        g.fillStyle = played ? "rgba(255,255,255,.95)" : "rgba(255,255,255,.38)";
        g.fillRect(x, mid - hb / 2, bw - gap, hb);
        if (cols.part) {
          var hp = cols.part[i] * (H - 2 * dpr);
          if (hp >= dpr) { g.fillStyle = played ? "#FFD36B" : "rgba(255,211,107,.6)"; g.fillRect(x, mid - hp / 2, bw - gap, hp); }
        }
      }
    }
    g.fillStyle = "#fff"; g.fillRect(Math.min(W - 2 * dpr, Math.max(0, px - dpr)), 0, 2 * dpr, H);
  }

  window.MTWave = { B: B, sample: sample, fileReader: fileReader, urlReader: urlReader, encode: encode, decodePeaks: decodePeaks, draw: draw };
})();
