// =========================================================================
// FEED — scrolling foto + video ala IG (like, komen, share).
// 1 postingan = 1 foto ATAU 1 video + caption. Upload BEBAS semua akun
// OSIS (tanpa hak khusus); hapus = pemilik / super_admin. Komen wajib
// login (osis/biasa); like & share bebas (user_key per perangkat).
// Tulis SELALU lewat RPC migrasi-feed.sql; scroll = paginasi offset.
// =========================================================================

const Feed = {
    items: [],
    offset: 0,
    perPage: 8,
    habis: false,
    loading: false,
    komenCache: {},   // postId -> [{id, user_key, nama, teks, created_at}]
    komenBuka: {},    // postId -> true (kolom komen expanded)
    observer: null,
    playing: null,
    pendingFile: null,
    pendingKind: "photo",
    terinisialisasi: false,

    // ---- identitas ----
    user() {
        try {
            return (typeof OsisAuth !== "undefined" && OsisAuth.getUser)
                ? OsisAuth.getUser()
                : null;
        } catch { return null; }
    },

    isOsis() {
        const u = Feed.user();
        return !!(u && u.mode === "osis");
    },

    isSuper() {
        try {
            return !!(Feed.isOsis() && OsisAuth.isSuper && OsisAuth.isSuper());
        } catch { return false; }
    },

    bisaUpload() {
        return Feed.isOsis();
    },

    userKey() {
        try {
            const u = Feed.user();
            if (u && u.mode === "osis" && u.id) return "osis:" + u.id;
            if (u && u.mode === "biasa" && (u.id || u.username)) return "biasa:" + (u.id || u.username);
        } catch {}
        try {
            const d = (typeof getDeviceId === "function" ? getDeviceId() : "");
            if (d) return "dev:" + d;
        } catch {}
        return "";
    },

    namaSaya() {
        try {
            const u = Feed.user();
            if (!u) return "";
            if (typeof OsisAuth.displayName === "function") {
                const n = String(OsisAuth.displayName(u) || "").trim();
                if (n) return n.slice(0, 80);
            }
            return String(u.nama || u.username || "").trim().slice(0, 80);
        } catch { return ""; }
    },

    // ---- init ----
    init() {
        if (Feed.terinisialisasi) return;
        Feed.terinisialisasi = true;
        if (typeof OsisAuth.refreshAkses === "function") {
            OsisAuth.refreshAkses().then(() => Feed.cekLogin()).catch(() => {});
        }
        Feed.cekLogin();
        Feed.muat(true).then(() => Feed.cekDeepLink()).catch(() => {});
        Feed.pasangObserver();
        window.addEventListener("hashchange", () => {
            try {
                const r = (typeof Router !== "undefined" && Router.current) || "";
                if (r !== "feed") Feed.jedaSemua();
                else {
                    Feed.cekLogin();
                    Feed.cekDeepLink();
                }
            } catch {}
        });
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) Feed.jedaSemua();
        });
    },

    cekLogin() {
        const fab = document.getElementById("btnTambahFeed");
        if (fab) fab.style.display = Feed.bisaUpload() ? "" : "none";
    },

    fmtWaktu(iso) {
        try {
            const t = new Date(iso).getTime();
            if (!t) return "";
            const diff = Date.now() - t;
            if (diff < 0) return "baru aja";
            const m = Math.floor(diff / 60000);
            if (m < 1) return "baru aja";
            if (m < 60) return m + " mnt lalu";
            const h = Math.floor(m / 60);
            if (h < 24) return h + " jam lalu";
            return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
        } catch { return ""; }
    },

    inisial(nama) {
        const s = String(nama || "?").trim();
        return (s.charAt(0) || "?").toUpperCase();
    },

    // Preferensi suara: sekali user unmute, video berikutnya coba bersuara.
    // (Tombol volume hardware HP tidak terbaca web — OS yang pegang.)
    suaraMau() {
        try { return localStorage.getItem("feed_suara") === "1"; }
        catch { return false; }
    },

    suaraSet(mau) {
        try { localStorage.setItem("feed_suara", mau ? "1" : "0"); }
        catch {}
    },

    sinkronIkonMute(card, video) {
        const ic = card ? card.querySelector(".feed-mute i") : null;
        if (ic) ic.className = video.muted ? "fa-solid fa-volume-xmark" : "fa-solid fa-volume-high";
    },

    // ============ MUAT (paginasi scroll) ============
    async muat(awal) {
        const list = document.getElementById("feedList");
        if (!list || Feed.loading) return;
        if (!awal && Feed.habis) return;
        Feed.loading = true;
        if (awal) {
            Feed.items = [];
            Feed.offset = 0;
            Feed.habis = false;
            Feed.komenCache = {};
            list.innerHTML = `<div class="loading-block"><div class="spinner"></div>Memuat feed...</div>`;
        }
        try {
            const rows = await feedPostsList(Feed.perPage, Feed.offset, Feed.userKey());
            if (awal) Feed.items = [];
            (rows || []).forEach(r => {
                // Kunci acak stabil per sesi (diacak tiap buka, konsisten pas scroll)
                if (r._r === undefined) r._r = Math.random();
                Feed.items.push(r);
            });
            Feed.offset = Feed.items.length;
            if (!rows || rows.length < Feed.perPage) Feed.habis = true;
            Feed.render();
        } catch (err) {
            console.error(err);
            if (err && err.message === "FEED_NO_TABLE") {
                list.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-database"></i> Tabel feed belum ada.<br>Jalankan dulu <b>migrasi-feed.sql</b> di Supabase SQL Editor.</div>`;
            } else if (awal) {
                list.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-triangle-exclamation"></i> Gagal memuat feed. Cek koneksi.<br><br><button class="btn btn-red btn-sm" onclick="Feed.muat(true)"><i class="fa-solid fa-rotate-right"></i> Coba Lagi</button></div>`;
            } else if (typeof showToast === "function") {
                showToast("Gagal muat lanjutan feed.", "error");
            }
        } finally {
            Feed.loading = false;
        }
    },

    // Urutan tampil: pin deep-link > baru (<24 jam, terbaru dulu) > acak.
    urutTampil() {
        const BARU = 24 * 3600 * 1000;
        const skrg = Date.now();
        const fresh = (it) => {
            const t = new Date(it.created_at).getTime();
            return t && (skrg - t) < BARU;
        };
        return [...(Feed.items || [])].sort((a, b) => {
            if (a._pin && b._pin) return 0;
            if (a._pin) return -1;
            if (b._pin) return 1;
            const fa = fresh(a), fb = fresh(b);
            if (fa && fb) return new Date(b.created_at) - new Date(a.created_at);
            if (fa) return -1;
            if (fb) return 1;
            return (a._r ?? 0) - (b._r ?? 0);
        });
    },

    // ============ RENDER ============
    render() {
        const list = document.getElementById("feedList");
        if (!list) return;
        Feed.jedaSemua();
        const items = Feed.urutTampil();
        if (!items.length) {
            list.innerHTML = `<div class="pesan-empty"><i class="fa-solid fa-images"></i> Belum ada postingan. Jadilah yang pertama!</div>`;
            return;
        }
        list.innerHTML = items.map(it => Feed.kartu(it)).join("") +
            (Feed.habis
                ? `<div class="feed-end">— Udah paling bawah, mantap! —</div>`
                : `<div class="feed-loading" id="feedSentinel"><div class="spinner"></div> Memuat...</div>`);
        Feed.amatiVideo();
        Feed.amatiSentinel();
    },

    kartu(it) {
        const id = it.id;
        const esc = (typeof escapeHtml === "function" ? escapeHtml : String);
        const isVideo = it.media_type === "video";
        const media = isVideo
            ? `<div class="feed-media" onclick="Feed.togglePlay(${id}, event)">` +
              `<video muted loop playsinline preload="metadata" data-src="${(typeof getFoto === "function" ? getFoto(it.media_key) : it.media_key)}"></video>` +
              `<span class="feed-play"><i class="fa-solid fa-play"></i></span>` +
              `<button type="button" class="feed-mute" onclick="event.stopPropagation(); Feed.toggleMute(${id}, this)" title="Suara"><i class="fa-solid fa-volume-xmark"></i></button>` +
              `</div>`
            : `<div class="feed-media"><img src="${(typeof getFoto === "function" ? getFoto(it.media_key) : it.media_key)}" alt="${esc(it.caption || "Postingan feed")}" loading="lazy" decoding="async"></div>`;
        const u = Feed.user();
        const canDel = Feed.isSuper() || (Feed.isOsis() && u && String(it.created_by) === String(u.id));
        const komenBuka = !!Feed.komenBuka[id];
        return `<article class="feed-card" data-feed-id="${id}">` +
            `<div class="feed-head">` +
            `<span class="feed-avatar">${esc(Feed.inisial(it.pengunggah))}</span>` +
            `<div class="feed-who"><b>${esc(it.pengunggah || "OSIS")}</b><small>${Feed.fmtWaktu(it.created_at)}</small></div>` +
            (canDel ? `<button type="button" class="feed-del" onclick="Feed.hapus(${id})" title="Hapus postingan"><i class="fa-solid fa-trash-can"></i></button>` : "") +
            `</div>` +
            media +
            `<div class="feed-aksi">` +
            `<button type="button" class="feed-btn${it.liked ? " on" : ""}" onclick="Feed.like(${id}, this)" title="Suka"><i class="fa-solid fa-heart"></i><span>${it.like_count || 0}</span></button>` +
            `<button type="button" class="feed-btn" onclick="Feed.toggleKomen(${id})" title="Komentar"><i class="fa-solid fa-comment"></i><span>${it.comment_count || 0}</span></button>` +
            `<button type="button" class="feed-btn" onclick="Feed.share(${id}, this)" title="Bagikan"><i class="fa-solid fa-share-nodes"></i><span>${it.share_count || 0}</span></button>` +
            `</div>` +
            (it.caption ? `<p class="feed-caption"><b>${esc(it.pengunggah || "OSIS")}</b> ${esc(it.caption)}</p>` : "") +
            `<div class="feed-kbox" id="feedKbox-${id}" style="${komenBuka ? "" : "display:none"}">${komenBuka ? Feed.komenHtml(id) : ""}</div>` +
            `</article>`;
    },

    // ============ DEEP-LINK (#/feed?id=...) ============
    idDariHash() {
        try {
            const m = String(location.hash || "").match(/[?&]id=(\d+)/);
            const n = m ? parseInt(m[1], 10) : 0;
            return Number.isFinite(n) && n > 0 ? n : 0;
        } catch { return 0; }
    },

    cekDeepLink() {
        try {
            const r = (typeof Router !== "undefined" && Router.current) || "";
            if (r !== "feed") return;
        } catch {}
        const id = Feed.idDariHash();
        if (id) Feed.loncatKe(id);
    },

    async loncatKe(id) {
        id = parseInt(id, 10);
        if (!id) return;
        let ada = (Feed.items || []).some(x => String(x.id) === String(id));
        if (!ada) {
            // Belum ke-load (mis. halaman bawah) -> ambil satuan lalu taruh paling atas.
            try {
                const satu = await feedPostSatu(id, Feed.userKey());
                if (satu && satu.id) {
                    if (satu._r === undefined) satu._r = Math.random();
                    satu._pin = true;
                    Feed.items = [satu].concat(Feed.items || []);
                    Feed.offset = Feed.items.length;
                    Feed.render();
                    ada = true;
                }
            } catch (err) {
                console.error(err);
            }
        }
        if (!ada) {
            if (typeof showToast === "function") showToast("Postingan tidak ketemu.", "error");
            return;
        }
        requestAnimationFrame(() => {
            const card = document.querySelector(`.feed-card[data-feed-id="${id}"]`);
            if (!card) return;
            try { card.scrollIntoView({ behavior: "smooth", block: "center" }); } catch {}
            card.classList.remove("flash");
            void card.offsetWidth;
            card.classList.add("flash");
            setTimeout(() => card.classList.remove("flash"), 2200);
        });
    },

    // ============ VIDEO (autoplay pas terlihat, 1 bunyi) ============
    pasangObserver() {
        if (Feed.observer) return;
        if (!("IntersectionObserver" in window)) return;
        Feed.observer = new IntersectionObserver((entries) => {
            entries.forEach(en => {
                const card = en.target;
                if (card.id === "feedSentinel") {
                    if (en.isIntersecting) Feed.muat(false);
                    return;
                }
                const video = card.querySelector ? card.querySelector("video") : null;
                if (!video) return;
                const ratio = en.intersectionRatio || 0;
                if (en.isIntersecting && ratio >= 0.6) {
                    Feed.pastikanSrc(video);
                    Feed.putar(card, video);
                } else {
                    Feed.jeda(card, video);
                }
            });
        }, { root: null, rootMargin: "200px 0px 200px 0px", threshold: [0, 0.6, 1] });
    },

    amatiVideo() {
        if (!Feed.observer) return;
        document.querySelectorAll("#feedList .feed-card").forEach(el => {
            try { Feed.observer.observe(el); } catch {}
        });
    },

    amatiSentinel() {
        if (!Feed.observer) return;
        const s = document.getElementById("feedSentinel");
        if (s) { try { Feed.observer.observe(s); } catch {} }
    },

    videoDariId(id) {
        const card = document.querySelector(`.feed-card[data-feed-id="${id}"]`);
        return { card, video: card ? card.querySelector("video") : null };
    },

    pastikanSrc(video) {
        if (!video || video.getAttribute("src")) return;
        const ds = video.getAttribute("data-src");
        if (ds) {
            video.src = ds;
            try { video.load(); } catch {}
        }
    },

    putar(card, video) {
        if (!video) return;
        if (Feed.playing && Feed.playing !== video) {
            try { Feed.playing.pause(); } catch {}
            const prev = Feed.playing.closest ? Feed.playing.closest(".feed-card") : null;
            if (prev) prev.classList.remove("playing");
        }
        Feed.playing = video;
        // Kalau user pernah unmute: coba bersuara, browser nolak -> balik muted.
        if (Feed.suaraMau() && video.muted) video.muted = false;
        Feed.sinkronIkonMute(card, video);
        try {
            const p = video.play();
            if (p && p.catch) p.catch(() => {
                if (!video.muted) {
                    video.muted = true;
                    Feed.sinkronIkonMute(card, video);
                    try { video.play().catch(() => {}); } catch {}
                }
            });
        } catch {}
        if (card) {
            card.classList.add("playing");
            const ic = card.querySelector(".feed-play i");
            if (ic) ic.className = "fa-solid fa-pause";
        }
    },

    jeda(card, video) {
        if (!video) return;
        try { video.pause(); } catch {}
        if (Feed.playing === video) Feed.playing = null;
        if (card) {
            card.classList.remove("playing");
            const ic = card.querySelector(".feed-play i");
            if (ic) ic.className = "fa-solid fa-play";
        }
    },

    jedaSemua() {
        try {
            document.querySelectorAll("#feedList video").forEach(v => { try { v.pause(); } catch {} });
        } catch {}
        Feed.playing = null;
        try {
            document.querySelectorAll("#feedList .feed-card.playing").forEach(c => {
                c.classList.remove("playing");
                const ic = c.querySelector(".feed-play i");
                if (ic) ic.className = "fa-solid fa-play";
            });
        } catch {}
    },

    togglePlay(id, ev) {
        if (ev) ev.stopPropagation();
        const { card, video } = Feed.videoDariId(id);
        if (!video) return;
        Feed.pastikanSrc(video);
        if (video.paused) Feed.putar(card, video);
        else Feed.jeda(card, video);
    },

    toggleMute(id, btn) {
        const { card, video } = Feed.videoDariId(id);
        if (!video) return;
        video.muted = !video.muted;
        Feed.suaraSet(!video.muted);
        Feed.sinkronIkonMute(card, video);
        if (!video.paused && !video.muted) {
            try {
                const p = video.play();
                if (p && p.catch) p.catch(() => {
                    video.muted = true;
                    Feed.sinkronIkonMute(card, video);
                });
            } catch {}
        }
    },

    // ============ LIKE ============
    async like(id, btn) {
        const key = Feed.userKey();
        if (!key) {
            if (typeof showToast === "function") showToast("Gagal like, muat ulang dulu.", "error");
            return;
        }
        const item = (Feed.items || []).find(x => String(x.id) === String(id));
        const dulu = !!(item && item.liked);
        const jmlDulu = item ? (parseInt(item.like_count, 10) || 0) : 0;
        if (item) {
            item.liked = !dulu;
            item.like_count = Math.max(0, jmlDulu + (item.liked ? 1 : -1));
        }
        if (btn) {
            btn.classList.toggle("on", !dulu);
            const s = btn.querySelector("span");
            if (s) s.textContent = String(item ? item.like_count : jmlDulu);
        }
        try {
            const n = await feedLikeToggle(id, key);
            if (item) item.like_count = n;
            if (btn) {
                const s = btn.querySelector("span");
                if (s) s.textContent = String(n);
            }
        } catch (err) {
            console.error(err);
            if (item) {
                item.liked = dulu;
                item.like_count = jmlDulu;
            }
            if (btn) {
                btn.classList.toggle("on", dulu);
                const s = btn.querySelector("span");
                if (s) s.textContent = String(jmlDulu);
            }
            if (err && err.message === "FEED_NO_TABLE") {
                if (typeof showPopup === "function") showPopup("Database belum dimigrasi. Jalankan dulu migrasi-feed.sql di Supabase.", "error");
            } else if (typeof showToast === "function") {
                showToast("Gagal like. Cek koneksi.", "error");
            }
        }
    },

    // ============ KOMEN ============
    toggleKomen(id) {
        Feed.komenBuka[id] = !Feed.komenBuka[id];
        const box = document.getElementById("feedKbox-" + id);
        if (!box) return;
        if (Feed.komenBuka[id]) {
            box.style.display = "";
            if (!Feed.komenCache[id]) Feed.muatKomen(id);
            else box.innerHTML = Feed.komenHtml(id);
        } else {
            box.style.display = "none";
        }
    },

    async muatKomen(id) {
        const box = document.getElementById("feedKbox-" + id);
        if (box) box.innerHTML = `<div class="feed-komen-loading"><i class="fa-solid fa-spinner fa-spin"></i> Memuat komentar...</div>`;
        try {
            const rows = await feedKomenList(id, 20, 0);
            Feed.komenCache[id] = rows || [];
        } catch (err) {
            console.error(err);
            Feed.komenCache[id] = [];
            if (err && err.message === "FEED_NO_TABLE") {
                if (typeof showPopup === "function") showPopup("Database belum dimigrasi. Jalankan dulu migrasi-feed.sql di Supabase.", "error");
            }
        }
        if (box) box.innerHTML = Feed.komenHtml(id);
    },

    komenHtml(id) {
        const esc = (typeof escapeHtml === "function" ? escapeHtml : String);
        const list = Feed.komenCache[id] || [];
        const key = Feed.userKey();
        const u = Feed.user();
        const login = !!(u && (u.mode === "osis" || u.mode === "biasa"));
        let html = `<div class="feed-komen-list">`;
        if (!list.length) {
            html += `<div class="feed-komen-empty">Belum ada komentar. Jadilah yang pertama!</div>`;
        } else {
            html += list.map(k => {
                const bisaHapus = (key && String(k.user_key) === String(key)) || Feed.isOsis();
                return `<div class="feed-komen" data-komen-id="${k.id}">` +
                    `<span class="feed-komen-avatar">${esc(Feed.inisial(k.nama))}</span>` +
                    `<div class="feed-komen-body"><b>${esc(k.nama || "Anonim")}</b><p>${esc(k.teks)}</p></div>` +
                    (bisaHapus ? `<button type="button" class="feed-komen-del" onclick="Feed.hapusKomen(${id}, ${k.id})" title="Hapus komentar"><i class="fa-solid fa-trash-can"></i></button>` : "") +
                    `</div>`;
            }).join("");
        }
        html += `</div>`;
        if (login) {
            html += `<div class="feed-komen-form">` +
                `<input type="text" id="feedKomenInput-${id}" maxlength="300" placeholder="Tulis komentar..." autocomplete="off">` +
                `<button type="button" onclick="Feed.kirimKomen(${id})" title="Kirim"><i class="fa-solid fa-paper-plane"></i></button>` +
                `</div>`;
        } else {
            html += `<a href="login" class="feed-komen-login" onclick="OsisAuth.simpanBack()">Login dulu buat komen</a>`;
        }
        return html;
    },

    async kirimKomen(id) {
        const inp = document.getElementById("feedKomenInput-" + id);
        const teks = String(inp ? inp.value : "").trim().slice(0, 300);
        if (!teks) {
            if (typeof showToast === "function") showToast("Komentarnya diisi dulu.", "error");
            if (inp) inp.focus();
            return;
        }
        const u = Feed.user();
        if (!u || !(u.mode === "osis" || u.mode === "biasa")) {
            if (typeof showToast === "function") showToast("Login dulu buat komen.", "error");
            return;
        }
        try {
            await feedKomenTambah(id, Feed.userKey(), Feed.namaSaya() || "Anonim", teks);
            const rows = await feedKomenList(id, 20, 0);
            Feed.komenCache[id] = rows || [];
            const item = (Feed.items || []).find(x => String(x.id) === String(id));
            if (item) item.comment_count = (Feed.komenCache[id] || []).length;
            const box = document.getElementById("feedKbox-" + id);
            if (box) box.innerHTML = Feed.komenHtml(id);
            Feed.refreshCount(id);
        } catch (err) {
            console.error(err);
            if (typeof showToast === "function") showToast("Gagal kirim komentar.", "error");
        }
    },

    async hapusKomen(postId, komenId) {
        const yakin = (typeof showPopup === "function")
            ? await showPopup("Hapus komentar ini?", "confirm")
            : confirm("Hapus komentar ini?");
        if (!yakin) return;
        try {
            const u = Feed.user();
            await feedKomenHapus(u && u.mode === "osis" ? u.id : 0, Feed.userKey(), komenId);
            const rows = await feedKomenList(postId, 20, 0);
            Feed.komenCache[postId] = rows || [];
            const item = (Feed.items || []).find(x => String(x.id) === String(postId));
            if (item) item.comment_count = (Feed.komenCache[postId] || []).length;
            const box = document.getElementById("feedKbox-" + postId);
            if (box) box.innerHTML = Feed.komenHtml(postId);
            Feed.refreshCount(postId);
            if (typeof showToast === "function") showToast("Komentar dihapus.", "success");
        } catch (err) {
            console.error(err);
            if (typeof showPopup === "function") showPopup("Gagal hapus komentar.", "error");
        }
    },

    refreshCount(id) {
        const item = (Feed.items || []).find(x => String(x.id) === String(id));
        if (!item) return;
        const card = document.querySelector(`.feed-card[data-feed-id="${id}"]`);
        if (!card) return;
        const btns = card.querySelectorAll(".feed-aksi .feed-btn span");
        if (btns[0]) btns[0].textContent = String(item.like_count || 0);
        if (btns[1]) btns[1].textContent = String(item.comment_count || 0);
        if (btns[2]) btns[2].textContent = String(item.share_count || 0);
    },

    // ============ SHARE ============
    async share(id, btn) {
        const item = (Feed.items || []).find(x => String(x.id) === String(id));
        const url = location.origin + location.pathname + "#/feed?id=" + id;
        const data = {
            title: "Feed OSIS TARPAN ONE",
            text: (item && item.caption) || "Lihat postingan OSIS!",
            url,
        };
        try {
            if (navigator.share) await navigator.share(data);
            else if (navigator.clipboard) {
                await navigator.clipboard.writeText(url);
                if (typeof showToast === "function") showToast("Tautan disalin!", "success");
            }
        } catch {}
        try {
            await feedShareCat(id);
            if (item) {
                item.share_count = (parseInt(item.share_count, 10) || 0) + 1;
                Feed.refreshCount(id);
            }
        } catch {}
    },

    // ============ HAPUS POSTINGAN ============
    async hapus(id) {
        const u = Feed.user();
        if (!u || u.mode !== "osis") return;
        const item = (Feed.items || []).find(x => String(x.id) === String(id));
        if (!item) return;
        const yakin = (typeof showPopup === "function")
            ? await showPopup("Hapus postingan ini? Medianya ikut terhapus.", "confirm")
            : confirm("Hapus postingan ini?");
        if (!yakin) return;
        try {
            await feedPostHapus(u.id, id);
            if (item.media_key) { try { await hapusFotoStorage(item.media_key); } catch {} }
            Feed.items = (Feed.items || []).filter(x => String(x.id) !== String(id));
            delete Feed.komenCache[id];
            delete Feed.komenBuka[id];
            Feed.render();
            if (typeof showToast === "function") showToast("Postingan dihapus.", "success");
        } catch (err) {
            console.error(err);
            if (typeof showPopup === "function") showPopup("Gagal hapus: " + (err && err.message), "error");
        }
    },

    // ============ UPLOAD (bebas semua akun OSIS) ============
    bukaForm() {
        const u = Feed.user();
        if (!u || u.mode !== "osis") {
            if (typeof showPopup === "function") showPopup("Cuma akun OSIS yang bisa posting.", "error");
            return;
        }
        Feed.pendingFile = null;
        Feed.pendingKind = "photo";
        const lama = document.getElementById("feedFormOverlay");
        if (lama) lama.remove();
        const overlay = document.createElement("div");
        overlay.id = "feedFormOverlay";
        overlay.className = "prestasi-form-overlay";
        overlay.innerHTML =
            `<div class="prestasi-form-box">` +
            `<div class="form-head" style="display:flex;align-items:center;justify-content:space-between">` +
            `<span><i class="fa-solid fa-plus"></i> Postingan Baru</span>` +
            `<button class="icon-btn" onclick="Feed.tutupForm()" title="Tutup"><i class="fa-solid fa-xmark"></i></button>` +
            `</div>` +
            `<div class="prestasi-drop" id="feedDrop">` +
            `<div class="prestasi-drop-inner" id="feedDropInner">` +
            `<i class="fa-solid fa-cloud-arrow-up"></i>` +
            `<span>Klik atau drag foto/video ke sini</span>` +
            `<small>JPG/PNG/WEBP/MP4/WEBM (foto otomatis compress, video max ±100MB)</small>` +
            `</div>` +
            `<img id="feedPreviewImg" style="display:none; max-width:100%; max-height:320px; object-fit:contain; border-radius:12px;">` +
            `<video id="feedPreviewVid" style="display:none; max-width:100%; max-height:320px; object-fit:contain; border-radius:12px;" muted playsinline loop preload="metadata"></video>` +
            `</div>` +
            `<div class="feed-filemeta" id="feedFileMeta" style="display:none"></div>` +
            `<input type="file" id="feedFormFile" accept="image/*,video/mp4,video/webm" style="display:none">` +
            `<div class="field" style="margin-top:12px">` +
            `<label>Caption</label>` +
            `<textarea id="feedCaption" class="admin-input admin-textarea" placeholder="Tulis caption..." maxlength="500" rows="3"></textarea>` +
            `</div>` +
            `<div class="form-actions-row" style="margin-top:14px">` +
            `<button class="btn btn-white" onclick="Feed.tutupForm()">Batal</button>` +
            `<button class="btn btn-red" id="btnSimpanFeed" onclick="Feed.simpanForm()"><i class="fa-solid fa-check"></i> Posting</button>` +
            `</div></div>`;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add("active")));
        document.body.style.overflow = "hidden";
        overlay.addEventListener("click", (e) => { if (e.target === overlay) Feed.tutupForm(); });

        const drop = overlay.querySelector("#feedDrop");
        const fileInput = overlay.querySelector("#feedFormFile");
        drop.addEventListener("click", () => fileInput.click());
        fileInput.addEventListener("change", () => {
            const f = fileInput.files && fileInput.files[0];
            if (f) Feed.pilihFile(f);
        });
        ["dragenter", "dragover"].forEach(ev => {
            drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("dragover"); });
        });
        ["dragleave", "drop"].forEach(ev => {
            drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("dragover"); });
        });
        drop.addEventListener("drop", (e) => {
            const f = e.dataTransfer.files && e.dataTransfer.files[0];
            if (f) Feed.pilihFile(f);
        });
    },

    tutupForm() {
        const el = document.getElementById("feedFormOverlay");
        if (el) {
            el.classList.remove("active");
            setTimeout(() => { if (el.parentNode) el.remove(); }, 220);
        }
        document.body.style.overflow = "";
        Feed.pendingFile = null;
    },

    fmtSize(byte) {
        try {
            const n = Number(byte) || 0;
            if (n < 1024) return n + " B";
            if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
            return (n / (1024 * 1024)).toFixed(1) + " MB";
        } catch { return ""; }
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
        Feed.pendingFile = file;
        Feed.pendingKind = isVid ? "video" : "photo";
        const url = URL.createObjectURL(file);
        const img = document.getElementById("feedPreviewImg");
        const vid = document.getElementById("feedPreviewVid");
        const inner = document.getElementById("feedDropInner");
        const meta = document.getElementById("feedFileMeta");
        if (inner) inner.style.display = "none";
        if (isVid) {
            if (img) img.style.display = "none";
            if (vid) { vid.src = url; vid.style.display = "block"; try { vid.play().catch(() => {}); } catch {} }
        } else {
            if (vid) { try { vid.pause(); } catch {} vid.removeAttribute("src"); vid.style.display = "none"; }
            if (img) { img.src = url; img.style.display = "block"; }
        }
        if (meta) {
            const esc = (typeof escapeHtml === "function" ? escapeHtml : String);
            meta.style.display = "";
            meta.innerHTML = `<i class="fa-solid ${isVid ? "fa-clapperboard" : "fa-image"}"></i>` +
                `<b>${esc(file.name || (isVid ? "video" : "foto"))}</b>` +
                `<span>${Feed.fmtSize(file.size)} · ${isVid ? "Video" : "Foto"}</span>` +
                `<small>Ketuk pratinjau buat ganti</small>`;
        }
        const drop = document.getElementById("feedDrop");
        if (drop) drop.classList.add("has-file");
    },

    async simpanForm() {
        const u = Feed.user();
        if (!u || u.mode !== "osis") return;
        const caption = ((document.getElementById("feedCaption") || {}).value || "").trim();
        const file = Feed.pendingFile;
        if (!file) {
            if (typeof showToast === "function") showToast("Pilih foto/video dulu", "error");
            return;
        }
        if (!caption) {
            if (typeof showToast === "function") showToast("Caption diisi dulu", "error");
            return;
        }
        const btn = document.getElementById("btnSimpanFeed");
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memposting...'; }
        try {
            const ext = ((file.name.split(".").pop() || (Feed.pendingKind === "video" ? "mp4" : "jpg")).toLowerCase()).replace(/[^a-z0-9]/g, "") || "bin";
            const path = `feed/feed-${u.id}-${Date.now()}.${ext}`;
            await uploadFotoStorage(file, path);
            const newId = await feedPostBuat(u.id, {
                media_type: Feed.pendingKind,
                media_key: path,
                thumb_key: "",
                caption,
            });
            if (!newId || newId <= 0) throw new Error("Gagal simpan (" + newId + ")");
            if (typeof showToast === "function") showToast("Postingan tayang!", "success");
            Feed.tutupForm();
            await Feed.muat(true);
            window.scrollTo(0, 0);
        } catch (err) {
            console.error(err);
            if (err && err.message === "FEED_NO_TABLE") {
                if (typeof showPopup === "function") showPopup("Tabel feed belum ada — jalankan migrasi-feed.sql di Supabase SQL Editor dulu.", "error");
            } else if (String((err && err.message) || "").includes("-1") || (err && err.message === "ERR_NO_AUTH")) {
                if (typeof showPopup === "function") showPopup("Cuma akun OSIS yang bisa posting.", "error");
            } else {
                if (typeof showToast === "function") showToast("Gagal posting: " + (err && err.message), "error");
            }
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-check"></i> Posting'; }
        }
    },
};

if (typeof Router !== "undefined") {
    Router.register("feed", () => Feed.init());
} else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => Feed.init());
} else {
    Feed.init();
}
