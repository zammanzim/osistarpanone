// =========================================================================
// PENGATURAN — preferensi pengguna per-perangkat (view #/pengaturan).
// Semua preferensi disimpan di localStorage (tidak ada kolom prefs di DB —
// dicek: osis_users/biasa_users tidak punya kolom pengaturan, dan pref
// kompresi/notif/cache memang sifatnya per-perangkat). Dibuka tanpa
// menimpa nilai pengguna: render SELALU baca getter, tidak pernah tulis
// default saat halaman dibuka.
//
// Kategori -> sumber perilaku (semua sudah ada, tinggal di-wiring):
//   Akun      -> OsisAuth (profil lengkap tetap di osis/profil.html)
//   Tampilan  -> Feed.suaraMau/suaraSet + hint swipe (home.js)
//   Media     -> TarpanCompress (engine/resolusi/target)
//   Notifikasi-> PushNotif (status/aktifkan/matikan)
//   Performa  -> Feed.putarOtomatis/putarSet (gate autoplay)
//   Penyimpanan-> Cache (osis_cache_*) + Outbox.hitung/processQueue
//   Privasi   -> OsisAuth.confirmLogout + wipe data lokal
//   Tentang   -> SW status/versi + PwaInstall + storage.estimate
// UI: komponen yang sudah ada (.field/.admin-input/.btn/.hak-chip/
// .edit-toggle-wrap/.pesan-empty/.loading-block) + inline style ala codebase.
// =========================================================================

const Pengaturan = {
    token: 0,
    _butuhUlang: false, // modul lambat (push/outbox) belum termuat saat render

    esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    },

    toast(msg, tipe) {
        try {
            if (typeof showToast === "function") showToast(msg, tipe || "success");
        } catch (e) {}
    },

    async tanya(msg) {
        try {
            if (typeof showPopup === "function") return !!(await showPopup(msg, "confirm"));
        } catch (e) {}
        try {
            return window.confirm(msg);
        } catch (e2) {
            return false;
        }
    },

    // ---- blok bangunan (kelas yang sudah ada) -------------------------------
    judul(ikon, teks) {
        return `<h3 class="social-title"><i class="fa-solid ${ikon}"></i> ${teks}</h3>`;
    },

    baris(judul, desc, kontrol) {
        return `<div style="display:flex;align-items:center;gap:12px;padding:10px 2px;border-top:1px dashed var(--line, #e5ddd6);">` +
            `<div style="flex:1;min-width:0"><b style="font-size:.92rem;">${judul}</b>` +
            (desc ? `<div style="font-size:.78rem;color:var(--gray, #6f6668);margin-top:2px;">${desc}</div>` : "") +
            `</div><div style="flex-shrink:0;">${kontrol}</div></div>`;
    },

    toggle(id, nyala, label) {
        return `<label class="edit-toggle-wrap" title="${this.esc(label || "")}">` +
            `<input type="checkbox" id="${id}"${nyala ? " checked" : ""} autocomplete="off" />` +
            `<span class="edit-slider"></span></label>`;
    },

    opsiSelect(id, opsi, nilai) {
        return `<select id="${id}" class="admin-input" style="max-width:190px;">` +
            opsi.map(function (o) {
                return `<option value="${Pengaturan.esc(o[0])}"${String(o[0]) === String(nilai) ? " selected" : ""}>${Pengaturan.esc(o[1])}</option>`;
            }).join("") + `</select>`;
    },

    // ---- INIT -----------------------------------------------------------------
    init() {
        Pengaturan.render();
    },

    async refresh() {
        // Dipanggil tiap view dibuka (lihat hashchange di bawah) biar status
        // live (notif/cache/antrean) tidak basi.
        try {
            Pengaturan.render();
        } catch (e) {}
    },

    render() {
        const box = document.getElementById("setelanBody");
        if (!box) return;
        const tk = ++Pengaturan.token;
        Pengaturan._butuhUlang = false;
        box.innerHTML =
            Pengaturan.sekAkun() +
            Pengaturan.sekTampilan() +
            Pengaturan.sekMedia() +
            Pengaturan.sekNotif("memuat") +
            Pengaturan.sekPerforma() +
            Pengaturan.sekSimpan("memuat") +
            Pengaturan.sekPrivasi() +
            Pengaturan.sekTentang("memuat");
        Pengaturan.ikat();
        // Isi async (status live) dengan guard token biar tidak balapan.
        Pengaturan.isiNotif(tk);
        Pengaturan.isiSimpan(tk);
        Pengaturan.isiTentang(tk);
        // Modul lambat (push.js/outbox.js dimuat async oleh pwa.js): coba
        // sekali lagi 2,5 dtk kemudian, hanya kalau tadi memang kurang.
        try {
            if (Pengaturan._butuhUlang) {
                Pengaturan._butuhUlang = false;
                setTimeout(function () {
                    try {
                        if (typeof Router !== "undefined" && Router.current === "pengaturan") Pengaturan.render();
                    } catch (e) {}
                }, 2500);
            }
        } catch (e) {}
    },

    ikat() {
        const on = function (id, ev, fn) {
            const el = document.getElementById(id);
            if (el && !el.dataset.setIkat) {
                el.dataset.setIkat = "1";
                el.addEventListener(ev, fn);
            }
        };
        // Tampilan
        on("setSuara", "change", function (e) {
            try {
                if (typeof Feed !== "undefined" && Feed.suaraSet) Feed.suaraSet(e.target.checked);
                Pengaturan.toast(e.target.checked ? "Video feed bersuara secara default." : "Video feed dimulai bisu.");
            } catch (err) {
                Pengaturan.toast("Gagal simpan: " + err.message, "error");
            }
        });
        on("setResetHint", "click", function () {
            try { localStorage.removeItem("fotoSwipeHintOff"); } catch (e) {}
            try { localStorage.removeItem("angkatanSwipeHintOff"); } catch (e) {}
            Pengaturan.toast("Hint akan tampil lagi.");
        });
        // Media
        on("setEngine", "change", function (e) {
            try {
                if (typeof TarpanCompress === "undefined") throw new Error("Modul kompresi belum termuat.");
                TarpanCompress.setPref(e.target.value);
                Pengaturan.toast("Metode kompresi disimpan: " + Pengaturan.namaEngine(TarpanCompress.getEngine()) + ".");
                Pengaturan.renderMediaInfo();
            } catch (err) {
                Pengaturan.toast("Gagal simpan: " + err.message, "error");
            }
        });
        on("setRes", "change", function (e) {
            try {
                if (typeof TarpanCompress === "undefined") throw new Error("Modul kompresi belum termuat.");
                TarpanCompress.setMaxDim(e.target.value);
                Pengaturan.toast("Target resolusi disimpan.");
            } catch (err) {
                Pengaturan.toast("Gagal simpan: " + err.message, "error");
            }
        });
        on("setTarget", "change", function (e) {
            try {
                if (typeof TarpanCompress === "undefined") throw new Error("Modul kompresi belum termuat.");
                TarpanCompress.setTargetMB(e.target.value);
                Pengaturan.toast("Target ukuran disimpan.");
            } catch (err) {
                Pengaturan.toast("Gagal simpan: " + err.message, "error");
            }
        });
        // Performa
        on("setAutoplay", "change", function (e) {
            try {
                if (typeof Feed !== "undefined" && Feed.putarSet) Feed.putarSet(e.target.checked);
                if (!e.target.checked && typeof Feed !== "undefined" && Feed.jedaSemua) {
                    try { Feed.jedaSemua(); } catch (err2) {}
                }
                Pengaturan.toast(e.target.checked ? "Video feed putar otomatis." : "Mode hemat data: video tidak putar sendiri.");
            } catch (err) {
                Pengaturan.toast("Gagal simpan: " + err.message, "error");
            }
        });
        // Penyimpanan
        on("setHapusCache", "click", function () { Pengaturan.hapusCache(); });
        on("setKirimAntre", "click", function () { Pengaturan.kirimAntre(); });
        // Privasi
        on("setKeluar", "click", function () {
            try {
                if (typeof OsisAuth !== "undefined" && OsisAuth.confirmLogout) OsisAuth.confirmLogout();
            } catch (e) {}
        });
        on("setWipe", "click", function () { Pengaturan.wipeData(); });
        // Tentang
        on("setInstall", "click", function () {
            try {
                if (typeof PwaInstall !== "undefined" && PwaInstall.pasang) PwaInstall.pasang();
            } catch (e) {}
        });
        // Akun
        on("setKeluar2", "click", function () {
            try {
                if (typeof OsisAuth !== "undefined" && OsisAuth.confirmLogout) OsisAuth.confirmLogout();
            } catch (e) {}
        });
    },

    // ---- 1. AKUN ---------------------------------------------------------------
    sekAkun() {
        let u = null;
        try {
            u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser) ? OsisAuth.getUser() : null;
        } catch (e) {}
        let isi = "";
        if (u && u.mode === "osis") {
            const nama = Pengaturan.esc(u.nama || u.username || "OSIS");
            isi =
                `<div style="display:flex;align-items:center;gap:12px;">` +
                `<div style="flex:1;min-width:0"><b style="font-size:1rem;">${nama}</b>` +
                `<div style="font-size:.78rem;color:var(--gray, #6f6668);">@${Pengaturan.esc(u.username || "-")} · ${Pengaturan.esc(u.jabatan || "Anggota OSIS")}</div></div>` +
                `<span class="hak-chip super"><i class="fa-solid fa-id-card"></i> OSIS</span></div>` +
                `<div class="form-actions-row" style="margin-top:10px;">` +
                `<a class="btn btn-white btn-sm" href="osis/profil"><i class="fa-solid fa-user-pen"></i> Kelola Profil</a>` +
                `<button type="button" class="btn btn-white btn-sm" id="setKeluar2"><i class="fa-solid fa-arrow-right-from-bracket"></i> Keluar</button></div>` +
                `<div style="font-size:.75rem;color:var(--gray, #6f6668);margin-top:8px;">Nama, username, password & foto profil diubah di halaman Profil.</div>`;
        } else if (u && u.mode === "biasa") {
            const nama = Pengaturan.esc(u.nama || u.username || "Akun");
            isi =
                `<div style="display:flex;align-items:center;gap:12px;">` +
                `<div style="flex:1;min-width:0"><b style="font-size:1rem;">${nama}</b>` +
                `<div style="font-size:.78rem;color:var(--gray, #6f6668);">@${Pengaturan.esc(u.username || "-")}</div></div>` +
                `<span class="hak-chip"><i class="fa-solid fa-user"></i> Akun Biasa</span></div>` +
                `<div class="form-actions-row" style="margin-top:10px;">` +
                `<button type="button" class="btn btn-white btn-sm" id="setKeluar2"><i class="fa-solid fa-arrow-right-from-bracket"></i> Keluar</button></div>`;
        } else {
            isi =
                `<div class="pesan-empty"><i class="fa-solid fa-user"></i> Belum masuk — preferensi tetap tersimpan di HP ini.</div>` +
                `<div class="form-actions-row" style="margin-top:10px;">` +
                `<a class="btn btn-red btn-sm" href="login"><i class="fa-solid fa-right-to-bracket"></i> Masuk</a></div>`;
        }
        return Pengaturan.judul("fa-circle-user", "Akun & Profil") + isi;
    },

    // ---- 2. TAMPILAN ------------------------------------------------------------
    sekTampilan() {
        let suara = false;
        try {
            suara = (typeof Feed !== "undefined" && Feed.suaraMau) ? !!Feed.suaraMau() : (localStorage.getItem("feed_suara") === "1");
        } catch (e) {}
        return Pengaturan.judul("fa-palette", "Tampilan & Personalisasi") +
            Pengaturan.baris(
                "Suara video feed",
                "Video berikutnya ikut bersuara (kalau browser mengizinkan).",
                Pengaturan.toggle("setSuara", suara, "Suara video"),
            ) +
            Pengaturan.baris(
                "Hint geser foto",
                "Tampilkan lagi petunjuk geser di galeri & angkatan.",
                `<button type="button" class="btn btn-white btn-sm" id="setResetHint"><i class="fa-solid fa-rotate-left"></i> Tampilkan ulang</button>`,
            );
    },

    // ---- 3. MEDIA & KOMPRESI ------------------------------------------------------
    namaEngine(e) {
        if (e === "ffmpeg") return "Penuh (FFmpeg)";
        if (e === "native") return "Ringan (Native)";
        if (e === "off") return "Mati";
        return "Otomatis";
    },

    sekMedia() {
        let engine = "auto", res = 1280, tgt = 15, ada = false;
        try {
            if (typeof TarpanCompress !== "undefined") {
                ada = true;
                engine = TarpanCompress.getPref();
                res = TarpanCompress.getMaxDim();
                tgt = TarpanCompress.getTargetMB();
            }
        } catch (e) {}
        if (!ada) {
            Pengaturan._butuhUlang = true;
            return Pengaturan.judul("fa-photo-film", "Media & Kompresi Video") +
                `<div class="pesan-empty"><i class="fa-solid fa-triangle-exclamation"></i> Modul kompresi belum termuat.</div>`;
        }
        return Pengaturan.judul("fa-photo-film", "Media & Kompresi Video") +
            Pengaturan.baris(
                "Metode kompresi",
                `<span id="setMediaInfo">Aktif: ${Pengaturan.esc(Pengaturan.namaEngine(TarpanCompress.getEngine()))}.</span> FFmpeg diunduh (±30MB) hanya kalau dipilih.`,
                Pengaturan.opsiSelect("setEngine", [
                    ["auto", "Otomatis (disarankan)"],
                    ["native", "Ringan — tanpa unduh"],
                    ["ffmpeg", "Penuh — kualitas konsisten"],
                    ["off", "Mati — upload asli"],
                ], engine),
            ) +
            Pengaturan.baris(
                "Resolusi video",
                "Sisi panjang hasil kompresi.",
                Pengaturan.opsiSelect("setRes", [
                    ["854", "480p — paling hemat"],
                    ["1280", "720p — seimbang"],
                    ["1920", "1080p — paling tajam"],
                ], String(res)),
            ) +
            Pengaturan.baris(
                "Target ukuran",
                "Batas usaha kompresi. Video asli selalu di atas 100MB? Ditolak saat pilih file.",
                Pengaturan.opsiSelect("setTarget", [
                    ["8", "< 8 MB"], ["10", "< 10 MB"], ["15", "< 15 MB"], ["20", "< 20 MB"], ["30", "< 30 MB"],
                ], String(tgt)),
            ) +
            `<div style="font-size:.75rem;color:var(--gray, #6f6668);margin-top:6px;">Kompresi gagal/tidak didukung = file asli diupload (maks 100MB). Progres tampil di notif kanan atas.</div>`;
    },

    renderMediaInfo() {
        try {
            const el = document.getElementById("setMediaInfo");
            if (el && typeof TarpanCompress !== "undefined") {
                el.textContent = "Aktif: " + Pengaturan.namaEngine(TarpanCompress.getEngine()) + ".";
            }
        } catch (e) {}
    },

    // ---- 4. NOTIFIKASI -------------------------------------------------------------
    sekNotif(mode) {
        let isi = `<div class="loading-block"><div class="spinner"></div>Memeriksa status notifikasi...</div>`;
        if (mode && mode !== "memuat") isi = mode;
        return Pengaturan.judul("fa-bell", "Notifikasi") + `<div id="setNotifBox">${isi}</div>`;
    },

    async isiNotif(tk) {
        const box = document.getElementById("setNotifBox");
        if (!box) return;
        if (typeof PushNotif === "undefined") {
            // push.js dimuat async oleh pwa.js — tandai render ulang.
            Pengaturan._butuhUlang = true;
            box.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat modul notifikasi...</div>`;
            return;
        }
        let html = "";
        try {
            if (typeof PushNotif === "undefined" || !PushNotif.didukung || !PushNotif.didukung()) {
                html = `<div class="pesan-empty"><i class="fa-solid fa-bell-slash"></i> Perangkat ini belum mendukung notifikasi. Di iPhone: install dulu via Bagikan → Tambah ke Layar Utama.</div>`;
            } else {
                const st = await PushNotif.status();
                if (st === "aktif") {
                    html = Pengaturan.baris(
                        "Notifikasi HP aktif",
                        "Info baru masuk walau web tertutup.",
                        `<button type="button" class="btn btn-white btn-sm" id="setNotifBtn" data-aksi="mati"><i class="fa-solid fa-bell-slash"></i> Matikan</button>`,
                    );
                } else if (st === "diblokir") {
                    html = `<div class="pesan-empty"><i class="fa-solid fa-bell-slash"></i> Izin notif diblokir. Aktifkan manual di Pengaturan browser/HP → Situs → Notifikasi.</div>`;
                } else {
                    html = Pengaturan.baris(
                        "Notifikasi HP mati",
                        "Aktifkan biar info penting tidak ketinggalan.",
                        `<button type="button" class="btn btn-red btn-sm" id="setNotifBtn" data-aksi="nyala"><i class="fa-solid fa-bell"></i> Aktifkan</button>`,
                    );
                }
            }
        } catch (e) {
            html = `<div class="pesan-empty">Gagal cek status: ${Pengaturan.esc(e.message)}</div>`;
        }
        if (tk !== Pengaturan.token) return; // basi: user sudah render ulang
        box.innerHTML = html;
        const btn = document.getElementById("setNotifBtn");
        if (btn && !btn.dataset.setIkat) {
            btn.dataset.setIkat = "1";
            btn.addEventListener("click", async function () {
                const aksi = btn.dataset.aksi;
                btn.disabled = true;
                try {
                    if (aksi === "nyala") await PushNotif.aktifkan();
                    else await PushNotif.matikan();
                } catch (e) {
                    Pengaturan.toast("Gagal: " + e.message, "error");
                }
                Pengaturan.isiNotif(Pengaturan.token);
            });
        }
    },

    // ---- 5. PERFORMA & DATA -----------------------------------------------------------
    sekPerforma() {
        let auto = true;
        try {
            auto = (typeof Feed !== "undefined" && Feed.putarOtomatis) ? !!Feed.putarOtomatis() : (localStorage.getItem("feed_autoplay") !== "0");
        } catch (e) {}
        return Pengaturan.judul("fa-gauge-high", "Performa & Data") +
            Pengaturan.baris(
                "Putar video otomatis",
                "Mati = hemat kuota: video feed tidak play sendiri, ketuk untuk memutar.",
                Pengaturan.toggle("setAutoplay", auto, "Putar otomatis"),
            );
    },

    // ---- 6. PENYIMPANAN --------------------------------------------------------------
    sekSimpan(mode) {
        let isi = `<div class="loading-block"><div class="spinner"></div>Menghitung penyimpanan...</div>`;
        if (mode && mode !== "memuat") isi = mode;
        return Pengaturan.judul("fa-database", "Penyimpanan & Cache") + `<div id="setSimpanBox">${isi}</div>`;
    },

    fmtBytes(n) {
        n = Number(n) || 0;
        if (n < 1024) return n + " B";
        if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
        return (n / (1024 * 1024)).toFixed(1) + " MB";
    },

    ukuranCache() {
        // Hanya cache aplikasi (awalan osis_cache_ + changelog_cache).
        // Auth, device id, preferensi, dan draft TIDAK ikut dihitung/dihapus.
        let total = 0, jml = 0;
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i) || "";
                if (k.indexOf("osis_cache_") === 0 || k === "changelog_cache") {
                    jml++;
                    try {
                        total += (localStorage.getItem(k) || "").length * 2;
                    } catch (e) {}
                }
            }
        } catch (e) {}
        return { total: total, jml: jml };
    },

    async isiSimpan(tk) {
        const box = document.getElementById("setSimpanBox");
        if (!box) return;
        const c = Pengaturan.ukuranCache();
        let antre = -1;
        try {
            if (typeof Outbox !== "undefined" && Outbox.hitung) antre = await Outbox.hitung();
            else Pengaturan._butuhUlang = true; // outbox.js dimuat async oleh pwa.js
        } catch (e) {}
        let kuota = "";
        try {
            if (navigator.storage && navigator.storage.estimate) {
                const est = await navigator.storage.estimate();
                if (est && isFinite(est.usage)) kuota = ` · total pakai ${Pengaturan.fmtBytes(est.usage)}`;
            }
        } catch (e) {}
        if (tk !== Pengaturan.token) return;
        box.innerHTML =
            Pengaturan.baris(
                "Cache offline",
                `${c.jml} cache · ${Pengaturan.fmtBytes(c.total)}${Pengaturan.esc(kuota)}. Aman dihapus — dimuat ulang otomatis.`,
                `<button type="button" class="btn btn-white btn-sm" id="setHapusCache"><i class="fa-solid fa-trash"></i> Hapus cache</button>`,
            ) +
            Pengaturan.baris(
                "Antrean offline",
                antre < 0 ? "Status antrean tidak terbaca." : (antre > 0 ? `${antre} menunggu terkirim.` : "Kosong — semua sudah terkirim."),
                antre > 0
                    ? `<button type="button" class="btn btn-red btn-sm" id="setKirimAntre"><i class="fa-solid fa-cloud-arrow-up"></i> Kirim sekarang</button>`
                    : `<span class="hak-chip"><i class="fa-solid fa-check"></i> Bersih</span>`,
            );
        const b1 = document.getElementById("setHapusCache");
        if (b1 && !b1.dataset.setIkat) {
            b1.dataset.setIkat = "1";
            b1.addEventListener("click", function () { Pengaturan.hapusCache(); });
        }
        const b2 = document.getElementById("setKirimAntre");
        if (b2 && !b2.dataset.setIkat) {
            b2.dataset.setIkat = "1";
            b2.addEventListener("click", function () { Pengaturan.kirimAntre(); });
        }
    },

    async hapusCache() {
        if (!(await Pengaturan.tanya("Hapus semua cache offline? Data akun & preferensi tidak ikut terhapus."))) return;
        let jml = 0;
        try {
            const buang = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i) || "";
                if (k.indexOf("osis_cache_") === 0 || k === "changelog_cache") buang.push(k);
            }
            buang.forEach(function (k) {
                try { localStorage.removeItem(k); jml++; } catch (e) {}
            });
        } catch (e) {}
        Pengaturan.toast(jml ? `${jml} cache dihapus.` : "Tidak ada cache.");
        Pengaturan.isiSimpan(Pengaturan.token);
    },

    async kirimAntre() {
        try {
            if (typeof Outbox === "undefined" || !Outbox.processQueue) throw new Error("Modul antrean belum termuat.");
            Pengaturan.toast("Mengirim antrean…", "info");
            await Outbox.processQueue({ manual: true });
        } catch (e) {
            Pengaturan.toast("Gagal kirim: " + e.message, "error");
        }
        Pengaturan.isiSimpan(Pengaturan.token);
    },

    // ---- 7. PRIVASI ------------------------------------------------------------------
    sekPrivasi() {
        let u = null;
        try {
            u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser) ? OsisAuth.getUser() : null;
        } catch (e) {}
        return Pengaturan.judul("fa-shield-halved", "Privasi & Keamanan") +
            Pengaturan.baris(
                "Keluar dari akun",
                u ? `Masuk sebagai ${Pengaturan.esc((typeof OsisAuth !== "undefined" && OsisAuth.displayName) ? OsisAuth.displayName(u) : (u.username || ""))}.` : "Belum masuk.",
                u
                    ? `<button type="button" class="btn btn-white btn-sm" id="setKeluar"><i class="fa-solid fa-arrow-right-from-bracket"></i> Keluar</button>`
                    : `<a class="btn btn-red btn-sm" href="login"><i class="fa-solid fa-right-to-bracket"></i> Masuk</a>`,
            ) +
            Pengaturan.baris(
                "Hapus semua data lokal",
                "Login, preferensi, cache & antrean di HP ini dihapus. Data di server tetap aman.",
                `<button type="button" class="btn btn-white btn-sm" id="setWipe"><i class="fa-solid fa-trash-can"></i> Hapus</button>`,
            );
    },

    async wipeData() {
        if (!(await Pengaturan.tanya("Hapus SEMUA data lokal (akun, preferensi, cache, antrean)?"))) return;
        if (!(await Pengaturan.tanya("Yakin? Kamu harus login ulang sesudahnya."))) return;
        try {
            try { localStorage.clear(); } catch (e) {}
            try {
                if (window.indexedDB && indexedDB.deleteDatabase) indexedDB.deleteDatabase("osis_outbox");
            } catch (e) {}
        } catch (e) {}
        try {
            location.reload();
        } catch (e) {}
    },

    // ---- 8. TENTANG ---------------------------------------------------------------------
    sekTentang(mode) {
        let isi = `<div class="loading-block"><div class="spinner"></div>Memeriksa aplikasi...</div>`;
        if (mode && mode !== "memuat") isi = mode;
        return Pengaturan.judul("fa-circle-info", "Tentang Aplikasi") + `<div id="setTentangBox">${isi}</div>`;
    },

    async isiTentang(tk) {
        const box = document.getElementById("setTentangBox");
        if (!box) return;
        // Versi = tag VERSI di sw.js yang terdeploy (tetap jujur kalau gagal: "-").
        let versi = "-";
        try {
            const r = await fetch("sw.js", { cache: "no-store" });
            if (r && r.ok) {
                const t = await r.text();
                const m = String(t).match(/tarpan-v(\d+)/);
                if (m) versi = "v" + m[1];
            }
        } catch (e) {}
        let sw = "Belum aktif";
        try {
            if (navigator.serviceWorker && navigator.serviceWorker.controller) sw = "Aktif — siap offline";
        } catch (e) {}
        let install = false;
        try {
            install = (typeof PwaInstall !== "undefined" && PwaInstall.tersedia) ? !!PwaInstall.tersedia() : false;
        } catch (e) {}
        if (tk !== Pengaturan.token) return;
        box.innerHTML =
            Pengaturan.baris(
                "OSIS TARPAN ONE",
                `SMK Taruna Harapan 1 Cipatat · versi ${Pengaturan.esc(versi)} · SW: ${Pengaturan.esc(sw)}.`,
                install
                    ? `<button type="button" class="btn btn-red btn-sm" id="setInstall"><i class="fa-solid fa-download"></i> Install App</button>`
                    : `<a class="btn btn-white btn-sm" href="changelog"><i class="fa-solid fa-clock-rotate-left"></i> Changelog</a>`,
            );
        const b = document.getElementById("setInstall");
        if (b && !b.dataset.setIkat) {
            b.dataset.setIkat = "1";
            b.addEventListener("click", function () {
                try {
                    if (typeof PwaInstall !== "undefined" && PwaInstall.pasang) PwaInstall.pasang();
                } catch (e) {}
            });
        }
    },
};

if (typeof Router !== "undefined") {
    Router.register("pengaturan", function () { Pengaturan.init(); });
    // Router hanya init sekali per view — render ulang tiap pindah hash
    // biar status live (notif/cache/antrean) tidak basi.
    window.addEventListener("hashchange", function () {
        try {
            if (typeof Router === "undefined" || !Router.parse) return;
            if (Router.parse() === "pengaturan") Pengaturan.refresh();
        } catch (e) {}
    });
} else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { Pengaturan.init(); });
} else {
    Pengaturan.init();
}
