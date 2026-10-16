// =========================================================================
// OSIS-VISITOR — kunjungan dashboard khusus pengurus (TABEL PISAH TOTAL
// dari visitor publik: osis_visitor, bukan visitor).
// Beda dari js/visitor.js:
// - RPC tambah_osis_visitor_unik / osis_visitor_list (p_user_id osis,
//   ditolak server kalau bukan osis_users).
// - Tanpa tab Aktivitas (itu data global) dan tanpa realtime (tabel ini
//   SENGAJA tanpa SELECT policy; polling tiap popup dibuka sudah cukup).
// - ID elemen HTML dipakai ulang (page-local, cuma ada di osis/index.html).
// Butuh global: supa, Cache, OsisAuth, escapeHtml, onReady + helper db.js
// (getDeviceId, namaPerangkat, infoPerangkat, modeAkses, getVisitorName,
// getVisitorKey). db.js JANGAN diubah — file ini panggil RPC langsung.
// Aktif kalau migrasi db/migrasi-osis-visitor.sql sudah di-run; kalau
// belum, catat/list gagal silent (dashboard tetap jalan).
// =========================================================================

const OsisVisitor = {
    inisialisasi: false,
    _fmtWib: null,
    rowsSemua: [],
    rowsHari: [],
    tabAktif: "hari",

    // uid OSIS (null kalau bukan mode osis)
    uid() {
        try {
            const u = typeof OsisAuth !== "undefined" && OsisAuth.getUser ? OsisAuth.getUser() : null;
            if (u && u.mode === "osis" && u.id) return u.id;
        } catch {}
        return null;
    },

    // Online = detak presence < 3 menit
    isOnline(v) {
        try {
            const ms = Date.now() - new Date(v.last_seen).getTime();
            return ms >= 0 && ms < 3 * 60 * 1000;
        } catch { return false; }
    },

    init() {
        if (OsisVisitor.inisialisasi) return;
        OsisVisitor.inisialisasi = true;
        OsisVisitor.pasangCss();
        OsisVisitor.pasangOverlay();
        OsisVisitor.pasangTombol();
        OsisVisitor.catat();
        OsisVisitor.refresh();
        // Ikut renderHeader biar tombol sinkron tiap login/logout.
        try {
            if (typeof OsisAuth !== "undefined" && OsisAuth.renderHeader && !OsisAuth.renderHeader._osisVisHook) {
                var orig = OsisAuth.renderHeader.bind(OsisAuth);
                var hooked = function () {
                    orig();
                    try { OsisVisitor.refresh(); } catch (e) {}
                };
                hooked._osisVisHook = true;
                OsisAuth.renderHeader = hooked;
            }
        } catch (e) {}
    },

    // CSS khusus overlay suntikan (biar jalan walau style.css halaman basi).
    // Mirror aturan duo di css/osis-index.css (dashboard).
    pasangCss() {
        try {
            if (document.getElementById("osisVisCss")) return;
            var st = document.createElement("style");
            st.id = "osisVisCss";
            st.textContent =
                "#visitorOverlay .visitor-stats.duo{grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}" +
                "#visitorOverlay .vstat-card.now{background:var(--yellow,#ffd11a);box-shadow:3px 3px 0 var(--ink,#1a1314)}" +
                "#visitorOverlay .vstat-card.now b{color:var(--ink,#1a1314)}" +
                "#visitorOverlay .vstat-card.all{background:var(--white,#fff)}" +
                "#visitorOverlay .vstat-card.all b{color:var(--gray,#6f6668)}" +
                "#visitorOverlay .vitem-hal{font-size:.72rem;font-weight:600;color:var(--gray,#6f6668);margin-top:2px;display:flex;align-items:center;gap:6px;overflow-wrap:anywhere}" +
                "#visitorOverlay .vitem-hal i{color:var(--red,#e11d2e)}";
            document.head.appendChild(st);
        } catch (e) {}
    },

    // Tombol header (khusus osis). Dibikin JS biar semua halaman /osis
    // otomatis dapat tanpa copy markup. Skip kalau markup statis sudah ada.
    pasangTombol() {
        try {
            var lama = document.getElementById("osisVisitorTrigger");
            if (lama) return lama;
            var extra = document.querySelector(".top-nav-extra");
            if (!extra) return null;
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "visitor-trigger";
            btn.id = "osisVisitorTrigger";
            btn.title = "Pengunjung hari ini";
            btn.style.display = "none";
            btn.innerHTML = '<i class="fa-solid fa-eye"></i><span id="osisVisitorCount">-</span>';
            btn.addEventListener("click", function () { OsisVisitor.bukaPopup(); });
            extra.insertBefore(btn, extra.firstChild);
            return btn;
        } catch (e) { return null; }
    },

    // Overlay popup (sama kayak markup statis di osis/index.html).
    // Skip kalau sudah ada.
    pasangOverlay() {
        try {
            if (document.getElementById("visitorOverlay")) return;
            var ov = document.createElement("div");
            ov.className = "visitor-overlay";
            ov.id = "visitorOverlay";
            ov.innerHTML =
                '<div class="visitor-popup">' +
                '<div class="visitor-pop-head"><h3><i class="fa-solid fa-eye"></i> Pengunjung</h3>' +
                '<button id="tutupVisitor" aria-label="Tutup" onclick="OsisVisitor.tutupPopup()"><i class="fa-solid fa-xmark"></i></button></div>' +
                '<div class="visitor-stats duo">' +
                '<div class="vstat-card now"><b id="vstatHari">-</b><span><i class="fa-solid fa-eye"></i> Hari Ini</span></div>' +
                '<div class="vstat-card all"><b id="vstatTotal">-</b><span><i class="fa-solid fa-chart-simple"></i> Total</span></div>' +
                "</div>" +
                '<div class="visitor-list-head"><h4><i class="fa-solid fa-mobile-screen"></i> Daftar Perangkat</h4>' +
                '<div class="vtab-wrap">' +
                '<button type="button" class="vtab active" data-vtab="hari" onclick="OsisVisitor.gantiTab(\'hari\')">Hari Ini</button>' +
                '<button type="button" class="vtab" data-vtab="total" onclick="OsisVisitor.gantiTab(\'total\')">Total</button>' +
                "</div></div>" +
                '<div class="visitor-list" id="visitorList"><div class="pesan-empty"><i class="fa-solid fa-spinner fa-spin"></i> Memuat daftar...</div></div>' +
                '<p class="visitor-note"><i class="fa-solid fa-circle-info"></i> Satu perangkat dihitung 1x per hari.</p>' +
                "</div>";
            ov.addEventListener("click", function (e) {
                if (e.target === ov) OsisVisitor.tutupPopup();
            });
            document.body.appendChild(ov);
        } catch (e) {}
    },

    // Tampilkan tombol cuma kalau mode osis.
    refresh() {
        try {
            var btn = document.getElementById("osisVisitorTrigger") || OsisVisitor.pasangTombol();
            if (btn) btn.style.display = OsisVisitor.uid() ? "" : "none";
        } catch (e) {}
    },

    // Catat kunjungan (fire and forget), lalu muat statistik
    async catat() {
        try {
            const uid = OsisVisitor.uid();
            if (!uid) return; // khusus osis_users
            const info = infoPerangkat();
            let halaman = "Dashboard OSIS";
            try {
                const seg = String(location.pathname || "").split("/").filter(Boolean).pop() || "";
                if (seg) halaman = "osis/" + seg.replace(/\.html?$/i, "");
            } catch {}
            await supa.rpc("tambah_osis_visitor_unik", {
                p_user_id: uid,
                p_key: getDeviceId(),
                p_label: namaPerangkat(),
                p_tipe: info.tipe,
                p_ua: info.ua,
                p_resolusi: info.resolusi,
                p_name: getVisitorName(),
                p_user_key: getVisitorKey(),
                p_halaman: halaman,
                p_mode: modeAkses(),
            });
        } catch (err) {
            console.error("Gagal catat osis visitor:", err);
        }
        OsisVisitor.muatStats();
    },

    tanggalWib(t) {
        try {
            if (!OsisVisitor._fmtWib) {
                OsisVisitor._fmtWib = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" });
            }
            return OsisVisitor._fmtWib.format(new Date(t));
        } catch { return ""; }
    },

    // ============ STATISTIK — SWR (cache sendiri, kunci pisah) ============
    terapkanRows(rows) {
        rows = Array.isArray(rows) ? rows : [];
        const total = rows.reduce((a, r) => a + (r.jumlah || 0), 0);
        const tglHariIni = OsisVisitor.tanggalWib(Date.now());
        OsisVisitor.rowsHari = rows
            .filter(r => OsisVisitor.tanggalWib(r.last_seen) === tglHariIni)
            .sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
        OsisVisitor.rowsSemua = [...rows].sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
        const hariIni = OsisVisitor.rowsHari.length;
        const set = (id, v) => {
            try {
                const el = document.getElementById(id);
                if (el) el.textContent = v;
            } catch {}
        };
        set("dashVisitor", hariIni.toLocaleString("id-ID"));
        set("osisVisitorCount", hariIni.toLocaleString("id-ID"));
        set("osisMoreVisitorCount", hariIni.toLocaleString("id-ID"));
        set("vstatTotal", total.toLocaleString("id-ID"));
        set("vstatHari", hariIni.toLocaleString("id-ID"));
        OsisVisitor.renderList();
    },

    async muatStats() {
        const uid = OsisVisitor.uid();
        if (!uid) return;
        const apply = (rows) => OsisVisitor.terapkanRows(rows);
        try {
            const cached = (typeof Cache !== "undefined" && Cache.get) ? Cache.get("osis_visitor") : null;
            if (cached) {
                apply(cached);
                supa.rpc("osis_visitor_list", { p_user_id: uid }).then(({ data, error }) => {
                    if (error || !data) return;
                    if (JSON.stringify(data) !== JSON.stringify(cached)) {
                        try { Cache.set("osis_visitor", data); } catch {}
                        apply(data);
                    }
                });
                return;
            }
            const { data, error } = await supa.rpc("osis_visitor_list", { p_user_id: uid });
            if (error) throw error;
            const rows = Array.isArray(data) ? data : [];
            try { Cache.set("osis_visitor", rows); } catch {}
            apply(rows);
        } catch (err) {
            console.error("Gagal muat osis visitor:", err);
        }
    },

    // ============ TAB (Hari Ini / Total saja) ============
    gantiTab(tab) {
        OsisVisitor.tabAktif = tab === "total" ? "total" : "hari";
        document.querySelectorAll(".vtab").forEach(b =>
            b.classList.toggle("active", b.dataset.vtab === OsisVisitor.tabAktif)
        );
        const head = document.querySelector(".visitor-list-head h4");
        if (head) head.innerHTML = `<i class="fa-solid fa-mobile-screen"></i> Daftar Perangkat`;
        OsisVisitor.renderList();
    },

    // ============ LIST: nama + halaman | status online + jam masuk ============
    renderList() {
        const list = document.getElementById("visitorList");
        if (!list) return;

        let rows = OsisVisitor.tabAktif === "total" ? OsisVisitor.rowsSemua : OsisVisitor.rowsHari;
        rows = Array.isArray(rows) ? rows : [];

        if (!rows.length) {
            list.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-mobile-screen"></i> ${OsisVisitor.tabAktif === "total" ? "Belum ada data pengunjung." : "Belum ada pengunjung hari ini."}</div>`;
            return;
        }

        list.innerHTML = rows.map(v => {
            const nama = escapeHtml(((v.name || "").trim()) || "Anonim");
            const hal = escapeHtml(((v.halaman || "").trim()) || "-");
            const on = OsisVisitor.isOnline(v);
            const status = on
                ? `<div class="vhalaman on"><span class="vdot on"></span> Online</div>`
                : `<div class="vhalaman"><span class="vdot"></span> Terakhir aktif ${OsisVisitor.waktuLalu(v.last_seen)}</div>`;
            return `
                <div class="vitem">
                    <div class="vitem-top">
                        <div class="vitem-main">
                            <div class="vitem-name"><i class="fa-solid fa-user"></i> ${nama}</div>
                            <div class="vitem-hal"><i class="fa-solid fa-folder-open"></i> ${hal}</div>
                        </div>
                        <div class="vitem-side">
                            ${status}
                            <div class="vitem-masuk"><i class="fa-solid fa-right-to-bracket"></i> Masuk: ${OsisVisitor.jamMasuk(v.masuk)}</div>
                        </div>
                    </div>
                </div>`;
        }).join("");
    },

    jamMasuk(t) {
        try {
            return new Date(t).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
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

    popupBuka() {
        try {
            return !!document.getElementById("visitorOverlay")?.classList.contains("open");
        } catch { return false; }
    },

    // ============ POPUP ============
    bukaPopup() {
        const ov = document.getElementById("visitorOverlay");
        if (!ov) return;
        OsisVisitor.muatStats();
        ov.classList.add("open");
    },

    tutupPopup() {
        const ov = document.getElementById("visitorOverlay");
        if (ov) ov.classList.remove("open");
    }
};

if (typeof onReady === "function") {
    onReady(() => OsisVisitor.init());
} else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => OsisVisitor.init());
} else {
    OsisVisitor.init();
}
