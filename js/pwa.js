// =========================================================================
// PWA — registrasi Service Worker + tombol Install App (dipakai semua halaman)
// Include setelah js/app.js. Aman di file:// (SW dilewati) & HTTP/HTTPS.
// =========================================================================
(function () {
  "use strict";

  var reloadSiap = false;

  function toast(msg, tipe) {
    if (typeof window.showToast === "function") window.showToast(msg, tipe || "success");
  }

  // ---- 1) Registrasi Service Worker ----
  function daftarSW() {
    if (!("serviceWorker" in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return; // file:// tidak dukung SW
    var pathBersih = location.pathname.replace(/\\/g, "/");
    var diSub = /(^|\/)osis\//.test(pathBersih);
    var swUrl = diSub ? "../sw.js" : "sw.js";
    // Ada controller sejak awal = kunjungan ulang (sudah ada SW aktif).
    // Kalau null = kunjungan pertama, jangan reload (tidak ada versi lama).
    var punyaControllerAwal = !!navigator.serviceWorker.controller;

    // Rem: reload otomatis maksimal 1x per 60 detik per tab.
    // Tanpa ini, controllerchange beruntun (update/claim ganda) = refresh berulang.
    function bolehMuatUlang() {
      try {
        var kunci = "pwa_last_reload";
        var terakhir = parseInt(sessionStorage.getItem(kunci) || "0", 10);
        if (Date.now() - terakhir < 60000) return false;
        sessionStorage.setItem(kunci, String(Date.now()));
        return true;
      } catch (e) {
        if (reloadSiap) return false;
        reloadSiap = true;
        return true;
      }
    }

    function mintaAktif(reg) {
      if (reg.waiting && navigator.serviceWorker.controller) {
        toast("Versi baru siap — memuat ulang…", "info");
        reg.waiting.postMessage("SKIP_WAITING");
      }
    }

    navigator.serviceWorker
      .register(swUrl)
      .then(function (reg) {
        // SW baru yang sudah menunggu (mis. terinstal dari tab lain): aktifkan sekali.
        mintaAktif(reg);
        // Update otomatis: kalau ada SW baru, aktifkan lalu reload sekali (dibatasi).
        reg.addEventListener("updatefound", function () {
          var baru = reg.installing;
          if (!baru) return;
          baru.addEventListener("statechange", function () {
            if (baru.state === "installed") mintaAktif(reg);
          });
        });
      })
      .catch(function () {});

    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (!punyaControllerAwal) {
        // Kunjungan pertama (claim awal): tidak perlu reload.
        punyaControllerAwal = true;
        return;
      }
      if (!bolehMuatUlang()) return;
      location.reload();
    });
  }

  // ---- 2) Tombol Install App (Android/Desktop; iOS pakai hint) ----
  // Desktop: pill di kanan atas header (.top-nav-extra).
  // Mobile (<=700px): item di dalam menu titik-tiga (#headerMoreMenu).
  // Halaman tanpa header itu: fallback tombol floating lama.
  var promptTunda = null;
  var tombol = null;    // pill desktop / fallback floating
  var itemMenu = null;  // item more-menu (mobile)

  function sudahStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    );
  }

  function pasangCss() {
    if (document.getElementById("pwaInstallCss")) return;
    var st = document.createElement("style");
    st.id = "pwaInstallCss";
    st.textContent =
      "#pwaInstallBtn{display:none;align-items:center;gap:6px;padding:8px 14px;" +
      "border:2.5px solid var(--ink,#1a1314);border-radius:999px;background:var(--white,#fff);" +
      "font-family:inherit;font-size:.78rem;font-weight:800;color:var(--ink,#1a1314);cursor:pointer;" +
      "box-shadow:2px 2px 0 var(--ink,#1a1314);white-space:nowrap}" +
      "#pwaInstallBtn i{color:var(--red,#e11d2e)}" +
      "#pwaInstallBtn:hover{transform:translate(-1px,-1px);box-shadow:3px 3px 0 var(--ink,#1a1314)}" +
      "#pwaInstallBtn:active{transform:translate(1px,1px);box-shadow:none}" +
      "@media (max-width:700px){#pwaInstallBtn{display:none!important}}" +
      "#headerMoreInstall{display:none}" +
      "#headerMoreInstall i{color:var(--red,#e11d2e)}";
    try { document.head.appendChild(st); } catch (e) {}
  }

  // Tembak prompt install browser. Dipakai tombol + menu.
  async function pasang() {
    if (!promptTunda) return false;
    try {
      promptTunda.prompt();
      await promptTunda.userChoice.catch(function () {});
    } catch (e) {}
    promptTunda = null;
    sembunyiTombol();
    return true;
  }

  function buatTombol() {
    if ((tombol || itemMenu) || sudahStandalone()) return;
    pasangCss();
    // 1) Item more-menu (mobile) — index saja yang punya #headerMoreMenu.
    var menu = document.getElementById("headerMoreMenu");
    if (menu && !document.getElementById("headerMoreInstall")) {
      itemMenu = document.createElement("button");
      itemMenu.type = "button";
      itemMenu.id = "headerMoreInstall";
      itemMenu.className = "header-more-item";
      itemMenu.innerHTML = '<i class="fa-solid fa-download"></i> Install App';
      itemMenu.addEventListener("click", function () {
        try {
          if (window.HeaderMore && HeaderMore.close) HeaderMore.close();
        } catch (e) {}
        var ios = /iphone|ipad|ipod/i.test(navigator.userAgent || "");
        if (ios && !promptTunda) {
          toast("iPhone: ketuk Bagikan → Tambah ke Layar Utama", "info");
          return;
        }
        pasang();
      });
      menu.appendChild(itemMenu);
    }
    // 2) Pill kanan atas header (desktop).
    var extra = document.querySelector(".top-nav-extra");
    if (extra && !document.getElementById("pwaInstallBtn")) {
      tombol = document.createElement("button");
      tombol.id = "pwaInstallBtn";
      tombol.type = "button";
      tombol.innerHTML = '<i class="fa-solid fa-download"></i><span>Install App</span>';
      tombol.setAttribute("aria-label", "Install aplikasi OSIS TARPAN ONE");
      tombol.addEventListener("click", function () { pasang(); });
      try {
        var wrap = document.getElementById("headerMoreWrap");
        if (wrap && wrap.parentNode === extra) extra.insertBefore(tombol, wrap);
        else extra.appendChild(tombol);
      } catch (e) {
        try { extra.appendChild(tombol); } catch (e2) {}
      }
    }
    // 3) Fallback halaman tanpa header: floating lama.
    if (!tombol && !itemMenu) {
      tombol = document.createElement("button");
      tombol.id = "pwaInstallBtn";
      tombol.type = "button";
      tombol.innerHTML = '<i class="fa-solid fa-download"></i><span>Install App</span>';
      tombol.setAttribute("aria-label", "Install aplikasi OSIS TARPAN ONE");
      tombol.style.cssText = [
        "position:fixed", "right:16px", "bottom:96px", "z-index:9999",
        "display:none", "align-items:center", "gap:8px",
        "padding:12px 16px", "border:2.5px solid #1a1314", "border-radius:999px",
        "background:#e11d2e", "color:#fff",
        "font-family:Outfit,sans-serif", "font-size:.82rem", "font-weight:800",
        "box-shadow:3px 3px 0 #1a1314", "cursor:pointer",
      ].join(";");
      tombol.addEventListener("click", function () { pasang(); });
      document.body.appendChild(tombol);
    }
  }

  function tampilTombol() {
    if (!tombol && !itemMenu) buatTombol();
    if (sudahStandalone()) return;
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent || "");
    if (ios) return; // iOS tidak ada prompt — jalurnya lewat tampilIOS()
    if (tombol) tombol.style.display = "inline-flex";
    if (itemMenu) itemMenu.style.display = "";
    try {
      if (window.HeaderMore && HeaderMore.refresh) HeaderMore.refresh();
    } catch (e) {}
  }

  // iOS tidak ada prompt: tampilkan item menu biar ada jalurnya (toast cara install).
  function tampilIOS() {
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent || "");
    if (!ios || sudahStandalone() || !itemMenu) return;
    itemMenu.style.display = "";
    try {
      if (window.HeaderMore && HeaderMore.refresh) HeaderMore.refresh();
    } catch (e) {}
  }

  function sembunyiTombol() {
    if (tombol) tombol.style.display = "none";
    if (itemMenu) itemMenu.style.display = "none";
    try {
      if (window.HeaderMore && HeaderMore.refresh) HeaderMore.refresh();
    } catch (e) {}
  }

  function hintIOS() {
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (!ios || sudahStandalone()) return;
    try {
      if (sessionStorage.getItem("pwa_ios_hint")) return;
      sessionStorage.setItem("pwa_ios_hint", "1");
    } catch (e) {}
    setTimeout(function () {
      toast("iPhone: ketuk Bagikan → Tambah ke Layar Utama", "info");
    }, 2500);
  }

  function onReady(fn) {
    if (document.readyState === "complete" || document.readyState === "interactive") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  // ---- 3) Outbox offline — muat sibling js/outbox.js ----
  function muatOutbox() {
    try {
      if (document.querySelector('script[data-outbox]')) return;
      var dalamSub = location.pathname.split("/").filter(Boolean).length > 1;
      var s = document.createElement("script");
      s.src = (dalamSub ? "../" : "") + "js/outbox.js";
      s.setAttribute("data-outbox", "1");
      document.head.appendChild(s);
    } catch (e) {}
  }

  // ---- 4) Push notif — muat sibling js/push.js (tombol lonceng + subscribe) ----
  function muatPush() {
    try {
      if (document.querySelector('script[data-push]')) return;
      if (!("Notification" in window) || !("PushManager" in window)) return;
      var dalamSub = location.pathname.split("/").filter(Boolean).length > 1;
      var s = document.createElement("script");
      s.src = (dalamSub ? "../" : "") + "js/push.js";
      s.defer = true;
      s.setAttribute("data-push", "1");
      document.head.appendChild(s);
    } catch (e) {}
  }

  // Pesan dari SW (Background Sync) — teruskan ke Outbox bila sudah termuat.
  try {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", function (e) {
        if (e && e.data === "OUTBOX_SYNC" && typeof Outbox !== "undefined")
          Outbox.processQueue({ silent: true });
      });
    }
  } catch (e) {}

  onReady(function () {
    daftarSW();
    buatTombol();
    tampilIOS();
    hintIOS();
    muatOutbox();
    muatPush();
  });

  // Buat HeaderMore (titik-tiga mobile): kapan menu boleh tampil.
  // True kalau prompt install siap ATAU iOS belum standalone (jalur toast).
  window.PwaInstall = {
    tersedia: function () {
      try {
        if (sudahStandalone()) return false;
        if (promptTunda) return true;
        return /iphone|ipad|ipod/i.test(navigator.userAgent || "");
      } catch (e) {
        return false;
      }
    },
    pasang: pasang,
  };

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    promptTunda = e;
    buatTombol();
    tampilTombol();
  });

  window.addEventListener("appinstalled", function () {
    promptTunda = null;
    sembunyiTombol();
    toast("Aplikasi terpasang!");
  });
})();
