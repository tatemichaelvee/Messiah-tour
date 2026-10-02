/* Phone copies: turns a stem (WAV, MP3, M4A) into a light 128 kbps constant-bitrate MP3
   for the mixer. A song with 20+ WAV stems needs ~30 MB/s to stream, which no phone can
   do; the light copies need well under 0.5 MB/s, and constant bitrate lets Safari seek
   every stem to exactly the same point, which keeps them locked together on iPhone.
   WAVs are streamed through a background worker (a 300 MB file never sits in memory);
   other formats are decoded by the browser first. Originals are never changed. */
(function () {
  "use strict";
  var API = { LAME_URL: "https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js", KBPS: 128, MONO_KBPS: 96 };

  // ---------------- worker (runs off the page) ----------------
  function workerMain() {
    /* global lamejs */
    var BLOCK = 1152 * 40;
    function post(m) { self.postMessage(m); }
    function Enc(ch, rate, kbps) {
      var e = new lamejs.Mp3Encoder(ch, rate, kbps), parts = [];
      this.push = function (l, r) {
        for (var i = 0; i < l.length; i += BLOCK) {
          var a = l.subarray(i, i + BLOCK), b = r ? r.subarray(i, i + BLOCK) : undefined;
          var out = ch === 2 ? e.encodeBuffer(a, b) : e.encodeBuffer(a);
          if (out.length) parts.push(new Uint8Array(out));
        }
      };
      this.end = function () { var out = e.flush(); if (out.length) parts.push(new Uint8Array(out)); return new Blob(parts, { type: "audio/mpeg" }); };
    }
    function i16(v) { return v >= 1 ? 32767 : v <= -1 ? -32768 : Math.round(v * 32767); }
    function str(u, p, n) { var s = ""; for (var i = 0; i < n; i++) s += String.fromCharCode(u[p + i]); return s; }
    function u32(u, p) { return (u[p] | (u[p + 1] << 8) | (u[p + 2] << 16) | (u[p + 3] << 24)) >>> 0; }
    function u16(u, p) { return u[p] | (u[p + 1] << 8); }
    function okRate(r) { return [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000].indexOf(r) > -1; }

    async function wav(stream, total, kbps, monoKbps) {
      var rd = stream.getReader(), buf = new Uint8Array(0), got = 0, fmt = null, left = Infinity, enc = null, lastP = 0;
      var ch, bps, block, outCh, down = 1, rate;
      function append(c) { var n = new Uint8Array(buf.length + c.length); n.set(buf); n.set(c, buf.length); buf = n; }
      function header() {
        if (buf.length < 12) return false;
        if (str(buf, 0, 4) !== "RIFF" || str(buf, 8, 4) !== "WAVE") throw new Error("Not a WAV file");
        var p = 12;
        while (p + 8 <= buf.length) {
          var id = str(buf, p, 4), sz = u32(buf, p + 4);
          if (id === "fmt ") {
            if (p + 8 + 16 > buf.length) return false;
            fmt = { format: u16(buf, p + 8), ch: u16(buf, p + 10), rate: u32(buf, p + 12), block: u16(buf, p + 20), bits: u16(buf, p + 22) };
            if (fmt.format === 0xFFFE && sz >= 26 && p + 34 <= buf.length) fmt.format = u16(buf, p + 32);
          } else if (id === "data") {
            if (!fmt) throw new Error("WAV has no format block");
            left = sz && sz !== 0xFFFFFFFF ? sz : Infinity;
            buf = buf.slice(p + 8); return true;
          }
          if (p + 8 + sz + (sz & 1) > buf.length && id !== "data") { if (buf.length > 16777216) throw new Error("WAV header too large"); return false; }
          p += 8 + sz + (sz & 1);
        }
        return false;
      }
      function setup() {
        if ([1, 3].indexOf(fmt.format) < 0) throw new Error("Unsupported WAV encoding");
        ch = fmt.ch; bps = fmt.bits / 8; block = fmt.block || ch * bps; rate = fmt.rate;
        while (!okRate(rate / down) && rate / down > 48000 && (rate / down) % 2 === 0) down *= 2;
        if (!okRate(rate / down)) throw new Error("Unsupported sample rate " + rate);
        outCh = ch >= 2 ? 2 : 1;
        enc = new Enc(outCh, rate / down, outCh === 2 ? kbps : monoKbps);
      }
      var dv = null;
      function sample(o) {
        if (fmt.format === 3) return fmt.bits === 64 ? dv.getFloat64(o, true) : dv.getFloat32(o, true);
        if (fmt.bits === 16) return dv.getInt16(o, true) / 32768;
        if (fmt.bits === 24) return ((dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getInt8(o + 2) << 16))) / 8388608;
        if (fmt.bits === 32) return dv.getInt32(o, true) / 2147483648;
        if (fmt.bits === 8) return (dv.getUint8(o) - 128) / 128;
        throw new Error("Unsupported bit depth");
      }
      function pump(final) {
        var usable = Math.min(buf.length, left);
        var frames = Math.floor(usable / block);
        frames -= frames % down;
        if (!frames && !final) return;
        dv = new DataView(buf.buffer, buf.byteOffset, frames * block);
        var n = frames / down, L = new Int16Array(n), R = outCh === 2 ? new Int16Array(n) : null;
        for (var i = 0; i < n; i++) {
          var a = 0, b = 0;
          for (var k = 0; k < down; k++) {
            var o = (i * down + k) * block;
            a += sample(o); if (R) b += sample(o + bps);
          }
          L[i] = i16(a / down); if (R) R[i] = i16(b / down);
        }
        enc.push(L, R);
        buf = buf.slice(frames * block); left -= frames * block;
      }
      for (;;) {
        var r = await rd.read();
        if (r.done) break;
        got += r.value.length; append(r.value);
        if (!enc) { if (!header()) continue; setup(); }
        if (buf.length >= 1048576) pump(false);
        if (total && got / total - lastP >= 0.01) { lastP = got / total; post({ t: "p", p: lastP }); }
        if (left <= 0) { try { rd.cancel(); } catch (e) {} break; }
      }
      if (!enc) throw new Error("Couldn't read this WAV");
      pump(true);
      return enc.end();
    }

    function pcm(d, kbps, monoKbps) {
      var outCh = d.right ? 2 : 1, enc = new Enc(outCh, d.rate, outCh === 2 ? kbps : monoKbps);
      var n = d.left.length, step = 1152 * 200;
      for (var s = 0; s < n; s += step) {
        var m = Math.min(step, n - s), L = new Int16Array(m), R = d.right ? new Int16Array(m) : null;
        for (var i = 0; i < m; i++) { L[i] = i16(d.left[s + i]); if (R) R[i] = i16(d.right[s + i]); }
        enc.push(L, R);
        post({ t: "p", p: 0.5 + 0.5 * (s + m) / n });
      }
      return enc.end();
    }

    self.onmessage = async function (e) {
      var d = e.data;
      try {
        importScripts(d.lame);
        var blob;
        if (d.kind === "wav-url") {
          var res = await fetch(d.url);
          if (!res.ok) throw new Error("Download failed (HTTP " + res.status + ")");
          blob = await wav(res.body, +res.headers.get("Content-Length") || d.size || 0, d.kbps, d.monoKbps);
        } else if (d.kind === "wav-file") {
          blob = await wav(d.file.stream(), d.file.size, d.kbps, d.monoKbps);
        } else blob = pcm(d, d.kbps, d.monoKbps);
        post({ t: "done", blob: blob });
      } catch (err) { post({ t: "err", msg: String((err && err.message) || err) }); }
    };
  }

  var workerUrl = null;
  function run(msg, transfer, onProgress) {
    if (!workerUrl) workerUrl = URL.createObjectURL(new Blob(["(" + workerMain.toString() + ")()"], { type: "text/javascript" }));
    msg.lame = API.LAME_URL; msg.kbps = API.KBPS; msg.monoKbps = API.MONO_KBPS;
    return new Promise(function (ok, bad) {
      var w = new Worker(workerUrl);
      w.onmessage = function (e) {
        var d = e.data;
        if (d.t === "p") { if (onProgress) onProgress(d.p); return; }
        w.terminate();
        if (d.t === "done") ok(d.blob); else bad(new Error(d.msg));
      };
      w.onerror = function (e) { w.terminate(); bad(new Error(e.message || "Converter failed to start")); };
      w.postMessage(msg, transfer || []);
    });
  }

  function isWav(name) { return /\.(wav|wave)$/i.test(name || ""); }
  function decode(buf) {
    var OC = window.OfflineAudioContext || window.webkitOfflineAudioContext, ctx = new OC(2, 1, 44100);
    return new Promise(function (ok, bad) {
      try { var p = ctx.decodeAudioData(buf, ok, bad); if (p && p.then) p.then(ok, bad); } catch (e) { bad(e); }
    });
  }
  async function viaDecode(getBuf, onProgress) {
    var ab = await decode(await getBuf());
    if (onProgress) onProgress(0.5);
    var left = ab.getChannelData(0).slice(), right = ab.numberOfChannels > 1 ? ab.getChannelData(1).slice() : null;
    // a "stereo" file with identical channels is really mono: save it as mono
    if (right) { var same = true; for (var i = 0; i < left.length; i += 97) if (left[i] !== right[i]) { same = false; break; } if (same) right = null; }
    return run({ kind: "pcm", rate: ab.sampleRate, left: left, right: right }, right ? [left.buffer, right.buffer] : [left.buffer], onProgress);
  }

  // url: a signed link to the original; name: its file name (for the type); size: bytes if known
  API.fromUrl = function (url, name, size, onProgress) {
    if (isWav(name)) return run({ kind: "wav-url", url: url, size: size }, null, onProgress);
    return viaDecode(async function () { var r = await fetch(url); if (!r.ok) throw new Error("Download failed (HTTP " + r.status + ")"); return r.arrayBuffer(); }, onProgress);
  };
  API.fromFile = function (file, onProgress) {
    if (isWav(file.name)) return run({ kind: "wav-file", file: file }, null, onProgress);
    return viaDecode(function () { return file.arrayBuffer(); }, onProgress);
  };

  // Build one lightweight stereo rehearsal mix from already-created phone copies.
  // This is intentionally done on a desktop admin browser so iPhone/iPad only has to
  // stream one MP3 instead of many independently-clocked media elements.
  API.mixUrls = async function (items, onProgress) {
    if (!items || !items.length) throw new Error("No tracks to mix");
    var rate = 0, L = null, R = null, used = 0;

    function grow(n) {
      if (L && L.length >= n) return;
      var size = Math.max(n, L ? Math.ceil(L.length * 1.25) : n);
      var nl = new Float32Array(size), nr = new Float32Array(size);
      if (L) { nl.set(L); nr.set(R); }
      L = nl; R = nr;
    }

    for (var ix = 0; ix < items.length; ix++) {
      var it = items[ix];
      var res = await fetch(it.url);
      if (!res.ok) throw new Error("Couldn't download " + (it.label || "track") + " (HTTP " + res.status + ")");
      var ab = await decode(await res.arrayBuffer());
      if (!rate) rate = ab.sampleRate;
      var n = Math.ceil(ab.duration * rate);
      grow(n);
      if (n > used) used = n;

      var a = ab.getChannelData(0), b = ab.numberOfChannels > 1 ? ab.getChannelData(1) : a;
      var ratio = ab.sampleRate / rate;
      for (var i = 0; i < n; i++) {
        var p = i * ratio, j = Math.floor(p), f = p - j;
        if (j >= a.length) break;
        var j2 = Math.min(a.length - 1, j + 1);
        L[i] += a[j] + (a[j2] - a[j]) * f;
        R[i] += b[j] + (b[j2] - b[j]) * f;
      }
      if (onProgress) onProgress({ stage: "mix", done: ix + 1, total: items.length, label: it.label || "" });
    }

    // Keep the summed stems clean without changing their relative balance.
    var peak = 0;
    for (var k = 0; k < used; k++) {
      var p1 = Math.abs(L[k]), p2 = Math.abs(R[k]);
      if (p1 > peak) peak = p1;
      if (p2 > peak) peak = p2;
    }
    var gain = peak > 0.92 ? 0.92 / peak : 1;
    var outL = new Float32Array(used), outR = new Float32Array(used);
    for (var q = 0; q < used; q++) { outL[q] = L[q] * gain; outR[q] = R[q] * gain; }
    L = R = null;
    if (onProgress) onProgress({ stage: "encode", done: items.length, total: items.length, label: "" });
    return run({ kind: "pcm", rate: rate, left: outL, right: outR }, [outL.buffer, outR.buffer], function (p) {
      if (onProgress) onProgress({ stage: "encode", progress: p });
    });
  };

  API.supported = function () { return !!(window.Worker && window.Blob && window.ReadableStream && (window.OfflineAudioContext || window.webkitOfflineAudioContext)); };
  window.MTLite = API;
})();
