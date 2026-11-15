// ============================================================
// osis-header.js — titik-tiga buat header halaman /osis/*
// - PARITAS PUBLIK: wrap selalu tampil (desktop + HP) kayak HeaderMore
//   di index. Isi: Beranda (HP aja) + Visitor (HP + osis aja) +
//   Pengaturan + Keluar. TANPA site-edit (no Edit mode/toggle).
// - Desktop: Beranda pill + visitor + chip + logout icon tetap di luar.
// - HP (<=700px): Beranda pill + logout icon + visitor masuk titik-tiga
//   (urut: Beranda, Visitor, Pengaturan, Keluar).
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
  var BERANDA_ID = "osisMoreBeranda";
  var VISITOR_ID = "osisMoreVisitor";
  var PENG_ID = "osisMorePengaturan";
  var CSS_ID = "osisMoreCss";
  var ANG_WRAP_ID = "osisAngkatanWrap";
  var ANG_SEL_ID = "osisAngkatanSelect";
  var _angFetched = false;

  function esc(s) {
    if (typeof escapeHtml === "function") return escapeHtml(s);
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

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
      "#" + WRAP_ID + "{display:inline-flex;position:relative}" +
      "#" + BTN_ID + "{transition:transform .22s cubic-bezier(.34,1.3,.64,1)}" +
      "#" + BTN_ID + ".active{transform:rotate(90deg)}" +
      "header.top-nav:has(#osisSideBtn){justify-content:flex-start;gap:8px}" +
      "header.top-nav:has(#osisSideBtn) .top-nav-extra{margin-left:auto}" +
      ".top-nav-extra #areaAuth .icon-btn{display:none!important}" +
      "#osisMoreVisitor span{display:inline-flex;align-items:center;gap:8px}" +
      "@media (max-width:700px){" +
      ".top-nav-extra>a.btn{display:none!important}" +
      ".top-nav-extra #areaAuth .icon-btn{display:none!important}" +
      "#osisVisitorTrigger{display:none!important}" +
      "#" + BERANDA_ID + "{order:1}" +
      "#" + VISITOR_ID + "{order:2}" +
      "#" + PENG_ID + "{order:3}" +
      "#" + LOGOUT_ID + "{order:4}" +
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
    if (m.classList.contains("open")) stagger(m);
    if (b) b.classList.toggle("active", m.classList.contains("open"));
  }

  // Delay cascade per item terlihat (gantiin nth-child CSS).
  // Urut visual (computed order), bukan DOM.
  function stagger(m) {
    try {
      var items = m.querySelectorAll(".header-more-item");
      var vis = [];
      for (var k = 0; k < items.length; k++) {
        if (!items[k].offsetParent) continue; // display:none = skip
        var ord = 0;
        try { ord = parseInt(getComputedStyle(items[k]).order, 10) || 0; } catch (e) {}
        vis.push({ el: items[k], ord: ord, idx: vis.length });
      }
      vis.sort(function (a, b) { return (a.ord - b.ord) || (a.idx - b.idx); });
      for (var i = 0; i < vis.length; i++) {
        vis[i].el.style.transitionDelay = (0.03 + i * 0.04).toFixed(2) + "s";
      }
    } catch (e) {}
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
      '<div class="ang-more-box" id="' + ANG_WRAP_ID + '" style="display:none"></div>' +
      '<a href="../index#/" class="header-more-item" id="' + BERANDA_ID + '" style="display:none"><i class="fa-solid fa-house"></i> Beranda</a>' +
      '<button class="header-more-item" id="' + VISITOR_ID + '" style="display:none"><span><i class="fa-solid fa-eye"></i> Visitor</span><b id="osisMoreVisitorCount">-</b></button>' +
      '<a href="../index#/pengaturan" class="header-more-item" id="' + PENG_ID + '"><i class="fa-solid fa-gear"></i> Pengaturan</a>' +
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
    var vis = document.getElementById(VISITOR_ID);
    if (vis) {
      vis.addEventListener("click", function () {
        close();
        try {
          if (typeof OsisVisitor !== "undefined" && OsisVisitor.bukaPopup) {
            OsisVisitor.bukaPopup();
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

  function bangunAngkatan() {
    if (!diHalamanOsis()) return null;
    var el = document.getElementById(ANG_WRAP_ID);
    if (el) return el;
    bangun();
    return document.getElementById(ANG_WRAP_ID);
  }

  function renderAngkatan() {
    var wrap = bangunAngkatan();
    if (!wrap) return;
    var u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser && OsisAuth.getUser()) || null;
    if (!u || u.mode !== "osis") {
      wrap.innerHTML = "";
      wrap.style.display = "none";
      wrap.removeAttribute("data-visible");
      return;
    }
    wrap.style.display = "";
    wrap.setAttribute("data-visible", "1");
    var lintas = !!(typeof OsisAuth.isLintasAngkatan === "function" && OsisAuth.isLintasAngkatan());
    var aktifId = typeof OsisAuth.getAngkatanAktif === "function" ? OsisAuth.getAngkatanAktif() : null;
    var list = typeof OsisAuth.getAngkatanList === "function" ? OsisAuth.getAngkatanList() : [];
    var aktifObj = typeof OsisAuth.getAngkatanAktifObj === "function" ? OsisAuth.getAngkatanAktifObj() : null;
    if (!lintas) {
      var lbl = (aktifObj && aktifObj.nama) || u.angkatan || "OSIS";
      wrap.innerHTML =
        '<div class="ang-more-lbl"><i class="fa-solid fa-graduation-cap"></i><span>Angkatan</span></div>' +
        '<div class="ang-more-pill" title="Angkatan terkunci ke akunmu"><span>' + esc(lbl) + "</span></div>";
      return;
    }
    if (!list.length) {
      var lblLintas = (aktifObj && aktifObj.nama) || "Memuat angkatan...";
      wrap.innerHTML =
        '<div class="ang-more-lbl"><i class="fa-solid fa-layer-group"></i><span>Angkatan Aktif</span></div>' +
        '<div class="ang-more-pill" title="Akses lintas angkatan"><span>' + esc(lblLintas) + "</span></div>";
      return;
    }
    var opts = "";
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      var sel = Number(a.id) === Number(aktifId) ? " selected" : "";
      var teks = String(a.nama || a.kode || ("Angkatan " + a.id)) + (a.aktif === false ? " (Arsip)" : "");
      opts += '<option value="' + esc(a.id) + '"' + sel + ">" + esc(teks) + "</option>";
    }
    wrap.innerHTML =
      '<div class="ang-more-lbl"><i class="fa-solid fa-layer-group"></i><span>Angkatan Aktif</span></div>' +
      '<select id="' + ANG_SEL_ID + '" class="ang-more-select" title="Ganti angkatan aktif" aria-label="Pilih angkatan">' + opts + "</select>";
    var el = document.getElementById(ANG_SEL_ID);
    if (el) {
      el.addEventListener("change", function () {
        var newId = Number(el.value || 0);
        if (!newId || newId === Number(aktifId)) return;
        OsisAuth.setAngkatanAktif(newId);
        close();
        try { location.reload(); } catch (e) {}
      });
    }
  }

  function muatAngkatan() {
    if (_angFetched || !diHalamanOsis()) return;
    var u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser && OsisAuth.getUser()) || null;
    if (!u || u.mode !== "osis" || typeof getAngkatanList !== "function") return;
    _angFetched = true;
    var beforeId = typeof OsisAuth.getAngkatanAktif === "function" ? OsisAuth.getAngkatanAktif() : null;
    getAngkatanList().then(function (list) {
      renderAngkatan();
      if (typeof OsisAuth.isLintasAngkatan === "function" && OsisAuth.isLintasAngkatan() && !beforeId && list && list.length) {
        var afterId = OsisAuth.getAngkatanAktif();
        if (afterId) {
          OsisAuth.setAngkatanAktif(afterId);
          try {
            if (!sessionStorage.getItem("osis_ang_boot_reload")) {
              sessionStorage.setItem("osis_ang_boot_reload", "1");
              location.reload();
              return;
            }
          } catch (e) {}
        }
      }
      try { sessionStorage.removeItem("osis_ang_boot_reload"); } catch (e) {}
    }).catch(function () {});
  }

  function refresh() {
    var wrap = document.getElementById(WRAP_ID) || bangun();
    renderAngkatan();
    if (!wrap) return;
    var narrow = false;
    try {
      narrow = window.innerWidth <= 700;
    } catch (e) {}
    var logged = false;
    var isOsis = false;
    try {
      var u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser && OsisAuth.getUser()) || null;
      logged = !!u;
      isOsis = !!(u && u.mode === "osis");
    } catch (e) {}
    // Selalu tampil kayak publik (desktop + HP).
    wrap.classList.add("show");
    wrap.style.display = "";
    var beranda = document.getElementById(BERANDA_ID);
    if (beranda) beranda.style.display = narrow ? "" : "none";
    var vis = document.getElementById(VISITOR_ID);
    if (vis) vis.style.display = narrow && isOsis ? "" : "none";
    var keluar = document.getElementById(LOGOUT_ID);
    if (keluar) keluar.style.display = logged ? "" : "none";
    muatAngkatan();
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
  window.addEventListener("resize", function () {
    refresh();
  });
  window.OsisMore = { toggle: toggle, close: close, refresh: refresh, renderAngkatan: renderAngkatan };
})();
