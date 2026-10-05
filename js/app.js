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
// RUPIAH — input teks + format titik ribuan otomatis, simpan angka murni.
// Pakai: ikatRupiah("kasNominal") sekali di init() halaman.
// Ketik "10000" -> tampil "10.000", parseRupiah("10.000") -> 10000.
// =========================================================================

// Ambil angka murni dari tampilan berformat ("10.000" / "Rp 10.000" -> 10000).
function parseRupiah(v) {
    return parseInt(String(v ?? "").replace(/\D/g, ""), 10) || 0;
}

// Format ulang isi input jadi titik ribuan, posisi kursor dipertahankan.
// Dipanggil tiap event "input" (ketik, tempel, hapus semua ke-cover).
function formatRupiah(el) {
    if (!el) return;
    const pos = (typeof el.selectionStart === "number") ? el.selectionStart : String(el.value || "").length;
    const digitSebelum = String(el.value || "").slice(0, pos).replace(/\D/g, "").length;
    // Maks 15 digit (aman presisi JS, cukup sampai 999 triliun)
    const angka = String(el.value || "").replace(/\D/g, "").slice(0, 15).replace(/^0+(?=\d)/, "");
    el.value = angka ? Number(angka).toLocaleString("id-ID") : "";
    // Kembalikan caret ke belakang digit yang sama seperti sebelum format
    let hit = 0, i = 0;
    const s = el.value;
    while (i < s.length && hit < digitSebelum) {
        if (/\d/.test(s[i])) hit++;
        i++;
    }
    try { el.setSelectionRange(i, i); } catch {}
}

// Pasang format otomatis ke input nominal (sekali per halaman).
function ikatRupiah(id) {
    const el = document.getElementById(id);
    if (!el || el.dataset.rupiahTerikat) return;
    el.dataset.rupiahTerikat = "1";
    el.addEventListener("input", () => formatRupiah(el));
}

// =========================================================================
// ROUTER — SPA hash routing (index)
// Rute: #/ #/sekbid #/aspirasi #/kontak #/musik
// =========================================================================

const Router = {
    daftarView: ["home", "pengurus", "sekbid", "galeri", "moments", "feed", "arsip", "aspirasi", "kontak", "musik", "informasi"],
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
        // Potong query di hash (mis. #/informasi?id=5) biar deep-link
        // share tetap kebaca rutenya; id dibaca view masing-masing.
        const h = location.hash.replace(/^#\/?/, "").toLowerCase().split("?")[0];
        if (Router.daftarView.includes(h)) return h;
        // Rute dari config Bottomnav dinamis (tab/sheet bisa diubah admin).
        try {
            if (typeof Bottomnav !== "undefined" && Bottomnav.punyaRoute(h)) return h;
        } catch (e) {}
        return "home";
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
        // kalau rute dari sheet (pengurus/aspirasi/arsip/musik), tombol
        // tengah ikut aktif (hitam + ikon halaman, lihat NavMore.setIcon)
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
        // Prioritas ikon: sheet kebuka = X | lagi di halaman sheet = ikon
        // halaman itu (biar tombol tengah nunjukin posisi) | default = bars.
        if (open) {
            ic.className = "fa-solid fa-xmark";
            NavMore.setLabel();
            return;
        }
        ic.className = NavMore.iconRoute() || "fa-solid fa-bars";
        NavMore.setLabel();
    },
    // Label nama menu di tombol tengah — dari data-short item sheet
    // (fallback ke teks <b>), default "Menu Lainnya" biar user tau ini
    // tombol buat munculin menu lain.
    setLabel() {
        const lb = document.getElementById("navMoreLabel");
        if (!lb) return;
        try {
            const r = (typeof Router !== "undefined" && Router.current) || "";
            const item = r && document.querySelector('.nav-sheet-item[data-route="' + r + '"]');
            if (item) {
                lb.textContent = (item.dataset && item.dataset.short) ||
                    (item.querySelector(".nsi-text b") || {}).textContent || "Menu Lainnya";
                return;
            }
        } catch (e) {}
        lb.textContent = "Menu Lainnya";
    },
    // Ikon halaman sheet yang sedang aktif — diambil dari item sheet di DOM
    // (sumber tunggal, otomatis ikut kalau nambah menu baru di index.html).
    iconRoute() {
        try {
            const r = (typeof Router !== "undefined" && Router.current) || "";
            if (!r) return "";
            const item = document.querySelector('.nav-sheet-item[data-route="' + r + '"] .nsi-ico i');
            if (item && item.className && /fa-/.test(item.className)) return item.className;
        } catch (e) {}
        return "";
    },
    refreshIcon() {
        const sheet = document.getElementById("navSheet");
        NavMore.setIcon(!!(sheet && sheet.classList.contains("open")));
    },
    buka() {
        const sheet = document.getElementById("navSheet");
        const bg = document.getElementById("navSheetBackdrop");
        const btn = document.getElementById("navMoreBtn");
        if (!sheet) return;
        NavMore.tandaiDibuka();
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
    },
    // Pemandu sekali-lihat: goyang + tooltip + dot sampai user buka sheet.
    // Disimpan di localStorage biar tidak ganggu user lama.
    pemanduInit() {
        try {
            const btn = document.getElementById("navMoreBtn");
            const dot = document.getElementById("navMoreDot");
            if (!btn) return;
            if (localStorage.getItem("navMoreOpened") === "1") {
                btn.classList.remove("attn");
                if (dot) dot.style.display = "none";
                return;
            }
            btn.classList.add("attn");
        } catch (e) {}
    },
    tandaiDibuka() {
        try { localStorage.setItem("navMoreOpened", "1"); } catch (e) {}
        const btn = document.getElementById("navMoreBtn");
        if (btn) btn.classList.remove("attn");
        const dot = document.getElementById("navMoreDot");
        if (dot) dot.style.display = "none";
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
onReady(() => { if (typeof NavMore !== "undefined") NavMore.pemanduInit(); });
onReady(() => {
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && typeof NavMore !== "undefined") NavMore.tutup();
    });
});
