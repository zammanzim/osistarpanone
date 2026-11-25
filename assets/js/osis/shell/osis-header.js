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
  var THEME_ROW_ID = "osisMoreThemeRow";
  var THEME_TOGGLE_ID = "osisMoreThemeToggle";
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
      "#osisMoreVisitor span,#" + THEME_ROW_ID + " .more-lbl-ico{display:inline-flex;align-items:center;gap:8px}" +
      "@media (max-width:700px){" +
      ".top-nav-extra>a.btn{display:none!important}" +
      ".top-nav-extra #areaAuth .icon-btn{display:none!important}" +
      "#osisVisitorTrigger{display:none!important}" +
      "#" + BERANDA_ID + "{order:1}" +
      "#" + VISITOR_ID + "{order:2}" +
      "#" + THEME_ROW_ID + "{order:3}" +
      "#" + PENG_ID + "{order:4}" +
      "#headerMorePush{order:5}" +
      "#" + LOGOUT_ID + "{order:6}" +
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
      '<label class="header-more-item" id="' + THEME_ROW_ID + '"><span class="more-lbl-ico"><i class="fa-solid fa-moon"></i> Mode Gelap</span><span class="edit-toggle-wrap small"><input type="checkbox" id="' + THEME_TOGGLE_ID + '" autocomplete="off" /><span class="edit-slider"></span></span></label>' +
      '<a href="../index#/pengaturan" class="header-more-item" id="' + PENG_ID + '"><i class="fa-solid fa-gear"></i> Pengaturan</a>' +
      '<button class="header-more-item danger" id="' + LOGOUT_ID + '" style="display:none"><i class="fa-solid fa-arrow-right-from-bracket"></i> Keluar</button>' +
      "</div>";
    extra.appendChild(wrap);
    var temaEl = document.getElementById(THEME_TOGGLE_ID);
    if (temaEl) {
      try {
        temaEl.checked = (window.TarpanTheme && TarpanTheme.isDark)
          ? TarpanTheme.isDark()
          : (document.documentElement.getAttribute("data-theme") === "dark");
      } catch (e) {}
      temaEl.addEventListener("change", function () {
        var dark = !!temaEl.checked;
        if (window.TarpanTheme && TarpanTheme.set) {
          TarpanTheme.set(dark ? "dark" : "light");
          return;
        }
        try { localStorage.setItem("tarpan_theme", dark ? "dark" : "light"); } catch (e) {}
        if (dark) document.documentElement.setAttribute("data-theme", "dark");
        else document.documentElement.removeAttribute("data-theme");
        document.documentElement.style.backgroundColor = "";
        try {
          var meta = document.querySelector('meta[name="theme-color"]');
          if (meta) meta.setAttribute("content", dark ? "#16131b" : "#e11d2e");
        } catch (e) {}
      });
    }
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

  function userLokal() {
    try {
      if (typeof OsisAuth !== "undefined" && OsisAuth.getUser) return OsisAuth.getUser();
      return JSON.parse(localStorage.getItem("osis_user") || "null");
    } catch (e) {
      return null;
    }
  }

  function aksesLokal() {
    try {
      if (typeof OsisAuth !== "undefined" && OsisAuth.getAkses) return OsisAuth.getAkses();
      return JSON.parse(localStorage.getItem("osis_akses") || "null");
    } catch (e) {
      return null;
    }
  }

  function angkatanListLokal() {
    try {
      if (typeof OsisAuth !== "undefined" && OsisAuth.getAngkatanList) return OsisAuth.getAngkatanList();
      var arr = JSON.parse(localStorage.getItem("osis_angkatan_list") || "[]");
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function isLintasLokal(u, a) {
    if (typeof OsisAuth !== "undefined" && typeof OsisAuth.isLintasAngkatan === "function") {
      return !!OsisAuth.isLintasAngkatan();
    }
    if (!u || u.mode !== "osis") return false;
    if (a && typeof a.lintas_angkatan === "boolean") return a.lintas_angkatan;
    if (a && a.super) return true;
    if (typeof u.lintas_angkatan === "boolean") return u.lintas_angkatan;
    var jab = String(u.jabatan || "").trim().toUpperCase();
    var ang = String(u.angkatan || "").trim().toUpperCase();
    return jab === "PEMBINA" || ang === "PEMBINA";
  }

  function angkatanAktifLokal(u, a, list) {
    if (typeof OsisAuth !== "undefined" && typeof OsisAuth.getAngkatanAktif === "function") {
      return OsisAuth.getAngkatanAktif();
    }
    if (!u || u.mode !== "osis") return null;
    if (!isLintasLokal(u, a)) return u.angkatan_id ? Number(u.angkatan_id) : null;
    var saved = 0;
    try { saved = Number(localStorage.getItem("osis_angkatan_aktif") || 0); } catch (e) {}
    if (saved > 0 && (!list.length || list.some(function (x) { return Number(x.id) === saved; }))) {
      return saved;
    }
    if (u.angkatan_id && Number(u.angkatan_id) > 0) return Number(u.angkatan_id);
    if (list.length > 0) {
      var yr = new Date().getFullYear();
      var pick = list.find(function (x) { return x.aktif && Number(x.tahun) === yr; }) ||
        list.find(function (x) { return x.aktif; }) ||
        list[0];
      if (pick && pick.id) return Number(pick.id);
    }
    return null;
  }

  function angkatanAktifObjLokal(u, aktifId, list) {
    if (typeof OsisAuth !== "undefined" && typeof OsisAuth.getAngkatanAktifObj === "function") {
      return OsisAuth.getAngkatanAktifObj();
    }
    if (aktifId) {
      var hit = list.find(function (x) { return Number(x.id) === Number(aktifId); });
      if (hit) return hit;
    }
    if (u && u.mode === "osis") {
      return {
        id: u.angkatan_id || aktifId || null,
        nama: String(u.angkatan || "").trim(),
        kode: "",
      };
    }
    return null;
  }

  function displayNameLokal(user) {
    if (!user) return "";
    if (typeof OsisAuth !== "undefined" && typeof OsisAuth.displayName === "function") {
      return OsisAuth.displayName(user);
    }
    if (user.mode === "osis" || user.mode === "biasa") {
      return String(user.nama || user.username || "").trim();
    }
    return String(user.nickname || "").trim();
  }

  function renderAngkatan() {
    var wrap = bangunAngkatan();
    if (!wrap) return;
    var u = userLokal();
    if (!u || u.mode !== "osis") {
      wrap.innerHTML = "";
      wrap.style.display = "none";
      wrap.removeAttribute("data-visible");
      return;
    }
    wrap.style.display = "";
    wrap.setAttribute("data-visible", "1");
    var a = aksesLokal();
    var list = angkatanListLokal();
    var lintas = isLintasLokal(u, a);
    var aktifId = angkatanAktifLokal(u, a, list);
    var aktifObj = angkatanAktifObjLokal(u, aktifId, list);
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
      var it = list[i];
      var sel = Number(it.id) === Number(aktifId) ? " selected" : "";
      var teks = String(it.nama || it.kode || ("Angkatan " + it.id)) + (it.aktif === false ? " (Arsip)" : "");
      opts += '<option value="' + esc(it.id) + '"' + sel + ">" + esc(teks) + "</option>";
    }
    wrap.innerHTML =
      '<div class="ang-more-lbl"><i class="fa-solid fa-layer-group"></i><span>Angkatan Aktif</span></div>' +
      '<select id="' + ANG_SEL_ID + '" class="ang-more-select" title="Ganti angkatan aktif" aria-label="Pilih angkatan">' + opts + "</select>";
    var el = document.getElementById(ANG_SEL_ID);
    if (el) {
      el.addEventListener("change", function () {
        var newId = Number(el.value || 0);
        if (!newId || newId === Number(aktifId)) return;
        if (typeof OsisAuth !== "undefined" && OsisAuth.setAngkatanAktif) {
          OsisAuth.setAngkatanAktif(newId);
        }
        close();
        try { location.reload(); } catch (e) {}
      });
    }
  }

  function muatAngkatan() {
    if (_angFetched || !diHalamanOsis()) return;
    var u = userLokal();
    if (!u || u.mode !== "osis" || typeof getAngkatanList !== "function") return;
    _angFetched = true;
    var beforeId = typeof OsisAuth !== "undefined" && typeof OsisAuth.getAngkatanAktif === "function" ? OsisAuth.getAngkatanAktif() : null;
    getAngkatanList().then(function (list) {
      renderAngkatan();
      try {
        window.dispatchEvent(new CustomEvent("osis:angkatan-ready", { detail: list || [] }));
      } catch (e) {}
      if (typeof OsisAuth !== "undefined" && typeof OsisAuth.isLintasAngkatan === "function" && OsisAuth.isLintasAngkatan() && !beforeId && list && list.length) {
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
      var u = userLokal();
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

  // Hydrate sinkron sebelum frame pertama (dipanggil tepat setelah </header>):
  // Logo R2, Sidebar + tombol hamburger + judul desktop, Visitor pill, User Chip, & titik-tiga.
  function pasangLogoAwal() {
    try {
      var img = document.querySelector('header.top-nav [data-foto="logo1"]');
      if (!img) return;
      var path = "web/logo1.png";
      var raw = localStorage.getItem("osis_cache_v3_web_foto");
      if (raw) {
        var obj = JSON.parse(raw);
        var arr = obj && Array.isArray(obj.data) ? obj.data : null;
        if (arr) {
          for (var i = 0; i < arr.length; i++) {
            if (arr[i] && arr[i].kunci === "logo1" && arr[i].path) {
              path = String(arr[i].path);
              break;
            }
          }
        }
      }
      var url = path.indexOf("http") === 0
        ? path
        : ((typeof R2_PUBLIC_BASE === "string" && R2_PUBLIC_BASE.indexOf("http") === 0
            ? R2_PUBLIC_BASE.replace(/\/$/, "")
            : "https://media.osistarpanone.my.id") + "/" + path.replace(/^\/+/, ""));
      img.decoding = "sync";
      if (img.getAttribute("src") !== url) img.src = url;
    } catch (e) {}
  }

  function hitungVisitorCache(u) {
    try {
      if (!u || u.mode !== "osis") return null;
      var a = aksesLokal();
      var list = angkatanListLokal();
      var angId = angkatanAktifLokal(u, a, list);
      var key = angId ? ("osis_cache_v3_ang_" + angId + "_osis_visitor") : "osis_cache_v3_osis_visitor";
      var raw = localStorage.getItem(key) || (angId ? localStorage.getItem("osis_cache_v3_osis_visitor") : null);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      var rows = obj && Array.isArray(obj.data) ? obj.data : null;
      if (!rows) return null;
      var fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" });
      var tglHariIni = fmt.format(new Date());
      var n = 0;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i] && rows[i].last_seen && fmt.format(new Date(rows[i].last_seen)) === tglHariIni) n++;
      }
      return n.toLocaleString("id-ID");
    } catch (e) {
      return null;
    }
  }

  function pasangVisitorAwal(u) {
    try {
      var extra = document.querySelector(".top-nav-extra");
      if (!extra) return null;
      var btn = document.getElementById("osisVisitorTrigger");
      if (!btn) {
        btn = document.createElement("button");
        btn.type = "button";
        btn.className = "visitor-trigger";
        btn.id = "osisVisitorTrigger";
        btn.title = "Pengunjung hari ini";
        btn.setAttribute("onclick", "typeof OsisVisitor!=='undefined'&&OsisVisitor.bukaPopup()");
        btn.innerHTML = '<i class="fa-solid fa-eye"></i><span id="osisVisitorCount">-</span>';
        extra.insertBefore(btn, extra.firstChild);
      }
      var isOsis = !!(u && u.mode === "osis" && u.id);
      btn.style.display = isOsis ? "" : "none";
      return isOsis ? hitungVisitorCache(u) : null;
    } catch (e) {
      return null;
    }
  }

  function pasangAuthAwal(u) {
    try {
      var area = document.getElementById("areaAuth");
      if (!area) return;
      var disp = displayNameLokal(u);
      var sig = u
        ? [u.mode || "", u.id || "", disp, u.jabatan || "", "1"].join("|")
        : "anon|1";
      if (area.dataset && area.dataset.authSig === sig && area.children.length > 0) return;
      if (area.dataset) area.dataset.authSig = sig;
      if (!u) {
        area.innerHTML =
          '\n                <a href="../login" class="btn btn-red btn-sm" onclick="typeof OsisAuth!==\'undefined\'&&OsisAuth.simpanBack()"><i class="fa-solid fa-right-to-bracket"></i> Masuk</a>';
        return;
      }
      var isOsis = u.mode === "osis";
      var isBiasa = u.mode === "biasa";
      var ikon = isOsis ? '<i class="fa-solid fa-id-card"></i>' : '<i class="fa-solid fa-user"></i>';
      var judul = isOsis ? (u.jabatan || "Anggota OSIS") : (isBiasa ? "Akun Biasa" : "Tamu");
      var namaChip = esc(disp) || esc(u.username || "Akun");
      var tombolKeluar =
        '\n            <button class="icon-btn" title="Keluar" onclick="typeof OsisAuth!==\'undefined\'&&OsisAuth.confirmLogout()">\n                <i class="fa-solid fa-arrow-right-from-bracket"></i>\n            </button>';
      if (isOsis) {
        area.innerHTML =
          '\n                <a href="profil" class="user-chip" title="' + esc(judul) + ' — klik untuk buka profil">\n                    ' + ikon + "\n                    " + namaChip + "\n                </a>\n                " + tombolKeluar;
        return;
      }
      area.innerHTML =
        '\n            <span class="user-chip ' + (isBiasa ? "" : "chip-guest") + '" title="' + esc(judul) + '">\n                ' + ikon + "\n                " + namaChip + "\n            </span>\n            " + tombolKeluar;
    } catch (e) {}
  }

  function shellMount() {
    if (!diHalamanOsis()) return;
    try { document.documentElement.classList.add("osis-shell"); } catch (e) {}
    pasangLogoAwal();
    if (typeof OsisSidebar !== "undefined" && typeof OsisSidebar.pasang === "function") {
      OsisSidebar.pasang();
    }
    var u = userLokal();
    var jmlVis = pasangVisitorAwal(u);
    pasangAuthAwal(u);
    pasangCss();
    bangun();
    refresh();
    if (jmlVis !== null) {
      var c1 = document.getElementById("osisVisitorCount");
      if (c1) c1.textContent = jmlVis;
      var c2 = document.getElementById("osisMoreVisitorCount");
      if (c2) c2.textContent = jmlVis;
    }
  }

  function init() {
    shellMount();
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

  window.OsisShellMount = shellMount;

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

  // Helper bersama untuk tampilan Accordion per Angkatan & guard edit/hapus per angkatan
  var _accOpen = {};
  var _otherOpen = {};

  function activeFocusId() {
    var focusId = null;
    if (typeof DbScope !== "undefined" && DbScope.angkatanId) focusId = DbScope.angkatanId();
    else if (typeof OsisAuth !== "undefined" && OsisAuth.getAngkatanAktif) focusId = OsisAuth.getAngkatanAktif();
    var u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser) ? OsisAuth.getUser() : null;
    if (!focusId && u && u.angkatan_id) focusId = Number(u.angkatan_id);
    return focusId ? Number(focusId) : null;
  }

  function escHtml(s) {
    if (typeof escapeHtml === "function") return escapeHtml(s);
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
    });
  }

  function bisaKelolaItem(halaman, item) {
    if (typeof OsisAuth === "undefined") return false;
    if (halaman && (!OsisAuth.bisa || !OsisAuth.bisa(halaman))) return false;
    if (typeof OsisAuth.isLintasAngkatan === "function" && OsisAuth.isLintasAngkatan()) return true;
    if (!item || item.angkatan_id == null || item.angkatan_id === "") return true;
    var u = (OsisAuth.getUser && OsisAuth.getUser()) || {};
    var myId = u.angkatan_id || (OsisAuth.getAngkatanAktif && OsisAuth.getAngkatanAktif());
    return !myId || Number(item.angkatan_id) === Number(myId);
  }

  function kelompokAngkatan(rows) {
    var list = (typeof OsisAuth !== "undefined" && OsisAuth.getAngkatanList) ? OsisAuth.getAngkatanList() : [];
    var metaById = new Map();
    (list || []).forEach(function (a, idx) {
      if (a && a.id != null) metaById.set(String(a.id), { a: a, idx: idx });
    });

    var focusId = null;
    if (typeof DbScope !== "undefined" && DbScope.angkatanId) focusId = DbScope.angkatanId();
    else if (typeof OsisAuth !== "undefined" && OsisAuth.getAngkatanAktif) focusId = OsisAuth.getAngkatanAktif();
    var u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser) ? OsisAuth.getUser() : null;
    if (!focusId && u && u.angkatan_id) focusId = Number(u.angkatan_id);

    var groups = new Map();
    (rows || []).forEach(function (r) {
      var aid = (r && r.angkatan_id != null && Number(r.angkatan_id) > 0) ? Number(r.angkatan_id) : 0;
      var k = String(aid);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    });

    var out = [];
    groups.forEach(function (items, k) {
      var aid = Number(k);
      var hit = metaById.get(k);
      var a = hit ? hit.a : null;
      var label = a ? (a.nama || a.kode || ("Angkatan " + k)) : (aid ? ("Angkatan #" + k) : "Arsip / Lainnya");
      var th = a && a.tahun != null ? Number(a.tahun) : null;
      out.push({
        key: k,
        id: aid,
        nama: label,
        kode: a ? (a.kode || "") : "",
        tahun: Number.isFinite(th) ? th : null,
        aktif: a ? !!a.aktif : false,
        urutan: a && a.urutan != null ? Number(a.urutan) : 0,
        isFocus: !!focusId && aid === Number(focusId),
        items: items
      });
    });

    // Angkatan aktif di paling atas, lalu yang terbaru -> lama, lalu tanpa angkatan
    out.sort(function (x, y) {
      if (x.isFocus !== y.isFocus) return x.isFocus ? -1 : 1;
      if ((x.id > 0) !== (y.id > 0)) return x.id > 0 ? -1 : 1;
      if (x.aktif !== y.aktif) return x.aktif ? -1 : 1;
      var tx = x.tahun != null ? x.tahun : -1;
      var ty = y.tahun != null ? y.tahun : -1;
      if (tx !== ty) return ty - tx;
      if (x.urutan !== y.urutan) return y.urutan - x.urutan;
      return y.id - x.id;
    });
    return out;
  }

  function pisahAngkatan(rows) {
    var focusId = activeFocusId();
    var all = Array.isArray(rows) ? rows : [];
    if (!focusId) {
      return { focusId: null, ownItems: all.slice(), otherGroups: [], otherTotal: 0 };
    }
    var groups = kelompokAngkatan(all);
    var ownItems = [];
    var otherGroups = [];
    var otherTotal = 0;
    groups.forEach(function (g) {
      if (g.isFocus) ownItems = g.items;
      else {
        otherGroups.push(g);
        otherTotal += g.items.length;
      }
    });
    return { focusId: focusId, ownItems: ownItems, otherGroups: otherGroups, otherTotal: otherTotal };
  }

  function milikAktif(rows) {
    return pisahAngkatan(rows).ownItems;
  }

  function renderGroupAccordionHtml(groups, modKey, bodyCls, hasFilter, renderItems, defaultSingleOpen) {
    var openState = _accOpen[modKey] || (_accOpen[modKey] = {});
    return groups.map(function (g) {
      var isOpen;
      if (hasFilter) {
        isOpen = true;
      } else {
        if (!(g.key in openState)) {
          openState[g.key] = !!(g.isFocus || (defaultSingleOpen && groups.length === 1));
        }
        isOpen = !!openState[g.key];
      }
      var pill = g.isFocus
        ? '<span class="ang-acc-pill aktif"><i class="fa-solid fa-star"></i> Aktif</span>'
        : (g.id && !g.aktif ? '<span class="ang-acc-pill arsip"><i class="fa-solid fa-box-archive"></i> Arsip</span>' : "");
      return (
        '<section class="ang-acc' + (isOpen ? " open" : "") + (g.isFocus ? " is-focus" : "") + '" data-ang-acc="' + escHtml(g.key) + '">' +
          '<button type="button" class="ang-acc-head" aria-expanded="' + (isOpen ? "true" : "false") + '" data-ang-acc-btn="' + escHtml(g.key) + '">' +
            '<span class="ang-acc-title">' +
              '<span class="ang-acc-ico"><i class="fa-solid ' + (g.isFocus ? "fa-layer-group" : "fa-folder-open") + '"></i></span>' +
              '<span class="ang-acc-name">' + escHtml(g.nama) + "</span>" +
              pill +
            "</span>" +
            '<span class="ang-acc-right">' +
              '<span class="ang-acc-count">' + g.items.length + "</span>" +
              '<i class="fa-solid fa-chevron-down ang-acc-chev"></i>' +
            "</span>" +
          "</button>" +
          '<div class="ang-acc-body">' +
            '<div class="' + escHtml(bodyCls) + '">' + (renderItems ? renderItems(g.items, g) : "") + "</div>" +
          "</div>" +
        "</section>"
      );
    }).join("");
  }

  function bindAccEvents(container, modKey) {
    if (container._angAccBound === modKey) return;
    container._angAccBound = modKey;
    container.addEventListener("click", function (e) {
      var othBtn = e.target.closest("[data-ang-other-toggle]");
      if (othBtn && container.contains(othBtn)) {
        _otherOpen[modKey] = !_otherOpen[modKey];
        var st = container._angSplitState;
        if (st && st.opts && typeof st.opts.onToggleOther === "function") {
          st.opts.onToggleOther(!!_otherOpen[modKey]);
        } else if (st) {
          renderSplit(container, st.rows, st.opts);
        }
        return;
      }
      var btn = e.target.closest("[data-ang-acc-btn]");
      if (!btn || !container.contains(btn)) return;
      var k = btn.getAttribute("data-ang-acc-btn");
      var sec = btn.closest(".ang-acc");
      if (!sec) return;
      var next = !sec.classList.contains("open");
      sec.classList.toggle("open", next);
      btn.setAttribute("aria-expanded", next ? "true" : "false");
      (_accOpen[modKey] || (_accOpen[modKey] = {}))[k] = next;
    });
  }

  function renderAccordion(container, rows, opts) {
    if (!container) return;
    opts = opts || {};
    var modKey = String(opts.key || container.id || "modul");
    var hasFilter = !!opts.hasFilter;
    var groups = kelompokAngkatan(rows);

    if (!groups.length) {
      container.innerHTML = String(opts.emptyHtml || "") + String(opts.afterHtml || "");
      return;
    }

    var bodyCls = opts.bodyClass ? String(opts.bodyClass) : "ang-acc-stack";
    container.innerHTML = renderGroupAccordionHtml(groups, modKey, bodyCls, hasFilter, opts.renderItems, false)
      + String(opts.afterHtml || "");
    bindAccEvents(container, modKey);
  }

  function renderSplit(container, rows, opts) {
    if (!container) return;
    opts = opts || {};
    var modKey = String(opts.key || container.id || "modul");
    container._angSplitState = { rows: rows, opts: opts };
    var hasFilter = !!opts.hasFilter;
    var split = pisahAngkatan(rows);
    var bodyCls = opts.bodyClass ? String(opts.bodyClass) : "ang-acc-stack";
    var tailHtml = opts.afterHtml ? '<div class="ang-other-tail">' + String(opts.afterHtml) + "</div>" : "";

    if (!rows || !rows.length) {
      container.innerHTML = String(opts.emptyHtml || "") + tailHtml;
      bindAccEvents(container, modKey);
      return;
    }

    var topHtml = split.ownItems.length
      ? (opts.renderItems ? opts.renderItems(split.ownItems, null) : "")
      : (opts.emptyOwnHtml ? '<div class="ang-own-empty">' + String(opts.emptyOwnHtml) + "</div>" : "");

    var otherHtml = "";
    if (split.otherGroups.length) {
      var isOtherOpen = !!_otherOpen[modKey];
      var noun = opts.label ? (" " + String(opts.label)) : "";
      var btnTxt = isOtherOpen
        ? "Sembunyikan angkatan lain (" + split.otherTotal + ")"
        : "Lihat " + split.otherTotal + noun + " angkatan lain (" + split.otherGroups.length + " angkatan)";
      var accHtml = isOtherOpen
        ? '<div class="ang-acc-list ang-other-list">' +
            renderGroupAccordionHtml(split.otherGroups, modKey, bodyCls, hasFilter, opts.renderItems, true) +
          "</div>"
        : "";
      otherHtml =
        '<div class="ang-other-box' + (isOtherOpen ? " open" : "") + '">' +
          '<div class="ang-other-bar">' +
            '<button type="button" class="ang-other-toggle" data-ang-other-toggle="1" aria-expanded="' + (isOtherOpen ? "true" : "false") + '">' +
              '<i class="fa-solid fa-layer-group"></i>' +
              '<span>' + escHtml(btnTxt) + "</span>" +
              '<i class="fa-solid fa-chevron-down ang-other-chev"></i>' +
            "</button>" +
          "</div>" +
          accHtml +
        "</div>";
    }

    container.innerHTML = topHtml + otherHtml + tailHtml;
    bindAccEvents(container, modKey);
  }

  window.OsisAngkatanUi = {
    bisaKelolaItem: bisaKelolaItem,
    kelompok: kelompokAngkatan,
    pisah: pisahAngkatan,
    milikAktif: milikAktif,
    isOtherOpen: function (modKey) {
      return !!_otherOpen[String(modKey || "")];
    },
    renderAccordion: renderAccordion,
    renderSplit: renderSplit,
    resetOpen: function (modKey) {
      if (modKey) {
        delete _accOpen[modKey];
        delete _otherOpen[modKey];
      }
    }
  };
})();
