/* ============================================================
   CONTEXT MENU GLOBAL - OSIS TARPAN ONE
   Klik kanan (desktop) / tekan tahan ~550ms (HP) -> floating
   menu di posisi kursor/jari. Isi bawaan: muat ulang, salin
   tautan, install PWA. Input/textarea/contenteditable di-skip
   (menu native browser tetap jalan buat paste).
   - Dimuat otomatis dari js/pwa.js (pola muatPush).
   - API publik: KonteksMenu.buka(items, x, y) untuk manggil
     manual, KonteksMenu.daftar(kunci, fn) buat elemen [data-ctx].
   ============================================================ */
(function () {
  "use strict";

  var MN = null; // elemen menu
  var ISI = null; // wadah item
  var AKTIF = false;
  var registry = {}; // kunci data-ctx -> fn(elemen) -> items

  // state tekan-tahan (HP)
  var timer = null;
  var tahanX = 0;
  var tahanY = 0;
  var tahanEl = null;
  var cegahClick = false; // ghost click setelah long-press

  // ---- CSS neo-brutalism (inject sekali, pola pwa.js) ----
  function pasangCss() {
    if (document.getElementById("ctxCss")) return;
    var st = document.createElement("style");
    st.id = "ctxCss";
    st.textContent = [
      ".ctx{position:fixed;z-index:99999;background:var(--white,#fff);",
      "border:2.5px solid var(--ink,#1a1314);border-radius:14px;",
      "box-shadow:5px 5px 0 var(--ink,#1a1314);padding:6px;min-width:190px;",
      "display:flex;flex-direction:column;gap:2px;margin:0;",
      "opacity:0;visibility:hidden;transform:scale(.92);transform-origin:top left;",
      "transition:opacity .1s ease-in,transform .1s ease-in,visibility 0s linear .1s}",
      ".ctx.buka{opacity:1;visibility:visible;transform:none;",
      "transition:opacity .12s ease-out,transform .14s ease-out,visibility 0s}",
      ".ctx-item{display:flex;align-items:center;gap:10px;width:100%;padding:9px 12px;",
      "border:none;background:transparent;border-radius:9px;font-family:Outfit,sans-serif;",
      "font-size:.85rem;font-weight:700;color:var(--ink,#1a1314);cursor:pointer;",
      "text-align:left;line-height:1.2;-webkit-user-select:none;user-select:none}",
      ".ctx-item i{width:18px;text-align:center;color:var(--red,#e11d2e);font-size:.82rem;flex-shrink:0}",
      ".ctx-item:hover,.ctx-item:focus-visible{background:var(--paper-2,#f5efea);outline:none}",
      ".ctx-item:active{background:var(--line,#e8e0da)}",
      ".ctx-item.bahaya{color:var(--red,#e11d2e)}",
      ".ctx-item.bahaya:hover{background:var(--red,#e11d2e);color:#fff}",
      ".ctx-item.bahaya:hover i{color:#fff}",
      "@media (prefers-reduced-motion:reduce){.ctx,.ctx.buka{transition:none;transform:none}}",
    ].join("");
    try {
      document.head.appendChild(st);
    } catch (e) {}
  }

  function bangun() {
    if (MN) return;
    pasangCss();
    MN = document.createElement("div");
    MN.className = "ctx";
    MN.setAttribute("role", "menu");
    MN.setAttribute("aria-label", "Menu konteks");
    ISI = document.createElement("div");
    MN.appendChild(ISI);
    document.body.appendChild(MN);
  }

  function tutup() {
    if (!MN) return;
    MN.classList.remove("buka");
    MN.style.transform = "";
    AKTIF = false;
  }

  // ---- item bawaan ----
  function salinTautan() {
    var url = location.href;
    var bilang = function () {
      if (typeof showToast === "function") showToast("Tautan disalin!", "success");
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(bilang).catch(function () {
        if (typeof showToast === "function") showToast(url, "info");
      });
    } else if (typeof showToast === "function") {
      showToast(url, "info");
    }
  }

  function pasangApp() {
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent || "");
    try {
      Promise.resolve(window.PwaInstall.pasang()).then(function (ok) {
        if (ok) return;
        if (ios && typeof showToast === "function")
          showToast("iPhone: ketuk Bagikan → Tambah ke Layar Utama", "info");
      }).catch(function () {});
    } catch (e) {}
  }

  function itemBawaan() {
    var daftar = [
      {
        label: "Muat ulang",
        icon: "fa-solid fa-rotate-right",
        aksi: function () {
          location.reload();
        },
      },
      { label: "Salin tautan", icon: "fa-solid fa-link", aksi: salinTautan },
    ];
    try {
      if (window.PwaInstall && PwaInstall.tersedia())
        daftar.push({ label: "Install App", icon: "fa-solid fa-download", aksi: pasangApp });
    } catch (e) {}
    return daftar;
  }

  // elemen [data-ctx] terdekat yang punya registrasi -> items custom
  function dariData(t) {
    try {
      if (!t || !t.closest) return null;
      var el = t.closest("[data-ctx]");
      if (!el) return null;
      var fn = registry[el.getAttribute("data-ctx")];
      if (typeof fn !== "function") return null;
      var items = fn(el);
      return items && items.length ? items : null;
    } catch (e) {
      return null;
    }
  }

  // target boleh di-hijack? (input/textarea/contenteditable = biarin native)
  function sasar(t) {
    if (!t || t.nodeType !== 1) t = t && t.parentElement;
    if (!t) return false;
    var tag = t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return false;
    if (t.isContentEditable) return false;
    return true;
  }

  // ---- render + buka di posisi, auto-clamp ke viewport ----
  function buka(kustom, x, y) {
    if (!MN) bangun();
    var list = kustom || dariData(tahanEl) || itemBawaan();
    tahanEl = null;
    ISI.innerHTML = "";
    list.forEach(function (it) {
      if (!it || it.tampil === false) return;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ctx-item" + (it.bahaya ? " bahaya" : "");
      b.setAttribute("role", "menuitem");
      var i = document.createElement("i");
      i.className = it.icon || "fa-solid fa-circle";
      var s = document.createElement("span");
      s.textContent = it.label || "?";
      b.appendChild(i);
      b.appendChild(s);
      b.addEventListener("click", function () {
        tutup();
        try {
          if (it.aksi) it.aksi();
        } catch (e) {}
      });
      ISI.appendChild(b);
    });
    if (!ISI.children.length) return;

    // ukur tanpa transform biar clamp akurat
    MN.classList.remove("buka");
    MN.style.left = "0px";
    MN.style.top = "0px";
    MN.style.transform = "none";
    var r = MN.getBoundingClientRect();
    var px = x;
    var py = y;
    if (px + r.width > window.innerWidth - 8) px = window.innerWidth - 8 - r.width;
    if (py + r.height > window.innerHeight - 8) py = window.innerHeight - 8 - r.height;
    if (px < 8) px = 8;
    if (py < 8) py = 8;
    MN.style.left = Math.round(px) + "px";
    MN.style.top = Math.round(py) + "px";
    MN.style.transform = "";
    MN.classList.add("buka");
    AKTIF = true;
    var pertama = ISI.querySelector(".ctx-item");
    if (pertama) {
      try {
        pertama.focus({ preventScroll: true });
      } catch (e) {}
    }
    // sisain pilihan teks sebentar kepicu long-press -> bersihin
    try {
      window.getSelection().removeAllRanges();
    } catch (e) {}
  }

  // ---- tekan-tahan (HP/tablet) ----
  function batalkanTahan() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function onDown(e) {
    if (e.pointerType === "mouse") return; // mouse = lewat contextmenu
    batalkanTahan();
    if (!sasar(e.target)) return;
    if (e.button && e.button !== 0) return;
    tahanX = e.clientX;
    tahanY = e.clientY;
    tahanEl = e.target;
    timer = setTimeout(function () {
      timer = null;
      buka(null, tahanX, tahanY);
      // tombak click hantu sesaat abis long-press
      cegahClick = true;
      setTimeout(function () {
        cegahClick = false;
      }, 700);
    }, 550);
  }

  function onMove(e) {
    if (!timer) return;
    if (Math.abs(e.clientX - tahanX) > 10 || Math.abs(e.clientY - tahanY) > 10)
      batalkanTahan();
  }

  // ---- klik kanan (desktop; Android juga fire event ini) ----
  function onContextMenu(e) {
    batalkanTahan(); // jangan dobel buka abis timer tahan
    if (!sasar(e.target)) return;
    if (e.defaultPrevented) return; // komponen lain udah makai (misal sidebar mode atur)
    e.preventDefault();
    tahanEl = e.target;
    tutup(); // klik kanan lagi: re-open di posisi baru
    buka(null, e.clientX, e.clientY);
    tahanEl = null;
  }

  // ---- klik di luar = tutup; klik hantu pasca long-press dibungkus ----
  function onClickCapture(e) {
    if (cegahClick) {
      // klik di dalam menu sendiri (user cepet ngetuk item) = biarin jalan
      if (MN && MN.contains(e.target)) {
        cegahClick = false;
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      cegahClick = false;
      return;
    }
    if (!aktifLagi()) return;
    if (MN && MN.contains(e.target)) return; // klik item: biarin proses
    tutup();
  }

  function aktifLagi() {
    return AKTIF && MN && MN.classList.contains("buka");
  }

  // ---- keyboard: Esc tutup, panah pindah item ----
  function onKey(e) {
    if (e.key === "Escape") {
      if (!aktifLagi()) return;
      e.preventDefault();
      e.stopPropagation();
      tutup();
      return;
    }
    if (!aktifLagi()) return;
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    var daftar = ISI.querySelectorAll(".ctx-item");
    if (!daftar.length) return;
    e.preventDefault();
    var i = -1;
    for (var k = 0; k < daftar.length; k++) {
      if (daftar[k] === document.activeElement) {
        i = k;
        break;
      }
    }
    var j = i < 0 ? 0 : i + (e.key === "ArrowDown" ? 1 : -1);
    if (j < 0) j = daftar.length - 1;
    if (j >= daftar.length) j = 0;
    try {
      daftar[j].focus({ preventScroll: true });
    } catch (err) {}
  }

  function init() {
    bangun();
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerup", batalkanTahan, { passive: true });
    document.addEventListener("pointercancel", batalkanTahan, { passive: true });
    document.addEventListener("scroll", batalkanTahan, true); // scroll = gak jadi tahan
    document.addEventListener("click", onClickCapture, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", tutup);
  }

  window.KonteksMenu = {
    buka: function (items, x, y) {
      buka(items || null, x == null ? 24 : x, y == null ? 24 : y);
    },
    daftar: function (kunci, fn) {
      if (kunci && typeof fn === "function") registry[kunci] = fn;
    },
    tutup: tutup,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
