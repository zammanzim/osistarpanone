// =========================================================================
// APP — DIPAKAI SEMUA HALAMAN (foto web + helper umum)
// Urutan include: ... db.js -> app.js -> (script halaman)
// =========================================================================

// Path default foto halaman (fallback kalau tabel web_foto kosong/reset)
// Prestasi & kegiatan sekarang DB-driven (tabel prestasi/kegiatan), jadi tidak ada di sini.
const FOTO_DEFAULT = {
    logo1: "web/logo1.png",
    bg: "web/bg.png",
    pembina: "web/pembina.jpg"
};

const FotoWeb = {
    map: { ...FOTO_DEFAULT },

    // Muat override dari tabel web_foto — SWR biar instant
    async init() {
        const cached = Cache.get("web_foto");
        if (cached) {
            cached.forEach(r => { if (r.path) FotoWeb.map[r.kunci] = r.path; });
            FotoWeb.apply();
            getWebFoto().then(fresh => {
                if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
                    Cache.set("web_foto", fresh);
                    fresh.forEach(r => { if (r.path) FotoWeb.map[r.kunci] = r.path; });
                    FotoWeb.apply();
                }
            }).catch(() => {});
            return;
        }
        try {
            const rows = await getWebFoto();
            Cache.set("web_foto", rows);
            rows.forEach(r => { if (r.path) FotoWeb.map[r.kunci] = r.path; });
        } catch (err) {
            console.error("Gagal muat web_foto, pakai default:", err);
        }
        FotoWeb.apply();
    },

    apply() {
        document.querySelectorAll("[data-foto]").forEach(el => {
            const p = FotoWeb.map[el.dataset.foto];
            if (p) el.src = getFoto(p);
        });
        document.querySelectorAll("[data-foto-bg]").forEach(el => {
            const p = FotoWeb.map[el.dataset.fotoBg];
            if (p) el.style.backgroundImage = `url('${getFoto(p)}')`;
        });
    }
};

// Label kecil "· oleh X" dari kolom snapshot `pengunggah` (semua modul).
// Kosong bila belum ada (cache lama / pra-migrasi) — render tetap aman.
function olehLabel(x) {
  const n = String((x && x.pengunggah) || "").trim();
  if (!n) return "";
  return `<span class="oleh-label">· oleh ${escapeHtml(n)}</span>`;
}

// Helper render
function escapeHtml(teks) {
    return String(teks ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function labelTahun(thn) {
    if (thn >= 2023) return `ADIABI JILID ${thn - 2022}`;
    return `Angkatan ${thn - 2009}`;
}

// =========================================================================
// ROUTER — SPA hash routing (index)
// Rute: #/ #/sekbid #/aspirasi #/kontak #/musik
// =========================================================================

const Router = {
    daftarView: ["home", "pengurus", "sekbid", "galeri", "arsip", "aspirasi", "kontak", "musik"],
    initFns: {},       // init lazy per view
    selesai: {},       // flag view sudah pernah di-init
    current: "home",
    token: 0,

    register(nama, fn) {
        Router.initFns[nama] = fn;
    },

    init() {
        window.addEventListener("hashchange", () => Router.go());
        window.addEventListener("resize", () => Router.geserPill(false));
        window.addEventListener("load", () => Router.geserPill(false));
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => Router.geserPill(false)).catch(() => {});
        Router.go();
        requestAnimationFrame(() => Router.geserPill(false));
    },

    parse() {
        const h = location.hash.replace(/^#\/?/, "").toLowerCase();
        return Router.daftarView.includes(h) ? h : "home";
    },

    go() {
        const nama = Router.parse();
        const token = ++Router.token;
        const old = document.querySelector(".view.active");
        const next = document.querySelector(`.view[data-view="${nama}"]`);
        if (!next) return;

        if (old && old !== next) {
            old.classList.remove("active");
            old.classList.add("leaving");
            setTimeout(() => {
                if (token !== Router.token) return;
                Router.tampilkan(nama, next);
            }, 170);
        } else {
            Router.tampilkan(nama, next);
        }

        Router.current = nama;
        document.querySelectorAll(".tab-item").forEach(t =>
            t.classList.toggle("active", t.dataset.route === nama)
        );
        document.querySelectorAll(".nav-sheet-item").forEach(t =>
            t.classList.toggle("active", t.dataset.route === nama)
        );
        // kalau rute dari sheet (pengurus/aspirasi), tombol tengah ikut aktif
        const moreBtn = document.getElementById("navMoreBtn");
        if (moreBtn) moreBtn.classList.toggle("is-in-sheet",
            !!document.querySelector(`.nav-sheet-item[data-route="${nama}"]`));
        Router.geserPill(true);

        if (typeof NavMore !== "undefined") NavMore.tutup();

        if (typeof Home !== "undefined" && Home.tutupModal) Home.tutupModal(true);
    },

    tampilkan(nama, el) {
        document.querySelectorAll(".view").forEach(v => v.classList.remove("active", "leaving"));
        el.classList.add("active");
        window.scrollTo(0, 0);
        if (!Router.selesai[nama] && Router.initFns[nama]) {
            Router.selesai[nama] = true;
            Router.initFns[nama]();
        }
    },

    // Indikator slide di bottom nav
    // - rute utama: pill nempel di tab-nya
    // - rute sheet (pengurus/aspirasi): pill nempel di tombol tengah
    geserPill(animasi) {
        const nav = document.getElementById("bottomNav");
        const pill = document.getElementById("navPill");
        if (!nav || !pill) return;
        let tab = nav.querySelector(`.tab-item[data-route="${Router.current}"]`);
        if (!tab) tab = document.getElementById("navMoreBtn");
        if (!tab) return;

        if (!animasi) pill.classList.add("no-anim");
        // offsetLeft/offsetWidth relatif ke nav (offsetParent) -> pas dengan border+padding nav,
        // kebal terhadap scroll, zoom, dan transform centering di desktop.
        // tombol tengah bulet: pill jadi bulet ngikutin.
        if (tab.id === "navMoreBtn") {
            const s = Math.min(tab.offsetWidth, tab.offsetHeight) || 56;
            pill.style.width = s + "px";
            pill.style.height = s + "px";
            pill.style.top = tab.offsetTop + "px";
            pill.style.bottom = "auto";
            pill.style.borderRadius = "50%";
        } else {
            pill.style.height = "";
            pill.style.top = "";
            pill.style.bottom = "";
            pill.style.borderRadius = "";
            pill.style.width = tab.offsetWidth + "px";
        }
        pill.style.transform = `translateX(${tab.offsetLeft}px)`;
        requestAnimationFrame(() => pill.classList.remove("no-anim"));
    }
};

// =========================================================================
// NAVMORE — bottom sheet "Menu Lainnya" (tombol bulet tengah)
// Tambah menu baru: tinggal tambah <a class="nav-sheet-item"> di index.html,
// otomatis ikut active-state + pill pindah ke tombol tengah.
// =========================================================================
const NavMore = {
    setIcon(open) {
        const ic = document.getElementById("navMoreIcon");
        if (!ic) return;
        ic.className = open ? "fa-solid fa-xmark" : "fa-solid fa-bars";
    },
    buka() {
        const sheet = document.getElementById("navSheet");
        const bg = document.getElementById("navSheetBackdrop");
        const btn = document.getElementById("navMoreBtn");
        if (!sheet) return;
        sheet.classList.add("open");
        if (bg) bg.classList.add("open");
        if (btn) btn.setAttribute("aria-expanded", "true");
        NavMore.setIcon(true);
    },
    tutup() {
        const sheet = document.getElementById("navSheet");
        const bg = document.getElementById("navSheetBackdrop");
        const btn = document.getElementById("navMoreBtn");
        if (sheet && !sheet.classList.contains("open")) { NavMore.setIcon(false); return; }
        if (sheet) sheet.classList.remove("open");
        if (bg) bg.classList.remove("open");
        if (btn) btn.setAttribute("aria-expanded", "false");
        NavMore.setIcon(false);
    },
    toggle() {
        const sheet = document.getElementById("navSheet");
        if (sheet && sheet.classList.contains("open")) NavMore.tutup();
        else NavMore.buka();
    }
};

// Helper: jalanin fn pas DOM siap (aman buat script defer)
function onReady(fn) {
    if (document.readyState === "complete") {
        fn();
    } else {
        document.addEventListener("DOMContentLoaded", fn);
    }
}

onReady(() => FotoWeb.init());
onReady(() => Router.init());
onReady(() => {
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && typeof NavMore !== "undefined") NavMore.tutup();
    });
});
