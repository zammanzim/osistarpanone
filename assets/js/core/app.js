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
    daftarView: ["home", "pengurus", "sekbid", "galeri", "feed", "arsip", "pelantikan", "aspirasi", "kontak", "musik", "informasi", "pengaturan"],
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

// ============================================================
// OsisSearch: sticky search bar di atas halaman + filter drawer (publik & OSIS)
// ============================================================
(function () {
    function syncNavHeight() {
        try {
            const nav = document.querySelector("header.top-nav");
            const h = nav ? Math.round(nav.getBoundingClientRect().height) : 74;
            if (h > 40) document.documentElement.style.setProperty("--osis-nav-h", h + "px");
        } catch (e) {}
    }

    function searchRootOf(target) {
        if (!target) return null;
        if (typeof target === "string") {
            const byId = document.getElementById(target);
            if (byId) return byId;
            try {
                return document.querySelector(target);
            } catch (e) {
                return null;
            }
        }
        return target;
    }

    function searchOpen(target) {
        const root = searchRootOf(target);
        if (!root) return;
        syncNavHeight();
        root.classList.add("open");
        const btn = root.querySelector(".osis-sb-filter-btn");
        if (btn) btn.setAttribute("aria-expanded", "true");
    }

    function searchClose(target) {
        const root = searchRootOf(target);
        if (!root) return;
        root.classList.remove("open");
        const btn = root.querySelector(".osis-sb-filter-btn");
        if (btn) btn.setAttribute("aria-expanded", "false");
        try {
            if (typeof Dropdown !== "undefined" && Dropdown.tutup) Dropdown.tutup();
        } catch (e) {}
    }

    function searchSetCount(target, n) {
        const root = searchRootOf(target);
        if (!root) return;
        const btn = root.querySelector(".osis-sb-filter-btn");
        const badge = root.querySelector(".osis-sb-badge");
        const val = parseInt(n, 10) || 0;
        if (badge) {
            badge.textContent = String(val);
            badge.hidden = val <= 0;
        }
        if (btn) btn.classList.toggle("has-active", val > 0);
    }

    function syncClear(root) {
        const inp = root.querySelector(".osis-sb-input");
        const clr = root.querySelector('.osis-sb-clear[data-osis-clear="auto"]');
        if (!inp || !clr) return;
        const has = !!(inp.value && inp.value.trim());
        clr.hidden = !has;
        clr.style.display = has ? "" : "none";
    }

    function computeAutoCount(root) {
        const panel = root.querySelector(".osis-sb-panel");
        if (!panel) return 0;
        let n = 0;
        const sels = panel.querySelectorAll("select");
        for (let i = 0; i < sels.length; i++) {
            const s = sels[i];
            if (s.disabled || s.hidden || s.getAttribute("data-auto-skip") === "1") continue;
            const def = s.getAttribute("data-default") || "";
            if ((s.value || "") !== def) n++;
        }
        const dates = panel.querySelectorAll('input[type="date"], input[type="month"]');
        for (let d = 0; d < dates.length; d++) {
            const dt = dates[d];
            if (!dt.disabled && !dt.hidden && dt.value) n++;
        }
        const cbs = panel.querySelectorAll('input[type="checkbox"], input[type="radio"]');
        for (let c = 0; c < cbs.length; c++) {
            const cb = cbs[c];
            if (!cb.disabled && !cb.hidden && cb.checked) n++;
        }
        const pills = panel.querySelectorAll('.on, .active, [aria-pressed="true"]');
        for (let p = 0; p < pills.length; p++) {
            const pl = pills[p];
            if (pl.closest(".dd")) continue;
            if (pl.getAttribute("data-default") === "1" || pl.getAttribute("data-auto-skip") === "1") continue;
            n++;
        }
        return n;
    }

    function syncAuto(target) {
        const root = searchRootOf(target);
        if (!root) return;
        syncClear(root);
        if (root.getAttribute("data-osis-auto-count") === "1") {
            searchSetCount(root, computeAutoCount(root));
        }
    }

    function resetAutoControls(root) {
        const inp = root.querySelector(".osis-sb-input");
        if (inp && inp.value) {
            inp.value = "";
            inp.dispatchEvent(new Event("input", { bubbles: true }));
        }
        const panel = root.querySelector(".osis-sb-panel");
        if (panel) {
            const sels = panel.querySelectorAll("select");
            for (let i = 0; i < sels.length; i++) {
                const s = sels[i];
                const def = s.getAttribute("data-default") || "";
                if ((s.value || "") !== def) {
                    s.value = def;
                    s.dispatchEvent(new Event("change", { bubbles: true }));
                }
            }
            const dates = panel.querySelectorAll('input[type="date"], input[type="month"]');
            for (let d = 0; d < dates.length; d++) {
                if (dates[d].value) {
                    dates[d].value = "";
                    dates[d].dispatchEvent(new Event("change", { bubbles: true }));
                }
            }
            const cbs = panel.querySelectorAll('input[type="checkbox"]');
            for (let c = 0; c < cbs.length; c++) {
                if (cbs[c].checked) {
                    cbs[c].checked = false;
                    cbs[c].dispatchEvent(new Event("change", { bubbles: true }));
                }
            }
            try { window.Dropdown && window.Dropdown.segarkanSemua && window.Dropdown.segarkanSemua(); } catch (e) {}
        }
        syncAuto(root);
    }

    function bindSearch(root) {
        if (!root || root.dataset.osisSearchBound === "1") return;
        root.dataset.osisSearchBound = "1";
        const inp = root.querySelector(".osis-sb-input");
        const btn = root.querySelector(".osis-sb-filter-btn");
        const closeBtn = root.querySelector(".osis-sb-close");
        const autoClr = root.querySelector('.osis-sb-clear[data-osis-clear="auto"]');
        const autoReset = root.querySelector('[data-osis-reset="auto"]');

        document.addEventListener("pointerdown", (e) => {
            root._osisPointerInside = !!(root.contains && root.contains(e.target));
        }, true);
        if (inp) {
            inp.addEventListener("focus", () => searchOpen(root));
            inp.addEventListener("click", () => searchOpen(root));
            inp.addEventListener("input", () => syncAuto(root));
        }
        if (autoClr) {
            autoClr.addEventListener("click", (e) => {
                e.stopPropagation();
                if (inp) {
                    inp.value = "";
                    inp.dispatchEvent(new Event("input", { bubbles: true }));
                    inp.focus();
                }
                syncAuto(root);
            });
        }
        if (autoReset) {
            autoReset.addEventListener("click", (e) => {
                e.stopPropagation();
                resetAutoControls(root);
            });
        }
        if (btn) {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (root.classList.contains("open")) {
                    searchClose(root);
                    if (inp && document.activeElement === inp) inp.blur();
                } else {
                    searchOpen(root);
                }
            });
        }
        if (closeBtn) {
            closeBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                searchClose(root);
                if (inp && document.activeElement === inp) inp.blur();
            });
        }
        root.addEventListener("change", () => setTimeout(() => syncAuto(root), 0));
        root.addEventListener("click", () => setTimeout(() => syncAuto(root), 0));
        document.addEventListener("click", (e) => {
            if (root._osisPointerInside) {
                root._osisPointerInside = false;
                return;
            }
            if (!root.classList.contains("open")) return;
            if (root.contains(e.target)) return;
            searchClose(root);
        });
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            if (!root.classList.contains("open")) return;
            if (root.querySelector(".dd.buka")) return;
            searchClose(root);
            if (inp && document.activeElement === inp) inp.blur();
        });
        syncAuto(root);
    }

    function initSearchAll() {
        syncNavHeight();
        const list = document.querySelectorAll(".osis-top-search");
        for (let i = 0; i < list.length; i++) bindSearch(list[i]);
    }

    function closeAllSearch() {
        const list = document.querySelectorAll(".osis-top-search.open");
        for (let i = 0; i < list.length; i++) searchClose(list[i]);
    }

    window.OsisSearch = { init: initSearchAll, open: searchOpen, close: searchClose, setCount: searchSetCount, sync: syncAuto };
    onReady(initSearchAll);
    window.addEventListener("resize", syncNavHeight);
    window.addEventListener("hashchange", () => {
        syncNavHeight();
        closeAllSearch();
    });
})();
