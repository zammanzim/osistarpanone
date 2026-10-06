// =========================================================================
// AKTIVITAS — catat buka halaman + heartbeat presence (60 detik) + aksi user.
// Dimuat di SEMUA halaman (index SPA + osis/* + login/polling/changelog).
// Jalan di atas db.js (pakai aktivitasHeartbeat/aktivitasCatat); tanpa
// db.js modul ini diam saja. Semua kiriman fire-and-forget, tidak pernah
// mengganggu UX kalau gagal/offline.
// =========================================================================

const Aktivitas = {
    siap: false,
    timer: null,
    detakJalan: false,
    ruteTerakhir: "",

    // Label rute SPA (index.html)
    LABEL: {
        home: "Beranda", pengurus: "Pengurus", sekbid: "Sekbid",
        galeri: "Galeri", feed: "Feed", arsip: "Arsip",
        aspirasi: "Aspirasi", kontak: "Kontak", musik: "Musik",
        informasi: "Informasi",
    },

    // Label halaman file (osis/* + standalone)
    LABEL_FILE: {
        login: "Login", polling: "Polling", changelog: "Changelog",
        tabungan: "Tabungan", keuangan: "Keuangan", absensi: "Absensi",
        agenda: "Agenda", anggota: "Anggota", dokumen: "Dokumen",
        akses: "Akses", informasi: "Informasi", poster: "Poster",
        profil: "Profil", "program-bulanan": "Program Bulanan",
        "program-tahunan": "Program Tahunan",
    },

    init() {
        if (Aktivitas.siap) return;
        Aktivitas.siap = true;
        // Halaman pertama: tunda sampai Router.init kelar (DOMContentLoaded)
        // biar deep-link (#/sekbid) kebaca rutenya, bukan "Beranda".
        // (Aktivitas.init jalan duluan karena script eval, Router nyusul.)
        const bukaAwal = () => {
            try { Aktivitas.ruteTerakhir = Aktivitas.halamanSaatIni(); } catch {}
            Aktivitas.bukaHalaman();
        };
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => setTimeout(bukaAwal, 400));
        } else {
            setTimeout(bukaAwal, 400);
        }
        // Heartbeat tiap 60 detik (background tab ikut 1x/menit via throttle browser)
        try {
            Aktivitas.timer = setInterval(() => Aktivitas.detak(), 60000);
        } catch {}
        // SPA pindah rute = halaman baru
        window.addEventListener("hashchange", () => {
            setTimeout(() => Aktivitas.bukaHalaman(), 300);
        });
        // Pengaman: kalau event hashchange ke-skip (navigasi programatik,
        // dsb), watcher 5 detik ini yang nangkap — status "di ..." ga stuck.
        // Cuma kirim pas rute beneran ganti (di tab aktif aja).
        try {
            setInterval(() => {
                try {
                    if (document.hidden) return;
                    const h = Aktivitas.halamanSaatIni();
                    if (h && h !== Aktivitas.ruteTerakhir) {
                        Aktivitas.ruteTerakhir = h;
                        Aktivitas.bukaHalaman();
                    }
                } catch {}
            }, 5000);
        } catch {}
        // Balik dari background = detak langsung biar status online akurat
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) Aktivitas.detak();
        });
    },

    // Halaman saat ini: rute SPA (index) atau nama file (osis/*, standalone)
    halamanSaatIni() {
        try {
            if (typeof Router !== "undefined" && Router.current) {
                const r = String(Router.current).toLowerCase();
                return Aktivitas.LABEL[r] || r;
            }
        } catch {}
        try {
            const p = String(location.pathname || "").replace(/\\/g, "/");
            const f = (p.split("/").pop() || "").toLowerCase().replace(/\.html?$/, "");
            if (!f || f === "index") {
                return /\/osis\//.test(p + "/") ? "Dashboard OSIS" : "Beranda";
            }
            if (Aktivitas.LABEL_FILE[f]) return Aktivitas.LABEL_FILE[f];
            return f.charAt(0).toUpperCase() + f.slice(1);
        } catch { return ""; }
    },

    // Detak presence: lagi online di halaman apa (tanpa nulis log)
    async detak() {
        if (Aktivitas.detakJalan || document.hidden) return;
        if (typeof aktivitasHeartbeat !== "function") return;
        Aktivitas.detakJalan = true;
        try { await aktivitasHeartbeat(Aktivitas.halamanSaatIni()); }
        catch {}
        Aktivitas.detakJalan = false;
    },

    // Buka halaman: tulis log (server dedupe 60 detik) + sentuh presence.
    // Presence dikirim duluan (fire-and-forget) biar status "di ..."
    // ke-update walau RPC log-nya gagal / ke-dedupe server.
    async bukaHalaman() {
        const h = Aktivitas.halamanSaatIni();
        try { Aktivitas.ruteTerakhir = h; } catch {}
        try {
            if (typeof aktivitasHeartbeat === "function") {
                try { aktivitasHeartbeat(h); } catch {}
            }
            if (typeof aktivitasCatat === "function") {
                await aktivitasCatat("buka_halaman", h, "");
            } else if (typeof aktivitasHeartbeat === "function") {
                await aktivitasHeartbeat(h);
            }
        } catch {}
    },

    // Catat 1 aksi user (upload, like, simpan, vote, login, ...).
    // Fire-and-forget: pemanggil TIDAK PERLU await.
    aksi(nama, detail) {
        try {
            if (typeof aktivitasCatat !== "function") return;
            aktivitasCatat(nama, Aktivitas.halamanSaatIni(), String(detail || "").slice(0, 200));
        } catch {}
    },
};

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => Aktivitas.init());
} else {
    Aktivitas.init();
}
