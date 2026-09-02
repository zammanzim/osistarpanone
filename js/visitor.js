// =========================================================================
// VISITOR — hitung kunjungan unik per perangkat (1x/hari) + popup statistik
// Batas "hari" pake zona Asia/Jakarta, BUKAN UTC. Kalo UTC, hari ganti
// jam 07:00 WIB -> kunjungan pagi kehitung dobel walau perangkat sama.
// Popup dibagi 2 tab: Hari Ini & Total.
// =========================================================================

const Visitor = {
    inisialisasi: false,
    _fmtWib: null,
    rowsSemua: [],
    rowsHari: [],
    tabAktif: "hari",

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
    async muatStats() {
        const apply = (rows) => {
            const total = rows.reduce((a, r) => a + (r.jumlah || 0), 0);
            const tglHariIni = Visitor.tanggalWib(Date.now());
            Visitor.rowsHari = rows
                .filter(r => Visitor.tanggalWib(r.last_seen) === tglHariIni)
                .sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
            Visitor.rowsSemua = [...rows].sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
            const el = document.getElementById("headerVisitorCount");
            if (el) el.textContent = total.toLocaleString("id-ID");
            const t = document.getElementById("vstatTotal");
            if (t) t.textContent = total.toLocaleString("id-ID");
            const h = document.getElementById("vstatHari");
            if (h) h.textContent = Visitor.rowsHari.length.toLocaleString("id-ID");
            const u = document.getElementById("vstatUnik");
            if (u) u.textContent = rows.length.toLocaleString("id-ID");
            Visitor.renderList();
        };

        const cached = Cache.get("visitor");
        if (cached) {
            apply(cached);
            supa.from("visitor").select("device_id, jumlah, name, label, tipe, user_agent, resolusi, masuk, last_seen").then(({ data, error }) => {
                if (error || !data) return;
                if (JSON.stringify(data) !== JSON.stringify(cached)) {
                    Cache.set("visitor", data);
                    apply(data);
                }
            });
            return;
        }

        try {
            const { data, error } = await supa
                .from("visitor")
                .select("device_id, jumlah, name, label, tipe, user_agent, resolusi, masuk, last_seen");
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
        Visitor.renderList();
    },

    // ============ LIST PERANGKAT ============
    renderList() {
        const list = document.getElementById("visitorList");
        if (!list) return;

        const rows = Visitor.tabAktif === "total" ? Visitor.rowsSemua : Visitor.rowsHari;

        if (!rows || rows.length === 0) {
            const pesan = Visitor.tabAktif === "total"
                ? "Belum ada data perangkat."
                : "Belum ada pengunjung hari ini.";
            list.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-mobile-screen"></i> ${pesan}</div>`;
            return;
        }

        list.innerHTML = rows.map(v => {
            const namaOrang = (v.name || "").trim();
            // Kalo ada nama -> tampilin nama orang; kalo anonim -> nama HP
            const judul = escapeHtml(namaOrang || v.label || "Unknown");
            const ikonJudul = namaOrang ? "fa-user" : "fa-mobile-screen";

            // Tab TOTAL: semua perangkat + berapa kali kunjungan
            if (Visitor.tabAktif === "total") {
                return `
                    <div class="vitem">
                        <div class="vitem-head">
                            <span class="vitem-name"><i class="fa-solid ${ikonJudul}"></i> ${judul}</span>
                            <span class="vitem-count">${(v.jumlah || 0)}x</span>
                        </div>
                        ${Visitor.barisInfo(v)}
                        <div class="vitem-masuk"><i class="fa-solid fa-clock-rotate-left"></i> Terakhir online: ${Visitor.waktuLalu(v.last_seen)}</div>
                    </div>`;
            }

            // Tab HARI INI: perangkat yang online + jam masuk & durasi
            return `
                <div class="vitem">
                    <div class="vitem-head">
                        <span class="vitem-name"><i class="fa-solid ${ikonJudul}"></i> ${judul}</span>
                        <span class="vitem-durasi"><i class="fa-solid fa-clock"></i> ${Visitor.durasiOnline(v.masuk)}</span>
                    </div>
                    ${Visitor.barisInfo(v)}
                    <div class="vitem-masuk"><i class="fa-solid fa-right-to-bracket"></i> Masuk: ${Visitor.jamMasuk(v.masuk)}</div>
                </div>`;
        }).join("");
    },

    // Baris info perangkat: model HP (kalo ada nama) + tipe + resolusi.
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

    // ============ POPUP ============
    bukaPopup() {
        const ov = document.getElementById("visitorOverlay");
        if (!ov) return;
        Visitor.muatStats();
        ov.classList.add("open");
    },

    tutupPopup() {
        const ov = document.getElementById("visitorOverlay");
        if (ov) ov.classList.remove("open");
    }
};

if (typeof onReady === "function") {
    onReady(() => Visitor.init());
} else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => Visitor.init());
} else {
    Visitor.init();
}
