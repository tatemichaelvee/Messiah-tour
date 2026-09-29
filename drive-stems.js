/* Google Drive cue/stem bounces for Messiah Tour songs.
   These files stay in Drive; the song page embeds the Drive preview player. */
(function () {
  "use strict";

  var DRIVE_STEMS = {
    "chiiko": "1tx54Du8eQRcAgWmUrQ6sxi5AnJw33VFV",
    "bako": "11l-MqgOZTEi3afEwx__PNcY7Y5FZmi0c",
    "bako rangu": "11l-MqgOZTEi3afEwx__PNcY7Y5FZmi0c",
    "my declaration": "13FqvaLGRbk9bq4-wwspsBuRwfbf2VrRL",
    "declaration": "13FqvaLGRbk9bq4-wwspsBuRwfbf2VrRL",
    "ndinobuda": "1H-JlJG9ZouaDkHfqRT8q5y-Xo3yJZETv",
    "salt": "1IVJL1G-z9UfwqDlDGdvAb4NopwtxlW72",
    "salt of the earth": "1IVJL1G-z9UfwqDlDGdvAb4NopwtxlW72",
    "zvichanaka": "1ukW85wGG4Hpf1dW5pOM2vs-QWSOm35SV",
    "kudzai mwari": "10_vD7TiF2-sAdkQflRP_2tVBVpgtfroq",
    "rarama": "1C97ivIwKZe38frk6FfIPExThPyPrmSbR",
    "guta": "1BEA-tr9ClBAmd1IkLwEOXdjVrDWBMu9c",
    "hakuna hama": "15ostq70mLyIsPBpbXFdf_mYq5me1D02A",
    "hallelujah": "1nmpDQUS2EbBwsJ9GLbVt8vcexkQP-Fws",
    "tangai neni": "1GCC_HqM7rQmlD3hVj1xVMrS2jBKaSnfs"
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

    var id = findStem(songTitle.textContent);
    if (!id) return;

    var block = document.createElement("div");
    block.className = "block";
    block.id = "drive-stem-block";
    block.innerHTML =
      '<h3>Stem / cue bounce</h3>' +
      '<div style="border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--surface)">' +
      '<iframe title="' + songTitle.textContent.replace(/"/g, "&quot;") + ' stem / cue bounce" ' +
      'src="https://drive.google.com/file/d/' + id + '/preview" ' +
      'style="display:block;width:100%;height:110px;border:0" allow="autoplay"></iframe></div>' +
      '<p class="muted" style="font-size:13px;margin:8px 0 0">Playback is streamed from the Messiah Tour Google Drive stem folder.</p>';

    var mixer = col.querySelector(".block");
    if (mixer && mixer.nextSibling) col.insertBefore(block, mixer.nextSibling);
    else col.appendChild(block);
  }

  var observer = new MutationObserver(inject);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("hashchange", function () { setTimeout(inject, 50); });
  inject();
})();
