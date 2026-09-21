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
    var diSub = /(^|\/)(osis|osisbin)\//.test(pathBersih);
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
  var promptTunda = null;
  var tombol = null;

  function sudahStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    );
  }

  function buatTombol() {
    if (tombol || sudahStandalone()) return;
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
    tombol.addEventListener("click", async function () {
      if (!promptTunda) return;
      promptTunda.prompt();
      await promptTunda.userChoice.catch(function () {});
      promptTunda = null;
      sembunyiTombol();
    });
    document.body.appendChild(tombol);
  }

  function tampilTombol() {
    if (!tombol || sudahStandalone()) return;
    tombol.style.display = "inline-flex";
  }

  function sembunyiTombol() {
    if (tombol) tombol.style.display = "none";
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

  // ---- 3) Outbox offline — muat sibling js/outbox.js (1 file untuk js+jsbin) ----
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
    hintIOS();
    muatOutbox();
  });

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
