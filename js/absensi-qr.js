// =========================================================================
// ABSENSI QR — sisi operator (HP absensi, halaman osis/absensi.html).
//
// MODE A (Tampilkan QR): bikin sesi QR -> QR berisi link /absen?s=<token>.
//   Siswa scan + login -> RPC qr_absen_daftar -> baris 'hadir'.
// MODE B (Scan Kartu): scan QR kartu pribadi siswa -> RPC qr_absen_catat.
//
// Semua proses tulis lewat RPC (lihat js/db.js). Token QR DITANDATANGANI
// di server (HMAC), identitas siswa dibaca server dari auth.uid().
// =========================================================================

const AbsensiQr = {
    sesi: null, // {sesi_id, token, kode, tanggal, kegiatan, berakhir_at, aktif, jumlah, hadir}
    tab: "tampil", // tampil | scan
    timer: null, // poll counter hadir
    stream: null, // kamera (MediaStream)
    raf: null, // loop decode
    busy: false, // sedang proses scan
    cooldown: 0, // jeda setelah scan sukses (ms)
    hasilScan: [], // riwayat scan mode B

    init() {
        document.getElementById("btnAbsenQr")?.addEventListener("click", () => AbsensiQr.buka());
        document.getElementById("qrTabTampil")?.addEventListener("click", () => AbsensiQr.setTab("tampil"));
        document.getElementById("qrTabScan")?.addEventListener("click", () => AbsensiQr.setTab("scan"));
        document.getElementById("qrBtnMulai")?.addEventListener("click", () => AbsensiQr.mulaiSesi());
        document.getElementById("qrBtnTutupSesi")?.addEventListener("click", () => AbsensiQr.tutupSesi());
        document.getElementById("qrBtnBaru")?.addEventListener("click", () => AbsensiQr.sesiBaru());
        document.getElementById("qrBtnSalin")?.addEventListener("click", () => AbsensiQr.salinLink());
        document.getElementById("qrBtnKamera")?.addEventListener("click", () => AbsensiQr.kameraMulai());
        document.getElementById("qrBtnKameraStop")?.addEventListener("click", () => AbsensiQr.kameraStop());
        document.getElementById("absenQr")?.addEventListener("click", (e) => {
            if (e.target.id === "absenQr") AbsensiQr.tutup();
        });
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            if (document.getElementById("absenQr")?.classList.contains("open")) AbsensiQr.tutup();
        });
    },

    // ---------- util ----------
    hariIni() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    },

    pesan(status) {
        const m = {
            ERR_NO_AUTH: "Kamu tidak punya akses.",
            ERR_NO_AKSES: "Kamu tidak punya hak akses absensi.",
            ERR_NO_TANGGAL: "Tanggal wajib diisi.",
            ERR_NO_NAMA: "Nama tidak terbaca.",
            ERR_NO_LOGIN: "Belum login.",
            ERR_BUKAN_OSIS: "Absen QR khusus anggota OSIS.",
            ERR_TOKEN: "QR tidak valid atau sudah kadaluwarsa.",
            ERR_KODE: "Kode sesi tidak ditemukan.",
            ERR_SESI: "Sesi QR tidak ditemukan.",
            ERR_SESI_TUTUP: "Sesi QR sudah ditutup.",
            ERR_KEDALUWARSA: "QR sudah kedaluwarsa.",
            ERR_BENTROK: "Sudah tercatat (izin/sakit/alpha).",
            ERR_PAKAI: "QR kartu ini sudah pernah dipakai.",
            ERR_UNKNOWN: "Gagal memproses.",
        };
        return m[String(status)] || String(status || "Gagal memproses.");
    },

    el(id) {
        return document.getElementById(id);
    },

    // ---------- buka / tutup ----------
    async buka() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("absensi")) return;
        AbsensiQr.hasilScan = [];
        const tgl = (Absensi.filter && Absensi.filter.tanggal) || AbsensiQr.hariIni();
        const inp = AbsensiQr.el("qrTanggal");
        if (inp) inp.value = tgl;
        const keg = AbsensiQr.el("qrKegiatan");
        if (keg && !keg.value) keg.value = "";
        AbsensiQr.el("absenQr")?.classList.add("open");
        document.body.style.overflow = "hidden";
        AbsensiQr.renderKosong();
        await AbsensiQr.muatSesi();
    },

    tutup() {
        AbsensiQr.kameraStop();
        AbsensiQr.stopPolling();
        AbsensiQr.el("absenQr")?.classList.remove("open");
        if (!document.getElementById("absensiForm")?.classList.contains("open")) {
            document.body.style.overflow = "";
        }
        // Status global ikut berubah (ada yang baru absen via QR).
        try { Absensi.segarkan(); } catch {}
    },

    setTab(t) {
        AbsensiQr.tab = t === "scan" ? "scan" : "tampil";
        const bt = AbsensiQr.el("qrTabTampil");
        const bs = AbsensiQr.el("qrTabScan");
        if (bt) bt.className = AbsensiQr.tab === "tampil" ? "on" : "";
        if (bs) bs.className = AbsensiQr.tab === "scan" ? "on" : "";
        const pt = AbsensiQr.el("qrPanelTampil");
        const ps = AbsensiQr.el("qrPanelScan");
        if (pt) pt.hidden = AbsensiQr.tab !== "tampil";
        if (ps) ps.hidden = AbsensiQr.tab !== "scan";
        if (AbsensiQr.tab !== "scan") AbsensiQr.kameraStop();
    },

    // ---------- muat sesi milik operator ----------
    async muatSesi() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u) return;
        try {
            const r = await qrAbsenSesiAmbil(u.id);
            if (r.status !== "OK") {
                showToast(AbsensiQr.pesan(r.status), "error");
                return;
            }
            const tgl = (AbsensiQr.el("qrTanggal")?.value || "").trim();
            const list = Array.isArray(r.sesi) ? r.sesi : [];
            // Prioritas: sesi aktif utk tanggal yang dipilih, else sesi aktif terakhir.
            let chosen = list.find((s) => s.aktif && !AbsensiQr.lewatWaktu(s.berakhir_at) && (!tgl || String(s.tanggal) === tgl));
            if (!chosen) chosen = list.find((s) => s.aktif && !AbsensiQr.lewatWaktu(s.berakhir_at));
            if (!chosen) chosen = list[0] || null;
            AbsensiQr.sesi = chosen;
            AbsensiQr.render();
            if (chosen && chosen.aktif && !AbsensiQr.lewatWaktu(chosen.berakhir_at)) AbsensiQr.startPolling();
        } catch (err) {
            console.error(err);
            showToast("Gagal muat sesi QR: " + (err.message || "cek koneksi"), "error");
        }
    },

    lewatWaktu(t) {
        if (!t) return false;
        const ms = new Date(t).getTime();
        if (!Number.isFinite(ms)) return false;
        return ms < Date.now();
    },

    // ---------- bikin sesi baru ----------
    async mulaiSesi() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u) return;
        const tanggal = (AbsensiQr.el("qrTanggal")?.value || "").trim();
        if (!tanggal) {
            showToast("Tanggal wajib diisi.", "error");
            return;
        }
        const kegiatan = (AbsensiQr.el("qrKegiatan")?.value || "").trim().slice(0, 120);
        const menit = Math.max(5, Math.min(720, parseInt(AbsensiQr.el("qrMenit")?.value || "120", 10) || 120));
        const btn = AbsensiQr.el("qrBtnMulai");
        const html = btn ? btn.innerHTML : "";
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyiapkan...';
        }
        try {
            const r = await qrAbsenSesiBuat(u.id, tanggal, kegiatan, menit);
            if (r.status !== "OK") {
                showToast(AbsensiQr.pesan(r.status), "error");
                return;
            }
            AbsensiQr.sesi = {
                sesi_id: r.sesi_id,
                token: r.token,
                kode: r.kode,
                tanggal: r.tanggal,
                kegiatan: r.kegiatan,
                berakhir_at: r.berakhir_at,
                aktif: true,
                jumlah: 0,
                hadir: [],
            };
            AbsensiQr.render();
            AbsensiQr.startPolling();
            showToast("Sesi QR siap. TinggalQR-nya ke siswa.", "success");
            try { catatAksi("mulai_sesi_qr", tanggal + " (" + kegiatan + ")"); } catch {}
        } catch (err) {
            console.error(err);
            showToast("Gagal bikin sesi: " + (err.message || "cek koneksi"), "error");
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = html || '<i class="fa-solid fa-play"></i> Mulai Sesi QR';
            }
        }
    },

    async tutupSesi() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || !AbsensiQr.sesi) return;
        const yakin = await showPopup(
            "Tutup sesi QR ini? QR-nya langsung tidak berlaku, siswa yang belum scan akan ditolak.",
            "confirm",
        );
        if (!yakin) return;
        try {
            const r = await qrAbsenSesiTutup(u.id, AbsensiQr.sesi.sesi_id);
            if (r.status !== "OK") {
                showToast(AbsensiQr.pesan(r.status), "error");
                return;
            }
            showToast("Sesi QR ditutup.", "success");
            AbsensiQr.stopPolling();
            await AbsensiQr.muatSesi();
        } catch (err) {
            console.error(err);
            showToast("Gagal tutup sesi: " + (err.message || "cek koneksi"), "error");
        }
    },

    // ---------- render ----------
    renderKosong() {
        const form = AbsensiQr.el("qrFormSesi");
        const info = AbsensiQr.el("qrInfo");
        if (form) form.hidden = false;
        if (info) info.hidden = true;
    },

    // Buang sesi aktif di layar (bikin sesi baru tanggal/kegiatan lain).
    sesiBaru() {
        AbsensiQr.stopPolling();
        AbsensiQr.sesi = null;
        AbsensiQr.renderKosong();
    },

    render() {
        const s = AbsensiQr.sesi;
        const form = AbsensiQr.el("qrFormSesi");
        const info = AbsensiQr.el("qrInfo");
        if (!s) {
            if (form) form.hidden = false;
            if (info) info.hidden = true;
            return;
        }
        if (form) form.hidden = true;
        if (info) info.hidden = false;

        const kodeEl = AbsensiQr.el("qrKode");
        if (kodeEl) kodeEl.textContent = s.kode || "-";
        const meta = AbsensiQr.el("qrMeta");
        if (meta) {
            const tgl = AbsensiQr.fmtTanggal(s.tanggal);
            const keg = String(s.kegiatan || "").trim() || "(tanpa kegiatan)";
            const sisa = s.aktif && !AbsensiQr.lewatWaktu(s.berakhir_at)
                ? "berlaku sampai " + AbsensiQr.fmtWaktu(s.berakhir_at)
                : "<b style='color:var(--red-dark)'>sesi sudah ditutup / kedaluwarsa</b>";
            meta.innerHTML =
                `<span><i class="fa-solid fa-calendar"></i> ${escapeHtml(tgl)}</span>` +
                `<span><i class="fa-solid fa-bullhorn"></i> ${escapeHtml(keg)}</span>` +
                `<span><i class="fa-solid fa-clock"></i> ${sisa}</span>`;
        }
        const cnt = AbsensiQr.el("qrCount");
        if (cnt) {
            const j = Number(s.jumlah || 0);
            cnt.innerHTML = `<b>${j}</b> orang sudah absen`;
        }
        // QR (hanya rebuild kalau sesinya berubah — biar gak flicker tiap poll)
        const box = AbsensiQr.el("qrCode");
        if (box) {
            const sesiId = String(s.sesi_id || "");
            if (AbsensiQr._qrSesiId !== sesiId) {
                AbsensiQr._qrSesiId = sesiId;
                box.innerHTML = "";
                const url = AbsensiQr.linkSesi(s);
                try {
                    if (typeof QRCode === "undefined") {
                        box.innerHTML = '<div class="qr-kotak-kosong">Library QR belum termuat.</div>';
                    } else {
                        /* eslint-disable no-new */
                        new QRCode(box, {
                            text: url,
                            width: 240,
                            height: 240,
                            colorDark: "#1a1416",
                            colorLight: "#ffffff",
                            correctLevel: QRCode.CorrectLevel.M,
                        });
                    }
                } catch (e) {
                    console.error(e);
                    box.innerHTML = '<div class="qr-kotak-kosong">Gagal bikin QR.</div>';
                }
            }
        }
        const btnTutup = AbsensiQr.el("qrBtnTutupSesi");
        if (btnTutup) btnTutup.style.display = s.aktif ? "" : "none";
        // daftar hadir
        const list = AbsensiQr.el("qrDaftar");
        if (list) {
            const rows = Array.isArray(s.hadir) ? s.hadir : [];
            list.innerHTML = rows.length
                ? rows
                      .map(
                          (r) =>
                              `<div class="qr-item"><span class="dot"><i class="fa-solid fa-check"></i></span>` +
                              `<span class="nm">${escapeHtml(r.nama || "-")}</span>` +
                              `<small>${escapeHtml(AbsensiQr.fmtWaktu(r.jam))}</small></div>`,
                      )
                      .join("")
                : '<div class="pesan-empty">Belum ada yang absen.</div>';
        }
        AbsensiQr.renderScan();
    },

    renderScan() {
        const box = AbsensiQr.el("qrScanDaftar");
        if (!box) return;
        box.innerHTML = AbsensiQr.hasilScan.length
            ? AbsensiQr.hasilScan
                  .map(
                      (h) =>
                          `<div class="qr-item ${h.ok ? "" : "gagal"}">` +
                          `<span class="dot"><i class="fa-solid ${h.ok ? "fa-check" : "fa-xmark"}"></i></span>` +
                          `<span class="nm">${escapeHtml(h.nama || h.pesan)}</span>` +
                          `<small>${escapeHtml(h.ket || "")}</small></div>`,
                  )
                  .join("")
            : '<div class="pesan-empty">Belum ada kartu yang discan.</div>';
    },

    fmtTanggal(t) {
        if (!t) return "-";
        const d = new Date(t + "T00:00:00");
        if (isNaN(d)) return String(t);
        const s = d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
        return s.charAt(0).toUpperCase() + s.slice(1);
    },

    fmtWaktu(t) {
        if (!t) return "";
        const d = new Date(t);
        if (isNaN(d)) return "";
        return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
    },

    linkSesi(s) {
        const base = (location.origin || "") + "/absen?s=" + encodeURIComponent(s.token || "");
        return base;
    },

    async salinLink() {
        const s = AbsensiQr.sesi;
        if (!s) return;
        const link = AbsensiQr.linkSesi(s);
        try {
            await navigator.clipboard.writeText(link);
            showToast("Link absen disalin.", "success");
        } catch {
            showToast(link, "info");
        }
    },

    // ---------- poll counter hadir ----------
    startPolling() {
        AbsensiQr.stopPolling();
        AbsensiQr.timer = setInterval(() => AbsensiQr.poll(), 6000);
        AbsensiQr.poll();
    },

    stopPolling() {
        if (AbsensiQr.timer) {
            clearInterval(AbsensiQr.timer);
            AbsensiQr.timer = null;
        }
    },

    async poll() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || !AbsensiQr.sesi) return;
        try {
            const r = await qrAbsenSesiAmbil(u.id);
            if (r.status !== "OK") return;
            const list = Array.isArray(r.sesi) ? r.sesi : [];
            const s = list.find((x) => Number(x.sesi_id) === Number(AbsensiQr.sesi.sesi_id));
            if (!s) return;
            const berubah =
                Number(s.jumlah || 0) !== Number(AbsensiQr.sesi.jumlah || 0) ||
                JSON.stringify(s.hadir || []) !== JSON.stringify(AbsensiQr.sesi.hadir || []);
            AbsensiQr.sesi = { ...AbsensiQr.sesi, ...s };
            if (berubah) {
                AbsensiQr.render();
                // Status global (tab Hadir) ikut sinkron
                try { Absensi.segarkan(); } catch {}
            }
        } catch {
            /* diam-diem: polling dibiarin jalan */
        }
    },

    // ---------- mode B: scan kartu siswa ----------
    async kameraMulai() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u) return;
        // Butuh sesi aktif dulu (tanggal + kegiatan buat baris hadir).
        const sesi = await AbsensiQr.pastikanSesi();
        if (!sesi) return;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            showToast("Browser ini gak bisa akses kamera. Pakai HTTPS atau Chrome/Android.", "error");
            return;
        }
        const video = AbsensiQr.el("qrVideo");
        if (!video) return;
        try {
            AbsensiQr.stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false,
            });
        } catch (e) {
            console.error(e);
            showToast("Kamera gak bisa dinyalakan: " + (e.message || "izin kamera ditolak"), "error");
            return;
        }
        video.srcObject = AbsensiQr.stream;
        try { await video.play(); } catch {}
        const kosong = AbsensiQr.el("qrVideoKosong");
        if (kosong) kosong.style.display = "none";
        const btn = AbsensiQr.el("qrBtnKamera");
        if (btn) btn.style.display = "none";
        const stop = AbsensiQr.el("qrBtnKameraStop");
        if (stop) stop.style.display = "";
        const info = AbsensiQr.el("qrScanInfo");
        if (info) info.innerHTML = "Kamera aktif. Arahkan ke <b>kartu QR siswa</b> (bukan QR sesi).";
        AbsensiQr.loop();
    },

    kameraStop() {
        if (AbsensiQr.raf) {
            cancelAnimationFrame(AbsensiQr.raf);
            AbsensiQr.raf = null;
        }
        if (AbsensiQr.stream) {
            try { AbsensiQr.stream.getTracks().forEach((t) => t.stop()); } catch {}
            AbsensiQr.stream = null;
        }
        const video = AbsensiQr.el("qrVideo");
        if (video) {
            try { video.srcObject = null; } catch {}
        }
        const kosong = AbsensiQr.el("qrVideoKosong");
        if (kosong) kosong.style.display = "";
        const btn = AbsensiQr.el("qrBtnKamera");
        if (btn) btn.style.display = "";
        const stop = AbsensiQr.el("qrBtnKameraStop");
        if (stop) stop.style.display = "none";
    },

    loop() {
        const video = AbsensiQr.el("qrVideo");
        if (!video || !AbsensiQr.stream) return;
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const tick = () => {
            AbsensiQr.raf = requestAnimationFrame(tick);
            if (!video.videoWidth) return;
            const maxW = 520;
            const scale = Math.min(1, maxW / video.videoWidth);
            const w = Math.round(video.videoWidth * scale);
            const h = Math.round(video.videoHeight * scale);
            canvas.width = w;
            canvas.height = h;
            try {
                ctx.drawImage(video, 0, 0, w, h);
                const img = ctx.getImageData(0, 0, w, h);
                let kode = null;
                if (typeof jsQR === "function") {
                    const res = jsQR(img.data, w, h, { inversionAttempts: "attemptBoth" });
                    if (res && res.data) kode = res.data;
                }
                if (kode) AbsensiQr.tanganiKode(kode);
            } catch {
                /* abaikan frame yg gagal */
            }
        };
        tick();
    },

    // QR kartu siswa format: K|id|user|exp.signature
    async tanganiKode(teks) {
        const now = Date.now();
        if (AbsensiQr.busy || now < AbsensiQr.cooldown) return;
        const kode = String(teks || "").trim();
        if (!kode) return;
        // Jeda 1,5 detik tiap kode yang kebaca (biar QR yg sama ga spam).
        AbsensiQr.cooldown = Date.now() + 1500;
        let token = "";
        if (kode.startsWith("K|")) {
            token = kode;
        } else if (kode.includes("?s=")) {
            showToast("Itu QR sesi, bukan kartu siswa. Siswa yang scan QR sesi dari HP mereka.", "info");
            return;
        } else {
            showToast("QR gak dikenali. Pastikan kartu QR siswa yang dipindai.", "error");
            return;
        }
        AbsensiQr.busy = true;
        const u = OsisAuth.getUser && OsisAuth.getUser();
        try {
            const sesi = await AbsensiQr.pastikanSesi();
            if (!sesi) return;
            const r = await qrAbsenCatat(u.id, sesi.sesi_id, token);
            if (r.status === "OK" || r.status === "OK_SAMA") {
                AbsensiQr.hasilScan.unshift({
                    ok: true,
                    nama: r.nama || "-",
                    ket: r.status === "OK_SAMA" ? "sudah absen" : "hadir",
                });
                showToast(
                    (r.status === "OK_SAMA" ? "Sudah absen: " : "Absen: ") + (r.nama || "-"),
                    r.status === "OK_SAMA" ? "info" : "success",
                );
                try { navigator.vibrate?.(60); } catch {}
                try { catatAksi("absen_qr_scan", String(r.nama || "")); } catch {}
            } else {
                AbsensiQr.hasilScan.unshift({ ok: false, nama: r.nama || "-", ket: AbsensiQr.pesan(r.status) });
                showToast(AbsensiQr.pesan(r.status), "error");
                try { navigator.vibrate?.([40, 60, 40]); } catch {}
            }
            AbsensiQr.cooldown = Date.now() + 1500;
            AbsensiQr.renderScan();
            await AbsensiQr.poll();
        } catch (err) {
            console.error(err);
            showToast("Gagal catat: " + (err.message || "cek koneksi"), "error");
            AbsensiQr.cooldown = Date.now() + 1500;
        } finally {
            AbsensiQr.busy = false;
        }
    },

    // Pastiin ada sesi aktif (buat mode B). Auto-bikin kalo belum ada.
    async pastikanSesi() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u) return null;
        const s = AbsensiQr.sesi;
        if (s && s.aktif && !AbsensiQr.lewatWaktu(s.berakhir_at)) return s;
        const tanggal = (AbsensiQr.el("qrTanggal")?.value || "").trim() || AbsensiQr.hariIni();
        const kegiatan = (AbsensiQr.el("qrKegiatan")?.value || "").trim() || "Absen QR";
        try {
            const r = await qrAbsenSesiBuat(u.id, tanggal, kegiatan, 120);
            if (r.status !== "OK") {
                showToast(AbsensiQr.pesan(r.status), "error");
                return null;
            }
            AbsensiQr.sesi = {
                sesi_id: r.sesi_id,
                token: r.token,
                kode: r.kode,
                tanggal: r.tanggal,
                kegiatan: r.kegiatan,
                berakhir_at: r.berakhir_at,
                aktif: true,
                jumlah: 0,
                hadir: [],
            };
            AbsensiQr.render();
            return AbsensiQr.sesi;
        } catch (err) {
            console.error(err);
            showToast("Gagal bikin sesi: " + (err.message || "cek koneksi"), "error");
            return null;
        }
    },
};

document.addEventListener("DOMContentLoaded", () => AbsensiQr.init());
