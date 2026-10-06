// =========================================================================
// UPLOAD MANAGER — upload file jalan di background + progress persen.
//
// Semua upload (foto/video) lewat sini via db.js uploadFotoStorage() yang
// memakai XHR (satu-satunya cara dapat progress persen; fetch tidak bisa).
// Karena upload hidup di konteks halaman (bukan di tombol form), user bebas
// pindah halaman (SPA) selagi upload jalan — progress terpantau lewat chip.
//
// UI:
// - Chip "Mengupload N file · P%" (Notice pill, kanan atas). Muncul hanya
//   kalau ada upload yang lambat (>1.2 dtk) biar upload kilat tidak kedip.
//   Diketuk -> buka daftar progress.
// - Daftar: tiap file ada progress bar + %, status, tombol Batal / Coba
//   lagi / Hapus. Tutup daftar = upload TETAP jalan di background.
// - Reload/tutup tab saat upload aktif -> browser tanya konfirmasi.
// =========================================================================

(function () {
  "use strict";

  var CHIP_ID = "mengupload";
  var TUNDA_CHIP_MS = 1200; // tampilkan chip hanya kalau upload > 1.2 dtk
  var TICK_MS = 200; // throttle refresh chip + daftar
  var MAKS_RIWAYAT = 30;

  var seq = 0;
  var tasks = []; // terbaru di depan
  var chipTimer = null;
  var chipTampil = false;
  var lastTick = 0;
  var overlay = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtSize(b) {
    var n = Number(b) || 0;
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
    return (n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1) + " MB";
  }

  function fmtPersen(loaded, total) {
    if (!total || total <= 0) return "";
    var p = Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
    return p + "%";
  }

  function aktif() {
    return tasks.filter(function (t) { return t.status === "uploading"; });
  }

  function gagal() {
    return tasks.filter(function (t) { return t.status === "error" || t.status === "canceled"; });
  }

  function persenGlobal() {
    var a = aktif();
    var total = 0, loaded = 0, adaUkuran = false;
    a.forEach(function (t) {
      var tot = t.total || t.size || 0;
      if (tot > 0) { adaUkuran = true; total += tot; loaded += Math.min(t.loaded || 0, tot); }
    });
    if (!adaUkuran || total <= 0) return "";
    return fmtPersen(loaded, total);
  }

  function tick() {
    var now = Date.now();
    if (now - lastTick < TICK_MS) return;
    lastTick = now;
    refreshChip();
    if (overlay && overlay.style.display !== "none") renderDaftar();
  }

  function refreshChip() {
    var a = aktif();
    var g = gagal();
    try {
      if (a.length > 0) {
        var p = persenGlobal();
        var teks = "Mengupload " + a.length + " file" + (p ? " · " + p : "…");
        if (typeof Notice !== "undefined" && Notice.show) {
          Notice.show(CHIP_ID, {
            text: teks,
            icon: "fa-solid fa-cloud-arrow-up fa-bounce",
            type: "yellow",
            title: "Ketuk buat lihat progress",
            onClick: function () { UploadManager.bukaDaftar(); },
          });
          chipTampil = true;
        }
        return;
      }
      if (g.length > 0) {
        if (typeof Notice !== "undefined" && Notice.show) {
          Notice.show(CHIP_ID, {
            text: g.length + " upload gagal — ketuk buat coba lagi",
            icon: "fa-solid fa-triangle-exclamation",
            type: "red",
            title: "Ketuk buat lihat daftar",
            onClick: function () { UploadManager.bukaDaftar(); },
          });
          chipTampil = true;
        }
        return;
      }
      // tidak ada aktif/gagal -> sembunyikan chip
      if (chipTampil) {
        chipTampil = false;
        try {
          if (typeof Notice !== "undefined" && Notice.hide) Notice.hide(CHIP_ID);
        } catch (e) {}
        var selesai = tasks.filter(function (t) { return t.status === "done"; });
        if (selesai.length > 0 && pernahLambat) {
          pernahLambat = false;
          try {
            if (typeof showToast === "function") showToast("Semua upload selesai ✓", "success");
          } catch (e) {}
        }
      }
    } catch (e) {}
  }

  var pernahLambat = false;

  function refreshChipSoon() {
    // Tunda tampil chip biar upload kilat (<1.2 dtk) tidak bikin kedip.
    if (chipTampil) { tick(); return; }
    if (!chipTimer) {
      chipTimer = setTimeout(function () {
        chipTimer = null;
        if (aktif().length > 0) {
          pernahLambat = true;
          lastTick = 0;
          tick();
        }
      }, TUNDA_CHIP_MS);
    }
  }

  function prune() {
    // Batasi riwayat: buang done paling lama kalau kepenuhan.
    var doneIdx = [];
    tasks.forEach(function (t, i) { if (t.status === "done") doneIdx.push(i); });
    while (tasks.length > MAKS_RIWAYAT && doneIdx.length) {
      tasks.splice(doneIdx.pop(), 1);
    }
  }

  var UploadManager = {
    tasks: tasks,

    aktif: function () { return aktif().length; },

  // Upload satu blob via XHR PUT + progress. Dipakai db.js uploadFotoStorage.
  // meta: { label, name, path, onDone } — path disimpan buat "Coba lagi",
  // onDone dipanggil tiap upload ini sukses (termasuk hasil coba lagi).
    putXHR: function (url, blob, tipe, meta) {
      meta = meta || {};
      var task = {
        id: "u" + (++seq) + "_" + Date.now().toString(36),
        label: String(meta.label || meta.name || (blob && blob.name) || "File"),
        name: String((blob && blob.name) || meta.name || "file"),
        size: (blob && blob.size) || 0,
        loaded: 0,
        total: (blob && blob.size) || 0,
        status: "uploading",
        error: "",
        t0: Date.now(),
        blob: blob,
        url: url,
        tipe: tipe,
        path: meta.path || "",
        onDone: (typeof meta.onDone === "function") ? meta.onDone : null,
        xhr: null,
      };
      tasks.unshift(task);
      prune();
      refreshChipSoon();
      return new Promise(function (res, rej) {
        var xhr;
        try {
          xhr = new XMLHttpRequest();
        } catch (e) {
          task.status = "error";
          task.error = "Browser tidak dukung upload progress";
          tick();
          rej(e);
          return;
        }
        task.xhr = xhr;
        function fail(msg) {
          if (task.status === "canceled") return;
          task.status = "error";
          task.error = msg;
          lastTick = 0;
          tick();
          rej(new Error(msg));
        }
        try {
          xhr.open("PUT", url, true);
        } catch (e) {
          fail("Gagal mulai upload");
          return;
        }
        try {
          xhr.setRequestHeader("Content-Type", tipe || "application/octet-stream");
        } catch (e) {}
        if (xhr.upload) {
          xhr.upload.onprogress = function (e) {
            if (!e) return;
            if (e.lengthComputable && e.total > 0) {
              task.loaded = e.loaded;
              task.total = e.total;
            } else if (typeof e.loaded === "number") {
              task.loaded = e.loaded;
            }
            tick();
          };
        }
        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) {
            task.status = "done";
            task.loaded = task.total || task.size || task.loaded;
            task.doneAt = Date.now();
            lastTick = 0;
            tick();
            try { if (typeof task.onDone === "function") task.onDone(task); } catch (e) {}
            res(task);
          } else {
            fail("Upload gagal (" + xhr.status + ")");
          }
        };
        xhr.onerror = function () { fail("Jaringan putus pas upload"); };
        xhr.onabort = function () {
          task.status = "canceled";
          lastTick = 0;
          tick();
          rej(new Error("Upload dibatalkan"));
        };
        try {
          xhr.send(blob);
        } catch (e) {
          fail("Gagal kirim file");
        }
      });
    },

    batalkan: function (id) {
      var t = tasks.filter(function (x) { return String(x.id) === String(id); })[0];
      if (!t) return false;
      if (t.status === "uploading" && t.xhr) {
        try { t.xhr.abort(); } catch (e) {}
        return true;
      }
      return false;
    },

    batalkanSemua: function () {
      aktif().forEach(function (t) {
        try { if (t.xhr) t.xhr.abort(); } catch (e) {}
      });
    },

    // Coba lagi: upload ulang blob yang sama via jalur normal (presign baru).
    ulangi: function (id) {
      var t = tasks.filter(function (x) { return String(x.id) === String(id); })[0];
      if (!t || !t.blob || !t.path) return false;
      if (typeof uploadFotoStorage !== "function") return false;
      // keluarkan baris gagal, ganti task baru (onDone ikut terbawa)
      var onDone = t.onDone;
      var label = t.label;
      var blob = t.blob;
      var path = t.path;
      UploadManager.hapus(id);
      try {
        var p = uploadFotoStorage(blob, path, { label: label, onDone: onDone });
        if (p && typeof p.catch === "function") p.catch(function () {});
      } catch (e) {}
      return true;
    },

    hapus: function (id) {
      for (var i = 0; i < tasks.length; i++) {
        if (String(tasks[i].id) === String(id)) {
          if (tasks[i].status === "uploading") return false;
          tasks.splice(i, 1);
          break;
        }
      }
      lastTick = 0;
      tick();
      if (overlay && overlay.style.display !== "none") renderDaftar();
      return true;
    },

    bukaDaftar: function () {
      try {
        if (!overlay) buatOverlay();
        renderDaftar();
        overlay.style.display = "flex";
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { overlay.classList.add("active"); });
        });
      } catch (e) {}
    },

    tutupDaftar: function () {
      try {
        if (!overlay) return;
        overlay.classList.remove("active");
        setTimeout(function () {
          try { overlay.style.display = "none"; } catch (e) {}
        }, 200);
      } catch (e) {}
    },
  };

  function statusLabel(t) {
    if (t.status === "uploading") {
      var p = fmtPersen(t.loaded, t.total || t.size);
      return p ? p + " · " + fmtSize(t.loaded) + " / " + fmtSize(t.total || t.size) : "Mengupload " + fmtSize(t.size) + "…";
    }
    if (t.status === "done") return "Selesai ✓";
    if (t.status === "canceled") return "Dibatalkan";
    return t.error || "Gagal";
  }

  function buatOverlay() {
    overlay = document.createElement("div");
    overlay.id = "uploadOverlay";
    overlay.className = "upload-overlay";
    overlay.style.display = "none";
    overlay.innerHTML =
      '<div class="upload-box" role="dialog" aria-label="Progress upload">' +
      '<div class="upload-head"><span><i class="fa-solid fa-cloud-arrow-up"></i> Upload</span>' +
      '<button type="button" class="icon-btn" id="uploadTutup" title="Tutup (upload tetap jalan)"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<p class="upload-hint">Ditutup pun upload tetap jalan di background. Jangan reload/keluar web sebelum selesai.</p>' +
      '<div class="upload-list" id="uploadList"></div>' +
      '<div class="upload-foot"><button type="button" class="btn btn-white btn-sm" id="uploadBatalSemua"><i class="fa-solid fa-ban"></i> Batalkan semua</button></div>' +
      "</div>";
    document.body.appendChild(overlay);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) UploadManager.tutupDaftar();
    });
    overlay.querySelector("#uploadTutup").addEventListener("click", function () {
      UploadManager.tutupDaftar();
    });
    overlay.querySelector("#uploadBatalSemua").addEventListener("click", function () {
      UploadManager.batalkanSemua();
    });
    // Delegasi tombol per baris (daftar di-render ulang tiap tick).
    overlay.querySelector("#uploadList").addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest("[data-aksi]") : null;
      if (!btn) return;
      var id = btn.getAttribute("data-id");
      var aksi = btn.getAttribute("data-aksi");
      if (aksi === "batal") UploadManager.batalkan(id);
      else if (aksi === "ulangi") UploadManager.ulangi(id);
      else if (aksi === "hapus") UploadManager.hapus(id);
    });
  }

  function renderDaftar() {
    var list = overlay ? overlay.querySelector("#uploadList") : null;
    if (!list) return;
    if (!tasks.length) {
      list.innerHTML = '<div class="pesan-empty"><i class="fa-solid fa-check"></i> Tidak ada upload.</div>';
      return;
    }
    list.innerHTML = tasks.map(function (t) {
      var p = (t.status === "uploading") ? fmtPersen(t.loaded, t.total || t.size) : "";
      var pct = p ? parseInt(p, 10) || 0 : (t.status === "done" ? 100 : 0);
      var aksi = "";
      if (t.status === "uploading") {
        aksi = '<button type="button" class="btn btn-white btn-sm" data-aksi="batal" data-id="' + esc(t.id) + '">Batal</button>';
      } else if (t.status === "error" || t.status === "canceled") {
        aksi = (t.blob && t.path ? '<button type="button" class="btn btn-red btn-sm" data-aksi="ulangi" data-id="' + esc(t.id) + '">Coba lagi</button>' : "") +
          '<button type="button" class="btn btn-white btn-sm" data-aksi="hapus" data-id="' + esc(t.id) + '">Hapus</button>';
      } else {
        aksi = '<button type="button" class="btn btn-white btn-sm" data-aksi="hapus" data-id="' + esc(t.id) + '">Hapus</button>';
      }
      var ikon = t.status === "done" ? "fa-circle-check" : (t.status === "uploading" ? "fa-cloud-arrow-up" : "fa-triangle-exclamation");
      return '<div class="upload-row" data-status="' + esc(t.status) + '">' +
        '<div class="upload-row-head"><i class="fa-solid ' + ikon + '"></i>' +
        "<div><b>" + esc(t.label) + "</b><small>" + esc(t.name) + " · " + esc(fmtSize(t.size)) + "</small></div></div>" +
        '<div class="upload-bar"><div class="upload-bar-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="upload-row-foot"><span>' + esc(statusLabel(t)) + "</span><span>" + aksi + "</span></div>" +
        "</div>";
    }).join("");
  }

  // Peringatan kalau user reload/nutup tab saat upload aktif.
  try {
    window.addEventListener("beforeunload", function (e) {
      if (aktif().length > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  } catch (e) {}

  window.UploadManager = UploadManager;
})();
