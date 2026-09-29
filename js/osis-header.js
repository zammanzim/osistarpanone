// ============================================================
// osis-header.js — titik-tiga buat header halaman /osis/*
// - HP (<=700px): tombol Beranda + logout icon masuk ke menu titik tiga.
//   Isi menu: Beranda + Keluar. Chip user + tombol Masuk tetap di luar.
// - Desktop: tetap tampil normal (Beranda pill + chip + logout icon).
// - Brand (logo + tulisan) ditempel ke kiri, rapat ke tombol menu kiri.
// - Pakai style .header-more-menu/.header-more-item bersama (css/style.css).
// - Self-contained: markup + CSS di-inject otomatis, tinggal pasang
//   <script src="../js/osis-header.js?v=10" defer></script> di halaman.
// ============================================================
(function () {
  "use strict";

  var WRAP_ID = "osisMoreWrap";
  var MENU_ID = "osisMoreMenu";
  var BTN_ID = "osisMoreBtn";
  var LOGOUT_ID = "osisMoreLogout";
  var CSS_ID = "osisMoreCss";

  function diHalamanOsis() {
    try {
      var p = String(location.pathname || "").replace(/\\/g, "/");
      return /(^|\/)osis\//.test(p);
    } catch (e) {
      return false;
    }
  }

  function pasangCss() {
    if (document.getElementById(CSS_ID)) return;
    var st = document.createElement("style");
    st.id = CSS_ID;
    st.textContent =
      "#" + WRAP_ID + "{display:none;position:relative}" +
      "#" + BTN_ID + "{transition:transform .22s cubic-bezier(.34,1.3,.64,1)}" +
      "#" + BTN_ID + ".active{transform:rotate(90deg)}" +
      "header.top-nav:has(#osisSideBtn){justify-content:flex-start;gap:8px}" +
      "header.top-nav:has(#osisSideBtn) .top-nav-extra{margin-left:auto}" +
      "@media (max-width:700px){" +
      ".top-nav-extra>a.btn{display:none!important}" +
      ".top-nav-extra #areaAuth .icon-btn{display:none!important}" +
      "#" + WRAP_ID + ".show{display:inline-flex!important}" +
      "}";
    try {
      document.head.appendChild(st);
    } catch (e) {}
  }

  function toggle() {
    var m = document.getElementById(MENU_ID);
    var b = document.getElementById(BTN_ID);
    if (!m) return;
    m.classList.toggle("open");
    if (b) b.classList.toggle("active", m.classList.contains("open"));
  }

  function close() {
    var m = document.getElementById(MENU_ID);
    var b = document.getElementById(BTN_ID);
    if (m) m.classList.remove("open");
    if (b) b.classList.remove("active");
  }

  function bangun() {
    if (!diHalamanOsis()) return null;
    var lama = document.getElementById(WRAP_ID);
    if (lama) return lama;
    var extra = document.querySelector(".top-nav-extra");
    if (!extra) return null;
    var wrap = document.createElement("div");
    wrap.id = WRAP_ID;
    wrap.innerHTML =
      '<button class="icon-btn" id="' + BTN_ID + '" title="Menu"><i class="fa-solid fa-ellipsis-vertical"></i></button>' +
      '<div class="header-more-menu" id="' + MENU_ID + '">' +
      '<a href="../index#/" class="header-more-item"><i class="fa-solid fa-house"></i> Beranda</a>' +
      '<button class="header-more-item danger" id="' + LOGOUT_ID + '" style="display:none"><i class="fa-solid fa-arrow-right-from-bracket"></i> Keluar</button>' +
      "</div>";
    extra.appendChild(wrap);
    var btn = document.getElementById(BTN_ID);
    if (btn) {
      btn.addEventListener("click", function (e) {
        try {
          e.stopPropagation();
        } catch (_) {}
        toggle();
      });
    }
    var keluar = document.getElementById(LOGOUT_ID);
    if (keluar) {
      keluar.addEventListener("click", function () {
        close();
        try {
          if (typeof OsisAuth !== "undefined" && OsisAuth.confirmLogout) {
            OsisAuth.confirmLogout();
            return;
          }
          if (typeof OsisAuth !== "undefined" && OsisAuth.logout) {
            OsisAuth.logout();
            return;
          }
        } catch (e) {}
      });
    }
    document.addEventListener("click", function (e) {
      var w = document.getElementById(WRAP_ID);
      var m = document.getElementById(MENU_ID);
      if (!w || !m || !m.classList.contains("open")) return;
      if (w.contains(e.target)) return;
      close();
    });
    return wrap;
  }

  function refresh() {
    var wrap = document.getElementById(WRAP_ID) || bangun();
    if (!wrap) return;
    var narrow = false;
    try {
      narrow = window.innerWidth <= 700;
    } catch (e) {}
    var logged = false;
    try {
      logged = !!(typeof OsisAuth !== "undefined" && OsisAuth.getUser && OsisAuth.getUser());
    } catch (e) {}
    wrap.classList.toggle("show", narrow);
    wrap.style.display = narrow ? "" : "none";
    if (!narrow) close();
    var keluar = document.getElementById(LOGOUT_ID);
    if (keluar) keluar.style.display = logged ? "" : "none";
  }

  function init() {
    pasangCss();
    bangun();
    refresh();
    // Ikut renderHeader biar item Keluar sinkron tiap login/logout.
    try {
      if (typeof OsisAuth !== "undefined" && OsisAuth.renderHeader && !OsisAuth.renderHeader._osisMoreHook) {
        var orig = OsisAuth.renderHeader.bind(OsisAuth);
        var hooked = function () {
          orig();
          try {
            refresh();
          } catch (e) {}
        };
        hooked._osisMoreHook = true;
        OsisAuth.renderHeader = hooked;
      }
    } catch (e) {}
  }

  if (typeof onReady === "function") {
    onReady(init);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
  window.addEventListener("resize", refresh);
  window.OsisMore = { toggle: toggle, close: close, refresh: refresh };
})();
