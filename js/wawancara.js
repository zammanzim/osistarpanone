// =========================================================================
// WAWANCARA CALON OSIS — halaman khusus OSIS (folder /osis)
// Dipakai di osis/wawancara.html.
// - Daftar calon + status (belum / berlangsung / selesai) + progres jawaban.
// - Satu sesi per calon; pewawancara TAK TERBATAS (tabel wawancara_sesi_petugas,
//   kolom lama 1/2 disinkron = fallback). Jawaban dipakai
//   bersama dalam sesi yang sama -> cukup SATU yang mencatat, tidak perlu
//   semuanya mengisi terpisah.
// - Pertanyaan utama sama untuk semua calon (susunan bisa beda per sesi);
//   tiap utama bisa punya TURUNAN KHUSUS SESI itu (dibuat pewawancara).
// - Pertanyaan spontan (di luar daftar) + jawabannya, per sesi.
// - Autosave ke Supabase (debounce) + draft localStorage biar progres lanjut.
// - Selesai = read-only, bisa dibuka kembali untuk dibaca.
// Tulis jawaban/status/catatan via RPC hanya oleh pewawancara yang ditugaskan
// di sesi itu (+ super_admin). Kelola calon/pertanyaan/petugas butuh hak
// "wawancara". Buka/lihat boleh semua login OSIS. Wajib login OSIS.
// =========================================================================

const Wawancara = {
    calon: [],
    sesiSemua: [],
    pertanyaan: [],
    senior: [],
    sesi: null,       // baris wawancara_sesi yang sedang dibuka
    calonAktif: null, // baris wawancara_calon yang sedang dibuka
    petugas: [],      // baris wawancara_sesi_petugas (semua sesi); kosong = fallback kolom lama
    jawaban: [],      // baris wawancara_jawaban sesi aktif
    turunan: [],      // baris wawancara_turunan sesi aktif (per calon)
    urutanSesi: {},   // susunan utama per sesi {pertanyaan_id: urutan}
    dokumentasi: [],  // baris wawancara_dokumentasi sesi aktif (foto/video)
    dokBlobs: {},     // tmpId -> File (pratinjau offline, hilang saat reload)
    dokUrls: {},      // tmpId -> objectURL (memo, jangan bocor)
    filterQ: "",
    filterStatus: "",
    hanyaTugasku: false,
    timerSimpan: {},
    butuhMigrasi: false,

    uid() {
        try {
            const u = OsisAuth.getUser && OsisAuth.getUser();
            if (u && u.mode === "osis" && u.id) return u.id;
        } catch {}
        return null;
    },

    // Punya hak kelola halaman (atur calon/pertanyaan/petugas).
    bolehKelola() {
        try {
            return !!(typeof OsisAuth !== "undefined" && OsisAuth.bisa && OsisAuth.bisa("wawancara"));
        } catch { return false; }
    },

    // Boleh mencatat di sesi aktif: DITUGASKAN sebagai pewawancara di sesi itu
    // ATAU super_admin. Pemegang hak "wawancara" yang tidak ditugaskan =
    // read-only (tetap bisa buka/lihat + mengelola calon/pertanyaan/petugas).
    // Cukup satu yang mencatat karena jawaban dipakai bersama.
    bolehTulisSesi() {
        const id = Wawancara.uid();
        if (!id || !Wawancara.sesi) return false;
        try {
            if (typeof OsisAuth !== "undefined" && OsisAuth.isSuper && OsisAuth.isSuper()) return true;
        } catch {}
        return Wawancara.ditugaskan(Wawancara.sesi, id);
    },

    // Ditugaskan sebagai pewawancara di sesi ini (jumlah bebas)?
    // Sumber: tabel baru dulu; bila sesi belum punya baris di sana
    // (migrasi flex belum di-run) fallback ke kolom lama 1/2.
    petugasUntuk(sesiId) {
        const rows = (Wawancara.petugas || []).filter(r => String(r.sesi_id) === String(sesiId));
        if (rows.length) return rows.map(r => r.user_id).filter(Boolean);
        const s = (Wawancara.sesiSemua || []).find(x => String(x.id) === String(sesiId))
            || (Wawancara.sesi && String(Wawancara.sesi.id) === String(sesiId) ? Wawancara.sesi : null);
        if (!s) return [];
        return [s.pewawancara1_id, s.pewawancara2_id].filter(Boolean);
    },

    ditugaskan(s, id) {
        if (!s || !id) return false;
        if (Wawancara.petugasUntuk(s.id).some(uid => String(uid) === String(id))) return true;
        return String(s.pewawancara1_id) === String(id) || String(s.pewawancara2_id) === String(id);
    },

    // Nama para pewawancara sesi, dipisah " · " (atau "Belum ditugaskan").
    namaPetugas(s) {
        const nama = Wawancara.petugasUntuk(s.id)
            .map(id => Wawancara.namaSenior(id));
        return nama.length ? nama.join(" · ") : "Belum ditugaskan";
    },

    STATUS_LABEL: { belum: "Belum dimulai", berlangsung: "Sedang berlangsung", selesai: "Selesai" },

    // Samakan perilaku popup dengan halaman lain: klik backdrop menutup,
    // ESC menutup yang teratas dulu (edit > kelola > calon). Tombol back HP
    // ditangani otomatis via ModalNav (id terdaftar di show-popup.js).
    // Tidak bentrok dengan showPopup uni (capture-nya menelan key duluan).
    pasangPopup() {
        ["wwCalonForm", "wwTanyaForm", "wwTanyaEdit"].forEach(id => {
            document.getElementById(id)?.addEventListener("click", (e) => {
                if (e.target.id !== id) return;
                if (id === "wwTanyaEdit") Wawancara.tutupFormTanya();
                else if (id === "wwTanyaForm") Wawancara.tutupKelolaTanya();
                else Wawancara.tutupFormCalon();
            });
        });
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            if (document.getElementById("wwTanyaEdit")?.classList.contains("open")) Wawancara.tutupFormTanya();
            else if (document.getElementById("wwTanyaForm")?.classList.contains("open")) Wawancara.tutupKelolaTanya();
            else if (document.getElementById("wwCalonForm")?.classList.contains("open")) Wawancara.tutupFormCalon();
        });
    },

    // Keyboard wawancara: Esc = mundur bertingkat (soal sebelumnya / mode
    // atur / daftar calon), ←/→ = pindah soal. Panah hanya saat fokus di luar
    // kolom ketik (biar caret textarea tidak dibajak). Popup/modal yang terbuka
    // selalu diutamakan (diurus sistemnya masing-masing).
    pasangNavigasiKeyboard() {
        if (Wawancara._navKeyPasang) return;
        Wawancara._navKeyPasang = true;
        const popupTerbuka = () => {
            if (document.getElementById("uniOverlay")) return true;
            try {
                if (window.ModalNav && ModalNav.adaYangTerbuka && ModalNav.adaYangTerbuka()) return true;
            } catch {}
            return ["wwCalonForm", "wwTanyaForm", "wwTanyaEdit"].some(id =>
                document.getElementById(id)?.classList.contains("open"));
        };
        const diDetail = () => {
            if (!Wawancara.sesi || !Wawancara.calonAktif) return false;
            const d = document.getElementById("wwDetail");
            return !!(d && d.style.display !== "none");
        };
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                if (popupTerbuka()) return; // biar popup yang tutup duluan
                // Lightbox dokumentasi: Esc = tutup.
                if (Wawancara.dokLightboxBuka()) { Wawancara.dokTutup(); return; }
                // Editor turunan inline: Esc = batalkan.
                const inline = document.getElementById("wwTurunanBaru");
                if (inline) { inline.remove(); return; }
                if (!diDetail()) return;
                if (Wawancara.mode === "wawancara" && Wawancara.idx > 0) {
                    Wawancara.idx--;
                    Wawancara.renderSesi();
                } else if (Wawancara.mode === "wawancara") {
                    Wawancara.mode = "atur";
                    Wawancara.renderSesi();
                } else {
                    Wawancara.kembali();
                }
                return;
            }
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            // Lightbox dokumentasi: panah = geser foto.
            if (Wawancara.dokLightboxBuka()) {
                if (popupTerbuka()) return;
                e.preventDefault();
                Wawancara.dokGeser(e.key === "ArrowLeft" ? -1 : 1);
                return;
            }
            if (Wawancara.mode !== "wawancara" || !diDetail()) return;
            if (popupTerbuka()) return;
            // Lagi mengetik di kolom: panah buat geser caret, bukan pindah soal.
            try {
                const tag = (e.target && e.target.tagName) || "";
                if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
                if (e.target && e.target.isContentEditable) return;
            } catch {}
            if (e.key === "ArrowLeft" && Wawancara.idx > 0) {
                e.preventDefault();
                Wawancara.geserLangkah(-1);
            } else if (e.key === "ArrowRight") {
                const ur = Wawancara.bangunUrutan();
                if (Wawancara.idx < ur.length - 1) {
                    e.preventDefault();
                    Wawancara.geserLangkah(1);
                }
            }
        });
    },

    // Tombol back HP = mundur satu step (soal sebelumnya / mode atur /
    // daftar), bukan keluar halaman. Popup diurus sistemnya masing-masing
    // (ModalNav/uniPopup terdaftar duluan — event yang mereka konsumsi di-skip).
    pasangBack() {
        if (Wawancara._backPasang) return;
        Wawancara._backPasang = true;
        window.addEventListener("popstate", (e) => {
            if (e.__modalKonsumsi) return;
            if ((window.__abaikanBack | 0) > 0) {
                window.__abaikanBack--;
                e.__modalKonsumsi = true;
                return;
            }
            if (document.getElementById("uniOverlay")) return;
            try {
                if (window.ModalNav && ModalNav.adaYangTerbuka && ModalNav.adaYangTerbuka()) return;
            } catch {}
            // Lightbox dokumentasi: back = tutup (konsumsi event).
            if (Wawancara.dokLightboxBuka()) {
                e.__modalKonsumsi = true;
                Wawancara.dokTutup(true);
                return;
            }
            if (!Wawancara.sesi || !Wawancara.calonAktif) return; // di daftar: biarkan default
            const d = document.getElementById("wwDetail");
            if (!d || d.style.display === "none") return;
            e.__modalKonsumsi = true;
            if (Wawancara.mode === "wawancara" && Wawancara.idx > 0) {
                Wawancara.idx--;
                Wawancara.renderSesi();
            } else if (Wawancara.mode === "wawancara") {
                Wawancara.mode = "atur";
                Wawancara.renderSesi();
            } else {
                Wawancara.muatDaftar();
                return; // pop dibiarkan keluar dari detail
            }
            // Jangkar lagi biar back berikut juga mundur satu step.
            try { history.pushState({ wwback: true }, ""); } catch {}
        });
    },

    // ================= INIT =================
    async init() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") {
            location.replace("../login");
            return;
        }
        try { if (typeof OsisAuth.refreshAkses === "function") await OsisAuth.refreshAkses(); } catch {}
        Wawancara.pasangPopup();
        Wawancara.pasangBack();
        Wawancara.pasangNavigasiKeyboard();
        // Deep link ?calon=<id> -> langsung buka sesi calon itu.
        let dariUrl = null;
        try {
            const v = new URLSearchParams(location.search).get("calon");
            const n = parseInt(v, 10);
            if (Number.isFinite(n) && n > 0) dariUrl = n;
        } catch {}
        if (dariUrl) {
            await Wawancara.bukaCalon(dariUrl);
        } else {
            await Wawancara.muatDaftar();
        }
    },

    // ================= DAFTAR =================
    async muatDaftar() {
        try { clearInterval(Wawancara._durTimer); } catch {}
        Wawancara._durTimer = null;
        Wawancara.sesi = null;
        Wawancara.calonAktif = null;
        const wrap = document.getElementById("wwDaftar");
        const detail = document.getElementById("wwDetail");
        if (detail) detail.style.display = "none";
        const sec = document.getElementById("wwDaftarSection");
        if (sec) sec.style.display = "";
        const hero = document.getElementById("wwHero");
        if (hero) hero.style.display = "";
        if (wrap) {
            wrap.style.display = "";
            wrap.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat daftar calon...</div>`;
        }
        Wawancara.pasangFilter();
        try {
            const [calon, sesi] = await Promise.all([getWawancaraCalon(), getWawancaraSesi()]);
            Wawancara.calon = calon || [];
            Wawancara.sesiSemua = sesi || [];
            try { Wawancara.senior = await getOsisUsersRingkas(); } catch { Wawancara.senior = []; }
            try { Wawancara.petugas = (typeof getWawancaraPetugas === "function") ? await getWawancaraPetugas() : []; }
            catch { Wawancara.petugas = []; }
            Wawancara.butuhMigrasi = false;
        } catch (err) {
            console.error(err);
            if (String((err && err.message) || "") === "BUTUH_MIGRASI") {
                Wawancara.butuhMigrasi = true;
                Wawancara.renderButuhMigrasi();
                return;
            }
            if (wrap) wrap.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-triangle-exclamation"></i> Gagal memuat: ${escapeHtml(err.message || err)}</div>`;
            return;
        }
        Wawancara.renderHero();
        Wawancara.renderDaftar();
    },

    renderButuhMigrasi() {
        const sec = document.getElementById("wwDaftarSection");
        if (sec) sec.style.display = "";
        const hero = document.getElementById("wwHero");
        if (hero) hero.style.display = "";
        const wrap = document.getElementById("wwDaftar");
        if (wrap) {
            wrap.style.display = "";
            wrap.innerHTML = `
                <div class="osis-panel">
                    <h3 style="font-weight:900; display:flex; gap:8px; align-items:center"><i class="fa-solid fa-database" style="color:var(--red)"></i> Migrasi database belum diterapkan</h3>
                    <p class="osis-empty">Tabel wawancara belum ada di Supabase. Minta super_admin menjalankan file <b>db/migrasi-wawancara.sql</b> lewat SQL Editor (sekali saja, non-destruktif), lalu refresh halaman ini.</p>
                </div>`;
        }
        const d = document.getElementById("wwDetail");
        if (d) d.style.display = "none";
    },

    sesiUntukCalon(calonId) {
        return (Wawancara.sesiSemua || []).find(s => String(s.calon_id) === String(calonId)) || null;
    },

    namaSenior(id) {
        if (!id) return "—";
        const r = (Wawancara.senior || []).find(x => String(x.id) === String(id));
        return r ? (r.nama || r.username || ("#" + id)) : ("#" + id);
    },

    opsiSenior(terpilih) {
        return `<option value="">— Pilih —</option>` + (Wawancara.senior || []).map(o =>
            `<option value="${o.id}" ${String(o.id) === String(terpilih) ? "selected" : ""}>${escapeHtml(o.nama || o.username || ("#" + o.id))}${o.jabatan ? " · " + escapeHtml(o.jabatan) : ""}</option>`).join("");
    },

    renderHero() {
        const meta = document.getElementById("wwMeta");
        if (!meta) return;
        const total = Wawancara.calon.length;
        const nSelesai = Wawancara.calon.filter(c => (Wawancara.sesiUntukCalon(c.id) || {}).status === "selesai").length;
        const nJalan = Wawancara.calon.filter(c => (Wawancara.sesiUntukCalon(c.id) || {}).status === "berlangsung").length;
        meta.innerHTML = `
            <span class="osis-badge red"><i class="fa-solid fa-users"></i> ${total} calon</span>
            <span class="osis-badge">${nJalan} berlangsung</span>
            <span class="osis-badge">${nSelesai} selesai</span>`;
        const btnCalon = document.getElementById("btnTambahCalon");
        if (btnCalon) btnCalon.style.display = Wawancara.bolehKelola() ? "" : "none";
        const btnTanya = document.getElementById("btnKelolaTanya");
        if (btnTanya) btnTanya.style.display = Wawancara.bolehKelola() ? "" : "none";
    },

    pasangFilter() {
        const q = document.getElementById("wwQ");
        if (q && !q.dataset.pasang) {
            q.dataset.pasang = "1";
            q.addEventListener("input", () => { Wawancara.filterQ = q.value || ""; Wawancara.renderDaftar(); });
        }
        const s = document.getElementById("wwStatus");
        if (s && !s.dataset.pasang) {
            s.dataset.pasang = "1";
            s.addEventListener("change", () => { Wawancara.filterStatus = s.value || ""; Wawancara.renderDaftar(); });
        }
        const t = document.getElementById("wwTugasku");
        if (t && !t.dataset.pasang) {
            t.dataset.pasang = "1";
            t.addEventListener("change", () => { Wawancara.hanyaTugasku = !!t.checked; Wawancara.renderDaftar(); });
        }
    },

    daftarTampil() {
        const q = (Wawancara.filterQ || "").trim().toLowerCase();
        const id = Wawancara.uid();
        return (Wawancara.calon || []).filter(c => {
            if (q && !(String(c.nama || "").toLowerCase().includes(q) || String(c.kelas || "").toLowerCase().includes(q))) return false;
            const s = Wawancara.sesiUntukCalon(c.id);
            const st = s ? s.status : "belum";
            if (Wawancara.filterStatus && st !== Wawancara.filterStatus) return false;
            if (Wawancara.hanyaTugasku && id) {
                if (!Wawancara.ditugaskan(s, id)) return false;
            }
            return true;
        }).sort((a, b) => {
            // Tanggal naik (belum dijadwalkan paling bawah), lalu urutan, nama.
            const ta = a.tanggal ? String(a.tanggal).slice(0, 10) : "";
            const tb = b.tanggal ? String(b.tanggal).slice(0, 10) : "";
            if (!ta && tb) return 1;
            if (!tb && ta) return -1;
            if (ta !== tb) return ta < tb ? -1 : 1;
            if ((a.display_order || 99) !== (b.display_order || 99)) return (a.display_order || 99) - (b.display_order || 99);
            return String(a.nama || "").localeCompare(String(b.nama || ""));
        });
    },

    // "2026-10-12" -> "Senin, 12 Oktober 2026" (zona WIB, tanggal kalender sekolah).
    fmtHariTanggal(t) {
        if (!t) return "Belum dijadwalkan";
        try {
            const d = new Date(String(t).slice(0, 10) + "T12:00:00+07:00");
            return d.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", weekday: "long", day: "numeric", month: "long", year: "numeric" });
        } catch { return String(t).slice(0, 10); }
    },

    badgeStatus(st) {
        const cls = st === "selesai" ? "ww-st-selesai" : st === "berlangsung" ? "ww-st-jalan" : "ww-st-belum";
        return `<span class="ww-st ${cls}">${escapeHtml(Wawancara.STATUS_LABEL[st] || st || "Belum dimulai")}</span>`;
    },

    renderDaftar() {
        const wrap = document.getElementById("wwDaftar");
        if (!wrap) return;
        if (!Wawancara.calon.length) {
            wrap.innerHTML = `<div class="osis-panel"><div class="osis-empty"><i class="fa-solid fa-user-plus"></i> Belum ada calon. ${Wawancara.bolehKelola() ? "Klik <b>+ Calon</b> untuk menambah." : "Minta admin menambah daftar calon."}</div></div>`;
            return;
        }
        const rows = Wawancara.daftarTampil();
        if (!rows.length) {
            wrap.innerHTML = `<div class="osis-panel"><div class="osis-empty"><i class="fa-solid fa-magnifying-glass"></i> Tidak ada calon yang cocok dengan filter.</div></div>`;
            return;
        }
        // Kelompokkan per tanggal wawancara ("" = belum dijadwalkan, paling bawah).
        const grup = {};
        const urut = [];
        rows.forEach(c => {
            const k = c.tanggal ? String(c.tanggal).slice(0, 10) : "";
            if (!grup[k]) { grup[k] = []; urut.push(k); }
            grup[k].push(c);
        });
        urut.sort((a, b) => {
            if (!a && b) return 1;
            if (!b && a) return -1;
            if (a === b) return 0;
            return a < b ? -1 : 1;
        });
        wrap.innerHTML = urut.map(k => `
            <div class="ww-grup"><i class="fa-solid fa-calendar-day"></i> ${escapeHtml(k ? Wawancara.fmtHariTanggal(k) : "Belum dijadwalkan")}<span class="cnt">${grup[k].length} calon</span></div>
            ${grup[k].map(c => Wawancara.kartuCalon(c)).join("")}`).join("");
    },

    kartuCalon(c) {
        const s = Wawancara.sesiUntukCalon(c.id);
        const st = s ? s.status : "belum";
        const petugas = s ? Wawancara.namaPetugas(s) : "Belum ditugaskan";
        const milikku = Wawancara.ditugaskan(s, Wawancara.uid());
        return `
            <div class="ww-card">
                <div class="ww-ava">${escapeHtml((String(c.nama || "?").trim().charAt(0) || "?").toUpperCase())}</div>
                <div class="ww-info">
                    <b>${escapeHtml(c.nama || "-")}</b>
                    <small>${escapeHtml(c.kelas || "-")}${c.keterangan ? " · " + escapeHtml(c.keterangan) : ""}</small>
                    <small class="ww-petugas"><i class="fa-solid fa-user-pen"></i> ${escapeHtml(petugas)}</small>
                    <div style="margin-top:6px">${Wawancara.badgeStatus(st)}${milikku ? ` <span class="ww-st ww-st-jalan"><i class="fa-solid fa-star"></i> Tugasku</span>` : ""}</div>
                </div>
                <div class="ww-act">
                    ${Wawancara.bolehKelola() ? `
                    <button class="icon-btn" title="Edit calon" onclick="Wawancara.formCalon(${c.id})"><i class="fa-solid fa-pen"></i></button>
                    <button class="icon-btn" title="Hapus calon" onclick="Wawancara.hapusCalon(${c.id})"><i class="fa-solid fa-trash"></i></button>` : ""}
                    <button class="btn btn-red btn-sm" onclick="Wawancara.bukaCalon(${c.id})"><i class="fa-solid fa-door-open"></i> Buka</button>
                </div>
            </div>`;
    },

    // ================= DETAIL SESI =================
    async bukaCalon(calonId) {
        const masukBaru = !Wawancara.sesi;
        const detail = document.getElementById("wwDetail");
        if (detail) {
            detail.style.display = "";
            detail.innerHTML = `<div class="loading-block"><div class="spinner"></div> Membuka wawancara...</div>`;
        }
        // Masuk detail: hero + filter + daftar disembunyikan (fokus ke calon).
        const sec = document.getElementById("wwDaftarSection");
        if (sec) sec.style.display = "none";
        const hero = document.getElementById("wwHero");
        if (hero) hero.style.display = "none";
        const list = document.getElementById("wwDaftar");
        if (list) list.style.display = "none";
        try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch {}
        try {
            const [calon, sesiSemua, tanya] = await Promise.all([
                getWawancaraCalon(), getWawancaraSesi(), getWawancaraPertanyaan(),
            ]);
            Wawancara.calon = calon || [];
            Wawancara.sesiSemua = sesiSemua || [];
            Wawancara.pertanyaan = (tanya || []).filter(p => p.aktif !== false);
            try { Wawancara.senior = await getOsisUsersRingkas(); } catch { Wawancara.senior = []; }
            try { Wawancara.petugas = (typeof getWawancaraPetugas === "function") ? await getWawancaraPetugas() : []; }
            catch { Wawancara.petugas = []; }
            const c = Wawancara.calon.find(x => String(x.id) === String(calonId));
            if (!c) throw new Error("Calon tidak ditemukan (mungkin sudah dihapus).");
            Wawancara.calonAktif = c;
            // Pastikan sesi ada (satu per calon) agar jawaban punya cantolan.
            // Offline: pakai sesi dari cache (tambah calon baru butuh online).
            let sid = null;
            try {
                sid = await wawancaraSesiPastikan(Wawancara.uid(), c.id);
            } catch (errP) {
                if (Wawancara.jaringanPutus(errP)) {
                    const s0 = (Wawancara.sesiSemua || []).find(x => String(x.calon_id) === String(c.id));
                    if (!s0) throw new Error("Calon ini belum pernah dibuka saat online — hubungkan internet sekali untuk memuat datanya.");
                    sid = s0.id;
                } else throw errP;
            }
            const fresh = await getWawancaraSesi();
            Wawancara.sesiSemua = fresh || [];
            Wawancara.sesi = (fresh || []).find(s => String(s.id) === String(sid));
            Wawancara.jawaban = await getWawancaraJawaban(Wawancara.sesi.id);
            // Susunan khusus sesi ini (bawaan = master bila belum diatur).
            Wawancara.urutanSesi = {};
            try {
                await wawancaraUrutanPastikan(Wawancara.uid(), Wawancara.sesi.id);
            } catch (errU) {
                if (!Wawancara.jaringanPutus(errU)) throw errU;
                // Offline: lanjut pakai cache/master, antrean menyusul.
            }
            await Wawancara.muatUrutanSesi();
            await Wawancara.muatTurunan();
            try { await Wawancara.muatDokumentasi(); }
            catch (eDok) { if (!Wawancara.jaringanPutus(eDok)) throw eDok; Wawancara.dokumentasi = []; }
            // Selesai dibuka = langsung mode hasil (read-only); selain itu mode atur.
            Wawancara.mode = Wawancara.sesi.status === "selesai" ? "hasil" : "atur";
            Wawancara.idx = 0;
            // Pulihkan mode wawancara dari URL (?calon=X&test=true&soal=N).
            try {
                const q = new URLSearchParams(location.search);
                const mauTest = q.get("test") === "true";
                const noSoal = parseInt(q.get("soal"), 10) || 0;
                if (mauTest && Wawancara.sesi.status !== "belum") {
                    Wawancara.mode = "wawancara";
                    Wawancara.idx = Math.max(0, noSoal - 1);
                }
            } catch {}
            Wawancara.tulisUrl();
            // Jangkar riwayat (sekali per masuk detail) agar back HP pertama
            // ditangkap pasangBack. Refresh dalam sesi tidak push lagi.
            if (masukBaru) {
                try { history.pushState({ wwback: true }, ""); } catch {}
            }
        } catch (err) {
            console.error(err);
            if (String((err && err.message) || "") === "BUTUH_MIGRASI") {
                Wawancara.sesi = null;
                Wawancara.renderButuhMigrasi();
                return;
            }
            const pesan = Wawancara.jaringanPutus(err)
                ? "Kamu offline dan data calon ini belum tersimpan di HP — buka sekali saat online dulu."
                : String(err.message || err);
            if (detail) detail.innerHTML = `<div class="osis-panel"><div class="pesan-empty">Gagal membuka: ${escapeHtml(pesan)}</div>
                <div style="margin-top:10px"><button class="btn btn-white btn-sm" onclick="Wawancara.kembali()"><i class="fa-solid fa-arrow-left"></i> Kembali</button></div></div>`;
            return;
        }
        Wawancara.renderSesi();
    },

    kembali() {
        try {
            const u = new URL(location.href);
            u.searchParams.delete("calon");
            u.searchParams.delete("test");
            u.searchParams.delete("soal");
            history.replaceState(null, "", u.toString());
        } catch {}
        Wawancara.muatDaftar();
    },

    // Sinkronkan URL: ?calon=X selalu; &test=true&soal=N saat mode wawancara.
    // Format: wawancara?calon=1&test=true&soal=5 — refresh tetap di soal itu.
    tulisUrl() {
        try {
            const u = new URL(location.href);
            if (Wawancara.calonAktif) u.searchParams.set("calon", String(Wawancara.calonAktif.id));
            else u.searchParams.delete("calon");
            if (Wawancara.calonAktif && Wawancara.mode === "wawancara") {
                u.searchParams.set("test", "true");
                u.searchParams.set("soal", String(Wawancara.idx + 1));
            } else {
                u.searchParams.delete("test");
                u.searchParams.delete("soal");
            }
            history.replaceState(null, "", u.toString());
        } catch {}
    },

    jawabanUntuk(pertanyaanId) {
        return (Wawancara.jawaban || []).find(j => !j.is_spontan && String(j.pertanyaan_id) === String(pertanyaanId)) || null;
    },

    spontanList() {
        return (Wawancara.jawaban || []).filter(j => j.is_spontan);
    },

    pertanyaanUtama() {
        return (Wawancara.pertanyaan || [])
            .filter(p => !p.parent_id)
            .sort((a, b) => (Wawancara.urutEfektif(a) - Wawancara.urutEfektif(b)) || (a.id - b.id));
    },

    turunanUntuk(parentId) {
        return (Wawancara.turunan || [])
            .filter(t => String(t.parent_id) === String(parentId))
            .sort((a, b) => (a.urutan - b.urutan) || (a.id - b.id));
    },

    async muatTurunan() {
        Wawancara.turunan = await getWawancaraTurunan(Wawancara.sesi.id);
    },

    // Urutan efektif: susunan sesi ini bila ada, kalau tidak bawaan master.
    urutEfektif(p) {
        const m = Wawancara.urutanSesi || {};
        const v = m[String(p.id)];
        return v == null ? (p.urutan || 99) : v;
    },

    async muatUrutanSesi() {
        const rows = await getWawancaraUrutan(Wawancara.sesi.id);
        const m = {};
        (rows || []).forEach(r => { m[String(r.pertanyaan_id)] = r.urutan; });
        Wawancara.urutanSesi = m;
    },

    progres() {
        let total = 0, isi = 0;
        Wawancara.pertanyaanUtama().forEach(p => {
            total++;
            const j = Wawancara.jawabanUntuk(p.id);
            if (j && String(j.jawaban_teks || "").trim()) isi++;
            Wawancara.turunanUntuk(p.id).forEach(a => {
                total++;
                if (String(a.jawaban_teks || "").trim()) isi++;
            });
        });
        return { isi, total };
    },

    renderSesi() {
        const detail = document.getElementById("wwDetail");
        if (!detail || !Wawancara.sesi || !Wawancara.calonAktif) return;
        const c = Wawancara.calonAktif;
        const s = Wawancara.sesi;
        const kelola = Wawancara.bolehKelola();
        const tulis = Wawancara.bolehTulisSesi();
        const selesai = s.status === "selesai";
        const bacaSaja = selesai || !tulis;
        const pr = Wawancara.progres();
        const persen = pr.total ? Math.round((pr.isi / pr.total) * 100) : 0;

        const opsiSenior = (terpilih) => Wawancara.opsiSenior(terpilih);

        const stTxtCls = s.status === "selesai" ? "ww-stxt-selesai" : s.status === "berlangsung" ? "ww-stxt-berlangsung" : "ww-stxt-belum";
        // Satu baris tombol ukuran normal: merah = aksi utama,
        // kuning = selesaikan, putih = lainnya.
        const btnLanjut = (!selesai && tulis && Wawancara.mode !== "wawancara")
            ? `<button class="btn btn-red btn-sm" onclick="Wawancara.masukWawancara()"><i class="fa-solid fa-${s.status === "belum" ? "play" : "forward"}"></i> ${s.status === "belum" ? "Mulai" : "Lanjutkan"}</button>` : "";
        const btnSpontan = (tulis && !selesai)
            ? `<button class="btn btn-red btn-sm" onclick="Wawancara.tambahSpontan()"><i class="fa-solid fa-bolt"></i> Spontan</button>` : "";
        const btnBuka = (tulis && selesai)
            ? `<button class="btn btn-white btn-sm" onclick="Wawancara.aturStatus('berlangsung')"><i class="fa-solid fa-rotate-left"></i> Buka kembali</button>` : "";
        const btnSelesai = (tulis && s.status === "berlangsung")
            ? `<button class="btn btn-yellow btn-sm" onclick="Wawancara.aturStatus('selesai')"><i class="fa-solid fa-flag-checkered"></i> Selesaikan</button>` : "";
        const btnStop = (tulis && s.status === "berlangsung")
            ? `<button class="btn btn-white btn-sm" onclick="Wawancara.aturStatus('belum')"><i class="fa-solid fa-stop"></i> Stop</button>` : "";
        const btnHasil = (Wawancara.mode !== "hasil")
            ? `<button class="btn btn-white btn-sm" onclick="Wawancara.lihatHasil()"><i class="fa-solid fa-eye"></i> Hasil</button>` : "";
        const btnAtur = (Wawancara.mode !== "atur")
            ? `<button class="btn btn-white btn-sm" onclick="Wawancara.lihatAtur()"><i class="fa-solid fa-list-ol"></i> Atur</button>` : "";
        // Mode atur: Spontan paling kiri, Lanjutkan paling kanan.
        const btnAksi = Wawancara.mode === "atur"
            ? [btnSpontan, btnSelesai, btnStop, btnBuka, btnHasil, btnLanjut].join("")
            : [btnLanjut, btnSpontan, btnBuka, btnSelesai, btnStop, btnHasil, btnAtur].join("");

        detail.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px">${Wawancara.mode === "wawancara" ? `<button class="btn btn-white btn-sm" onclick="Wawancara.lihatAtur()"><i class="fa-solid fa-arrow-left"></i> Kembali</button>` : `<button class="btn btn-white btn-sm" onclick="Wawancara.kembali()"><i class="fa-solid fa-arrow-left"></i> Daftar calon</button>`}<hr class="ww-hr"></div>
            <div class="ww-layout">
            <div class="ww-side">
            <div class="osis-panel">
                <div class="ww-head-top">
                    <div class="ww-ava ww-ava-lg">${escapeHtml((String(c.nama || "?").trim().charAt(0) || "?").toUpperCase())}</div>
                    <div style="flex:1; min-width:0">
                        <h2>${escapeHtml(c.nama || "-")}</h2>
                        <p class="ww-sub">${escapeHtml(c.kelas || "-")} · Pewawancara: ${escapeHtml(Wawancara.namaPetugas(s))}</p>
                    </div>
                </div>
                <div class="ww-head-status">
                    <span class="ww-stxt ${stTxtCls}"><span class="dot"></span>${escapeHtml(Wawancara.STATUS_LABEL[s.status] || s.status)}${s.status === "berlangsung" && s.mulai_at ? `<span id="wwDurasi"></span>` : ""}</span>
                </div>
                <div style="margin-top:8px"><span class="ww-savetxt" id="wwSavePill"><i class="fa-solid fa-check"></i> Progres tersimpan</span></div>
                ${bacaSaja ? `<div class="ww-banner"><i class="fa-solid ${selesai ? "fa-lock" : "fa-eye"}"></i> ${selesai ? "Wawancara selesai — hasil read-only. Klik <b>Buka kembali</b> untuk mengoreksi." : "Kamu tidak ditugaskan di sesi ini — hanya bisa membaca."}</div>` : ""}
                <div class="ww-head-div"></div>
                <div class="ww-head-prog">
                    <b id="wwHeadCount">${pr.isi} dari ${pr.total}</b>
                    <span id="wwHeadPct">${persen}%</span>
                </div>
                <div class="ww-sub" id="wwHeadInfo">Jawaban terisi${Wawancara.spontanList().length ? ` · ${Wawancara.spontanList().length} spontan` : ""}</div>
                <div class="ww-bar"><span id="wwHeadBar" style="width:${persen}%"></span></div>
                <div class="ww-status-btns" style="margin-top:12px">${btnAksi}</div>
            </div>
            </div>
            <div id="wwModeWrap" class="ww-main"></div>
            </div>`;

        Wawancara.renderMode();
        Wawancara.tulisUrl();
        Wawancara.mulaiDurasi();
    },

    // Durasi live "Sedang berlangsung · HH:MM:SS" dari mulai_at sampai detik ini.
    durasiBerjalan() {
        const s = Wawancara.sesi;
        if (!s || s.status !== "berlangsung" || !s.mulai_at) return null;
        const ms = Date.now() - new Date(s.mulai_at).getTime();
        if (!Number.isFinite(ms) || ms < 0) return "00:00:00";
        const d = Math.floor(ms / 1000);
        const h = String(Math.floor(d / 3600)).padStart(2, "0");
        const m = String(Math.floor((d % 3600) / 60)).padStart(2, "0");
        const t = String(d % 60).padStart(2, "0");
        return `${h}:${m}:${t}`;
    },

    mulaiDurasi() {
        try { clearInterval(Wawancara._durTimer); } catch {}
        Wawancara._durTimer = null;
        if (!document.getElementById("wwDurasi")) return;
        const tick = () => {
            const box = document.getElementById("wwDurasi");
            if (!box) {
                try { clearInterval(Wawancara._durTimer); } catch {}
                Wawancara._durTimer = null;
                return;
            }
            box.textContent = "· " + (Wawancara.durasiBerjalan() || "—");
        };
        tick();
        if (Wawancara.sesi && Wawancara.sesi.status === "berlangsung") {
            Wawancara._durTimer = setInterval(tick, 1000);
        }
    },

    // ================= MODE TAMPILAN =================
    // atur: daftar pertanyaan TANPA form jawaban + geser urutan.
    // wawancara: bersih, satu pertanyaan per layar + next.
    // hasil: baca semua jawaban (read-only).
    renderMode() {
        const wrap = document.getElementById("wwModeWrap");
        if (!wrap) return;
        if (Wawancara.mode === "wawancara") Wawancara.renderWawancara(wrap);
        else if (Wawancara.mode === "hasil") Wawancara.renderHasil(wrap);
        else Wawancara.renderAtur(wrap);
        Wawancara.pasangAutosave();
    },

    lihatAtur() { Wawancara.mode = "atur"; Wawancara.renderSesi(); },
    lihatHasil() { Wawancara.mode = "hasil"; Wawancara.renderSesi(); },

    masukWawancara() {
        const s = Wawancara.sesi;
        if (!s || !Wawancara.bolehTulisSesi()) return;
        if (s.status === "belum") { Wawancara.aturStatus("berlangsung"); return; }
        if (s.status !== "berlangsung") return;
        Wawancara.mode = "wawancara";
        Wawancara.idx = Wawancara.idxPertamaKosong();
        try { window.scrollTo({ top: 0 }); } catch {}
        Wawancara.renderSesi();
    },

    // Urutan langkah: tiap utama (turunannya gabung satu layar), lalu
    // spontan, lalu catatan akhir.
    bangunUrutan() {
        const out = [];
        Wawancara.pertanyaanUtama().forEach(p => {
            out.push({ kind: "master", q: p });
        });
        Wawancara.spontanList().forEach(j => out.push({ kind: "spontan", j }));
        out.push({ kind: "catatan" });
        return out;
    },

    jawabTeksUntuk(it) {
        if (!it) return "";
        if (it.kind === "spontan") return String((it.j && it.j.jawaban_teks) || "");
        if (it.kind === "catatan") return String((Wawancara.sesi && Wawancara.sesi.catatan_akhir) || "");
        const j = Wawancara.jawabanUntuk(it.q.id);
        return String((j && j.jawaban_teks) || "");
    },

    idxPertamaKosong() {
        const ur = Wawancara.bangunUrutan().filter(x => x.kind !== "catatan");
        for (let i = 0; i < ur.length; i++) {
            const it = ur[i];
            if (it.kind === "master") {
                if (!Wawancara.jawabTeksUntuk(it).trim()) return i;
                const anakKosong = Wawancara.turunanUntuk(it.q.id).some(a => !String(a.jawaban_teks || "").trim());
                if (anakKosong) return i;
            } else if (!Wawancara.jawabTeksUntuk(it).trim()) {
                return i;
            }
        }
        return 0;
    },

    // Progres header + grid navigasi diperbarui tiap autosave.
    updateNavProgress() {
        const pr = Wawancara.progres();
        const nSpon = Wawancara.spontanList().length;
        const persen = pr.total ? Math.round((pr.isi / pr.total) * 100) : 0;
        const count = document.getElementById("wwHeadCount");
        if (count) count.textContent = `${pr.isi} dari ${pr.total}`;
        const pct = document.getElementById("wwHeadPct");
        if (pct) pct.textContent = `${persen}%`;
        const info = document.getElementById("wwHeadInfo");
        if (info) info.textContent = `Jawaban terisi${nSpon ? ` · ${nSpon} spontan` : ""}`;
        const bar = document.getElementById("wwHeadBar");
        if (bar) bar.style.width = `${persen}%`;
        Wawancara.updateNavGrid();
    },

    // ---- Drag & drop susunan (desktop drag mouse; HP tahan grip/baris) ----
    // Dipasang tiap render mode atur. Hanya sesama induk yang bisa tukar
    // (utama↔utama, turunan satu induk). Indikator garis merah = posisi jatuh.
    pasangDrag() {
        const wrap = document.getElementById("wwModeWrap");
        if (!wrap || !wrap.querySelectorAll) return;
        // Satu listener dokumen (dipasang sekali): lacak posisi pointer selama
        // drag + auto-scroll halaman saat pointer mepet tepi atas/bawah.
        if (!Wawancara._dragDoc) {
            Wawancara._dragDoc = true;
            Wawancara._dragId = null;
            Wawancara._dragY = null;
            Wawancara._dragTimer = null;
            document.addEventListener("dragover", (e) => {
                if (Wawancara._dragId == null) return;
                try { Wawancara._dragY = e.clientY; } catch {}
            });
            Wawancara._dragScrollMulai = () => {
                Wawancara._dragScrollStop();
                // rAF 60fps: makin mepet tepi makin cepat (min 12px, maks 70px
                // per frame). behavior "instant" WAJIB — CSS global pakai
                // scroll-behavior:smooth yang bikin scrollBy antri animasi.
                const langkah = () => {
                    if (Wawancara._dragId == null) return;
                    const M = 120, MAX = 70, MIN = 12;
                    try {
                        const h = window.innerHeight;
                        const y = Wawancara._dragY;
                        let v = 0;
                        if (y != null) {
                            if (y < M) v = -Math.max(MIN, MAX * (1 - y / M));
                            else if (y > h - M) v = Math.max(MIN, MAX * (1 - (h - y) / M));
                        }
                        Wawancara._dorongScroll(Math.round(v));
                    } catch {}
                    try { Wawancara._dragTimer = requestAnimationFrame(langkah); } catch {}
                };
                try { Wawancara._dragTimer = requestAnimationFrame(langkah); } catch {}
            };
            // Scroll programatik sekali jalan (instant, lawan smooth global).
            Wawancara._dorongScroll = (px) => {
                if (!px) return;
                try { window.scrollBy({ top: px, behavior: "instant" }); }
                catch { try { window.scrollBy(0, px); } catch {} }
            };
            Wawancara._dragScrollStop = () => {
                try { cancelAnimationFrame(Wawancara._dragTimer); } catch {}
                try { clearInterval(Wawancara._dragTimer); } catch {}
                Wawancara._dragTimer = null;
                Wawancara._dragY = null;
            };
        }
        let dragId = null;
        const bersihIndikator = () => {
            wrap.querySelectorAll(".ww-drop-atas, .ww-drop-bawah").forEach(x =>
                x.classList.remove("ww-drop-atas", "ww-drop-bawah"));
        };
        wrap.querySelectorAll('.ww-atur-row[draggable="true"]').forEach(row => {
            row.addEventListener("dragstart", (e) => {
                dragId = row.dataset.tid;
                Wawancara._dragId = dragId;
                try { Wawancara._dragY = e.clientY; } catch {}
                try {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(dragId));
                } catch {}
                row.classList.add("ww-drag");
                Wawancara._dragScrollMulai();
            });
            const akhiri = () => {
                row.classList.remove("ww-drag");
                bersihIndikator();
                dragId = null;
                Wawancara._dragId = null;
                Wawancara._dragScrollStop();
            };
            row.addEventListener("dragend", akhiri);
            row.addEventListener("dragover", (e) => {
                if (!dragId || String(row.dataset.tid) === String(dragId)) return;
                e.preventDefault();
                try {
                    const r = row.getBoundingClientRect();
                    const atas = (e.clientY - r.top) < r.height / 2;
                    row.classList.toggle("ww-drop-atas", atas);
                    row.classList.toggle("ww-drop-bawah", !atas);
                } catch {}
            });
            row.addEventListener("dragleave", () => {
                row.classList.remove("ww-drop-atas", "ww-drop-bawah");
            });
            row.addEventListener("drop", (e) => {
                try { e.preventDefault(); } catch {}
                const atas = row.classList.contains("ww-drop-atas");
                bersihIndikator();
                Wawancara.jatuhkan(dragId, row.dataset.tid, atas);
                dragId = null;
                Wawancara._dragId = null;
                Wawancara._dragScrollStop();
            });
            // ---- Drag sentuh (HP): HTML5 DnD tidak jalan di browser mobile.
            // Dua cara mulai: (1) tahan handle grip lalu geser (langsung);
            // (2) tekan-tahan baris 450ms (ada getar) lalu geser — target
            // sentuh besar. Geser cepat = scroll biasa (drag batal otomatis).
            // Penyimpanan + auto-scroll pakai jalur yang sama dengan desktop.
            const bolehGeser = row.hasAttribute("draggable");
            const DS = Wawancara._ds || (Wawancara._ds = {});
            const mulaiJalan = (rowEl, tid) => {
                DS.tId = tid; DS.row = rowEl; DS.jalan = true;
                DS.targetId = null; DS.hantu = null;
                Wawancara._dragId = tid;
                Wawancara._dragY = null;
                rowEl.classList.add("ww-drag");
                Wawancara._dragScrollMulai();
                try {
                    const r = rowEl.getBoundingClientRect();
                    const h = rowEl.cloneNode(true);
                    h.style.cssText = "position:fixed;z-index:999;pointer-events:none;opacity:.92;margin:0;"
                        + "left:" + r.left + "px;width:" + r.width + "px;";
                    document.body.appendChild(h);
                    DS.hantu = h;
                } catch {}
            };
            const gerakJalan = (t, ev) => {
                if (!DS.jalan) return;
                if (ev) { try { ev.preventDefault(); } catch {} }
                Wawancara._dragY = t.clientY;
                // Dorongan langsung tiap gerakan jari (tak tergantung rAF).
                try {
                    const h = window.innerHeight, y = t.clientY, M2 = 120;
                    if (y < M2) Wawancara._dorongScroll(-14);
                    else if (y > h - M2) Wawancara._dorongScroll(14);
                } catch {}
                if (DS.hantu) { try { DS.hantu.style.top = (t.clientY - 24) + "px"; } catch {} }
                let sasaran = null, atas = false;
                try {
                    const el = document.elementFromPoint(t.clientX, t.clientY);
                    const baris = el && el.closest ? el.closest(".ww-atur-row[data-tid]") : null;
                    if (baris && String(baris.dataset.tid) !== String(DS.tId)) {
                        const r = baris.getBoundingClientRect();
                        atas = (t.clientY - r.top) < r.height / 2;
                        sasaran = baris.dataset.tid;
                    }
                } catch {}
                DS.targetId = sasaran; DS.targetAtas = atas;
                wrap.querySelectorAll(".ww-drop-atas, .ww-drop-bawah").forEach(x =>
                    x.classList.remove("ww-drop-atas", "ww-drop-bawah"));
                if (sasaran != null) {
                    const el = wrap.querySelector('.ww-atur-row[data-tid="' + sasaran + '"]');
                    if (el) el.classList.add(atas ? "ww-drop-atas" : "ww-drop-bawah");
                }
            };
            const selesaiJalan = (batal) => {
                if (!DS.jalan && DS.tId == null) return;
                const simpanId = DS.tId, keId = DS.targetId, keAtas = DS.targetAtas;
                const baris = DS.row;
                DS.tId = null; DS.jalan = false; DS.row = null; DS.targetId = null;
                try { if (baris) baris.classList.remove("ww-drag"); } catch {}
                try { if (DS.hantu && DS.hantu.parentNode) DS.hantu.parentNode.removeChild(DS.hantu); } catch {}
                DS.hantu = null;
                wrap.querySelectorAll(".ww-drop-atas, .ww-drop-bawah").forEach(x =>
                    x.classList.remove("ww-drop-atas", "ww-drop-bawah"));
                Wawancara._dragId = null;
                Wawancara._dragScrollStop();
                if (!batal && keId != null) Wawancara.jatuhkan(simpanId, keId, keAtas);
            };
            if (bolehGeser) {
                const grip = row.querySelector(".ww-grip");
                if (grip) {
                    let gId = null, gX = 0, gY = 0;
                    grip.addEventListener("touchstart", (e) => {
                        const t = e.touches && e.touches[0];
                        if (!t) return;
                        gId = row.dataset.tid; gX = t.clientX; gY = t.clientY;
                    }, { passive: true });
                    grip.addEventListener("touchmove", (e) => {
                        if (gId == null) return;
                        const t = e.touches && e.touches[0];
                        if (!t) return;
                        if (!DS.jalan) {
                            if (Math.abs(t.clientY - gY) < 12 && Math.abs(t.clientX - gX) < 12) return;
                            mulaiJalan(row, gId);
                        }
                        gerakJalan(t, e);
                    }, { passive: false });
                    const gAkhir = (batal) => {
                        const sedang = DS.jalan && String(DS.tId) === String(gId);
                        gId = null;
                        if (sedang) selesaiJalan(batal);
                    };
                    grip.addEventListener("touchend", () => gAkhir(false));
                    grip.addEventListener("touchcancel", () => gAkhir(true));
                }
                // Tekan-tahan baris: alternatif target besar (kecuali mulai di
                // tombol/input — biar tombol tetap bisa diketik/diklik).
                let lpId = null, lpX = 0, lpY = 0, lpTimer = 0;
                row.addEventListener("touchstart", (e) => {
                    const t = e.touches && e.touches[0];
                    if (!t) return;
                    try {
                        const el = e.target;
                        if (el && el.closest && el.closest("button, input, select, textarea, a")) return;
                    } catch {}
                    lpId = row.dataset.tid; lpX = t.clientX; lpY = t.clientY;
                    try { clearTimeout(lpTimer); } catch {}
                    lpTimer = setTimeout(() => {
                        if (lpId == null || DS.jalan) return;
                        mulaiJalan(row, lpId);
                        try { if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(40); } catch {}
                    }, 450);
                }, { passive: true });
                row.addEventListener("touchmove", (e) => {
                    const t = e.touches && e.touches[0];
                    if (lpId != null && !DS.jalan) {
                        if (t && (Math.abs(t.clientY - lpY) > 10 || Math.abs(t.clientX - lpX) > 10)) {
                            try { clearTimeout(lpTimer); } catch {}
                            lpId = null;
                        }
                        return;
                    }
                    if (DS.jalan && String(DS.tId) === String(row.dataset.tid)) {
                        if (t) gerakJalan(t, e);
                    }
                }, { passive: false });
                row.addEventListener("touchend", () => {
                    try { clearTimeout(lpTimer); } catch {}
                    const milik = DS.jalan && String(DS.tId) === String(row.dataset.tid);
                    lpId = null;
                    if (milik) selesaiJalan(false);
                });
                row.addEventListener("touchcancel", () => {
                    try { clearTimeout(lpTimer); } catch {}
                    const milik = DS.jalan && String(DS.tId) === String(row.dataset.tid);
                    lpId = null;
                    if (milik) selesaiJalan(true);
                });
            }
        });
    },

    async jatuhkan(dragId, targetId, atas) {
        if (!dragId || !targetId || String(dragId) === String(targetId)) return;
        if (!Wawancara.bolehKelola() && !Wawancara.bolehTulisSesi()) return;
        if (Wawancara.sesi && Wawancara.sesi.status === "selesai") return;
        const list = (Wawancara.pertanyaan || []).filter(p => p.aktif !== false);
        const drag = list.find(x => String(x.id) === String(dragId));
        const target = list.find(x => String(x.id) === String(targetId));
        if (!drag || !target) return;
        // Urutan sesi hanya untuk UTAMA (turunan mengikuti induknya).
        if (drag.parent_id || target.parent_id) return;
        if (String(drag.parent_id || "") !== String(target.parent_id || "")) {
            try { if (typeof showToast === "function") showToast("Turunan hanya bisa digeser sesama satu induk.", "error"); } catch {}
            return;
        }
        const sib = list.filter(x => String(x.parent_id || "") === String(drag.parent_id || ""))
            .sort((a, b) => (Wawancara.urutEfektif(a) - Wawancara.urutEfektif(b)) || (a.id - b.id));
        const tanpa = sib.filter(x => String(x.id) !== String(drag.id));
        let ti = tanpa.findIndex(x => String(x.id) === String(target.id));
        if (ti < 0) return;
        tanpa.splice(atas ? ti : ti + 1, 0, drag);
        // Offline: susun lokal + antre (gabung per sesi).
        if (Wawancara.jaringanPutus() && Wawancara.outboxSiap()) {
            try {
                const ids = tanpa.map(x => x.id);
                ids.forEach((id, i) => { Wawancara.urutanSesi[String(id)] = (i + 1) * 10; });
                try {
                    if (typeof wawancaraCacheSimpan === "function") {
                        wawancaraCacheSimpan("wawancara_urutan_" + Wawancara.sesi.id,
                            ids.map((id, i) => ({ sesi_id: Wawancara.sesi.id, pertanyaan_id: id, urutan: (i + 1) * 10 })));
                    }
                } catch {}
                await Wawancara.antreTulis("Susunan pertanyaan", {
                    jenis: "urutan", target: "ww-u:" + Wawancara.sesi.id,
                    sesiId: Wawancara.sesi.id, ids: ids,
                });
                Wawancara.setPill("lokal");
                Wawancara.renderSesi();
            } catch (err) {
                console.error(err);
                try { if (typeof showToast === "function") showToast("Gagal: " + (err.message || err), "error"); } catch {}
            }
            return;
        }
        try {
            // Tersimpan sebagai susunan KHUSUS sesi/calon ini saja.
            const ids = tanpa.map(x => x.id);
            await wawancaraUrutanAtur(Wawancara.uid(), Wawancara.sesi.id, ids);
            ids.forEach((id, i) => { Wawancara.urutanSesi[String(id)] = (i + 1) * 10; });
            try { if (typeof showToast === "function") showToast("Urutan diperbarui untuk calon ini.", "success"); } catch {}
            Wawancara.renderSesi();
        } catch (err) {
            if (Wawancara.jaringanPutus(err) && Wawancara.outboxSiap()) {
                // Putus di tengah: ulangi via jalur offline yang sama.
                try {
                    const ids = tanpa.map(x => x.id);
                    ids.forEach((id, i) => { Wawancara.urutanSesi[String(id)] = (i + 1) * 10; });
                    await Wawancara.antreTulis("Susunan pertanyaan", {
                        jenis: "urutan", target: "ww-u:" + Wawancara.sesi.id,
                        sesiId: Wawancara.sesi.id, ids: ids,
                    });
                    Wawancara.setPill("lokal");
                    Wawancara.renderSesi();
                } catch (e2) {
                    console.error(e2);
                    try { if (typeof showToast === "function") showToast("Gagal: " + (e2.message || e2), "error"); } catch {}
                }
                return;
            }
            try { if (typeof showToast === "function") showToast("Gagal: " + (err.message || err), "error"); } catch {}
        }
    },

    // ---- Mode ATUR: tanpa form jawaban, kelola susunan ----
    renderAtur(wrap) {
        const s = Wawancara.sesi;
        const kelola = Wawancara.bolehKelola();
        const tulis = Wawancara.bolehTulisSesi();
        const selesai = s.status === "selesai";
        const opsiSenior = (terpilih) => Wawancara.opsiSenior(terpilih);
        const opsMaster = (p) => {
            if (!kelola || selesai) return "";
            return `<span class="ww-mini-ops">
                <button class="icon-btn icon-btn-sm" title="Edit" onclick="Wawancara.formTanya(${p.id}, ${p.parent_id ? p.parent_id : "null"})"><i class="fa-solid fa-pen"></i></button>
                <button class="icon-btn icon-btn-sm" title="Hapus" onclick="Wawancara.hapusTanya(${p.id})"><i class="fa-solid fa-trash"></i></button>
            </span>`;
        };
        // Tombol + turunan: semua pewawancara sesi ini (hak tidak wajib),
        // karena turunan hanya milik calon ini. Edit/hapus utama tetap kelola.
        const btnPlus = (p) => ((kelola || tulis) && !selesai && !p.parent_id)
            ? `<span class="ww-mini-ops"><button class="icon-btn icon-btn-sm" title="Tambah turunan" onclick="Wawancara.formTurunan(${p.id})"><i class="fa-solid fa-plus"></i></button></span>`
            : "";
        const daftar = Wawancara.pertanyaanUtama().map((p, i) => {
            const bolehUbah = (kelola || tulis) && !selesai;
            const anak = Wawancara.turunanUntuk(p.id).map(a => `
                <div class="ww-atur-row ww-atur-anak">
                    <span class="ww-nomor ww-nomor-anak">⤷</span>
                    <span class="ww-atur-teks">${escapeHtml(a.teks)}</span>
                    ${bolehUbah ? `<span class="ww-mini-ops">
                        <button class="icon-btn icon-btn-sm" title="Edit" onclick="Wawancara.editTurunan('${a.id}')"><i class="fa-solid fa-pen"></i></button>
                        <button class="icon-btn icon-btn-sm" title="Hapus" onclick="Wawancara.hapusTurunan('${a.id}')"><i class="fa-solid fa-trash"></i></button>
                    </span>` : ""}
                </div>`).join("");
            return `<div class="ww-atur-row${p.penting ? " penting" : ""}" data-tid="${p.id}" data-parent="" ${(kelola || tulis) && !selesai ? `draggable="true"` : ""}>
                    ${(kelola || tulis) && !selesai ? `<span class="ww-grip" title="Geser"><i class="fa-solid fa-grip-vertical"></i></span>` : ""}
                    <span class="ww-nomor">${i + 1}</span>
                    <span class="ww-atur-teks">${escapeHtml(p.teks)}</span>
                    ${opsMaster(p)}
                    ${btnPlus(p)}
                    ${p.penting ? `<span class="ww-bintang" title="Paling penting"><i class="fa-solid fa-star"></i></span>` : ""}
                </div>${anak}`;
        }).join("");
        const spontan = Wawancara.spontanList().map(j => `
            <div class="ww-atur-row">
                <span class="ww-nomor ww-nomor-anak"><i class="fa-solid fa-bolt"></i></span>
                <input type="text" class="admin-input ww-spontan-teks" data-jid="${j.id}" maxlength="500"
                    value="${escapeHtml(j.pertanyaan_teks || "")}" ${tulis && !selesai ? "" : "disabled"} placeholder="Pertanyaan spontan...">
                ${tulis && !selesai ? `<span class="ww-mini-ops"><button class="icon-btn icon-btn-sm" title="Hapus" onclick="Wawancara.hapusSpontan(${j.id})"><i class="fa-solid fa-trash"></i></button></span>` : ""}
            </div>`).join("");
        wrap.innerHTML = `
            <div class="osis-panel">
                <h3 class="ww-judul"><i class="fa-solid fa-user-pen"></i> Pewawancara</h3>
                <p class="ww-sub">Jumlah bebas, hak semua sama. Cukup satu yang mencatat.</p>
                <div id="wwPewList">${Wawancara.petugasUntuk(s.id).map(id => Wawancara.pewRowHtml(id, kelola && !selesai)).join("") || Wawancara.pewRowHtml(null, kelola && !selesai)}</div>
                ${kelola && !selesai ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
                    <button class="btn btn-white btn-sm" onclick="Wawancara.tambahPewRow()"><i class="fa-solid fa-plus"></i> Tambah pewawancara</button>
                    <button class="btn btn-red btn-sm" onclick="Wawancara.simpanPetugas()"><i class="fa-solid fa-floppy-disk"></i> Simpan pewawancara</button>
                </div>` : ""}
            </div>
            <div class="osis-panel">
                <h3 class="ww-judul"><i class="fa-solid fa-list-ol"></i> Pertanyaan utama</h3>
                <p class="ww-sub">Sama untuk semua calon, tapi susunan bisa beda per calon — geser khusus untuk ${escapeHtml(Wawancara.calonAktif ? (Wawancara.calonAktif.nama || "") : "")}.</p>
                <div>${daftar || `<div class="osis-empty">Belum ada pertanyaan master.</div>`}</div>
                ${kelola && !selesai ? `<button class="btn btn-white btn-sm" onclick="Wawancara.formTanya(null, null)"><i class="fa-solid fa-plus"></i> Tambah pertanyaan utama</button>` : ""}
            </div>
            <div class="osis-panel">
                <h3 class="ww-judul"><i class="fa-solid fa-bolt"></i> Pertanyaan spontan</h3>
                <p class="ww-sub">Pertanyaan dadakan di luar daftar — khusus sesi ini.</p>
                <div>${spontan || `<div class="osis-empty">Belum ada pertanyaan spontan.</div>`}</div>
                ${tulis && !selesai ? `<button class="btn btn-white btn-sm" onclick="Wawancara.tambahSpontan()"><i class="fa-solid fa-plus"></i> Tambah spontan</button>` : ""}
            </div>
            <div class="osis-panel">
                <h3 class="ww-judul"><i class="fa-solid fa-camera"></i> Dokumentasi</h3>
                <p class="ww-sub">Foto/video/suara kegiatan wawancara calon ini.</p>
                <div id="wwDokGrid">${Wawancara.dokGrid(tulis && !selesai)}</div>
                ${tulis && !selesai ? `<div class="field" style="margin-top:10px"><label>Keterangan (opsional, untuk file yang diupload)</label><input type="text" id="wwDokKet" class="admin-input" maxlength="300" placeholder="cth: sesi tanya jawab" autocomplete="off"></div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
                    <button class="btn btn-red btn-sm" id="wwDokBtn" onclick="document.getElementById('wwDokFile').click()"><i class="fa-solid fa-cloud-arrow-up"></i> Tambah file</button>
                </div>
                <input type="file" id="wwDokFile" accept="image/*,video/*,audio/*" multiple hidden onchange="Wawancara.dokUpload(this)">` : ""}
            </div>
            <div class="osis-panel">
                <h3 class="ww-judul"><i class="fa-solid fa-clipboard-check"></i> Catatan akhir</h3>
                <p class="ww-sub">Kesimpulan / rekomendasi pewawancara.</p>
                <textarea id="wwCatatan" class="admin-input admin-textarea ww-jawab" rows="4" maxlength="2000"
                    ${tulis && !selesai ? "" : "disabled"} placeholder="Kesimpulan wawancara... (otomatis tersimpan)">${escapeHtml(s.catatan_akhir || "")}</textarea>
            </div>`;
        Wawancara.pasangDrag();
    },

    // ---- Mode WAWANCARA: bersih, satu pertanyaan per layar ----
    renderWawancara(wrap) {
        const s = Wawancara.sesi;
        const tulis = Wawancara.bolehTulisSesi();
        const kelola = Wawancara.bolehKelola();
        const selesai = s.status === "selesai";
        const bacaSaja = selesai || !tulis;
        const ur = Wawancara.bangunUrutan();
        if (!ur.length) { wrap.innerHTML = `<div class="osis-panel"><div class="osis-empty">Belum ada pertanyaan.</div></div>`; return; }
        if (!Number.isFinite(Wawancara.idx)) Wawancara.idx = 0;
        if (Wawancara.idx < 0) Wawancara.idx = 0;
        if (Wawancara.idx > ur.length - 1) Wawancara.idx = ur.length - 1;
        const step = ur[Wawancara.idx];
        const total = ur.length - 1; // tanpa langkah catatan
        let isi = "";
        if (step.kind === "catatan") {
            isi = `<div class="ww-qnomor"><i class="fa-solid fa-clipboard-check"></i> Catatan akhir</div>
                <div class="ww-qteks">Kesimpulan / rekomendasi pewawancara.</div>
                <textarea id="wwCatatan" class="admin-input admin-textarea ww-jawab ww-jawab-besar" rows="7" maxlength="2000"
                    ${bacaSaja ? "disabled" : ""} placeholder="Kesimpulan wawancara... (otomatis tersimpan)">${escapeHtml(s.catatan_akhir || "")}</textarea>`;
        } else if (step.kind === "spontan") {
            const j = step.j;
            isi = `<div class="ww-spontan">
                <div style="display:flex;align-items:center;gap:8px">
                    <div class="ww-qnomor"><i class="fa-solid fa-bolt"></i> Spontan · ${Math.min(Wawancara.idx + 1, total)} dari ${total}</div>
                    ${tulis && !selesai ? `<button class="icon-btn icon-btn-sm" style="margin-left:auto" title="Hapus pertanyaan spontan ini" onclick="Wawancara.hapusSpontan(${j.id})"><i class="fa-solid fa-trash"></i></button>` : ""}
                </div>
                <div class="field" style="margin:8px 0 12px"><label>Pertanyaan spontan</label>
                    <input type="text" class="admin-input ww-spontan-teks" data-jid="${j.id}" maxlength="500"
                        value="${escapeHtml(j.pertanyaan_teks || "")}" ${bacaSaja ? "disabled" : ""} placeholder="Tulis pertanyaan spontannya...">
                </div>
                <textarea class="admin-input admin-textarea ww-jawab ww-spontan-jawab" rows="7" maxlength="5000"
                    data-qid="spontan" data-jid="${j.id}" ${bacaSaja ? "disabled" : ""}
                    placeholder="Ketik jawaban... (otomatis tersimpan)">${escapeHtml(j.jawaban_teks || "")}</textarea>
            </div>`;
        } else {
            const j = Wawancara.jawabanUntuk(step.q.id);
            const anakHtml = Wawancara.turunanUntuk(step.q.id).map(a => {
                return `<div class="ww-anak">
                    <div class="ww-tanya"><span class="ww-nomor ww-nomor-anak">⤷</span><span>${escapeHtml(a.teks)}</span>${(kelola || tulis) && !selesai ? `<button class="icon-btn icon-btn-sm" style="margin-left:auto" title="Hapus turunan ini" onclick="Wawancara.hapusTurunan('${a.id}')"><i class="fa-solid fa-trash"></i></button>` : ""}</div>
                    <textarea class="admin-input admin-textarea ww-jawab" rows="3" maxlength="5000"
                        data-ttid="${a.id}" ${bacaSaja ? "disabled" : ""}
                        placeholder="Ketik jawaban... (otomatis tersimpan)">${escapeHtml(a.jawaban_teks || "")}</textarea>
                </div>`;
            }).join("");
            isi = `<div class="ww-qnomor"><i class="fa-solid fa-list-ol"></i> Pertanyaan ${Math.min(Wawancara.idx + 1, total)} dari ${total}${step.q.penting ? `<span class="ww-bintang" title="Paling penting"><i class="fa-solid fa-star"></i></span>` : ""}</div>
                <div class="ww-qteks">${escapeHtml(step.q.teks)}</div>
                <textarea class="admin-input admin-textarea ww-jawab" rows="3" maxlength="5000"
                    data-qid="${step.q.id}" data-jid="${j ? j.id : ""}" ${bacaSaja ? "disabled" : ""}
                    placeholder="Ketik jawaban... (otomatis tersimpan)">${escapeHtml(j ? String(j.jawaban_teks || "") : "")}</textarea>
                ${anakHtml}
                <div id="wwTurunanAnchor"></div>
                ${(kelola || tulis) && !selesai ? `<button class="btn btn-white btn-sm" style="margin-top:6px" onclick="Wawancara.tambahTurunanLangsung(${step.q.id})"><i class="fa-solid fa-plus"></i> Turunan</button>` : ""}`;
        }
        wrap.innerHTML = `
            <div class="osis-panel${(step.kind === "master" && step.q.penting) ? " ww-card-penting" : ""}">
                ${isi}
                <div class="ww-nav">
                    <button class="btn btn-white" onclick="Wawancara.geserLangkah(-1)" ${Wawancara.idx <= 0 ? "disabled" : ""}><i class="fa-solid fa-arrow-left"></i> Sebelumnya</button>
                    <button class="btn btn-red" onclick="Wawancara.geserLangkah(1)" ${Wawancara.idx >= ur.length - 1 ? "disabled" : ""}>Berikutnya <i class="fa-solid fa-arrow-right"></i></button>
                </div>
                ${bacaSaja ? "" : `<div class="ww-sub" style="margin:8px 0 0"><b>Enter</b> lanjut · <b>←/→</b> pindah · <b>Esc</b> kembali · <b>Shift+Enter</b> baris baru</div>`}
            </div>
            <div class="osis-panel">
                <div class="ww-nav-grid" id="wwNavGrid">${Wawancara.renderNavGrid()}</div>
                <div class="ww-nav-legend">
                    <span><i class="sw sw-biasa"></i>Biasa</span>
                    <span><i class="sw sw-anak"></i>Ada turunan</span>
                    <span><i class="sw sw-spontan"></i>Spontan</span>
                </div>
            </div>`;
        Wawancara.updateNavProgress();
    },

    // ---- Navigasi nomor soal (di bawah kartu pertanyaan) ----
    // Warna per TIPE: putih = biasa, kuning = punya turunan, biru = spontan.
    // Gelap = sedang dibuka. Badge ✓ hijau = terjawab penuh.
    masterTuntas(p) {
        const j = Wawancara.jawabanUntuk(p.id);
        if (!j || !String(j.jawaban_teks || "").trim()) return false;
        return Wawancara.turunanUntuk(p.id).every(a => String(a.jawaban_teks || "").trim() !== "");
    },

    renderNavGrid() {
        const ur = Wawancara.bangunUrutan().filter(x => x.kind !== "catatan");
        let n = 0;
        return ur.map((it, i) => {
            let cls = "ww-navbtn", tuntas = false, judul = "";
            if (it.kind === "spontan") {
                cls += " ww-nv-spontan";
                tuntas = String((it.j && it.j.jawaban_teks) || "").trim() !== "";
                judul = (it.j && it.j.pertanyaan_teks) || "Spontan";
            } else {
                if (Wawancara.turunanUntuk(it.q.id).length) cls += " ww-nv-anak";
                tuntas = Wawancara.masterTuntas(it.q);
                judul = it.q.teks;
            }
            n++;
            if (i === Wawancara.idx) cls += " aktif";
            if (tuntas) cls += " isi";
            return `<button type="button" class="${cls}" title="${escapeHtml(judul)}" onclick="Wawancara.lompatKe(${i})">${n}<span class="ww-nv-cek">✓</span></button>`;
        }).join("");
    },

    lompatKe(i) {
        const ur = Wawancara.bangunUrutan();
        if (i < 0 || i > ur.length - 1) return;
        Wawancara.idx = i;
        Wawancara.renderSesi();
    },

    updateNavGrid() {
        const g = document.getElementById("wwNavGrid");
        if (g) g.innerHTML = Wawancara.renderNavGrid();
    },

    geserLangkah(arah) {
        const ur = Wawancara.bangunUrutan();
        const i = Wawancara.idx + arah;
        if (i < 0 || i > ur.length - 1) return;
        Wawancara.idx = i;
        Wawancara.renderSesi();
    },

    // ---- Mode HASIL: baca semua jawaban ----
    renderHasil(wrap) {
        const s = Wawancara.sesi;
        const item = (nomor, teks, jawab, bintang) => `
            <div class="ww-hasil-item">
                <div class="ww-tanya"><span class="ww-nomor">${nomor}</span><span>${escapeHtml(teks)}</span>${bintang ? `<span class="ww-bintang" title="Paling penting"><i class="fa-solid fa-star"></i></span>` : ""}</div>
                <div class="ww-hasil-jawab">${jawab && String(jawab).trim() ? escapeHtml(jawab) : `<span class="kosong">Belum dijawab</span>`}</div>
            </div>`;
        let n = 0;
        let html = "";
        Wawancara.pertanyaanUtama().forEach(p => {
            n++;
            const j = Wawancara.jawabanUntuk(p.id);
            html += item(n, p.teks, j && j.jawaban_teks, !!p.penting);
            Wawancara.turunanUntuk(p.id).forEach(a => {
                html += `<div style="margin-left:16px">${item("⤷", a.teks, a.jawaban_teks)}</div>`;
            });
        });
        if (Wawancara.spontanList().length) {
            html += `<h3 class="ww-judul" style="margin-top:14px"><i class="fa-solid fa-bolt"></i> Spontan</h3>`;
            Wawancara.spontanList().forEach(j => {
                html += item("⚡", j.pertanyaan_teks, j.jawaban_teks);
            });
        }
        html += `<h3 class="ww-judul" style="margin-top:14px"><i class="fa-solid fa-camera"></i> Dokumentasi</h3>
            ${Wawancara.dokGrid(false)}`;
        html += `<h3 class="ww-judul" style="margin-top:14px"><i class="fa-solid fa-clipboard-check"></i> Catatan akhir</h3>
            <div class="ww-hasil-jawab" style="margin-left:0">${s.catatan_akhir && String(s.catatan_akhir).trim() ? escapeHtml(s.catatan_akhir) : `<span class="kosong">—</span>`}</div>`;
        wrap.innerHTML = `<div class="osis-panel">
            <h3 class="ww-judul"><i class="fa-solid fa-eye"></i> Hasil wawancara</h3>
            <p class="ww-sub">Read-only. Untuk mengoreksi, buka kembali sesinya.</p>
            <div style="margin-bottom:12px"><button class="btn btn-red btn-sm" onclick="Wawancara.exportPdf()"><i class="fa-solid fa-file-pdf"></i> Export PDF</button></div>
            ${html || `<div class="osis-empty">Belum ada pertanyaan.</div>`}
        </div>`;
    },

    // Export hasil sesi aktif ke PDF via dialog print browser (pilih "Save as
    // PDF"). Tanpa library, jalan offline. Foto dokumentasi tidak ikut (cetak
    // teks saja) biar ringan.
    exportPdf() {
        const s = Wawancara.sesi, c = Wawancara.calonAktif;
        if (!s || !c) return;
        const esc = (typeof escapeHtml === "function") ? escapeHtml : (x => String(x ?? ""));
        const blok = (tanya, jawab) => `
            <div class="q"><div class="t">${esc(tanya) || "-"}</div>
            <div class="j">${jawab && String(jawab).trim() ? esc(jawab) : "<i>Belum dijawab</i>"}</div></div>`;
        let n = 0, isi = "";
        Wawancara.pertanyaanUtama().forEach(p => {
            n++;
            const j = Wawancara.jawabanUntuk(p.id);
            isi += `<div class="nomor">${n}.</div>` + blok((p.penting ? "★ " : "") + (p.teks || ""), j && j.jawaban_teks);
            Wawancara.turunanUntuk(p.id).forEach(a => {
                isi += `<div class="anak">` + blok("⤷ " + (a.teks || ""), a.jawaban_teks) + `</div>`;
            });
        });
        if (Wawancara.spontanList().length) {
            isi += `<h2>Pertanyaan spontan</h2>`;
            Wawancara.spontanList().forEach(j => { isi += blok(j.pertanyaan_teks, j.jawaban_teks); });
        }
        isi += `<h2>Catatan akhir</h2>` + blok("Kesimpulan / rekomendasi pewawancara", s.catatan_akhir);
        let tgl = "";
        try { tgl = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }); } catch {}
        const doc = `<!doctype html><html lang="id"><head><meta charset="utf-8">
            <title>Hasil Wawancara - ${esc(c.nama || "calon")}</title>
            <style>body{font-family:Arial,Helvetica,sans-serif;color:#000;margin:24px;line-height:1.6;font-size:13px}
            h1{font-size:19px;margin:0 0 2px}h2{font-size:15px;margin:18px 0 8px;border-bottom:2px solid #000;padding-bottom:3px}
            .meta{font-size:12px;margin-bottom:14px}.meta b{display:inline-block;min-width:130px}
            .nomor{font-weight:bold;margin-top:12px}.q{margin:2px 0 8px}.t{font-weight:bold}
            .j{white-space:pre-line;margin-top:2px}.j i{color:#555}.anak{margin-left:18px;border-left:3px solid #999;padding-left:10px}
            .kop{text-align:center;border-bottom:3px double #000;padding-bottom:8px;margin-bottom:12px}
            .kop p{margin:2px 0;font-size:12px}</style></head><body>
            <div class="kop"><h1>HASIL WAWANCARA CALON OSIS</h1><p>OSIS SMK Taruna Harapan 1 Cipatat · osistarpanone.my.id</p></div>
            <div class="meta"><b>Nama</b>: ${esc(c.nama || "-")}<br><b>Kelas</b>: ${esc(c.kelas || "-")}
            ${c.keterangan ? `<br><b>Keterangan</b>: ${esc(c.keterangan)}` : ""}
            <br><b>Tanggal</b>: ${esc(c.tanggal ? Wawancara.fmtHariTanggal(c.tanggal) : "-")}
            <br><b>Pewawancara</b>: ${esc(Wawancara.namaPetugas(s))}
            <br><b>Status</b>: ${esc(Wawancara.STATUS_LABEL[s.status] || s.status || "-")}
            <br><b>Dicetak</b>: ${esc(tgl)}</div>
            ${isi || "<p>Belum ada pertanyaan.</p>"}
            </body></html>`;
        try {
            let fr = document.getElementById("wwPrintFrame");
            if (!fr) {
                fr = document.createElement("iframe");
                fr.id = "wwPrintFrame";
                fr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
                document.body.appendChild(fr);
            }
            const w = fr.contentWindow;
            w.document.open();
            w.document.write(doc);
            w.document.close();
            setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 250);
        } catch (err) {
            try { if (typeof showToast === "function") showToast("Gagal menyiapkan cetakan: " + (err.message || err), "error"); } catch {}
        }
    },

    // ================= AUTOSAVE =================
    setPill(mode) {
        const pill = document.getElementById("wwSavePill");
        if (!pill) return;
        pill.classList.remove("simpan", "gagal");
        if (mode === "simpan") {
            pill.classList.add("simpan");
            pill.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...`;
        } else if (mode === "ok") {
            let jam = "";
            try { jam = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).replace(/\./g, ":"); } catch {}
            pill.innerHTML = `<i class="fa-solid fa-check"></i> Tersimpan ${escapeHtml(jam)}`;
        } else if (mode === "gagal") {
            pill.classList.add("gagal");
            pill.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Gagal tersimpan — cek koneksi`;
        } else if (mode === "lokal") {
            pill.classList.add("simpan");
            pill.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Tersimpan offline — kirim otomatis`;
        }
    },

    // ============ OFFLINE — khusus isi sesi (jawaban/turunan/spontan/urutan)
    // Tulis antre ke Outbox sebagai snapshot penuh per target; antrean lama
    // untuk target yang sama dibuang dulu (yang tersinkron = versi terakhir).
    // ID temp ("tmp...") untuk baris baru buatan offline; diganti ID server
    // saat sync + refresh (lihat Outbox.refreshers.wawancara).
    tmpId() {
        try {
            return "tmp" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        } catch { return "tmp" + Math.floor(Math.random() * 1e9); }
    },

    isTmp(id) {
        return typeof id === "string" && String(id).slice(0, 3) === "tmp";
    },

    outboxSiap() {
        try {
            return (typeof Outbox !== "undefined" && Outbox.enqueue && Outbox.daftar && Outbox.hapus)
                ? Outbox : null;
        } catch { return null; }
    },

    jaringanPutus(err) {
        try {
            if (typeof OutboxOffline === "function" && OutboxOffline()) return true;
            if (typeof Outbox !== "undefined" && Outbox.isNetErr) return Outbox.isNetErr(err);
        } catch {}
        try {
            if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
        } catch {}
        return false;
    },

    // Hapus antrean pending modul wawancara untuk target yang sama (gabung).
    async buangAntreanTarget(target) {
        const OB = Wawancara.outboxSiap();
        if (!OB || !target) return;
        try {
            const ops = await OB.daftar();
            for (const o of ops || []) {
                if (o && o.modul === "wawancara" && o.status === "pending"
                    && o.payload && o.payload.target === target) {
                    try { await OB.hapus(o.id); } catch {}
                }
            }
        } catch {}
    },

    async antreTulis(label, payload, files) {
        const OB = Wawancara.outboxSiap();
        if (!OB) throw new Error("Antrean offline belum siap — coba lagi sebentar.");
        if (payload && payload.target) await Wawancara.buangAntreanTarget(payload.target);
        await OB.enqueue({
            modul: "wawancara", op: "create", label: label,
            payload: payload || {}, files: files || [], cacheKeys: [],
        });
        try { if (typeof showToast === "function") showToast("Offline — tersimpan, terkirim otomatis saat online.", "info"); } catch {}
    },

    // Tempel patch ke op tambah-turunan yang masih antre (baris temp).
    async patchTambahTertunda(tmpId, patch) {
        const OB = Wawancara.outboxSiap();
        if (!OB) return false;
        try {
            const ops = await OB.daftar();
            for (const o of ops || []) {
                if (o && o.modul === "wawancara" && o.status === "pending"
                    && o.payload && o.payload.jenis === "turunan_tambah" && o.payload.tmpId === tmpId) {
                    const baru = Object.assign({}, o.payload, patch || {});
                    await Wawancara.buangAntreanTarget(o.payload.target);
                    await OB.enqueue({
                        modul: "wawancara", op: "create", label: o.label,
                        payload: baru, files: [], cacheKeys: [],
                    });
                    return true;
                }
            }
        } catch {}
        return false;
    },

    simpanCacheJawaban() {
        try {
            if (typeof wawancaraCacheSimpan === "function" && Wawancara.sesi) {
                wawancaraCacheSimpan("wawancara_jawaban_" + Wawancara.sesi.id, Wawancara.jawaban || []);
            }
        } catch {}
    },

    simpanCacheTurunan() {
        try {
            if (typeof wawancaraCacheSimpan === "function" && Wawancara.sesi) {
                wawancaraCacheSimpan("wawancara_turunan_" + Wawancara.sesi.id, Wawancara.turunan || []);
            }
        } catch {}
    },

    simpanCacheDokumentasi() {
        try {
            if (typeof wawancaraCacheSimpan === "function" && Wawancara.sesi) {
                wawancaraCacheSimpan("wawancara_dokumentasi_" + Wawancara.sesi.id, Wawancara.dokumentasi || []);
            }
        } catch {}
    },

    async muatDokumentasi() {
        Wawancara.dokumentasi = await getWawancaraDokumentasi(Wawancara.sesi.id);
        // Bersihkan blob pratinjau yang barisnya sudah tidak ada (mis. usai sync).
        try {
            const ada = {};
            (Wawancara.dokumentasi || []).forEach(d => { ada[String(d.id)] = true; });
            Object.keys(Wawancara.dokBlobs || {}).forEach(k => {
                if (!ada[k]) {
                    try { if (Wawancara.dokUrls[k]) URL.revokeObjectURL(Wawancara.dokUrls[k]); } catch {}
                    delete Wawancara.dokBlobs[k];
                    delete Wawancara.dokUrls[k];
                }
            });
        } catch {}
    },

    // URL tampil: blob lokal untuk baris temp offline, R2 untuk sisanya.
    dokUrl(d) {
        if (d && d._tmp) {
            if (!Wawancara.dokUrls[d.id] && Wawancara.dokBlobs[d.id]) {
                try { Wawancara.dokUrls[d.id] = URL.createObjectURL(Wawancara.dokBlobs[d.id]); } catch {}
            }
            return Wawancara.dokUrls[d.id] || "";
        }
        try { return getFoto(d.file_path); } catch { return ""; }
    },

    dokUkuran(b) {
        const n = Number(b) || 0;
        if (!n) return "";
        if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + " KB";
        return (n / (1024 * 1024)).toFixed(1) + " MB";
    },

    // Grid dokumentasi dipakai mode atur (kelola) + hasil (baca saja).
    // Klik = lightbox ala galeri (swipe + autoplay video), bukan buka tab.
    dokGrid(editable) {
        const rows = Wawancara.dokumentasi || [];
        if (!rows.length) return `<div class="osis-empty">Belum ada dokumentasi.</div>`;
        return `<div class="ww-dok-grid">` + rows.map((d, i) => {
            const src = Wawancara.dokUrl(d);
            const isVid = d.file_type === "video";
            const isAud = d.file_type === "audio";
            const media = isAud
                ? `<div class="ww-dok-audio"><i class="fa-solid fa-microphone"></i><audio src="${src}" controls preload="metadata"></audio></div>`
                : isVid
                ? `<span class="ww-dok-thumb" onclick="Wawancara.dokBuka(${i})"><video src="${src}" preload="metadata" playsinline muted></video><span class="vid-play" aria-hidden="true"><i class="fa-solid fa-play"></i></span></span>`
                : `<img src="${src}" alt="" loading="lazy" onclick="Wawancara.dokBuka(${i})">`;
            const labelBawaan = isAud ? "Rekaman suara" : isVid ? "Video" : "Foto";
            return `<div class="ww-dok-item">
                ${media}
                ${d._tmp ? `<span class="ww-dok-pending">menunggu kirim</span>` : ""}
                <div class="ww-dok-ket">${escapeHtml(d.keterangan || labelBawaan)}</div>
                <div class="ww-dok-meta">${escapeHtml(Wawancara.dokUkuran(d.ukuran_bytes))}${d.ukuran_bytes && d.pengunggah ? " · " : ""}${escapeHtml(d.pengunggah || "")}</div>
                ${editable ? `<button class="icon-btn icon-btn-sm ww-dok-hapus" title="Hapus" onclick="Wawancara.dokHapus(${typeof d.id === "number" ? d.id : `'${d.id}'`})"><i class="fa-solid fa-trash"></i></button>` : ""}
            </div>`;
        }).join("") + `</div>`;
    },

    // ============ LIGHTBOX DOKUMENTASI (visual ikut galeri/arsip) ============
    dokGaleri() {
        return (Wawancara.dokumentasi || []).map(d => ({
            id: d.id,
            src: Wawancara.dokUrl(d),
            isVid: d.file_type === "video",
            isAud: d.file_type === "audio",
            judul: d.keterangan || (d.file_type === "video" ? "Video" : d.file_type === "audio" ? "Rekaman suara" : "Foto"),
            oleh: d.pengunggah || "",
        }));
    },

    dokLightboxBuka() {
        return !!document.querySelector("#wwDokModal");
    },

    dokMediaHtml(item) {
        if (item.isVid) {
            return `<video src="${item.src}" controls playsinline preload="metadata"></video>`;
        }
        if (item.isAud) {
            return `<div class="ww-dok-audio ww-dok-audio-pop"><i class="fa-solid fa-microphone"></i><audio src="${item.src}" controls preload="metadata" style="width:100%"></audio></div>`;
        }
        return `<span class="media-muat media-muat-tinggi" style="width:100%"><img src="${item.src}" alt="" draggable="false" onload="this.closest('.media-muat').classList.add('sudah-muat')" onerror="this.closest('.media-muat').classList.add('sudah-muat')"><span class="media-muat-loading" aria-hidden="true"><span class="spinner"></span></span></span>`;
    },

    dokPutar(modal) {
        const v = modal ? modal.querySelector(".foto-pop video") : null;
        if (!v) return;
        try {
            v.muted = false;
            const p = v.play();
            if (p && p.catch) p.catch(() => { try { v.muted = true; v.play().catch(() => {}); } catch {} });
        } catch {}
    },

    dokBuka(i) {
        const galeri = Wawancara.dokGaleri();
        if (!galeri.length) return;
        Wawancara.dokTutup(true);
        const idx = Math.max(0, Math.min(i || 0, galeri.length - 1));
        Wawancara._dokIdx = idx;
        const item = galeri[idx];
        const nama = Wawancara.calonAktif ? (Wawancara.calonAktif.nama || "") : "";
        const multi = galeri.length > 1;
        const modal = document.createElement("div");
        modal.id = "wwDokModal";
        modal.className = "struktur-modal foto-modal";
        try { modal.dataset.seq = String((window.__seqModal = (window.__seqModal || 0) + 1)); } catch {}
        modal.innerHTML = `
            <div class="struktur-modal-bg"></div>
            <div class="struktur-modal-box foto-only">
                <div class="struktur-head">
                    <h4>${escapeHtml(nama || "Dokumentasi")}${multi ? ` <span class="ww-dok-count">${idx + 1} / ${galeri.length}</span>` : ""}</h4>
                    <button class="struktur-close" type="button">&times;</button>
                </div>
                <div class="foto-pop">
                    <div class="foto-media" style="width:100%">${Wawancara.dokMediaHtml(item)}</div>
                    <div class="foto-oleh"${item.oleh ? "" : ` style="display:none"`}>${item.oleh ? "Diupload oleh " + escapeHtml(item.oleh) : ""}</div>
                    ${item.judul ? `<div class="foto-caption"><span class="foto-caption-pill">${escapeHtml(item.judul)}</span></div>` : ""}
                </div>
                ${multi ? `<button class="ww-dok-prev" type="button" title="Sebelumnya">‹</button>
                <button class="ww-dok-next" type="button" title="Berikutnya">›</button>` : ""}
            </div>`;
        modal.querySelector(".struktur-modal-bg").addEventListener("click", () => Wawancara.dokTutup());
        modal.querySelector(".struktur-close").addEventListener("click", () => Wawancara.dokTutup());
        const prev = modal.querySelector(".ww-dok-prev");
        const next = modal.querySelector(".ww-dok-next");
        if (prev) prev.addEventListener("click", (e) => { e.stopPropagation(); Wawancara.dokGeser(-1); });
        if (next) next.addEventListener("click", (e) => { e.stopPropagation(); Wawancara.dokGeser(1); });
        // Swipe sentuh: geser horizontal dominan = pindah foto.
        try {
            let sx = 0, sy = 0, track = false;
            const pop = modal.querySelector(".foto-pop");
            if (pop && multi) {
                pop.addEventListener("touchstart", (e) => {
                    const t = e.touches && e.touches[0];
                    if (!t) return;
                    track = true; sx = t.clientX; sy = t.clientY;
                }, { passive: true });
                pop.addEventListener("touchend", (e) => {
                    if (!track) return;
                    track = false;
                    const t = e.changedTouches && e.changedTouches[0];
                    if (!t) return;
                    const dx = t.clientX - sx, dy = t.clientY - sy;
                    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) {
                        Wawancara.dokGeser(dx < 0 ? 1 : -1);
                    }
                });
            }
        } catch {}
        document.body.appendChild(modal);
        document.body.style.overflow = "hidden";
        Wawancara.dokPutar(modal);
        try { history.pushState({ wwdok: true }, ""); Wawancara._dokPush = true; }
        catch { Wawancara._dokPush = false; }
    },

    dokGeser(arah) {
        const galeri = Wawancara.dokGaleri();
        if (galeri.length < 2) return;
        const modal = document.getElementById("wwDokModal");
        if (!modal) return;
        Wawancara._dokIdx = (((Wawancara._dokIdx || 0) + arah) % galeri.length + galeri.length) % galeri.length;
        const item = galeri[Wawancara._dokIdx];
        try { modal.querySelectorAll("video").forEach(v => v.pause()); } catch {}
        const mediaWrap = modal.querySelector(".foto-pop .foto-media");
        if (mediaWrap) {
            mediaWrap.innerHTML = Wawancara.dokMediaHtml(item);
            Wawancara.dokPutar(modal);
        }
        const olehEl = modal.querySelector(".foto-oleh");
        if (olehEl) {
            olehEl.style.display = item.oleh ? "" : "none";
            olehEl.textContent = item.oleh ? "Diupload oleh " + item.oleh : "";
        }
        const capEl = modal.querySelector(".foto-caption-pill");
        if (capEl) capEl.textContent = item.judul || "";
        const cnt = modal.querySelector(".struktur-head .ww-dok-count");
        if (cnt) cnt.textContent = (Wawancara._dokIdx + 1) + " / " + galeri.length;
    },

    dokTutup(dariBack) {
        const modal = document.getElementById("wwDokModal");
        // Guard tutup ganda (double-tap X): tanpa ini history.back() jalan
        // 2x untuk 1 push → riwayat geser.
        if (modal && !modal._wwTutup) {
            modal._wwTutup = true;
            try { modal.querySelectorAll("video").forEach(v => v.pause()); } catch {}
            modal.classList.add("tutup");
            setTimeout(() => { try { if (modal.parentNode) modal.remove(); } catch {} }, 200);
        }
        Wawancara._dokIdx = 0;
        if (!document.querySelector(".struktur-modal")) {
            try { document.body.style.overflow = ""; } catch {}
        }
        if (!dariBack && Wawancara._dokPush) {
            Wawancara._dokPush = false;
            try {
                window.__abaikanBack = (window.__abaikanBack | 0) + 1;
                history.back();
            } catch { window.__abaikanBack--; }
        } else {
            Wawancara._dokPush = false;
        }
    },

    kunciDraft(textarea) {
        if (textarea.id === "wwCatatan") return `ww_draft_${Wawancara.sesi.id}_catatan`;
        if (textarea.dataset.ttid) return `ww_draft_${Wawancara.sesi.id}_t${textarea.dataset.ttid}`;
        return `ww_draft_${Wawancara.sesi.id}_${textarea.dataset.qid || "?"}_${textarea.dataset.jid || "baru"}`;
    },

    pasangAutosave() {
        // Grow-as-you-type biar nyaman dipakai saat wawancara.
        const grow = (el) => {
            try {
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 420) + "px";
            } catch {}
        };
        document.querySelectorAll("#wwDetail textarea.ww-jawab").forEach(el => {
            grow(el);
            // Pulihkan draft lokal bila server kosong (mis. sempat offline).
            try {
                const d = localStorage.getItem(Wawancara.kunciDraft(el));
                if (d !== null && d !== "" && !String(el.value || "").trim()) {
                    el.value = d;
                    grow(el);
                }
            } catch {}
            el.addEventListener("input", () => {
                grow(el);
                Wawancara.antreSimpan(el);
            });
            // Mode wawancara: Enter = lanjut soal berikut (Shift+Enter = baris baru).
            el.addEventListener("keydown", (e) => {
                if (e.key !== "Enter" || e.shiftKey) return;
                if (Wawancara.mode !== "wawancara" || !Wawancara.sesi) return;
                if (el.disabled) return;
                e.preventDefault();
                Wawancara.enterNext(el);
            });
        });
        document.querySelectorAll("#wwDetail input.ww-spontan-teks").forEach(el => {
            el.addEventListener("input", () => {
                const wrap = el.closest(".ww-spontan, .ww-spontan-atur, .ww-atur-row");
                const area = wrap ? wrap.querySelector(".ww-spontan-jawab") : null;
                if (area) {
                    Wawancara.antreSimpan(area, el.value);
                } else {
                    const jid = el.dataset.jid ? parseInt(el.dataset.jid, 10) : null;
                    if (jid) Wawancara.antreSpontanTeks(jid, el.value);
                }
            });
        });
    },

    // Simpan teks pertanyaan spontan di mode atur (tanpa mengubah jawabannya).
    antreSpontanTeks(jid, teks) {
        if (!Wawancara.sesi || !Wawancara.bolehTulisSesi()) return;
        if (!String(teks || "").trim()) return;
        Wawancara.setPill("simpan");
        clearTimeout(Wawancara.timerSimpan["st" + jid]);
        Wawancara.timerSimpan["st" + jid] = setTimeout(async () => {
            try {
                const row = (Wawancara.jawaban || []).find(j => String(j.id) === String(jid));
                const jidKirim = Wawancara.isTmp(jid) ? null : jid;
                await wawancaraJawabanSimpan(Wawancara.uid(), Wawancara.sesi.id, {
                    spontan: true, jawabanId: jidKirim,
                    pertanyaanTeks: teks, jawabanTeks: row ? (row.jawaban_teks || "") : "",
                });
                if (row) row.pertanyaan_teks = teks;
                Wawancara.simpanCacheJawaban();
                Wawancara.setPill("ok");
            } catch (err) {
                if (Wawancara.jaringanPutus(err) && Wawancara.outboxSiap()) {
                    const sesiId = Wawancara.sesi.id;
                    const row = (Wawancara.jawaban || []).find(j => String(j.id) === String(jid));
                    if (row) {
                        row.pertanyaan_teks = teks;
                        Wawancara.simpanCacheJawaban();
                    }
                    try {
                        await Wawancara.antreTulis("Teks spontan", {
                            jenis: "jawaban", target: "ww-j:" + sesiId + ":s" + jid,
                            sesiId: sesiId, spontan: true, jawabanId: jid,
                            pertanyaanTeks: teks, jawabanTeks: row ? (row.jawaban_teks || "") : "",
                        });
                    } catch (e2) {
                        console.error(e2);
                        Wawancara.setPill("gagal");
                        return;
                    }
                    Wawancara.setPill("lokal");
                    return;
                }
                console.error(err);
                Wawancara.setPill("gagal");
                try { if (typeof showToast === "function") showToast("Gagal menyimpan: " + (err.message || err), "error"); } catch {}
            }
        }, 800);
    },

    // Enter di mode wawancara: simpan jawaban sekarang juga lalu next.
    // (Debounce biasa tidak ditunggu biar teks tidak hilang saat pindah.)
    async enterNext(textarea) {
        if (!Wawancara.sesi || !Wawancara.bolehTulisSesi()) { Wawancara.geserLangkah(1); return; }
        try { localStorage.setItem(Wawancara.kunciDraft(textarea), textarea.value); } catch {}
        Wawancara.setPill("simpan");
        try {
            await Wawancara.eksekusiSimpan(textarea);
        } catch (err) {
            console.error(err);
            Wawancara.setPill("gagal");
            try { if (typeof showToast === "function") showToast("Gagal menyimpan: " + (err.message || err), "error"); } catch {}
            return;
        }
        Wawancara.geserLangkah(1);
    },

    kunciUntuk(textarea) {
        return textarea.id === "wwCatatan" ? "catatan"
            : textarea.dataset.ttid ? `t${textarea.dataset.ttid}`
            : `j${textarea.dataset.qid}_${textarea.dataset.jid || "baru"}`;
    },

    antreSimpan(textarea, teksSpontanOverride) {
        if (!Wawancara.sesi || !Wawancara.bolehTulisSesi()) return;
        // Backup lokal dulu (progres tidak hilang walau offline).
        try { localStorage.setItem(Wawancara.kunciDraft(textarea), textarea.value); } catch {}
        Wawancara.setPill("simpan");
        const kunci = Wawancara.kunciUntuk(textarea);
        clearTimeout(Wawancara.timerSimpan[kunci]);
        Wawancara.timerSimpan[kunci] = setTimeout(() => {
            Wawancara.eksekusiSimpan(textarea, teksSpontanOverride).catch(() => {});
        }, 800);
    },

    // Isi simpan autosave (dipakai debounce antreSimpan + instan enterNext).
    // Offline (putus jaringan + Outbox siap) -> antre snapshot + update lokal,
    // lalu return normal (tanpa throw) agar enterNext tetap pindah soal.
    async eksekusiSimpan(textarea, teksSpontanOverride) {
        if (!Wawancara.sesi || !Wawancara.bolehTulisSesi()) return;
        const sesiId = Wawancara.sesi.id;
        const kunci = Wawancara.kunciUntuk(textarea);
        clearTimeout(Wawancara.timerSimpan[kunci]);
        try {
            const uid = Wawancara.uid();
            if (textarea.id === "wwCatatan") {
                await wawancaraSesiCatatan(uid, sesiId, textarea.value);
                Wawancara.sesi.catatan_akhir = textarea.value;
            } else if (textarea.dataset.ttid) {
                // Jawaban turunan sesi (menempel di baris turunannya).
                const tidRaw = textarea.dataset.ttid;
                const tid = Wawancara.isTmp(tidRaw) ? tidRaw : parseInt(tidRaw, 10);
                await wawancaraTurunanSimpan(uid, tid, null, textarea.value);
                const row = (Wawancara.turunan || []).find(t => String(t.id) === String(tid));
                if (row) row.jawaban_teks = textarea.value;
                Wawancara.simpanCacheTurunan();
            } else if (textarea.dataset.qid === "spontan") {
                const wrap = textarea.closest(".ww-spontan, .ww-spontan-atur, .ww-atur-row");
                const inp = wrap ? wrap.querySelector(".ww-spontan-teks") : null;
                const teks = teksSpontanOverride !== undefined ? teksSpontanOverride : (inp ? inp.value : "");
                const jidRaw = textarea.dataset.jid || null;
                const jid = (jidRaw && !Wawancara.isTmp(jidRaw)) ? parseInt(jidRaw, 10) : null;
                if (!String(teks || "").trim()) {
                    Wawancara.setPill("ok");
                    return; // pertanyaan spontan wajib ada teksnya
                }
                const idBaru = await wawancaraJawabanSimpan(uid, sesiId, {
                    spontan: true, jawabanId: jid, pertanyaanTeks: teks, jawabanTeks: textarea.value,
                });
                textarea.dataset.jid = String(idBaru);
                await Wawancara.segarkanJawaban(false);
            } else {
                const qid = parseInt(textarea.dataset.qid, 10);
                const jidRaw = textarea.dataset.jid || null;
                const jid = (jidRaw && !Wawancara.isTmp(jidRaw)) ? parseInt(jidRaw, 10) : null;
                const idBaru = await wawancaraJawabanSimpan(uid, sesiId, {
                    pertanyaanId: qid, jawabanId: jid, jawabanTeks: textarea.value,
                });
                textarea.dataset.jid = String(idBaru);
                await Wawancara.segarkanJawaban(false);
            }
            try { localStorage.removeItem(Wawancara.kunciDraft(textarea)); } catch {}
            Wawancara.setPill("ok");
            Wawancara.updateNavProgress();
        } catch (err) {
            if (Wawancara.jaringanPutus(err) && Wawancara.outboxSiap()) {
                await Wawancara.simpanOffline(textarea, teksSpontanOverride);
                return;
            }
            console.error(err);
            Wawancara.setPill("gagal");
            try { if (typeof showToast === "function") showToast("Gagal menyimpan: " + (err.message || err), "error"); } catch {}
            throw err;
        }
    },

    // Jalur offline eksekusiSimpan: snapshot penuh + update lokal optimistis.
    async simpanOffline(textarea, teksSpontanOverride) {
        const sesiId = Wawancara.sesi.id;
        if (textarea.id === "wwCatatan") {
            Wawancara.sesi.catatan_akhir = textarea.value;
            await Wawancara.antreTulis("Catatan akhir (" + (Wawancara.calonAktif ? Wawancara.calonAktif.nama : "") + ")", {
                jenis: "catatan", target: "ww-c:" + sesiId,
                sesiId: sesiId, catatan: textarea.value,
            });
        } else if (textarea.dataset.ttid) {
            const tid = String(textarea.dataset.ttid);
            const row = (Wawancara.turunan || []).find(t => String(t.id) === tid);
            if (row) row.jawaban_teks = textarea.value;
            Wawancara.simpanCacheTurunan();
            if (Wawancara.isTmp(tid)) {
                // Baris temp: gabung ke op tambah yang masih antre.
                if (!(await Wawancara.patchTambahTertunda(tid, { jawaban: textarea.value }))) {
                    await Wawancara.antreTulis("Jawaban turunan", {
                        jenis: "turunan_tambah", target: "ww-t:" + sesiId + ":" + tid, tmpId: tid,
                        sesiId: sesiId, parentId: row ? row.parent_id : null,
                        teks: row ? (row.teks || "") : "", jawaban: textarea.value,
                    });
                }
            } else {
                await Wawancara.antreTulis("Jawaban turunan", {
                    jenis: "turunan_jawab", target: "ww-t:" + sesiId + ":" + tid,
                    id: parseInt(tid, 10), jawaban: textarea.value,
                });
            }
        } else if (textarea.dataset.qid === "spontan") {
            const wrap = textarea.closest(".ww-spontan, .ww-spontan-atur, .ww-atur-row");
            const inp = wrap ? wrap.querySelector(".ww-spontan-teks") : null;
            const teks = teksSpontanOverride !== undefined ? teksSpontanOverride : (inp ? inp.value : "");
            if (!String(teks || "").trim()) {
                Wawancara.setPill("ok");
                return;
            }
            let jid = textarea.dataset.jid || Wawancara.tmpId();
            textarea.dataset.jid = String(jid);
            let row = (Wawancara.jawaban || []).find(j => String(j.id) === String(jid));
            if (!row) {
                row = { id: jid, sesi_id: sesiId, calon_id: Wawancara.sesi.calon_id,
                    pertanyaan_id: null, pertanyaan_teks: teks, jawaban_teks: "",
                    is_spontan: true, _tmp: true };
                Wawancara.jawaban.push(row);
            }
            row.pertanyaan_teks = teks;
            row.jawaban_teks = textarea.value;
            Wawancara.simpanCacheJawaban();
            await Wawancara.antreTulis("Jawaban spontan", {
                jenis: "jawaban", target: "ww-j:" + sesiId + ":s" + jid,
                sesiId: sesiId, spontan: true, jawabanId: jid,
                pertanyaanTeks: teks, jawabanTeks: textarea.value,
            });
        } else {
            const qid = parseInt(textarea.dataset.qid, 10);
            const jidRaw = textarea.dataset.jid || null;
            const jid = (jidRaw && !Wawancara.isTmp(jidRaw)) ? parseInt(jidRaw, 10) : null;
            let row = (Wawancara.jawaban || []).find(j => !j.is_spontan && String(j.pertanyaan_id) === String(qid));
            if (!row) {
                row = { id: jid || ("tmpj" + qid), sesi_id: sesiId, calon_id: Wawancara.sesi.calon_id,
                    pertanyaan_id: qid, pertanyaan_teks: "", jawaban_teks: "", is_spontan: false };
                Wawancara.jawaban.push(row);
            }
            row.jawaban_teks = textarea.value;
            Wawancara.simpanCacheJawaban();
            await Wawancara.antreTulis("Jawaban pertanyaan", {
                jenis: "jawaban", target: "ww-j:" + sesiId + ":q" + qid,
                sesiId: sesiId, spontan: false, pertanyaanId: qid,
                jawabanId: jid, jawabanTeks: textarea.value,
            });
        }
        try { localStorage.removeItem(Wawancara.kunciDraft(textarea)); } catch {}
        Wawancara.setPill("lokal");
        Wawancara.updateNavProgress();
    },

    // Ambil ulang jawaban dari server TANPA render ulang (jaga fokus mengetik).
    async segarkanJawaban(renderUlang) {
        try {
            Wawancara.jawaban = await getWawancaraJawaban(Wawancara.sesi.id);
            const freshSesi = await getWawancaraSesi();
            const s = (freshSesi || []).find(x => String(x.id) === String(Wawancara.sesi.id));
            if (s) { Wawancara.sesi = s; Wawancara.sesiSemua = freshSesi; }
            if (renderUlang) Wawancara.renderSesi();
        } catch {}
    },

    // ================= STATUS & PETUGAS =================
    async aturStatus(status) {
        const s = Wawancara.sesi;
        if (!s) return;
        const label = status === "selesai" ? "Selesaikan wawancara? Hasil jadi read-only."
            : status === "belum" ? "Stop wawancara? Status kembali ke Belum dimulai (jawaban tetap tersimpan)."
            : (s.status === "selesai" ? "Buka kembali wawancara?" : "Mulai wawancara sekarang?");
        try {
            if (typeof showPopup === "function") {
                if (!(await showPopup(label, "confirm"))) return;
            }
        } catch {}
        try {
            await wawancaraSesiStatus(Wawancara.uid(), s.id, status);
            try { if (typeof showToast === "function") showToast(status === "selesai" ? "Wawancara selesai." : status === "belum" ? "Wawancara di-stop." : "Wawancara dimulai.", "success"); } catch {}
            try { if (typeof catatAksi === "function") catatAksi("wawancara_status_" + status, "calon #" + Wawancara.calonAktif.id); } catch {}
            Wawancara.jawaban = await getWawancaraJawaban(s.id);
            const fresh = await getWawancaraSesi();
            Wawancara.sesiSemua = fresh || [];
            Wawancara.sesi = (fresh || []).find(x => String(x.id) === String(s.id)) || s;
            Wawancara.sesi.status = status;
            if (status === "berlangsung") {
                Wawancara.mode = "wawancara";
                Wawancara.idx = Wawancara.idxPertamaKosong();
            } else if (status === "selesai") {
                Wawancara.mode = "hasil";
            } else {
                Wawancara.mode = "atur";
            }
            Wawancara.renderSesi();
        } catch (err) {
            try { if (typeof showToast === "function") showToast("Gagal: " + (err.message || err), "error"); } catch {}
        }
    },

    // Satu baris dropdown pewawancara (dipakai mode atur + popup calon).
    pewRowHtml(terpilih, bisaUbah) {
        return `<div class="field ww-pew-row" style="display:flex;gap:8px;align-items:flex-end;margin-bottom:8px">
            <div style="flex:1;min-width:0;margin-bottom:0" class="field"><label>Pewawancara</label>
                <select class="admin-input ww-pew-sel" ${bisaUbah ? "" : "disabled"}>${Wawancara.opsiSenior(terpilih)}</select></div>
            ${bisaUbah ? `<button class="icon-btn" title="Hapus baris ini" onclick="Wawancara.hapusPewRow(this)"><i class="fa-solid fa-xmark"></i></button>` : ""}
        </div>`;
    },

    // Ambil semua id unik dari barisan dropdown dalam container.
    kumpulPewIds(akar) {
        const ids = [];
        (akar || document).querySelectorAll(".ww-pew-sel").forEach(el => {
            const v = el && el.value ? parseInt(el.value, 10) : null;
            if (Number.isFinite(v) && !ids.includes(v)) ids.push(v);
        });
        return ids;
    },

    tambahPewRow(keId) {
        const list = document.getElementById(keId || "wwPewList");
        if (!list) return;
        list.insertAdjacentHTML("beforeend", Wawancara.pewRowHtml(null, true));
        list.lastElementChild?.querySelector("select")?.focus();
    },

    hapusPewRow(btn) {
        const row = btn && btn.closest ? btn.closest(".ww-pew-row") : null;
        if (!row || !row.parentElement) return;
        const list = row.parentElement;
        if (list.querySelectorAll(".ww-pew-row").length <= 1) {
            const sel = row.querySelector("select");
            if (sel) sel.value = "";
            return;
        }
        row.remove();
    },

    async simpanPetugas() {
        const s = Wawancara.sesi;
        if (!s) return;
        const ids = Wawancara.kumpulPewIds(document.getElementById("wwPewList") || document);
        if (!ids.length) {
            try { if (typeof showToast === "function") showToast("Pilih minimal satu pewawancara.", "error"); } catch {}
            return;
        }
        try {
            await wawancaraSesiPetugas(Wawancara.uid(), s.id, ids);
            Wawancara.petugas = (Wawancara.petugas || []).filter(r => String(r.sesi_id) !== String(s.id))
                .concat(ids.map(uid => ({ sesi_id: s.id, user_id: uid })));
            Wawancara.sesi.pewawancara1_id = ids[0] || null;
            Wawancara.sesi.pewawancara2_id = ids[1] || null;
            try { if (typeof showToast === "function") showToast(`Pewawancara disimpan (${ids.length} orang).`, "success"); } catch {}
            Wawancara.renderSesi();
        } catch (err) {
            try { if (typeof showToast === "function") showToast("Gagal: " + (err.message || err), "error"); } catch {}
        }
    },

    // ================= SPONTAN =================
    async tambahSpontan() {
        const uid = Wawancara.uid();
        const s = Wawancara.sesi;
        if (!uid || !s) return;
        const sBaru = async (idBaru) => {
            if (Wawancara.mode === "wawancara") {
                const ur = Wawancara.bangunUrutan();
                const i = ur.findIndex(x => x.kind === "spontan" && String(x.j.id) === String(idBaru));
                if (i >= 0) Wawancara.idx = i;
            }
            Wawancara.renderSesi();
            // Fokus ke TEKS pertanyaan spontan yang baru (biar langsung diedit).
            const inp = document.querySelector(`#wwDetail input.ww-spontan-teks[data-jid="${idBaru}"]`);
            if (inp) { inp.focus(); inp.select(); return; }
            const area = document.querySelector(`#wwDetail textarea[data-jid="${idBaru}"]`);
            if (area) area.focus();
        };
        // Offline: baris temp lokal + antre snapshot (ID server menyusul).
        if (Wawancara.jaringanPutus() && Wawancara.outboxSiap()) {
            await Wawancara.tambahSpontanOffline(s, sBaru);
            return;
        }
        try {
            const idBaru = await wawancaraJawabanSimpan(uid, s.id, {
                spontan: true, pertanyaanTeks: "Pertanyaan spontan", jawabanTeks: "",
            });
            Wawancara.jawaban = await getWawancaraJawaban(s.id);
            await sBaru(idBaru);
        } catch (err) {
            if (Wawancara.jaringanPutus(err) && Wawancara.outboxSiap()) {
                await Wawancara.tambahSpontanOffline(s, sBaru);
                return;
            }
            try { if (typeof showToast === "function") showToast("Gagal: " + (err.message || err), "error"); } catch {}
        }
    },

    async tambahSpontanOffline(s, sBaru) {
        try {
            const tmp = Wawancara.tmpId();
            Wawancara.jawaban.push({ id: tmp, sesi_id: s.id, calon_id: s.calon_id,
                pertanyaan_id: null, pertanyaan_teks: "Pertanyaan spontan",
                jawaban_teks: "", is_spontan: true, _tmp: true });
            Wawancara.simpanCacheJawaban();
            await Wawancara.antreTulis("Spontan baru", {
                jenis: "jawaban", target: "ww-j:" + s.id + ":s" + tmp,
                sesiId: s.id, spontan: true, jawabanId: tmp,
                pertanyaanTeks: "Pertanyaan spontan", jawabanTeks: "",
            });
            Wawancara.setPill("lokal");
            await sBaru(tmp);
        } catch (err) {
            console.error(err);
            try { if (typeof showToast === "function") showToast("Gagal: " + (err.message || err), "error"); } catch {}
        }
    },

    async hapusSpontan(jawabanId) {
        try {
            if (typeof showPopup === "function") {
                if (!(await showPopup("Hapus pertanyaan spontan ini beserta jawabannya?", "confirm"))) return;
            }
        } catch {}
        const jid = String(jawabanId);
        // Offline: hapus lokal + antre penghapusan (temp: cukup buang antreannya).
        if (Wawancara.jaringanPutus() && Wawancara.outboxSiap()) {
            try {
                await Wawancara.buangAntreanTarget("ww-j:" + Wawancara.sesi.id + ":s" + jid);
                Wawancara.jawaban = (Wawancara.jawaban || []).filter(j => String(j.id) !== jid);
                Wawancara.simpanCacheJawaban();
                if (!Wawancara.isTmp(jid)) {
                    await Wawancara.antreTulis("Hapus spontan", {
                        jenis: "spontan_hapus", target: "ww-x:" + Wawancara.sesi.id + ":s" + jid,
                        jawabanId: parseInt(jid, 10),
                    });
                }
                Wawancara.setPill("lokal");
                Wawancara.renderSesi();
            } catch (err) {
                console.error(err);
                try { if (typeof showToast === "function") showToast("Gagal: " + (err.message || err), "error"); } catch {}
            }
            return;
        }
        try {
            await wawancaraSpontanHapus(Wawancara.uid(), jawabanId);
            Wawancara.jawaban = await getWawancaraJawaban(Wawancara.sesi.id);
            Wawancara.renderSesi();
        } catch (err) {
            try { if (typeof showToast === "function") showToast("Gagal: " + (err.message || err), "error"); } catch {}
        }
    },

    // Tambah turunan langsung di mode wawancara: baris ww-tanya editable
    // muncul seketika (tanpa popup), Simpan = persist, Batal = buang.
    tambahTurunanLangsung(utamaId) {
        if (!Wawancara.bolehKelola() && !Wawancara.bolehTulisSesi()) return;
        if (Wawancara.sesi && Wawancara.sesi.status === "selesai") return;
        if (document.getElementById("wwTurunanBaru")) {
            document.getElementById("wwTurunanTeks")?.focus();
            return;
        }
        const anchor = document.getElementById("wwTurunanAnchor");
        if (!anchor) return;
        const div = document.createElement("div");
        div.className = "ww-anak";
        div.id = "wwTurunanBaru";
        div.innerHTML = `
            <div class="ww-tanya"><span class="ww-nomor ww-nomor-anak">⤷</span>
                <input type="text" id="wwTurunanTeks" class="admin-input" maxlength="500" placeholder="Tulis pertanyaan turunan..." autocomplete="off">
            </div>
            <div style="display:flex;gap:8px;margin-top:8px">
                <button class="btn btn-red btn-sm" id="wwTurunanSimpan"><i class="fa-solid fa-check"></i> Simpan</button>
                <button class="btn btn-white btn-sm" id="wwTurunanBatal">Batal</button>
            </div>`;
        anchor.appendChild(div);
        const inp = document.getElementById("wwTurunanTeks");
        if (inp) {
            inp.focus();
            inp.addEventListener("keydown", (e) => {
                if (e.key === "Enter") Wawancara.simpanTurunanLangsung(utamaId);
            });
        }
        document.getElementById("wwTurunanSimpan").onclick = () => Wawancara.simpanTurunanLangsung(utamaId);
        document.getElementById("wwTurunanBatal").onclick = () => {
            const el = document.getElementById("wwTurunanBaru");
            if (el) el.remove();
        };
    },

    async simpanTurunanLangsung(utamaId) {
        const inp = document.getElementById("wwTurunanTeks");
        const teks = inp ? inp.value.trim() : "";
        if (!teks) {
            try { if (typeof showToast === "function") showToast("Isi pertanyaan dulu.", "error"); } catch {}
            if (inp) inp.focus();
            return;
        }
        if (Wawancara.jaringanPutus() && Wawancara.outboxSiap()) {
            await Wawancara.turunanTambahOffline(utamaId, teks);
            return;
        }
        try {
            await wawancaraTurunanTambah(Wawancara.uid(), Wawancara.sesi.id, utamaId, teks);
            try { if (typeof showToast === "function") showToast("Turunan ditambah.", "success"); } catch {}
            await Wawancara.muatTurunan();
            Wawancara.renderSesi(); // idx tetap: turunan gabung satu layar
        } catch (err) {
            if (Wawancara.jaringanPutus(err) && Wawancara.outboxSiap()) {
                await Wawancara.turunanTambahOffline(utamaId, teks);
                return;
            }
            try { if (typeof showToast === "function") showToast("Gagal: " + (err.message || err), "error"); } catch {}
        }
    },

    // Jalur offline tambah turunan: baris temp lokal + antre (gabung jawaban).
    async turunanTambahOffline(utamaId, teks) {
        try {
            const s = Wawancara.sesi;
            const tmp = Wawancara.tmpId();
            const maxUrut = (Wawancara.turunan || [])
                .filter(t => String(t.parent_id) === String(utamaId))
                .reduce((a, t) => Math.max(a, t.urutan || 0), 0);
            Wawancara.turunan.push({ id: tmp, sesi_id: s.id, calon_id: s.calon_id,
                parent_id: utamaId, teks: teks, jawaban_teks: "", urutan: maxUrut + 10,
                _tmp: true });
            Wawancara.simpanCacheTurunan();
            await Wawancara.antreTulis("Turunan baru", {
                jenis: "turunan_tambah", target: "ww-t:" + s.id + ":" + tmp, tmpId: tmp,
                sesiId: s.id, parentId: utamaId, teks: teks, jawaban: "",
            });
            Wawancara.setPill("lokal");
            Wawancara.renderSesi();
        } catch (err) {
            console.error(err);
            try { if (typeof showToast === "function") showToast("Gagal: " + (err.message || err), "error"); } catch {}
        }
    },

    // Tambah turunan sesi dari mode atur via popup form standar.
    async formTurunan(parentId) {
        if (!Wawancara.bolehKelola() && !Wawancara.bolehTulisSesi()) return;
        if (Wawancara.sesi && Wawancara.sesi.status === "selesai") return;
        let v = null;
        try {
            if (typeof showPopup !== "function") return;
            v = await showPopup("Tambah pertanyaan turunan", "form", {
                title: "Turunan Baru",
                fields: [{ name: "teks", label: "Pertanyaan", type: "text", value: "" }],
            });
        } catch { return; }
        if (v == null) return; // batal
        const teks = String(v).trim();
        if (!teks) return;
        if (Wawancara.jaringanPutus() && Wawancara.outboxSiap()) {
            await Wawancara.turunanTambahOffline(parentId, teks);
            return;
        }
        try {
            await wawancaraTurunanTambah(Wawancara.uid(), Wawancara.sesi.id, parentId, teks);
            try { if (typeof showToast === "function") showToast("Turunan ditambah.", "success"); } catch {}
            await Wawancara.muatTurunan();
            Wawancara.renderSesi();
        } catch (err) {
            if (Wawancara.jaringanPutus(err) && Wawancara.outboxSiap()) {
                await Wawancara.turunanTambahOffline(parentId, teks);
                return;
            }
            try { if (typeof showToast === "function") showToast("Gagal: " + (err.message || err), "error"); } catch {}
        }
    },

    // Edit teks turunan sesi via popup form standar (konsisten popup lain).
    async editTurunan(id) {
        if (!Wawancara.bolehKelola() && !Wawancara.bolehTulisSesi()) return;
        if (Wawancara.sesi && Wawancara.sesi.status === "selesai") return;
        const t = (Wawancara.turunan || []).find(x => String(x.id) === String(id));
        if (!t) return;
        let v = null;
        try {
            if (typeof showPopup !== "function") return;
            v = await showPopup("Edit pertanyaan turunan", "form", {
                title: "Edit Turunan",
                fields: [{ name: "teks", label: "Pertanyaan", type: "text", value: t.teks || "" }],
            });
        } catch { return; }
        if (v == null) return; // batal
        const teks = String(v).trim();
        if (!teks || teks === t.teks) return;
        // Offline: update lokal + antre (temp: gabung ke op tambah tertunda).
        if (Wawancara.jaringanPutus() && Wawancara.outboxSiap()) {
            try {
                t.teks = teks;
                Wawancara.simpanCacheTurunan();
                if (Wawancara.isTmp(t.id)) {
                    await Wawancara.patchTambahTertunda(String(t.id), { teks: teks });
                } else {
                    await Wawancara.antreTulis("Edit turunan", {
                        jenis: "turunan_teks", target: "ww-t:" + Wawancara.sesi.id + ":" + t.id,
                        id: t.id, teks: teks,
                    });
                }
                Wawancara.setPill("lokal");
                Wawancara.renderSesi();
            } catch (err) {
                console.error(err);
                try { if (typeof showToast === "function") showToast("Gagal: " + (err.message || err), "error"); } catch {}
            }
            return;
        }
        try {
            await wawancaraTurunanSimpan(Wawancara.uid(), t.id, teks, null);
            try { if (typeof showToast === "function") showToast("Turunan diperbarui.", "success"); } catch {}
            await Wawancara.muatTurunan();
            Wawancara.renderSesi();
        } catch (err) {
            try { if (typeof showToast === "function") showToast("Gagal: " + (err.message || err), "error"); } catch {}
        }
    },

    async hapusTurunan(id) {
        if (!Wawancara.bolehKelola() && !Wawancara.bolehTulisSesi()) return;
        if (Wawancara.sesi && Wawancara.sesi.status === "selesai") return;
        try {
            if (typeof showPopup === "function") {
                if (!(await showPopup("Hapus turunan ini beserta jawabannya?", "confirm"))) return;
            }
        } catch {}
        const tid = String(id);
        // Offline: hapus lokal + antre (temp: cukup buang op tambah tertunda).
        if (Wawancara.jaringanPutus() && Wawancara.outboxSiap()) {
            try {
                await Wawancara.buangAntreanTarget("ww-t:" + Wawancara.sesi.id + ":" + tid);
                Wawancara.turunan = (Wawancara.turunan || []).filter(t => String(t.id) !== tid);
                Wawancara.simpanCacheTurunan();
                if (!Wawancara.isTmp(tid)) {
                    await Wawancara.antreTulis("Hapus turunan", {
                        jenis: "turunan_hapus", target: "ww-x:" + Wawancara.sesi.id + ":t" + tid,
                        id: parseInt(tid, 10),
                    });
                }
                Wawancara.setPill("lokal");
                Wawancara.renderSesi();
            } catch (err) {
                console.error(err);
                try { if (typeof showToast === "function") showToast("Gagal: " + (err.message || err), "error"); } catch {}
            }
            return;
        }
        try {
            await wawancaraTurunanHapus(Wawancara.uid(), id);
            try { if (typeof showToast === "function") showToast("Turunan dihapus.", "success"); } catch {}
            await Wawancara.muatTurunan();
            Wawancara.renderSesi();
        } catch (err) {
            try { if (typeof showToast === "function") showToast("Gagal: " + (err.message || err), "error"); } catch {}
        }
    },

    // ================= DOKUMENTASI (foto/video per calon) =================
    // Audio yang boleh naik ke R2 (ikut allowlist Worker).
    audioBoleh() {
        return ["audio/mpeg", "audio/mp4", "audio/webm"];
    },

    async dokUpload(input) {
        const files = Array.from((input && input.files) || []);
        if (!files.length) return;
        const s = Wawancara.sesi;
        if (!s || !Wawancara.bolehTulisSesi() || s.status === "selesai") { input.value = ""; return; }
        const ketEl = document.getElementById("wwDokKet");
        const keterangan = ketEl ? String(ketEl.value || "").trim().slice(0, 300) : "";
        // Audio dipilah manual (pilahMedia cuma terima foto/video).
        const audios = files.filter(f => String(f.type || "").startsWith("audio/"));
        const sisanya = files.filter(f => !String(f.type || "").startsWith("audio/"));
        let valid = [], tolakTipe = 0, tolakBesar = 0;
        audios.forEach(f => {
            if (!Wawancara.audioBoleh().includes(f.type)) { tolakTipe++; return; }
            if ((f.size || 0) > 100 * 1024 * 1024) { tolakBesar++; return; }
            valid.push(f);
        });
        try {
            if (typeof pilahMedia === "function") {
                const pil = pilahMedia(sisanya, 100);
                valid = valid.concat(pil.valid);
                tolakTipe += pil.tolakTipe; tolakBesar += pil.tolakBesar;
            } else {
                valid = valid.concat(sisanya);
            }
        } catch {}
        if (tolakTipe || tolakBesar) {
            try { if (typeof showToast === "function") showToast(`Ditolak: ${tolakTipe} tipe tak didukung, ${tolakBesar} file >100MB.`, "error"); } catch {}
        }
        if (!valid.length) { input.value = ""; return; }
        const pengunggah = (typeof namaPengunggah === "function") ? namaPengunggah() : "";
        const btn = document.getElementById("wwDokBtn");
        if (btn) btn.disabled = true;
        let ok = 0;
        for (let i = 0; i < valid.length; i++) {
            const f = valid[i];
            const tipe = String(f.type || "").startsWith("video/") ? "video"
                : String(f.type || "").startsWith("audio/") ? "audio" : "foto";
            const path = (typeof pathDokumentasiWawancara === "function")
                ? pathDokumentasiWawancara(s.id, f, i) : "";
            if (!path) continue;
            if (await Wawancara.dokKirimFile(f, path, tipe, keterangan, pengunggah)) ok++;
        }
        input.value = "";
        if (btn) btn.disabled = false;
        try { await Wawancara.muatDokumentasi(); } catch {}
        Wawancara.renderSesi();
        if (ok) {
            try { if (typeof showToast === "function") showToast(ok + " file dokumentasi tersimpan.", "success"); } catch {}
        }
    },

    // Kirim 1 file (online langsung, offline antre). true = berhasil/antre.
    async dokKirimFile(f, path, tipe, keterangan, pengunggah) {
        const s = Wawancara.sesi;
        // Offline: antre file (maks 25MB/blob); tanpa Outbox = gagal jujur.
        if (Wawancara.jaringanPutus() && Wawancara.outboxSiap()) {
            if ((f.size || 0) > 25 * 1024 * 1024) {
                try { if (typeof showToast === "function") showToast(`"${f.name}": >25MB, upload pas online saja.`, "error"); } catch {}
                return false;
            }
            try {
                await Wawancara.dokTambahOffline(f, path, tipe, keterangan, pengunggah);
                return true;
            } catch (err) {
                console.error(err);
                try { if (typeof showToast === "function") showToast("Gagal antre " + f.name, "error"); } catch {}
                return false;
            }
        }
        try {
            await uploadFotoStorage(f, path, { label: "Dokumentasi " + (Wawancara.calonAktif ? Wawancara.calonAktif.nama : "") });
            await wawancaraDokumentasiTambah(Wawancara.uid(), s.id, {
                file_path: path, file_type: tipe, mime: f.type || "",
                ukuran_bytes: f.size || 0, keterangan: keterangan, pengunggah: pengunggah,
            });
            return true;
        } catch (err) {
            if (Wawancara.jaringanPutus(err) && Wawancara.outboxSiap() && (f.size || 0) <= 25 * 1024 * 1024) {
                try {
                    await Wawancara.dokTambahOffline(f, path, tipe, keterangan, pengunggah);
                    return true;
                } catch (e2) {
                    console.error(e2);
                    try { if (typeof showToast === "function") showToast("Gagal antre " + f.name, "error"); } catch {}
                    return false;
                }
            }
            console.error(err);
            try { if (typeof showToast === "function") showToast(`Gagal upload ${f.name}: ` + (err.message || err), "error"); } catch {}
            return false;
        }
    },

    // Jalur offline tambah dokumentasi: baris temp + pratinjau blob + antre file.
    async dokTambahOffline(f, path, tipe, keterangan, pengunggah) {
        const s = Wawancara.sesi;
        const tmp = Wawancara.tmpId();
        Wawancara.dokumentasi.push({ id: tmp, sesi_id: s.id, calon_id: s.calon_id,
            file_path: path, file_type: tipe, mime: f.type || "", ukuran_bytes: f.size || 0,
            keterangan: keterangan || "", pengunggah: pengunggah || "", _tmp: true });
        Wawancara.dokBlobs[tmp] = f;
        Wawancara.simpanCacheDokumentasi();
        await Wawancara.antreTulis("Dokumentasi (" + (f.name || "file") + ")", {
            jenis: "dok_tambah", target: "ww-d:" + s.id + ":" + tmp, tmpId: tmp,
            sesiId: s.id, file_path: path, file_type: tipe, mime: f.type || "",
            ukuran_bytes: f.size || 0, keterangan: keterangan || "",
        }, [{ slot: "dok", file: f, name: f.name || "file", type: f.type || "" }]);
        Wawancara.setPill("lokal");
    },

    async dokHapus(id) {
        const s = Wawancara.sesi;
        if (!s || !Wawancara.bolehTulisSesi() || s.status === "selesai") return;
        const rid = String(id);
        const row = (Wawancara.dokumentasi || []).find(d => String(d.id) === rid);
        try {
            if (typeof showPopup === "function") {
                if (!(await showPopup("Hapus dokumentasi ini?", "confirm"))) return;
            }
        } catch {}
        // Offline: hapus lokal + antre (temp: cukup buang antre tambahannya).
        if (Wawancara.jaringanPutus() && Wawancara.outboxSiap()) {
            try {
                await Wawancara.buangAntreanTarget("ww-d:" + s.id + ":" + rid);
                Wawancara.dokumentasi = (Wawancara.dokumentasi || []).filter(d => String(d.id) !== rid);
                try {
                    if (Wawancara.dokUrls[rid]) URL.revokeObjectURL(Wawancara.dokUrls[rid]);
                } catch {}
                delete Wawancara.dokBlobs[rid];
                delete Wawancara.dokUrls[rid];
                Wawancara.simpanCacheDokumentasi();
                if (!Wawancara.isTmp(rid)) {
                    await Wawancara.antreTulis("Hapus dokumentasi", {
                        jenis: "dok_hapus", target: "ww-x:" + s.id + ":d" + rid,
                        id: parseInt(rid, 10), file_path: row ? (row.file_path || "") : "",
                    });
                }
                Wawancara.setPill("lokal");
                Wawancara.renderSesi();
            } catch (err) {
                console.error(err);
                try { if (typeof showToast === "function") showToast("Gagal: " + (err.message || err), "error"); } catch {}
            }
            return;
        }
        try {
            await wawancaraDokumentasiHapus(Wawancara.uid(), id);
            try { if (row && row.file_path) await hapusFotoStorage(row.file_path); } catch (eDel) {
                console.warn("Bersih file R2 gagal:", eDel);
            }
            await Wawancara.muatDokumentasi();
            try { if (typeof showToast === "function") showToast("Dokumentasi dihapus.", "success"); } catch {}
            Wawancara.renderSesi();
        } catch (err) {
            try { if (typeof showToast === "function") showToast("Gagal: " + (err.message || err), "error"); } catch {}
        }
    },

    // ================= KELOLA CALON =================
    formCalon(id) {
        if (!Wawancara.bolehKelola()) return;
        const c = id ? (Wawancara.calon || []).find(x => String(x.id) === String(id)) : null;
        const s = c ? Wawancara.sesiUntukCalon(c.id) : null;
        document.getElementById("wwCalonTitle").textContent = c ? "Edit Calon" : "Tambah Calon";
        document.getElementById("wwCalonId").value = c ? c.id : "";
        document.getElementById("wwCalonNama").value = c ? (c.nama || "") : "";
        document.getElementById("wwCalonKelas").value = c ? (c.kelas || "") : "";
        document.getElementById("wwCalonKet").value = c ? (c.keterangan || "") : "";
        document.getElementById("wwCalonTanggal").value = c && c.tanggal ? String(c.tanggal).slice(0, 10) : "";
        const daftarPew = s ? Wawancara.petugasUntuk(s.id) : [];
        document.getElementById("wwCalonPewList").innerHTML =
            (daftarPew.length ? daftarPew : [null]).map(id => Wawancara.pewRowHtml(id, true)).join("");
        document.getElementById("wwCalonForm").classList.add("open");
        document.body.style.overflow = "hidden";
    },

    tutupFormCalon() {
        document.getElementById("wwCalonForm")?.classList.remove("open");
        document.body.style.overflow = "";
    },

    async simpanCalon() {
        const idVal = document.getElementById("wwCalonId").value;
        const f = {
            nama: document.getElementById("wwCalonNama").value.trim(),
            kelas: document.getElementById("wwCalonKelas").value.trim(),
            keterangan: document.getElementById("wwCalonKet").value.trim(),
            tanggal: document.getElementById("wwCalonTanggal").value || null,
        };
        if (!f.nama) {
            try { if (typeof showToast === "function") showToast("Isi nama calon dulu.", "error"); } catch {}
            return;
        }
        try {
            const uid = Wawancara.uid();
            let calonId = idVal ? parseInt(idVal, 10) : null;
            if (calonId) await wawancaraCalonUbah(uid, calonId, f);
            else calonId = await wawancaraCalonTambah(uid, f);
            // Pewawancara langsung di form ini (sesi dipastikan dulu, satu per calon).
            const ids = Wawancara.kumpulPewIds(document.getElementById("wwCalonForm"));
            if (ids.length) {
                try {
                    const sid = await wawancaraSesiPastikan(uid, calonId);
                    await wawancaraSesiPetugas(uid, sid, ids);
                } catch (ePetugas) {
                    try { if (typeof showToast === "function") showToast("Calon tersimpan, tapi pewawancara gagal: " + (ePetugas.message || ePetugas), "error"); } catch {}
                }
            }
            try { if (typeof showToast === "function") showToast("Calon disimpan.", "success"); } catch {}
            Wawancara.tutupFormCalon();
            Wawancara.calon = await getWawancaraCalon();
            Wawancara.sesiSemua = await getWawancaraSesi();
            try { Wawancara.petugas = (typeof getWawancaraPetugas === "function") ? await getWawancaraPetugas() : (Wawancara.petugas || []); } catch {}
            if (Wawancara.sesi) {
                // Sedang di detail -> segarkan nama + petugas bila calon aktif.
                const c = Wawancara.calon.find(x => String(x.id) === String(Wawancara.calonAktif.id));
                if (c) {
                    Wawancara.calonAktif = c;
                    const s = Wawancara.sesiSemua.find(x => String(x.calon_id) === String(c.id));
                    if (s) Wawancara.sesi = s;
                    Wawancara.jawaban = await getWawancaraJawaban(Wawancara.sesi.id);
                    Wawancara.renderSesi();
                } else {
                    await Wawancara.muatDaftar();
                }
            } else {
                await Wawancara.muatDaftar();
            }
        } catch (err) {
            try { if (typeof showToast === "function") showToast("Gagal: " + (err.message || err), "error"); } catch {}
        }
    },

    async hapusCalon(id) {
        if (!Wawancara.bolehKelola()) return;
        const c = (Wawancara.calon || []).find(x => String(x.id) === String(id));
        try {
            if (typeof showPopup === "function") {
                if (!(await showPopup(`Hapus ${c ? c.nama : "calon ini"} beserta sesi + seluruh jawabannya?`, "confirm"))) return;
            }
        } catch {}
        try {
            await wawancaraCalonHapus(Wawancara.uid(), id);
            try { if (typeof showToast === "function") showToast("Calon dihapus.", "success"); } catch {}
            await Wawancara.muatDaftar();
        } catch (err) {
            try { if (typeof showToast === "function") showToast("Gagal: " + (err.message || err), "error"); } catch {}
        }
    },

    // ================= KELOLA PERTANYAAN MASTER =================
    async bukaKelolaTanya() {
        if (!Wawancara.bolehKelola()) return;
        try {
            Wawancara.pertanyaan = await getWawancaraPertanyaan();
        } catch (err) {
            try { if (typeof showToast === "function") showToast("Gagal: " + (err.message || err), "error"); } catch {}
            return;
        }
        Wawancara.renderKelolaTanya();
        document.getElementById("wwTanyaForm").classList.add("open");
        document.body.style.overflow = "hidden";
    },

    tutupKelolaTanya() {
        document.getElementById("wwTanyaForm")?.classList.remove("open");
        document.body.style.overflow = "";
        // Segarkan tampilan (master bisa berubah) tanpa pindah halaman.
        if (Wawancara.sesi) Wawancara.bukaCalon(Wawancara.calonAktif.id);
        else Wawancara.muatDaftar();
    },

    renderKelolaTanya() {
        const wrap = document.getElementById("wwTanyaList");
        if (!wrap) return;
        const utama = (Wawancara.pertanyaan || []).filter(p => !p.parent_id)
            .sort((a, b) => (a.urutan - b.urutan) || (a.id - b.id));
        if (!utama.length) {
            wrap.innerHTML = `<div class="osis-empty">Belum ada pertanyaan. Tambah lewat tombol di bawah.</div>`;
            return;
        }
        wrap.innerHTML = utama.map((p, i) => {
            return `
            <div class="ww-kelola-grup">
                <div class="ww-kelola-row">
                    <b>${i + 1}. ${escapeHtml(p.teks)}</b>
                    ${p.aktif === false ? `<span class="ww-st ww-st-belum">nonaktif</span>` : ""}
                    <span class="ww-mini-ops">
                        <button class="icon-btn icon-btn-sm" title="${p.penting ? "Cabut tanda penting" : "Tandai paling penting"}" onclick="Wawancara.tandaiPenting(${p.id})"><i class="${p.penting ? "fa-solid" : "fa-regular"} fa-star"${p.penting ? ` style="color:var(--red)"` : ""}></i></button>
                        <button class="icon-btn icon-btn-sm" title="Edit" onclick="Wawancara.formTanya(${p.id}, null, true)"><i class="fa-solid fa-pen"></i></button>
                        <button class="icon-btn icon-btn-sm" title="Hapus" onclick="Wawancara.hapusTanya(${p.id}, true)"><i class="fa-solid fa-trash"></i></button>
                    </span>
                </div>
            </div>`;
        }).join("");
    },

    // Form tambah/edit pertanyaan. parentId = id utama (null = utama).
    // dariKelola = true bila dibuka dari popup kelola (render ulang popup).
    formTanya(id, parentId, dariKelola) {
        if (!Wawancara.bolehKelola() && !Wawancara.bolehTulisSesi()) return;
        const p = id ? (Wawancara.pertanyaan || []).find(x => String(x.id) === String(id)) : null;
        document.getElementById("wwTanyaTitle").textContent = p ? "Edit Pertanyaan" : (parentId ? "Tambah Turunan" : "Tambah Pertanyaan Utama");
        document.getElementById("wwTanyaId").value = p ? p.id : "";
        document.getElementById("wwTanyaParent").value = p ? (p.parent_id || "") : (parentId || "");
        document.getElementById("wwTanyaTeks").value = p ? (p.teks || "") : "";
        document.getElementById("wwTanyaMode").value = dariKelola ? "kelola" : "sesi";
        document.getElementById("wwTanyaEdit").classList.add("open");
    },

    tutupFormTanya() {
        document.getElementById("wwTanyaEdit")?.classList.remove("open");
    },

    async simpanTanya() {
        if (Wawancara.sesi && Wawancara.sesi.status === "selesai") return;
        const idVal = document.getElementById("wwTanyaId").value;
        const parentVal = document.getElementById("wwTanyaParent").value;
        const teks = document.getElementById("wwTanyaTeks").value.trim();
        const mode = document.getElementById("wwTanyaMode").value;
        if (!teks) {
            try { if (typeof showToast === "function") showToast("Isi pertanyaan dulu.", "error"); } catch {}
            return;
        }
        try {
            await wawancaraPertanyaanSimpan(
                Wawancara.uid(),
                idVal ? parseInt(idVal, 10) : null,
                teks,
                parentVal ? parseInt(parentVal, 10) : null,
            );
            try { if (typeof showToast === "function") showToast("Pertanyaan disimpan.", "success"); } catch {}
            Wawancara.tutupFormTanya();
            Wawancara.pertanyaan = (await getWawancaraPertanyaan()).filter(p => p.aktif !== false);
            if (Wawancara.sesi) {
                try {
                    await wawancaraUrutanPastikan(Wawancara.uid(), Wawancara.sesi.id);
                    await Wawancara.muatUrutanSesi();
                } catch {}
            }
            if (mode === "kelola") Wawancara.renderKelolaTanya();
            else if (Wawancara.sesi) Wawancara.renderSesi();
        } catch (err) {
            try { if (typeof showToast === "function") showToast("Gagal: " + (err.message || err), "error"); } catch {}
        }
    },

    async hapusTanya(id, dariKelola) {
        if (!Wawancara.bolehKelola()) return;
        if (Wawancara.sesi && Wawancara.sesi.status === "selesai") return;
        try {
            if (typeof showPopup === "function") {
                if (!(await showPopup("Hapus pertanyaan utama ini? Turunan + jawaban sesi yang tercatat ikut terhapus.", "confirm"))) return;
            }
        } catch {}
        try {
            await wawancaraPertanyaanHapus(Wawancara.uid(), id);
            try { if (typeof showToast === "function") showToast("Pertanyaan dihapus.", "success"); } catch {}
            Wawancara.pertanyaan = (await getWawancaraPertanyaan()).filter(p => p.aktif !== false);
            if (dariKelola || document.getElementById("wwTanyaForm")?.classList.contains("open")) {
                Wawancara.renderKelolaTanya();
            }
            if (Wawancara.sesi) {
                Wawancara.jawaban = await getWawancaraJawaban(Wawancara.sesi.id);
                try { await Wawancara.muatUrutanSesi(); } catch {}
                if (!dariKelola) Wawancara.renderSesi();
            }
        } catch (err) {
            try { if (typeof showToast === "function") showToast("Gagal: " + (err.message || err), "error"); } catch {}
        }
    },

    // Tandai/batalkan "paling penting" pada pertanyaan utama (khusus kelola).
    async tandaiPenting(id) {
        if (!Wawancara.bolehKelola()) return;
        const p = (Wawancara.pertanyaan || []).find(x => String(x.id) === String(id));
        if (!p || p.parent_id) return;
        try {
            await wawancaraPertanyaanPenting(Wawancara.uid(), p.id, !p.penting);
            p.penting = !p.penting;
            try { if (typeof showToast === "function") showToast(p.penting ? "Ditandai penting." : "Tanda penting dicabut.", "success"); } catch {}
            Wawancara.renderKelolaTanya();
            if (Wawancara.sesi) Wawancara.renderSesi();
        } catch (err) {
            try { if (typeof showToast === "function") showToast("Gagal: " + (err.message || err), "error"); } catch {}
        }
    },

};

document.addEventListener("DOMContentLoaded", () => Wawancara.init());
