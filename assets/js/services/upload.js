// =========================================================================
// UPLOAD MANAGER — upload file jalan di background + progress persen.
//
// Semua upload (foto/video) lewat sini via db.js uploadFotoStorage() yang
// memakai XHR (satu-satunya cara dapat progress persen; fetch tidak bisa).
// Karena upload hidup di konteks halaman (bukan di tombol form), user bebas
// pindah halaman (SPA) selagi upload jalan — progress terpantau lewat bar.
//
// UI:
// - Bar fixed di bawah layar (di atas bottom-nav kalau ada). Isi lengkap:
//   nama file + "file ke-X dari Y" + persen + MB + sisa waktu + tombol
//   Detail / Batal. Kompres video juga lapor ke bar ini ("Mengompres video")
//   karena kompres jalan sebelum task upload dibuat. Muncul hanya kalau ada
//   upload lambat (>1.2 dtk) biar upload kilat tidak kedip. Ketuk bar -> buka daftar progress.
//   upload kilat tidak kedip. Ketuk bar -> buka daftar progress.
// - Daftar: tiap file + tiap video yang lagi dikompres ada progress bar +
//   %, status, tombol Batal / Coba lagi / Hapus. Kompres video bisa
//   dibatalkan (file-nya ikut batal upload). Tutup daftar = upload TETAP
//   jalan di background.
// - Reload/tutup tab saat upload aktif -> browser tanya konfirmasi.
// =========================================================================

(function () {
  "use strict";

  var TUNDA_BAR_MS = 1200; // tampilkan bar hanya kalau upload > 1.2 dtk
  var TICK_MS = 200; // throttle refresh bar + daftar
  var MAKS_RIWAYAT = 30;

  var seq = 0;
  var tasks = []; // terbaru di depan
  var barTimer = null;
  var barTampil = false;
  var pernahLambat = false;
  var lastTick = 0;
  var overlay = null;
  var bar = null;
  // Counter sesi berjalan (reset tiap antrean habis) buat "file ke-X dari Y".
  var sesiTotal = 0;
  var sesiSelesai = 0;
  var sesiBytes = 0;
  var sesiDoneBytes = 0;
  var sesiT0 = 0;
  // Tugas kompres video (compress-video.js lapor ke sini SEBELUM task
  // upload dibuat). id -> { label, frac, msg }.
  var kompres = {};
  var kompresSeq = 0;
  var kompresLast = 0;

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

  function kompresAktif() {
    var out = [];
    try {
      for (var id in kompres) {
        if (Object.prototype.hasOwnProperty.call(kompres, id) && kompres[id]) {
          kompres[id].id = id;
          out.push(kompres[id]);
        }
      }
    } catch (e) {}
    return out;
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

  function totalGlobal() {
    return sesiBytes || 0;
  }

  function dimuatGlobal() {
    var a = aktif();
    var n = sesiDoneBytes || 0;
    a.forEach(function (t) {
      var tot = t.total || t.size || 0;
      n += Math.min(t.loaded || 0, tot);
    });
    return Math.min(n, sesiBytes || n);
  }

  function fmtSisa(detik) {
    var s = Math.round(detik);
    if (!isFinite(s) || s < 0) return "";
    if (s < 5) return "bentar lagi";
    if (s < 90) return "~" + s + " dtk lagi";
    var m = Math.round(s / 60);
    if (m < 90) return "~" + m + " mnt lagi";
    return "~" + Math.round(m / 60) + " jam lagi";
  }

  function etaGlobal() {
    var tot = totalGlobal();
    var muat = dimuatGlobal();
    if (!tot || muat <= 0 || !sesiT0) return "";
    var jalan = (Date.now() - sesiT0) / 1000;
    if (jalan < 2) return "";
    var speed = muat / jalan;
    if (!speed || speed <= 0) return "";
    return fmtSisa((tot - muat) / speed);
  }

  function tick() {
    var now = Date.now();
    if (now - lastTick < TICK_MS) return;
    lastTick = now;
    refreshBar();
    if (overlay && overlay.style.display !== "none") renderDaftar();
  }

  function aturPosisiBar() {
    if (!bar) return;
    try {
      bar.classList.toggle("tanpa-nav", !document.getElementById("bottomNav"));
    } catch (e) {}
  }

  function buatBar() {
    bar = document.createElement("div");
    bar.id = "uploadBar";
    bar.setAttribute("role", "status");
    bar.style.display = "none";
    bar.innerHTML =
      '<div class="uploadbar-ico"><i class="fa-solid fa-cloud-arrow-up"></i></div>' +
      '<div class="uploadbar-info"><b id="uploadBarLabel">Mengupload…</b>' +
      '<small id="uploadBarSub"></small>' +
      '<div class="uploadbar-track"><div class="uploadbar-fill" id="uploadBarFill"></div></div></div>' +
      '<div class="uploadbar-aksi"><button type="button" class="btn btn-white btn-sm" id="uploadBarDetail">Detail</button>' +
      '<button type="button" class="btn btn-red btn-sm" id="uploadBarAksi">Batal</button></div>';
    document.body.appendChild(bar);
    bar.querySelector("#uploadBarDetail").addEventListener("click", function (e) {
      e.stopPropagation();
      UploadManager.bukaDaftar();
    });
    bar.querySelector("#uploadBarAksi").addEventListener("click", function (e) {
      e.stopPropagation();
      var mode = "";
      try { mode = bar.querySelector("#uploadBarAksi").dataset.mode || ""; } catch (err) {}
      if (mode === "ulangi") UploadManager.ulangiSemua();
      else UploadManager.batalkanSemua();
    });
    bar.addEventListener("click", function () {
      UploadManager.bukaDaftar();
    });
    aturPosisiBar();
  }

  function refreshBar() {
    var a = aktif();
    var g = gagal();
    var k = kompresAktif();
    try {
      if (!bar && (a.length > 0 || g.length > 0 || k.length > 0)) buatBar();
      if (!bar) return;
      var label = bar.querySelector("#uploadBarLabel");
      var sub = bar.querySelector("#uploadBarSub");
      var fill = bar.querySelector("#uploadBarFill");
      var aksi = bar.querySelector("#uploadBarAksi");
      var ikon = bar.querySelector(".uploadbar-ico i");
      if (a.length > 0) {
        aturPosisiBar();
        bar.style.display = "flex";
        barTampil = true;
        bar.dataset.status = "uploading";
        var judul = a.length > 1
          ? "Mengupload " + a.length + " file"
          : String(a[0].label || a[0].name || "File");
        if (label) label.textContent = judul;
        var p = persenGlobal();
        var pct = p ? parseInt(p, 10) || 0 : 0;
        var ke = Math.min(sesiSelesai + 1, Math.max(sesiTotal, 1));
        var ket = "File ke-" + ke + " dari " + Math.max(sesiTotal, a.length);
        if (a.length === 1 && a[0].name) ket += " · " + a[0].name;
        var tot = totalGlobal();
        if (tot > 0) ket += " · " + fmtSize(dimuatGlobal()) + " / " + fmtSize(tot);
        if (p) ket += " · " + p;
        var eta = etaGlobal();
        if (eta) ket += " · " + eta;
        if (g.length > 0) ket += " · " + g.length + " gagal";
        if (sub) sub.textContent = ket;
        if (fill) fill.style.width = pct + "%";
        if (ikon) ikon.className = "fa-solid fa-cloud-arrow-up fa-bounce";
        if (aksi) {
          aksi.style.display = "";
          aksi.textContent = a.length > 1 ? "Batal semua" : "Batal";
          aksi.dataset.mode = "batal";
        }
        return;
      }
      // Kompres video jalan SEBELUM task upload dibuat — tampilkan di bar
      // biar user tahu HP-nya lagi kerja, bukan hang.
      if (k.length > 0) {
        var kk = k[k.length - 1];
        aturPosisiBar();
        bar.style.display = "flex";
        barTampil = true;
        bar.dataset.status = "uploading";
        if (label) label.textContent = "Mengompres video";
        var kpct = Math.round((kk.frac || 0) * 100);
        var kket = String(kk.label || "video");
        if (kpct > 0) kket += " · " + kpct + "%";
        if (kk.msg) kket += " · " + kk.msg;
        if (sub) sub.textContent = kket;
        if (fill) fill.style.width = kpct + "%";
        if (ikon) ikon.className = "fa-solid fa-file-video";
        if (aksi) {
          aksi.style.display = "";
          aksi.textContent = "Batal";
          aksi.dataset.mode = "batal";
        }
        return;
      }
      if (g.length > 0) {
        aturPosisiBar();
        bar.style.display = "flex";
        barTampil = true;
        bar.dataset.status = "error";
        if (label) label.textContent = g.length + " upload gagal";
        if (sub) sub.textContent = "Ketuk buat lihat & coba lagi — file tetap tersimpan di HP";
        if (fill) fill.style.width = "100%";
        if (ikon) ikon.className = "fa-solid fa-triangle-exclamation";
        if (aksi) {
          aksi.style.display = "";
          aksi.textContent = "Coba semua";
          aksi.dataset.mode = "ulangi";
        }
        return;
      }
      // tidak ada aktif/gagal -> sembunyikan bar
      if (barTampil) {
        barTampil = false;
        bar.style.display = "none";
        var selesai = tasks.filter(function (t) { return t.status === "done"; });
        if (selesai.length > 0 && pernahLambat) {
          pernahLambat = false;
          try {
            if (typeof showToast === "function") showToast("Semua upload selesai ✓", "success");
          } catch (e) {}
        }
        sesiTotal = 0;
        sesiSelesai = 0;
        sesiBytes = 0;
        sesiDoneBytes = 0;
        sesiT0 = 0;
      }
    } catch (e) {}
  }

  function tampilBarSegera() {
    // Tunda tampil bar biar upload kilat (<1.2 dtk) tidak bikin kedip.
    if (barTampil) { tick(); return; }
    if (!barTimer) {
      barTimer = setTimeout(function () {
        barTimer = null;
        if (aktif().length > 0) {
          pernahLambat = true;
          lastTick = 0;
          tick();
        }
      }, TUNDA_BAR_MS);
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
      if (sesiTotal === 0) { sesiT0 = Date.now(); sesiDoneBytes = 0; sesiBytes = 0; sesiSelesai = 0; }
      sesiTotal++;
      sesiBytes += task.size || 0;
      tampilBarSegera();
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
            sesiSelesai++;
            sesiDoneBytes += task.size || 0;
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
      kompresAktif().forEach(function (t) {
        try { UploadManager.batalkanKompres(t.id); } catch (e) {}
      });
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
      var ukuran = t.size || (blob && blob.size) || 0;
      UploadManager.hapus(id);
      // putXHR di bawah nambah counter lagi — kurangi dulu biar "dari Y" stabil.
      sesiTotal = Math.max(0, sesiTotal - 1);
      sesiBytes = Math.max(0, sesiBytes - ukuran);
      try {
        var p = uploadFotoStorage(blob, path, { label: label, onDone: onDone });
        if (p && typeof p.catch === "function") p.catch(function () {});
      } catch (e) {}
      return true;
    },

    // Coba lagi semua yang gagal (dipakai tombol bar).
    ulangiSemua: function () {
      var ids = gagal().map(function (t) { return t.id; });
      if (!ids.length) return false;
      ids.forEach(function (id) {
        try { UploadManager.ulangi(id); } catch (e) {}
      });
      return true;
    },

    // Tugas kompres video (compress-video.js): lapor SEBELUM task upload
    // ada, biar bar bawah bisa nampilin "Mengompres video …%".
    kompresMulai: function (label) {
      var id = "k" + (++kompresSeq) + "_" + Date.now().toString(36);
      kompres[id] = { label: String(label || "video"), frac: 0, msg: "Menyiapkan…" };
      lastTick = 0;
      refreshBar();
      return id;
    },

    kompresLapor: function (id, frac, msg) {
      var t = kompres[id];
      if (!t) return false;
      if (typeof frac === "number" && isFinite(frac))
        t.frac = Math.max(0, Math.min(1, frac));
      if (msg) t.msg = String(msg);
      var now = Date.now();
      if (now - kompresLast < 200) return true;
      kompresLast = now;
      lastTick = 0;
      refreshBar();
      return true;
    },

    kompresSelesai: function (id) {
      if (!id || !kompres[id]) return false;
      try { delete kompres[id]; } catch (e) {}
      lastTick = 0;
      refreshBar();
      if (overlay && overlay.style.display !== "none") renderDaftar();
      return true;
    },

    // Daftarkan fungsi pembatal kompres (dipanggil tombol Batal).
    kompresBisaBatal: function (id, fn) {
      var t = kompres[id];
      if (!t) return false;
      t.fnBatal = (typeof fn === "function") ? fn : null;
      return true;
    },

    batalkanKompres: function (id) {
      var t = kompres[id];
      if (!t) return false;
      t.batalDiminta = true;
      try { if (t.fnBatal) t.fnBatal(); } catch (e) {}
      lastTick = 0;
      refreshBar();
      if (overlay && overlay.style.display !== "none") renderDaftar();
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
      else if (aksi === "batal-kompres") UploadManager.batalkanKompres(id);
      else if (aksi === "ulangi") UploadManager.ulangi(id);
      else if (aksi === "hapus") UploadManager.hapus(id);
    });
  }

  function renderDaftar() {
    var list = overlay ? overlay.querySelector("#uploadList") : null;
    if (!list) return;
    // Baris kompres dulu (kerja berjalan), lalu antrean upload.
    var htmlKompres = kompresAktif().map(function (t) {
      var pct = Math.round((t.frac || 0) * 100);
      var ket = (t.batalDiminta ? "Membatalkan… · " : "") + String(t.msg || "Mengompres…");
      if (pct > 0) ket += " · " + pct + "%";
      return '<div class="upload-row" data-status="uploading">' +
        '<div class="upload-row-head"><i class="fa-solid fa-file-video"></i>' +
        "<div><b>Mengompres video</b><small>" + esc(t.label) + "</small></div></div>" +
        '<div class="upload-bar"><div class="upload-bar-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="upload-row-foot"><span>' + esc(ket) + "</span><span>" +
        (t.batalDiminta ? "" : '<button type="button" class="btn btn-white btn-sm" data-aksi="batal-kompres" data-id="' + esc(t.id) + '">Batal</button>') +
        "</span></div></div>";
    }).join("");
    if (!tasks.length && !htmlKompres) {
      list.innerHTML = '<div class="pesan-empty"><i class="fa-solid fa-check"></i> Tidak ada upload.</div>';
      return;
    }
    list.innerHTML = htmlKompres + tasks.map(function (t) {
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

  // Peringatan kalau user reload/nutup tab saat upload/kompres aktif.
  try {
    window.addEventListener("beforeunload", function (e) {
      if (aktif().length > 0 || kompresAktif().length > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  } catch (e) {}

  window.UploadManager = UploadManager;
})();
