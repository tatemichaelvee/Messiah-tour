/* Drag-to-reorder for lists (the mixer's tracks, the admin file table).
   Touch: press and hold a row (~0.35 s) until it lifts, then drag.
   Mouse: press on the row's name or grip and drag.
   Keyboard: focus the grip and use the arrow keys.
   Rows need data-id; the grip is [data-grip]; hold areas are [data-hold]. */
(function () {
  "use strict";
  var HOLD = 350, SLOP = 8;

  function sortable(box, opts) {
    var rowSel = opts.rows, drag = null, suppressClick = false;
    function rows() { return Array.prototype.slice.call(box.querySelectorAll(rowSel)); }
    function order() { return rows().map(function (r) { return r.dataset.id; }); }

    function start(row, y) {
      drag.active = true; drag.row = row; drag.startY = y; drag.top = row.offsetTop;
      row.classList.add("drag-lift"); box.classList.add("drag-on");
      drag.before = order().join(",");
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
    }
    function move(y) {
      var row = drag.row, list = rows(), i = list.indexOf(row);
      var mid = function (r) { return r.offsetTop + r.offsetHeight / 2; };
      var cur = drag.top + (y - drag.startY) + row.offsetHeight / 2;
      var prev = list[i - 1], next = list[i + 1];
      if (prev && cur < mid(prev)) row.parentNode.insertBefore(row, prev);
      else if (next && cur > mid(next)) row.parentNode.insertBefore(next, row);
      var nt = row.offsetTop; drag.startY += nt - drag.top; drag.top = nt;
      row.style.transform = "translateY(" + (y - drag.startY) + "px)";
      // keep the row in view near the screen edges
      if (y < 70) window.scrollBy(0, -8); else if (y > window.innerHeight - 110) window.scrollBy(0, 8);
    }
    function finish() {
      if (!drag) return;
      clearTimeout(drag.timer);
      if (drag.active) {
        var row = drag.row;
        row.style.transform = ""; row.classList.remove("drag-lift"); box.classList.remove("drag-on");
        suppressClick = true; setTimeout(function () { suppressClick = false; }, 50);
        var ids = order();
        if (ids.join(",") !== drag.before) opts.onDrop(ids, row.dataset.id);
      }
      drag = null;
    }

    box.addEventListener("pointerdown", function (e) {
      if (e.button > 0) return;
      var row = e.target.closest(rowSel); if (!row || !box.contains(row)) return;
      var grip = e.target.closest("[data-grip]"), hold = e.target.closest("[data-hold]");
      if (!grip && !hold) return;
      drag = { x: e.clientX, y: e.clientY, row: row, active: false, touch: e.pointerType !== "mouse", pid: e.pointerId };
      if (drag.touch) drag.timer = setTimeout(function () { if (drag && !drag.active) start(row, drag.y); }, HOLD);
      else if (grip) { e.preventDefault(); }
    });
    box.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.pid) return;
      if (!drag.active) {
        var far = Math.abs(e.clientX - drag.x) > SLOP || Math.abs(e.clientY - drag.y) > SLOP;
        if (drag.touch) { if (far) { clearTimeout(drag.timer); drag = null; } return; } // it's a scroll
        if (!far) return;
        start(drag.row, drag.y);
        try { box.setPointerCapture(e.pointerId); } catch (x) {}
      }
      e.preventDefault();
      move(e.clientY);
    });
    box.addEventListener("pointerup", finish);
    box.addEventListener("pointercancel", function () {
      if (!drag) return;
      if (drag.active) { if (!drag.touch) finish(); return; } // touch drags carry on through touch events
      clearTimeout(drag.timer); drag = null;
    });
    // once a touch drag has started, follow the finger and stop the page scrolling under it
    box.addEventListener("touchmove", function (e) {
      if (!drag || !drag.active) return;
      e.preventDefault();
      if (e.touches[0]) move(e.touches[0].clientY);
    }, { passive: false });
    box.addEventListener("touchend", function () { if (drag && drag.active) finish(); });
    box.addEventListener("touchcancel", function () { if (drag && drag.active) finish(); });
    box.addEventListener("contextmenu", function (e) { if (drag) e.preventDefault(); });
    box.addEventListener("click", function (e) { if (suppressClick) { e.preventDefault(); e.stopPropagation(); } }, true);
    // keyboard: arrow keys on a grip move that row
    box.addEventListener("keydown", function (e) {
      var grip = e.target.closest("[data-grip]"); if (!grip) return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      var row = grip.closest(rowSel), list = rows(), i = list.indexOf(row), j = i + (e.key === "ArrowUp" ? -1 : 1);
      if (j < 0 || j >= list.length) return;
      if (j < i) row.parentNode.insertBefore(row, list[j]); else row.parentNode.insertBefore(list[j], row);
      opts.onDrop(order(), row.dataset.id, true);
    });
  }
  window.MTSort = sortable;
})();
