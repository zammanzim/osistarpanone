// =========================================================================
// NOTICE — pemberitahuan universal (persistent, kanan atas)
// Pengganti pill khusus (cth: offlinePill di outbox.js) biar semua fitur
// bisa pasang status sendiri: offline, edit-mode, antrean, dsb.
//
// Beda dengan toast (transient, bawah, hilang 2.8 dtk) & showPopup (modal
// blokir): notice NEMPEL terus sampai di-hide eksplisit.
//
// Usage:
//   Notice.show("offline", { text: "Offline — data terakhir", icon: "fa-solid fa-cloud", type: "dark" });
//   Notice.show("editmode", "Sedang edit mode", "yellow");
//   Notice.hide("offline");
//   showNotice("antre", "3 antrean menunggu", { icon: "fa-solid fa-cloud-arrow-up", type: "white" });
//   hideNotice("antre");
//
// Argumen fleksibel:
//   show(id, text, type?) | show(id, { text, icon, type, title, onClick })
// type: "dark" | "yellow" | "red" | "white" | "green" (default "dark")
// Satu id = satu pill (upsert, tidak dobel).
// =========================================================================

(function () {
  "use strict";

  var STACK_ID = "notice-stack";
  var TIPE_VALID = { dark: 1, yellow: 1, red: 1, white: 1, green: 1 };
  var _stack = null;

  function stack() {
    if (_stack) {
      try {
        if (document.body.contains(_stack)) return _stack;
      } catch (e) {
        return _stack; // DOM minimal / non-standar: pakai cache closure
      }
      _stack = null;
    }
    var el = document.getElementById(STACK_ID);
    if (el) { _stack = el; return el; }
    el = document.createElement("div");
    el.id = STACK_ID;
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
    _stack = el;
    return el;
  }

  function normalisasi(id, a, b) {
    var opt = { id: String(id || "").trim(), text: "", icon: "", type: "dark", title: "", onClick: null };
    if (!opt.id) return null;
    if (a && typeof a === "object") {
      opt.text = String(a.text != null ? a.text : "").trim();
      opt.icon = String(a.icon || "").trim();
      opt.type = String(a.type || "dark").trim().toLowerCase();
      opt.title = String(a.title || "").trim();
      if (typeof a.onClick === "function") opt.onClick = a.onClick;
    } else {
      opt.text = String(a != null ? a : "").trim();
      if (b && typeof b === "object") {
        opt.icon = String(b.icon || "").trim();
        opt.type = String(b.type || "dark").trim().toLowerCase();
        opt.title = String(b.title || "").trim();
        if (typeof b.onClick === "function") opt.onClick = b.onClick;
      } else if (typeof b === "string") {
        // bentuk pendek: ("id", "teks", "yellow") atau ("id", "teks", "fa-...")
        if (TIPE_VALID[b.trim().toLowerCase()]) opt.type = b.trim().toLowerCase();
        else opt.icon = b.trim();
      }
    }
    if (!TIPE_VALID[opt.type]) opt.type = "dark";
    return opt;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var Notice = {
    show: function (id, a, b) {
      var opt = normalisasi(id, a, b);
      if (!opt || !opt.text) return false;
      var wadah = stack();
      var el = null;
      try {
        el = wadah.querySelector('[data-notice="' + CSS.escape(opt.id) + '"]');
      } catch (e) {
        var daftar = wadah.querySelectorAll("[data-notice]");
        for (var i = 0; i < daftar.length; i++) {
          var cur = daftar[i] && daftar[i].dataset ? daftar[i].dataset.notice : null;
          if (cur == null && daftar[i] && daftar[i].getAttribute) {
            try { cur = daftar[i].getAttribute("data-notice"); } catch (e2) {}
          }
          if (cur === opt.id) { el = daftar[i]; break; }
        }
      }
      if (!el) {
        el = document.createElement("div");
        el.className = "notice-pill notice-" + opt.type;
        el.dataset.notice = opt.id;
        wadah.appendChild(el);
      } else {
        el.className = "notice-pill notice-" + opt.type;
      }
      el.innerHTML =
        (opt.icon ? '<i class="' + esc(opt.icon) + '"></i>' : "") +
        "<span>" + esc(opt.text) + "</span>";
      if (opt.title) el.title = opt.title;
      else el.removeAttribute("title");
      el.onclick = opt.onClick || null;
      el.style.cursor = opt.onClick ? "pointer" : "";
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { el.classList.add("notice-show"); });
      });
      return true;
    },

    hide: function (id) {
      var key = String(id || "").trim();
      if (!key) return false;
      var sel;
      try {
        sel = '#' + STACK_ID + ' [data-notice="' + CSS.escape(key) + '"]';
      } catch (e) {
        sel = '#' + STACK_ID + ' [data-notice="' + key.replace(/"/g, "") + '"]';
      }
      var el = null;
      try {
        el = document.querySelector(sel);
      } catch (e2) {
        el = null;
      }
      if (!el) {
        try {
          var wadah = document.getElementById(STACK_ID);
          var daftar = wadah ? wadah.querySelectorAll("[data-notice]") : [];
          for (var i = 0; i < daftar.length; i++) {
            var cur = daftar[i] && daftar[i].dataset ? daftar[i].dataset.notice : null;
            if (cur === key) { el = daftar[i]; break; }
          }
        } catch (e3) {}
      }
      if (!el) return false;
      el.classList.remove("notice-show");
      el.classList.add("notice-hide");
      var hapus = function () { try { el.remove(); } catch (e) {} };
      try {
        el.addEventListener("transitionend", hapus, { once: true });
      } catch (e) {}
      setTimeout(hapus, 300);
      return true;
    },

    has: function (id) {
      var key = String(id || "").trim();
      if (!key) return false;
      var sel;
      try {
        sel = '#' + STACK_ID + ' [data-notice="' + CSS.escape(key) + '"]';
      } catch (e) {
        sel = '#' + STACK_ID + ' [data-notice="' + key.replace(/"/g, "") + '"]';
      }
      try {
        if (document.querySelector(sel)) return true;
      } catch (e2) {}
      try {
        var wadah = document.getElementById(STACK_ID);
        var daftar = wadah ? wadah.querySelectorAll("[data-notice]") : [];
        for (var i = 0; i < daftar.length; i++) {
          var cur = daftar[i] && daftar[i].dataset ? daftar[i].dataset.notice : null;
          if (cur === key) return true;
        }
      } catch (e3) {}
      return false;
    },

    toggle: function (id, nyala, a, b) {
      if (nyala) return Notice.show(id, a, b);
      return Notice.hide(id);
    },

    clear: function () {
      var wadah = document.getElementById(STACK_ID);
      if (wadah) wadah.innerHTML = "";
    },
  };

  window.Notice = Notice;
  window.showNotice = function (id, a, b) { return Notice.show(id, a, b); };
  window.hideNotice = function (id) { return Notice.hide(id); };
})();
