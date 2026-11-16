// =========================================================================
// ABSENSI PENGURUS — halaman khusus OSIS (folder /osis)
// Dipakai di osis/absensi.html — catat pengurus yang TIDAK HADIR
// (izin/sakit/alpha) per tanggal. Nama pengurus diketik manual.
// Tulis via RPC buat_absensi/update_absensi/hapus_absensi (cek osis_users,
// UNIQUE tanggal+lower(nama) anti duplikat).
// =========================================================================

const Absensi = {
    cache: [],
    filter: { q: "", status: "", tanggal: "", tab: "tidak" },
    editTanggal: null,
    // Tambah yang dibuka untuk tanggal berisi: baris tercatat dimuat otomatis
    // jadi baris terpilih (tambah bersifat aditif). Basis hapus/update pas simpan.
    tanggalDimuat: null,
    // State modal Absen Langsung (tandai hadir cepat dari tabel anggota simple)
    // Roster = anggota periode AKTIF (tabel periode), dipisah per tahun.
    // tahunFokus = SELALU 1 tahun (default angkatan/kiri,
    // pilihan terakhir disimpan per angkatan di localStorage).
    langsung: { anggota: [], periodeTahun: [], periodeSemua: [], tahunFokus: null, tahun: null, q: "", activeIdx: 0, saving: false, _rosterSiap: false },
    config: { loaded: false, tahunAktif: [], tahunDefault: null, draft: null, saving: false },

    STATUS: ["izin", "sakit", "alpha"],

    async init() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") {
            location.replace("../login");
            return;
        }
        // Segarkan hak kendali (biar perubahan akses langsung berlaku)
        try { await OsisAuth.refreshAkses(); } catch {}
        Absensi.terapkanAkses();

        document.getElementById("btnTambahAbsensi")?.addEventListener("click", () => Absensi.bukaForm());
        document.getElementById("btnTabTidak")?.addEventListener("click", () => Absensi.setTab("tidak"));
        document.getElementById("btnTabHadir")?.addEventListener("click", () => Absensi.setTab("hadir"));
        document.getElementById("btnResetFilter")?.addEventListener("click", () => Absensi.resetFilter());
        document.getElementById("btnAturAbsensi")?.addEventListener("click", () => Absensi.bukaSetting());
        document.getElementById("btnAturTahunPanel")?.addEventListener("click", () => Absensi.bukaSetting());
        document.getElementById("btnBatalAbsensiSetting")?.addEventListener("click", () => Absensi.tutupSetting());
        document.getElementById("btnSimpanAbsensiSetting")?.addEventListener("click", () => Absensi.simpanSetting());
        document.getElementById("btnTambahTahunCfg")?.addEventListener("click", () => Absensi.tambahTahunDraft());
        document.getElementById("absCfgTambahInput")?.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); Absensi.tambahTahunDraft(); }
        });
        document.getElementById("absCfgTahunGrid")?.addEventListener("change", (e) => Absensi.onSettingGridChange(e, "tahun"));
        document.getElementById("absCfgPeriodeGrid")?.addEventListener("change", (e) => Absensi.onSettingGridChange(e, "periode"));
        document.getElementById("absCfgPeriodeGrid")?.addEventListener("click", (e) => {
            if (e.target.closest("#btnToggleArsipPeriode")) {
                if (Absensi.config.draft) {
                    Absensi.config.draft.showArsip = !Absensi.config.draft.showArsip;
                    Absensi.renderSettingModal();
                }
            }
        });
        document.getElementById("absCfgDefault")?.addEventListener("change", (e) => Absensi.onSettingDefaultChange(e));
        // Tombol fokus tahun (2026 / 2027) di sidebar
        document.getElementById("tahunTabs")?.addEventListener("click", (e) => {
            const b = e.target.closest("[data-tahun-fokus]");
            if (b) Absensi.setTahunFokus(parseInt(b.dataset.tahunFokus, 10));
        });
        ["filterQ", "filterStatus", "filterTanggal"].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener("input", () => Absensi.bacaFilter());
            if (id !== "filterQ") el.addEventListener("change", () => Absensi.bacaFilter());
        });
        document.getElementById("btnClearQ")?.addEventListener("click", () => {
            const el = document.getElementById("filterQ");
            if (el) { el.value = ""; el.focus(); }
            Absensi.bacaFilter();
        });
        document.getElementById("absensiDateRail")?.addEventListener("click", (e) => {
            const b = e.target.closest("[data-rail-tgl]");
            if (!b) return;
            const tgl = b.dataset.railTgl || "";
            const inp = document.getElementById("filterTanggal");
            if (inp) inp.value = (!tgl || inp.value === tgl) ? "" : tgl;
            Absensi.bacaFilter();
        });
        document.getElementById("absensiTopPanel")?.addEventListener("click", (e) => {
            const b = e.target.closest("[data-top-nama]");
            if (!b) return;
            const nama = decodeURIComponent(b.dataset.topNama || "");
            const inp = document.getElementById("filterQ");
            if (inp) inp.value = (Absensi.norm(inp.value) === Absensi.norm(nama)) ? "" : nama;
            Absensi.bacaFilter();
        });
        document.getElementById("absensiChips")?.addEventListener("click", (e) => {
            const b = e.target.closest("[data-abs-clearchip]");
            if (!b) return;
            const k = b.dataset.absClearchip;
            if (k === "q") { const el = document.getElementById("filterQ"); if (el) el.value = ""; }
            else if (k === "tanggal") { const el = document.getElementById("filterTanggal"); if (el) el.value = ""; }
            else if (k === "status") {
                const el = document.getElementById("filterStatus");
                if (el) el.value = "";
                try { if (window.Dropdown && Dropdown.segarkanSemua) Dropdown.segarkanSemua(); } catch {}
            }
            Absensi.bacaFilter();
        });
        document.getElementById("btnBatalAbsensi")?.addEventListener("click", () => Absensi.tutupForm());
        document.getElementById("btnSimpanAbsensi")?.addEventListener("click", () => Absensi.simpan());
        document.getElementById("tambahSearch")?.addEventListener("input", () => Absensi.renderTambahList());
        document.getElementById("absTanggal")?.addEventListener("input", () => {
            // Tanggal diganti saat form masih kosong: muat baris tercatat tanggal itu.
            // Kalau user sudah memilih, jangan utak-atik pilihannya.
            if (!Absensi.editTanggal && !document.querySelectorAll("#absensiRows .abs-row").length) Absensi.preloadTanggal();
            else Absensi.renderTambahList();
        });
        document.getElementById("tambahBelum")?.addEventListener("click", (e) => {
            const b = e.target.closest("[data-pilih]");
            if (b) Absensi.togglePilih(decodeURIComponent(b.dataset.pilih || ""));
        });
        document.getElementById("absensiWrap")?.addEventListener("click", (e) => {
            const eb = e.target.closest("[data-abs-edithari]");
            if (eb) { Absensi.editHari(eb.dataset.absEdithari); return; }
            const hb = e.target.closest("[data-abs-delhari]");
            if (hb) Absensi.hapusHari(hb.dataset.absDelhari);
        });
        document.getElementById("absensiRows")?.addEventListener("click", (e) => {
            const rb = e.target.closest("[data-abs-rmrow]");
            if (!rb) return;
            rb.closest(".abs-row")?.remove();
            Absensi.hitungPilih();
            Absensi.renderTambahList();
            FormPersist.touch("absensiForm");
        });
        document.getElementById("btnAbsenLangsung")?.addEventListener("click", () => Absensi.bukaLangsung());
        document.getElementById("btnBatalLangsung")?.addEventListener("click", () => Absensi.tutupLangsung());
        document.getElementById("btnSelesaiLangsung")?.addEventListener("click", () => Absensi.selesaiLangsung());
        ["langsungTanggal", "langsungKegiatan"].forEach(id => {
            document.getElementById(id)?.addEventListener("input", () => Absensi.bacaLangsung());
        });
        document.getElementById("langsungSearch")?.addEventListener("input", () => {
            Absensi.langsung.q = document.getElementById("langsungSearch").value || "";
            Absensi.langsung.activeIdx = 0;
            Absensi.renderLangsung();
        });
        document.getElementById("langsungSearch")?.addEventListener("keydown", (e) => Absensi.navLangsung(e));
        document.getElementById("langsungBelum")?.addEventListener("click", (e) => {
            const b = e.target.closest("[data-hadir]");
            if (b) Absensi.tandaiHadir(decodeURIComponent(b.dataset.hadir || ""));
        });
        document.getElementById("langsungSudah")?.addEventListener("click", (e) => {
            const b = e.target.closest("[data-batal-hadir]");
            if (b) Absensi.batalHadir(decodeURIComponent(b.dataset.batalHadir || ""));
        });
        ["absensiForm", "absenLangsung", "absensiSettingModal"].forEach(id => {
            document.getElementById(id)?.addEventListener("click", (e) => {
                if (e.target.id === id) {
                    if (id === "absensiForm") Absensi.tutupForm();
                    else if (id === "absenLangsung") Absensi.tutupLangsung();
                    else Absensi.tutupSetting();
                }
            });
        });
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            if (document.getElementById("absensiSettingModal")?.classList.contains("open")) { Absensi.tutupSetting(); return; }
            if (document.getElementById("absenLangsung")?.classList.contains("open")) { Absensi.tutupLangsung(); return; }
            if (document.getElementById("absensiForm")?.classList.contains("open")) Absensi.tutupForm();
        });
        // Draft otomatis: ketikan belum disubmit tetap ada walau popup ditutup / refresh
        if (typeof FormPersist !== "undefined") {
            FormPersist.watch("absensiForm", {
                fields: ["absTanggal", "absKegiatan"],
                observe: "#absensiRows",
                isEditing: () => !!Absensi.editTanggal,
                collect: () => ({ rows: Absensi.kumpulkanDraftRows() })
            });
        }
        Absensi.muat();
        // Muat periode global + config angkatan sekali, lalu segarkan tab tahun & roster (fail-silent)
        Promise.all([Absensi.muatPeriode(), Absensi.muatConfig()])
            .then(() => {
                Absensi.terapkanPeriodeBaru();
                return Absensi.muatRosterHadir(true);
            })
            .catch(() => Absensi.muatRosterHadir(true));
        window.addEventListener("osis:angkatan-ready", () => { try { Absensi.renderTahunTabs(); Absensi.render(); } catch {} });
    },


    fmtTanggalPanjang(t) {
        if (!t) return "-";
        const d = new Date(t + "T00:00:00");
        if (isNaN(d)) return t;
        return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    },

    fmtTanggalPendek(t) {
        if (!t) return "-";
        const d = new Date(t + "T00:00:00");
        if (isNaN(d)) return t;
        return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
    },

    fmtTanggalRail(t) {
        if (!t) return "-";
        const d = new Date(t + "T00:00:00");
        if (isNaN(d)) return t;
        return d.toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    },

    // "2026-09" -> "September 2026" (pembatas per bulan)
    fmtBulan(ym) {
        if (!ym) return "-";
        const d = new Date(ym + "-01T00:00:00");
        if (isNaN(d)) return ym;
        const s = d.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
        return s.charAt(0).toUpperCase() + s.slice(1);
    },

    labelStatus(s) {
        return s === "izin" ? "Izin" : s === "sakit" ? "Sakit" : "Alpha";
    },

    // ============ DATA ============
    async muat() {
        try {
            const cached = Cache.get("absensi");
            if (cached) {
                Absensi.cache = cached;
                Absensi.render();
                getAbsensi().then(fresh => {
                    if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                        Cache.set("absensi", fresh);
                        Absensi.cache = fresh || [];
                        Absensi.render();
                    }
                }).catch(() => {});
                return;
            }
            const data = await getAbsensi();
            Cache.set("absensi", data);
            Absensi.cache = data || [];
            Absensi.render();
        } catch (err) {
            console.error(err);
            document.getElementById("absensiWrap").innerHTML = `<div class="pesan-empty">Gagal memuat absensi.</div>`;
        }
    },

    async segarkan() {
        // Render cache dulu biar offline langsung tampil.
        const cached = Cache.get("absensi");
        if (cached) {
            Absensi.cache = cached || [];
            try { Absensi.render(); } catch {}
        }
        try {
            const data = await getAbsensi();
            if (JSON.stringify(data) !== JSON.stringify(cached)) {
                Cache.set("absensi", data);
                Absensi.cache = data || [];
                Absensi.render();
            }
        } catch (err) {
            console.error(err);
            if (!cached) showToast("Gagal memuat ulang: " + err.message, "error");
            try { Absensi.render(); } catch {}
        }
    },

    dataTampil() {
        const f = Absensi.filter;
        const q = f.q.trim().toLowerCase();
        const isHadir = f.tab === "hadir";
        return Absensi.cacheAktif().filter(r => {
            if (isHadir) {
                // Tab Hadir: kebalikan tab Tidak Hadir — cuma baris 'hadir'
                if (r.status !== "hadir") return false;
            } else {
                // Baris 'hadir' (Absen Langsung) tidak tampil di riwayat ketidakhadiran
                if (r.status === "hadir") return false;
                if (f.status && r.status !== f.status) return false;
            }
            // Fokus tahun (tombol periode): filter sesuai tahun fokus
            if (!Absensi.cocokFokus(r.nama, isHadir)) return false;
            if (f.tanggal && String(r.tanggal) !== String(f.tanggal)) return false;
            if (q && !(String(r.nama || "").toLowerCase().includes(q) || String(r.kegiatan || "").toLowerCase().includes(q))) return false;
            return true;
        });
    },

    // Pindah tab Hadir / Tidak Hadir. Filter status cuma berlaku di tab
    // Tidak Hadir — di-reset tiap pindah biar tidak bingung.
    setTab(t) {
        Absensi.filter.tab = (t === "hadir") ? "hadir" : "tidak";
        const isHadir = Absensi.filter.tab === "hadir";
        Absensi.filter.status = "";
        const st = document.getElementById("filterStatus");
        if (st) {
            st.value = "";
            st.disabled = isHadir;
            st.hidden = isHadir;
            const f = st.closest(".osis-sb-field, .field");
            if (f) f.style.display = isHadir ? "none" : "";
        }
        try { if (window.Dropdown && Dropdown.segarkanSemua) Dropdown.segarkanSemua(); } catch {}
        try { window.OsisSearch?.sync?.("absTopSearch"); } catch {}
        const bT = document.getElementById("btnTabTidak");
        const bH = document.getElementById("btnTabHadir");
        if (bT) bT.className = isHadir ? "" : "on-tidak";
        if (bH) bH.className = isHadir ? "on-hadir" : "";
        Absensi.render();
        // Tab Hadir butuh roster anggota buat hitung otomatis — muat duluan
        if (isHadir) Absensi.muatRosterHadir();
    },

    kunciTahunFokus() {
        const angId = (typeof DbScope !== "undefined" && DbScope.angkatanId) ? DbScope.angkatanId() : null;
        return "absensi_tahun_fokus" + (angId ? "_ang_" + angId : "");
    },

    tahunAngkatanIni() {
        const obj = (typeof OsisAuth !== "undefined" && OsisAuth.getAngkatanAktifObj) ? OsisAuth.getAngkatanAktifObj() : null;
        const t = obj && obj.tahun != null ? parseInt(obj.tahun, 10) : NaN;
        return Number.isFinite(t) ? t : null;
    },

    tahunRosterList(sourceList) {
        const src = sourceList || Absensi.langsung._cacheList || Absensi.langsung.anggota || [];
        return [...new Set(src
            .map(o => (o && typeof o === "object" ? parseInt(o.tahun, 10) : NaN))
            .filter(Number.isFinite)
        )].sort((a, b) => a - b);
    },

    // ============ FOKUS TAHUN (tombol periode di panel sidebar) ============
    // Urutan prioritas:
    // 1) Setting tahun_aktif per angkatan (osis_absensi_config), kalau non-empty
    // 2) Irisan tahun roster angkatan aktif vs periode.aktif global
    // 3) Semua tahun di roster angkatan (cth: arsip lama / ADIABI-3)
    // 4) Fallback angkatan.tahun / periode.aktif saat roster belum selesai dimuat
    tahunAktifList() {
        const cfgAktif = (Absensi.config.tahunAktif || []).filter(Number.isFinite);
        if (cfgAktif.length) return [...new Set(cfgAktif)].sort((a, b) => a - b);

        const globalAktif = (Absensi.langsung.periodeTahun || []).filter(Number.isFinite);
        const angYears = Absensi.tahunRosterList(Absensi.langsung._cacheList);
        if (angYears.length) {
            const cocok = angYears.filter(y => globalAktif.includes(y));
            return cocok.length ? cocok : angYears;
        }
        const thAng = Absensi.tahunAngkatanIni();
        if (thAng != null) return [thAng];
        return globalAktif;
    },

    tahunUtamaNonRoster(thns) {
        const list = (thns && thns.length) ? thns : Absensi.tahunAktifList();
        if (!list.length) return null;
        if (Number.isFinite(Absensi.config.tahunDefault) && list.includes(Absensi.config.tahunDefault)) {
            return Absensi.config.tahunDefault;
        }
        const thAng = Absensi.tahunAngkatanIni();
        if (thAng != null && list.includes(thAng)) return thAng;
        return list[0];
    },

    renderTahunTabs() {
        const box = document.getElementById("tahunTabs");
        const panel = document.getElementById("tahunPanel");
        if (!box) return;
        const thns = Absensi.tahunAktifList();
        const bolehAtur = (typeof OsisAuth !== "undefined" && OsisAuth.bisa && OsisAuth.bisa("absensi"));
        if (!thns.length) {
            const berubahKosong = Absensi.langsung.tahunFokus !== null;
            Absensi.langsung.tahunFokus = null;
            box.innerHTML = bolehAtur
                ? `<div class="abs-panel-empty" style="width:100%">Belum ada tahun aktif dipilih. Klik <b>Atur</b> untuk memilih.</div>`
                : "";
            box.style.display = bolehAtur ? "" : "none";
            if (panel) panel.style.display = bolehAtur ? "" : "none";
            if (berubahKosong) { try { Absensi.render(); } catch {} }
            return;
        }
        // Selalu ada 1 kepilih: pulihkan pilihan per angkatan -> tahun default config -> tahun angkatan -> kiri
        let f = Absensi.langsung.tahunFokus;
        if (!thns.includes(f)) {
            try { f = parseInt(localStorage.getItem(Absensi.kunciTahunFokus()), 10); } catch { f = NaN; }
            if (!thns.includes(f) && Number.isFinite(Absensi.config.tahunDefault) && thns.includes(Absensi.config.tahunDefault)) {
                f = Absensi.config.tahunDefault;
            }
            if (!thns.includes(f)) {
                const thAng = Absensi.tahunAngkatanIni();
                if (thAng != null && thns.includes(thAng)) f = thAng;
            }
            if (!thns.includes(f)) f = thns[0];
        }
        const berubah = Absensi.langsung.tahunFokus !== f;
        Absensi.langsung.tahunFokus = f;
        const cntPerTahun = {};
        (Absensi.langsung.anggota || []).forEach(o => {
            const t = (o && typeof o === "object") ? o.tahun : null;
            if (t != null) cntPerTahun[t] = (cntPerTahun[t] || 0) + 1;
        });
        if (panel) panel.style.display = "";
        box.style.display = "";
        box.innerHTML = thns.map(t =>
            `<button type="button" class="${f === t ? "on" : ""}" data-tahun-fokus="${t}"><i class="fa-solid fa-calendar"></i> ${t}${cntPerTahun[t] ? ` <small>${cntPerTahun[t]}</small>` : ""}</button>`
        ).join("");
        if (berubah) {
            Absensi.renderLangsung();
            Absensi.renderTambahList();
            try { Absensi.render(); } catch {}
        }
    },

    setTahunFokus(t) {
        if (!Number.isFinite(t)) return;
        // Klik tab yang sedang aktif = tetap (tidak bisa kosong)
        Absensi.langsung.tahunFokus = t;
        try { localStorage.setItem(Absensi.kunciTahunFokus(), String(t)); } catch {}
        Absensi.langsung.activeIdx = 0;
        Absensi.renderTahunTabs();
        Absensi.renderLangsung();
        Absensi.renderTambahList();
        Absensi.render();
        // Pastikan roster terbaru buat pemetaan nama riwayat (fail-silent)
        Absensi.muatRosterHadir();
    },

    // Roster sudah dibatasi fokus? (dipakai daftar Langsung + form Tambah)
    rosterFokus() {
        const roster = Absensi.langsung.anggota || [];
        const f = Absensi.langsung.tahunFokus;
        if (f == null) return roster;
        return roster.filter(o => ((o && typeof o === "object" ? o.tahun : null) ?? null) === f);
    },

    // Peta nama -> tahun-tahun roster angkatan ini (dipakai pisahkan riwayat per tab tahun).
    petaTahun() {
        const m = new Map();
        const src = Absensi.langsung._cacheList || Absensi.langsung.anggota || [];
        src.forEach(o => {
            const nama = (o && typeof o === "object") ? o.nama : o;
            const rawT = (o && typeof o === "object" ? o.tahun : null);
            const t = rawT != null ? parseInt(rawT, 10) : NaN;
            const k = Absensi.norm(nama);
            if (!k) return;
            if (!m.has(k)) m.set(k, new Set());
            if (Number.isFinite(t)) m.get(k).add(t);
        });
        return m;
    },

    // Baris riwayat masuk tahun fokus?
    // Sebelum roster selesai dimuat (_rosterSiap=false), jangan sembunyikan data dulu.
    cocokFokus(nama, isHadirRow = false) {
        const f = Absensi.langsung.tahunFokus;
        if (f == null || !Absensi.langsung._rosterSiap) return true;
        const s = Absensi.petaTahun().get(Absensi.norm(nama));
        if (s && s.size > 0) return s.has(f);
        if (isHadirRow) return true;
        const thns = Absensi.tahunAktifList();
        return thns.length <= 1 || f === Absensi.tahunUtamaNonRoster(thns);
    },

    // Baris milik angkatan sendiri ATAU angkatan yg tahunnya termasuk tahunAktifList.
    rowAktif(r) {
        if (!r || !r.angkatan_id) return true;
        const list = (typeof OsisAuth !== "undefined" && OsisAuth.getAngkatanList) ? (OsisAuth.getAngkatanList() || []) : [];
        if (!list.length) return true;
        const myAngId = (typeof DbScope !== "undefined" && DbScope.angkatanId) ? DbScope.angkatanId() : null;
        if (myAngId && String(r.angkatan_id) === String(myAngId)) return true;
        const thns = Absensi.tahunAktifList();
        const ang = list.find(a => String(a.id) === String(r.angkatan_id));
        if (!ang) return true;
        return ang.tahun != null && thns.includes(Number(ang.tahun));
    },

    cacheAktif() {
        return (Absensi.cache || []).filter(r => Absensi.rowAktif(r));
    },

    angkatanIdUntukFokus() {
        const list = (typeof OsisAuth !== "undefined" && OsisAuth.getAngkatanList) ? (OsisAuth.getAngkatanList() || []) : [];
        const f = Absensi.langsung.tahunFokus;
        if (f != null && list.length) {
            const match = list.find(a => Number(a.tahun) === Number(f));
            if (match && match.id) return match.id;
        }
        return (typeof DbScope !== "undefined" && DbScope.angkatanId) ? DbScope.angkatanId() : null;
    },

    angkatanIdUntuk(nama) {
        const k = Absensi.norm(nama);
        const f = Absensi.langsung.tahunFokus;
        const src = Absensi.langsung._cacheList || [];
        if (k && src.length) {
            const exact = f != null
                ? src.find(a => Absensi.norm(a.nama) === k && parseInt(a.tahun, 10) === Number(f) && a.angkatan_id)
                : null;
            if (exact && exact.angkatan_id) return exact.angkatan_id;
            const any = src.find(a => Absensi.norm(a.nama) === k && a.angkatan_id);
            if (any && any.angkatan_id) return any.angkatan_id;
        }
        return Absensi.angkatanIdUntukFokus();
    },

    // ============ RENDER ============
    setStatSlot(idx, idVal, labelHtml, count, suffix, sub) {
        const lbl = document.getElementById("lblStat" + idx);
        if (lbl) lbl.innerHTML = labelHtml;
        const el = document.getElementById(idVal);
        if (el) el.innerHTML = escapeHtml(String(count)) + (suffix ? `<span class="stat-suffix"> ${escapeHtml(suffix)}</span>` : "");
        const subEl = document.getElementById("subStat" + idx);
        if (subEl) subEl.textContent = sub || "-";
    },

    renderFilterBar(nItem, nHari, isHadir) {
        const qVal = document.getElementById("filterQ")?.value || "";
        const btnClear = document.getElementById("btnClearQ");
        if (btnClear) btnClear.style.display = qVal ? "" : "none";
        try { window.OsisSearch?.sync?.("absTopSearch"); } catch {}

        const bar = document.getElementById("absensiBar");
        const countEl = document.getElementById("absensiBarCount");
        const chipsEl = document.getElementById("absensiChips");
        if (!bar || !countEl || !chipsEl) return;

        const f = Absensi.filter;
        const adaFilter = !!(f.q.trim() || f.tanggal || (!isHadir && f.status));
        if (!adaFilter && nHari === 0) {
            bar.style.display = "none";
            return;
        }
        bar.style.display = "";
        countEl.innerHTML = isHadir
            ? `Menampilkan <b>${nHari}</b> hari kehadiran (<b>${nItem}</b> entri)`
            : `Menampilkan <b>${nItem}</b> catatan di <b>${nHari}</b> hari`;

        const chips = [];
        if (f.q.trim()) {
            chips.push(`<button type="button" class="abs-chip" data-abs-clearchip="q">Cari: "${escapeHtml(f.q.trim())}" <i class="fa-solid fa-xmark"></i></button>`);
        }
        if (f.tanggal) {
            chips.push(`<button type="button" class="abs-chip" data-abs-clearchip="tanggal">Tanggal: ${escapeHtml(Absensi.fmtTanggalPendek(f.tanggal))} <i class="fa-solid fa-xmark"></i></button>`);
        }
        if (!isHadir && f.status) {
            chips.push(`<button type="button" class="abs-chip" data-abs-clearchip="status">Status: ${escapeHtml(Absensi.labelStatus(f.status))} <i class="fa-solid fa-xmark"></i></button>`);
        }
        chipsEl.innerHTML = chips.join("");
    },

    renderSidePanels(isHadir) {
        const all = Absensi.cacheAktif();
        const railEl = document.getElementById("absensiDateRail");
        const cntEl = document.getElementById("dateRailCount");
        const topEl = document.getElementById("absensiTopPanel");
        const topTitleEl = document.getElementById("topPanelTitle");

        // 1. Rail Tanggal Cepat
        if (railEl) {
            const perTgl = {};
            all.forEach(r => {
                if (!r.tanggal) return;
                const isH = r.status === "hadir";
                if (!Absensi.cocokFokus(r.nama, isH)) return;
                const t = String(r.tanggal);
                if (!perTgl[t]) perTgl[t] = { keg: "", tk: 0, hTersimpan: 0 };
                if (!perTgl[t].keg && String(r.kegiatan || "").trim()) perTgl[t].keg = String(r.kegiatan).trim();
                if (isH) perTgl[t].hTersimpan++;
                else perTgl[t].tk++;
            });
            const tgls = Object.keys(perTgl).sort().reverse();
            if (cntEl) cntEl.textContent = String(tgls.length);
            const tAktif = Absensi.filter.tanggal || "";
            const btnSemua = `
                <button type="button" class="abs-date-btn${!tAktif ? " active" : ""}" data-rail-tgl="">
                    <span class="abs-date-txt"><b>Semua Tanggal</b><small>Tampilkan seluruh riwayat</small></span>
                    <span class="abs-date-badge">${tgls.length} hari</span>
                </button>`;
            const itemsHtml = tgls.map(t => {
                const info = perTgl[t];
                let badge = "";
                if (isHadir) {
                    const h = Absensi.hadirTanggal(t);
                    const jmlH = h.daftar.filter(n => Absensi.cocokFokus(n, !h.otomatis)).length;
                    badge = `${jmlH} H`;
                } else {
                    badge = info.tk ? `${info.tk} TK` : `${info.hTersimpan} H`;
                }
                return `
                <button type="button" class="abs-date-btn${tAktif === t ? " active" : ""}" data-rail-tgl="${escapeHtml(t)}" title="${escapeHtml(Absensi.fmtTanggalPanjang(t))}">
                    <span class="abs-date-txt"><b>${escapeHtml(Absensi.fmtTanggalRail(t))}</b><small>${escapeHtml(info.keg || "Tanpa nama kegiatan")}</small></span>
                    <span class="abs-date-badge">${escapeHtml(badge)}</span>
                </button>`;
            }).join("");
            railEl.innerHTML = btnSemua + itemsHtml;
        }

        // 2. Top Ketidakhadiran / Kehadiran Teraktif
        if (topEl) {
            const qNorm = Absensi.norm(Absensi.filter.q || "");
            if (!isHadir) {
                if (topTitleEl) topTitleEl.innerHTML = `<i class="fa-solid fa-chart-simple"></i> Top Ketidakhadiran`;
                const rekap = {};
                all.filter(r => r.status !== "hadir" && Absensi.cocokFokus(r.nama)).forEach(r => {
                    const nama = String(r.nama || "").trim();
                    const k = Absensi.norm(nama);
                    if (!k) return;
                    if (!rekap[k]) rekap[k] = { nama, izin: 0, sakit: 0, alpha: 0, total: 0 };
                    if (r.status === "izin") rekap[k].izin++;
                    else if (r.status === "sakit") rekap[k].sakit++;
                    else if (r.status === "alpha") rekap[k].alpha++;
                    rekap[k].total++;
                });
                const top = Object.values(rekap)
                    .sort((a, b) => b.total - a.total || b.alpha - a.alpha || a.nama.localeCompare(b.nama))
                    .slice(0, 6);
                topEl.innerHTML = top.length
                    ? top.map((o, i) => {
                        const det = [o.alpha ? `${o.alpha}A` : "", o.izin ? `${o.izin}I` : "", o.sakit ? `${o.sakit}S` : ""].filter(Boolean).join(" · ");
                        const akt = qNorm && qNorm === Absensi.norm(o.nama);
                        return `<button type="button" class="abs-top-item${i === 0 ? " r1" : ""}${akt ? " active" : ""}" data-top-nama="${encodeURIComponent(o.nama)}" title="Filter nama ${escapeHtml(o.nama)}">
                            <span class="abs-top-rank">${i + 1}</span>
                            <span class="abs-top-info"><b>${escapeHtml(o.nama)}</b><small>${escapeHtml(det || "-")}</small></span>
                            <span class="abs-top-cnt">${o.total}x</span>
                        </button>`;
                    }).join("")
                    : `<div class="abs-panel-empty">Belum ada catatan ketidakhadiran.</div>`;
            } else {
                if (topTitleEl) topTitleEl.innerHTML = `<i class="fa-solid fa-award"></i> Kehadiran Teraktif`;
                const tglMap = new Set();
                all.forEach(r => {
                    if (!r.tanggal) return;
                    if (!Absensi.cocokFokus(r.nama, r.status === "hadir")) return;
                    tglMap.add(String(r.tanggal));
                });
                const hitung = {};
                tglMap.forEach(t => {
                    const h = Absensi.hadirTanggal(t);
                    const daftar = h.daftar.filter(n => Absensi.cocokFokus(n, !h.otomatis));
                    const unikHari = new Set();
                    daftar.forEach(n => {
                        const k = Absensi.norm(n);
                        if (!k || unikHari.has(k)) return;
                        unikHari.add(k);
                        if (!hitung[k]) hitung[k] = { nama: n, total: 0 };
                        hitung[k].total++;
                    });
                });
                const top = Object.values(hitung)
                    .sort((a, b) => b.total - a.total || a.nama.localeCompare(b.nama))
                    .slice(0, 6);
                topEl.innerHTML = top.length
                    ? top.map((o, i) => {
                        const akt = qNorm && qNorm === Absensi.norm(o.nama);
                        return `<button type="button" class="abs-top-item${i === 0 ? " r1" : ""}${akt ? " active" : ""}" data-top-nama="${encodeURIComponent(o.nama)}" title="Filter nama ${escapeHtml(o.nama)}">
                            <span class="abs-top-rank">${i + 1}</span>
                            <span class="abs-top-info"><b>${escapeHtml(o.nama)}</b><small>tercatat hadir</small></span>
                            <span class="abs-top-cnt">${o.total} sesi</span>
                        </button>`;
                    }).join("")
                    : `<div class="abs-panel-empty">Belum ada data hadir.</div>`;
            }
        }
    },

    render() {
        if (Absensi.filter.tab === "hadir") { Absensi.renderHadir(); return; }
        const statsGrid = document.getElementById("absensiStats");
        if (statsGrid) statsGrid.classList.remove("mode-hadir");
        ["statIzin", "statSakit", "statAlpha", "statTotal"].forEach(id => {
            const card = document.getElementById(id)?.closest(".stat-card");
            if (card) card.style.display = "";
        });

        const data = Absensi.dataTampil();
        const all = Absensi.cacheAktif();
        const allTK = all.filter(r => r.status !== "hadir" && Absensi.cocokFokus(r.nama));
        let tTarget = Absensi.filter.tanggal || "";
        if (!tTarget && allTK.length) {
            tTarget = allTK.map(r => String(r.tanggal || "")).filter(Boolean).sort().reverse()[0] || "";
        }
        const statRows = tTarget ? allTK.filter(r => String(r.tanggal) === String(tTarget)) : [];
        const n = (s) => statRows.filter(r => r.status === s).length;
        const tglSub = tTarget ? Absensi.fmtTanggalPendek(tTarget) : "belum ada sesi";
        const jmlHariUnik = new Set(allTK.map(r => r.tanggal).filter(Boolean)).size;

        Absensi.setStatSlot(1, "statIzin", "Izin", n("izin"), "pengurus", tglSub);
        Absensi.setStatSlot(2, "statSakit", "Sakit", n("sakit"), "pengurus", tglSub);
        Absensi.setStatSlot(3, "statAlpha", "Alpha", n("alpha"), "pengurus", tglSub);
        Absensi.setStatSlot(4, "statTotal", "Total Tidak Hadir", statRows.length, "orang", `${allTK.length} catatan di ${jmlHariUnik} hari`);

        Absensi.renderSidePanels(false);

        const wrap = document.getElementById("absensiWrap");
        if (!wrap) return;
        const boleh = OsisAuth.bisa("absensi");
        if (!allTK.length) {
            Absensi.renderFilterBar(0, 0, false);
            wrap.innerHTML = `<div class="rekap-card" style="text-align:center; padding:30px 16px"><div style="font-size:2rem; margin-bottom:8px"><i class="fa-solid fa-clipboard-user" style="color:var(--red)"></i></div><b>Belum ada data ketidakhadiran</b><p style="font-size:0.82rem; color:var(--gray); margin:6px 0 14px">Catat pengurus yang izin, sakit, atau alpha pada periode ini.</p>${boleh ? `<button class="btn btn-red btn-sm" onclick="Absensi.bukaForm()"><i class="fa-solid fa-plus"></i> Tambah Data</button>` : ""}</div>`;
            return;
        }
        if (!data.length) {
            Absensi.renderFilterBar(0, 0, false);
            if (Absensi.filter.tanggal && !Absensi.filter.q.trim() && !Absensi.filter.status) {
                wrap.innerHTML = `<div class="rekap-card" style="text-align:center; padding:30px 16px"><div style="font-size:2rem; margin-bottom:8px"><i class="fa-solid fa-circle-check" style="color:#146314"></i></div><b>Semua pengurus hadir.</b><p style="font-size:0.82rem; color:var(--gray); margin:6px 0 12px">Tidak ada catatan izin, sakit, atau alpha pada tanggal ini.</p><button class="btn btn-white btn-sm" onclick="Absensi.resetFilter()"><i class="fa-solid fa-rotate-left"></i> Lihat Semua Tanggal</button></div>`;
            } else {
                wrap.innerHTML = `<div class="rekap-card" style="text-align:center; padding:26px 14px"><i class="fa-solid fa-magnifying-glass" style="font-size:1.5rem; color:var(--red); margin-bottom:8px"></i><div style="font-weight:900">Tidak ada yang cocok dengan filter</div><p style="font-size:0.8rem; color:var(--gray); margin:4px 0 12px">Coba ubah kata kunci, status, atau pilih tanggal lain.</p><button class="btn btn-white btn-sm" onclick="Absensi.resetFilter()"><i class="fa-solid fa-rotate-left"></i> Reset Filter</button></div>`;
            }
            return;
        }

        const grup = {};
        data.forEach(r => { (grup[r.tanggal] = grup[r.tanggal] || []).push(r); });
        const tgls = Object.keys(grup).sort().reverse();
        Absensi.renderFilterBar(data.length, tgls.length, false);

        // Bagi per bulan (terbaru dulu): pembatas bulan + kartu per hari
        const perBulan = {};
        tgls.forEach(t => { const ym = String(t).slice(0, 7); (perBulan[ym] = perBulan[ym] || []).push(t); });
        const kartuHari = (t) => {
            const rows = grup[t].slice().sort((a, b) => String(a.nama || "").localeCompare(String(b.nama || "")));
            const keg = (rows.map(r => String(r.kegiatan || "").trim()).find(Boolean) || "");
            const pencatat = [...new Set(rows.map(r => String(r.pengunggah || "").trim()).filter(Boolean))].join(", ");
            const cIzin = rows.filter(r => r.status === "izin").length;
            const cSakit = rows.filter(r => r.status === "sakit").length;
            const cAlpha = rows.filter(r => r.status === "alpha").length;
            const nHadirRaw = all.filter(r => String(r.tanggal) === String(t) && r.status === "hadir" && Absensi.cocokFokus(r.nama, true)).length;
            const sumSeg = nHadirRaw + cIzin + cSakit + cAlpha;
            const segHtml = sumSeg > 0 ? `<div class="abs-ratio-bar" title="Proporsi Hadir / Izin / Sakit / Alpha">
                ${nHadirRaw ? `<span class="abs-ratio-seg hadir" style="width:${(nHadirRaw / sumSeg * 100).toFixed(1)}%"></span>` : ""}
                ${cIzin ? `<span class="abs-ratio-seg izin" style="width:${(cIzin / sumSeg * 100).toFixed(1)}%"></span>` : ""}
                ${cSakit ? `<span class="abs-ratio-seg sakit" style="width:${(cSakit / sumSeg * 100).toFixed(1)}%"></span>` : ""}
                ${cAlpha ? `<span class="abs-ratio-seg alpha" style="width:${(cAlpha / sumSeg * 100).toFixed(1)}%"></span>` : ""}
            </div>` : "";
            return `<div class="rekap-card">
                <div class="rekap-card-head">
                    <h3><i class="fa-solid fa-calendar-day"></i> ${escapeHtml(Absensi.fmtTanggalPanjang(t))}</h3>
                    <div class="rekap-badges">
                        ${nHadirRaw ? `<span class="jenis hadir">${nHadirRaw} Hadir</span>` : ""}
                        ${cIzin ? `<span class="jenis izin">${cIzin} Izin</span>` : ""}
                        ${cSakit ? `<span class="jenis sakit">${cSakit} Sakit</span>` : ""}
                        ${cAlpha ? `<span class="jenis alpha">${cAlpha} Alpha</span>` : ""}
                        <span class="jenis total">${rows.length} tidak hadir</span>
                    </div>
                </div>
                ${(keg || pencatat) ? `<div class="rekap-meta-row">
                    ${keg ? `<span><i class="fa-solid fa-bullhorn"></i> ${escapeHtml(keg)}</span>` : ""}
                    ${pencatat ? `<span><i class="fa-solid fa-user-pen"></i> Dicatat oleh ${escapeHtml(pencatat)}</span>` : ""}
                </div>` : ""}
                ${segHtml}
                <div class="kas-scroll"><table class="kas-tabel"><thead><tr><th>No</th><th>Nama</th><th>Status</th><th>Alasan</th></tr></thead><tbody>
                ${rows.map((r, i) => `<tr>
                    <td>${i + 1}</td>
                    <td><b>${escapeHtml(r.nama || "-")}</b></td>
                    <td><span class="jenis ${r.status}">${Absensi.labelStatus(r.status)}</span></td>
                    <td>${r.alasan ? escapeHtml(r.alasan) : `<span class="alasan-kosong">Tanpa keterangan</span>`}</td>
                </tr>`).join("")}
                </tbody></table></div>
                ${boleh ? `<div class="rekap-foot">
                    <button class="btn btn-white btn-sm" data-abs-edithari="${t}"><i class="fa-solid fa-pen"></i> Edit</button>
                    <button class="btn btn-red btn-sm" data-abs-delhari="${t}"><i class="fa-solid fa-trash-can"></i> Hapus</button>
                </div>` : ""}
            </div>`;
        };
        wrap.innerHTML = Object.keys(perBulan).sort().reverse().map(ym => {
            const hari = perBulan[ym];
            const total = hari.reduce((a, t) => a + grup[t].length, 0);
            return `<div class="bulan-sep"><i class="fa-solid fa-calendar"></i> ${escapeHtml(Absensi.fmtBulan(ym))}<span class="cnt">${total} tidak hadir</span></div>`
                + hari.map(kartuHari).join("");
        }).join("");
    },

    // ============ TAB HADIR (kebalikan otomatis dari tidak hadir) ============
    // Per tanggal: baris 'hadir' tersimpan (Absen Langsung) diutamakan.
    // Kalau tidak ada, hadir = roster anggota − nama yang tercatat.
    hadirTanggal(t) {
        const hari = Absensi.cacheAktif().filter(r => String(r.tanggal) === String(t));
        const tersimpan = hari.filter(r => r.status === "hadir")
            .map(r => String(r.nama || "").trim()).filter(Boolean)
            .sort((a, b) => a.localeCompare(b));
        if (tersimpan.length) return { daftar: tersimpan, otomatis: false };
        const unik = new Set();
        const roster = [];
        Absensi.rosterFokus().forEach(r => {
            const n = String(r && typeof r === "object" ? r.nama : r || "").trim();
            const k = Absensi.norm(n);
            if (!n || unik.has(k)) return;
            unik.add(k);
            roster.push(n);
        });
        const catat = new Set(hari.map(r => Absensi.norm(r.nama)));
        return { daftar: roster.filter(n => !catat.has(Absensi.norm(n))), otomatis: true };
    },

    // Roster anggota + config tahun aktif. Cache-first, fail-silent (tanpa toast).
    // Render ulang kalau tab Hadir aktif ATAU tahun fokus sedang dipakai.
    async muatRosterHadir(skipMeta = false) {
        // Render ulang kalau hasilnya kepakai di layar sekarang
        const perluRender = () => Absensi.filter.tab === "hadir" || Absensi.langsung.tahunFokus != null;
        try {
            if (!skipMeta) {
                await Promise.all([Absensi.muatPeriode(), Absensi.muatConfig()]);
            }
            const cached = (typeof Cache !== "undefined") ? Cache.get("anggota") : null;
            if (cached && cached.length) {
                const sebelum = JSON.stringify(Absensi.langsung.anggota || []);
                Absensi.pakaiAnggota(cached);
                if (JSON.stringify(Absensi.langsung.anggota || []) !== sebelum && perluRender()) Absensi.render();
                getAnggota().then(fresh => {
                    if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                        Cache.set("anggota", fresh);
                        Absensi.pakaiAnggota(fresh);
                        if (perluRender()) Absensi.render();
                    }
                }).catch(() => {});
                return;
            }
            const fresh = await getAnggota();
            if (typeof Cache !== "undefined") Cache.set("anggota", fresh);
            Absensi.pakaiAnggota(fresh);
            if (perluRender()) Absensi.render();
        } catch (err) { console.error(err); }
    },

    renderHadir() {
        const statsGrid = document.getElementById("absensiStats");
        if (statsGrid) statsGrid.classList.add("mode-hadir");
        ["statIzin", "statSakit", "statAlpha", "statTotal"].forEach(id => {
            const card = document.getElementById(id)?.closest(".stat-card");
            if (card) card.style.display = "";
        });

        const all = Absensi.cacheAktif();
        const q = Absensi.filter.q.trim().toLowerCase();
        const tglSet = {};
        all.forEach(r => {
            if (!r.tanggal) return;
            if (!Absensi.cocokFokus(r.nama, r.status === "hadir")) return;
            if (Absensi.filter.tanggal && String(r.tanggal) !== String(Absensi.filter.tanggal)) return;
            tglSet[String(r.tanggal)] = true;
        });
        const grupHadir = {};
        Object.keys(tglSet).sort().reverse().forEach(t => {
            const h = Absensi.hadirTanggal(t);
            const hariRows = all.filter(r => String(r.tanggal) === String(t));
            const keg = (hariRows.map(r => String(r.kegiatan || "").trim()).find(Boolean) || "");
            const tkCount = hariRows.filter(r => r.status !== "hadir" && Absensi.cocokFokus(r.nama)).length;
            const daftar = h.daftar.filter(n => Absensi.cocokFokus(n, !h.otomatis));
            if (q && !(daftar.some(n => n.toLowerCase().includes(q)) || keg.toLowerCase().includes(q))) return;
            grupHadir[t] = { daftar, otomatis: h.otomatis, keg, tkCount };
        });
        const tgls = Object.keys(grupHadir).sort().reverse();

        const tTarget = Absensi.filter.tanggal || (tgls[0] || "");
        const gTarget = tTarget && grupHadir[tTarget] ? grupHadir[tTarget] : null;
        const nHadirTarget = gTarget ? gTarget.daftar.length : 0;
        const nTkTarget = gTarget ? gTarget.tkCount : 0;
        const denomTarget = nHadirTarget + nTkTarget;
        const pctTarget = denomTarget > 0 ? Math.round((nHadirTarget / denomTarget) * 100) + "%" : "0%";
        const manualDays = tgls.filter(t => !grupHadir[t].otomatis).length;
        const rosterLen = Absensi.rosterFokus().length;
        const tahunLbl = Absensi.langsung.tahunFokus ? ("Periode " + Absensi.langsung.tahunFokus) : "periode aktif";

        Absensi.setStatSlot(
            1,
            "statIzin",
            "Hadir Sesi Ini",
            nHadirTarget,
            "pengurus",
            tTarget ? Absensi.fmtTanggalPendek(tTarget) : "belum ada sesi"
        );
        Absensi.setStatSlot(
            2,
            "statSakit",
            "Tingkat Hadir",
            pctTarget,
            "",
            gTarget ? `${nTkTarget} tidak hadir di sesi ini` : "menunggu data"
        );
        Absensi.setStatSlot(
            3,
            "statAlpha",
            "Sesi Tercatat",
            tgls.length,
            "hari",
            `${manualDays} sesi langsung / QR`
        );
        Absensi.setStatSlot(
            4,
            "statTotal",
            "Roster Aktif",
            rosterLen,
            "pengurus",
            tahunLbl
        );

        Absensi.renderSidePanels(true);

        const wrap = document.getElementById("absensiWrap");
        if (!wrap) return;
        const boleh = OsisAuth.bisa("absensi");
        const totalEntriHadir = tgls.reduce((a, t) => a + grupHadir[t].daftar.length, 0);
        Absensi.renderFilterBar(totalEntriHadir, tgls.length, true);

        if (!tgls.length) {
            if (Absensi.filter.tanggal || q) {
                wrap.innerHTML = `<div class="rekap-card" style="text-align:center; padding:26px 14px"><i class="fa-solid fa-magnifying-glass" style="font-size:1.5rem; color:var(--red); margin-bottom:8px"></i><div style="font-weight:900">Tidak ada data hadir yang cocok</div><p style="font-size:0.8rem; color:var(--gray); margin:4px 0 12px">Coba ubah pencarian atau pilih tanggal lain.</p><button class="btn btn-white btn-sm" onclick="Absensi.resetFilter()"><i class="fa-solid fa-rotate-left"></i> Reset Filter</button></div>`;
            } else {
                wrap.innerHTML = `<div class="rekap-card" style="text-align:center; padding:30px 16px"><div style="font-size:2rem; margin-bottom:8px"><i class="fa-solid fa-user-check" style="color:#146314"></i></div><b>Belum ada data kehadiran</b><p style="font-size:0.82rem; color:var(--gray); margin:6px 0 14px">Tandai kehadiran pengurus lewat Absen Langsung atau Scan QR.</p>${boleh ? `<button class="btn btn-red btn-sm" onclick="Absensi.bukaLangsung()"><i class="fa-solid fa-bolt"></i> Absen Langsung</button>` : ""}</div>`;
            }
            return;
        }
        const perBulan = {};
        tgls.forEach(t => { const ym = String(t).slice(0, 7); (perBulan[ym] = perBulan[ym] || []).push(t); });
        const kartuHari = (t) => {
            const g = grupHadir[t];
            const denom = g.daftar.length + g.tkCount;
            const pct = denom > 0 ? Math.round((g.daftar.length / denom) * 100) : 0;
            return `<div class="rekap-card">
                <div class="rekap-card-head">
                    <h3><i class="fa-solid fa-calendar-day"></i> ${escapeHtml(Absensi.fmtTanggalPanjang(t))}</h3>
                    <div class="rekap-badges">
                        ${denom > 0 ? `<span class="jenis total">${pct}% hadir</span>` : ""}
                        <span class="jenis hadir">${g.daftar.length} hadir</span>
                    </div>
                </div>
                <div class="rekap-meta-row">
                    ${g.keg ? `<span><i class="fa-solid fa-bullhorn"></i> ${escapeHtml(g.keg)}</span>` : ""}
                    <span><i class="fa-solid ${g.otomatis ? "fa-wand-magic-sparkles" : "fa-qrcode"}"></i> ${g.otomatis ? "Otomatis: roster − tidak hadir" : "Tercatat langsung / QR"}</span>
                </div>
                ${g.daftar.length
                    ? `<div class="hadir-grid">${g.daftar.map((n, i) => {
                        const hit = q && n.toLowerCase().includes(q);
                        return `<div class="hadir-chip${hit ? " sorot" : ""}"><span class="hadir-num">${i + 1}</span><span class="hadir-nama" title="${escapeHtml(n)}">${escapeHtml(n)}</span></div>`;
                    }).join("")}</div>`
                    : `<div class="abs-panel-empty">Tidak ada — daftar anggota belum termuat.</div>`}
                ${boleh ? `<div class="rekap-foot">
                    <button class="btn btn-red btn-sm" data-abs-delhari="${t}"><i class="fa-solid fa-trash-can"></i> Hapus</button>
                </div>` : ""}
            </div>`;
        };
        wrap.innerHTML = Object.keys(perBulan).sort().reverse().map(ym => {
            const hari = perBulan[ym];
            const total = hari.reduce((a, t) => a + grupHadir[t].daftar.length, 0);
            return `<div class="bulan-sep"><i class="fa-solid fa-calendar"></i> ${escapeHtml(Absensi.fmtBulan(ym))}<span class="cnt">${total} hadir</span></div>`
                + hari.map(kartuHari).join("");
        }).join("");
    },

    bacaFilter() {
        Absensi.filter = {
            tab: Absensi.filter.tab || "tidak",
            q: document.getElementById("filterQ").value || "",
            status: document.getElementById("filterStatus").value || "",
            tanggal: document.getElementById("filterTanggal").value || ""
        };
        Absensi.render();
    },

    resetFilter() {
        ["filterQ", "filterStatus", "filterTanggal"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });
        try { if (window.Dropdown && Dropdown.segarkanSemua) Dropdown.segarkanSemua(); } catch {}
        // Fokus tahun tidak ikut di-reset (tab harus selalu ada yang kepilih)
        Absensi.bacaFilter();
    },

    // ============ FORM (ketuk nama dari anggota + status + alasan) ============
    // Nama TIDAK diketik manual — dipilih dengan mengetuk daftar anggota
    // (kayak Absen Langsung). Tiap yang dipilih wajib isi status
    // (izin/sakit/alpha) + alasan kenapa tidak hadir.
    barisHtml(prefill) {
        const pr = prefill || {};
        return `<div class="abs-row" ${pr.id ? `data-row-id="${pr.id}"` : ""} style="position:relative; border:2px dashed var(--line); border-radius:12px; padding:10px; margin-bottom:8px">
            <button type="button" class="icon-btn" data-abs-rmrow title="Hapus baris" style="position:absolute; top:8px; right:8px; width:28px; height:28px; font-size:0.75rem; background:var(--red); color:#fff; border-width:2px"><i class="fa-solid fa-trash-can"></i></button>
            <input type="hidden" class="abs-nama" value="${escapeHtml(pr.nama || "")}" />
            <div class="field" style="padding-right:36px"><label>Nama pengurus</label><b style="font-size:0.9rem">${escapeHtml(pr.nama || "-")}</b></div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px">
                <div class="field"><label>Status</label><select class="admin-input abs-status">
                    <option value="izin" ${pr.status === "izin" ? "selected" : ""}>Izin</option>
                    <option value="sakit" ${pr.status === "sakit" ? "selected" : ""}>Sakit</option>
                    <option value="alpha" ${pr.status === "alpha" ? "selected" : ""}>Alpha</option>
                </select></div>
                <div class="field"><label>Alasan</label><input type="text" class="admin-input abs-alasan" placeholder="cth: Ada keperluan keluarga" maxlength="500" value="${escapeHtml(pr.alasan || "")}" /></div>
            </div>
        </div>`;
    },

    tambahBaris(prefill) {
        const nama = String((prefill && prefill.nama) || "").trim();
        if (!nama) return;
        const dobel = [...document.querySelectorAll("#absensiRows .abs-nama")]
            .some(el => Absensi.norm(el.value) === Absensi.norm(nama));
        if (dobel) { showToast(nama + " sudah dipilih.", "info"); return; }
        document.getElementById("absensiRows")?.insertAdjacentHTML("beforeend", Absensi.barisHtml(prefill));
        Absensi.hitungPilih();
        Absensi.renderTambahList();
        if (typeof FormPersist !== "undefined") FormPersist.touch("absensiForm");
    },

    // Ketuk nama di daftar -> pilih (tambah baris) / ketuk lagi -> batal pilih.
    togglePilih(nama) {
        nama = String(nama || "").trim();
        if (!nama) return;
        const rows = [...document.querySelectorAll("#absensiRows .abs-row")];
        const target = rows.find(el => Absensi.norm(el.querySelector(".abs-nama")?.value || "") === Absensi.norm(nama));
        if (target) {
            target.remove();
            Absensi.hitungPilih();
            Absensi.renderTambahList();
            if (typeof FormPersist !== "undefined") FormPersist.touch("absensiForm");
            return;
        }
        Absensi.tambahBaris({ nama, status: "izin", alasan: "" });
    },

    hitungPilih() {
        const el = document.getElementById("tambahPilihCount");
        if (el) el.textContent = document.querySelectorAll("#absensiRows .abs-row").length;
    },

    // Daftar ketuk: roster anggota dikurangi yang sudah dipilih & yang sudah
    // tercatat pada tanggal form (diblokir biar tidak dobel / bentrok).
    renderTambahList() {
        const box = document.getElementById("tambahBelum");
        if (!box) return;
        if (!document.getElementById("absensiForm")?.classList.contains("open")) return;
        const tanggal = document.getElementById("absTanggal")?.value || "";
        const q = document.getElementById("tambahSearch")?.value || "";
        const roster = Absensi.rosterFokus();
        const dipilih = new Set([...document.querySelectorAll("#absensiRows .abs-nama")].map(el => Absensi.norm(el.value)));
        // Baris yang lagi diedit (tanggal yang sama) boleh dipilih ulang.
        const aktifRows = Absensi.cacheAktif();
        const milikEdit = Absensi.editTanggal && String(tanggal) === String(Absensi.editTanggal)
            ? new Set(aktifRows.filter(r => String(r.tanggal) === String(Absensi.editTanggal)).map(r => String(r.id)))
            : null;
        const blokir = {};
        aktifRows.filter(r => String(r.tanggal) === String(tanggal)).forEach(r => {
            if (milikEdit && milikEdit.has(String(r.id))) return;
            blokir[Absensi.norm(r.nama)] = r.status;
        });
        const tersedia = [], diblokir = [];
        roster.forEach(o => {
            const nama = o.nama ?? o;
            const tahun = (o && typeof o === "object" && o.tahun != null) ? o.tahun : null;
            const k = Absensi.norm(nama);
            if (dipilih.has(k)) return;
            if (!Absensi.cocokQuery(nama, q)) return;
            if (blokir[k]) diblokir.push({ nama, tahun, status: blokir[k] });
            else tersedia.push({ nama, tahun });
        });
        const cnt = document.getElementById("tambahBelumCount");
        if (cnt) cnt.textContent = tersedia.length;
        const labelBlokir = (s) => s === "hadir" ? "Hadir" : Absensi.labelStatus(s);
        // Dipisah per tahun (periode aktif): header tahun di atas tiap kelompok.
        const grupBtn = (list) => Absensi.grupTahun(list).map(([t, names]) =>
            `<div class="absen-tahun"><i class="fa-solid fa-calendar"></i> ${escapeHtml(Absensi.labelTahun(t))}<span class="cnt">${names.length}</span></div>` +
            names.map(n => `<button type="button" class="absen-item" data-pilih="${encodeURIComponent(n)}"><span class="dot">○</span> ${escapeHtml(n)}</button>`).join("")
        ).join("");
        const grupBlokir = (list) => {
            const m = new Map();
            list.forEach(o => {
                const t = o.tahun != null ? o.tahun : "?";
                if (!m.has(t)) m.set(t, []);
                m.get(t).push(o);
            });
            return [...m.entries()]
                .sort((a, b) => (a[0] === "?" ? 9999 : a[0]) - (b[0] === "?" ? 9999 : b[0]))
                .map(([t, items]) =>
                    `<div class="absen-tahun"><i class="fa-solid fa-calendar"></i> ${escapeHtml(Absensi.labelTahun(t))}<span class="cnt">${items.length}</span></div>` +
                    items.map(o => `<div class="absen-item blocked"><span class="dot">−</span> ${escapeHtml(o.nama)}<small>${labelBlokir(o.status)}</small></div>`).join("")
                ).join("");
        };
        box.innerHTML = (tersedia.length
            ? grupBtn(tersedia)
            : `<div class="pesan-empty">${roster.length ? "Semua anggota tersaring / sudah dipilih." : "Memuat anggota..."}</div>`)
            + grupBlokir(diblokir);
    },

    // Kumpulin isi form mentah buat draft (tanpa validasi).
    kumpulkanDraftRows() {
        return [...document.querySelectorAll("#absensiRows .abs-row")].map(el => ({
            id: el.dataset.rowId || "",
            nama: el.querySelector(".abs-nama")?.value ?? "",
            status: el.querySelector(".abs-status")?.value ?? "izin",
            alasan: el.querySelector(".abs-alasan")?.value ?? ""
        }));
    },

    // Sembunyikan tombol aksi kalau tidak punya kendali atas halaman ini
    terapkanAkses() {
        const boleh = OsisAuth.bisa("absensi");
        ["btnTambahAbsensi", "btnAbsenLangsung", "btnAbsenQr", "btnAturAbsensi", "btnAturTahunPanel"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = boleh ? "" : "none";
        });
    },

    pulihkanScroll() {
        const adaLain = ["absensiForm", "absenLangsung", "absenQr", "absensiSettingModal"]
            .some(id => document.getElementById(id)?.classList.contains("open"));
        if (!adaLain) document.body.style.overflow = "";
    },

    bukaForm() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("absensi")) return;
        Absensi.editTanggal = null;
        Absensi.tanggalDimuat = null;
        document.getElementById("absensiFormTitle").textContent = "Tambah Ketidakhadiran";
        document.getElementById("absTanggal").value = Absensi.filter.tanggal || new Date().toISOString().slice(0, 10);
        document.getElementById("absKegiatan").value = "";
        document.getElementById("absensiRows").innerHTML = "";
        document.getElementById("tambahSearch").value = "";
        // Pulihkan draft kalau ada (tutup form / refresh tidak sengaja)
        try {
            const d = (typeof FormPersist !== "undefined") ? FormPersist.load("absensiForm") : null;
            const adaIsi = d && ((d.absTanggal && String(d.absTanggal).trim()) || (d.absKegiatan && String(d.absKegiatan).trim()) || (Array.isArray(d.rows) && d.rows.some(r => String(r.nama || "").trim() || String(r.alasan || "").trim())));
            if (adaIsi) {
                if (d.absTanggal) document.getElementById("absTanggal").value = d.absTanggal;
                if (typeof d.absKegiatan === "string") document.getElementById("absKegiatan").value = d.absKegiatan;
                if (Array.isArray(d.rows) && d.rows.length) {
                    document.getElementById("absensiRows").innerHTML = "";
                    d.rows.forEach(r => Absensi.tambahBaris(r));
                }
            }
        } catch {}
        document.getElementById("absensiForm").classList.add("open");
        document.body.style.overflow = "hidden";
        // Muat baris tercatat tanggal ini (kalau ada) + daftar ketuk
        Absensi.preloadTanggal();
        // Roster anggota buat daftar ketuk (cache dulu, segarkan background)
        Absensi.muatAnggotaLangsung().then(() => Absensi.renderTambahList()).catch(() => {});
    },

    // Tambah untuk tanggal yang sudah ada isinya: muat baris tercatat
    // (izin/sakit/alpha) jadi baris terpilih — bisa edit + tambah orang.
    // Baris 'hadir' tidak ikut (form ini tidak mengelola kehadiran).
    // Cuma jalan saat form masih kosong (jangan timpa pilihan/draft user).
    preloadTanggal() {
        if (Absensi.editTanggal) { Absensi.hitungPilih(); Absensi.renderTambahList(); return; }
        const tanggal = document.getElementById("absTanggal")?.value || "";
        Absensi.tanggalDimuat = null;
        if (tanggal && !document.querySelectorAll("#absensiRows .abs-row").length) {
            const ada = new Set([...document.querySelectorAll("#absensiRows .abs-nama")].map(el => Absensi.norm(el.value)));
            const rows = Absensi.cacheAktif()
                .filter(r => String(r.tanggal) === String(tanggal) && r.status !== "hadir")
                .slice().sort((a, b) => String(a.nama || "").localeCompare(String(b.nama || "")));
            if (rows.length) {
                Absensi.tanggalDimuat = tanggal;
                rows.forEach(r => {
                    if (ada.has(Absensi.norm(r.nama))) return;
                    ada.add(Absensi.norm(r.nama));
                    Absensi.tambahBaris({ id: r.id, nama: r.nama, status: r.status, alasan: r.alasan });
                });
            }
        }
        Absensi.hitungPilih();
        Absensi.renderTambahList();
    },

    editHari(tanggal) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("absensi")) return;
        // Edit sehari hanya untuk izin/sakit/alpha; baris 'hadir' tidak ikut
        const rows = Absensi.cacheAktif().filter(r => String(r.tanggal) === String(tanggal) && r.status !== "hadir");
        if (!rows.length) return;
        Absensi.editTanggal = tanggal;
        Absensi.tanggalDimuat = null;
        document.getElementById("absensiFormTitle").textContent = "Edit — " + Absensi.fmtTanggalPanjang(tanggal);
        document.getElementById("absTanggal").value = tanggal;
        document.getElementById("absKegiatan").value = (rows.map(r => String(r.kegiatan || "").trim()).find(Boolean) || "");
        document.getElementById("absensiRows").innerHTML = "";
        rows.slice().sort((a, b) => String(a.nama || "").localeCompare(String(b.nama || "")))
            .forEach(r => Absensi.tambahBaris({ id: r.id, nama: r.nama, status: r.status, alasan: r.alasan }));
        document.getElementById("absensiForm").classList.add("open");
        document.body.style.overflow = "hidden";
        document.getElementById("tambahSearch").value = "";
        Absensi.hitungPilih();
        Absensi.renderTambahList();
        Absensi.muatAnggotaLangsung().then(() => Absensi.renderTambahList()).catch(() => {});
    },

    tutupForm() {
        document.getElementById("absensiForm")?.classList.remove("open");
        Absensi.pulihkanScroll();
        Absensi.editTanggal = null;
        Absensi.tanggalDimuat = null;
    },

    async simpan() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("absensi")) return;
        const tanggal = document.getElementById("absTanggal").value || "";
        if (!tanggal) { showToast("Tanggal wajib diisi.", "error"); return; }
        const kegiatan = (document.getElementById("absKegiatan")?.value || "").trim().slice(0, 120);
        const els = [...document.querySelectorAll("#absensiRows .abs-row")];
        // Dikosongin sampai nol = hapus baris tidak hadir hari itu
        // (mode edit / tambah yang memuat baris tercatat).
        // Mode tambah kosong + tanggal kosong = tidak ada yang bisa disimpan.
        // Basis = tanggal edit ATAU tanggal dimuat (tambah aditif).
        const basisTanggal = Absensi.editTanggal || Absensi.tanggalDimuat;
        if (!els.length && !basisTanggal) { showToast("Pilih minimal 1 pengurus.", "error"); return; }
        if (!els.length && basisTanggal) {
            const yakinKosong = await showPopup(`Kosongkan data ketidakhadiran ${escapeHtml(Absensi.fmtTanggalPanjang(basisTanggal))}? Baris izin/sakit/alpha hari itu akan dihapus (data hadir tidak ikut).`, "confirm");
            if (!yakinKosong) return;
        }
        // Basis hapus/update = baris TIDAK HADIR tanggal basis saja.
        // Baris 'hadir' tidak dikelola form ini — jangan ikut terhapus.
        const aktifCache = Absensi.cacheAktif();
        const originalIds = basisTanggal
            ? aktifCache.filter(r => String(r.tanggal) === String(basisTanggal) && r.status !== "hadir").map(r => String(r.id))
            : [];
        const lainnya = aktifCache.filter(r => !originalIds.includes(String(r.id)));
        const rows = [];
        const temu = new Set();
        for (const el of els) {
            const nama = el.querySelector(".abs-nama").value.trim();
            const status = el.querySelector(".abs-status").value || "";
            const alasan = el.querySelector(".abs-alasan").value.trim();
            const rid = el.dataset.rowId || "";
            if (!nama) { showToast("Ada baris yang namanya masih kosong.", "error"); return; }
            if (!Absensi.STATUS.includes(status)) { showToast("Ada baris yang statusnya belum dipilih.", "error"); return; }
            if (!alasan && status !== "alpha") { showToast("Alasan wajib diisi untuk izin/sakit.", "error"); return; }
            const kunci = tanggal + "|" + nama.toLowerCase();
            if (temu.has(kunci)) { showToast("Ada pengurus yang dobel di form ini.", "error"); return; }
            temu.add(kunci);
            const bentrok = lainnya.find(r => String(r.tanggal) === tanggal && String(r.nama || "").toLowerCase() === nama.toLowerCase());
            if (bentrok) { showToast(nama + " sudah tercatat pada tanggal ini.", "error"); return; }
            rows.push({ id: rid, nama, status, alasan });
        }
        if (typeof Outbox !== "undefined" && Outbox.offline()) {
            if (basisTanggal || rows.some(r => r.id)) {
                showToast("Ubah absensi butuh koneksi — data pembanding ada di server.", "error");
                return;
            }
            try {
                await Outbox.enqueue({ modul: "absensi", op: "create",
                    label: "Absensi " + tanggal + " (" + rows.length + " orang)",
                    payload: { rows: rows.map(r => ({ tanggal, nama: r.nama, status: r.status, alasan: r.alasan, kegiatan, angkatan_id: Absensi.angkatanIdUntuk(r.nama) })) },
                    files: [], cacheKeys: ["absensi"] });
            } catch (e) { showToast(e.message, "error"); return; }
            Outbox.sesudahAntre(() => {
                if (typeof FormPersist !== "undefined") FormPersist.clear("absensiForm");
                Absensi.tutupForm();
            });
            return;
        }
        try {
            const btn = document.getElementById("btnSimpanAbsensi");
            const btnHtml = btn ? btn.innerHTML : "";
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
            try {
                const hapusIds = originalIds.filter(id => !rows.some(r => String(r.id) === String(id)));
                // Hapus + tulis paralel per batch (sebelumnya serial 1-per-1).
                const BATCH = 6;
                for (let i = 0; i < hapusIds.length; i += BATCH) {
                    if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menghapus ${Math.min(i + BATCH, hapusIds.length)}/${hapusIds.length}...`;
                    await Promise.all(hapusIds.slice(i, i + BATCH).map(hid => hapusAbsensi(u.id, hid)));
                }
                for (let i = 0; i < rows.length; i += BATCH) {
                    if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan ${Math.min(i + BATCH, rows.length)}/${rows.length}...`;
                    await Promise.all(rows.slice(i, i + BATCH).map(r => {
                        if (r.id) return updateAbsensi(u.id, r.id, { tanggal, nama: r.nama, status: r.status, alasan: r.alasan, kegiatan });
                        return buatAbsensi(u.id, { tanggal, nama: r.nama, status: r.status, alasan: r.alasan, kegiatan, angkatan_id: Absensi.angkatanIdUntuk(r.nama) });
                    }));
                }
            } finally {
                if (btn) { btn.disabled = false; btn.innerHTML = btnHtml || '<i class="fa-solid fa-floppy-disk"></i> Simpan'; }
            }
            showToast("Absensi tersimpan!", "success");
            catatAksi("simpan_absensi", String(tanggal || "") + " (" + rows.length + " orang)");
            if (typeof FormPersist !== "undefined") FormPersist.clear("absensiForm");
            Absensi.tutupForm();
            Absensi.segarkan();
        } catch (err) {
            console.error(err);
            showToast("Gagal simpan: " + Absensi.pesanDb(err.message), "error");
            Absensi.segarkan();
        }
    },

    async hapusHari(tanggal) {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("absensi")) return;
        // Hapus sehari = semua baris tanggal itu (hadir + izin/sakit/alpha),
        // biar tab Hadir dan Tidak Hadir sama-sama bersih.
        const rows = Absensi.cacheAktif().filter(r => String(r.tanggal) === String(tanggal));
        if (!rows.length) return;
        const nHadir = rows.filter(r => r.status === "hadir").length;
        const yakin = await showPopup(`Hapus semua data absensi (${Absensi.fmtTanggalPanjang(tanggal)})? ${rows.length} baris${nHadir ? ` (termasuk ${nHadir} hadir)` : ""} akan dihapus dari kedua tab.`, "confirm");
        if (!yakin) return;
        if (Absensi._hapusBusy) return;
        Absensi._hapusBusy = true;
        // Kunci tombol hapus tanggal ini biar tidak dobel-klik + kasih status.
        const btns = [...document.querySelectorAll('[data-abs-delhari="' + String(tanggal).replace(/"/g, "") + '"]')];
        const btnHtml = btns.map(b => b.innerHTML);
        btns.forEach(b => { b.disabled = true; b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menghapus...'; });
        try {
            // Optimis: buang dari cache + render dulu biar UI langsung hilang,
            // RPC jalan di background paralel per batch.
            const ids = rows.map(r => String(r.id));
            const idSet = new Set(ids);
            Absensi.cache = (Absensi.cache || []).filter(r => !idSet.has(String(r.id)));
            try { Absensi.render(); } catch {}
            const BATCH = 6;
            let gagal = 0;
            for (let i = 0; i < ids.length; i += BATCH) {
                const potong = ids.slice(i, i + BATCH);
                btns.forEach(b => { b.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${Math.min(i + BATCH, ids.length)}/${ids.length}...`; });
                const hasil = await Promise.allSettled(potong.map(id => hapusAbsensi(u.id, id)));
                hasil.forEach(h => { if (h.status === "rejected") { console.error(h.reason); gagal++; } });
            }
            if (gagal) showToast(`Terhapus sebagian, ${gagal} gagal.`, "error");
            else showToast("Data sehari dihapus.", "success");
            Absensi.segarkan();
        } catch (err) {
            console.error(err);
            showToast("Gagal hapus: " + err.message, "error");
            Absensi.segarkan();
        } finally {
            Absensi._hapusBusy = false;
            btns.forEach((b, i) => { if (b.isConnected) { b.disabled = false; b.innerHTML = btnHtml[i]; } });
        }
    },

    // ============ ABSEN LANGSUNG (tandai hadir cepat) ============
    // Sumber nama WAJIB dari tabel anggota simple (periode terbaru). Simpan hadir
    // ke tabel osis_absensi yang sama (status 'hadir'), jadi UNIQUE
    // tanggal+lower(nama) mencegah dobel & bentrok izin/sakit/alpha.
    norm(s) {
        return String(s || "").trim().toLowerCase();
    },

    // Cari per token: tiap kata kunci harus terkandung di nama.
    // "ase" -> Asep; "ase muh" -> Asep Muhammad; "riz" -> Rizky.
    cocokQuery(nama, q) {
        const toks = Absensi.norm(q).split(/\s+/).filter(Boolean);
        if (!toks.length) return true;
        const t = Absensi.norm(nama);
        return toks.every(k => t.includes(k));
    },

    sesiLangsung() {
        return {
            tanggal: document.getElementById("langsungTanggal")?.value || "",
            kegiatan: (document.getElementById("langsungKegiatan")?.value || "").trim().slice(0, 120)
        };
    },

    async bukaLangsung() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("absensi")) return;
        const hariIni = new Date().toISOString().slice(0, 10);
        const tDef = Absensi.filter.tanggal || hariIni;
        document.getElementById("langsungTanggal").value = tDef;
        // Pakai kegiatan yang sudah ada pada tanggal itu (struktur data sama)
        const ada = Absensi.cacheAktif().filter(r => String(r.tanggal) === String(tDef) && String(r.kegiatan || "").trim());
        document.getElementById("langsungKegiatan").value = ada.length ? ada[0].kegiatan : "";
        Absensi.langsung.q = "";
        Absensi.langsung.activeIdx = 0;
        document.getElementById("langsungSearch").value = "";
        document.getElementById("absenLangsung").classList.add("open");
        document.body.style.overflow = "hidden";
        Absensi.renderLangsung();
        await Absensi.muatAnggotaLangsung();
        Absensi.renderLangsung();
    },

    tutupLangsung() {
        document.getElementById("absenLangsung")?.classList.remove("open");
        Absensi.pulihkanScroll();
        Absensi.langsung.saving = false;
    },

    bacaLangsung() {
        Absensi.langsung.activeIdx = 0;
        Absensi.renderLangsung();
    },

    async muatAnggotaLangsung() {
        try {
            await Promise.all([
                Absensi.muatPeriode(),
                Absensi.config.loaded ? Promise.resolve() : Absensi.muatConfig(),
            ]);
            const cached = (typeof Cache !== "undefined") ? Cache.get("anggota") : null;
            if (cached && cached.length) {
                Absensi.pakaiAnggota(cached);
                // Revalidasi di background
                getAnggota().then(fresh => {
                    if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                        Cache.set("anggota", fresh);
                        Absensi.pakaiAnggota(fresh);
                        if (document.getElementById("absenLangsung")?.classList.contains("open")) Absensi.renderLangsung();
                        if (document.getElementById("absensiForm")?.classList.contains("open")) Absensi.renderTambahList();
                    }
                }).catch(() => {});
                return;
            }
            const fresh = await getAnggota();
            if (typeof Cache !== "undefined") Cache.set("anggota", fresh);
            Absensi.pakaiAnggota(fresh);
        } catch (err) {
            console.error(err);
            showToast("Gagal memuat anggota: " + err.message, "error");
        }
    },

    // Tahun aktif dari tabel periode (cache-first + revalidasi background).
    async muatPeriode() {
        try {
            const cached = (typeof Cache !== "undefined") ? Cache.get("periode") : null;
            if (cached && cached.length) {
                Absensi.pakaiPeriode(cached);
                getPeriode().then(fresh => {
                    if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                        Cache.set("periode", fresh);
                        Absensi.pakaiPeriode(fresh);
                        Absensi.terapkanPeriodeBaru();
                    }
                }).catch(() => {});
                return;
            }
            const fresh = await getPeriode();
            if (typeof Cache !== "undefined") Cache.set("periode", fresh);
            Absensi.pakaiPeriode(fresh);
        } catch (err) { console.error(err); }
    },

    pakaiPeriode(list) {
        Absensi.langsung.periodeSemua = Array.isArray(list) ? list : [];
        Absensi.langsung.periodeTahun = Absensi.langsung.periodeSemua
            .filter(p => p && p.aktif)
            .map(p => parseInt(p.tahun, 10))
            .filter(Number.isFinite)
            .sort((a, b) => a - b);
    },

    // Setting tahun aktif per angkatan (osis_absensi_config, cache-first + revalidasi).
    async muatConfig() {
        try {
            const cached = (typeof Cache !== "undefined") ? Cache.get("absensi_config") : null;
            if (cached) Absensi.pakaiConfig(cached);
            const fresh = await getAbsensiConfig();
            if (typeof Cache !== "undefined") {
                if (fresh) Cache.set("absensi_config", fresh);
                else if (cached) Cache.del("absensi_config");
            }
            const berubah = JSON.stringify(fresh || null) !== JSON.stringify(cached || null);
            Absensi.pakaiConfig(fresh);
            if (berubah && Absensi.langsung._rosterSiap) Absensi.terapkanPeriodeBaru();
        } catch (err) {
            console.error(err);
        }
    },

    pakaiConfig(cfg) {
        Absensi.config.loaded = true;
        if (!cfg || typeof cfg !== "object") {
            Absensi.config.tahunAktif = [];
            Absensi.config.tahunDefault = null;
            return;
        }
        const arr = Array.isArray(cfg.tahun_aktif)
            ? [...new Set(cfg.tahun_aktif.map(n => parseInt(n, 10)).filter(Number.isFinite))].sort((a, b) => a - b)
            : [];
        const def = cfg.tahun_default != null ? parseInt(cfg.tahun_default, 10) : NaN;
        Absensi.config.tahunAktif = arr;
        Absensi.config.tahunDefault = Number.isFinite(def) ? def : null;
    },

    // ============ MODAL SETTING TAHUN AKTIF ABSENSI ============
    async bukaSetting() {
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("absensi")) return;
        if (!Absensi.config.loaded || !Absensi.langsung.periodeSemua.length) {
            try {
                await Promise.all([Absensi.muatPeriode(), Absensi.muatConfig()]);
            } catch {}
        }
        const cfgAktif = (Absensi.config.tahunAktif && Absensi.config.tahunAktif.length)
            ? [...Absensi.config.tahunAktif]
            : [...Absensi.tahunAktifList()];
        const globalAktif = [...(Absensi.langsung.periodeTahun || [])];
        const angYears = Absensi.tahunRosterList(Absensi.langsung._cacheList);
        const thAng = Absensi.tahunAngkatanIni();
        const cfgDef = Number.isFinite(Absensi.config.tahunDefault)
            ? Absensi.config.tahunDefault
            : (cfgAktif.includes(thAng) ? thAng : (cfgAktif[0] ?? null));
        const tahunList = [...new Set([
            ...angYears,
            ...cfgAktif,
            ...globalAktif,
            ...(thAng != null ? [thAng] : []),
            ...(cfgDef != null ? [cfgDef] : [])
        ].filter(Number.isFinite))].sort((a, b) => a - b);

        Absensi.config.draft = {
            tahunList,
            tahunAktif: new Set(cfgAktif),
            tahunDefault: cfgDef,
            periodeAktif: new Set(globalAktif),
            addedYears: new Set(),
            showArsip: false,
        };

        const angObj = (typeof OsisAuth !== "undefined" && OsisAuth.getAngkatanAktifObj) ? OsisAuth.getAngkatanAktifObj() : null;
        const lblAng = (angObj && (angObj.kode || angObj.nama)) ? (angObj.kode || angObj.nama) : "";
        const badgeEl = document.getElementById("absCfgAngBadge");
        if (badgeEl) badgeEl.textContent = lblAng;
        const inpTambah = document.getElementById("absCfgTambahInput");
        if (inpTambah) inpTambah.value = "";

        Absensi.renderSettingModal();
        document.getElementById("absensiSettingModal")?.classList.add("open");
        document.body.style.overflow = "hidden";
    },

    tutupSetting() {
        document.getElementById("absensiSettingModal")?.classList.remove("open");
        Absensi.pulihkanScroll();
        Absensi.config.draft = null;
    },

    renderSettingModal() {
        const D = Absensi.config.draft;
        if (!D) return;
        const cntRoster = {};
        (Absensi.langsung._cacheList || []).forEach(a => {
            const t = parseInt(a && a.tahun, 10);
            if (Number.isFinite(t)) cntRoster[t] = (cntRoster[t] || 0) + 1;
        });

        const gTahun = document.getElementById("absCfgTahunGrid");
        if (gTahun) {
            const sorted = [...new Set(D.tahunList)].sort((a, b) => a - b);
            gTahun.innerHTML = sorted.length
                ? sorted.map(y => {
                    const on = D.tahunAktif.has(y);
                    const cnt = cntRoster[y] || 0;
                    return `<label class="abs-cfg-chip${on ? " on" : ""}">
                        <input type="checkbox" value="${y}"${on ? " checked" : ""} />
                        <span>${y}</span>
                        ${cnt ? `<small>${cnt} org</small>` : ""}
                    </label>`;
                }).join("")
                : `<div class="abs-panel-empty">Belum ada tahun. Tambahkan tahun di bawah.</div>`;
        }

        const selDef = document.getElementById("absCfgDefault");
        if (selDef) {
            const pilihan = [...D.tahunAktif].sort((a, b) => a - b);
            if (D.tahunDefault != null && !pilihan.includes(D.tahunDefault)) {
                D.tahunDefault = pilihan[0] ?? null;
            }
            const opts = [`<option value="">Otomatis (mengikuti urutan)</option>`]
                .concat(pilihan.map(y => `<option value="${y}">${y}${cntRoster[y] ? ` (${cntRoster[y]} org)` : ""}</option>`));
            selDef.innerHTML = opts.join("");
            selDef.value = D.tahunDefault != null ? String(D.tahunDefault) : "";
            try { if (window.Dropdown && Dropdown.segarkanSemua) Dropdown.segarkanSemua(); } catch {}
        }

        const gPeriode = document.getElementById("absCfgPeriodeGrid");
        if (gPeriode) {
            const angYears = Absensi.tahunRosterList(Absensi.langsung._cacheList);
            const allGlobal = [...new Set([
                ...(Absensi.langsung.periodeSemua || []).map(p => parseInt(p.tahun, 10)).filter(Number.isFinite),
                ...D.tahunList
            ])].sort((a, b) => a - b);
            const visible = allGlobal.filter(y =>
                D.showArsip || y >= 2024 || D.periodeAktif.has(y) || D.addedYears.has(y) || angYears.includes(y)
            );
            const hiddenCnt = allGlobal.length - visible.length;
            gPeriode.innerHTML = visible.map(y => {
                const on = D.periodeAktif.has(y);
                return `<label class="abs-cfg-chip${on ? " on" : ""}">
                    <input type="checkbox" value="${y}"${on ? " checked" : ""} />
                    <span>${y}</span>
                </label>`;
            }).join("") + (hiddenCnt > 0 || D.showArsip
                ? `<button type="button" class="abs-cfg-chip" id="btnToggleArsipPeriode" style="background:var(--white)">
                    <i class="fa-solid fa-${D.showArsip ? "chevron-up" : "box-archive"}"></i>
                    <span>${D.showArsip ? "Sembunyikan arsip" : `${hiddenCnt} arsip lama`}</span>
                  </button>`
                : "");
        }
    },

    onSettingGridChange(e, kind) {
        const D = Absensi.config.draft;
        if (!D) return;
        const cb = e.target.closest('input[type="checkbox"]');
        if (!cb) return;
        const y = parseInt(cb.value, 10);
        if (!Number.isFinite(y)) return;
        const set = (kind === "tahun") ? D.tahunAktif : D.periodeAktif;
        if (cb.checked) set.add(y);
        else set.delete(y);
        if (kind === "tahun" && cb.checked && D.tahunDefault == null) {
            D.tahunDefault = y;
        }
        Absensi.renderSettingModal();
    },

    onSettingDefaultChange(e) {
        const D = Absensi.config.draft;
        if (!D) return;
        const val = parseInt(e.target.value, 10);
        D.tahunDefault = Number.isFinite(val) ? val : null;
        if (D.tahunDefault != null && !D.tahunAktif.has(D.tahunDefault)) {
            D.tahunAktif.add(D.tahunDefault);
            Absensi.renderSettingModal();
        }
    },

    tambahTahunDraft() {
        const D = Absensi.config.draft;
        if (!D) return;
        const inp = document.getElementById("absCfgTambahInput");
        const y = parseInt((inp?.value || "").trim(), 10);
        if (!Number.isFinite(y) || y < 2000 || y > 2100) {
            showToast("Masukkan tahun antara 2000 – 2100.", "error");
            return;
        }
        if (!D.tahunList.includes(y)) D.tahunList.push(y);
        D.tahunList.sort((a, b) => a - b);
        D.tahunAktif.add(y);
        D.addedYears.add(y);
        if (D.tahunDefault == null) D.tahunDefault = y;
        if (inp) inp.value = "";
        Absensi.renderSettingModal();
    },

    async simpanSetting() {
        const D = Absensi.config.draft;
        if (!D || Absensi.config.saving) return;
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("absensi")) return;
        const aktifArr = [...D.tahunAktif].sort((a, b) => a - b);
        if (!aktifArr.length) {
            showToast("Pilih minimal 1 tahun aktif untuk angkatan ini.", "error");
            return;
        }
        const defVal = (D.tahunDefault != null && D.tahunAktif.has(D.tahunDefault)) ? D.tahunDefault : null;
        const periodeAktifArr = [...D.periodeAktif].sort((a, b) => a - b);
        const tambahArr = [...D.addedYears].sort((a, b) => a - b);

        Absensi.config.saving = true;
        const btn = document.getElementById("btnSimpanAbsensiSetting");
        const btnHtml = btn ? btn.innerHTML : "";
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
        try {
            await simpanAbsensiConfig(u.id, {
                tahun_aktif: aktifArr,
                tahun_default: defVal,
                periode_aktif: periodeAktifArr,
                tambah_tahun: tambahArr,
            });
            Absensi.config.loaded = true;
            Absensi.config.tahunAktif = aktifArr;
            Absensi.config.tahunDefault = defVal;
            const knownYears = new Set([
                ...(Absensi.langsung.periodeSemua || []).map(p => parseInt(p.tahun, 10)).filter(Number.isFinite),
                ...aktifArr,
                ...periodeAktifArr,
                ...tambahArr,
            ]);
            Absensi.langsung.periodeSemua = [...knownYears].sort((a, b) => a - b)
                .map(t => ({ tahun: t, aktif: D.periodeAktif.has(t) }));
            Absensi.pakaiPeriode(Absensi.langsung.periodeSemua);
            if (!aktifArr.includes(Absensi.langsung.tahunFokus)) {
                Absensi.langsung.tahunFokus = defVal || aktifArr[0];
                try { localStorage.setItem(Absensi.kunciTahunFokus(), String(Absensi.langsung.tahunFokus)); } catch {}
            }
            Absensi.terapkanPeriodeBaru();
            showToast("Pengaturan tahun aktif tersimpan!", "success");
            catatAksi("simpan_absensi_config", aktifArr.join(", ") + (defVal ? " (default " + defVal + ")" : ""));
            Absensi.tutupSetting();
            Promise.all([getPeriode(), getAbsensiConfig()]).then(([p, c]) => {
                if (p) { Cache.set("periode", p); Absensi.pakaiPeriode(p); }
                if (c) { Cache.set("absensi_config", c); Absensi.pakaiConfig(c); }
                Absensi.terapkanPeriodeBaru();
            }).catch(() => {});
        } catch (err) {
            console.error(err);
            const raw = String(err.message || "");
            if (/does not exist|schema cache|42883|PGRST202/i.test(raw)) {
                showToast("Fungsi DB belum terpasang — jalankan SQL migrasi absensi tahun aktif dulu.", "error");
            } else {
                showToast("Gagal simpan setting: " + Absensi.pesanDb(raw), "error");
            }
        } finally {
            Absensi.config.saving = false;
            if (btn) { btn.disabled = false; btn.innerHTML = btnHtml || '<i class="fa-solid fa-floppy-disk"></i> Simpan Pengaturan'; }
        }
    },

    // Periode / setting berubah -> saring ulang roster terakhir & render.
    terapkanPeriodeBaru() {
        if (Absensi.langsung._cacheList) Absensi.pakaiAnggota(Absensi.langsung._cacheList);
        else Absensi.renderTahunTabs();
        if (document.getElementById("absenLangsung")?.classList.contains("open")) Absensi.renderLangsung();
        if (document.getElementById("absensiForm")?.classList.contains("open")) Absensi.renderTambahList();
        if (Absensi.filter.tab === "hadir") { try { Absensi.render(); } catch {} }
    },

    // Kelompokkan list {nama, tahun} per tahun (urut tahun lalu nama).
    // Kembali [[tahun, [nama...]], ...].
    grupTahun(list) {
        const m = new Map();
        (list || []).forEach(o => {
            const nama = (o && typeof o === "object") ? o.nama : o;
            const t = (o && typeof o === "object" && o.tahun != null) ? o.tahun : "?";
            if (!m.has(t)) m.set(t, []);
            m.get(t).push(nama);
        });
        return [...m.entries()].sort((a, b) => (a[0] === "?" ? 9999 : a[0]) - (b[0] === "?" ? 9999 : b[0]));
    },

    labelTahun(t) {
        return t === "?" ? "Tanpa tahun" : String(t);
    },

    // Roster = anggota tahun aktif saja, nama unik per tahun urut tahun lalu A-Z.
    pakaiAnggota(list) {
        Absensi.langsung._cacheList = list;
        Absensi.langsung._rosterSiap = true;
        const bersih = (list || []).filter(a => a && String(a.nama || "").trim());
        const aktif = Absensi.tahunAktifList();
        let pakai, th = null;
        if (aktif.length) {
            pakai = bersih.filter(a => aktif.includes(parseInt(a.tahun, 10)));
        } else {
            const thns = [...new Set(bersih.map(a => parseInt(a.tahun, 10)).filter(Number.isFinite))].sort((a, b) => b - a);
            th = thns.length ? thns[0] : null;
            pakai = th !== null ? bersih.filter(a => parseInt(a.tahun, 10) === th) : bersih;
        }
        Absensi.langsung.tahun = th;
        const temu = new Set();
        Absensi.langsung.anggota = [];
        pakai.forEach(a => {
            const nama = String(a.nama).trim();
            const t = parseInt(a.tahun, 10);
            const kunci = (Number.isFinite(t) ? t : "?") + "|" + nama.toLowerCase();
            if (!nama || temu.has(kunci)) return;
            temu.add(kunci);
            Absensi.langsung.anggota.push({ nama, tahun: Number.isFinite(t) ? t : null });
        });
        Absensi.langsung.anggota.sort((x, y) => (x.tahun ?? 9999) - (y.tahun ?? 9999) || x.nama.localeCompare(y.nama));
        Absensi.renderTahunTabs();
    },

    // Kelompokkan anggota -> belum / sudah / izin-sakit-alpha utk sesi ini.
    // Blokir (izin/sakit/alpha) dihitung per tanggal saja biar tidak bentrok;
    // hadir dihitung per tanggal + kegiatan (kalau kegiatan diisi).
    daftarLangsung() {
        const L = Absensi.langsung;
        const { tanggal, kegiatan } = Absensi.sesiLangsung();
        const kNorm = Absensi.norm(kegiatan);
        const hariRows = Absensi.cacheAktif().filter(r => String(r.tanggal) === String(tanggal));
        const cocokKeg = (r) => !kNorm || !String(r.kegiatan || "").trim() || Absensi.norm(r.kegiatan) === kNorm;
        const hadirSet = new Set(hariRows.filter(r => r.status === "hadir" && cocokKeg(r)).map(r => Absensi.norm(r.nama)));
        const blokirMap = {};
        hariRows.filter(r => r.status !== "hadir").forEach(r => { blokirMap[Absensi.norm(r.nama)] = r.status; });
        const q = L.q || "";
        const saring = q.trim() !== "";
        const belum = [], sudah = [], blokir = [];
        Absensi.rosterFokus().forEach(o => {
            const nama = o.nama ?? o;
            const tahun = (o && typeof o === "object" && o.tahun != null) ? o.tahun : null;
            const k = Absensi.norm(nama);
            if (hadirSet.has(k)) {
                if (!saring || Absensi.cocokQuery(nama, q)) sudah.push({ nama, tahun });
                return;
            }
            if (blokirMap[k]) {
                if (!saring || Absensi.cocokQuery(nama, q)) blokir.push({ nama, tahun, status: blokirMap[k] });
                return;
            }
            if (Absensi.cocokQuery(nama, q)) belum.push({ nama, tahun });
        });
        return { belum, sudah, blokir, total: Absensi.rosterFokus().length, hadirCount: sudah.length };
    },

    renderLangsung() {
        const L = Absensi.langsung;
        const { tanggal, kegiatan } = Absensi.sesiLangsung();
        const d = Absensi.daftarLangsung();
        if (L.activeIdx >= d.belum.length) L.activeIdx = 0;
        if (L.activeIdx < 0) L.activeIdx = d.belum.length - 1;
        const kegEl = document.getElementById("langsungKegLbl");
        if (kegEl) kegEl.textContent = kegiatan || "(tanpa kegiatan)";
        const tglEl = document.getElementById("langsungTglLbl");
        if (tglEl) tglEl.textContent = tanggal ? Absensi.fmtTanggalPanjang(tanggal) : "-";
        const pEl = document.getElementById("langsungProgress");
        if (pEl) pEl.textContent = `${d.hadirCount} / ${d.total} HADIR`;
        const bar = document.getElementById("langsungBar");
        if (bar) bar.style.width = (d.total ? Math.round(d.hadirCount / d.total * 100) : 0) + "%";
        const setCount = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
        setCount("langsungBelumCount", d.belum.length);
        setCount("langsungSudahCount", d.sudah.length);
        setCount("langsungIzinCount", d.blokir.length);
        // Daftar dipisah per tahun (periode aktif): header tahun di tiap kelompok.
        // d.belum sudah urut tahun lalu nama, jadi index flat 'i' jalan terus.
        let idxBelum = 0;
        const grupBelum = (list) => Absensi.grupTahun(list).map(([t, names]) =>
            `<div class="absen-tahun"><i class="fa-solid fa-calendar"></i> ${escapeHtml(Absensi.labelTahun(t))}<span class="cnt">${names.length}</span></div>` +
            names.map(n => {
                const i = idxBelum++;
                return `<button type="button" class="absen-item${i === L.activeIdx ? " active" : ""}" data-hadir="${encodeURIComponent(n)}"><span class="dot">○</span> ${escapeHtml(n)}</button>`;
            }).join("")
        ).join("");
        const grupSudah = (list) => Absensi.grupTahun(list).map(([t, names]) =>
            `<div class="absen-tahun"><i class="fa-solid fa-calendar"></i> ${escapeHtml(Absensi.labelTahun(t))}<span class="cnt">${names.length}</span></div>` +
            names.map(n => `<div class="absen-item done"><span class="dot"><i class="fa-solid fa-check"></i></span> ${escapeHtml(n)}<small>hadir</small><button type="button" class="batal" data-batal-hadir="${encodeURIComponent(n)}" title="Batalkan (salah pencet)"><i class="fa-solid fa-xmark"></i></button></div>`).join("")
        ).join("");
        const grupBlokir = (list) => {
            const m = new Map();
            list.forEach(o => {
                const t = o.tahun != null ? o.tahun : "?";
                if (!m.has(t)) m.set(t, []);
                m.get(t).push(o);
            });
            return [...m.entries()]
                .sort((a, b) => (a[0] === "?" ? 9999 : a[0]) - (b[0] === "?" ? 9999 : b[0]))
                .map(([t, items]) =>
                    `<div class="absen-tahun"><i class="fa-solid fa-calendar"></i> ${escapeHtml(Absensi.labelTahun(t))}<span class="cnt">${items.length}</span></div>` +
                    items.map(o => `<div class="absen-item blocked"><span class="dot">−</span> ${escapeHtml(o.nama)}<small>${Absensi.labelStatus(o.status)}</small></div>`).join("")
                ).join("");
        };
        const bEl = document.getElementById("langsungBelum");
        if (bEl) {
            bEl.innerHTML = d.belum.length
                ? grupBelum(d.belum)
                : `<div class="pesan-empty">${L.anggota.length ? "Semua anggota tersaring / sudah tercatat." : "Memuat anggota..."}</div>`;
            const akt = bEl.querySelector(".absen-item.active");
            if (akt) akt.scrollIntoView({ block: "nearest" });
        }
        const sEl = document.getElementById("langsungSudah");
        if (sEl) {
            sEl.innerHTML = d.sudah.length
                ? grupSudah(d.sudah)
                : `<div class="pesan-empty">Belum ada yang hadir.</div>`;
        }
        const iEl = document.getElementById("langsungIzin");
        if (iEl) {
            iEl.innerHTML = d.blokir.length
                ? grupBlokir(d.blokir)
                : `<div class="pesan-empty">Tidak ada.</div>`;
        }
    },

    navLangsung(e) {
        const L = Absensi.langsung;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            L.activeIdx++;
            Absensi.renderLangsung();
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            L.activeIdx--;
            Absensi.renderLangsung();
        } else if (e.key === "Enter") {
            e.preventDefault();
            const d = Absensi.daftarLangsung();
            if (!d.belum.length) return;
            // Enter = hasil pertama kalau cuma satu, kalau tidak yang sedang disorot
            const pick0 = d.belum.length === 1 ? d.belum[0] : (d.belum[L.activeIdx] ?? d.belum[0]);
            Absensi.tandaiHadir(pick0 && typeof pick0 === "object" ? pick0.nama : pick0);
        }
    },

    // Satu klik/Enter langsung simpan ke DB (tanpa tombol simpan per anggota)
    async tandaiHadir(nama) {
        const L = Absensi.langsung;
        if (L.saving) return;
        nama = String(nama || "").trim();
        if (!nama) return;
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("absensi")) return;
        const { tanggal, kegiatan } = Absensi.sesiLangsung();
        if (!tanggal) { showToast("Tanggal wajib diisi.", "error"); return; }
        // Cegah dobel & bentrok di client (DB juga dilindungi UNIQUE)
        const k = Absensi.norm(nama);
        const bentrok = Absensi.cacheAktif().find(r => String(r.tanggal) === String(tanggal) && Absensi.norm(r.nama) === k);
        if (bentrok) {
            if (bentrok.status === "hadir") showToast(nama + " sudah hadir.", "info");
            else showToast(nama + " sudah tercatat " + Absensi.labelStatus(bentrok.status) + ".", "error");
            return;
        }
        L.saving = true;
        try {
            const angIdTarget = Absensi.angkatanIdUntuk(nama);
            const nid = await buatAbsensi(u.id, { tanggal, nama, status: "hadir", alasan: "", kegiatan, angkatan_id: angIdTarget });
            (Absensi.cache = Absensi.cache || []).push({ id: nid, tanggal, nama, status: "hadir", alasan: "", kegiatan, angkatan_id: angIdTarget });
        } catch (err) {
            console.error(err);
            const kode = Absensi.ekstrakKodeDb(err.message);
            if (kode === "-4" || kode === "ERR_STATUS") {
                showToast("DB belum mendukung status 'hadir' — cek fungsi buat_absensi di database.", "error");
            } else {
                showToast("Gagal absen: " + Absensi.pesanDb(err.message), "error");
            }
            await Absensi.segarkan();
        } finally {
            L.saving = false;
            // Siap untuk nama berikutnya: kosongkan search TANPA focus ulang
            // (focus otomatis bikin keyboard njedul di Android).
            L.q = "";
            L.activeIdx = 0;
            const s = document.getElementById("langsungSearch");
            if (s) s.value = "";
            Absensi.render();
            Absensi.renderLangsung();
        }
    },

    // Batalkan satu hadir (salah pencet) — hapus baris 'hadir' sesi ini.
    // Tanpa konfirmasi biar cepat; tandai ulang tinggal ketuk lagi.
    async batalHadir(nama) {
        const L = Absensi.langsung;
        if (L.saving) return;
        nama = String(nama || "").trim();
        if (!nama) return;
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("absensi")) return;
        const { tanggal, kegiatan } = Absensi.sesiLangsung();
        if (!tanggal) return;
        const k = Absensi.norm(nama);
        const kNorm = Absensi.norm(kegiatan);
        const row = Absensi.cacheAktif().find(r =>
            String(r.tanggal) === String(tanggal) && r.status === "hadir" && Absensi.norm(r.nama) === k &&
            (!kNorm || !String(r.kegiatan || "").trim() || Absensi.norm(r.kegiatan) === kNorm));
        if (!row) { showToast(nama + " tidak tercatat hadir di sesi ini.", "info"); return; }
        L.saving = true;
        try {
            await hapusAbsensi(u.id, row.id);
            Absensi.cache = (Absensi.cache || []).filter(r => String(r.id) !== String(row.id));
            showToast(nama + " dibatalkan hadirnya.", "success");
        } catch (err) {
            console.error(err);
            showToast("Gagal batalkan: " + Absensi.pesanDb(err.message), "error");
            await Absensi.segarkan();
        } finally {
            L.saving = false;
            Absensi.render();
            Absensi.renderLangsung();
        }
    },
    // Selesai = sisa yang belum hadir langsung jadi data Alpha tanpa
    // keterangan, tampil di riwayat ketidakhadiran halaman utama.
    async selesaiLangsung() {
        const L = Absensi.langsung;
        if (L.saving) return;
        const u = OsisAuth.getUser && OsisAuth.getUser();
        if (!u || u.mode !== "osis") return;
        if (!OsisAuth.butuh("absensi")) return;
        const { tanggal, kegiatan } = Absensi.sesiLangsung();
        if (!tanggal) { showToast("Tanggal wajib diisi.", "error"); return; }
        const d = Absensi.daftarLangsung();
        if (!d.belum.length) {
            showToast("Semua pengurus sudah tercatat.", "success");
            Absensi.tutupLangsung();
            return;
        }
        const yakin = await showPopup(
            `Selesaikan absensi <b>${escapeHtml(kegiatan || "(tanpa kegiatan)")}</b> (${escapeHtml(Absensi.fmtTanggalPanjang(tanggal))})?<br><b>${d.belum.length} pengurus</b> yang belum hadir akan dicatat <b>Alpha</b> tanpa keterangan.`,
            "confirm"
        );
        if (!yakin) return;
        L.saving = true;
        const btn = document.getElementById("btnSelesaiLangsung");
        const btnHtml = btn ? btn.innerHTML : "";
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
        let ok = 0, gagal = 0;
        try {
            // Saring yang benar-benar belum tercatat (hindari RPC sia-sia).
            const antre = [];
            const temuCache = new Set(Absensi.cacheAktif()
                .filter(r => String(r.tanggal) === String(tanggal))
                .map(r => Absensi.norm(r.nama)));
            for (const o of d.belum) {
                const nama = String((o && typeof o === "object" ? o.nama : o) || "").trim();
                if (!nama) continue;
                if (temuCache.has(Absensi.norm(nama))) continue;
                temuCache.add(Absensi.norm(nama));
                antre.push(nama);
            }
            // Simpan paralel per batch (6) biar 30 alpha tidak nunggu 30x serial.
            // Tiap selesai 1 batch, tombol kasih progres 5/30...
            const BATCH = 6;
            let done = 0;
            for (let i = 0; i < antre.length; i += BATCH) {
                const potong = antre.slice(i, i + BATCH);
                const hasil = await Promise.allSettled(potong.map(nama => {
                    const angIdTarget = Absensi.angkatanIdUntuk(nama);
                    return buatAbsensi(u.id, { tanggal, nama, status: "alpha", alasan: "", kegiatan, angkatan_id: angIdTarget })
                        .then(nid => ({ nid, nama, angIdTarget }));
                }));
                hasil.forEach(h => {
                    done++;
                    if (h.status === "fulfilled") {
                        (Absensi.cache = Absensi.cache || []).push({ id: h.value.nid, tanggal, nama: h.value.nama, status: "alpha", alasan: "", kegiatan, angkatan_id: h.value.angIdTarget });
                        ok++;
                    } else { console.error(h.reason); gagal++; }
                });
                if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan ${done}/${antre.length}...`;
            }
            // Kembalikan tombol dulu sebelum refresh (refresh bisa lama di jaringan lambat).
            L.saving = false;
            if (btn) { btn.disabled = false; btn.innerHTML = btnHtml || '<i class="fa-solid fa-check"></i> Selesai'; }
            Absensi.tutupLangsung();
            showToast(`Selesai! ${d.hadirCount} hadir, ${ok} alpha tanpa keterangan.${gagal ? ` ${gagal} gagal.` : ""}`, gagal ? "error" : "success");
            Absensi.segarkan();
            return;
        } finally {
            L.saving = false;
            if (btn) { btn.disabled = false; btn.innerHTML = btnHtml || '<i class="fa-solid fa-check"></i> Selesai'; }
        }
    },

    ekstrakKodeDb(msg) {
        const s = String(msg || "").trim();
        const m = s.match(/^Gagal simpan \((-\d+|ERR_[A-Z_]+)\)$/i);
        return m ? m[1] : s;
    },

    pesanDb(kode) {
        const k = Absensi.ekstrakKodeDb(kode);
        const m = {
            "-1": "tidak ada akses", "-2": "tanggal wajib diisi", "-3": "nama wajib diisi",
            "-4": "status tidak valid", "-5": "sudah tercatat pada tanggal ini",
            ERR_DUPLIKAT: "sudah tercatat pada tanggal ini", ERR_NO_AUTH: "tidak ada akses",
            ERR_NO_TANGGAL: "tanggal wajib diisi", ERR_NO_NAMA: "nama wajib diisi",
            ERR_STATUS: "status tidak valid", ERR_TAHUN: "tahun tidak valid (harus 2000–2100)",
            ERR_NOT_FOUND: "data tidak ditemukan"
        };
        return m[String(k)] || String(k);
    }
};

document.addEventListener("DOMContentLoaded", () => Absensi.init());
