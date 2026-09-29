/* Google Drive cue/stem sources for Messiah Tour songs.
   Audio stays in the shared Drive. Single files use the Drive preview player;
   full stem folders are embedded so the band can open individual stems. */
(function () {
  "use strict";

  var DRIVE_STEMS = {
    /* cue/stem bounces already prepared */
    "chiiko": { type: "file", id: "1tx54Du8eQRcAgWmUrQ6sxi5AnJw33VFV" },
    "bako": { type: "file", id: "11l-MqgOZTEi3afEwx__PNcY7Y5FZmi0c" },
    "bako rangu": { type: "file", id: "11l-MqgOZTEi3afEwx__PNcY7Y5FZmi0c" },
    "my declaration": { type: "file", id: "13FqvaLGRbk9bq4-wwspsBuRwfbf2VrRL" },
    "declaration": { type: "file", id: "13FqvaLGRbk9bq4-wwspsBuRwfbf2VrRL" },
    "ndinobuda": { type: "file", id: "1H-JlJG9ZouaDkHfqRT8q5y-Xo3yJZETv" },
    "salt": { type: "file", id: "1IVJL1G-z9UfwqDlDGdvAb4NopwtxlW72" },
    "salt of the earth": { type: "file", id: "1IVJL1G-z9UfwqDlDGdvAb4NopwtxlW72" },
    "zvichanaka": { type: "file", id: "1ukW85wGG4Hpf1dW5pOM2vs-QWSOm35SV" },
    "kudzai mwari": { type: "file", id: "10_vD7TiF2-sAdkQflRP_2tVBVpgtfroq" },
    "rarama": { type: "file", id: "1C97ivIwKZe38frk6FfIPExThPyPrmSbR" },
    "guta": { type: "file", id: "1BEA-tr9ClBAmd1IkLwEOXdjVrDWBMu9c" },
    "hakuna hama": { type: "file", id: "15ostq70mLyIsPBpbXFdf_mYq5me1D02A" },
    "hallelujah": { type: "file", id: "1nmpDQUS2EbBwsJ9GLbVt8vcexkQP-Fws" },
    "tangai neni": { type: "file", id: "1GCC_HqM7rQmlD3hVj1xVMrS2jBKaSnfs" },

    /* remaining stems from the shared Messiah Tour stem source */
    "makanaka jesu": { type: "folder", id: "1w6N4y3Jba4JnVU0rmAjO8npPC9Tl_DkG" },
    "mweya mutsvene": { type: "file", id: "1ZD30hB8T-bDwcFH7wSNSDhanl3nX4sp0" },
    "ndinokuda mweya mutsvene": { type: "file", id: "1ZD30hB8T-bDwcFH7wSNSDhanl3nX4sp0" },
    "my witness": { type: "folder", id: "17OgGvf8_rs1WzigE-ND_FcSjnHlbH6We" },
    "ndamuona": { type: "folder", id: "1H8M4Ufa9QgLs2zY6TU9TI0IYROW883OX" },
    "messiah": { type: "file", id: "1jpU6MMMpBbvzn66r6buloH10QL-xjrfz" },
    "makomborero": { type: "folder", id: "1GbmHu7ErRPpaLVu9akELCCp3QQUVj_q6" },
    "mumoyo": { type: "folder", id: "135z1YWlsDpaPUTAixVVJ7fs3jBfTCOyC" },
    "tawanirwa nyasha": { type: "folder", id: "1MGuShkGef5Gk025VuqbBO6JHg5Je9Hfh" },
    "tawanirwe nyasha": { type: "folder", id: "1MGuShkGef5Gk025VuqbBO6JHg5Je9Hfh" }
  };

  function norm(s) {
    return String(s || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  }

  function findStem(title) {
    var n = norm(title);
    if (DRIVE_STEMS[n]) return DRIVE_STEMS[n];
    var keys = Object.keys(DRIVE_STEMS);
    for (var i = 0; i < keys.length; i++) {
      if (n.indexOf(keys[i]) !== -1 || keys[i].indexOf(n) !== -1) return DRIVE_STEMS[keys[i]];
    }
    return null;
  }

  function inject() {
    var songTitle = document.querySelector(".songhead h1");
    var col = document.querySelector(".songgrid .col-main");
    if (!songTitle || !col || document.getElementById("drive-stem-block")) return;

    var src = findStem(songTitle.textContent);
    if (!src) return;

    var safeTitle = songTitle.textContent.replace(/"/g, "&quot;");
    var block = document.createElement("div");
    block.className = "block";
    block.id = "drive-stem-block";

    if (src.type === "folder") {
      block.innerHTML =
        '<h3>Stems</h3>' +
        '<div style="border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--surface)">' +
        '<iframe title="' + safeTitle + ' stems folder" ' +
        'src="https://drive.google.com/embeddedfolderview?id=' + src.id + '#list" ' +
        'style="display:block;width:100%;height:340px;border:0"></iframe></div>' +
        '<p class="muted" style="font-size:13px;margin:8px 0 0">Full song stems from the shared Messiah Tour Google Drive folder. Tap a stem to open or play it.</p>';
    } else {
      block.innerHTML =
        '<h3>Stem / cue bounce</h3>' +
        '<div style="border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--surface)">' +
        '<iframe title="' + safeTitle + ' stem / cue bounce" ' +
        'src="https://drive.google.com/file/d/' + src.id + '/preview" ' +
        'style="display:block;width:100%;height:110px;border:0" allow="autoplay"></iframe></div>' +
        '<p class="muted" style="font-size:13px;margin:8px 0 0">Playback is streamed from the shared Messiah Tour Google Drive stem source.</p>';
    }

    var mixer = col.querySelector(".block");
    if (mixer && mixer.nextSibling) col.insertBefore(block, mixer.nextSibling);
    else col.appendChild(block);
  }

  var observer = new MutationObserver(inject);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("hashchange", function () { setTimeout(inject, 50); });
  inject();
})();
