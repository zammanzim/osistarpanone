// =========================================================================
// VISITOR — hitung kunjungan unik per perangkat (1x/hari) + popup statistik
// Batas "hari" pake zona Asia/Jakarta, BUKAN UTC. Kalo UTC, hari ganti
// jam 07:00 WIB -> kunjungan pagi kehitung dobel walau perangkat sama.
// Popup dibagi 2 tab: Hari Ini & Total.
// Header + chip tampilkan Hari Ini (bukan total).
// =========================================================================

const Visitor = {
    inisialisasi: false,
    _fmtWib: null,
    rowsSemua: [],
    rowsHari: [],
    tabAktif: "hari",
    filterMode: "semua",
    aktivitasCache: [],
    aktivitasWaktu: 0,
    channel: null,

    // Online = detak presence < 3 menit (heartbeat jalan tiap 60 detik)
    isOnline(v) {
        try {
            const ms = Date.now() - new Date(v.last_seen).getTime();
            return ms >= 0 && ms < 3 * 60 * 1000;
        } catch { return false; }
    },

    // Mode akses: "app" (PWA standalone) vs "browser". Baris lama /
    // cache lama yang belum ada kolomnya dianggap browser.
    modeOf(v) {
        try {
            return String(v && v.mode || "browser").toLowerCase() === "app" ? "app" : "browser";
        } catch { return "browser"; }
    },

    badgeMode(v) {
        const m = Visitor.modeOf(v);
        return m === "app"
            ? `<span class="vmode app" title="Dibuka dari App PWA ter-install"><i class="fa-solid fa-mobile-screen"></i> App</span>`
            : `<span class="vmode browser" title="Dibuka dari browser"><i class="fa-solid fa-globe"></i> Browser</span>`;
    },

    init() {
        if (Visitor.inisialisasi) return;
        Visitor.inisialisasi = true;
        Visitor.catat();
        const ov = document.getElementById("visitorOverlay");
        if (ov) ov.addEventListener("click", e => {
            if (e.target === ov) Visitor.tutupPopup();
        });
    },

    // Catat kunjungan (fire and forget), lalu muat statistik
    async catat() {
        try {
            await catatVisitor();
        } catch (err) {
            console.error("Visitor gagal dicatat:", err);
        }
        Visitor.muatStats();
    },

    // Tanggal YYYY-MM-DD versi WIB
    tanggalWib(t) {
        try {
            if (!Visitor._fmtWib) {
                Visitor._fmtWib = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" });
            }
            return Visitor._fmtWib.format(new Date(t));
        } catch { return ""; }
    },

    // ============ STATISTIK — SWR ============
    // Terapkan rows ke semua angka + list. Dipakai fetch awal & event realtime.
    terapkanRows(rows) {
        rows = Array.isArray(rows) ? rows : [];
        const total = rows.reduce((a, r) => a + (r.jumlah || 0), 0);
        const tglHariIni = Visitor.tanggalWib(Date.now());
        Visitor.rowsHari = rows
            .filter(r => Visitor.tanggalWib(r.last_seen) === tglHariIni)
            .sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
        Visitor.rowsSemua = [...rows].sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
        const hariIni = Visitor.rowsHari.length;
        const el = document.getElementById("headerVisitorCount");
        if (el) el.textContent = hariIni.toLocaleString("id-ID");
        const chip = document.getElementById("chipVisitor");
        if (chip) chip.textContent = hariIni.toLocaleString("id-ID");
        const t = document.getElementById("vstatTotal");
        if (t) t.textContent = total.toLocaleString("id-ID");
        const h = document.getElementById("vstatHari");
        if (h) h.textContent = Visitor.rowsHari.length.toLocaleString("id-ID");
        const u = document.getElementById("vstatUnik");
        if (u) u.textContent = rows.length.toLocaleString("id-ID");
        const o = document.getElementById("vstatOnline");
        if (o) o.textContent = rows.filter(r => Visitor.isOnline(r)).length.toLocaleString("id-ID");
        const appHari = Visitor.rowsHari.filter(r => Visitor.modeOf(r) === "app").length;
        const brHari = Visitor.rowsHari.length - appHari;
        const va = document.getElementById("vstatApp");
        if (va) va.textContent = appHari.toLocaleString("id-ID");
        const vb = document.getElementById("vstatBrowser");
        if (vb) vb.textContent = brHari.toLocaleString("id-ID");
        // Update angka di tombol filter mode (kalau ada di DOM baru)
        const fa = document.getElementById("vmodeCountApp");
        if (fa) fa.textContent = `App (${appHari})`;
        const fb = document.getElementById("vmodeCountBrowser");
        if (fb) fb.textContent = `Browser (${brHari})`;
        const fs = document.getElementById("vmodeCountSemua");
        if (fs) fs.textContent = `Semua (${Visitor.rowsHari.length})`;
        if (Visitor.tabAktif === "aktivitas") Visitor.muatAktivitas();
        else Visitor.renderList();
    },

    async muatStats() {
        const apply = (rows) => Visitor.terapkanRows(rows);
        const cached = Cache.get("visitor");
        const SELECT_BARU = "device_id, jumlah, name, user_key, label, tipe, user_agent, resolusi, masuk, last_seen, halaman, mode";
        const SELECT_LAMA = "device_id, jumlah, name, label, tipe, user_agent, resolusi, masuk, last_seen";
        if (cached) {
            apply(cached);
            supa.from("visitor").select(SELECT_BARU).then(({ data, error }) => {
                // Fallback kalo kolom user_key belum ada di DB (migrasi belum di-run)
                if (error && String(error.message || "").match(/user_key|column/i)) {
                    supa.from("visitor").select(SELECT_LAMA).then(({ data: d2, error: e2 }) => {
                        if (e2 || !d2) return;
                        if (JSON.stringify(d2) !== JSON.stringify(cached)) {
                            Cache.set("visitor", d2);
                            apply(d2);
                        }
                    });
                    return;
                }
                if (error || !data) return;
                if (JSON.stringify(data) !== JSON.stringify(cached)) {
                    Cache.set("visitor", data);
                    apply(data);
                }
            });
            return;
        }

        try {
            let { data, error } = await supa
                .from("visitor")
                .select(SELECT_BARU);
            // Fallback kolom lama
            if (error && String(error.message || "").match(/user_key|column/i)) {
                const fb = await supa.from("visitor").select(SELECT_LAMA);
                data = fb.data;
                error = fb.error;
            }
            if (error) throw error;
            const rows = data || [];
            Cache.set("visitor", rows);
            apply(rows);
        } catch (err) {
            console.error("Gagal muat statistik visitor:", err);
        }
    },

    // ============ TAB ============
    gantiTab(tab) {
        Visitor.tabAktif = tab;
        document.querySelectorAll(".vtab").forEach(b =>
            b.classList.toggle("active", b.dataset.vtab === tab)
        );
        const head = document.querySelector(".visitor-list-head h4");
        if (head) {
            head.innerHTML = tab === "aktivitas"
                ? `<i class="fa-solid fa-clock-rotate-left"></i> Aktivitas Terbaru`
                : `<i class="fa-solid fa-mobile-screen"></i> Daftar Perangkat`;
        }
        if (tab === "aktivitas") Visitor.muatAktivitas();
        else Visitor.renderList();
    },

    // ============ TAB AKTIVITAS (30 terbaru, cache 30 detik) ============
    async muatAktivitas() {
        const list = document.getElementById("visitorList");
        if (Visitor.aktivitasCache.length && Date.now() - Visitor.aktivitasWaktu < 30000) {
            Visitor.renderAktivitas();
            return;
        }
        if (list) list.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-spinner fa-spin"></i> Memuat aktivitas...</div>`;
        try {
            if (typeof aktivitasList !== "function") throw new Error("NO_RPC");
            Visitor.aktivitasCache = await aktivitasList(30);
            Visitor.aktivitasWaktu = Date.now();
        } catch {
            Visitor.aktivitasCache = [];
        }
        if (Visitor.tabAktif === "aktivitas") Visitor.renderAktivitas();
    },

    renderAktivitas() {
        const list = document.getElementById("visitorList");
        if (!list) return;
        const rows = Visitor.aktivitasCache || [];
        if (!rows.length) {
            list.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-clock-rotate-left"></i> Belum ada aktivitas tercatat.</div>`;
            return;
        }
        list.innerHTML = rows.map(a => {
            const siapa = escapeHtml(((a.nama || "").trim()) || "Anonim");
            const apa = escapeHtml(Visitor.labelAksi(a.aksi));
            const di = escapeHtml((a.halaman || "").trim() || "-");
            const det = (a.detail || "").trim()
                ? `<div class="aitem-det">${escapeHtml(a.detail)}</div>` : "";
            return `<div class="aitem">
                <div class="aitem-head"><span class="aitem-nama"><i class="fa-solid fa-user"></i> ${siapa}</span><span class="aitem-waktu">${Visitor.waktuLalu(a.created_at)}</span></div>
                <div class="aitem-aksi">${apa} · di <b>${di}</b></div>
                ${det}
            </div>`;
        }).join("");
    },

    // Label Indonesia buat aksi (yang tidak dikenal: tampil apa adanya)
    labelAksi(aksi) {
        const M = {
            buka_halaman: "Buka halaman", upload_feed: "Upload feed",
            like_feed: "Like feed", komen_feed: "Komen feed",
            share_feed: "Bagikan feed", hapus_feed: "Hapus feed",
            simpan_tabungan: "Catat tabungan", cek_tabungan: "Ceklis tabungan",
            hapus_tabungan: "Hapus tabungan", simpan_keuangan: "Catat keuangan",
            hapus_keuangan: "Hapus keuangan", simpan_absensi: "Catat absensi",
            vote_polling: "Vote polling", kirim_lagu: "Request lagu",
            kirim_aspirasi: "Kirim aspirasi", simpan_dokumen: "Upload dokumen",
            upload_moments: "Upload moments", login: "Login", logout: "Logout",
        };
        const k = String(aksi || "").toLowerCase();
        return M[k] || (String(aksi || "Aktivitas").replace(/_/g, " "));
    },

    // Filter App vs Browser (tombol di atas list)
    gantiMode(mode) {
        Visitor.filterMode = mode === "app" ? "app" : mode === "browser" ? "browser" : "semua";
        document.querySelectorAll(".vmode-filter").forEach(b =>
            b.classList.toggle("active", b.dataset.vmode === Visitor.filterMode)
        );
        Visitor.renderList();
    },

    // ============ LIST PERANGKAT ============
    renderList() {
        const list = document.getElementById("visitorList");
        if (!list) return;

        let rows = Visitor.tabAktif === "total" ? Visitor.rowsSemua : Visitor.rowsHari;
        rows = Array.isArray(rows) ? rows : [];
        // Filter mode cuma buat tab perangkat (hari/total), tab aktivitas polos
        if (Visitor.filterMode === "app" || Visitor.filterMode === "browser") {
            rows = rows.filter(v => Visitor.modeOf(v) === Visitor.filterMode);
        }

        if (!rows || rows.length === 0) {
            const pesan = Visitor.tabAktif === "total"
                ? "Belum ada data perangkat."
                : Visitor.filterMode !== "semua"
                    ? `Belum ada pengunjung dari ${Visitor.filterMode === "app" ? "App" : "Browser"} hari ini.`
                    : "Belum ada pengunjung hari ini.";
            list.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-mobile-screen"></i> ${pesan}</div>`;
            return;
        }

        list.innerHTML = rows.map(v => {
            const namaOrang = (v.name || "").trim();
            // Kalo ada nama -> tampilin nama orang; kalo anonim -> nama HP
            const judul = escapeHtml(namaOrang || v.label || "Unknown");
            const ikonJudul = namaOrang ? "fa-user" : "fa-mobile-screen";

            // Tab TOTAL: kiri info, kanan jumlah + badge + status (kayak tab Hari Ini)
            if (Visitor.tabAktif === "total") {
                return `
                    <div class="vitem">
                        <div class="vitem-top">
                            <div class="vitem-main">
                                <div class="vitem-name"><i class="fa-solid ${ikonJudul}"></i> ${judul}</div>
                                ${Visitor.barisInfo(v)}
                            </div>
                            <div class="vitem-side">
                                <span class="vitem-count">${(v.jumlah || 0)}x</span>
                                ${Visitor.badgeMode(v)}
                                ${Visitor.barisOnline(v)}
                            </div>
                        </div>
                    </div>`;
            }

            // Tab HARI INI: kiri info, kanan badge + status online
            return `
                <div class="vitem">
                    <div class="vitem-top">
                        <div class="vitem-main">
                            <div class="vitem-name"><i class="fa-solid ${ikonJudul}"></i> ${judul}</div>
                            ${Visitor.barisInfo(v)}
                            <div class="vitem-masuk"><i class="fa-solid fa-right-to-bracket"></i> Masuk: ${Visitor.jamMasuk(v.masuk)}</div>
                        </div>
                        <div class="vitem-side">
                            ${Visitor.badgeMode(v)}
                            ${Visitor.barisOnline(v)}
                        </div>
                    </div>
                </div>`;
        }).join("");
    },

    // Baris presence: titik hijau + halaman aktif kalau online,
    // abu + terakhir aktif kalau sudah pergi
    barisOnline(v) {
        const on = Visitor.isOnline(v);
        if (on) {
            const hal = ((v.halaman || "").trim());
            return `<div class="vhalaman on"><span class="vdot on"></span> Online${hal ? ` · di <b>${escapeHtml(hal)}</b>` : ""}</div>`;
        }
        return `<div class="vhalaman"><span class="vdot"></span> Terakhir aktif ${Visitor.waktuLalu(v.last_seen)}</div>`;
    },

    // Baris info perangkat: model HP (kalo ada nama) + tipe + resolusi.
    // Badge App/Browser + status online ditaro di kolom kanan (vitem-side).
    // User-agent mentah ditampilin di tooltip.
    barisInfo(v) {
        const namaOrang = (v.name || "").trim();
        const dev = (v.label || "").trim();
        const tipe = (v.tipe || "").trim();
        const res = (v.resolusi || "").trim();
        const bagian = [namaOrang ? dev : "", tipe, res].filter(Boolean);
        if (!bagian.length) return "";
        const ikon = tipe === "Mobile" ? "fa-mobile-screen"
            : tipe === "Tablet" ? "fa-tablet-screen-button"
            : tipe === "Desktop" ? "fa-desktop"
            : "fa-circle-question";
        return `<div class="vitem-info" title="${escapeHtml(v.user_agent || "")}"><i class="fa-solid ${ikon}"></i> ${escapeHtml(bagian.join(" · "))}</div>`;
    },

    jamMasuk(t) {
        try {
            return new Date(t).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
        } catch { return "-"; }
    },

    durasiOnline(t) {
        try {
            const ms = Date.now() - new Date(t).getTime();
            if (ms < 0 || ms < 60000) return "<1 mnt";
            const mnt = Math.floor(ms / 60000);
            if (mnt < 60) return mnt + " mnt";
            const jam = Math.floor(mnt / 60);
            const sisa = mnt % 60;
            return sisa ? `${jam} jam ${sisa} mnt` : `${jam} jam`;
        } catch { return "-"; }
    },

    waktuLalu(t) {
        try {
            const ms = Date.now() - new Date(t).getTime();
            if (ms < 0 || ms < 60000) return "baru saja";
            const mnt = Math.floor(ms / 60000);
            if (mnt < 60) return mnt + " mnt lalu";
            const jam = Math.floor(mnt / 60);
            if (jam < 24) return jam + " jam lalu";
            const hari = Math.floor(jam / 24);
            if (hari === 1) return "kemarin";
            return hari + " hari lalu";
        } catch { return "-"; }
    },

    // ============ REALTIME (cuma hidup pas popup dibuka) ============
    popupBuka() {
        try {
            return !!document.getElementById("visitorOverlay")?.classList.contains("open");
        } catch { return false; }
    },

    pastikanChannel() {
        if (Visitor.channel) return Visitor.channel;
        try {
            if (typeof supa === "undefined" || !supa.channel) return null;
            const ch = supa.channel("visitor-live");
            ch.on("postgres_changes",
                { event: "*", schema: "public", table: "visitor" },
                (payload) => Visitor.terimaVisitor(payload));
            ch.on("postgres_changes",
                { event: "INSERT", schema: "public", table: "aktivitas" },
                (payload) => Visitor.terimaAktivitas(payload));
            ch.subscribe((status) => {
                // Realtime gagal (mis. publication belum ada) -> lepas,
                // popup tetap jalan dengan fetch biasa.
                if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                    try { Visitor.stopRealtime(); } catch {}
                }
            });
            Visitor.channel = ch;
            return ch;
        } catch { return null; }
    },

    stopRealtime() {
        try {
            if (Visitor.channel && typeof supa !== "undefined" && supa.removeChannel) {
                supa.removeChannel(Visitor.channel);
            }
        } catch {}
        Visitor.channel = null;
    },

    // 1 baris visitor berubah (heartbeat user lain) -> merge tanpa fetch ulang
    terimaVisitor(payload) {
        if (!Visitor.popupBuka()) return;
        try {
            const hapus = payload && payload.eventType === "DELETE";
            const baris = hapus ? (payload.old || {}) : (payload.new || {});
            const id = baris && baris.device_id;
            if (!id) { Visitor.muatStats(); return; }
            let rows = [];
            try { rows = Cache.get("visitor") || []; } catch {}
            rows = Array.isArray(rows) ? [...rows] : [...(Visitor.rowsSemua || [])];
            const i = rows.findIndex(r => String(r.device_id) === String(id));
            if (hapus) {
                if (i >= 0) rows.splice(i, 1);
            } else if (i >= 0) {
                rows[i] = { ...rows[i], ...baris };
            } else {
                rows.unshift(baris);
            }
            try { Cache.set("visitor", rows); } catch {}
            Visitor.terapkanRows(rows);
        } catch {
            try { Visitor.muatStats(); } catch {}
        }
    },

    // 1 aktivitas baru -> taruh paling atas (tab Aktivitas)
    terimaAktivitas(payload) {
        if (!Visitor.popupBuka()) return;
        try {
            const baris = payload && payload.new;
            if (!baris || !baris.id) return;
            const cur = Array.isArray(Visitor.aktivitasCache) ? Visitor.aktivitasCache : [];
            if (cur.some(a => String(a.id) === String(baris.id))) return;
            Visitor.aktivitasCache = [baris, ...cur].slice(0, 30);
            Visitor.aktivitasWaktu = Date.now();
            if (Visitor.tabAktif === "aktivitas") Visitor.renderAktivitas();
        } catch {}
    },

    // ============ POPUP ============
    bukaPopup() {
        const ov = document.getElementById("visitorOverlay");
        if (!ov) return;
        Visitor.muatStats();
        ov.classList.add("open");
        Visitor.pastikanChannel();
    },

    tutupPopup() {
        const ov = document.getElementById("visitorOverlay");
        if (ov) ov.classList.remove("open");
        Visitor.stopRealtime();
    }
};

if (typeof onReady === "function") {
    onReady(() => Visitor.init());
} else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => Visitor.init());
} else {
    Visitor.init();
}
