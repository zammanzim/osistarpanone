// =========================================================================
// COMPRESS VIDEO — hybrid: native (MediaRecorder) untuk HP, ffmpeg.wasm
// untuk desktop. Dipakai db.js uploadFotoStorage() sebelum upload ke R2.
//
// Engine default ("auto"): native di semua perangkat. FFmpeg hanya dipakai
// kalau pengguna memilihnya eksplisit di Pengaturan (opsi lanjutan) — biar
// tidak ada unduhan ~30MB yang tidak diminta.
// Pilihan user tinggal simpan ke localStorage "tarpan-video-compress":
// "auto" | "native" | "ffmpeg" | "off" — diatur lewat halaman Pengaturan
// (view #/pengaturan, js/pengaturan.js).
//
// Garansi: semua fungsi di sini TIDAK PERNAH throw ke pemanggil normal —
// compressVideo() selalu fallback ke file asli kalau gagal, biar upload
// tetap jalan (max 100MB seperti dulu).
// =========================================================================
(function () {
  "use strict";

  var PREF_KEY = "tarpan-video-compress";
  var TARGET_MB = 15;
  var MAX_DIM = 1280; // 720p sisi panjang
  var MB = 1024 * 1024;

  // Pin versi biar CDN tidak tiba-tiba breaking.
  var FFMPEG_LIB = "https://esm.sh/@ffmpeg/ffmpeg@0.12.10";
  var FFUTIL_LIB = "https://esm.sh/@ffmpeg/util@0.12.1";
  var CORE_BASE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
  // Worker bawaan @ffmpeg/ffmpeg dibuat via `new Worker(relatif-ke-CDN)` —
  // diblokir browser kalau lib dimuat dari CDN (cross-origin worker, persis
  // "Security Error ... may not load data from ..." di Firefox). Solusi
  // resmi: teruskan sebagai blob URL same-origin lewat opsi `classWorkerURL`.
  // PENTING: worker class selalu jalan sebagai module worker, jadi:
  // - core WAJIB build ESM (`dist/esm`, ada `export default`) — build UMD di
  //   sini selalu gagal dengan "failed to import ffmpeg-core.js".
  // - worker WAJIB build ESM murni (`dist/esm/worker.js` + dep di-inline,
  //   lihat rakitWorkerURL) — chunk UMD (`814.ffmpeg.js`) menyentuh
  //   `document` di top-level, mati diam-diam di dalam worker, dan load()
  //   menggantung selamanya. Ganti versi pin = cek ulang daftar file ini.
  var FFMPEG_ESM = "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm";

  function toast(msg, tipe) {
    try {
      if (typeof showToast === "function") showToast(msg, tipe || "info");
    } catch (e) {}
  }

  function fmtMB(b) {
    var n = Number(b) || 0;
    if (n < 1024) return n + " B";
    if (n < MB) return (n / 1024).toFixed(0) + " KB";
    return (n / MB).toFixed(n >= 10 * MB ? 0 : 1) + " MB";
  }

  // --- Progres via Notice kanan-atas (tanpa elemen baru) ---------------------
  // Satu pill id "kompres" (upsert, tidak dobel), terpisah dari chip upload
  // "mengupload" milik UploadManager: pill kompres tampil selama kompres,
  // disembunyikan pas selesai, lalu chip upload yang meneruskan. Kelar ada
  // toast hematnya; gagal ada toast + upload file asli tetap jalan.
  // Kalau Notice belum ke-load di halaman ini, diam saja (tanpa bikin DOM).
  var NOTIF_ID = "kompres";
  var NOTIF_ICON = "fa-solid fa-file-video";
  var _notifLast = 0;

  function notifAda() {
    try {
      return typeof Notice !== "undefined" && Notice && typeof Notice.show === "function";
    } catch (e) {
      return false;
    }
  }

  function notifTampil(teks, paksa) {
    try {
      if (!notifAda()) return;
      var now = Date.now();
      if (!paksa && now - _notifLast < 200) return; // throttle biar hemat render
      _notifLast = now;
      Notice.show(NOTIF_ID, {
        text: String(teks || "Mengompres video…"),
        icon: NOTIF_ICON,
        type: "yellow",
        title: "Video dikompres dulu biar ringan",
      });
    } catch (e) {}
  }

  function notifTutup() {
    try {
      if (notifAda() && typeof Notice.hide === "function") Notice.hide(NOTIF_ID);
    } catch (e) {}
  }

  function notifSelesai(hemat) {
    notifTutup();
    toast("Video dikompres: " + hemat + " ✓", "success");
  }

  function notifGagal() {
    notifTutup();
    toast("Kompres gagal — upload file asli…", "info");
  }

  // --- Deteksi device ------------------------------------------------------
  function isDesktop() {
    try {
      var ua = String(navigator.userAgent || "");
      if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua)) return false;
      // Laptop touchscreen: layar kecil + pointer kasar = anggap HP/tablet.
      try {
        if (
          window.matchMedia &&
          window.matchMedia("(pointer: coarse)").matches &&
          Math.min(window.screen.width || 9999, window.screen.height || 9999) < 820
        ) {
          return false;
        }
      } catch (e) {}
      return true;
    } catch (e) {
      return true;
    }
  }

  function getPref() {
    try {
      var v = String(localStorage.getItem(PREF_KEY) || "auto").toLowerCase();
      if (v === "native" || v === "ffmpeg" || v === "off" || v === "auto") return v;
    } catch (e) {}
    return "auto";
  }

  function setPref(v) {
    v = String(v || "auto").toLowerCase();
    if (v !== "native" && v !== "ffmpeg" && v !== "off") v = "auto";
    try {
      localStorage.setItem(PREF_KEY, v);
    } catch (e) {}
    return v;
  }

  // Engine efektif: "native" | "ffmpeg" | "off".
  // Default native di semua perangkat (sesuai halaman Pengaturan): FFmpeg
  // hanya dipakai kalau pengguna memilihnya eksplisit — biar tidak ada
  // unduhan ~30MB yang tidak diminta.
  function getEngine() {
    var p = getPref();
    if (p === "native" || p === "ffmpeg" || p === "off") return p;
    return "native";
  }

  // --- Target resolusi & ukuran (diatur halaman Pengaturan) ------------------
  // RES_KEY: sisi panjang output (854=480p, 1280=720p, 1920=1080p).
  // TGT_KEY: target ukuran MB (5..50). File asli tidak pernah diubah —
  // nilai ini cuma target usaha; hasil selalu divalidasi sebelum dipakai.
  var RES_KEY = "tarpan-video-res";
  var TGT_KEY = "tarpan-video-target";
  var RES_BOLEH = { 854: 1, 1280: 1, 1920: 1 };

  function getMaxDim() {
    try {
      var v = parseInt(localStorage.getItem(RES_KEY) || "", 10);
      if (RES_BOLEH[v]) return v;
    } catch (e) {}
    return MAX_DIM;
  }

  function setMaxDim(v) {
    v = parseInt(v, 10);
    if (!RES_BOLEH[v]) v = MAX_DIM;
    try {
      localStorage.setItem(RES_KEY, String(v));
    } catch (e) {}
    return v;
  }

  function getTargetMB() {
    try {
      var v = parseFloat(localStorage.getItem(TGT_KEY) || "");
      if (isFinite(v)) return Math.max(5, Math.min(50, v));
    } catch (e) {}
    return TARGET_MB;
  }

  function setTargetMB(v) {
    v = parseFloat(v);
    if (!isFinite(v)) v = TARGET_MB;
    v = Math.max(5, Math.min(50, v));
    try {
      localStorage.setItem(TGT_KEY, String(v));
    } catch (e) {}
    return v;
  }

  // Hasil kompresi valid = bertipe video/*, berukuran >0, dan (untuk ffmpeg)
  // ekstensi selaras dengan format sebenarnya (.mp4). File asli tidak
  // pernah dihapus/ditimpa — falid = pakai asli.
  function hasilValid(f) {
    try {
      if (!f || !f.type || String(f.type).indexOf("video/") !== 0) return false;
      if (!(f.size > 0)) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  function isVideoFile(f) {
    return !!(f && f.type && String(f.type).indexOf("video/") === 0);
  }

  // --- Metadata (lebar/tinggi/durasi) tanpa upload --------------------------
  function getVideoMetadata(file, timeoutMs) {
    return new Promise(function (res, rej) {
      var url = "";
      var done = false;
      var video = document.createElement("video");
      var timer = setTimeout(function () {
        if (!done) {
          done = true;
          cleanup();
          rej(new Error("timeout baca metadata video"));
        }
      }, timeoutMs || 10000);
      function cleanup() {
        try {
          clearTimeout(timer);
        } catch (e) {}
        try {
          video.removeAttribute("src");
          video.load();
        } catch (e) {}
        if (url) {
          try {
            URL.revokeObjectURL(url);
          } catch (e) {}
        }
      }
      video.muted = true;
      try {
        video.playsInline = true;
      } catch (e) {}
      video.preload = "metadata";
      video.onloadedmetadata = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        var out = {
          width: video.videoWidth || 0,
          height: video.videoHeight || 0,
          duration: isFinite(video.duration) ? video.duration : 0,
        };
        cleanup();
        res(out);
      };
      video.onerror = function () {
        if (!done) {
          done = true;
          cleanup();
          rej(new Error("video tidak terbaca browser"));
        }
      };
      try {
        url = URL.createObjectURL(file);
        video.src = url;
      } catch (e) {
        if (!done) {
          done = true;
          clearTimeout(timer);
          rej(e);
        }
      }
    });
  }

  // Skala ke maxDim sisi panjang, genap (syarat encoder).
  function hitungDimensi(w, h, maxDim) {
    w = Number(w) || 0;
    h = Number(h) || 0;
    if (!w || !h) return null;
    var s = Math.min(1, maxDim / Math.max(w, h));
    var nw = Math.max(2, Math.floor((w * s) / 2) * 2);
    var nh = Math.max(2, Math.floor((h * s) / 2) * 2);
    return { w: nw, h: nh };
  }

  function namaDasar(nama) {
    return String(nama || "video").replace(/\.[^.]+$/, "").slice(0, 60) || "video";
  }

  // =========================================================================
  // ENGINE 1: NATIVE — canvas.captureStream + MediaRecorder. Ringan, tanpa
  // download. Catatan: autoplay butuh muted di sebagian browser, jadi audio
  // dipertahankan best-effort (track audio ditempel kalau ketangkap).
  // =========================================================================
  function pickRecorderMime() {
    var daftar = [
      { mime: 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"', ext: ".mp4", type: "video/mp4" },
      { mime: "video/mp4", ext: ".mp4", type: "video/mp4" },
      { mime: "video/webm;codecs=vp9,opus", ext: ".webm", type: "video/webm" },
      { mime: "video/webm;codecs=vp8,opus", ext: ".webm", type: "video/webm" },
      { mime: "video/webm", ext: ".webm", type: "video/webm" },
    ];
    try {
      if (typeof MediaRecorder === "undefined") return null;
      for (var i = 0; i < daftar.length; i++) {
        try {
          if (MediaRecorder.isTypeSupported(daftar[i].mime)) return daftar[i];
        } catch (e) {}
      }
    } catch (e) {}
    return null;
  }

  async function compressVideoNative(file, opts) {
    opts = opts || {};
    var targetMB = Number(opts.targetMB) || TARGET_MB;
    var maxDim = Number(opts.maxDim) || MAX_DIM;
    var onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;

    if (typeof MediaRecorder === "undefined") throw new Error("MediaRecorder tidak didukung HP ini");
    var pick = pickRecorderMime();
    if (!pick) throw new Error("browser tidak bisa merekam video");
    var canvas = document.createElement("canvas");
    if (!canvas.captureStream) throw new Error("captureStream tidak didukung HP ini");

    var meta = await getVideoMetadata(file);
    if (!meta || !meta.width || !meta.height) throw new Error("metadata video kosong");
    if (file.size <= targetMB * MB && Math.max(meta.width, meta.height) <= maxDim) return file;

    var dim = hitungDimensi(meta.width, meta.height, maxDim) || { w: meta.width, h: meta.height };
    var dur = Number(meta.duration) || 0;
    var bitrate = dur > 1 ? Math.floor((targetMB * MB * 8) / dur) : 1800000;
    bitrate = Math.max(600000, Math.min(3000000, bitrate));

    var url = URL.createObjectURL(file);
    var video = document.createElement("video");
    video.preload = "auto";
    try {
      video.playsInline = true;
    } catch (e) {}
    video.muted = false;
    video.src = url;
    var stream = null;
    var rec = null;
    var gambarTimer = null;
    var batasTimer = null;
    function bersih() {
      try {
        if (gambarTimer) clearInterval(gambarTimer);
      } catch (e) {}
      try {
        if (batasTimer) clearTimeout(batasTimer);
      } catch (e) {}
      try {
        video.pause();
      } catch (e) {}
      try {
        if (stream) stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e2) {} });
      } catch (e) {}
      try {
        URL.revokeObjectURL(url);
      } catch (e) {}
    }
    try {
      // Coba dengan suara dulu (biar audio ketangkap); kalau autoplay
      // ditolak browser, fallback mute (hasil tanpa suara).
      try {
        await video.play();
      } catch (e) {
        video.muted = true;
        await video.play();
      }
      canvas.width = dim.w;
      canvas.height = dim.h;
      var ctx = canvas.getContext("2d");
      stream = canvas.captureStream(30);
      try {
        if (video.captureStream) {
          var vs = video.captureStream();
          var ats = (vs && vs.getAudioTracks && vs.getAudioTracks()) || [];
          for (var i = 0; i < ats.length; i++) {
            try {
              stream.addTrack(ats[i]);
            } catch (e2) {}
          }
        }
      } catch (e) {}
      var chunks = [];
      var selesai = new Promise(function (resS, rejS) {
        try {
          rec = new MediaRecorder(stream, {
            mimeType: pick.mime,
            videoBitsPerSecond: bitrate,
            audioBitsPerSecond: 96000,
          });
        } catch (e) {
          rejS(e);
          return;
        }
        rec.ondataavailable = function (e) {
          if (e && e.data && e.data.size) chunks.push(e.data);
        };
        rec.onstop = function () { resS(); };
        rec.onerror = function () { rejS(new Error("rekam video gagal")); };
      });
      video.addEventListener("ended", function () {
        setTimeout(function () {
          try {
            if (rec && rec.state !== "inactive") rec.stop();
          } catch (e) {}
        }, 350);
      });
      gambarTimer = setInterval(function () {
        try {
          if (video.readyState >= 2) ctx.drawImage(video, 0, 0, dim.w, dim.h);
        } catch (e) {}
        if (onProgress && dur > 1) {
          try {
            onProgress("native", Math.min(0.99, (video.currentTime || 0) / dur), "Mengompres video…");
          } catch (e2) {}
        }
      }, 100);
      // Pengaman: jangan lebih dari 5 menit / 4x durasi.
      var maxMs = Math.min(300000, Math.max(60000, (dur || 60) * 4000 + 30000));
      batasTimer = setTimeout(function () {
        try {
          if (rec && rec.state !== "inactive") rec.stop();
        } catch (e) {}
      }, maxMs);
      try {
        rec.start(250);
      } catch (e) {
        rec.start();
      }
      await selesai;
      if (!chunks.length) throw new Error("hasil rekam kosong");
      var blob = new Blob(chunks, { type: pick.type });
      if (!blob.size) throw new Error("hasil rekam kosong");
      var hasil = new File([blob], namaDasar(file.name) + "-720p" + pick.ext, { type: pick.type });
      if (hasil.size >= file.size) return file; // tidak mengecil = pakai asli
      return hasil;
    } finally {
      bersih();
    }
  }

  // =========================================================================
  // ENGINE 2: FFMPEG.WASM — transcode beneran ke MP4 H264 720p + AAC.
  // Single-thread (@ffmpeg/core ESM) biar jalan tanpa header COOP/COEP.
  // Download ~30MB sekali, lalu instance dipakai ulang + diantre serial.
  // =========================================================================
  var _ff = null;
  var _ffUtil = null;
  var _ffLoading = null;
  var _antre = Promise.resolve();
  var _seq = 0;

  function _laporkan(onProgress, tahap, frac, msg) {
    try {
      if (typeof onProgress === "function") onProgress(tahap, frac, msg);
    } catch (e) {}
  }

  // Ambil file JS dari CDN jadi blob URL same-origin, SEKALIGUS buang baris
  // `//# sourceMappingURL=` — kalau tidak dibuang, devtools request .map
  // relatif ke blob: URL dan 404 berisik (fungsinya tidak terganggu).
  async function blobBersih(url) {
    var r = await fetch(url);
    if (!r.ok) throw new Error("gagal unduh encoder (" + r.status + ")");
    var teks = await r.text();
    try {
      teks = teks.replace(/\/\/# sourceMappingURL=.*$/m, "");
    } catch (e) {}
    return URL.createObjectURL(new Blob([teks], { type: "text/javascript" }));
  }

  // Rakit worker class versi ESM jadi SATU blob: worker.js + const.js +
  // errors.js di-inline (import relatifnya dibuang, `export` top-level tetap
  // legal di module worker). Hasil di-cache biar unduh sekali aja.
  var _workerBlob = null;
  async function rakitWorkerURL() {
    if (_workerBlob) return _workerBlob;
    async function ambil(nama) {
      var r = await fetch(FFMPEG_ESM + "/" + nama);
      if (!r.ok) throw new Error("gagal unduh " + nama + " (" + r.status + ")");
      return r.text();
    }
    var bagian = await Promise.all([ambil("worker.js"), ambil("const.js"), ambil("errors.js")]);
    var worker = String(bagian[0]).replace(/^\s*import\s+[^;]+?\sfrom\s*["']\.\/[^"']+["'];?\s*$/gm, "");
    var gabung = [bagian[1], bagian[2], worker]
      .map(function (s) {
        return String(s || "").replace(/\/\/# sourceMappingURL=.*$/m, "");
      })
      .join("\n;\n");
    if (gabung.indexOf("onmessage") < 0 || gabung.indexOf("FFMessageType") < 0) {
      throw new Error("rakitan worker tidak lengkap");
    }
    _workerBlob = URL.createObjectURL(new Blob([gabung], { type: "text/javascript" }));
    return _workerBlob;
  }

  // Batasi janji biar tidak menggantung selamanya (pengalaman: worker mati
  // diam-diam = load() tidak pernah selesai). Kalah = worker dimatikan.
  function denganTimeout(promise, ms, pesan) {
    var timer = null;
    var batas = new Promise(function (_, rej) {
      timer = setTimeout(function () { rej(new Error(pesan)); }, ms);
    });
    return Promise.race([promise, batas]).then(
      function (v) {
        try { clearTimeout(timer); } catch (e) {}
        return v;
      },
      function (e) {
        try { clearTimeout(timer); } catch (e2) {}
        throw e;
      },
    );
  }

  async function muatFFmpeg(onProgress) {
    if (_ff) return _ff;
    if (_ffLoading) return _ffLoading;
    _ffLoading = (async function () {
      try {
        _laporkan(onProgress, "ffmpeg-load", 0.02, "Mengunduh encoder (~30MB, sekali aja)…");
        var modF = await import(FFMPEG_LIB);
        var modU = await import(FFUTIL_LIB);
        var FFmpegClass = (modF && modF.FFmpeg) || (modF && modF.default && modF.default.FFmpeg) || (modF && modF.default);
        if (!FFmpegClass) throw new Error("pustaka ffmpeg tidak cocok");
        if (!modU || !modU.fetchFile || !modU.toBlobURL) throw new Error("pustaka util ffmpeg tidak cocok");
        var ff = new FFmpegClass();
        try {
          ff.on("progress", function (ev) {
            var p = ev && typeof ev.progress === "number" ? ev.progress : 0;
            if (!(p >= 0)) p = 0;
            if (p > 1) p = 1;
            _laporkan(onProgress, "ffmpeg", 0.1 + 0.85 * p, "Mengompres video " + Math.round(p * 100) + "%…");
          });
        } catch (e) {}
        _laporkan(onProgress, "ffmpeg-load", 0.05, "Memuat encoder…");
        // Unduh bahan (termasuk wasm ~32MB) dibatasi 5 menit, nyala worker
        // dibatasi 3 menit — gagal/lemot = lempar error biar fallback jalan,
        // jangan pernah gantung.
        var cfg = await denganTimeout(
          (async function () {
            return {
              classWorkerURL: await rakitWorkerURL(),
              coreURL: await blobBersih(CORE_BASE + "/ffmpeg-core.js"),
              wasmURL: await modU.toBlobURL(CORE_BASE + "/ffmpeg-core.wasm", "application/wasm"),
            };
          })(),
          300000,
          "unduh encoder kelamaan (cek koneksi)",
        );
        _laporkan(onProgress, "ffmpeg-load", 0.5, "Menyalakan encoder…");
        try {
          await denganTimeout(ff.load(cfg), 180000, "encoder tidak merespons");
        } catch (e) {
          try { ff.terminate(); } catch (e2) {}
          throw e;
        }
        _ff = ff;
        _ffUtil = modU;
        _laporkan(onProgress, "ffmpeg-load", 1, "Encoder siap");
        return ff;
      } catch (e) {
        _ffLoading = null; // boleh coba lagi lain waktu
        throw e;
      }
    })();
    return _ffLoading;
  }

  async function jalanFFmpeg(file, opts) {
    var targetMB = Number(opts.targetMB) || TARGET_MB;
    var maxDim = Number(opts.maxDim) || MAX_DIM;
    var onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
    var ff = await muatFFmpeg(onProgress);
    var U = _ffUtil;
    var meta = null;
    try {
      meta = await getVideoMetadata(file);
    } catch (e) {
      meta = null;
    }
    var dim = meta && meta.width ? hitungDimensi(meta.width, meta.height, maxDim) : null;
    var m = String(file.name || "").match(/\.[a-z0-9]+$/i);
    var inExt = m ? m[0].toLowerCase() : ".mp4";
    if (!/^\.(mp4|webm|mov|m4v)$/.test(inExt)) inExt = ".mp4";
    var tag = ++_seq + "_" + Date.now().toString(36);
    var inN = "in_" + tag + inExt;
    var outN = "out_" + tag + ".mp4";
    var outN2 = "out2_" + tag + ".mp4";
    try {
      await ff.writeFile(inN, await U.fetchFile(file));
      async function Olah(crf, preset, audioKb, d, namaOut) {
        var args = ["-i", inN];
        if (d) args.push("-vf", "scale=" + d.w + ":" + d.h);
        args.push(
          "-c:v", "libx264", "-preset", preset, "-crf", String(crf),
          "-c:a", "aac", "-b:a", String(audioKb) + "k",
          "-movflags", "+faststart", "-y", namaOut,
        );
        await ff.exec(args, 300000);
        var data = await ff.readFile(namaOut);
        if (!data || !data.length) throw new Error("hasil encode kosong");
        return new Blob([data], { type: "video/mp4" });
      }
      var blob = await Olah(28, "veryfast", 96, dim, outN);
      if (blob.size > targetMB * MB) {
        // Percobaan 2 (sekali aja): turunkan kualitas + dimensi 75%.
        try {
          var dim2 = dim ? { w: Math.max(2, Math.floor(dim.w * 0.75 / 2) * 2), h: Math.max(2, Math.floor(dim.h * 0.75 / 2) * 2) } : null;
          var blob2 = await Olah(32, "ultrafast", 64, dim2, outN2);
          if (blob2.size < blob.size) blob = blob2;
        } catch (e) {}
      }
      if (!blob.size) throw new Error("hasil encode kosong");
      var hasil = new File([blob], namaDasar(file.name) + "-720p.mp4", { type: "video/mp4" });
      if (hasil.size >= file.size) return file;
      return hasil;
    } finally {
      try { await ff.deleteFile(inN); } catch (e) {}
      try { await ff.deleteFile(outN); } catch (e) {}
      try { await ff.deleteFile(outN2); } catch (e) {}
    }
  }

  // ffmpeg dipakai serial (satu instance, antre) biar MEMFS tidak tabrakan.
  function compressVideoFfmpeg(file, opts) {
    _antre = _antre.then(function () { return jalanFFmpeg(file, opts || {}); });
    return _antre;
  }

  // =========================================================================
  // ORKESTRASI — selalu kembalikan File (asli kalau gagal/skip).
  // =========================================================================
  async function compressVideo(file, opts) {
    opts = opts || {};
    if (!isVideoFile(file)) return file;
    var engine = String(opts.engine || getEngine()).toLowerCase();
    if (engine !== "native" && engine !== "ffmpeg") return file; // "off" / tak dikenal
    // Target default dari preferensi pengguna (halaman Pengaturan); pemanggil
    // boleh override via opts. File asli tidak pernah diubah — ini cuma target.
    var targetMB = Number(opts.targetMB) || getTargetMB();
    var maxDim = Number(opts.maxDim) || getMaxDim();
    var silent = !!opts.silent;
    var luar = typeof opts.onProgress === "function" ? opts.onProgress : null;
    // Progres untuk pill Notice + teruskan ke pemanggil (db.js / halaman).
    function laporkan(tahap, frac, msg) {
      try {
        if (!silent) notifTampil(msg, frac >= 1);
      } catch (e) {}
      try {
        if (luar) luar(tahap, frac, msg);
      } catch (e) {}
    }
    function hemat(hasil) {
      return fmtMB(file.size) + " → " + fmtMB(hasil.size);
    }
    try {
      // Jalur cepat: file mungil langsung lolos tanpa baca metadata.
      if (file.size <= 2 * MB) return file;
      var meta = null;
      try {
        meta = await getVideoMetadata(file);
        if (meta && meta.width && file.size <= targetMB * MB && Math.max(meta.width, meta.height) <= maxDim) {
          return file; // sudah kecil: diam-diam lolos, kartu tak perlu muncul
        }
      } catch (e) {
        // metadata gagal dibaca: native tidak bisa, tapi ffmpeg masih boleh coba.
        if (engine === "native") throw e;
      }
      if (!silent) {
        _notifLast = 0;
        notifTampil(engine === "ffmpeg" ? "Menyiapkan encoder…" : "Menyiapkan perekam…", true);
      }
      var o = { engine: engine, targetMB: targetMB, maxDim: maxDim, onProgress: laporkan };
      // Hasil wajib lolos validasi (tipe video/* + ukuran >0) sebelum dipakai;
      // gagal validasi = pakai file asli. File asli tidak pernah dihapus.
      function pakai(h) {
        if (h && h !== file && !hasilValid(h)) {
          console.warn("hasil kompresi tidak valid, pakai asli");
          return file;
        }
        return h || file;
      }
      if (engine === "ffmpeg") {
        try {
          var h1 = pakai(await compressVideoFfmpeg(file, o));
          if (!silent) {
            if (h1 !== file) notifSelesai(hemat(h1));
            else notifTutup();
          }
          return h1;
        } catch (e) {
          console.warn("ffmpeg gagal, coba native:", e);
          if (!silent) notifTampil("Encoder gagal, coba cara ringan…", true);
          try {
            var h2 = pakai(await compressVideoNative(file, o));
            if (!silent) {
              if (h2 !== file) notifSelesai(hemat(h2));
              else notifTutup();
            }
            return h2;
          } catch (e2) {
            console.warn("compress video gagal, pakai asli:", e2);
            if (!silent) notifGagal();
            return file;
          }
        }
      }
      // native: gagal = pakai asli (jangan diam-diam download 30MB di HP).
      try {
        var h3 = pakai(await compressVideoNative(file, o));
        if (!silent) {
          if (h3 !== file) notifSelesai(hemat(h3));
          else notifTutup();
        }
        return h3;
      } catch (e) {
        console.warn("compress video gagal, pakai asli:", e);
        if (!silent) notifGagal();
        return file;
      }
    } catch (e) {
      console.warn("compress video gagal, pakai asli:", e);
      if (!silent) notifGagal();
      return file;
    }
  }

  // API publik (dipakai halaman Pengaturan + db.js).
  window.TarpanCompress = {
    getPref: getPref,
    setPref: setPref,
    getEngine: getEngine,
    getMaxDim: getMaxDim,
    setMaxDim: setMaxDim,
    getTargetMB: getTargetMB,
    setTargetMB: setTargetMB,
    isDesktop: isDesktop,
    isVideoFile: isVideoFile,
    getVideoMetadata: getVideoMetadata,
    compressVideo: compressVideo,
    compressVideoNative: compressVideoNative,
    compressVideoFfmpeg: compressVideoFfmpeg,
    TARGET_MB: TARGET_MB,
    MAX_DIM: MAX_DIM,
  };
  window.compressVideo = compressVideo;
})();
