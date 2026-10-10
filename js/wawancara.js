// =========================================================================
// WAWANCARA CALON OSIS — halaman khusus OSIS (folder /osis)
// Dipakai di osis/wawancara.html.
// - Daftar calon + status (belum / berlangsung / selesai) + progres jawaban.
// - Satu sesi per calon; 1–2 pewawancara dengan HAK SAMA. Jawaban dipakai
//   bersama dalam sesi yang sama -> cukup SATU yang mencatat, tidak perlu
//   keduanya mengisi terpisah.
// - Pertanyaan utama sama untuk semua calon; tiap utama bisa punya turunan.
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
    jawaban: [],      // baris wawancara_jawaban sesi aktif
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

    // Ditugaskan sebagai pewawancara 1 atau 2 di sesi ini?
    ditugaskan(s, id) {
        if (!s || !id) return false;
        return String(s.pewawancara1_id) === String(id) || String(s.pewawancara2_id) === String(id);
    },

    // Nama para pewawancara sesi, dipisah " · " (atau "Belum ditugaskan").
    namaPetugas(s) {
        const nama = [s.pewawancara1_id, s.pewawancara2_id]
            .filter(Boolean)
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

    // ================= INIT =================
    async init() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") {
            location.replace("../login");
            return;
        }
        try { if (typeof OsisAuth.refreshAkses === "function") await OsisAuth.refreshAkses(); } catch {}
        Wawancara.pasangPopup();
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
            wrap.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat daftar calon...</div>`;
        }
        Wawancara.pasangFilter();
        try {
            const [calon, sesi] = await Promise.all([getWawancaraCalon(), getWawancaraSesi()]);
            Wawancara.calon = calon || [];
            Wawancara.sesiSemua = sesi || [];
            try { Wawancara.senior = await getOsisUsersRingkas(); } catch { Wawancara.senior = []; }
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
        const detail = document.getElementById("wwDetail");
        if (detail) {
            detail.style.display = "";
            detail.innerHTML = `<div class="loading-block"><div class="spinner"></div> Membuka wawancara...</div>`;
        }
        // Masuk detail: hero + filter daftar disembunyikan (fokus ke calon).
        const sec = document.getElementById("wwDaftarSection");
        if (sec) sec.style.display = "none";
        const hero = document.getElementById("wwHero");
        if (hero) hero.style.display = "none";
        try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch {}
        try {
            const [calon, sesiSemua, tanya] = await Promise.all([
                getWawancaraCalon(), getWawancaraSesi(), getWawancaraPertanyaan(),
            ]);
            Wawancara.calon = calon || [];
            Wawancara.sesiSemua = sesiSemua || [];
            Wawancara.pertanyaan = (tanya || []).filter(p => p.aktif !== false);
            try { Wawancara.senior = await getOsisUsersRingkas(); } catch { Wawancara.senior = []; }
            const c = Wawancara.calon.find(x => String(x.id) === String(calonId));
            if (!c) throw new Error("Calon tidak ditemukan (mungkin sudah dihapus).");
            Wawancara.calonAktif = c;
            // Pastikan sesi ada (satu per calon) agar jawaban punya cantolan.
            const sid = await wawancaraSesiPastikan(Wawancara.uid(), c.id);
            const fresh = await getWawancaraSesi();
            Wawancara.sesiSemua = fresh || [];
            Wawancara.sesi = (fresh || []).find(s => String(s.id) === String(sid));
            Wawancara.jawaban = await getWawancaraJawaban(Wawancara.sesi.id);
            // Susunan khusus sesi ini (bawaan = master bila belum diatur).
            Wawancara.urutanSesi = {};
            await wawancaraUrutanPastikan(Wawancara.uid(), Wawancara.sesi.id);
            await Wawancara.muatUrutanSesi();
            Wawancara.mode = "atur"; // buka = mode atur (tanpa form jawaban)
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
        } catch (err) {
            console.error(err);
            if (String((err && err.message) || "") === "BUTUH_MIGRASI") {
                Wawancara.sesi = null;
                Wawancara.renderButuhMigrasi();
                return;
            }
            if (detail) detail.innerHTML = `<div class="osis-panel"><div class="pesan-empty">Gagal membuka: ${escapeHtml(err.message || err)}</div>
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
        return (Wawancara.pertanyaan || [])
            .filter(p => String(p.parent_id) === String(parentId))
            .sort((a, b) => (Wawancara.urutEfektif(a) - Wawancara.urutEfektif(b)) || (a.id - b.id));
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
        const utama = Wawancara.pertanyaanUtama().map(p => [p, ...Wawancara.turunanUntuk(p.id)]).flat();
        if (!utama.length) return { isi: 0, total: 0 };
        const isi = utama.filter(p => {
            const j = Wawancara.jawabanUntuk(p.id);
            return j && String(j.jawaban_teks || "").trim() !== "";
        }).length;
        return { isi, total: utama.length };
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
        const btnHasil = (Wawancara.mode !== "hasil")
            ? `<button class="btn btn-white btn-sm" onclick="Wawancara.lihatHasil()"><i class="fa-solid fa-eye"></i> Hasil</button>` : "";
        const btnAtur = (Wawancara.mode !== "atur")
            ? `<button class="btn btn-white btn-sm" onclick="Wawancara.lihatAtur()"><i class="fa-solid fa-list-ol"></i> Atur</button>` : "";
        // Mode atur: Spontan paling kiri, Lanjutkan paling kanan.
        const btnAksi = Wawancara.mode === "atur"
            ? [btnSpontan, btnSelesai, btnBuka, btnHasil, btnLanjut].join("")
            : [btnLanjut, btnSpontan, btnBuka, btnSelesai, btnHasil, btnAtur].join("");

        detail.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px">${Wawancara.mode === "wawancara" ? `<button class="btn btn-white btn-sm" onclick="Wawancara.lihatAtur()"><i class="fa-solid fa-arrow-left"></i> Kembali</button>` : `<button class="btn btn-white btn-sm" onclick="Wawancara.kembali()"><i class="fa-solid fa-arrow-left"></i> Daftar calon</button>`}<hr class="ww-hr"></div>
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
            <div id="wwModeWrap"></div>`;

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
                const anakKosong = Wawancara.turunanUntuk(it.q.id).some(a => {
                    const j = Wawancara.jawabanUntuk(a.id);
                    return !j || !String(j.jawaban_teks || "").trim();
                });
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
        try {
            // Tersimpan sebagai susunan KHUSUS sesi/calon ini saja.
            const ids = tanpa.map(x => x.id);
            await wawancaraUrutanAtur(Wawancara.uid(), Wawancara.sesi.id, ids);
            ids.forEach((id, i) => { Wawancara.urutanSesi[String(id)] = (i + 1) * 10; });
            try { if (typeof showToast === "function") showToast("Urutan diperbarui untuk calon ini.", "success"); } catch {}
            Wawancara.renderSesi();
        } catch (err) {
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
                ${p.parent_id ? "" : `<button class="icon-btn icon-btn-sm" title="Tambah turunan" onclick="Wawancara.formTanya(null, ${p.id})"><i class="fa-solid fa-plus"></i></button>`}
                <button class="icon-btn icon-btn-sm" title="Edit" onclick="Wawancara.formTanya(${p.id}, ${p.parent_id ? p.parent_id : "null"})"><i class="fa-solid fa-pen"></i></button>
                <button class="icon-btn icon-btn-sm" title="Hapus" onclick="Wawancara.hapusTanya(${p.id})"><i class="fa-solid fa-trash"></i></button>
            </span>`;
        };
        const daftar = Wawancara.pertanyaanUtama().map((p, i) => {
            const anak = Wawancara.turunanUntuk(p.id).map(a => `
                <div class="ww-atur-row ww-atur-anak" data-tid="${a.id}" data-parent="${p.id}" ${(kelola || tulis) && !selesai ? `draggable="true"` : ""}>
                    ${(kelola || tulis) && !selesai ? `<span class="ww-grip" title="Geser"><i class="fa-solid fa-grip-vertical"></i></span>` : ""}
                    <span class="ww-nomor ww-nomor-anak">⤷</span>
                    <span class="ww-atur-teks">${escapeHtml(a.teks)}</span>
                    ${opsMaster(a)}
                </div>`).join("");
            return `<div class="ww-atur-row" data-tid="${p.id}" data-parent="" ${(kelola || tulis) && !selesai ? `draggable="true"` : ""}>
                    ${(kelola || tulis) && !selesai ? `<span class="ww-grip" title="Geser"><i class="fa-solid fa-grip-vertical"></i></span>` : ""}
                    <span class="ww-nomor">${i + 1}</span>
                    <span class="ww-atur-teks">${escapeHtml(p.teks)}</span>
                    ${opsMaster(p)}
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
                <p class="ww-sub">1–2 pewawancara dengan hak yang sama. Cukup satu yang mencatat.</p>
                <div class="ww-grid2">
                    <div class="field"><label>Pewawancara 1</label>
                        <select id="wwPewawancara1" class="admin-input" ${kelola && !selesai ? "" : "disabled"}>${opsiSenior(s.pewawancara1_id)}</select></div>
                    <div class="field"><label>Pewawancara 2 (opsional)</label>
                        <select id="wwPewawancara2" class="admin-input" ${kelola && !selesai ? "" : "disabled"}>${opsiSenior(s.pewawancara2_id)}</select></div>
                </div>
                ${kelola && !selesai ? `<button class="btn btn-red btn-sm" onclick="Wawancara.simpanPetugas()"><i class="fa-solid fa-floppy-disk"></i> Simpan pewawancara</button>` : ""}
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
                const ja = Wawancara.jawabanUntuk(a.id);
                return `<div class="ww-anak">
                    <div class="ww-tanya"><span class="ww-nomor ww-nomor-anak">⤷</span><span>${escapeHtml(a.teks)}</span></div>
                    <textarea class="admin-input admin-textarea ww-jawab" rows="3" maxlength="5000"
                        data-qid="${a.id}" data-jid="${ja ? ja.id : ""}" ${bacaSaja ? "disabled" : ""}
                        placeholder="Ketik jawaban... (otomatis tersimpan)">${escapeHtml(ja ? String(ja.jawaban_teks || "") : "")}</textarea>
                </div>`;
            }).join("");
            isi = `<div class="ww-qnomor"><i class="fa-solid fa-list-ol"></i> Pertanyaan ${Math.min(Wawancara.idx + 1, total)} dari ${total}</div>
                <div class="ww-qteks">${escapeHtml(step.q.teks)}</div>
                <textarea class="admin-input admin-textarea ww-jawab" rows="3" maxlength="5000"
                    data-qid="${step.q.id}" data-jid="${j ? j.id : ""}" ${bacaSaja ? "disabled" : ""}
                    placeholder="Ketik jawaban... (otomatis tersimpan)">${escapeHtml(j ? String(j.jawaban_teks || "") : "")}</textarea>
                ${anakHtml}
                <div id="wwTurunanAnchor"></div>
                ${(kelola || tulis) && !selesai ? `<button class="btn btn-white btn-sm" style="margin-top:6px" onclick="Wawancara.tambahTurunanLangsung(${step.q.id})"><i class="fa-solid fa-plus"></i> Turunan</button>` : ""}`;
        }
        wrap.innerHTML = `
            <div class="osis-panel">
                ${isi}
                <div class="ww-nav">
                    <button class="btn btn-white" onclick="Wawancara.geserLangkah(-1)" ${Wawancara.idx <= 0 ? "disabled" : ""}><i class="fa-solid fa-arrow-left"></i> Sebelumnya</button>
                    <button class="btn btn-red" onclick="Wawancara.geserLangkah(1)" ${Wawancara.idx >= ur.length - 1 ? "disabled" : ""}>Berikutnya <i class="fa-solid fa-arrow-right"></i></button>
                </div>
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
        if (!bacaSaja) {
            const ta = wrap.querySelector("textarea.ww-jawab");
            if (ta) { try { ta.focus({ preventScroll: true }); } catch { try { ta.focus(); } catch {} } }
        }
    },

    // ---- Navigasi nomor soal (di bawah kartu pertanyaan) ----
    // Warna per TIPE: putih = biasa, kuning = punya turunan, biru = spontan.
    // Gelap = sedang dibuka. Badge ✓ hijau = terjawab penuh.
    masterTuntas(p) {
        const j = Wawancara.jawabanUntuk(p.id);
        if (!j || !String(j.jawaban_teks || "").trim()) return false;
        return Wawancara.turunanUntuk(p.id).every(a => {
            const ja = Wawancara.jawabanUntuk(a.id);
            return ja && String(ja.jawaban_teks || "").trim();
        });
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
        const item = (nomor, teks, jawab) => `
            <div class="ww-hasil-item">
                <div class="ww-tanya"><span class="ww-nomor">${nomor}</span><span>${escapeHtml(teks)}</span></div>
                <div class="ww-hasil-jawab">${jawab && String(jawab).trim() ? escapeHtml(jawab) : `<span class="kosong">Belum dijawab</span>`}</div>
            </div>`;
        let n = 0;
        let html = "";
        Wawancara.pertanyaanUtama().forEach(p => {
            n++;
            const j = Wawancara.jawabanUntuk(p.id);
            html += item(n, p.teks, j && j.jawaban_teks);
            Wawancara.turunanUntuk(p.id).forEach(a => {
                const ja = Wawancara.jawabanUntuk(a.id);
                html += `<div style="margin-left:16px">${item("⤷", a.teks, ja && ja.jawaban_teks)}</div>`;
            });
        });
        if (Wawancara.spontanList().length) {
            html += `<h3 class="ww-judul" style="margin-top:14px"><i class="fa-solid fa-bolt"></i> Spontan</h3>`;
            Wawancara.spontanList().forEach(j => {
                html += item("⚡", j.pertanyaan_teks, j.jawaban_teks);
            });
        }
        html += `<h3 class="ww-judul" style="margin-top:14px"><i class="fa-solid fa-clipboard-check"></i> Catatan akhir</h3>
            <div class="ww-hasil-jawab" style="margin-left:0">${s.catatan_akhir && String(s.catatan_akhir).trim() ? escapeHtml(s.catatan_akhir) : `<span class="kosong">—</span>`}</div>`;
        wrap.innerHTML = `<div class="osis-panel">
            <h3 class="ww-judul"><i class="fa-solid fa-eye"></i> Hasil wawancara</h3>
            <p class="ww-sub">Read-only. Untuk mengoreksi, buka kembali sesinya.</p>
            ${html || `<div class="osis-empty">Belum ada pertanyaan.</div>`}
        </div>`;
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
        }
    },

    kunciDraft(textarea) {
        if (textarea.id === "wwCatatan") return `ww_draft_${Wawancara.sesi.id}_catatan`;
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
                await wawancaraJawabanSimpan(Wawancara.uid(), Wawancara.sesi.id, {
                    spontan: true, jawabanId: jid,
                    pertanyaanTeks: teks, jawabanTeks: row ? (row.jawaban_teks || "") : "",
                });
                Wawancara.setPill("ok");
            } catch (err) {
                console.error(err);
                Wawancara.setPill("gagal");
                try { if (typeof showToast === "function") showToast("Gagal menyimpan: " + (err.message || err), "error"); } catch {}
            }
        }, 800);
    },

    antreSimpan(textarea, teksSpontanOverride) {
        if (!Wawancara.sesi || !Wawancara.bolehTulisSesi()) return;
        const sesiId = Wawancara.sesi.id;
        // Backup lokal dulu (progres tidak hilang walau offline).
        try { localStorage.setItem(Wawancara.kunciDraft(textarea), textarea.value); } catch {}
        Wawancara.setPill("simpan");
        const kunci = textarea.id === "wwCatatan" ? "catatan"
            : `j${textarea.dataset.qid}_${textarea.dataset.jid || "baru"}`;
        clearTimeout(Wawancara.timerSimpan[kunci]);
        Wawancara.timerSimpan[kunci] = setTimeout(async () => {
            try {
                const uid = Wawancara.uid();
                if (textarea.id === "wwCatatan") {
                    await wawancaraSesiCatatan(uid, sesiId, textarea.value);
                    Wawancara.sesi.catatan_akhir = textarea.value;
                } else if (textarea.dataset.qid === "spontan") {
                    const wrap = textarea.closest(".ww-spontan, .ww-spontan-atur, .ww-atur-row");
                    const inp = wrap ? wrap.querySelector(".ww-spontan-teks") : null;
                    const teks = teksSpontanOverride !== undefined ? teksSpontanOverride : (inp ? inp.value : "");
                    const jid = textarea.dataset.jid ? parseInt(textarea.dataset.jid, 10) : null;
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
                    const jid = textarea.dataset.jid ? parseInt(textarea.dataset.jid, 10) : null;
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
                console.error(err);
                Wawancara.setPill("gagal");
                try { if (typeof showToast === "function") showToast("Gagal menyimpan: " + (err.message || err), "error"); } catch {}
            }
        }, 800);
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
        const label = status === "selesai" ? "Selesaikan wawancara? Hasil jadi read-only." : "Mulai wawancara sekarang?";
        try {
            if (typeof showPopup === "function") {
                if (!(await showPopup(label, "confirm"))) return;
            }
        } catch {}
        try {
            await wawancaraSesiStatus(Wawancara.uid(), s.id, status);
            try { if (typeof showToast === "function") showToast(status === "selesai" ? "Wawancara selesai." : "Wawancara dimulai.", "success"); } catch {}
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
            }
            Wawancara.renderSesi();
        } catch (err) {
            try { if (typeof showToast === "function") showToast("Gagal: " + (err.message || err), "error"); } catch {}
        }
    },

    async simpanPetugas() {
        const s = Wawancara.sesi;
        if (!s) return;
        const el1 = document.getElementById("wwPewawancara1");
        const el2 = document.getElementById("wwPewawancara2");
        const pew1Id = el1 && el1.value ? parseInt(el1.value, 10) : null;
        const pew2Id = el2 && el2.value ? parseInt(el2.value, 10) : null;
        if (!pew1Id && !pew2Id) {
            try { if (typeof showToast === "function") showToast("Pilih minimal satu pewawancara.", "error"); } catch {}
            return;
        }
        try {
            await wawancaraSesiPetugas(Wawancara.uid(), s.id, pew1Id, pew2Id);
            Wawancara.sesi.pewawancara1_id = pew1Id;
            Wawancara.sesi.pewawancara2_id = pew2Id;
            try { if (typeof showToast === "function") showToast("Pewawancara disimpan.", "success"); } catch {}
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
        try {
            const idBaru = await wawancaraJawabanSimpan(uid, s.id, {
                spontan: true, pertanyaanTeks: "Pertanyaan spontan", jawabanTeks: "",
            });
            Wawancara.jawaban = await getWawancaraJawaban(s.id);
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
        } catch (err) {
            try { if (typeof showToast === "function") showToast("Gagal: " + (err.message || err), "error"); } catch {}
        }
    },

    async hapusSpontan(jawabanId) {
        try {
            if (typeof showPopup === "function") {
                if (!(await showPopup("Hapus pertanyaan spontan ini beserta jawabannya?", "confirm"))) return;
            }
        } catch {}
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
        try {
            await wawancaraPertanyaanSimpan(Wawancara.uid(), null, teks, utamaId);
            try { if (typeof showToast === "function") showToast("Turunan ditambah.", "success"); } catch {}
            Wawancara.pertanyaan = (await getWawancaraPertanyaan()).filter(p => p.aktif !== false);
            Wawancara.renderSesi(); // idx tetap: turunan gabung satu layar
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
        document.getElementById("wwCalonPew1").innerHTML = Wawancara.opsiSenior(s ? s.pewawancara1_id : null);
        document.getElementById("wwCalonPew2").innerHTML = Wawancara.opsiSenior(s ? s.pewawancara2_id : null);
        document.getElementById("wwCalonForm").classList.add("open");
        document.body.style.overflow = "hidden";
        setTimeout(() => document.getElementById("wwCalonNama")?.focus(), 60);
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
            const el1 = document.getElementById("wwCalonPew1");
            const el2 = document.getElementById("wwCalonPew2");
            const pew1Id = el1 && el1.value ? parseInt(el1.value, 10) : null;
            const pew2Id = el2 && el2.value ? parseInt(el2.value, 10) : null;
            if (pew1Id || pew2Id) {
                try {
                    const sid = await wawancaraSesiPastikan(uid, calonId);
                    await wawancaraSesiPetugas(uid, sid, pew1Id, pew2Id);
                } catch (ePetugas) {
                    try { if (typeof showToast === "function") showToast("Calon tersimpan, tapi pewawancara gagal: " + (ePetugas.message || ePetugas), "error"); } catch {}
                }
            }
            try { if (typeof showToast === "function") showToast("Calon disimpan.", "success"); } catch {}
            Wawancara.tutupFormCalon();
            Wawancara.calon = await getWawancaraCalon();
            Wawancara.sesiSemua = await getWawancaraSesi();
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
            const anak = (Wawancara.pertanyaan || []).filter(x => String(x.parent_id) === String(p.id))
                .sort((a, b) => (a.urutan - b.urutan) || (a.id - b.id));
            return `
            <div class="ww-kelola-grup">
                <div class="ww-kelola-row">
                    <b>${i + 1}. ${escapeHtml(p.teks)}</b>
                    ${p.aktif === false ? `<span class="ww-st ww-st-belum">nonaktif</span>` : ""}
                    <span class="ww-mini-ops">
                        <button class="icon-btn icon-btn-sm" title="Edit" onclick="Wawancara.formTanya(${p.id}, null, true)"><i class="fa-solid fa-pen"></i></button>
                        <button class="icon-btn icon-btn-sm" title="Hapus (+ turunannya)" onclick="Wawancara.hapusTanya(${p.id}, true)"><i class="fa-solid fa-trash"></i></button>
                    </span>
                </div>
                ${anak.map(a => `
                <div class="ww-kelola-row ww-kelola-anak">
                    <span>⤷ ${escapeHtml(a.teks)}</span>
                    <span class="ww-mini-ops">
                        <button class="icon-btn icon-btn-sm" title="Edit" onclick="Wawancara.formTanya(${a.id}, ${p.id}, true)"><i class="fa-solid fa-pen"></i></button>
                        <button class="icon-btn icon-btn-sm" title="Hapus" onclick="Wawancara.hapusTanya(${a.id}, true)"><i class="fa-solid fa-trash"></i></button>
                    </span>
                </div>`).join("")}
                <button class="btn btn-white btn-sm" onclick="Wawancara.formTanya(null, ${p.id}, true)"><i class="fa-solid fa-plus"></i> Turunan</button>
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
        setTimeout(() => document.getElementById("wwTanyaTeks")?.focus(), 60);
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
                if (!(await showPopup("Hapus pertanyaan ini? Turunan + jawaban yang sudah tercatat ikut terhapus.", "confirm"))) return;
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
};

document.addEventListener("DOMContentLoaded", () => Wawancara.init());
