// =========================================================================
// ABSEN QR — sisi siswa (halaman /absen).
//
// MODE A: buka /absen?s=<token> (QR sesi dari HP operator).
//   Login akun OSIS -> tombol "Absen Sekarang" -> RPC qr_absen_daftar.
//   Kalau QR susah dibaca: siswa ketik kode manual sesi.
// MODE B: buka /absen tanpa token -> "Kartu Absen Digital".
//   QR personal berlaku singkat + 1x pakai, dipindai operator.
//
// Identitas selalu dibaca server dari auth.uid() (JWT), bukan dari kiriman
// client. Token QR ditandatangani di server (HMAC) - lihat db/migrasi-absensi-qr.sql.
// =========================================================================

const AbsenSiswa = {
    token: "",
    mode: "kartu", // sesi | kartu
    kartu: null, // {token, nama, kelas, berakhir_at, berlaku_detik}
    timer: null,
    sisa: 0,
    sibuk: false,

    init() {
        try {
            const p = new URLSearchParams(location.search || "");
            AbsenSiswa.token = String(p.get("s") || "").trim();
        } catch {
            AbsenSiswa.token = "";
        }
        AbsenSiswa.mode = AbsenSiswa.token ? "sesi" : "kartu";
        AbsenSiswa.patchHeader();
        AbsenSiswa.render();
    },

    // Tombol "Masuk" di header harus balik ke /absen (bukan ke beranda),
    // supaya token sesi gak hilang pas siswa harus login dulu.
    patchHeader() {
        const area = document.getElementById("areaAuth");
        if (!area) return;
        const terpasang = () => {
            const a = area.querySelector('a.btn[href*="login"]');
            if (a) a.setAttribute("onclick", "AbsenSiswa.masuk()");
        };
        terpasang();
        if (window.MutationObserver) {
            const obs = new MutationObserver(() => terpasang());
            obs.observe(area, { childList: true, subtree: true });
        }
    },

    // ---------- util ----------
    card() {
        return document.getElementById("absCard");
    },

    akun() {
        try {
            const u = OsisAuth.getUser && OsisAuth.getUser();
            if (!u) return null;
            if (u.mode !== "osis" && u.mode !== "biasa") return null;
            return u;
        } catch {
            return null;
        }
    },

    namaAkun() {
        const u = AbsenSiswa.akun();
        if (!u) return "";
        return String(u.nama || u.username || "").trim();
    },

    pesan(status) {
        const m = {
            ERR_NO_LOGIN: "Kamu harus login dulu.",
            ERR_BUKAN_OSIS: "Absen QR khusus anggota OSIS.",
            ERR_NO_AKSES: "Kamu tidak punya akses.",
            ERR_NO_AUTH: "Kamu tidak punya akses.",
            ERR_TOKEN: "QR tidak valid atau sudah kadaluwarsa.",
            ERR_KODE: "Kode sesi tidak ditemukan.",
            ERR_SESI: "Sesi QR tidak ditemukan.",
            ERR_SESI_TUTUP: "Sesi QR sudah ditutup.",
            ERR_KEDALUWARSA: "QR sudah kedaluwarsa.",
            ERR_BENTROK: "Kamu udah tercatat izin/sakit. Lapor ke operator ya.",
            ERR_NO_NAMA: "Nama kamu gak kebaca. Hubungi operator.",
            ERR_UNKNOWN: "Gagal memproses. Coba lagi.",
        };
        return m[String(status)] || String(status || "Gagal memproses.");
    },

    inisial(nama) {
        const parts = String(nama || "").trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return "?";
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    },

    // ---------- render ----------
    render() {
        const el = AbsenSiswa.card();
        if (!el) return;
        if (AbsenSiswa.mode === "sesi") AbsenSiswa.renderSesi();
        else AbsenSiswa.renderKartu();
    },

    // MODE A
    renderSesi() {
        const el = AbsenSiswa.card();
        const u = AbsenSiswa.akun();
        if (!u) {
            el.innerHTML =
                `<div class="abs-head"><div class="ico"><i class="fa-solid fa-qrcode"></i></div>` +
                `<div><h1>Absen QR</h1><p>Scan QR sesi dari HP operator</p></div></div>` +
                `<div class="abs-info"><span><i class="fa-solid fa-user-lock"></i> Masuk dulu biar absen bisa dicatat.</span>` +
                `<span><i class="fa-solid fa-circle-info"></i> Wajib pakai akun OSIS.</span></div>` +
                `<button class="btn btn-red" id="btnMasuk" style="width:100%; justify-content:center"><i class="fa-solid fa-right-to-bracket"></i> Masuk</button>`;
            document.getElementById("btnMasuk")?.addEventListener("click", () => AbsenSiswa.masuk());
            return;
        }
        if (u.mode !== "osis") {
            el.innerHTML =
                `<div class="abs-head"><div class="ico"><i class="fa-solid fa-qrcode"></i></div>` +
                `<div><h1>Absen QR</h1><p>Scan QR sesi dari HP operator</p></div></div>` +
                `<div class="abs-info"><span><i class="fa-solid fa-ban"></i> Absen QR khusus anggota OSIS.</span>` +
                `<span><i class="fa-solid fa-circle-info"></i> Kamu masuk sebagai akun biasa. Masuk pakai akun OSIS ya.</span></div>` +
                `<button class="btn btn-white" id="btnMasuk" style="width:100%; justify-content:center"><i class="fa-solid fa-right-to-bracket"></i> Ganti akun</button>`;
            document.getElementById("btnMasuk")?.addEventListener("click", () => AbsenSiswa.masuk());
            return;
        }
        el.innerHTML =
            `<div class="abs-head"><div class="ico"><i class="fa-solid fa-qrcode"></i></div>` +
            `<div><h1>Absen QR</h1><p>Scan QR sesi dari HP operator</p></div></div>` +
            `<div class="abs-yo"><div class="avatar">${escapeHtml(AbsenSiswa.inisial(AbsenSiswa.namaAkun()))}</div>` +
            `<div>Masuk sebagai <b>${escapeHtml(AbsenSiswa.namaAkun())}</b></div></div>` +
            `<div class="abs-info" id="absInfo"><span><i class="fa-solid fa-spinner fa-spin"></i> Mengecek sesi...</span></div>` +
            `<button class="btn btn-red" id="btnAbsen" style="width:100%; justify-content:center" disabled><i class="fa-solid fa-check"></i> Absen Sekarang</button>` +
            `<form class="abs-kode-form" id="formKode">` +
            `<input type="text" id="inpKode" class="admin-input" placeholder="Kode manual dari operator" maxlength="16" autocomplete="off" />` +
            `<button class="btn btn-white" type="submit"><i class="fa-solid fa-key"></i></button></form>`;
        document.getElementById("btnAbsen")?.addEventListener("click", () => AbsenSiswa.absen());
        document.getElementById("formKode")?.addEventListener("submit", (e) => {
            e.preventDefault();
            AbsenSiswa.absenKode();
        });
        AbsenSiswa.muatInfoSesi();
    },

    async muatInfoSesi() {
        const box = document.getElementById("absInfo");
        const btn = document.getElementById("btnAbsen");
        try {
            const r = await qrAbsenInfo(AbsenSiswa.token);
            if (!box) return;
            if (r.status !== "OK") {
                box.innerHTML = `<span><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(AbsenSiswa.pesan(r.status))}</span>`;
                if (btn) btn.disabled = true;
                return;
            }
            const tgl = AbsenSiswa.fmtTanggal(r.tanggal);
            const keg = String(r.kegiatan || "").trim() || "(tanpa kegiatan)";
            box.innerHTML =
                `<span><i class="fa-solid fa-bullhorn"></i> ${escapeHtml(keg)}</span>` +
                `<span><i class="fa-solid fa-calendar"></i> ${escapeHtml(tgl)}</span>` +
                `<span><i class="fa-solid fa-clock"></i> Berlaku sampai ${escapeHtml(AbsenSiswa.fmtWaktu(r.berakhir_at))}</span>`;
            if (btn) btn.disabled = false;
        } catch (err) {
            console.error(err);
            if (box) box.innerHTML = `<span><i class="fa-solid fa-wifi"></i> Gagal cek sesi. Cek koneksi internet kamu.</span>`;
            if (btn) btn.disabled = true;
        }
    },

    // MODE B
    renderKartu() {
        const el = AbsenSiswa.card();
        const u = AbsenSiswa.akun();
        if (!u) {
            el.innerHTML =
                `<div class="abs-head"><div class="ico"><i class="fa-solid fa-id-card"></i></div>` +
                `<div><h1>Kartu Absen</h1><p>QR pribadi buat dipindai operator</p></div></div>` +
                `<div class="abs-info"><span><i class="fa-solid fa-user-lock"></i> Masuk dulu buat bikin kartu QR.</span>` +
                `<span><i class="fa-solid fa-circle-info"></i> Kartu berlaku sebentar &amp; cuma bisa dipakai sekali.</span></div>` +
                `<button class="btn btn-red" id="btnMasuk" style="width:100%; justify-content:center"><i class="fa-solid fa-right-to-bracket"></i> Masuk</button>`;
            document.getElementById("btnMasuk")?.addEventListener("click", () => AbsenSiswa.masuk());
            return;
        }
        if (u.mode !== "osis") {
            el.innerHTML =
                `<div class="abs-head"><div class="ico"><i class="fa-solid fa-id-card"></i></div>` +
                `<div><h1>Kartu Absen</h1><p>QR pribadi buat dipindai operator</p></div></div>` +
                `<div class="abs-info"><span><i class="fa-solid fa-ban"></i> Kartu absen khusus anggota OSIS.</span></div>` +
                `<button class="btn btn-white" id="btnMasuk" style="width:100%; justify-content:center"><i class="fa-solid fa-right-to-bracket"></i> Ganti akun</button>`;
            document.getElementById("btnMasuk")?.addEventListener("click", () => AbsenSiswa.masuk());
            return;
        }
        const kartu = AbsenSiswa.kartu;
        el.innerHTML =
            `<div class="abs-head"><div class="ico"><i class="fa-solid fa-id-card"></i></div>` +
            `<div><h1>Kartu Absen</h1><p>QR pribadi buat dipindai operator</p></div></div>` +
            `<div class="abs-yo"><div class="avatar">${escapeHtml(AbsenSiswa.inisial(AbsenSiswa.namaAkun()))}</div>` +
            `<div>${escapeHtml(AbsenSiswa.namaAkun())}${kartu && kartu.kelas ? ` <span style="color:var(--gray); font-weight:700">(${escapeHtml(kartu.kelas)})</span>` : ""}</div></div>` +
            (kartu
                ? `<div class="abs-qr" id="absQr"></div>` +
                  `<div class="abs-timer" id="absTimer"></div>` +
                  `<button class="btn btn-white" id="btnRefreshKartu" style="width:100%; justify-content:center"><i class="fa-solid fa-rotate"></i> Buat QR Baru</button>`
                : `<div class="abs-info"><span><i class="fa-solid fa-qrcode"></i> Tekan tombol buat bikin QR kartu. Berlaku 90 detik dan cuma bisa dipakai sekali.</span></div>` +
                  `<button class="btn btn-red" id="btnKartu" style="width:100%; justify-content:center"><i class="fa-solid fa-qrcode"></i> Tampilkan Kartu</button>`);
        document.getElementById("btnKartu")?.addEventListener("click", () => AbsenSiswa.buatKartu());
        document.getElementById("btnRefreshKartu")?.addEventListener("click", () => AbsenSiswa.buatKartu());
        if (kartu) {
            AbsenSiswa.gambarQr();
            AbsenSiswa.mulaiTimer();
        }
    },

    gambarQr() {
        const box = document.getElementById("absQr");
        if (!box || !AbsenSiswa.kartu) return;
        box.innerHTML = "";
        try {
            if (typeof QRCode === "undefined") {
                box.innerHTML = '<div class="qr-kotak-kosong">Library QR belum termuat.</div>';
                return;
            }
            /* eslint-disable no-new */
            new QRCode(box, {
                text: AbsenSiswa.kartu.token,
                width: 230,
                height: 230,
                colorDark: "#1a1416",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.M,
            });
        } catch (e) {
            console.error(e);
            box.innerHTML = '<div class="qr-kotak-kosong">Gagal bikin QR.</div>';
        }
    },

    async buatKartu() {
        if (AbsenSiswa.sibuk) return;
        AbsenSiswa.sibuk = true;
        const btn = document.getElementById("btnKartu");
        const html = btn ? btn.innerHTML : "";
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyiapkan...';
        }
        try {
            const r = await qrAbsenKartuAmbil(90);
            if (r.status !== "OK") {
                showToast(AbsenSiswa.pesan(r.status), "error");
                AbsenSiswa.renderKartu();
                return;
            }
            AbsenSiswa.kartu = r;
            AbsenSiswa.sisa = Number(r.berlaku_detik || 90);
            AbsenSiswa.renderKartu();
        } catch (err) {
            console.error(err);
            showToast("Gagal bikin kartu: " + (err.message || "cek koneksi"), "error");
        } finally {
            AbsenSiswa.sibuk = false;
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = html || '<i class="fa-solid fa-qrcode"></i> Tampilkan Kartu';
            }
        }
    },

    mulaiTimer() {
        if (AbsenSiswa.timer) clearInterval(AbsenSiswa.timer);
        AbsenSiswa.timer = setInterval(() => {
            AbsenSiswa.sisa -= 1;
            const el = document.getElementById("absTimer");
            if (el) {
                const m = Math.floor(Math.max(0, AbsenSiswa.sisa) / 60);
                const d = Math.max(0, AbsenSiswa.sisa) % 60;
                el.innerHTML = `Berlaku <b>${m}:${String(d).padStart(2, "0")}</b> lagi. Habis = otomatis bikin QR baru.`;
            }
            if (AbsenSiswa.sisa <= 0) {
                if (AbsenSiswa.timer) clearInterval(AbsenSiswa.timer);
                AbsenSiswa.timer = null;
                AbsenSiswa.buatKartu();
            }
        }, 1000);
    },

    // ---------- aksi ----------
    async absen() {
        if (AbsenSiswa.sibuk) return;
        AbsenSiswa.sibuk = true;
        const btn = document.getElementById("btnAbsen");
        const html = btn ? btn.innerHTML : "";
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mencatat...';
        }
        try {
            const r = await qrAbsenDaftar(AbsenSiswa.token, "");
            AbsenSiswa.tampilHasil(r);
        } catch (err) {
            console.error(err);
            showToast("Gagal absen: " + (err.message || "cek koneksi"), "error");
        } finally {
            AbsenSiswa.sibuk = false;
            if (btn && btn.isConnected) {
                btn.disabled = false;
                btn.innerHTML = html || '<i class="fa-solid fa-check"></i> Absen Sekarang';
            }
        }
    },

    async absenKode() {
        const inp = document.getElementById("inpKode");
        const kode = String(inp?.value || "").trim().toUpperCase();
        if (!kode) {
            showToast("Masukkan kode dari operator.", "error");
            return;
        }
        if (AbsenSiswa.sibuk) return;
        AbsenSiswa.sibuk = true;
        try {
            const r = await qrAbsenDaftar("", kode);
            AbsenSiswa.tampilHasil(r);
        } catch (err) {
            console.error(err);
            showToast("Gagal absen: " + (err.message || "cek koneksi"), "error");
        } finally {
            AbsenSiswa.sibuk = false;
        }
    },

    tampilHasil(r) {
        const el = AbsenSiswa.card();
        if (!el) return;
        const st = String(r.status || "");
        if (st === "OK" || st === "OK_SAMA") {
            const jam = AbsenSiswa.fmtWaktu(r.jam || new Date().toISOString());
            el.innerHTML =
                `<div class="abs-ok"><div class="tanda"><i class="fa-solid fa-check"></i></div>` +
                `<h2>${st === "OK_SAMA" ? "Kamu udah absen" : "Absen tercatat!"}</h2>` +
                `<p><b>${escapeHtml(r.nama || "-")}</b>${r.kelas ? " (" + escapeHtml(r.kelas) + ")" : ""}</p>` +
                `<p>${escapeHtml(AbsenSiswa.fmtTanggal(r.tanggal))} · ${escapeHtml(jam)}</p>` +
                (r.roster === false ? `<p style="color:var(--red-dark)">Nama kamu gak ada di roster — lapor operator ya.</p>` : "") +
                `</div>`;
            try { catatAksi("absen_qr", String(r.nama || "")); } catch {}
            try { navigator.vibrate?.(80); } catch {}
            return;
        }
        const pesan = AbsenSiswa.pesan(st);
        el.innerHTML =
            `<div class="abs-ok"><div class="tanda gagal"><i class="fa-solid fa-xmark"></i></div>` +
            `<h2>Gagal absen</h2><p>${escapeHtml(pesan)}</p></div>` +
            `<button class="btn btn-white" id="btnAbsen" style="width:100%; justify-content:center; margin-top:12px"><i class="fa-solid fa-rotate-left"></i> Coba Lagi</button>`;
        document.getElementById("btnAbsen")?.addEventListener("click", () => AbsenSiswa.absen());
        showToast(pesan, "error");
    },

    masuk() {
        try {
            const back = "absen" + (AbsenSiswa.token ? "?s=" + encodeURIComponent(AbsenSiswa.token) : "");
            sessionStorage.setItem("osis_login_back", back);
        } catch {}
        location.href = "login";
    },

    // ---------- format ----------
    fmtTanggal(t) {
        if (!t) return "-";
        const d = new Date(String(t).length <= 10 ? t + "T00:00:00" : t);
        if (isNaN(d)) return String(t);
        const s = d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
        return s.charAt(0).toUpperCase() + s.slice(1);
    },

    fmtWaktu(t) {
        if (!t) return "-";
        const d = new Date(t);
        if (isNaN(d)) return "-";
        return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
    },
};

document.addEventListener("DOMContentLoaded", () => AbsenSiswa.init());
