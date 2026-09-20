// =========================================================================
// OUTBOX — antrean offline + auto-sync (dipakai semua halaman)
// Tombol upload saat offline -> tersimpan sebagai draft di IndexedDB
// (termasuk file foto/dokumen) -> terkirim otomatis saat ada internet.
//
// Cara pakai per modul (di simpan()/kirim() setelah validasi, sebelum try):
//   const __spec = () => ({ modul: "keuangan", op: id ? "update" : "create",
//     label: "Kas ...", payload: {...}, files: [...], cacheKeys: ["kas"] });
//   if (OutboxOffline()) { await Outbox.enqueue(__spec()); Outbox.sesudahAntre(resetFn); return; }
//   ...
//   } catch (err) {
//     if (await Outbox.enqueueOnNetErr(err, __spec())) { Outbox.sesudahAntre(resetFn); return; }
//     ... error handling lama ...
//   }
//
// Helper global (biar modul lama tetap jalan walau outbox gagal load):
//   OutboxOffline() -> bool aman, Outbox -> namespace utama.
// Urutan include: db.js -> outbox.js -> (script halaman). SW: precache.
// =========================================================================
(function () {
  "use strict";

  // Aman dipanggil modul bahkan sebelum outbox.js selesai dimuat.
  window.OutboxOffline = function () {
    try {
      return typeof Outbox !== "undefined" ? Outbox.offline() : false;
    } catch {
      return false;
    }
  };

  var DB_NAMA = "osis_outbox";
  var DB_VER = 1;
  var MAX_TRIES = 8;

  var MODUL_LABEL = {
    aspirasi: "Aspirasi",
    lagu: "Request Lagu",
    absensi: "Absensi",
    tabungan: "Tabungan",
    task: "Task",
    keuangan: "Keuangan",
    dokumen: "Dokumen",
    agenda: "Agenda",
    galeri: "Galeri",
    kegiatan: "Kegiatan",
    prestasi: "Prestasi",
    notulensi: "Notulensi",
    proker: "Proker",
    evaluasi: "Evaluasi",
    anggota: "Anggota",
    pimpinan: "Pengurus",
    sekbid: "Sekbid",
    webfoto: "Foto Web",
    siteteks: "Teks Web",
    formrespons: "Respons Formulir",
    formbuilder: "Formulir",
    akses: "Akses",
    profil: "Profil",
  };

  function labelModul(m) {
    return MODUL_LABEL[m] || m;
  }

  function toast(msg, tipe) {
    try {
      if (typeof window.showToast === "function") {
        window.showToast(msg, tipe || "success");
        return;
      }
    } catch {}
    try {
      if (tipe === "error") alert(msg);
      else console.log("[outbox]", msg);
    } catch {}
  }

  function uidOp() {
    return (
      "op_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 10)
    );
  }

  function userSnapshot() {
    try {
      var u =
        typeof OsisAuth !== "undefined" && OsisAuth.getUser
          ? OsisAuth.getUser()
          : null;
      if (!u) return null;
      return {
        id: u.id ?? null,
        mode: u.mode || "",
        nama: u.nama || u.nickname || u.username || "",
      };
    } catch {
      return null;
    }
  }

  // =====================================================================
  // IndexedDB mungil (ops + blobs). Tanpa dependensi.
  // =====================================================================
  var _db = null;
  function db() {
    if (_db) return Promise.resolve(_db);
    return new Promise(function (res, rej) {
      if (!("indexedDB" in window)) {
        rej(new Error("IndexedDB tidak tersedia di browser ini."));
        return;
      }
      var req;
      try {
        req = window.indexedDB.open(DB_NAMA, DB_VER);
      } catch (e) {
        rej(e);
        return;
      }
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains("ops"))
          d.createObjectStore("ops", { keyPath: "id" });
        if (!d.objectStoreNames.contains("blobs"))
          d.createObjectStore("blobs", { keyPath: "id" });
      };
      req.onsuccess = function () {
        _db = req.result;
        res(_db);
      };
      req.onerror = function () {
        rej(req.error || new Error("Gagal buka antrean lokal."));
      };
    });
  }

  function tx(store, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t;
        try {
          t = d.transaction(store, mode).objectStore(store);
        } catch (e) {
          rej(e);
          return;
        }
        var rq;
        try {
          rq = fn(t);
        } catch (e) {
          rej(e);
          return;
        }
        rq.onsuccess = function () {
          res(rq.result);
        };
        rq.onerror = function () {
          rej(rq.error || new Error("Gagal akses antrean."));
        };
      });
    });
  }

  function semuaOps() {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var out = [];
        try {
          var t = d.transaction("ops", "readonly").objectStore("ops");
          var cur = t.openCursor();
          cur.onsuccess = function () {
            var c = cur.result;
            if (c) {
              out.push(c.value);
              c.continue();
            } else res(out);
          };
          cur.onerror = function () {
            rej(cur.error || new Error("Gagal baca antrean."));
          };
        } catch (e) {
          rej(e);
        }
      });
    });
  }

  // =====================================================================
  // API utama
  // =====================================================================
  var sedangJalan = false;
  var listeners = [];

  var Outbox = {
    handlers: {},
    refreshers: {},

    offline: function () {
      try {
        return typeof navigator !== "undefined" && navigator.onLine === false;
      } catch {
        return false;
      }
    },

    // Deteksi error jaringan (fetch gagal total) vs penolakan server.
    isNetErr: function (err) {
      if (!err) return Outbox.offline();
      if (Outbox.offline()) return true;
      var m = String((err && err.message) || err || "");
      if (!m) return true; // TypeError kosong = fetch abort/offline
      return /failed to fetch|networkerror|network request failed|load failed|offline|econn|etimedout|timeout|abort/i.test(
        m,
      );
    },

    onChange: function (fn) {
      if (typeof fn === "function") listeners.push(fn);
    },

    _emit: function () {
      Outbox.hitung().then(
        function (n) {
          listeners.forEach(function (fn) {
            try {
              fn(n);
            } catch {}
          });
        },
        function () {},
      );
    },

    async hitung() {
      try {
        var ops = await semuaOps();
        return ops.filter(function (o) {
          return o.status === "pending" || o.status === "failed";
        }).length;
      } catch {
        return 0;
      }
    },

    async daftar() {
      try {
        var ops = await semuaOps();
        ops.sort(function (a, b) {
          return (a.createdAt || 0) - (b.createdAt || 0);
        });
        return ops;
      } catch {
        return [];
      }
    },

    // Simpan op + file ke IndexedDB. files: [{slot, file|blob, name, type}]
    async enqueue(spec) {
      var s = spec || {};
      if (!s.modul || !Outbox.handlers[s.modul])
        throw new Error("Modul antrean tidak dikenal: " + s.modul);
      var id = uidOp();
      var files = [];
      var blobs = [];
      var arr = Array.isArray(s.files) ? s.files : [];
      for (var i = 0; i < arr.length; i++) {
        var f = arr[i] || {};
        var blob = f.blob || f.file || null;
        if (!blob) continue;
        if (blob.size > 25 * 1024 * 1024)
          throw new Error(
            "File " + (f.name || "lampiran") + " >25MB, kecilkan dulu.",
          );
        var bid = id + "_b" + i;
        blobs.push({
          id: bid,
          blob: blob.size ? blob : new Blob([blob]),
          name: f.name || blob.name || "file",
          type: f.type || blob.type || "",
        });
        files.push({
          slot: f.slot || ("file" + i),
          name: f.name || blob.name || "file",
          type: f.type || blob.type || "",
          size: blob.size || 0,
          blobId: bid,
        });
      }
      var op = {
        id: id,
        modul: s.modul,
        op: s.op === "update" ? "update" : "create",
        label: String(s.label || labelModul(s.modul)),
        payload: s.payload || {},
        files: files,
        cacheKeys: Array.isArray(s.cacheKeys) ? s.cacheKeys : [],
        user: userSnapshot(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tries: 0,
        status: "pending",
        lastError: "",
      };
      try {
        var d = await db();
        await new Promise(function (res, rej) {
          var t = d.transaction(["ops", "blobs"], "readwrite");
          t.objectStore("ops").put(op);
          blobs.forEach(function (b) {
            t.objectStore("blobs").put(b);
          });
          t.oncomplete = function () {
            res();
          };
          t.onerror = function () {
            rej(t.error || new Error("Gagal simpan antrean."));
          };
        });
      } catch (e) {
        throw new Error(
          "Gagal simpan draft offline (storage penuh?): " +
            (e.message || e),
        );
      }
      Outbox._emit();
      Outbox.cobaDaftarkanSync();
      return id;
    },

    // Dipanggil dari catch modul: antrekan hanya kalau murni jaringan.
    async enqueueOnNetErr(err, spec) {
      if (!Outbox.isNetErr(err)) return false;
      try {
        await Outbox.enqueue(spec);
        return true;
      } catch (e) {
        console.error("[outbox] enqueue gagal:", e);
        return false;
      }
    },

    // Helper UI standar setelah data masuk antrean.
    sesudahAntre: function (resetFn) {
      try {
        if (typeof resetFn === "function") resetFn();
      } catch {}
      toast("Offline — tersimpan, terkirim otomatis saat online.", "info");
      Outbox._emit();
    },

    toastAntre: function () {
      toast("Offline — tersimpan, terkirim otomatis saat online.", "info");
    },

    async hapus(id) {
      var op = await tx("ops", "readonly", function (t) {
        return t.get(id);
      });
      await tx("ops", "readwrite", function (t) {
        return t.delete(id);
      });
      if (op && Array.isArray(op.files)) {
        for (var i = 0; i < op.files.length; i++) {
          try {
            var bid = op.files[i].blobId;
            await tx("blobs", "readwrite", function (t) {
              return t.delete(bid);
            });
          } catch {}
        }
      }
      Outbox._emit();
    },

    async _tandai(id, patch) {
      var op = await tx("ops", "readonly", function (t) {
        return t.get(id);
      });
      if (!op) return null;
      Object.keys(patch || {}).forEach(function (k) {
        op[k] = patch[k];
      });
      op.updatedAt = Date.now();
      await tx("ops", "readwrite", function (t) {
        return t.put(op);
      });
      return op;
    },

    async blobOf(meta) {
      var row = await tx("blobs", "readonly", function (t) {
        return t.get(meta.blobId);
      });
      if (!row || !row.blob) throw new Error("File antrean hilang.");
      var b = row.blob;
      try {
        return new File([b], meta.name || "file", {
          type: meta.type || b.type || "",
          lastModified: Date.now(),
        });
      } catch {
        return b;
      }
    },

    // Upload 1 file antrean -> path storage. pathFn(meta, idx) -> string.
    async uploadSlot(meta, idx, pathFn, uid) {
      var file = await Outbox.blobOf(meta);
      var ext = String(
        (meta.name || "file").split(".").pop() || "bin",
      ).toLowerCase();
      var path = pathFn(meta, idx, ext, uid || "anon");
      await uploadFotoStorage(file, path);
      return path;
    },

    uidAktif: function (op) {
      if (op && op.user && op.user.id) return op.user.id;
      try {
        var u =
          typeof OsisAuth !== "undefined" && OsisAuth.getUser
            ? OsisAuth.getUser()
            : null;
        if (u && u.mode === "osis" && u.id) return u.id;
      } catch {}
      return null;
    },

    butuhLogin: function (op) {
      var uid = Outbox.uidAktif(op);
      if (!uid)
        throw new Error("Butuh login OSIS dulu (kamu logout setelah antre).");
      return uid;
    },

    // Bersihkan cache SWR yang relevan (dukung wildcard "agenda_*").
    buangCache: function (keys) {
      try {
        (keys || []).forEach(function (k) {
          if (!k) return;
          if (String(k).slice(-2) === "_*") {
            var pre =
              typeof Cache !== "undefined"
                ? Cache.prefix + (Cache.version || "") + "_" + String(k).slice(0, -2)
                : "osis_cache_" + String(k).slice(0, -2);
            try {
              Object.keys(localStorage).forEach(function (lk) {
                if (lk.indexOf(pre) === 0) localStorage.removeItem(lk);
              });
            } catch {}
          } else if (typeof Cache !== "undefined") {
            Cache.del(k);
          }
        });
      } catch {}
    },

    cobaDaftarkanSync: function () {
      try {
        if (
          "serviceWorker" in navigator &&
          window.isSecureContext !== false
        ) {
          navigator.serviceWorker.ready
            .then(function (reg) {
              if (reg && reg.sync && reg.sync.register)
                return reg.sync.register("osis-outbox").catch(function () {});
            })
            .catch(function () {});
        }
      } catch {}
    },

    // Proses antrean FIFO. silent=true -> tanpa toast sukses.
    async processQueue(opts) {
      var o = opts || {};
      if (sedangJalan) return { jalan: true };
      if (Outbox.offline() && !o.abaikanOffline) return { offline: true };
      sedangJalan = true;
      var hasil = { ok: 0, gagal: 0, lewati: 0 };
      try {
        var ops = await Outbox.daftar();
        var antre = ops.filter(function (x) {
          return (
            (x.status === "pending" ||
              (x.status === "failed" && (x.tries || 0) < MAX_TRIES) ||
              o.paksaUlang) &&
            x.status !== "sending"
          );
        });
        for (var i = 0; i < antre.length; i++) {
          var op = antre[i];
          // berhenti di item pertama yang gagal jaringan (sisanya pasti gagal juga)
          await Outbox._tandai(op.id, {
            status: "sending",
            tries: (op.tries || 0) + 1,
          });
          try {
            var h = Outbox.handlers[op.modul];
            if (!h) throw new Error("Handler " + op.modul + " hilang.");
            await h(op);
            await Outbox.hapus(op.id);
            Outbox.buangCache(op.cacheKeys);
            try {
              var rf = Outbox.refreshers[op.modul];
              if (typeof rf === "function") await rf();
            } catch (e) {
              console.warn("[outbox] refresh", op.modul, e);
            }
            hasil.ok++;
          } catch (e) {
            if (Outbox.isNetErr(e)) {
              await Outbox._tandai(op.id, {
                status: "pending",
                lastError: "Menunggu koneksi.",
              });
              break; // jaringan putus lagi — stop, coba lain waktu
            }
            await Outbox._tandai(op.id, {
              status: "failed",
              lastError: String((e && e.message) || e || "Gagal kirim."),
            });
            hasil.gagal++;
          }
        }
      } finally {
        sedangJalan = false;
        Outbox._emit();
      }
      if (!o.silent) {
        if (hasil.ok && !hasil.gagal)
          toast(
            hasil.ok === 1
              ? "1 antrean terkirim!"
              : hasil.ok + " antrean terkirim!",
          );
        else if (hasil.ok && hasil.gagal)
          toast(
            hasil.ok + " terkirim, " + hasil.gagal + " gagal (cek panel).",
            "info",
          );
        else if (hasil.gagal && o.manual)
          toast("Gagal kirim — cek panel antrean.", "error");
      }
      return hasil;
    },

    async kirimUlang(id) {
      await Outbox._tandai(id, { status: "pending", lastError: "" });
      return Outbox.processQueue({ manual: true });
    },
  };

  window.Outbox = Outbox;

  // =====================================================================
  // HANDLERS — cermin logika simpan online, tapi data dari antrean.
  // Path storage dibuat saat SYNC (timestamp baru), bukan saat antre.
  // =====================================================================
  function extOf(name, fb) {
    var e = String((name || "").split(".").pop() || fb || "bin").toLowerCase();
    return (e.replace(/[^a-z0-9]/g, "") || fb || "bin").slice(0, 8);
  }

  // ---- Aspirasi & Lagu (publik, tanpa login; limit server dicek saat sync)
  Outbox.handlers.aspirasi = async function (op) {
    var p = op.payload || {};
    if (op.op === "update") {
      if (op.user && op.user.mode === "osis" && op.user.id)
        await editAspirasiOsis(op.user.id, p.id, p.nama, p.kelas, p.isi);
      else await editAspirasiSendiri(p.id, p.nama, p.kelas, p.isi);
    } else {
      await kirimAspirasi(p.nama, p.kelas, p.isi, !!p.is_private);
    }
  };
  Outbox.handlers.lagu = async function (op) {
    var p = op.payload || {};
    if (op.op === "update") {
      if (op.user && op.user.mode === "osis" && op.user.id)
        await editLaguOsis(op.user.id, p.id, p.judul, p.penyanyi, p.pesan, p.nama);
      else await editLaguSendiri(p.id, p.judul, p.penyanyi, p.pesan, p.nama);
    } else {
      await kirimRequestLagu(p.judul, p.penyanyi, p.pesan, p.nama);
    }
  };

  // ---- Absensi (batch baris baru)
  Outbox.handlers.absensi = async function (op) {
    if (typeof buatAbsensi !== "function")
      throw new Error("Buka halaman Absensi saat online untuk mengirim antrean ini.");
    var uid = Outbox.butuhLogin(op);
    var rows = (op.payload && op.payload.rows) || [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      await buatAbsensi(uid, {
        tanggal: r.tanggal,
        nama: r.nama,
        status: r.status,
        alasan: r.alasan,
        kegiatan: r.kegiatan || "",
      });
    }
  };

  // ---- Tabungan & Task (teks)
  Outbox.handlers.tabungan = async function (op) {
    if (typeof buatTabungan !== "function")
      throw new Error("Buka halaman Tabungan saat online untuk mengirim antrean ini.");
    var uid = Outbox.butuhLogin(op);
    var p = op.payload || {};
    var f = { nama: p.nama, tanggal: p.tanggal, nominal: p.nominal, jenis: p.jenis };
    if (op.op === "update" && p.id) await updateTabungan(uid, p.id, f);
    else await buatTabungan(uid, f);
  };
  Outbox.handlers.task = async function (op) {
    var uid = Outbox.butuhLogin(op);
    var p = op.payload || {};
    if (op.op === "update" && p.id) await updateTask(uid, p.id, p.f);
    else await buatTask(uid, p.f);
  };

  // ---- Keuangan (1 bukti)
  Outbox.handlers.keuangan = async function (op) {
    var uid = Outbox.butuhLogin(op);
    var p = op.payload || {};
    var f = Object.assign({}, p.f);
    if (op.files && op.files.length) {
      var path = await Outbox.uploadSlot(
        op.files[0], 0,
        function (m, i, ext, u) {
          return "kas/kas-" + u + "-" + Date.now() + "." + ext;
        }, uid,
      );
      f.bukti_path = path;
    } else {
      f.bukti_path = p.existingBukti || "";
    }
    if (op.op === "update" && p.id) {
      await updateKas(uid, p.id, f);
      if (f.bukti_path && p.existingBukti && f.bukti_path !== p.existingBukti) {
        try {
          await hapusFotoStorage(p.existingBukti);
        } catch {}
      }
    } else {
      await buatKas(uid, f);
    }
  };

  // ---- Dokumen (1 file)
  Outbox.handlers.dokumen = async function (op) {
    var uid = Outbox.butuhLogin(op);
    var p = op.payload || {};
    var f = Object.assign({}, p.f);
    if (op.files && op.files.length) {
      var m = op.files[0];
      var path = await Outbox.uploadSlot(
        m, 0,
        function (mm, i, ext, u) {
          return "dokumen/dokumen-" + u + "-" + Date.now() + "." + extOf(mm.name, "bin");
        }, uid,
      );
      f.file_path = path;
      f.file_type = extOf(m.name, "bin");
      f.mime = m.type || "";
      f.ukuran_bytes = m.size || 0;
    }
    if (op.op === "update" && p.id) {
      await updateDokumen(uid, p.id, f);
      if (f.file_path && p.existingPath && f.file_path !== p.existingPath) {
        try {
          await hapusFotoStorage(p.existingPath);
        } catch {}
      }
    } else {
      await buatDokumen(uid, f);
    }
  };

  // ---- Agenda (multi foto)
  async function uploadBanyak(op, uid, folder, prefix) {
    var out = [];
    for (var i = 0; i < (op.files || []).length; i++) {
      var path = await Outbox.uploadSlot(
        op.files[i], i,
        (function (idx) {
          return function (m, j, ext, u) {
            return folder + "/" + prefix + u + "-" + Date.now() + "-" + idx + "." + extOf(m.name, "jpg");
          };
        })(i), uid,
      );
      out.push({ path: path, caption: "" });
    }
    return out;
  }
  Outbox.handlers.agenda = async function (op) {
    var uid = Outbox.butuhLogin(op);
    var p = op.payload || {};
    var fotos = (p.fotosExisting || []).concat(
      await uploadBanyak(op, uid, "agenda", "agenda-"),
    );
    if (op.op === "update" && p.id) {
      await updateAgenda(uid, p.id, p.judul, p.deskripsi, p.tanggal, p.lokasi, p.status, fotos, p.order, p.pelaksana);
    } else {
      if (!p.sekbid_id) throw new Error("Sekbid tidak kesimpan di antrean.");
      await buatAgenda(uid, p.sekbid_id, p.judul, p.deskripsi, p.tanggal, p.lokasi, p.status, fotos, p.order, p.pelaksana);
    }
  };

  // ---- Galeri / Kegiatan / Prestasi (buat baru)
  Outbox.handlers.galeri = async function (op) {
    var uid = Outbox.butuhLogin(op);
    var p = op.payload || {};
    var paths = [];
    for (var i = 0; i < (op.files || []).length; i++) {
      paths.push(
        await Outbox.uploadSlot(op.files[i], i, function (m, j, ext, u) {
          return "gallery/galeri-" + u + "-" + Date.now() + "-" + j + "." + extOf(m.name, "jpg");
        }, uid),
      );
    }
    await buatGallery(uid, p.judul, p.deskripsi || "", paths);
  };
  Outbox.handlers.kegiatan = async function (op) {
    var uid = Outbox.butuhLogin(op);
    var p = op.payload || {};
    var fotos = (p.fotosExisting || []).concat(
      await uploadBanyak(op, uid, "kegiatan", "kegiatan-"),
    );
    await buatKegiatan(uid, p.judul, p.deskripsi || "", p.badge || "", fotos, p.order == null ? 99 : p.order);
  };
  Outbox.handlers.prestasi = async function (op) {
    var uid = Outbox.butuhLogin(op);
    var p = op.payload || {};
    if (!op.files || !op.files.length) throw new Error("Foto antrean hilang.");
    var path = await Outbox.uploadSlot(op.files[0], 0, function (m, i, ext, u) {
      return "prestasi/prestasi-" + u + "-" + Date.now() + "." + extOf(m.name, "jpg");
    }, uid);
    await buatPrestasi(uid, p.tag || "", p.caption || "", [{ path: path, caption: "" }], p.order == null ? 99 : p.order);
  };

  // ---- Notulensi / Proker / Evaluasi (buat + ubah, multi lampiran)
  function handlerMulti(tabel) {
    var cfg = {
      notulensi: { folder: "notulensi", prefix: "notulensi-", field: "lampiran", buat: "buatNotulensi", ubah: "updateNotulensi" },
      proker: { folder: "proker", prefix: "proker-", field: "dokumentasi", buat: "buatProker", ubah: "updateProker" },
      evaluasi: { folder: "evaluasi", prefix: "evaluasi-", field: "dokumentasi", buat: "buatEvaluasi", ubah: "updateEvaluasi" },
    }[tabel];
    return async function (op) {
      var uid = Outbox.butuhLogin(op);
      var p = op.payload || {};
      var f = Object.assign({}, p.f);
      f[cfg.field] = (p.existing || []).concat(
        await uploadBanyak(op, uid, cfg.folder, cfg.prefix),
      );
      if (op.op === "update" && p.id) {
        await window[cfg.ubah](uid, p.id, f);
      } else {
        await window[cfg.buat](uid, f);
      }
    };
  }
  Outbox.handlers.notulensi = handlerMulti("notulensi");
  Outbox.handlers.proker = handlerMulti("proker");
  Outbox.handlers.evaluasi = handlerMulti("evaluasi");

  // ---- Anggota / Pengurus / Sekbid
  Outbox.handlers.anggota = async function (op) {
    var uid = Outbox.butuhLogin(op);
    var p = op.payload || {};
    var foto = p.fotoExist || "";
    if (op.files && op.files.length) {
      foto = await Outbox.uploadSlot(op.files[0], 0, function (m, i, ext, u) {
        return "anggota/anggota-" + (p.tahun || "x") + "-" + Date.now() + "." + extOf(m.name, "jpg");
      }, uid);
      if (p.fotoExist && p.fotoExist !== foto) {
        try {
          await hapusFotoStorage(p.fotoExist);
        } catch {}
      }
    }
    if (op.op === "update" && p.id) {
      var rowU = { nama: p.nama, jabatan: p.jabatan, urutan: p.urutan,
        panggilan: p.panggilan || "", ttl: p.ttl || "",
        visi: p.visi || "", misi: p.misi || "",
        ig: p.ig || "", wa: p.wa || "", tiktok: p.tiktok || "",
        motto: p.motto || "", kelas: p.kelas || "", username: p.username || "" };
      // foto hanya dikirim kalau ada (baru/existing) — jangan hapus foto server.
      if (foto || (op.files && op.files.length)) rowU.foto = foto;
      try {
        await updateAnggota(p.id, rowU);
      } catch (e) {
        if (rowU.foto && String((e && e.message) || e || "").match(/foto/i)) {
          delete rowU.foto;
          await updateAnggota(p.id, rowU);
        } else throw e;
      }
    } else {
      await tambahAnggota({ tahun: p.tahun, nama: p.nama, jabatan: p.jabatan, urutan: p.urutan, foto: foto,
        panggilan: p.panggilan || "", ttl: p.ttl || "", visi: p.visi || "", misi: p.misi || "",
        ig: p.ig || "", wa: p.wa || "", tiktok: p.tiktok || "", motto: p.motto || "", kelas: p.kelas || "", username: p.username || "" });
    }
  };
  Outbox.handlers.pimpinan = async function (op) {
    Outbox.butuhLogin(op);
    var p = op.payload || {};
    var next = {
      tahun: p.tahun,
      ketua_nama: p.ketua_nama || "",
      wakil_nama: p.wakil_nama || "",
      ketua_foto: (p.existing || {}).ketua_foto || "",
      wakil_foto: (p.existing || {}).wakil_foto || "",
      foto_angkatan: (p.existing || {}).foto_angkatan || "",
    };
    var folderOf = { ketua_foto: "pimpinan", wakil_foto: "pimpinan", foto_angkatan: "angkatan" };
    var prefOf = { ketua_foto: "ketos", wakil_foto: "waketos", foto_angkatan: "foto-" };
    for (var i = 0; i < (op.files || []).length; i++) {
      var fm = op.files[i];
      var path = await Outbox.uploadSlot(fm, i, function (m, j, ext) {
        return folderOf[fm.slot] + "/" + prefOf[fm.slot] + (p.tahun || "x") + "-" + Date.now() + "." + extOf(m.name, "jpg");
      });
      if (next[fm.slot] && next[fm.slot] !== path) {
        try {
          await hapusFotoStorage(next[fm.slot]);
        } catch {}
      }
      next[fm.slot] = path;
    }
    await simpanPimpinan(next);
  };
  Outbox.handlers.sekbid = async function (op) {
    Outbox.butuhLogin(op);
    var p = op.payload || {};
    var foto = p.fotoExist || "";
    if (op.files && op.files.length) {
      foto = await Outbox.uploadSlot(op.files[0], 0, function (m, i, ext) {
        return "sekbid/sekbid-" + Date.now() + "." + extOf(m.name, "jpg");
      });
      if (p.fotoExist && p.fotoExist !== foto) {
        try {
          await hapusFotoStorage(p.fotoExist);
        } catch {}
      }
    }
    var row = { nama: p.nama, kategori: p.kategori, icon: p.icon, deskripsi: p.deskripsi, urutan: p.urutan, foto: foto };
    if (op.op === "update" && p.id) await updateSekbid(p.id, row);
    else await tambahSekbid(row);
  };

  // ---- Foto web & teks web (site-edit)
  Outbox.handlers.webfoto = async function (op) {
    Outbox.butuhLogin(op);
    var p = op.payload || {};
    if (!op.files || !op.files.length) throw new Error("Foto antrean hilang.");
    var path = await Outbox.uploadSlot(op.files[0], 0, function (m, i, ext) {
      return "web/" + String(p.kunci || "foto").replace(/[^a-z0-9_-]/gi, "") + "-" + Date.now() + "." + extOf(m.name, "jpg");
    });
    await simpanWebFoto(p.kunci, path);
    if (p.existingPath && p.existingPath !== path) {
      try {
        await hapusFotoStorage(p.existingPath);
      } catch {}
    }
  };
  Outbox.handlers.siteteks = async function (op) {
    var uid = Outbox.butuhLogin(op);
    var p = op.payload || {};
    await saveSiteText(uid, p.kunci, p.nilai);
  };

  // ---- Respons formulir (publik + login) & builder & akses & profil
  Outbox.handlers.formrespons = async function (op) {
    var p = op.payload || {};
    var jawaban = Object.assign({}, p.jawaban);
    for (var i = 0; i < (op.files || []).length; i++) {
      var fm = op.files[i];
      var path = await Outbox.uploadSlot(fm, i, function (m, j, ext) {
        return "formulir/f-" + (p.formId || "x") + "-" + Date.now() + "-" + j + "." + extOf(m.name, "bin");
      });
      jawaban[fm.slot] = { nama: fm.name, path: path, ukuran: fm.size || 0 };
    }
    // petakan key lokal -> id pertanyaan asli
    var bersih = {};
    var keyKeId = p.keyKeId || {};
    Object.keys(jawaban).forEach(function (k) {
      bersih[String(keyKeId[k] || k)] = jawaban[k];
    });
    await kirimRespons(p.formId, bersih, p.userId || null);
    if (p.flagKey) {
      try {
        localStorage.setItem(p.flagKey, "1");
      } catch {}
    }
  };
  Outbox.handlers.formbuilder = async function (op) {
    var uid = Outbox.butuhLogin(op);
    var p = op.payload || {};
    await simpanFormulir(uid, p.id ?? null, p.judul, p.deskripsi, p.status, p.settings, p.pertanyaan);
  };
  Outbox.handlers.akses = async function (op) {
    var uid = Outbox.butuhLogin(op);
    var p = op.payload || {};
    await setAkses(uid, p.targetId, p.halaman || [], p.sekbidId ?? null, true);
  };
  Outbox.handlers.profil = async function (op) {
    var uid = Outbox.butuhLogin(op);
    var p = op.payload || {};
    var fotoBaru = p.fotoDihapus ? "" : p.fotoExist || "";
    if (op.files && op.files.length) {
      fotoBaru = await Outbox.uploadSlot(op.files[0], 0, function (m, i, ext, u) {
        return "profil/profil-" + u + "-" + Date.now() + "." + extOf(m.name, "jpg");
      }, uid);
      if (p.fotoExist && p.fotoExist !== fotoBaru) {
        try {
          await hapusFotoStorage(p.fotoExist);
        } catch {}
      }
    }
    await updateOsisProfil(uid, p.nama, p.bio || "", fotoBaru);
    try {
      if (typeof Profil !== "undefined" && Profil._syncLocal)
        Profil._syncLocal({ nama: p.nama, bio: p.bio || "", foto: fotoBaru });
      if (typeof Profil !== "undefined" && Profil.renderFoto) {
        Profil.fotoPath = fotoBaru;
        Profil.renderFoto();
      }
    } catch {}
  };

  // =====================================================================
  // REFRESH — panggil ulang daftar halaman setelah sync (semua guarded).
  // =====================================================================
  function coba() {
    var fns = Array.prototype.slice.call(arguments);
    return async function () {
      for (var i = 0; i < fns.length; i++) {
        try {
          var r = fns[i]();
          if (r && typeof r.then === "function") await r;
          return;
        } catch {}
      }
    };
  }
  Outbox.refreshers.aspirasi = coba(
    function () { return Aspirasi.muatPesan(); },
  );
  Outbox.refreshers.lagu = coba(function () {
    return Lagu.muatDaftar();
  });
  Outbox.refreshers.galeri = coba(function () {
    return Galeri.muat();
  });
  Outbox.refreshers.kegiatan = coba(function () {
    return Kegiatan.muat();
  });
  Outbox.refreshers.prestasi = coba(function () {
    return Prestasi.muat();
  });
  Outbox.refreshers.keuangan = coba(function () {
    return Keuangan.muat();
  });
  Outbox.refreshers.dokumen = coba(function () {
    return Dokumen.muat();
  });
  Outbox.refreshers.agenda = coba(function () {
    return AgendaAdmin.muat();
  });
  Outbox.refreshers.absensi = coba(function () {
    return Absensi.segarkan();
  });
  Outbox.refreshers.tabungan = coba(function () {
    return Tabungan.segarkan();
  });
  Outbox.refreshers.task = coba(function () {
    return Task.muat();
  });
  Outbox.refreshers.notulensi = coba(function () {
    return Notulensi.muat();
  });
  Outbox.refreshers.proker = coba(function () {
    return Proker.muat();
  });
  Outbox.refreshers.evaluasi = coba(function () {
    return Evaluasi.muat();
  });

  function fmtWaktu(ts) {
    try {
      return new Date(ts).toLocaleString("id-ID", {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // =====================================================================
  // PANEL antrean (FAB + modal). Style inline biar jalan di semua halaman.
  // =====================================================================
  var fab = null;
  var modal = null;
  var pill = null;

  var CSS =
    "#outboxFab{position:fixed;left:16px;bottom:96px;z-index:9998;display:none;align-items:center;gap:8px;" +
    "padding:12px 16px;border:2.5px solid #1a1314;border-radius:999px;background:#ffd43b;color:#1a1314;" +
    "font-family:Outfit,system-ui,sans-serif;font-size:.82rem;font-weight:800;box-shadow:3px 3px 0 #1a1314;cursor:pointer}" +
    "#outboxFab .cnt{display:inline-grid;place-items:center;min-width:22px;height:22px;padding:0 5px;" +
    "background:#e11d2e;color:#fff;border:2px solid #1a1314;border-radius:999px;font-size:.72rem}" +
    "#outboxModal{position:fixed;inset:0;z-index:10000;display:none;align-items:flex-end;justify-content:center;" +
    "background:rgba(20,10,10,.5);padding:16px}" +
    "#outboxModal.open{display:flex}" +
    "#outboxCard{width:100%;max-width:520px;max-height:82vh;display:flex;flex-direction:column;background:#fffdf8;" +
    "border:3px solid #1a1314;border-radius:18px;box-shadow:5px 5px 0 #1a1314;overflow:hidden;" +
    "font-family:Outfit,system-ui,sans-serif;color:#1a1314}" +
    "#outboxHead{display:flex;align-items:center;gap:8px;padding:14px 16px;background:#1a1314;color:#fff}" +
    "#outboxHead b{font-size:.9rem;flex:1}" +
    "#outboxHead button{border:2px solid #fff;background:transparent;color:#fff;border-radius:10px;" +
    "font-size:.72rem;font-weight:800;padding:6px 10px;cursor:pointer}" +
    "#outboxHead button.primer{background:#e11d2e;border-color:#e11d2e}" +
    "#outboxList{overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px}" +
    ".ob-item{border:2.5px solid #1a1314;border-radius:14px;padding:10px 12px;background:#fff}" +
    ".ob-item .t{font-weight:800;font-size:.84rem}" +
    ".ob-item .m{font-size:.72rem;font-weight:700;color:#6f6668;margin-top:2px}" +
    ".ob-item .e{font-size:.74rem;font-weight:700;color:#b31222;margin-top:4px}" +
    ".ob-row{display:flex;gap:8px;margin-top:8px}" +
    ".ob-row button{flex:1;border:2px solid #1a1314;border-radius:10px;padding:7px 8px;font-size:.74rem;" +
    "font-weight:800;cursor:pointer;background:#fff;box-shadow:2px 2px 0 #1a1314}" +
    ".ob-row button.kirim{background:#e11d2e;color:#fff}" +
    ".ob-chip{display:inline-block;font-size:.66rem;font-weight:800;padding:2px 8px;border-radius:999px;" +
    "border:2px solid #1a1314;margin-left:6px;vertical-align:middle}" +
    ".ob-chip.pending{background:#ffd43b}" +
    ".ob-chip.failed{background:#ffb3b3}" +
    ".ob-chip.sending{background:#bfe3ff}" +
    ".ob-empty{text-align:center;padding:26px 10px;color:#6f6668;font-size:.84rem;font-weight:600}" +
    "#offlinePill{position:fixed;top:84px;right:16px;z-index:90;display:none;" +
    "align-items:center;gap:6px;padding:8px 14px;background:#1a1314;color:#ffd43b;border-radius:999px;" +
    "font-family:Outfit,system-ui,sans-serif;font-size:.72rem;font-weight:800;box-shadow:2px 2px 0 rgba(0,0,0,.3)}";

  function pastikanUI() {
    if (!document.getElementById("outboxStyle")) {
      var st = document.createElement("style");
      st.id = "outboxStyle";
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    if (!fab) {
      fab = document.createElement("button");
      fab.id = "outboxFab";
      fab.type = "button";
      fab.setAttribute("aria-label", "Antrean offline");
      fab.innerHTML =
        '<i class="fa-solid fa-cloud-arrow-up"></i><span>Antrean</span><span class="cnt">0</span>';
      fab.addEventListener("click", function () {
        Outbox.bukaPanel();
      });
      document.body.appendChild(fab);
    }
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "outboxModal";
      modal.innerHTML =
        '<div id="outboxCard" role="dialog" aria-label="Antrean offline">' +
        '<div id="outboxHead"><b><i class="fa-solid fa-cloud-arrow-up"></i> Menunggu terkirim</b>' +
        '<button class="primer" id="obSyncAll" type="button">Kirim semua</button>' +
        '<button id="obClose" type="button">Tutup</button></div>' +
        '<div id="outboxList"></div></div>';
      modal.addEventListener("click", function (e) {
        if (e.target === modal) Outbox.tutupPanel();
      });
      document.body.appendChild(modal);
      document.getElementById("obClose").addEventListener("click", function () {
        Outbox.tutupPanel();
      });
      document
        .getElementById("obSyncAll")
        .addEventListener("click", function () {
          Outbox.processQueue({ manual: true });
        });
    }
    if (!pill) {
      pill = document.createElement("div");
      pill.id = "offlinePill";
      pill.innerHTML =
        '<i class="fa-solid fa-cloud"></i><span>Offline — menampilkan data terakhir</span>';
      document.body.appendChild(pill);
      Outbox.tampilkanPill();
    }
  }

  // Pill "offline" global — muncul di semua halaman saat tanpa koneksi.
  Outbox.tampilkanPill = function () {
    if (pill) pill.style.display = Outbox.offline() ? "inline-flex" : "none";
  };

  Outbox.bukaPanel = async function () {
    pastikanUI();
    modal.classList.add("open");
    await Outbox.renderPanel();
  };
  Outbox.tutupPanel = function () {
    if (modal) modal.classList.remove("open");
  };

  Outbox.renderPanel = async function () {
    pastikanUI();
    var list = document.getElementById("outboxList");
    if (!list) return;
    var ops = await Outbox.daftar();
    if (!ops.length) {
      list.innerHTML =
        '<div class="ob-empty"><div style="font-size:2rem">☁️</div>' +
        "Tidak ada antrean. Upload saat offline akan muncul di sini " +
        "dan terkirim otomatis saat online.</div>";
      return;
    }
    list.innerHTML = ops
      .map(function (o) {
        var chip =
          o.status === "failed"
            ? '<span class="ob-chip failed">gagal</span>'
            : o.status === "sending"
              ? '<span class="ob-chip sending">mengirim…</span>'
              : '<span class="ob-chip pending">menunggu</span>';
        var err = o.lastError
          ? '<div class="e">' + esc(o.lastError) + "</div>"
          : "";
        var files =
          o.files && o.files.length
            ? " · " + o.files.length + " file"
            : "";
        return (
          '<div class="ob-item" data-ob="' + esc(o.id) + '">' +
          '<div class="t">' + esc(o.label) + chip + "</div>" +
          '<div class="m">' + esc(labelModul(o.modul)) +
          (o.op === "update" ? " · ubah" : "") + " · " +
          esc(fmtWaktu(o.createdAt)) + esc(files) + "</div>" +
          err +
          '<div class="ob-row">' +
          '<button type="button" class="kirim" data-ob-kirim="' + esc(o.id) + '">Kirim</button>' +
          '<button type="button" data-ob-hapus="' + esc(o.id) + '">Hapus</button>' +
          "</div></div>"
        );
      })
      .join("");
    list.querySelectorAll("[data-ob-kirim]").forEach(function (b) {
      b.addEventListener("click", function () {
        Outbox.kirimUlang(b.getAttribute("data-ob-kirim")).then(function () {
          Outbox.renderPanel();
        });
      });
    });
    list.querySelectorAll("[data-ob-hapus]").forEach(function (b) {
      b.addEventListener("click", async function () {
        await Outbox.hapus(b.getAttribute("data-ob-hapus"));
        Outbox.renderPanel();
      });
    });
  };

  function renderFab(n) {
    pastikanUI();
    if (n > 0) {
      fab.style.display = "inline-flex";
      var c = fab.querySelector(".cnt");
      if (c) c.textContent = n > 99 ? "99+" : String(n);
    } else {
      fab.style.display = "none";
      Outbox.tutupPanel();
    }
    if (modal && modal.classList.contains("open")) Outbox.renderPanel();
  }
  Outbox.onChange(renderFab);

  // =====================================================================
  // INIT — badge, auto-sync (online event + interval + pesan SW).
  // =====================================================================
  function init() {
    pastikanUI();
    Outbox._emit();
    Outbox.tampilkanPill();
    window.addEventListener("online", function () {
      Outbox.tampilkanPill();
      toast("Online lagi — mengirim antrean…", "info");
      Outbox.processQueue({ silent: true });
    });
    window.addEventListener("offline", function () {
      Outbox.tampilkanPill();
    });
    try {
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden && !Outbox.offline())
          Outbox.processQueue({ silent: true });
      });
    } catch {}
    try {
      setInterval(function () {
        if (!Outbox.offline())
          Outbox.hitung().then(function (n) {
            if (n > 0) Outbox.processQueue({ silent: true });
          });
      }, 60000);
    } catch {}
    // pesan dari SW (Background Sync)
    try {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.addEventListener("message", function (e) {
          if (e && e.data === "OUTBOX_SYNC")
            Outbox.processQueue({ silent: true });
        });
      }
    } catch {}
    // kirim yang tertunda begitu halaman dibuka dalam keadaan online
    setTimeout(function () {
      if (!Outbox.offline())
        Outbox.hitung().then(function (n) {
          if (n > 0) Outbox.processQueue({ silent: true });
        });
    }, 3000);
    Outbox.cobaDaftarkanSync();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
