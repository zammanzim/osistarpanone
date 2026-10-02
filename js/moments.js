// =========================================================================
// MOMENTS — feed foto + video ala Instagram Explore (desktop) &
// TikTok/Reels (mobile). Vanilla HTML/CSS/JS, tanpa framework baru.
//
// SUMBER DATA (berlapis, tanpa dummy permanen):
// 1) Tabel `moments` (migrasi-moments.sql) — 1 baris = 1 momen.
//    DB hanya menyimpan metadata/key R2 (media_key, thumb_key).
// 2) Fallback: tabel `gallery` yang sudah ada (foto per kegiatan
//    dipecah jadi item) — dipakai otomatis kalau tabel moments belum
//    ada (error MOMENTS_NO_TABLE), jadi halaman tetap berguna sebelum
//    migrasi di-run. Tidak menimpa cache "moments".
//
// KONTRAK ITEM (hasil Moments.normalisasi, dipakai filter + render):
// { uid, kind: 'photo'|'video', src, poster, caption, event,
//   category: 'events'|'random', tanggal, oleh, raw }
// Filter: all | photos | videos | events | random. Kategori baru
// tinggal tambah nilai + chip, tanpa ubah tabel lain.
//
// VIDEO (mobile-first performance):
// - muted + playsinline + loop + preload="none" secara default.
// - src dipasang lazy via IntersectionObserver (rootMargin 300px).
// - Autoplay HANYA di layout reels (≤700px) & rasio terlihat ≥0.6.
// - Satu video play dalam satu waktu (ref Moments.playing).
// - Item yang jauh dari viewport di-pause + di-unload (src dilepas).
// - Item berikutnya di-preload wajar (metadata/poster) saat item aktif.
//
// LIKE/COMMENT/SHARE: belum ada backend — tombol hanya UI stub via
// Moments.aksi() (TODO: sambung ke RPC moments_like dkk). Tidak ada
// angka/count palsu yang disimpan.
// =========================================================================

const Moments = {
    cache: [],          // baris mentah tabel moments (untuk cache "moments")
    items: [],          // item ternormalisasi siap render
    filter: "all",
    sumber: "moments",  // 'moments' | 'gallery'
    terinisialisasi: false,
    observer: null,
    playing: null,      // <video> yang sedang bunyi
    viewerList: [],     // item terfilter saat viewer dibuka
    viewerIdx: 0,
    statePushed: false,
    selfBack: false,
    pendingFile: null,
    pendingKind: "photo",

    // Filter yang didukung — sumber tunggal untuk chip + logika.
    FILTERS: [
        { key: "all", label: "All", icon: "fa-solid fa-layer-group" },
        { key: "photos", label: "Photos", icon: "fa-solid fa-image" },
        { key: "videos", label: "Videos", icon: "fa-solid fa-clapperboard" },
        { key: "events", label: "Events", icon: "fa-solid fa-calendar-day" },
        { key: "random", label: "Random", icon: "fa-solid fa-shuffle" },
    ],

    init() {
        if (Moments.terinisialisasi) return;
        Moments.terinisialisasi = true;
        if (typeof OsisAuth !== "undefined" && typeof OsisAuth.refreshAkses === "function") {
            OsisAuth.refreshAkses().then(() => { Moments.cekLogin(); Moments.render(); }).catch(() => {});
        }
        Moments.cekLogin();
        Moments.muat();
        Moments.bindGlobal();
        Moments.pasangObserver();
    },

    // Hak tulis halaman ini. Super_admin lolos otomatis (OsisAuth.bisa).
    bolehTulis() {
        try {
            return typeof OsisAuth !== "undefined" && OsisAuth.bisa && OsisAuth.bisa("moments");
        } catch { return false; }
    },

    cekLogin() {
        const btn = document.getElementById("btnTambahMoments");
        if (btn) btn.style.display = Moments.bolehTulis() ? "" : "none";
        const feed = document.getElementById("momentsFeed");
        if (feed) feed.classList.toggle("mode-osis", Moments.bolehTulis());
    },

    // Layout reels aktif? (cerminan breakpoint CSS ≤700px)
    isReels() {
        try {
            return window.matchMedia("(max-width: 700px)").matches;
        } catch { return false; }
    },

    // ============ MUAT DATA (SWR) ============
    async muat(force) {
        const feed = document.getElementById("momentsFeed");
        if (!feed) return;

        if (!force) {
            const cached = (typeof Cache !== "undefined" && Cache.get("moments")) || null;
            if (cached && Array.isArray(cached)) {
                Moments.cache = cached;
                Moments.sumber = "moments";
                Moments.bangunItems();
                Moments.render();
            }
        }

        try {
            const rows = await getMoments();
            if (typeof Cache !== "undefined") Cache.set("moments", rows);
            Moments.cache = rows || [];
            Moments.sumber = "moments";
            Moments.bangunItems();
            Moments.render();
        } catch (err) {
            if (err && err.message === "MOMENTS_NO_TABLE") {
                // Migrasi belum di-run — fallback ke gallery (foto existing).
                try {
                    const gal = await getGallery();
                    Moments.cache = [];
                    Moments.sumber = "gallery";
                    Moments.bangunItemsDariGaleri(gal || []);
                    Moments.render();
                } catch (err2) {
                    console.error(err2);
                    Moments.renderError();
                }
                return;
            }
            console.error(err);
            // Offline tapi ada cache -> biarkan cache tampil; kalau kosong tampilkan error.
            if (!Moments.items.length) Moments.renderError();
        }
    },

    // Normalisasi baris moments -> kontrak item frontend.
    normalisasiRow(r) {
        const kind = r.media_type === "video" ? "video" : "photo";
        const src = (typeof getFoto === "function" ? getFoto(r.media_key) : (r.media_key || ""));
        const poster = r.thumb_key
            ? (typeof getFoto === "function" ? getFoto(r.thumb_key) : r.thumb_key)
            : "";
        return {
            uid: "m-" + r.id,
            srcId: r.id,
            kind,
            src,
            poster,
            caption: r.caption || "",
            event: r.event_name || "",
            category: r.category === "events" ? "events" : "random",
            tanggal: r.created_at || "",
            oleh: r.pengunggah || "",
            raw: r,
        };
    },

    bangunItems() {
        Moments.items = (Moments.cache || [])
            .filter(r => r && r.media_key)
            .map(r => Moments.normalisasiRow(r));
    },

    // Fallback gallery: tiap foto kegiatan jadi 1 item (kategori events).
    bangunItemsDariGaleri(galeri) {
        const out = [];
        (galeri || []).forEach(g => {
            const fotos = Array.isArray(g.fotos) ? g.fotos : [];
            fotos.forEach((path, i) => {
                if (!path) return;
                const s = String(path);
                const kind = /\.(mp4|webm|mov)(\?|#|$)/i.test(s) ? "video" : "photo";
                out.push({
                    uid: "g-" + g.id + "-" + i,
                    srcId: g.id,
                    kind,
                    src: (typeof getFoto === "function" ? getFoto(s) : s),
                    poster: "",
                    caption: g.deskripsi || g.judul || "",
                    event: g.judul || "",
                    category: "events",
                    tanggal: g.created_at || "",
                    oleh: g.pengunggah || "",
                    raw: g,
                });
            });
        });
        Moments.items = out;
    },

    filtered() {
        const f = Moments.filter;
        if (f === "photos") return Moments.items.filter(i => i.kind === "photo");
        if (f === "videos") return Moments.items.filter(i => i.kind === "video");
        if (f === "events") return Moments.items.filter(i => i.category === "events");
        if (f === "random") return Moments.items.filter(i => i.category === "random");
        return Moments.items;
    },

    setFilter(key) {
        if (!Moments.FILTERS.some(f => f.key === key)) return;
        Moments.filter = key;
        Moments.pauseAll();
        Moments.render();
        const feed = document.getElementById("momentsFeed");
        if (feed) {
            if (Moments.isReels()) feed.scrollTop = 0;
            else if (typeof feed.scrollIntoView === "function") {
                try { feed.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch {}
            }
        }
    },

    fmtTanggal(iso) {
        try {
            if (!iso) return "";
            return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
        } catch { return ""; }
    },

    // ============ RENDER ============
    render() {
        const feed = document.getElementById("momentsFeed");
        if (!feed) return;
        Moments.pauseAll();

        const chips = document.getElementById("momentsChips");
        if (chips) {
            const hitungFilter = (key) => {
                if (key === "all") return Moments.items.length;
                if (key === "photos") return Moments.items.filter(i => i.kind === "photo").length;
                if (key === "videos") return Moments.items.filter(i => i.kind === "video").length;
                if (key === "events") return Moments.items.filter(i => i.category === "events").length;
                if (key === "random") return Moments.items.filter(i => i.category === "random").length;
                return 0;
            };
            chips.innerHTML = Moments.FILTERS.map(f => {
                const n = hitungFilter(f.key);
                return `<button type="button" data-filter="${f.key}" class="${Moments.filter === f.key ? "on" : ""}" onclick="Moments.setFilter('${f.key}')">` +
                    `<i class="${f.icon}"></i> ${typeof escapeHtml === "function" ? escapeHtml(f.label) : f.label}` +
                    (n ? ` <b>${n}</b>` : "") + `</button>`;
            }).join("");
        }

        const hitung = document.getElementById("momentsHitung");
        const sub = document.getElementById("momentsSubHitung");
        const list = Moments.filtered();
        if (hitung) hitung.textContent = String(list.length);
        if (sub) sub.textContent = Moments.sumber === "gallery"
            ? "Dari galeri (jalankan migrasi-moments.sql untuk koleksi Moments sendiri)"
            : (list.length === 1 ? "momen" : "momen");

        const elSumber = document.getElementById("momentsSumber");
        if (elSumber) {
            elSumber.textContent = Moments.sumber === "gallery"
                ? "Sumber sementara: Galeri"
                : "Disimpan aman di R2";
        }

        if (!list.length) {
            feed.innerHTML = `<div class="moments-empty"><i class="fa-solid fa-clapperboard"></i>` +
                (Moments.items.length
                    ? "Tidak ada momen pada filter ini. Coba filter lain."
                    : "Belum ada momen. Jadilah yang pertama mengabadikan keseruan OSIS!") +
                `</div>`;
            return;
        }

        feed.innerHTML = list.map((it, idx) => Moments.kartu(it, idx)).join("");
        Moments.amatiKartu();
    },

    renderError() {
        const feed = document.getElementById("momentsFeed");
        if (feed) {
            feed.innerHTML = `<div class="moments-empty"><i class="fa-solid fa-triangle-exclamation"></i>` +
                `Gagal memuat momen. Cek koneksi lalu tekan Refresh.</div>`;
        }
    },

    kartu(it, idx) {
        const cap = (typeof escapeHtml === "function" ? escapeHtml(it.caption) : it.caption) || "Tanpa caption";
        const ev = typeof escapeHtml === "function" ? escapeHtml(it.event) : it.event;
        const tgl = Moments.fmtTanggal(it.tanggal);
        const oleh = typeof escapeHtml === "function" ? escapeHtml(it.oleh) : it.oleh;
        const canDel = Moments.bolehTulis() && Moments.sumber === "moments";

        let media = "";
        if (it.kind === "video") {
            // src dikosongkan: dipasang lazy oleh IntersectionObserver (hemat kuota).
            // Tanpa poster pakai preload="metadata" biar frame pertama tampil.
            media = `<video muted loop playsinline ${it.poster ? `preload="none" poster="${it.poster}"` : `preload="metadata"`} data-src="${it.src}"` +
                ` disablepictureinpicture></video>` +
                `<div class="moment-play"><span><i class="fa-solid fa-play"></i></span></div>`;
        } else {
            media = `<span class="media-muat media-muat-tinggi"><img src="${it.src}" alt="${cap}" loading="lazy" decoding="async" onload="this.closest('.media-muat').classList.add('sudah-muat')" onerror="this.closest('.media-muat').classList.add('sudah-muat')"><span class="media-muat-loading" aria-hidden="true"><span class="spinner"></span></span></span>`;
        }

        return `<article class="moment-card" data-uid="${it.uid}" data-idx="${idx}" onclick="Moments.bukaViewer(${idx})">` +
            `<div class="moment-media">${media}` +
            `<div class="moment-badges">` +
            `<span class="moment-badge ${it.kind === "video" ? "t-video" : ""}">` +
            `<i class="fa-solid ${it.kind === "video" ? "fa-clapperboard" : "fa-image"}"></i> ${it.kind === "video" ? "Video" : "Foto"}</span>` +
            (it.category === "events" ? `<span class="moment-badge t-cat"><i class="fa-solid fa-calendar-day"></i> Event</span>` : "") +
            `</div></div>` +
            `<div class="moment-meta">` +
            `<p class="moment-caption">${cap}</p>` +
            `<div class="moment-sub">` +
            (ev ? `<span><i class="fa-solid fa-location-dot"></i> ${ev}</span>` : "") +
            (tgl ? `<span><i class="fa-regular fa-calendar"></i> ${tgl}</span>` : "") +
            `</div>` +
            (oleh ? `<span class="moment-oleh">· oleh ${oleh}</span>` : "") +
            `</div>` +
            `<div class="moment-aksi">` +
            `<button type="button" title="Suka" aria-label="Suka" onclick="event.stopPropagation(); Moments.aksi('like', '${it.uid}')"><i class="fa-solid fa-heart"></i></button>` +
            `<button type="button" title="Komentar" aria-label="Komentar" onclick="event.stopPropagation(); Moments.aksi('comment', '${it.uid}')"><i class="fa-solid fa-comment"></i></button>` +
            `<button type="button" title="Bagikan" aria-label="Bagikan" onclick="event.stopPropagation(); Moments.aksi('share', '${it.uid}')"><i class="fa-solid fa-share-nodes"></i></button>` +
            (canDel ? `<button type="button" title="Hapus" aria-label="Hapus" onclick="event.stopPropagation(); Moments.hapus('${it.uid}')"><i class="fa-solid fa-trash-can"></i></button>` : "") +
            `</div>` +
            `</article>`;
    },

    // ============ INTERSECTION OBSERVER (lazy + autoplay + unload) ============
    pasangObserver() {
        if (Moments.observer) return;
        if (!("IntersectionObserver" in window)) return;
        Moments.observer = new IntersectionObserver((entries) => {
            entries.forEach(en => Moments.onIntersect(en));
        }, {
            root: null,
            rootMargin: "300px 0px 300px 0px",
            threshold: [0, 0.25, 0.6, 1],
        });
    },

    amatiKartu() {
        if (!Moments.observer) return;
        try { Moments.observer.disconnect(); } catch {}
        document.querySelectorAll("#momentsFeed .moment-card").forEach(el => {
            try { Moments.observer.observe(el); } catch {}
        });
    },

    videoEl(card) {
        return card ? card.querySelector("video") : null;
    },

    // Pasang src lazy (sekali) — hemat request sampai item dekat viewport.
    pastikanSrc(video) {
        if (!video || video.getAttribute("src")) return;
        const ds = video.getAttribute("data-src");
        if (ds) {
            video.src = ds;
            try { video.load(); } catch {}
        }
    },

    onIntersect(en) {
        const card = en.target;
        const video = Moments.videoEl(card);
        if (!video) return;

        const ratio = en.intersectionRatio || 0;

        if (en.isIntersecting && ratio > 0) {
            // Dekat viewport: siapkan src (lazy) tanpa memutar.
            Moments.pastikanSrc(video);
            if (Moments.isReels() && ratio >= 0.6) {
                Moments.putar(video);
                // Preload wajar: siapkan media item berikutnya biar scroll mulus.
                Moments.preloadBerikut(card);
            } else if (!Moments.isReels()) {
                // Desktop: grid tidak autoplay — cukup thumbnail/poster.
                Moments.jeda(video);
            } else {
                Moments.jeda(video);
            }
        } else {
            Moments.jeda(video);
            // Unload media yang sudah jauh dari viewport (hemat memori HP).
            try {
                const r = card.getBoundingClientRect();
                const vh = window.innerHeight || 800;
                if (r.top > vh * 2 || r.bottom < -vh * 2) {
                    video.removeAttribute("src");
                    try { video.load(); } catch {}
                    if (Moments.playing === video) Moments.playing = null;
                }
            } catch {}
        }
    },

    preloadBerikut(card) {
        try {
            const next = card.nextElementSibling;
            if (!next) return;
            const v = Moments.videoEl(next);
            if (v) {
                Moments.pastikanSrc(v);
            } else {
                const img = next.querySelector("img");
                if (img && img.getAttribute("src") && img.loading !== "eager") {
                    const pre = new Image();
                    pre.src = img.getAttribute("src");
                }
            }
        } catch {}
    },

    // Putar satu video; pastikan tidak ada dua video bunyi bersamaan.
    putar(video) {
        if (!video) return;
        if (Moments.playing && Moments.playing !== video) Moments.jeda(Moments.playing);
        Moments.playing = video;
        try {
            video.muted = true; // muted default (autoplay policy + spek)
            const p = video.play();
            if (p && p.catch) p.catch(() => {});
        } catch {}
    },

    jeda(video) {
        if (!video) return;
        try { video.pause(); } catch {}
        if (Moments.playing === video) Moments.playing = null;
    },

    pauseAll() {
        try {
            document.querySelectorAll("#momentsFeed video").forEach(v => { try { v.pause(); } catch {} });
        } catch {}
        Moments.playing = null;
    },

    // ============ VIEWER FULLSCREEN ============
    bukaViewer(idx) {
        const list = Moments.filtered();
        if (!list.length) return;
        Moments.viewerList = list;
        Moments.viewerIdx = Math.max(0, Math.min(idx || 0, list.length - 1));
        Moments.pauseAll();
        Moments.statePushed = false;
        try {
            history.pushState({ moments: true }, "");
            Moments.statePushed = true;
        } catch {}
        Moments.renderViewer();
    },

    viewerItem() {
        return Moments.viewerList[Moments.viewerIdx] || null;
    },

    renderViewer() {
        Moments.tutupViewerDom();
        const it = Moments.viewerItem();
        if (!it) return;
        const cap = (typeof escapeHtml === "function" ? escapeHtml(it.caption) : it.caption) || "Tanpa caption";
        const ev = typeof escapeHtml === "function" ? escapeHtml(it.event) : it.event;
        const tgl = Moments.fmtTanggal(it.tanggal);
        const oleh = typeof escapeHtml === "function" ? escapeHtml(it.oleh) : it.oleh;

        const media = it.kind === "video"
            ? `<video src="${it.src}" controls loop playsinline preload="metadata"${it.poster ? ` poster="${it.poster}"` : ""}></video>`
            : `<span class="media-muat media-muat-tinggi" style="width:100%"><img src="${it.src}" alt="${cap}" draggable="false" onload="this.closest('.media-muat').classList.add('sudah-muat')" onerror="this.closest('.media-muat').classList.add('sudah-muat')"><span class="media-muat-loading" aria-hidden="true"><span class="spinner"></span></span></span>`;

        const ov = document.createElement("div");
        ov.className = "moments-viewer";
        ov.id = "momentsViewer";
        try { ov.dataset.seq = String((window.__seqModal = (window.__seqModal || 0) + 1)); } catch {}
        ov.innerHTML =
            `<div class="moments-viewer-bg"></div>` +
            `<div class="moments-viewer-box" role="dialog" aria-modal="true" aria-label="Moments viewer">` +
            `<button class="moments-viewer-close" type="button" onclick="Moments.tutupViewer()" aria-label="Tutup"><i class="fa-solid fa-xmark"></i></button>` +
            `<button class="moments-viewer-nav prev" type="button" onclick="Moments.geserViewer(-1)" aria-label="Sebelumnya"><i class="fa-solid fa-chevron-left"></i></button>` +
            `<button class="moments-viewer-nav next" type="button" onclick="Moments.geserViewer(1)" aria-label="Berikutnya"><i class="fa-solid fa-chevron-right"></i></button>` +
            `<div class="moments-viewer-media">${media}</div>` +
            `<div class="moments-viewer-info">` +
            (ev ? `<span class="moments-viewer-event"><i class="fa-solid fa-location-dot"></i> ${ev}</span>` : "") +
            `<h4>${cap}</h4>` +
            (tgl ? `<div class="moments-viewer-tgl"><i class="fa-regular fa-calendar"></i> ${tgl}</div>` : "") +
            `<div class="moments-viewer-tgl"><i class="fa-solid ${it.kind === "video" ? "fa-clapperboard" : "fa-image"}"></i> ` +
            `${it.kind === "video" ? "Video" : "Foto"} · ${it.category === "events" ? "Event" : "Random"}</div>` +
            (oleh ? `<div class="moments-viewer-oleh">Diupload oleh ${oleh}</div>` : "") +
            `<div class="moments-viewer-aksi">` +
            `<button type="button" onclick="Moments.aksi('like', '${it.uid}')"><i class="fa-solid fa-heart"></i> Suka</button>` +
            `<button type="button" onclick="Moments.aksi('comment', '${it.uid}')"><i class="fa-solid fa-comment"></i> Komen</button>` +
            `<button type="button" onclick="Moments.aksi('share', '${it.uid}')"><i class="fa-solid fa-share-nodes"></i> Share</button>` +
            `</div>` +
            `</div>` +
            `<div class="moments-viewer-pos">${Moments.viewerIdx + 1} / ${Moments.viewerList.length}</div>` +
            `</div>`;

        ov.querySelector(".moments-viewer-bg").addEventListener("click", () => Moments.tutupViewer());
        document.body.appendChild(ov);
        document.body.style.overflow = "hidden";
        Moments.pasangSwipeViewer(ov.querySelector(".moments-viewer-media"));

        // Video viewer: coba putar bersuara (user explicit open); fallback muted.
        const v = ov.querySelector("video");
        if (v) {
            try {
                v.muted = false;
                const p = v.play();
                if (p && p.catch) p.catch(() => { try { v.muted = true; v.play().catch(() => {}); } catch {} });
            } catch {}
        }
    },

    tutupViewerDom() {
        const ov = document.getElementById("momentsViewer");
        if (ov) {
            const v = ov.querySelector("video");
            if (v) { try { v.pause(); } catch {} }
            ov.remove();
        }
        if (!document.querySelector(".struktur-modal")) document.body.style.overflow = "";
    },

    tutupViewer(dariBack) {
        Moments.tutupViewerDom();
        Moments.viewerList = [];
        const perluBack = !dariBack && Moments.statePushed;
        Moments.statePushed = false;
        if (perluBack) {
            Moments.selfBack = true;
            setTimeout(() => { Moments.selfBack = false; }, 300);
            try { history.back(); } catch {}
        }
    },

    geserViewer(arah) {
        if (!Moments.viewerList.length) return;
        const n = Moments.viewerList.length;
        Moments.viewerIdx = (Moments.viewerIdx + arah + n) % n;
        Moments.renderViewer();
    },

    pasangSwipeViewer(el) {
        if (!el) return;
        let sx = 0, sy = 0, track = false;
        el.addEventListener("pointerdown", (e) => {
            if (e.button !== undefined && e.button !== 0) return;
            track = true; sx = e.clientX; sy = e.clientY;
        });
        el.addEventListener("pointerup", (e) => {
            if (!track) return;
            track = false;
            const dx = e.clientX - sx, dy = e.clientY - sy;
            if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) {
                Moments.geserViewer(dx < 0 ? 1 : -1);
            }
        });
        el.addEventListener("pointercancel", () => { track = false; });
    },

    bindGlobal() {
        if (Moments._globalBound) return;
        Moments._globalBound = true;
        document.addEventListener("keydown", (e) => {
            if (!document.getElementById("momentsViewer")) return;
            const active = document.activeElement;
            if (active && (active.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName))) return;
            if (e.key === "Escape") Moments.tutupViewer();
            if (e.key === "ArrowLeft") Moments.geserViewer(-1);
            if (e.key === "ArrowRight") Moments.geserViewer(1);
        });
        window.addEventListener("popstate", (e) => {
            if (e && e.__modalKonsumsi) return;
            if ((window.__abaikanBack | 0) > 0) {
                window.__abaikanBack--;
                if (e) e.__modalKonsumsi = true;
                return;
            }
            if (Moments.selfBack) { Moments.selfBack = false; return; }
            if (window.__topModal) {
                try {
                    const t = window.__topModal();
                    if (t && t.sys !== "home") return;
                } catch {}
            }
            if (document.getElementById("momentsViewer")) Moments.tutupViewer(true);
        });
        window.addEventListener("hashchange", () => {
            try {
                const r = (typeof Router !== "undefined" && Router.current) || "";
                if (r !== "moments") {
                    Moments.pauseAll();
                    if (document.getElementById("momentsViewer")) Moments.tutupViewer(true);
                } else {
                    Moments.cekLogin();
                }
            } catch {}
        });
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) Moments.pauseAll();
        });
    },

    // ============ AKSI SOSIAL (STUB — belum ada backend) ============
    // TODO(backend): ganti isi tiap cabang dengan RPC nyata, mis:
    //   like    -> supa.rpc("moments_like", { p_id })
    //   comment -> buka thread komentar (tabel moments_comments)
    //   share   -> navigator.share + fallback copy link (#/moments?m=<id>)
    // Sampai saat itu: jangan simpan angka palsu di mana pun.
    aksi(jenis, uid) {
        const it = (Moments.items || []).find(x => x.uid === uid) || Moments.viewerItem();
        if (jenis === "share" && it) {
            const url = location.origin + location.pathname + "#/moments";
            const data = { title: "Moments OSIS TARPAN ONE", text: it.caption || "Lihat momen OSIS!", url };
            if (navigator.share) {
                navigator.share(data).catch(() => {});
                return;
            }
            try {
                (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(
                    () => { if (typeof showToast === "function") showToast("Tautan disalin!", "success"); },
                    () => { if (typeof showToast === "function") showToast("Gagal menyalin tautan", "error"); }
                );
                return;
            } catch {}
        }
        if (typeof showToast === "function") {
            showToast(
                jenis === "like" ? "Fitur suka segera hadir!" :
                jenis === "comment" ? "Fitur komentar segera hadir!" :
                "Fitur share segera hadir!",
                "info"
            );
        }
    },

    // ============ TAMBAH (OSIS) ============
    bukaForm() {
        const u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser) ? OsisAuth.getUser() : null;
        if (!u || u.mode !== "osis") {
            if (typeof showPopup === "function") showPopup("Cuma akun OSIS.", "error");
            return;
        }
        if (typeof OsisAuth.butuh === "function" && !OsisAuth.butuh("moments")) return;
        Moments.pendingFile = null;
        Moments.pendingKind = "photo";

        const lama = document.getElementById("momentsFormOverlay");
        if (lama) lama.remove();
        const overlay = document.createElement("div");
        overlay.id = "momentsFormOverlay";
        overlay.className = "prestasi-form-overlay";
        overlay.innerHTML =
            `<div class="prestasi-form-box">` +
            `<div class="form-head" style="display:flex;align-items:center;justify-content:space-between">` +
            `<span><i class="fa-solid fa-clapperboard"></i> Tambah Momen</span>` +
            `<button class="icon-btn" onclick="Moments.tutupForm()" title="Tutup"><i class="fa-solid fa-xmark"></i></button>` +
            `</div>` +
            `<div class="prestasi-drop" id="momentsDrop">` +
            `<div class="prestasi-drop-inner" id="momentsDropInner">` +
            `<i class="fa-solid fa-cloud-arrow-up"></i>` +
            `<span>Klik atau drag foto/video ke sini</span>` +
            `<small>JPG/PNG/WEBP/MP4/WEBM (foto otomatis compress, video max ±100MB)</small>` +
            `</div>` +
            `<img id="momentsPreviewImg" style="display:none; width:100%; height:100%; object-fit:cover; border-radius:12px;">` +
            `<video id="momentsPreviewVid" style="display:none; width:100%; height:100%; object-fit:cover; border-radius:12px;" muted playsinline loop preload="metadata"></video>` +
            `</div>` +
            `<input type="file" id="momentsFormFile" accept="image/*,video/mp4,video/webm" style="display:none">` +
            `<div class="field" style="margin-top:12px">` +
            `<label>Caption</label>` +
            `<textarea id="momentsCaption" class="admin-input admin-textarea" placeholder="Ceritakan momennya..." maxlength="500" rows="3"></textarea>` +
            `</div>` +
            `<div class="moments-form-grid">` +
            `<div class="field"><label>Event / momen</label>` +
            `<input type="text" id="momentsEvent" class="admin-input" placeholder="cth: Makrab 2026" maxlength="80"></div>` +
            `<div class="field"><label>Kategori</label>` +
            `<select id="momentsCategory" class="admin-input">` +
            `<option value="random">Random</option>` +
            `<option value="events">Events</option>` +
            `</select></div>` +
            `</div>` +
            `<p class="moments-form-hint">Media tersimpan di R2 (key <b>moments/…</b>); database hanya menyimpan metadata. ` +
            `Video diputar muted + loop, autoplay hanya di tampilan HP.</p>` +
            `<div class="form-actions-row" style="margin-top:14px">` +
            `<button class="btn btn-white" onclick="Moments.tutupForm()">Batal</button>` +
            `<button class="btn btn-red" id="btnSimpanMoments" onclick="Moments.simpanForm()"><i class="fa-solid fa-check"></i> Simpan</button>` +
            `</div></div>`;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add("active")));
        document.body.style.overflow = "hidden";
        overlay.addEventListener("click", (e) => { if (e.target === overlay) Moments.tutupForm(); });

        const drop = overlay.querySelector("#momentsDrop");
        const fileInput = overlay.querySelector("#momentsFormFile");
        drop.addEventListener("click", () => fileInput.click());
        fileInput.addEventListener("change", () => {
            const f = fileInput.files && fileInput.files[0];
            if (f) Moments.pilihFile(f);
        });
        ["dragenter", "dragover"].forEach(ev => {
            drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("dragover"); });
        });
        ["dragleave", "drop"].forEach(ev => {
            drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("dragover"); });
        });
        drop.addEventListener("drop", (e) => {
            const f = e.dataTransfer.files && e.dataTransfer.files[0];
            if (f) Moments.pilihFile(f);
        });
    },

    tutupForm() {
        const el = document.getElementById("momentsFormOverlay");
        if (el) {
            el.classList.remove("active");
            setTimeout(() => { if (el.parentNode) el.remove(); }, 220);
        }
        if (!document.getElementById("momentsViewer")) document.body.style.overflow = "";
        Moments.pendingFile = null;
    },

    pilihFile(file) {
        const isImg = file.type.startsWith("image/");
        const isVid = file.type.startsWith("video/");
        if (!isImg && !isVid) {
            if (typeof showToast === "function") showToast("File harus foto atau video", "error");
            return;
        }
        if (isVid && file.size > 100 * 1024 * 1024) {
            if (typeof showToast === "function") showToast("Video max ±100MB biar ringan dibuka HP", "error");
            return;
        }
        Moments.pendingFile = file;
        Moments.pendingKind = isVid ? "video" : "photo";
        const url = URL.createObjectURL(file);
        const img = document.getElementById("momentsPreviewImg");
        const vid = document.getElementById("momentsPreviewVid");
        const inner = document.getElementById("momentsDropInner");
        if (inner) inner.style.display = "none";
        if (isVid) {
            if (img) img.style.display = "none";
            if (vid) { vid.src = url; vid.style.display = "block"; try { vid.play().catch(() => {}); } catch {} }
        } else {
            if (vid) { try { vid.pause(); } catch {} vid.style.display = "none"; }
            if (img) { img.src = url; img.style.display = "block"; }
        }
        const drop = document.getElementById("momentsDrop");
        if (drop) drop.classList.add("has-file");
    },

    async simpanForm() {
        const u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser) ? OsisAuth.getUser() : null;
        if (!u || u.mode !== "osis") return;
        if (typeof OsisAuth.butuh === "function" && !OsisAuth.butuh("moments")) return;
        const caption = (document.getElementById("momentsCaption") || {}).value || "";
        const eventName = ((document.getElementById("momentsEvent") || {}).value || "").trim();
        const category = ((document.getElementById("momentsCategory") || {}).value || "random");
        const file = Moments.pendingFile;
        if (!file) {
            if (typeof showToast === "function") showToast("Pilih foto/video dulu", "error");
            return;
        }
        if (!caption.trim() && !eventName) {
            if (typeof showToast === "function") showToast("Caption atau event diisi dulu", "error");
            return;
        }
        const btn = document.getElementById("btnSimpanMoments");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...'; }
        try {
            const ext = ((file.name.split(".").pop() || (Moments.pendingKind === "video" ? "mp4" : "jpg")).toLowerCase()).replace(/[^a-z0-9]/g, "") || "bin";
            // uploadFotoStorage: foto dikompres otomatis; video diteruskan apa adanya
            // via presign PUT ke R2 (folder moments/ diizinkan worker).
            const path = `moments/moments-${u.id}-${Date.now()}.${ext}`;
            await uploadFotoStorage(file, path);
            const newId = await buatMoment(u.id, {
                caption: caption.trim(),
                event_name: eventName,
                media_type: Moments.pendingKind,
                media_key: path,
                thumb_key: "",
                category,
            });
            if (!newId || newId <= 0) throw new Error("Gagal simpan (" + newId + ")");
            if (typeof showToast === "function") showToast("Momen ditambah!", "success");
            catatAksi("upload_moments", ((Moments.pendingKind === "video" ? "video " : "foto ") + String(eventName || caption || "").trim()).slice(0, 80));
            Moments.tutupForm();
            await Moments.muat(true);
        } catch (err) {
            console.error(err);
            if (err && err.message === "MOMENTS_NO_TABLE") {
                if (typeof showPopup === "function") showPopup("Tabel moments belum ada — jalankan migrasi-moments.sql di Supabase SQL Editor dulu.", "error");
            } else if (String((err && err.message) || "").includes("-1") || (err && err.message === "ERR_NO_AUTH")) {
                if (typeof showPopup === "function") showPopup("Kamu tidak punya kendali atas halaman Moments.", "error");
            } else {
                if (typeof showToast === "function") showToast("Gagal simpan: " + (err && err.message), "error");
            }
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check"></i> Simpan'; }
        }
    },

    async hapus(uid) {
        const u = (typeof OsisAuth !== "undefined" && OsisAuth.getUser) ? OsisAuth.getUser() : null;
        if (!u || u.mode !== "osis") return;
        if (typeof OsisAuth.butuh === "function" && !OsisAuth.butuh("moments")) return;
        if (Moments.sumber !== "moments") {
            if (typeof showToast === "function") showToast("Hapus dari halaman Galeri (mode fallback).", "info");
            return;
        }
        const it = (Moments.items || []).find(x => x.uid === uid);
        if (!it) return;
        const yakin = (typeof showPopup === "function")
            ? await showPopup("Hapus momen ini? Medianya ikut terhapus.", "confirm")
            : true;
        if (!yakin) return;
        try {
            await hapusMoment(u.id, it.srcId);
            if (it.raw && it.raw.media_key) { try { await hapusFotoStorage(it.raw.media_key); } catch {} }
            if (it.raw && it.raw.thumb_key) { try { await hapusFotoStorage(it.raw.thumb_key); } catch {} }
            if (typeof showToast === "function") showToast("Momen dihapus", "success");
            await Moments.muat(true);
        } catch (err) {
            console.error(err);
            if (typeof showPopup === "function") showPopup("Gagal hapus: " + (err && err.message), "error");
        }
    },
};

if (typeof Router !== "undefined") {
    Router.register("moments", () => Moments.init());
} else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => Moments.init());
} else {
    Moments.init();
}
