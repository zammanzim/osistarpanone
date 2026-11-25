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

  // ---- 2) Menu Install App di titik-tiga (#headerMoreMenu / #osisMoreMenu) ----
  // Hanya tampil di dalam menu titik-tiga (publik index & internal /osis/*),
  // tanpa tombol luar #pwaInstallBtn dan tanpa tombol floating di halaman login.
  var promptTunda = null;
  var itemMenu = null;

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
      "#pwaInstallBtn{display:none!important}" +
      "#headerMoreInstall i{color:var(--red,#e11d2e)}";
    try { document.head.appendChild(st); } catch (e) {}
  }

  function segarkanMenu() {
    try {
      if (window.HeaderMore && HeaderMore.refresh) HeaderMore.refresh();
    } catch (e) {}
    try {
      if (window.OsisMore && OsisMore.refresh) OsisMore.refresh();
    } catch (e) {}
  }

  // Tembak prompt install browser. Dipakai item menu titik-tiga.
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

  function klikMenu() {
    try {
      if (window.HeaderMore && HeaderMore.close) HeaderMore.close();
    } catch (e) {}
    try {
      if (window.OsisMore && OsisMore.close) OsisMore.close();
    } catch (e) {}
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent || "");
    if (ios && !promptTunda) {
      toast("iPhone: ketuk Bagikan → Tambah ke Layar Utama", "info");
      return;
    }
    pasang();
  }

  function buatTombol() {
    try {
      var lamaLuar = document.getElementById("pwaInstallBtn");
      if (lamaLuar) lamaLuar.remove();
    } catch (e) {}
    if (sudahStandalone()) return;
    pasangCss();
    var menu = document.getElementById("headerMoreMenu") || document.getElementById("osisMoreMenu");
    if (!menu) return;
    var ada = document.getElementById("headerMoreInstall");
    if (ada) {
      itemMenu = ada;
      if (!itemMenu._pwaBound && !itemMenu.getAttribute("onclick")) {
        itemMenu._pwaBound = true;
        itemMenu.addEventListener("click", klikMenu);
      }
      return;
    }
    itemMenu = document.createElement("button");
    itemMenu.type = "button";
    itemMenu.id = "headerMoreInstall";
    itemMenu.className = "header-more-item";
    itemMenu.style.display = "none";
    itemMenu.innerHTML = '<i class="fa-solid fa-download"></i> Install App';
    itemMenu._pwaBound = true;
    itemMenu.addEventListener("click", klikMenu);
    var keluar = document.getElementById("headerMoreLogout") || document.getElementById("osisMoreLogout");
    if (keluar && keluar.parentNode === menu) menu.insertBefore(itemMenu, keluar);
    else menu.appendChild(itemMenu);
  }

  function tampilTombol() {
    if (!itemMenu) buatTombol();
    if (sudahStandalone()) return;
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent || "");
    if (ios) return; // iOS tidak ada prompt — jalurnya lewat tampilIOS()
    if (itemMenu) itemMenu.style.display = "";
    segarkanMenu();
  }

  // iOS tidak ada prompt: tampilkan item menu biar ada jalurnya (toast cara install).
  function tampilIOS() {
    if (!itemMenu) buatTombol();
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent || "");
    if (!ios || sudahStandalone() || !itemMenu) return;
    itemMenu.style.display = "";
    segarkanMenu();
  }

  function sembunyiTombol() {
    if (itemMenu) itemMenu.style.display = "none";
    segarkanMenu();
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

  // ---- 3) Outbox offline — muat assets/js/pwa/outbox.js ----
  function muatOutbox() {
    try {
      if (document.querySelector('script[data-outbox]')) return;
      var dalamSub = location.pathname.split("/").filter(Boolean).length > 1;
      var s = document.createElement("script");
      s.src = (dalamSub ? "../" : "") + "assets/js/pwa/outbox.js";
      s.setAttribute("data-outbox", "1");
      document.head.appendChild(s);
    } catch (e) {}
  }

  // ---- 4) Push notif — muat assets/js/pwa/push.js (tombol lonceng + subscribe) ----
  function muatPush() {
    try {
      if (document.querySelector('script[data-push]')) return;
      if (!("Notification" in window) || !("PushManager" in window)) return;
      var dalamSub = location.pathname.split("/").filter(Boolean).length > 1;
      var s = document.createElement("script");
      s.src = (dalamSub ? "../" : "") + "assets/js/pwa/push.js";
      s.defer = true;
      s.setAttribute("data-push", "1");
      document.head.appendChild(s);
    } catch (e) {}
  }

  // ---- 5) Context menu global — muat assets/js/shared/ui/context-menu.js ----
  function muatContextMenu() {
    try {
      if (document.querySelector('script[data-ctx-menu]')) return;
      var dalamSub = location.pathname.split("/").filter(Boolean).length > 1;
      var s = document.createElement("script");
      s.src = (dalamSub ? "../" : "") + "assets/js/shared/ui/context-menu.js";
      s.defer = true;
      s.setAttribute("data-ctx-menu", "1");
      document.head.appendChild(s);
    } catch (e) {}
  }

  // ---- 6) Manajemen tema — muat assets/js/shared/utilities/theme.js ----
  function muatTheme() {
    try {
      if (window.TarpanTheme || document.querySelector('script[data-theme-js]')) return;
      var dalamSub = location.pathname.split("/").filter(Boolean).length > 1;
      var s = document.createElement("script");
      s.src = (dalamSub ? "../" : "") + "assets/js/shared/utilities/theme.js";
      s.defer = true;
      s.setAttribute("data-theme-js", "1");
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
    muatContextMenu();
    muatTheme();
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
    klikMenu: klikMenu,
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
