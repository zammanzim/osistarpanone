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
    var diOsis = location.pathname.replace(/\\/g, "/").indexOf("/osis/") !== -1;
    var swUrl = diOsis ? "../sw.js" : "sw.js";

    navigator.serviceWorker
      .register(swUrl)
      .then(function (reg) {
        // Update otomatis: kalau ada SW baru, aktifkan lalu reload sekali.
        reg.addEventListener("updatefound", function () {
          var baru = reg.installing;
          if (!baru) return;
          baru.addEventListener("statechange", function () {
            if (baru.state === "installed" && navigator.serviceWorker.controller) {
              toast("Versi baru siap — memuat ulang…", "info");
              reg.waiting && reg.waiting.postMessage("SKIP_WAITING");
            }
          });
        });
      })
      .catch(function () {});

    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (reloadSiap) return;
      reloadSiap = true;
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

  onReady(function () {
    daftarSW();
    buatTombol();
    hintIOS();
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
