/* ============================================================
   DROPDOWN CUSTOM - OSIS TARPAN ONE
   Pengganti <select> bawaan browser biar tampil seragam.
   - Auto-enhance semua <select> single (statis + dinamis).
   - Select asli tetap di DOM (id/class/value/event utuh),
     cuma disembunyiin visual; custom jadi cermin. Pilih di
     custom = set select.value + dispatch change/input.
   - Search kecil muncul otomatis kalau opsi > AMBANG_CARI.
   - Opt-out: <select data-dd="off"> atau di dalam [data-dd="off"].
   ============================================================ */
(function () {
  "use strict";

  var AMBANG_CARI = 7; // opsi lebih dari ini -> ada kolom cari
  var CLS = "dd";
  var TERBUKA = null; // wrapper yang lagi kebuka

  function $(s, r) {
    return (r || document).querySelector(s);
  }
  function $all(s, r) {
    return Array.prototype.slice.call((r || document).querySelectorAll(s));
  }

  // Select layak di-enhance?
  function layak(sel) {
    if (!sel || sel.tagName !== "SELECT") return false;
    if (sel.multiple) return false;
    if (sel.dataset.dd === "1") return false; // sudah jadi custom
    if (sel.dataset.dd === "off") return false;
    if (sel.closest && sel.closest('[data-dd="off"]')) return false;
    return true;
  }

  // Ambil opsi sebagai array {value, label, disabled}
  function bacaOpsi(sel) {
    return $all("option", sel).map(function (op) {
      return {
        value: op.value,
        label: (op.textContent || "").trim() || op.value || "—",
        disabled: op.disabled,
      };
    });
  }

  function labelAktif(sel, daftar) {
    var v = sel.value;
    for (var i = 0; i < daftar.length; i++) {
      if (daftar[i].value === v) return daftar[i].label;
    }
    // value kosong / belum ada opsi (diisi async) -> placeholder
    var ph = sel.getAttribute("data-dd-ph");
    if (ph) return ph;
    var pertama = sel.querySelector("option[value='']");
    if (pertama && (pertama.textContent || "").trim())
      return (pertama.textContent || "").trim();
    return "— Pilih —";
  }

  function tutupSemua(kecuali) {
    $all("." + CLS + ".buka").forEach(function (w) {
      if (w === kecuali) return;
      w.classList.remove("buka");
      var b = $(".dd-btn", w);
      if (b) b.setAttribute("aria-expanded", "false");
    });
    TERBUKA = null;
  }

  function segarkan(w) {
    var sel = $("select", w);
    if (!sel) return;
    var daftar = bacaOpsi(sel);
    var btnLabel = $(".dd-teks", w);
    if (btnLabel) {
      btnLabel.textContent = labelAktif(sel, daftar);
      btnLabel.classList.toggle("kosong", !sel.value);
    }
    var cari = $(".dd-cari input", w);
    renderOpsi(w, sel, daftar, cari ? cari.value : "");
    // search cuma kalau opsi banyak
    var boxCari = $(".dd-cari", w);
    if (boxCari) boxCari.style.display = daftar.length > AMBANG_CARI ? "" : "none";
    // tombol ikut disabled
    var btn = $(".dd-btn", w);
    if (btn) {
      btn.disabled = sel.disabled;
      w.classList.toggle("mati", sel.disabled);
    }
  }

  function renderOpsi(w, sel, daftar, keyword) {
    var box = $(".dd-opts", w);
    if (!box) return;
    var kw = (keyword || "").trim().toLowerCase();
    box.innerHTML = "";
    var n = 0;
    daftar.forEach(function (op) {
      if (kw && op.label.toLowerCase().indexOf(kw) < 0) return;
      n++;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "dd-opt" + (op.value === sel.value ? " pilih" : "");
      b.setAttribute("role", "option");
      b.setAttribute("aria-selected", op.value === sel.value ? "true" : "false");
      if (op.disabled) b.disabled = true;
      var s = document.createElement("span");
      s.textContent = op.label;
      b.appendChild(s);
      if (op.value === sel.value) {
        var c = document.createElement("i");
        c.className = "fa-solid fa-check";
        b.appendChild(c);
      }
      b.addEventListener("click", function () {
        if (op.disabled) return;
        pilih(w, op.value);
      });
      box.appendChild(b);
    });
    if (!n) {
      var kosong = document.createElement("div");
      kosong.className = "dd-kosong";
      kosong.textContent = daftar.length ? "Tidak cocok." : "Belum ada pilihan.";
      box.appendChild(kosong);
    }
  }

  function pilih(w, value) {
    var sel = $("select", w);
    if (!sel || sel.disabled) return;
    if (sel.value !== value) {
      sel.value = value;
      try {
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        sel.dispatchEvent(new Event("input", { bubbles: true }));
      } catch (e) {
        // fallback browser tua
        var ev;
        try {
          ev = document.createEvent("HTMLEvents");
          ev.initEvent("change", true, true);
          sel.dispatchEvent(ev);
        } catch (_) {}
      }
    }
    segarkan(w);
    tutupSemua();
    var btn = $(".dd-btn", w);
    if (btn) btn.focus({ preventScroll: true });
  }

  function bangun(sel) {
    if (!layak(sel)) return;
    sel.dataset.dd = "1";

    var w = document.createElement("div");
    w.className = CLS;

    // --- sizing: tiru perilaku layout select asli ---
    var cs = null;
    try {
      cs = window.getComputedStyle(sel);
    } catch (e) {}
    var full = false;
    if (sel.offsetWidth > 0 && sel.parentElement) {
      var pw = sel.parentElement.clientWidth;
      if (pw > 0 && sel.offsetWidth >= pw - 4) full = true;
    } else {
      // elemen di view tersembunyi (offset 0): tebak dari class
      if (
        sel.classList.contains("admin-input") ||
        sel.classList.contains("uni-input") ||
        sel.style.width === "100%"
      )
        full = true;
    }
    if (full) {
      w.style.width = "100%";
    } else {
      w.style.width = "auto";
      w.style.minWidth = "150px";
      w.style.maxWidth = "100%";
    }
    if (cs && parseFloat(cs.flexGrow) > 0) {
      w.style.flex = "1 1 auto";
      w.style.minWidth = "0";
    }
    if (sel.style.maxWidth) w.style.maxWidth = sel.style.maxWidth;
    if (sel.style.width && sel.style.width !== "100%")
      w.style.width = sel.style.width;
    if (sel.style.minWidth) w.style.minWidth = sel.style.minWidth;

    // pindah select ke dalam wrapper, sembunyi visual
    sel.classList.add("dd-src");
    sel.parentNode.insertBefore(w, sel);
    w.appendChild(sel);

    // tombol
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dd-btn";
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    var teks = document.createElement("span");
    teks.className = "dd-teks";
    btn.appendChild(teks);
    var chev = document.createElement("i");
    chev.className = "fa-solid fa-chevron-down dd-chev";
    btn.appendChild(chev);
    w.appendChild(btn);

    // list
    var list = document.createElement("div");
    list.className = "dd-list";
    list.setAttribute("role", "listbox");
    var boxCari = document.createElement("div");
    boxCari.className = "dd-cari";
    var ikon = document.createElement("i");
    ikon.className = "fa-solid fa-magnifying-glass";
    var inp = document.createElement("input");
    inp.type = "search";
    inp.placeholder = "Cari…";
    inp.setAttribute("aria-label", "Cari pilihan");
    inp.autocomplete = "off";
    boxCari.appendChild(ikon);
    boxCari.appendChild(inp);
    list.appendChild(boxCari);
    var opts = document.createElement("div");
    opts.className = "dd-opts";
    list.appendChild(opts);
    w.appendChild(list);

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (sel.disabled) return;
      var lagiBuka = w.classList.contains("buka");
      tutupSemua();
      if (!lagiBuka) {
        w.classList.add("buka");
        btn.setAttribute("aria-expanded", "true");
        TERBUKA = w;
        segarkan(w);
        // search dikosongin tiap buka; JANGAN autofocus (keyboard
        // mobile nyembul = ganggu). user tap sendiri kalau butuh.
        if (boxCari.style.display !== "none") {
          inp.value = "";
          renderOpsi(w, sel, bacaOpsi(sel), "");
        }
      }
    });

    inp.addEventListener("input", function () {
      renderOpsi(w, sel, bacaOpsi(sel), inp.value);
    });
    inp.addEventListener("click", function (e) {
      e.stopPropagation();
    });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        tutupSemua();
        btn.focus({ preventScroll: true });
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        gerakSorot(w, e.key === "ArrowDown" ? 1 : -1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        var aktif = $(".dd-opt.sorot", w) || $(".dd-opt.pilih", w);
        if (aktif) aktif.click();
      }
    });

    // keyboard di tombol: panah = pindah opsi langsung
    btn.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        langkahNilai(sel, e.key === "ArrowDown" ? 1 : -1);
      }
    });

    // select berubah dari kode lain (innerHTML diisi async / .value
    // diset manual) -> cermin ikut update
    sel.addEventListener("change", function () {
      segarkan(w);
    });
    // form di-reset -> label balik ikut select
    if (sel.form) {
      sel.form.addEventListener("reset", function () {
        setTimeout(function () {
          segarkan(w);
        }, 0);
      });
    }
    try {
      new MutationObserver(function () {
        segarkan(w);
      }).observe(sel, {
        childList: true,
        characterData: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["disabled"],
      });
    } catch (e) {}

    segarkan(w);
  }

  // panah atas/bawah di tombol: loncat ke opsi non-disabled berikut
  function langkahNilai(sel, arah) {
    var ops = $all("option", sel).filter(function (o) {
      return !o.disabled;
    });
    if (!ops.length) return;
    var i = -1;
    for (var k = 0; k < ops.length; k++) {
      if (ops[k].value === sel.value) {
        i = k;
        break;
      }
    }
    var j = i < 0 ? (arah > 0 ? 0 : ops.length - 1) : i + arah;
    if (j < 0) j = 0;
    if (j >= ops.length) j = ops.length - 1;
    var w = sel.closest ? sel.closest("." + CLS) : null;
    if (w) pilih(w, ops[j].value);
    else {
      sel.value = ops[j].value;
      try {
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (e) {}
    }
  }

  function gerakSorot(w, arah) {
    var daftar = $all(".dd-opt:not([disabled])", w);
    if (!daftar.length) return;
    var i = -1;
    for (var k = 0; k < daftar.length; k++) {
      if (daftar[k].classList.contains("sorot")) {
        i = k;
        break;
      }
    }
    var j = i < 0 ? (arah > 0 ? 0 : daftar.length - 1) : i + arah;
    if (j < 0) j = 0;
    if (j >= daftar.length) j = daftar.length - 1;
    daftar.forEach(function (b) {
      b.classList.remove("sorot");
    });
    daftar[j].classList.add("sorot");
    try {
      daftar[j].scrollIntoView({ block: "nearest" });
    } catch (e) {}
  }

  function sapu(root) {
    $all("select", root === document ? document : root).forEach(function (s) {
      if (layak(s)) bangun(s);
    });
    // root sendiri bisa berupa <select> hasil innerHTML
    if (root && root.tagName === "SELECT" && layak(root)) bangun(root);
  }

  function init() {
    sapu(document);
    document.addEventListener("click", function (e) {
      if (TERBUKA && !TERBUKA.contains(e.target)) tutupSemua();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") tutupSemua();
    });
    try {
      new MutationObserver(function (muts) {
        muts.forEach(function (m) {
          $all("select", m.target).forEach(function (s) {
            if (layak(s)) bangun(s);
          });
          m.addedNodes &&
            Array.prototype.forEach.call(m.addedNodes, function (n) {
              if (!n || n.nodeType !== 1) return;
              if (n.tagName === "SELECT") {
                if (layak(n)) bangun(n);
              } else if (n.querySelectorAll) {
                $all("select", n).forEach(function (s) {
                  if (layak(s)) bangun(s);
                });
              }
            });
        });
      }).observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    } catch (e) {}
  }

  window.Dropdown = {
    AMBANG_CARI: AMBANG_CARI,
    segarkanSemua: function () {
      $all("." + CLS).forEach(segarkan);
    },
    tutup: tutupSemua,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
